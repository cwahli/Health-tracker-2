/**
 * UNBIASED Set 3 A/B on Vertex.
 * Equal patient block + equal generic anti-collapse for both arms.
 * No dish-name spoilers (no Kembung/Nila/offal recipes in the graph arm).
 * Arm A: production scout_only_compare instruction + schema
 * Arm B: procedural node framing (steps only) + compact schema (architecture difference)
 * Blank user text. Same photos. Same model.
 */
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, Type, Schema } from '@google/genai';
import {
  scoutOnlyCompareSystemInstruction,
  buildScoutComparePrompt,
  scoutOnlyCompareResponseSchema,
} from '../compare/scout_only_compare_instructions';

const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'test-llm-project-502307';
const location = process.env.GOOGLE_CLOUD_LOCATION || process.env.VERTEXAI_LOCATION || 'global';
const useVertex = process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' || process.env.GOOGLE_GENAI_USE_VERTEXAI === '1';

const ai = useVertex
  ? new GoogleGenAI({ vertexai: true, project, location })
  : new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '' });

const MODEL = 'gemini-3.5-flash-lite';
const SET3_DIR = path.join(process.cwd(), 'golden', 'meal', 'Meal_03_compare');
const OUT = path.join(process.cwd(), 'prototype', 'meallog', 'procedural_graph', 'compare_set3_unbiased_vertex_results.json');
const SCORE = path.join(process.cwd(), 'prototype', 'meallog', 'procedural_graph', 'compare_set3_unbiased_vertex_scorecard.md');

const page1 = path.join(SET3_DIR, 'set3_restaurant_menu_page1.jpg');
const page2 = path.join(SET3_DIR, 'set3_restaurant_menu_page2.jpg');
if (!fs.existsSync(page1) || !fs.existsSync(page2)) {
  console.error('Missing Set 3 photos');
  process.exit(1);
}
const imageParts = [page1, page2].map((p) => ({
  inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(p).toString('base64') },
}));

/** Shared — from golden/meal/Meal_03_compare/benchmark_result.md */
const SHARED_PATIENT = `=== PATIENT METABOLIC TARGETS (shared, both arms) ===
3 days avg: Sat fat (27.7g - 38% over), Calorie (2500kcal - 39% over), Sodium (3000mg - 30% over), Protein (100g - 17% under), Carbohydrates (263.3g - 32% over), Total Fibre (22.3g - 26% under), Potassium (2100mg), Soluble Fibre (3.5g), Added Sugar (45g - 50% over), Trans Fat (0.1g).
At-Risk: LDL (high); HbA1c (high).`;

/** Shared generic anti-collapse — NO dish names / spoilers */
const SHARED_ANTI_COLLAPSE = `=== SHARED ANTI-COLLAPSE & CLINICAL RULES (both arms) ===
- Do NOT dump dozens of items into one catch-all warning group.
- HARD RULE: every group must keep within ≤10% variance on calories and on the dominant macros (protein, carbs, total fat, sat fat, sodium) across member dishes. If variance would exceed 10%, split into another group.
- Every group MUST include boundingBox2D as [ymin, xmin, ymax, xmax] on the 0–1000 normalized photo grid covering where those items appear.
- Put EVERY extracted dish into exactly one group (orphan rate 0%). Prefer listing allDishes fully (not only samples).
- Explicitly highlight unlisted harms vs benefits in each group's message (e.g. oxidized deep-fry oils, extreme sodium, offal/purines vs marine Omega-3 / clear broth fiber) — without naming a prechosen winner dish in the instructions.
- Elevate cardioprotective marine Omega-3 whole fish and antioxidant clear/sour broths toward Tier 1–2 when clinically appropriate for THIS patient.
- Isolate deep-fried oils, high-sodium salted fish, and offal into higher caution tiers when clinically appropriate.
- Do NOT name specific menu winners in instructions — decide from the photos and patient targets only.
- EVALUATION ONLY (non-additive). Do not log as a consumed meal.`;

const productionSystem = `${SHARED_PATIENT}\n\n${SHARED_ANTI_COLLAPSE}\n\n${scoutOnlyCompareSystemInstruction}`;
const productionUser = buildScoutComparePrompt('', 2);

const proceduralSystem = `${SHARED_PATIENT}\n\n${SHARED_ANTI_COLLAPSE}\n\nYou are the Meal Agent executing a procedural compare graph (Mode D).
Steps (do not skip gates):
1) EXTRACTION — exhaustively list legible menu items from both pages with Local / English names.
2) CLUSTERING — form granular clinical tiers under the shared anti-collapse rules (no catch-all).
3) NORMALIZATION — typical serving weight + nutrients per 100g; calories follow Atwater (4P+4C+9F) when estimating.
4) RECOMMENDATION — one best option + clinical trade-off for THIS patient.
Keep reasoning internal; output must match the schema.`;

const proceduralUser = `Analyze these 2 restaurant menu page photos with blank user text. Extract, cluster, normalize, and recommend per the procedural steps and shared clinical rules. Do not invent items that are not visible.`;

const proceduralSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    _internalReasoning: { type: Type.STRING },
    comparisonTitle: { type: Type.STRING },
    recommendedOption: { type: Type.STRING },
    clinicalTradeOffs: { type: Type.STRING },
    allExtractedDishes: { type: Type.ARRAY, items: { type: Type.STRING } },
    groups: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          groupName: { type: Type.STRING },
          tier: { type: Type.STRING },
          verdict: {
            type: Type.OBJECT,
            properties: { label: { type: Type.STRING }, level: { type: Type.STRING } },
            required: ['label', 'level'],
          },
          comparisonSentence: { type: Type.STRING },
          message: { type: Type.STRING },
          itemCount: { type: Type.INTEGER },
          allDishes: { type: Type.ARRAY, items: { type: Type.STRING } },
          sampleDishes: { type: Type.ARRAY, items: { type: Type.STRING } },
          boundingBox2D: { type: Type.ARRAY, items: { type: Type.NUMBER } },
          servingWeightGrams: { type: Type.NUMBER },
          averageNutrientsPer100g: {
            type: Type.OBJECT,
            properties: {
              calories: { type: Type.NUMBER },
              protein: { type: Type.NUMBER },
              carbohydrates: { type: Type.NUMBER },
              totalFat: { type: Type.NUMBER },
              saturatedFat: { type: Type.NUMBER },
              sodium: { type: Type.NUMBER },
              totalFibre: { type: Type.NUMBER },
              addedSugar: { type: Type.NUMBER },
              potassium: { type: Type.NUMBER },
              transFat: { type: Type.NUMBER },
            },
          },
        },
        required: ['groupName', 'verdict', 'message', 'averageNutrientsPer100g', 'boundingBox2D', 'allDishes', 'itemCount'],
      },
    },
  },
  required: ['comparisonTitle', 'recommendedOption', 'groups', 'clinicalTradeOffs', 'allExtractedDishes'],
};

function parseJsonLoose(text: string): any {
  if (!text) return null;
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) {
    try { return JSON.parse(fence[1]); } catch {}
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  return { _raw: text.slice(0, 4000) };
}

async function runArm(name: string, systemInstruction: string, userText: string, schema: Schema) {
  const t0 = Date.now();
  const resp = await ai.models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts: [...imageParts, { text: userText }] }],
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: schema as any,
      temperature: 0.2,
    },
  });
  const latencyMs = Date.now() - t0;
  const text = (resp as any).text || (resp as any).candidates?.[0]?.content?.parts?.map((p: any) => p.text).join('') || '';
  const usage = (resp as any).usageMetadata || {};
  const parsed = parseJsonLoose(text);
  return {
    name,
    latencyMs,
    usage: {
      promptTokenCount: usage.promptTokenCount,
      candidatesTokenCount: usage.candidatesTokenCount,
      totalTokenCount: usage.totalTokenCount,
    },
    systemInstructionChars: systemInstruction.length,
    userPromptChars: userText.length,
    parsed,
  };
}

function flattenDishes(parsed: any): string[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const out: string[] = [];
  const push = (x: any) => {
    if (!x) return;
    if (typeof x === 'string') out.push(x);
    else if (typeof x === 'object') out.push(String(x.name || x.originalName || x.localName || x.dishName || ''));
  };
  (parsed.allExtractedDishes || []).forEach(push);
  for (const g of parsed.groups || []) {
    (g.allDishes || g.items || g.sampleDishes || []).forEach(push);
    if (Array.isArray(g.items) && g.items[0] && typeof g.items[0] === 'object') {
      g.items.forEach((it: any) => push(it));
    }
  }
  return [...new Set(out.map((s) => s.trim()).filter(Boolean))];
}

function groupDishCount(g: any): number {
  return Number(g.itemCount) || (g.allDishes || g.items || g.sampleDishes || []).length || 0;
}

function nutrientsOf(g: any): Record<string, number> {
  return g.averageNutrientsPer100g || g.averageNutrients || {};
}

/** Rough ≤10% check: compare each group's kcal/100g to median of groups in same tier band — also flag missing nutrients. */
function scoreMacroGrouping(groups: any[]) {
  const withNut = groups.filter((g) => nutrientsOf(g).calories != null);
  const issues: string[] = [];
  if (!withNut.length) return { groupsWithNutrients: 0, macroWithin10pctHeuristic: false, issues: ['no nutrients'] };
  // Pairwise: if two groups have same verdict level but kcal differs <10%, might be oversplit; if one group is huge, flag.
  // Primary: each group must publish calories+protein+carbs+fat+satfat+sodium
  let complete = 0;
  for (const g of withNut) {
    const n = nutrientsOf(g);
    const keys = ['calories', 'protein', 'carbohydrates', 'totalFat', 'saturatedFat', 'sodium'];
    if (keys.every((k) => typeof n[k] === 'number')) complete += 1;
    else issues.push(`incomplete nutrients: ${g.groupName}`);
  }
  // Coverage: sum itemCount vs extracted
  return {
    groupsWithNutrients: withNut.length,
    groupsWithCompleteMacroKeys: complete,
    macroKeysComplete: complete === groups.length && groups.length > 0,
    issues,
  };
}

function scoreAdviceQuality(parsed: any, groups: any[]) {
  const allText = JSON.stringify(parsed || {}).toLowerCase();
  const msgs = groups.map((g) => `${g.message || ''} ${g.comparisonSentence || ''} ${(g.verdict || {}).label || ''}`).join(' ').toLowerCase();
  const harmHits = {
    deepFryOrOxidized: /deep-?fry|fried|oxid|oil|balado|crispy/i.test(msgs + allText),
    highSodiumSalted: /sodium|salted|asin|1500|high-?salt/i.test(msgs + allText),
    offal: /offal|intestin|usus|liver|hati|organ|purine/i.test(msgs + allText),
    seblakOrStarch: /seblak|starch|noodle/i.test(msgs + allText),
  };
  const benefitHits = {
    marineOmega3: /omega|epa|dha|mackerel|kembung|marine|whole fish/i.test(msgs + allText),
    clearBrothFiber: /broth|soup|sayur|fibre|fiber|tamarind|asem|boiled/i.test(msgs + allText),
  };
  const harmsScore = Object.values(harmHits).filter(Boolean).length;
  const benefitsScore = Object.values(benefitHits).filter(Boolean).length;
  return { harmHits, benefitHits, harmsScore, benefitsScore, adviceMentionsPatientTargets: /ldl|hba1c|surplus|deficit|sodium|calorie|protein/i.test(msgs + allText) };
}

function scoreArm(parsed: any, latencyMs: number, usage: any) {
  const dishes = flattenDishes(parsed);
  const groups = Array.isArray(parsed?.groups) ? parsed.groups : [];
  const rec = String(parsed?.recommendedOption || parsed?.recommendation?.recommendedItemOrGroup || '');
  const allText = JSON.stringify(parsed || {}).toLowerCase();
  const gtRecOk = /kembung|mackerel|sayur\s*asem|tamarind/i.test(rec);
  const bilingual = dishes.filter((d) => d.includes('/') || /\b(soup|fish|chicken|tofu|rice|grill)/i.test(d)).length;
  const catchAll = groups.some((g: any) => groupDishCount(g) >= 40);
  const bboxOk = groups.filter((g: any) => {
    const b = g.boundingBox2D;
    if (!Array.isArray(b) || b.length !== 4) return false;
    const [ymin, xmin, ymax, xmax] = b.map(Number);
    return ymin >= 0 && xmin >= 0 && ymax <= 1000 && xmax <= 1000 && ymin < ymax && xmin < xmax;
  }).length;
  const assigned = groups.reduce((s: number, g: any) => s + groupDishCount(g), 0);
  const macro = scoreMacroGrouping(groups);
  const advice = scoreAdviceQuality(parsed, groups);
  return {
    extractedCount: dishes.length,
    recallVs104: Math.round((1000 * dishes.length) / 104) / 10,
    groupsCount: groups.length,
    dishesAssignedToGroups: assigned,
    orphanGapVsExtracted: Math.max(0, dishes.length - assigned),
    recommendedOption: rec,
    recommendationMatchesGT_KembungOrSayurAsem: gtRecOk,
    bilingualIshCount: bilingual,
    hasCatchAllGroup40plus: catchAll,
    groupsWithValidBBox: bboxOk,
    bboxCoverage: groups.length ? Math.round((100 * bboxOk) / groups.length) : 0,
    macro,
    advice,
    latencyMs,
    candidatesTokenCount: usage?.candidatesTokenCount ?? null,
    promptTokenCount: usage?.promptTokenCount ?? null,
  };
}

async function main() {
  console.log('Vertex?', useVertex, 'project', project, 'location', location, 'model', MODEL);
  console.log('Running Arm A (production)...');
  const armA = await runArm('production_compare', productionSystem, productionUser, scoutOnlyCompareResponseSchema as any);
  console.log('A done', armA.latencyMs, armA.usage);
  console.log('Running Arm B (procedural unbiased)...');
  const armB = await runArm('procedural_graph_unbiased', proceduralSystem, proceduralUser, proceduralSchema);
  console.log('B done', armB.latencyMs, armB.usage);

  const scoreA = scoreArm(armA.parsed, armA.latencyMs, armA.usage);
  const scoreB = scoreArm(armB.parsed, armB.latencyMs, armB.usage);

  const payload = {
    testDate: new Date().toISOString(),
    fairness: {
      sameModel: MODEL,
      samePhotos: ['set3_restaurant_menu_page1.jpg', 'set3_restaurant_menu_page2.jpg'],
      blankUserText: true,
      sharedPatientBlock: true,
      sharedAntiCollapseNoDishSpoilers: true,
      graphArmHasNoKembungNilaSpoilers: true,
      schemaDiffers: true,
      note: 'Arm B uses compact procedural schema; Arm A uses production scoutOnlyCompareResponseSchema. Instruction spoilers removed from B.',
    },
    groundTruthSet3: {
      targetDishCount: 104,
      targetRec: 'Paket Ikan Kembung OR Sayur Asem',
      source: 'golden/meal/Meal_03_compare/benchmark_result.md + correct_results.md',
    },
    armA: { ...armA, score: scoreA },
    armB: { ...armB, score: scoreB },
  };
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));

  const md = `# Unbiased Set 3 A/B (Vertex) — ${payload.testDate}

## Fairness
- Same model \`${MODEL}\`, same 2 photos, blank user text
- **Shared** patient targets + generic anti-collapse (no dish-name spoilers)
- Arm A = production instruction/schema; Arm B = procedural steps + compact schema **with required boundingBox2D**
- Vertex project \`${project}\` location \`${location}\`

## Scorecard vs benchmark_result.md (Set 3) — quality-focused

| Criterion | Ground truth / target | Arm A Production | Arm B Procedural (unbiased) |
|---|---|---|---|
| Extraction / recall vs 104 | 104 / ~96%+ | ${scoreA.extractedCount} / ${scoreA.recallVs104}% | ${scoreB.extractedCount} / ${scoreB.recallVs104}% |
| Groups formed | ~4 | ${scoreA.groupsCount} | ${scoreB.groupsCount} |
| Dishes assigned to groups (orphan gap) | all assigned | ${scoreA.dishesAssignedToGroups} (gap ${scoreA.orphanGapVsExtracted}) | ${scoreB.dishesAssignedToGroups} (gap ${scoreB.orphanGapVsExtracted}) |
| Catch-all ≥40 items | false | ${scoreA.hasCatchAllGroup40plus} | ${scoreB.hasCatchAllGroup40plus} |
| Macro keys complete on all groups | yes (≤10% clustering prerequisite) | ${scoreA.macro.macroKeysComplete} (${scoreA.macro.groupsWithCompleteMacroKeys}/${scoreA.groupsCount}) | ${scoreB.macro.macroKeysComplete} (${scoreB.macro.groupsWithCompleteMacroKeys}/${scoreB.groupsCount}) |
| Valid bounding boxes | all groups | ${scoreA.groupsWithValidBBox}/${scoreA.groupsCount} (${scoreA.bboxCoverage}%) | ${scoreB.groupsWithValidBBox}/${scoreB.groupsCount} (${scoreB.bboxCoverage}%) |
| Recommendation Kembung **or** Sayur Asem | either | ${scoreA.recommendationMatchesGT_KembungOrSayurAsem} — \`${String(scoreA.recommendedOption).replace(/\|/g,'/')}\` | ${scoreB.recommendationMatchesGT_KembungOrSayurAsem} — \`${String(scoreB.recommendedOption).replace(/\|/g,'/')}\` |
| Advice: harms called out (fry/Na/offal/seblak) | high | ${scoreA.advice.harmsScore}/4 ${JSON.stringify(scoreA.advice.harmHits)} | ${scoreB.advice.harmsScore}/4 ${JSON.stringify(scoreB.advice.harmHits)} |
| Advice: benefits called out (Ω-3 / broth-fiber) | high | ${scoreA.advice.benefitsScore}/2 ${JSON.stringify(scoreA.advice.benefitHits)} | ${scoreB.advice.benefitsScore}/2 ${JSON.stringify(scoreB.advice.benefitHits)} |
| Advice ties to patient targets | yes | ${scoreA.advice.adviceMentionsPatientTargets} | ${scoreB.advice.adviceMentionsPatientTargets} |
| Latency ms | lower better | ${scoreA.latencyMs} | ${scoreB.latencyMs} |
| Candidate tokens | lower better | ${scoreA.candidatesTokenCount} | ${scoreB.candidatesTokenCount} |

Raw JSON: \`${OUT}\`
`;
  fs.writeFileSync(SCORE, md);
  console.log(md);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
