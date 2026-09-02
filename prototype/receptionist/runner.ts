import fs from "fs";
import os from "os";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI } from "@google/genai";
import { callReceptionistAgent } from "./call_agent.ts";
import { callCoachAgent } from "./coach_agent.ts";
import { callMedicalAgent } from "./medical_agent.ts";
import {
  scoreReceptionistCase,
  scoreCoachOutput,
  scoreMedicalOutput,
} from "./score.ts";
import type { BenchmarkCase, ReceptionistOutput } from "./schema.ts";

const ROOT = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "../.."
);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const BENCHMARK_DIR = path.join(HERE, "benchmark");

function loadEnv(): string | null {
  const candidates = [
    path.join(ROOT, ".env"),
    path.join(process.cwd(), ".env"),
    path.join(os.homedir(), "src/Health-tracker/.env"),
    path.join(os.homedir(), "antigravity/Biomarker-and-Nutrient-Tracker/.env"),
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    dotenv.config({ path: p, override: false });
    if (
      process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.API_KEY
    ) {
      return p;
    }
  }
  dotenv.config({ override: false });
  return null;
}

loadEnv();

function arg(flag: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (
    i >= 0 &&
    process.argv[i + 1] &&
    !process.argv[i + 1].startsWith("-")
  ) {
    return process.argv[i + 1];
  }
  return fallback;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function loadBenchmarkCase(caseId: string): BenchmarkCase {
  const file = path.join(BENCHMARK_DIR, `${caseId}.json`);
  if (!fs.existsSync(file)) {
    throw new Error(`Benchmark file not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, "utf8")) as BenchmarkCase;
}

export async function runCase(
  caseId: string,
  options: {
    dryRun?: boolean;
    model?: string;
  } = {}
) {
  const benchmark = loadBenchmarkCase(caseId);
  console.log(`\n======================================================`);
  console.log(`RUNNING BENCHMARK: [${benchmark.id}] ${benchmark.title}`);
  console.log(`Description: ${benchmark.description}`);
  console.log(`======================================================\n`);

  const apiKey =
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.API_KEY;
  if (!apiKey && !options.dryRun) {
    throw new Error(
      "Missing GEMINI_API_KEY / GOOGLE_API_KEY in environment or .env"
    );
  }
  const ai = !options.dryRun ? new GoogleGenAI({ apiKey: apiKey! }) : null;
  const model = options.model || "gemini-3.5-flash-lite";

  // Check if case defines multi-turn steps
  const turns = benchmark.turns && benchmark.turns.length > 0
    ? benchmark.turns
    : [
        {
          turnIndex: 1,
          userMessage: benchmark.userPayload.jsonPayload.currentUserMessage,
          expectedOutput: benchmark.expectedOutput,
        },
      ];

  let currentMemory: any = benchmark.userPayload.jsonPayload.existingMemory || null;
  const chatHistory: any[] = [...(benchmark.userPayload.jsonPayload.chatHistory || [])];
  const turnScores: any[] = [];
  let totalDurationMs = 0;
  let lastOutput: ReceptionistOutput | null = null;

  for (const turn of turns) {
    console.log(`\n------------------------------------------------------`);
    console.log(`>>> TURN ${turn.turnIndex}: User sends: "${turn.userMessage}"`);
    console.log(`------------------------------------------------------`);

    // Ensure chatHistory has the current user message
    if (
      chatHistory.length === 0 ||
      chatHistory[chatHistory.length - 1].content !== turn.userMessage ||
      chatHistory[chatHistory.length - 1].role !== "user"
    ) {
      chatHistory.push({ role: "user", content: turn.userMessage });
    }

    const payload: any = {
      currentUserMessage: turn.userMessage,
      chatHistory,
      existingUserProfile: benchmark.userPayload.jsonPayload.existingUserProfile || null,
      existingMemory: currentMemory,
      existingActivitiesAndTasks:
        benchmark.userPayload.jsonPayload.existingActivitiesAndTasks || null,
    };

    let output: ReceptionistOutput;
    let turnMs = 0;

    if (options.dryRun) {
      console.log(`[DRY RUN] Using reference turn output...`);
      output = (benchmark as any).agentOutput;
    } else {
      console.log(`[LIVE RUN] Calling model: ${model} ...`);
      const result = await callReceptionistAgent(ai!, payload, model);
      output = result.output;
      turnMs = result.ms;
      totalDurationMs += turnMs;
      console.log(`[LIVE RUN] Completed Turn ${turn.turnIndex} in ${turnMs}ms`);
    }

    lastOutput = output;
    currentMemory = output.memory;
    chatHistory.push({ role: "assistant", content: output.userResponse });

    console.log(`\n--- RECEPTIONIST OUTPUT (Turn ${turn.turnIndex}) ---`);
    console.log(`Intent:       ${output.intent}`);
    console.log(`Target Agent: ${output.targetAgent}`);
    console.log(`Status:       ${output.status}`);
    console.log(
      `Missing:      ${(output.missingFields || []).join(", ") || "(none)"}`
    );
    if (output.isDisambiguationRequired) {
      console.log(`Disambiguate: REQUIRED -> ${output.disambiguationContext}`);
    }
    if (output.uiForm) {
      console.log(`\n--- ISSUED UI FORM WIDGET: [${output.uiForm.title}] ---`);
      console.log(JSON.stringify(output.uiForm, null, 2));
    }
    console.log(`\n--- MEMORY STATE (Turn ${turn.turnIndex}) ---`);
    console.log(JSON.stringify(output.memory, null, 2));

    console.log(`\n--- USER CONVERSATION RESPONSE (Turn ${turn.turnIndex}) ---`);
    console.log(output.userResponse);

    if (output.handoffPayload) {
      console.log(`\n--- HANDOFF PAYLOAD (${output.handoffPayload.targetAgent}) ---`);
      console.log(JSON.stringify(output.handoffPayload, null, 2));
    } else {
      console.log(`\n--- HANDOFF PAYLOAD ---`);
      console.log(`(null - withheld pending required information)`);
    }

    // Score this turn
    const turnBenchmarkMock: any = {
      id: `${benchmark.id}-Turn${turn.turnIndex}`,
      expectedOutput: turn.expectedOutput,
    };
    const scoreResult = scoreReceptionistCase(turnBenchmarkMock, output);
    turnScores.push(scoreResult);

    console.log(`\n--- TURN ${turn.turnIndex} EVALUATION SCORE ---`);
    console.log(
      `Turn Result: ${scoreResult.passed ? "PASSED" : "FAILED"} (${scoreResult.score}/100)`
    );
    for (const c of scoreResult.checks) {
      console.log(
        `  [${c.passed ? "PASS" : "FAIL"}] ${c.name.padEnd(36)} -> ${c.details}`
      );
    }
  }

  let coachOutput: any = null;
  let coachScoreResult: any = null;

  // If receptionist handed off to Health Coach, run the Health Coach Agent!
  if (
    lastOutput &&
    lastOutput.status === "ready_for_handoff" &&
    lastOutput.handoffPayload &&
    (lastOutput.handoffPayload.targetAgent === "health_coach" ||
      lastOutput.handoffPayload.targetAgent === "coach")
  ) {
    console.log(`\n======================================================`);
    console.log(`>>> DOWNSTREAM AGENT EXECUTION: [HEALTH COACH AGENT]`);
    console.log(`======================================================`);

    if (options.dryRun) {
      console.log(`[DRY RUN] Skipping live coach invocation...`);
    } else {
      console.log(`[LIVE RUN] Calling Coach Agent (${model}) with handoff payload...`);
      const payloadWithProfile = {
        ...lastOutput.handoffPayload,
        consolidatedUserProfile: lastOutput.memory.userProfileSnapshot,
      };
      const coachResult = await callCoachAgent(ai!, payloadWithProfile as any, model);
      coachOutput = coachResult.output;
      totalDurationMs += coachResult.ms;
      console.log(`[LIVE RUN] Coach completed in ${coachResult.ms}ms`);

      console.log(`\n--- HEALTH COACH REPORT: TIMELINE TO OPTIMAL ---`);
      console.log(coachOutput?.report?.timelineToOptimal);

      console.log(`\n--- HEALTH COACH REPORT: TOP NUTRIENT TARGETS ---`);
      console.log(JSON.stringify(coachOutput?.report?.topNutrientTargets, null, 2));

      console.log(`\n--- HEALTH COACH REPORT: RISK CATEGORIES & ACTIVITIES ---`);
      console.log(JSON.stringify(coachOutput?.report?.riskCategories, null, 2));

      console.log(`\n--- HEALTH COACH REPORT: GENERAL NUTRIENT TARGETS (31 KEYS) ---`);
      console.log(JSON.stringify(coachOutput?.report?.generalNutrientTargets, null, 2));

      // Score Coach Output
      coachScoreResult = scoreCoachOutput(coachOutput);
      turnScores.push(coachScoreResult);

      console.log(`\n--- COACH AGENT EVALUATION SCORE ---`);
      console.log(
        `Coach Result: ${coachScoreResult.passed ? "PASSED" : "FAILED"} (${coachScoreResult.score}/100)`
      );
      for (const c of coachScoreResult.checks) {
        console.log(
          `  [${c.passed ? "PASS" : "FAIL"}] ${c.name.padEnd(36)} -> ${c.details}`
        );
      }
    }
  }

  // If receptionist handed off to Medical / Lab Parser Agent, run the Medical Agent!
  if (
    lastOutput &&
    lastOutput.status === "ready_for_handoff" &&
    lastOutput.handoffPayload &&
    (lastOutput.handoffPayload.targetAgent === "medical" ||
      lastOutput.handoffPayload.targetAgent === "biomarker_specialist" ||
      lastOutput.handoffPayload.targetAgent === "biomarker_review")
  ) {
    console.log(`\n======================================================`);
    console.log(`>>> DOWNSTREAM AGENT EXECUTION: [MEDICAL LAB PARSER AGENT]`);
    console.log(`======================================================`);

    if (options.dryRun) {
      console.log(`[DRY RUN] Skipping live medical invocation...`);
    } else {
      console.log(`[LIVE RUN] Calling Medical Agent (${model}) with handoff payload...`);
      const medResult = await callMedicalAgent(ai!, lastOutput.handoffPayload, model);
      totalDurationMs += medResult.ms;
      console.log(`[LIVE RUN] Medical Parser completed in ${medResult.ms}ms`);

      console.log(`\n--- EXTRACTED BIOMARKERS DATA (${medResult.output.extractedData.length} items) ---`);
      console.log(JSON.stringify(medResult.output.extractedData, null, 2));

      console.log(`\n--- MEDICAL AGENT CLINICAL GUIDANCE ---`);
      console.log(medResult.output.text);

      const medScoreResult = scoreMedicalOutput(medResult.output);
      turnScores.push(medScoreResult);

      console.log(`\n--- MEDICAL AGENT EVALUATION SCORE ---`);
      console.log(
        `Medical Result: ${medScoreResult.passed ? "PASSED" : "FAILED"} (${medScoreResult.score}/100)`
      );
      for (const c of medScoreResult.checks) {
        console.log(
          `  [${c.passed ? "PASS" : "FAIL"}] ${c.name.padEnd(36)} -> ${c.details}`
        );
      }
    }
  }

  const allPassed = turnScores.every((t) => t.passed);
  const avgScore = Math.round(
    turnScores.reduce((acc, t) => acc + t.score, 0) / turnScores.length
  );

  return {
    benchmark,
    output: lastOutput!,
    coachOutput,
    turnScores,
    scoreResult: { passed: allPassed, score: avgScore, checks: turnScores },
    durationMs: totalDurationMs,
  };
}

async function main() {
  const caseArg = arg("--case", "C1")!;
  const modelArg = arg("--model", "gemini-3.5-flash-lite");
  const dry = hasFlag("--dry");

  const casesToRun =
    caseArg === "all" || hasFlag("--all") ? ["C1", "C2", "C3"] : [caseArg];

  console.log(`Starting Receptionist Benchmark Runner`);
  console.log(`Cases: ${casesToRun.join(", ")}, Dry: ${dry}, Model: ${modelArg}`);

  const results: any[] = [];
  for (let i = 0; i < casesToRun.length; i++) {
    const id = casesToRun[i];
    if (i > 0 && !dry) {
      console.log(`[Rate pacing] Waiting 2s before next case...`);
      await new Promise((r) => setTimeout(r, 2000));
    }
    const res = await runCase(id, { dryRun: dry, model: modelArg });
    results.push(res);
  }

  console.log(`\n======================================================`);
  console.log(`SUMMARY OF ALL RUNS:`);
  for (const r of results) {
    console.log(
      `  Case ${r.benchmark.id.padEnd(4)}: ${r.scoreResult.passed ? "PASSED" : "FAILED"} (${r.scoreResult.score}/100) ${r.durationMs ? `in ${r.durationMs}ms` : ""}`
    );
  }
  console.log(`======================================================\n`);
}

if (process.argv[1] && process.argv[1].endsWith("runner.ts")) {
  main().catch((err) => {
    console.error("Runner failed:", err);
    process.exit(1);
  });
}
