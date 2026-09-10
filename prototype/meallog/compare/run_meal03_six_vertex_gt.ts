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

async function main() {
  console.log('Vertex?', useVertex, project, location, MODEL);
  const rows: any[] = [];
  for (const tc of cases) {
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
    const recall = Math.round((1000 * dishes.length) / gt.extractTarget) / 10;
    const recPass = gt.recOk.test(rec);
    const extractPass = dishes.length >= Math.floor(gt.extractTarget * 0.9); // ≥90% of target
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
      recommendedOption: rec,
      gtRecLabel: gt.label,
      recPass,
      pass: extractPass && recPass,
    };
    console.log(tc.id, row.pass ? 'PASS' : 'FAIL', 'extract', dishes.length, '/', gt.extractTarget, 'rec', recPass, rec.slice(0, 80));
    // lightweight per-set dump without huge payload in summary
    fs.writeFileSync(path.join(process.cwd(), 'prototype', 'meallog', 'compare', `live_output_${tc.id}_vertex.json`), JSON.stringify(parsed, null, 2));
    rows.push(row);
  }
  const payload = {
    testDate: new Date().toISOString(),
    method: 'production scout_only_compare (monolith) — kept',
    evalOwner: 'script + frozen golden Meal_03_compare (builder ≠ scorer)',
    model: MODEL,
    vertex: { project, location },
    rows,
    overallPass: rows.every((r) => r.pass),
    passCount: rows.filter((r) => r.pass).length,
  };
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2));
  const md = [
    `# Meal_03 six-case Vertex GT scorecard — ${payload.testDate}`,
    '',
    `- Method: **production** Mode D monolith (graph not used)`,
    `- Eval owner: frozen GT + this script`,
    `- Overall: **${payload.passCount}/6** pass (extract ≥90% target AND rec matches GT pattern)`,
    '',
    '| Set | Extract | Rec vs GT | Catch-all≥40 | BBox | Latency | Pass |',
    '|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.id} | ${r.extractedCount}/${r.extractTarget} (${r.recallVsTargetPct}%) ${r.extractPass ? '✅' : '❌'} | ${r.recPass ? '✅' : '❌'} \`${String(r.recommendedOption).replace(/\|/g, '/').slice(0, 60)}\` | ${r.hasCatchAll40} | ${r.groupsWithBBox}/${r.groupsCount} | ${r.latencyMs}ms | ${r.pass ? 'PASS' : 'FAIL'} |`),
    '',
    `Raw: \`${OUT_JSON}\``,
  ].join('\n');
  fs.writeFileSync(OUT_MD, md);
  console.log(md);
  if (!payload.overallPass) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
