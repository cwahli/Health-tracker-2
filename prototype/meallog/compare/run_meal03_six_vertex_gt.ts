/**
 * Production Mode D Meal_03 six-case bench on Vertex.
 * Scores ONLY against frozen golden/meal/Meal_03_compare targets (not builder narrative).
 * Eval owner = this script + correct_results.md / benchmark_result.md.
 */
import fs from 'fs';
import path from 'path';
import { GoogleGenAI } from '@google/genai';
import {
  scoutOnlyCompareSystemInstruction,
  buildScoutComparePrompt,
  scoutOnlyCompareResponseSchema,
} from './scout_only_compare_instructions';

const project = process.env.GOOGLE_CLOUD_PROJECT || 'test-llm-project-502307';
const location = process.env.GOOGLE_CLOUD_LOCATION || 'global';
const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' || process.env.GOOGLE_GENAI_USE_VERTEXAI === '1';
const MODEL = 'gemini-3.5-flash-lite';

const ai = useVertex
  ? new GoogleGenAI({ vertexai: true, project, location })
  : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '' });

const imagesDir = path.join(process.cwd(), 'golden', 'meal', 'Meal_03_compare');
const OUT_JSON = path.join(process.cwd(), 'prototype', 'meallog', 'compare', 'meal03_six_vertex_gt_results.json');
const OUT_MD = path.join(process.cwd(), 'prototype', 'meallog', 'compare', 'meal03_six_vertex_gt_scorecard.md');

/** Frozen GT from correct_results.md / benchmark_result.md */
const GT: Record<string, { extractTarget: number; recOk: RegExp; label: string }> = {
  set1: { extractTarget: 6, recOk: /polo\s*keju|cheese\s*(polo|bread)|double\s*cheese|say\s*bread/i, label: 'Polo Keju / savory cheese bread (not candy)' },
  set2: { extractTarget: 4, recOk: /blue|green|soft\s*bread|120\s*kcal/i, label: 'Blue or Green bread' },
  set3: { extractTarget: 104, recOk: /kembung|mackerel|sayur\s*asem|tamarind/i, label: 'Kembung OR Sayur Asem' },
  set4: { extractTarget: 32, recOk: /kelapa\s*muda|coconut\s*water/i, label: 'Es Kelapa Muda' },
  set5: { extractTarget: 56, recOk: /garang\s*asem|nila.*broth|tilapia.*tangy|poach/i, label: 'Nila Garang Asem + Nasi' },
  set6: { extractTarget: 17, recOk: /chitato\s*lite|happy\s*tos|tortilla/i, label: 'Chitato Lite OR Happy Tos' },
};

const cases = [
  { id: 'set1', files: ['set1_saybread_bakery_shelf.jpg', 'set1_silverqueen_nutrition_label.jpg', 'set1_silverqueen_chocolate_front.jpg'] },
  { id: 'set2', files: ['set2_snack_green_bar_label.jpg', 'set2_snack_pack_front.jpg', 'set2_snack_yellow_cake_label.jpg', 'set2_snack_blue_bread_label.jpg'] },
  { id: 'set3', files: ['set3_restaurant_menu_page1.jpg', 'set3_restaurant_menu_page2.jpg'] },
  { id: 'set4', files: ['set4_juice_and_beverage_list.jpg'] },
  { id: 'set5', files: ['set5_restaurant_banner_menu.jpg'] },
  { id: 'set6', files: ['set6_supermarket_chip_aisle_shelf.jpg'] },
];

function loadImages(files: string[]) {
  return files.map((f) => {
    const full = path.join(imagesDir, f);
    if (!fs.existsSync(full)) throw new Error('missing ' + full);
    return { inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(full).toString('base64') } };
  });
}

function flattenDishes(parsed: any): string[] {
  const out: string[] = [];
  const push = (x: any) => {
    if (!x) return;
    if (typeof x === 'string') out.push(x);
    else out.push(String(x.name || x.originalName || ''));
  };
  (parsed?.allExtractedDishes || []).forEach(push);
  for (const g of parsed?.groups || []) {
    (g.items || g.allDishes || g.sampleDishes || []).forEach(push);
  }
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
}

function parseJsonLoose(text: string): any {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const s = text.indexOf('{'); const e = text.lastIndexOf('}');
  if (s >= 0 && e > s) { try { return JSON.parse(text.slice(s, e + 1)); } catch {} }
  return { _raw: text.slice(0, 2000) };
}

function kembungInAlertWithOffal(parsed: any): boolean {
  for (const g of parsed?.groups || []) {
    const level = String(g?.verdict?.level || '').toLowerCase();
    const isAlert = level === 'alert' || /tier\s*4|alert/i.test(String(g?.groupName || ''));
    if (!isAlert) continue;
    const items = (g.items || g.allDishes || []).map((x: any) => String(typeof x === 'string' ? x : x?.name || ''));
    const joined = items.join('\n');
    const hasKembung = /kembung|mackerel/i.test(joined);
    const hasOffalSeblak = /offal|usus|ati|jeroan|seblak/i.test(joined);
    if (hasKembung && hasOffalSeblak) return true;
  }
  return false;
}

async function main() {
  console.log('Vertex?', useVertex, project, location, MODEL);
  const only = (process.env.MEAL03_ONLY_SET || '').trim().toLowerCase();
  const selected = only ? cases.filter((c) => c.id === only) : cases;
  if (!selected.length) throw new Error('MEAL03_ONLY_SET matched no cases: ' + only);
  const rows: any[] = [];
  // When re-scoring a subset, preserve prior rows for other sets if results file exists
  let priorById: Record<string, any> = {};
  if (only && fs.existsSync(OUT_JSON)) {
    try {
      const prior = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
      for (const r of prior.rows || []) priorById[r.id] = r;
    } catch {}
  }
  for (const tc of selected) {
    const gt = GT[tc.id];
    console.log('Running', tc.id, '...');
    const t0 = Date.now();
    const imageParts = loadImages(tc.files);
    const userText = buildScoutComparePrompt('', imageParts.length);
    const resp = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: 'user', parts: [...imageParts, { text: userText }] }],
      config: {
        systemInstruction: scoutOnlyCompareSystemInstruction,
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseSchema: scoutOnlyCompareResponseSchema as any,
        maxOutputTokens: 8192,
      },
    });
    const latencyMs = Date.now() - t0;
    const text = (resp as any).text || '';
    const usage = (resp as any).usageMetadata || {};
    const parsed = parseJsonLoose(text);
    const dishes = flattenDishes(parsed);
    const groups = parsed?.groups || [];
    const rec = String(parsed?.recommendedOption || '');
    const bboxOk = groups.filter((g: any) => Array.isArray(g.boundingBox2D) && g.boundingBox2D.length === 4).length;
    const catchAll = groups.some((g: any) => {
      const n = (g.items || g.allDishes || []).length || Number(g.itemCount) || 0;
      return n >= 40;
    });
    const kembungAlertOffal = kembungInAlertWithOffal(parsed);
    const recall = Math.round((1000 * dishes.length) / gt.extractTarget) / 10;
    const recPass = gt.recOk.test(rec);
    const extractPass = dishes.length >= Math.floor(gt.extractTarget * 0.9); // ≥90% of target
    // Set3 clustering quality: fail catch-all ≥40 OR kembung/mackerel in alert with offal/usus/seblak
    const set3ClusterFail = tc.id === 'set3' && (catchAll || kembungAlertOffal);
    const clusterPass = tc.id !== 'set3' || !set3ClusterFail;
    const row = {
      id: tc.id,
      latencyMs,
      usage: { promptTokenCount: usage.promptTokenCount, candidatesTokenCount: usage.candidatesTokenCount },
      extractedCount: dishes.length,
      extractTarget: gt.extractTarget,
      recallVsTargetPct: recall,
      extractPass,
      groupsCount: groups.length,
      groupsWithBBox: bboxOk,
      hasCatchAll40: catchAll,
      kembungInAlertWithOffal: tc.id === 'set3' ? kembungAlertOffal : undefined,
      recommendedOption: rec,
      gtRecLabel: gt.label,
      recPass,
      clusterPass,
      pass: extractPass && recPass && clusterPass,
    };
    console.log(tc.id, row.pass ? 'PASS' : 'FAIL', 'extract', dishes.length, '/', gt.extractTarget, 'rec', recPass, 'catchAll40', catchAll, 'kembungAlertOffal', kembungAlertOffal, rec.slice(0, 80));
    // lightweight per-set dump without huge payload in summary
    fs.writeFileSync(path.join(process.cwd(), 'prototype', 'meallog', 'compare', `live_output_${tc.id}_vertex.json`), JSON.stringify(parsed, null, 2));
    rows.push(row);
  }
  // Merge subset re-run into full six-row scorecard when MEAL03_ONLY_SET is set
  let finalRows = rows;
  if (only) {
    const byId: Record<string, any> = { ...priorById };
    for (const r of rows) byId[r.id] = r;
    finalRows = cases.map((c) => byId[c.id]).filter(Boolean);
  }
  const payload = {
    testDate: new Date().toISOString(),
    method: 'production scout_only_compare (monolith) — kept',
    evalOwner: 'script + frozen golden Meal_03_compare (builder ≠ scorer)',
    model: MODEL,
    vertex: { project, location },
    onlySet: only || null,
    rows: finalRows,
    overallPass: finalRows.length === cases.length && finalRows.every((r) => r.pass),
    passCount: finalRows.filter((r) => r.pass).length,
  };
  const rowsForMd = finalRows;
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));
  const md = [
    `# Meal_03 six-case Vertex GT scorecard — ${payload.testDate}`,
    '',
    `- Method: **production** Mode D monolith (graph not used)`,
    `- Eval owner: frozen GT + this script`,
    `- Overall: **${payload.passCount}/6** pass (extract ≥90% target AND rec matches GT pattern; set3 also requires no catch-all≥40 and no kembung/mackerel in alert with offal/usus/seblak)`,
    payload.onlySet ? `- Partial re-run: **${payload.onlySet}** (other sets preserved from prior scorecard)` : '',
    '',
    '| Set | Extract | Rec vs GT | Catch-all≥40 | Kembung⊗OffalAlert | BBox | Latency | Pass |',
    '|---|---|---|---|---|---|---|---|',
    ...rowsForMd.map((r) => `| ${r.id} | ${r.extractedCount}/${r.extractTarget} (${r.recallVsTargetPct}%) ${r.extractPass ? '✅' : '❌'} | ${r.recPass ? '✅' : '❌'} \`${String(r.recommendedOption).replace(/\|/g, '/').slice(0, 60)}\` | ${r.hasCatchAll40} | ${r.id === 'set3' ? (r.kembungInAlertWithOffal ? 'FAIL' : 'ok') : '—'} | ${r.groupsWithBBox}/${r.groupsCount} | ${r.latencyMs}ms | ${r.pass ? 'PASS' : 'FAIL'} |`),
    '',
    '### Set3 clustering gates',
    '- FAIL if any group has ≥40 items (`hasCatchAll40`).',
    '- FAIL if a dish matching `/kembung|mackerel/i` sits in an alert/Tier4 group that also contains offal/usus/ati/jeroan/seblak.',
    '- Frozen GT rec patterns unchanged (Kembung OR Sayur Asem still accepted).',
    '',
    `Raw: \`${OUT_JSON}\``,
  ].filter((line) => line !== '').join('\n');
  fs.writeFileSync(OUT_MD, md);
  console.log(md);
  if (!payload.overallPass) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
