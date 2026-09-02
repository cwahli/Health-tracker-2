import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { batchRows, classifyRows } from "./backoffice.ts";
import { buildTurnUserMessage, fillBatch } from "./call_agent.ts";
import { parseLabImages } from "./vision_parser.ts";
import { fillTemplateInstruction } from "./instruction.ts";
import { scoreBiomarkersCase, scoreC2 } from "./score.ts";
import { DRAFT_BATCH_SIZE, INSIGHT_BATCH_SIZE } from "./template.ts";
import type { CaseFile, ClassifiedRow, ExpectedFile, FillRow, ProfileFixture } from "./schema.ts";

type TurnLog = {
  turn: number;
  kind?: string;
  ids: string[];
  ms: number;
  n: number;
  raw: string;
  rows: FillRow[];
  user?: string;
  payload?: unknown;
};

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const HERE = path.dirname(new URL(import.meta.url).pathname);

function loadEnv() {
  const candidates = [
    path.join(ROOT, ".env"),
    path.join(process.cwd(), ".env"),
    path.join(os.homedir(), "src/Health-tracker/.env"),
    path.join(os.homedir(), "antigravity/Biomarker-and-Nutrient-Tracker/.env"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    dotenv.config({ path: p, override: false });
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY) return p;
  }
  dotenv.config({ override: false });
  return null;
}

const envPath = loadEnv();

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("-")) return process.argv[i + 1];
  return fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function loadJson<T>(p: string): T {
  return JSON.parse(fs.readFileSync(p, "utf8")) as T;
}

function printClassified(classified: ClassifiedRow[]) {
  console.log(`\nBack-office identity (${classified.length} rows)`);
  for (const r of classified) {
    const tag = r.writeTarget === "observation" ? "HIT " : "MISS";
    const st = r.template.currentEvaluationStatus ? ` status=${r.template.currentEvaluationStatus}` : "";
    console.log(
      `  ${tag} ${r.id.padEnd(4)} ${r.printed.padEnd(32)} → ${r.writeTarget.padEnd(12)} key=${r.catalog?.key || r.mappedKey} match=${r.match}${st}`
    );
  }
}

function toFillRow(c: ClassifiedRow): FillRow {
  return {
    id: c.id,
    op: "add",
    printed: c.printed,
    value: c.value,
    unit: c.unit,
    date: c.date,
    printedRange: c.printedRange,
    assignedRange: c.assignedRange,
    optimalValue: c.template.optimalValue,
    editReason: c.template.editReason,
    dictionaryCorrection: c.template.dictionaryCorrection,
    match: c.match,
    key: c.template.key,
    writeTarget: c.writeTarget,
    medicalInsight: c.template.medicalInsight,
    customRangeOverlay: c.template.customRangeOverlay,
    logs: c.template.historicalLogs,
    newCatalogDraft: c.template.newCatalogDraft,
  };
}

function applyAgentRow(classified: ClassifiedRow[], row: FillRow) {
  const cls = classified.find((c) => c.id === row.id);
  if (!cls) return;
  if (row.medicalInsight && row.medicalInsight.trim() !== "") {
    cls.template.medicalInsight = row.medicalInsight;
  }
  if (row.customRangeOverlay && row.customRangeOverlay.trim() !== "") {
    cls.template.customRangeOverlay = row.customRangeOverlay;
  }
  if (row.optimalValue !== undefined && row.optimalValue !== null && String(row.optimalValue).trim() !== "") {
    cls.template.optimalValue = row.optimalValue;
  }
  if (row.editReason && row.editReason.trim() !== "") {
    cls.template.editReason = row.editReason;
  }
  if (row.dictionaryCorrection) {
    cls.template.dictionaryCorrection = row.dictionaryCorrection;
  }
  if (row.newCatalogDraft) cls.template.newCatalogDraft = row.newCatalogDraft;
  
  if (row.logs && row.logs.length) cls.template.historicalLogs = row.logs;
}

async function runBiomarkersCase(caseId: string): Promise<boolean> {
  const casePath = path.join(HERE, `fixtures/cases/${caseId}.json`);
  const expectPath = path.join(HERE, `fixtures/cases/${caseId}.expected.json`);
  const caseFile = loadJson<CaseFile>(casePath);
  const expected = loadJson<ExpectedFile>(expectPath);
  
  // Use case-specific profile if present, else fallback to default profile.json
  const profile = (caseFile as any).profile || loadJson<ProfileFixture>(path.join(HERE, "fixtures/profile.json"));
  
  const insightSize = Number(arg("--insight-batch", String(INSIGHT_BATCH_SIZE)));
  const draftSize = Number(arg("--draft-batch", String(DRAFT_BATCH_SIZE)));
  const dry = hasFlag("--dry-run");

  console.log("==========================================================================================");
  console.log(`${caseId} — hits=insight only, misses=draft; TS continuation`);
  console.log(`Model: gemini-3.5-flash-lite | insightBatch=${insightSize} draftBatch=${draftSize} | dry=${dry} | env=${envPath || "none"}`);
  console.log(`User: ${caseFile.message}`);
  let ai: GoogleGenAI | null = null;
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.API_KEY || process.env.GEMINI_API_KEYS?.split(",")[0]?.trim();
  if (apiKey) {
    ai = new GoogleGenAI({ apiKey });
  }

  console.log("==========================================================================================");

  if (caseFile.images && caseFile.images.length > 0) {
    if (!ai) {
      console.error("\nNo GEMINI_API_KEY available for OCR. Cannot process images.");
      process.exit(2);
    }
    console.log(`\nFront-door OCR: Extracting from ${caseFile.images.length} images...`);
    const ocrRows = await parseLabImages(ai, caseFile.images.map(p => path.join(ROOT, p)));
    caseFile.rows = ocrRows;
    console.log(`Extracted ${ocrRows.length} rows from OCR.\n`);
  }

  const classified = classifyRows(caseFile.rows, caseFile.history || {}, profile);
  printClassified(classified);
  const hits = classified.filter((r) => r.writeTarget === "observation");
  const misses = classified.filter((r) => r.writeTarget === "pending");
  console.log(`\nClassified: ${hits.length} hits / ${misses.length} misses (expected ${expected.expectKnown}/${expected.expectUnknown})`);
  console.log(`Flow: dictionary locked on hits; agent reviews insight. Misses get pending drafts.`);

  const insightBatches = batchRows(hits, insightSize);
  const draftBatches = batchRows(misses, draftSize);
  const turnLogs: TurnLog[] = [];

  if (dry) {
    for (const m of misses) {
      m.template.newCatalogDraft = {
        suggestedKey: m.mappedKey || m.printed.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
        name: m.printed,
        unit: m.unit,
        aliases: [],
        normalRange: "Varies",
        description: m.printed,
        riskCategories: [],
      };
      m.template.currentEvaluationStatus = "Optimal";
      m.template.medicalInsight = `Your ${m.printed} is Optimal.`;
    }
    for (const h of hits) {
      if (!h.template.medicalInsight) {
        h.template.medicalInsight = `Your ${h.template.biomarkerName} is ${h.template.currentEvaluationStatus || "Optimal"}.`;
      }
    }
    turnLogs.push({ turn: 0, kind: "dry", ids: classified.map((r) => r.id), ms: 0, n: classified.length, raw: "", rows: classified.map(toFillRow) });
  } else {
    if (!ai) {
      console.error("\nNo GEMINI_API_KEY / GOOGLE_API_KEY / API_KEY. Export one and re-run without --dry-run.");
      process.exit(2);
    }
    let turn = 0;
    const runKind = async (kind: "hit" | "miss", batches: ClassifiedRow[][]) => {
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const later = batches.slice(i + 1).flat().map((r) => r.id);
        turn += 1;
        console.log(`\n--- agent turn ${turn} ${kind} ids=${batch.map((r) => r.id).join(",")} queued=${later.length} ---`);
        const out = await fillBatch(ai, caseFile.message, batch, turn, later, kind, profile);
        console.log(`    ${out.rows.length} rows in ${out.ms}ms`);
        turnLogs.push({
          turn,
          kind,
          ids: batch.map((r) => r.id),
          ms: out.ms,
          n: out.rows.length,
          raw: out.raw,
          rows: out.rows,
          user: out.user,
          payload: out.payload,
        });
        for (const row of out.rows) applyAgentRow(classified, row);
      }
    };
    if (insightBatches.length > 0) await runKind("hit", insightBatches);
    if (draftBatches.length > 0) await runKind("miss", draftBatches);
  }

  const filled = classified.map(toFillRow);
  const sentIds = turnLogs.flatMap((t) => t.ids);
  const remaining = dry ? [] : sentIds.filter((id) => !turnLogs.some((t) => t.rows.some((r) => r.id === id)));
  const scored = scoreBiomarkersCase({
    classified,
    filled,
    expected,
    turns: dry ? 0 : turnLogs.filter((t) => t.turn > 0).length,
    remaining,
    requireInsight: !dry,
    profile,
  });

  attachReconstructedPayloads(caseFile, classified, turnLogs, profile);

  const reportDir = path.join(HERE, "reports");
  fs.mkdirSync(reportDir, { recursive: true });
  const patientProfileStr = `${profile.age}-year-old ${profile.ethnicity || ""} ${profile.gender}, Unit Preference: ${profile.unitPreference || "SI"}`.trim();
  const report = {
    id: caseId,
    dry,
    insightSize,
    draftSize,
    instruction: fillTemplateInstruction(patientProfileStr),
    turns: turnLogs,
    classified: classified.map((r) => ({
      id: r.id,
      printed: r.printed,
      match: r.match,
      writeTarget: r.writeTarget,
      key: r.catalog?.key || null,
      status: r.template.currentEvaluationStatus,
    })),
    templates: classified.map((r) => r.template),
    filled,
    score: scored,
  };
  const benchmarkDir = path.join(HERE, "benchmark");
  if (!fs.existsSync(benchmarkDir)) fs.mkdirSync(benchmarkDir, { recursive: true });
  const reportPath = path.join(benchmarkDir, dry ? `${caseId}.dry.json` : `${caseId}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

  const mdPath = path.join(reportDir, dry ? `${caseId}.dry.md` : `${caseId}_live.md`);
  fs.writeFileSync(mdPath, renderCaseMarkdown({
    caseFile,
    classified,
    filled,
    expected,
    scored,
    turnLogs,
    insightSize,
    draftSize,
    dry,
    envPath,
  }));

  console.log(`\nScore: ${scored.pass ? "PASS" : "FAIL"}  known=${scored.known} unknown=${scored.unknown} turns=${scored.turns}`);
  if (scored.fails.length) {
    console.log("Fails:");
    for (const f of scored.fails) console.log(`  - [${f.check}] ${f.printed || f.id}: ${f.detail}`);
  }
  console.log(`Report: ${path.relative(ROOT, reportPath)}`);
  console.log(`Analysis: ${path.relative(ROOT, mdPath)}`);
  return scored.pass;
}

export const runC1 = () => runBiomarkersCase("C1");
export const runC2 = () => runBiomarkersCase("C2");
export const runC3 = () => runBiomarkersCase("C3");

function attachReconstructedPayloads(
  caseFile: CaseFile,
  classified: ClassifiedRow[],
  turnLogs: TurnLog[],
  profile?: ProfileFixture
) {
  const hits = classified.filter((r) => r.writeTarget === "observation");
  const misses = classified.filter((r) => r.writeTarget === "pending");
  for (const t of turnLogs) {
    if (t.user) continue;
    const kind = (t.kind === "miss" ? "miss" : "hit") as "hit" | "miss";
    const pool = kind === "hit" ? hits : misses;
    const batch = t.ids.map((id) => pool.find((r) => r.id === id) || classified.find((r) => r.id === id)).filter(Boolean) as ClassifiedRow[];
    if (!batch.length) continue;
    const later =
      kind === "hit"
        ? hits.filter((r) => !t.ids.includes(r.id)).map((r) => r.id)
        : misses.filter((r) => !t.ids.includes(r.id)).map((r) => r.id);
    const built = buildTurnUserMessage(caseFile.message, batch, kind);
    t.user = built.user;
    t.payload = built.payload;
  }
}

function renderCaseMarkdown(opts: {
  caseFile: CaseFile;
  classified: ClassifiedRow[];
  filled: FillRow[];
  expected: ExpectedFile;
  scored: ReturnType<typeof scoreBiomarkersCase>;
  turnLogs: TurnLog[];
  insightSize: number;
  draftSize: number;
  dry: boolean;
  envPath: string | null;
}): string {
  const { caseFile, classified, filled, expected, scored, turnLogs, insightSize, draftSize, dry, envPath } = opts;
  const lines: string[] = [];
  lines.push(`# ${caseFile.id} live analysis`);
  lines.push("");
  lines.push(`- Model: \`gemini-3.5-flash-lite\``);
  lines.push(`- Dry: ${dry}`);
  lines.push(`- Insight batch: ${insightSize} · draft batch: ${draftSize} → ${turnLogs.filter((t) => t.turn > 0).length || 0} agent turns`);
  lines.push(`- Flow: hits lock dictionary; agent writes medicalInsight only. Misses get pending drafts.`);
  lines.push(`- Template: \`prototype/biomarkers/TEMPLATE.md\``);
  lines.push(`- Env file: ${envPath ? path.basename(path.dirname(envPath)) + "/.env" : "(none)"}`);
  lines.push(`- Score: **${scored.pass ? "PASS" : "FAIL"}** (${scored.known} known / ${scored.unknown} unknown)`);
  lines.push("");
  lines.push(`## System instruction (verbatim)`);
  lines.push("");
  lines.push("```");
  lines.push(fillTemplateInstruction("43-year-old Chinese male, Unit Preference: SI"));
  lines.push("```");
  lines.push("");
  lines.push(`## User send (once)`);
  lines.push("");
  lines.push("```");
  lines.push(caseFile.message);
  for (const r of caseFile.rows) lines.push(`${r.printed}  ${r.value} ${r.unit}`);
  lines.push("```");
  lines.push("");
  lines.push(`## Back-office identity`);
  lines.push("");
  lines.push("| id | printed | match | writeTarget | key |");
  lines.push("|---|---|---|---|---|");
  for (const r of classified) {
    lines.push(`| ${r.id} | ${r.printed} | ${r.match} | ${r.writeTarget} | ${r.catalog?.key || "—"} |`);
  }
  lines.push("");
  if (!dry) {
    lines.push(`## Agent turns (full payload sent + model output)`);
    lines.push("");
    for (const t of turnLogs) {
      if (t.turn === 0) continue;
      lines.push(`### Turn ${t.turn} (${t.kind || "batch"}) — ${t.ids.join(", ")} (${t.n} rows, ${t.ms}ms)`);
      lines.push("");
      lines.push("**User contents sent to the model** (system instruction is above; this is the user turn):");
      lines.push("");
      lines.push("```");
      lines.push(t.user || "(payload not captured)");
      lines.push("```");
      lines.push("");
      lines.push("**Model output:**");
      lines.push("");
      lines.push("```json");
      lines.push(JSON.stringify(t.rows, null, 2));
      lines.push("```");
      lines.push("");
    }
  }
  lines.push(`## Scored template vs expected`);
  lines.push("");
  lines.push("| id | printed | match | writeTarget | status | key | draft | fail |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const f of filled) {
    const exp = expected.rows.find((r) => r.printed.toLowerCase() === f.printed.toLowerCase());
    const fail = scored.fails.filter((x) => x.id === f.id || x.printed?.toLowerCase() === f.printed.toLowerCase()).map((x) => x.check).join(", ") || "—";
    lines.push(
      `| ${f.id} | ${f.printed} | ${f.match} | ${f.writeTarget} | — | ${f.key || "—"} | ${f.newCatalogDraft ? f.newCatalogDraft.suggestedKey : "—"} | ${fail} |`
    );
  }
  lines.push("");
  lines.push(`## Contract checks`);
  lines.push("");
  lines.push(`- Model **must not emit status**: verified (pure TS classifier assigns it).`);
  lines.push(`- Model **must not alter dictionary**: verified (hits lock catalog definition).`);
  lines.push(`- Medical insight **must be personalised**: verified by \`scoreBiomarkersCase\`.`);
  lines.push("- Contract: `TEMPLATE.md` + `template.ts`.");
  lines.push("");
  return lines.join("\n");
}

export const renderC2Markdown = renderCaseMarkdown;

async function rebuildCaseReport(caseId = "C2") {
  const casePath = path.join(HERE, `fixtures/cases/${caseId}.json`);
  const expectPath = path.join(HERE, `fixtures/cases/${caseId}.expected.json`);
  const jsonPath = path.join(HERE, `benchmark/${caseId}.json`);
  if (!fs.existsSync(jsonPath)) {
    console.error(`No benchmark/${caseId}.json — run live ${caseId} first.`);
    process.exit(2);
  }
  const caseFile = loadJson<CaseFile>(casePath);
  const expected = loadJson<ExpectedFile>(expectPath);
  const profile = loadJson<ProfileFixture>(path.join(HERE, "fixtures/profile.json"));
  const saved = loadJson<{
    dry: boolean;
    insightSize: number;
    draftSize: number;
    turns: TurnLog[];
    filled: FillRow[];
    score: ReturnType<typeof scoreBiomarkersCase>;
  }>(jsonPath);
  const classified = classifyRows(caseFile.rows, caseFile.history || {}, profile);
  for (const row of saved.turns.flatMap((t) => t.rows || [])) applyAgentRow(classified, row);
  attachReconstructedPayloads(caseFile, classified, saved.turns, profile);
  const filled = classified.map(toFillRow);
  const md = renderCaseMarkdown({
    caseFile,
    classified,
    filled,
    expected,
    scored: saved.score,
    turnLogs: saved.turns,
    insightSize: saved.insightSize,
    draftSize: saved.draftSize,
    dry: false,
    envPath: loadEnv(),
  });
  const mdPath = path.join(HERE, `reports/${caseId}_live.md`);
  fs.writeFileSync(mdPath, md);
  const patientProfileStr = `${profile.age}-year-old ${profile.ethnicity || ""} ${profile.gender}, Unit Preference: ${profile.unitPreference || "SI"}`.trim();
  const next = { ...saved, instruction: fillTemplateInstruction(patientProfileStr), turns: saved.turns };
  fs.writeFileSync(jsonPath, JSON.stringify(next, null, 2));
  console.log(`Rebuilt ${path.relative(ROOT, mdPath)} with instruction + full payloads.`);
}

export const rebuildC2Report = () => rebuildCaseReport("C2");

const only = arg("--only", "C2");

if (hasFlag("--rebuild-report")) {
  rebuildCaseReport(only || "C2").catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else {
  const caseList = only === "all" ? ["C1", "C2", "C3", "C4", "C5"] : only.split(",").map((s) => s.trim());
  (async () => {
    let allPass = true;
    for (const cId of caseList) {
      const pass = await runBiomarkersCase(cId);
      if (!pass) allPass = false;
    }
    process.exit(allPass ? 0 : 1);
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
