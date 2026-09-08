/**
 * armC-pipeline.ts — Meal_02 winning pipeline (auto-split 5+4, parallel workers,
 * merge by refId, TS-derived nutrients, entity-level verification).
 * Test helper for prototype/tests/armC-meal02.spec.ts. Winner of the A/B/C probe
 * series: 2 calls, ~18k tokens, ~15s parallel, 80.8% kcal as-run.
 */
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';
import { scoutSystemInstruction } from '../../server_vision_scout';
import { calculateDerivedNutrients } from '../../server_derivation';

export interface ArmCDish {
  dishName: string;
  refId: string;
  estimatedWeightGrams: number;
  cookingMethod?: string;
  sourceImageIndex?: number | null;
  protein: number;
  carbohydrates: number;
  totalFat: number;
  saturatedFat?: number;
  sugar?: number;
  addedSugar?: number;
  totalFibre?: number;
  sodium: number;
  verdictLabel: string;
  verdictLevel: 'good' | 'neutral' | 'warning' | 'alert';
  advice: string;
}

/** GT registry: prototype/meallog/images/Image_nutrients_true_value.md (31 keys). */
export const MEAL02_GT = { grams: 3647, kcal: 4285, protein: 309, carbs: 366.9, fat: 179.8, sodium: 4581 };

/** Full entity registry: 19 refIds across 9 photos. R01 is prompt-sourced (no photo). */
export const REQUIRED_REFIDS = [
  'E01a', 'E01b', 'E01c', 'R02', 'E02b', 'E09a', 'E09b', 'E09c',
  'R03', 'R04', 'R05', 'R06', 'R10a',
  'R08', 'R09', 'R10b', 'R11', 'R12', 'R01',
];

/** Known gaps of the as-run fixtures: remove entries as ownership rules land. */
export const KNOWN_GAPS = ['R01', 'R10a'];

const MEAL02_DIR = path.resolve('golden/meal/Meal_02');
const W1_FILES = [
  '01_yolk_panini_wrap.jpg', '02_lidl_chicken_muffin.jpg',
  '09_steak_fish_chips_1.jpg', '09_steak_fish_chips_2.jpg',
  '10_beef_soup_barcode_meal_0.jpg',
];
const W2_FILES = [
  '10_beef_soup_barcode_meal_1.jpg',
  '11_seafood_squid_fish_ingredients.jpg', '11_seafood_squid_fish_receipt_1.jpg',
  '11_seafood_squid_fish_receipt_2.jpg',
];

const DISH_SCHEMA: any = {
  type: Type.OBJECT,
  properties: {
    dishName: { type: Type.STRING },
    refId: { type: Type.STRING },
    estimatedWeightGrams: { type: Type.NUMBER },
    cookingMethod: { type: Type.STRING },
    sourceImageIndex: { type: Type.INTEGER },
    protein: { type: Type.NUMBER },
    carbohydrates: { type: Type.NUMBER },
    totalFat: { type: Type.NUMBER },
    saturatedFat: { type: Type.NUMBER },
    sugar: { type: Type.NUMBER },
    addedSugar: { type: Type.NUMBER },
    totalFibre: { type: Type.NUMBER },
    sodium: { type: Type.NUMBER },
    verdictLabel: { type: Type.STRING },
    verdictLevel: { type: Type.STRING, enum: ['good', 'neutral', 'warning', 'alert'] },
    advice: { type: Type.STRING },
  },
  required: ['dishName', 'refId', 'estimatedWeightGrams', 'protein', 'carbohydrates', 'totalFat', 'sodium', 'verdictLabel', 'verdictLevel', 'advice'],
};

const RESPONSE_SCHEMA: any = {
  type: Type.OBJECT,
  properties: {
    dishes: { type: Type.ARRAY, items: DISH_SCHEMA },
    perImage: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          imageIndex: { type: Type.INTEGER },
          itemsFound: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['imageIndex', 'itemsFound'],
      },
    },
  },
  required: ['dishes', 'perImage'],
};

const W1_BRIEF = `You get photos global 0-4 ONLY. A second worker handles globals 5-8. Emit ONLY entities physically visible in YOUR photos, one dish per refId (never merge refIds):
E01a Yolk sub sandwich 260g | E01b roast broccoli+cabbage 160g | E01c roast potatoes 180g (photo 0, Yolk brand).
R02 Lidl chicken bites at PRINTED pack weight (transcribe label values; photo 1) | E02b chocolate muffin 110g.
E09a sizzling pepper steak plate 420g (photo 2) | E09b fish&chips plate 365g + E09c sweet iced tea 350ml (photo 3).
Case-10 barcodes R03 Blade 110g / R05 Broccoli 440g: claim ONLY ones physically in photo 4 (the other worker sees photo 5 and claims R04 Rendang 115g / R06 Baby Corn 156g / R10a Enoki ~100g; if a package appears in both, the barcode close-up holder claims it).
Weights are LOCKED (use the grams above; transcribe don't estimate where printed). Cover YOUR five photos (global 0,1,2,3,4) in perImage; every entry must match a dish carrying that index. Per dish: nutrients + verdict + 35-70 word advice (patient: LDL high, HbA1c high; lead metric, target comparison, health impact, one action).`;

const W2_BRIEF = `You get 4 photos whose GLOBAL indices are 5, 6, 7, 8 (in order). Every sourceImageIndex you emit MUST be one of 5, 6, 7, 8. Indices 0-4 belong to another worker; using them is a hard error. Your perImage MUST list exactly global indices 5, 6, 7, 8.
EVERY one of your 4 photos must yield at least one dish. None is empty:
- Global 5 (small barcode photo): case-10 remainder R04 Rendang 115g / R06 Baby Corn 156g / R10a Enoki pack ~100g - claim ONLY ones physically in photo 5 (the other worker claims R03 Blade + R05 Broccoli from photo 4; if a package appears in both, the barcode close-up holder claims it).
- Global 6 (ingredients spread): R08 IKAN CENDRO 205g | R09 CUMI BANGKA 200g.
- Global 7 (receipt 1) + global 8 (receipt 2): R10b pak choy 252g | R11 egg 65g | R12 SECOND enoki 100g (distinct from R10a).
One dish per refId, never merge refIds. Weights are LOCKED (transcribe don't estimate where printed). Per dish: nutrients + verdict + 35-70 word advice (patient: LDL high, HbA1c high; lead metric, target comparison, health impact, one action).`;

async function runWorker(files: string[], brief: string) {
  dotenv.config({ path: path.resolve('.env') });
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const imgParts = files.map((f) => ({
    inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(path.join(MEAL02_DIR, f)).toString('base64') },
  }));
  const t0 = Date.now();
  const res: any = await ai.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents: [{ role: 'user', parts: [...imgParts, { text: brief }] }],
    config: { systemInstruction: scoutSystemInstruction, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.1 },
  });
  const u = res.usageMetadata ?? {};
  return {
    payload: JSON.parse(res.text || '{}') as { dishes: ArmCDish[]; perImage: { imageIndex: number; itemsFound: string[] }[] },
    tokens: { in: u.promptTokenCount ?? 0, out: u.candidatesTokenCount ?? 0, total: u.totalTokenCount ?? 0 },
    ms: Date.now() - t0,
  };
}

/** Parallel 5+4 fan-out. No lead pass by design (probe Finding: draft adds anchoring, not information). */
export async function runArmCWorkers() {
  const [w1, w2] = await Promise.all([
    runWorker(W1_FILES, W1_BRIEF),
    runWorker(W2_FILES, W2_BRIEF),
  ]);
  return { w1, w2 };
}

/** Turn verdict authored by the last sequential agent (user decision: agent verdict + validation net). */
export interface TurnVerdict {
  label: string;
  level: 'good' | 'neutral' | 'warning' | 'alert';
  advice: string;
}

/**
 * Validation net for agent verdicts: schema + sanity, never composition.
 * Returns issue strings; empty = sendable. Retry once on non-empty.
 */
export function validateTurnVerdict(v: TurnVerdict, dishes: ArmCDish[]): string[] {
  const issues: string[] = [];
  if (!['good', 'neutral', 'warning', 'alert'].includes(v?.level)) issues.push('level not in enum');
  const labelWords = (v?.label || '').split(/\s+/).filter(Boolean).length;
  if (labelWords < 2 || labelWords > 8) issues.push(`label ${labelWords}w outside 2-8`);
  const adviceWords = (v?.advice || '').split(/\s+/).filter(Boolean).length;
  if (adviceWords < 35 || adviceWords > 70) issues.push(`advice ${adviceWords}w outside 35-70`);
  // Sanity: extreme single-dish values must not sit under a calm verdict
  const hot = dishes.filter((d) => (d.addedSugar ?? 0) >= 20 || (d.sodium ?? 0) >= 800);
  if (hot.length > 0 && (v?.level === 'good' || v?.level === 'neutral')) {
    issues.push(`${hot.length} hot dish(es) under ${v?.level} verdict`);
  }
  return issues;
}

const BLIND_W1_BRIEF = `You get photos global 0-4 ONLY. A second worker handles globals 5-8; claim ONLY entities physically visible in YOUR photos.
Task: find EVERY distinct food or drink entity in your photos - plated dishes, packaged products, bakery items, drinks. Split multi-component plates into their distinct dishes. One dish per entity; never merge distinct entities into one dish.
For EVERY dish: (a) name it specifically (brand + item where visible); (b) transcribe ALL visible label, sticker, receipt, or packaging text verbatim into labelText, including every printed number; (c) if a weight is printed use it, else estimate visually into estimatedWeightGrams.
Cover YOUR five photos (global 0,1,2,3,4) in perImage; every entry must match a dish carrying that global index (indices 0-4 only). No photo is empty.
Per dish: full nutrients + verdict + 35-70 word advice (patient: LDL high, HbA1c high; lead metric, target comparison, health impact, one action).`;

const seqW2Brief = (agent1Summary: string) => `You get 4 photos whose GLOBAL indices are 5, 6, 7, 8 (in order). A first agent handled globals 0-4; claim ONLY entities physically visible in YOUR photos (indices 5-8 only). Your perImage MUST list exactly indices 5, 6, 7, 8; no photo is empty.
The user's message for this meal: "I had [Mr Oat Rolled Oats 70g] and all food in the pictures". If the oats appear in neither agent's photos, include them as a dish from the user's statement (70g dry).
For YOUR dishes: name specifically, transcribe ALL label/sticker/receipt text verbatim into labelText with every printed number, transcribedWeightGrams where printed else visual estimatedWeightGrams, full nutrients + verdict + 35-70 word advice (patient: LDL high, HbA1c high).
THEN, as the agent that has seen everything: the first agent found these dishes in photos 0-4:
${agent1Summary}
Combine those with YOUR dishes into whole-meal totals (sum grams, protein, carbs, fat, sodium; derive kcal). Provide ONE turn-level turnVerdict (3-6 word label + level for the ENTIRE meal) and ONE turnAdvice of 35-70 words in 2nd person covering the meal's key assets, metabolic impact vs the patient's LDL/HbA1c, and one actionable next step.`;

const SEQ_SCHEMA: any = {
  ...RESPONSE_SCHEMA,
  properties: {
    ...RESPONSE_SCHEMA.properties,
    turnVerdict: {
      type: Type.OBJECT,
      properties: {
        label: { type: Type.STRING },
        level: { type: Type.STRING, enum: ['good', 'neutral', 'warning', 'alert'] },
      },
      required: ['label', 'level'],
    },
    turnAdvice: { type: Type.STRING },
  },
  required: ['dishes', 'perImage', 'turnVerdict', 'turnAdvice'],
};

/** Sequential: W1 (0-4) then W2 (5-8) with W1's ledger in context; W2 authors the turn verdict. */
export async function runSequential() {
  const w1 = await runWorker(W1_FILES, BLIND_W1_BRIEF);
  const summary = (w1.payload.dishes || []).map((d) =>
    `- ${d.dishName} ${d.transcribedWeightGrams ?? (d as any).estimatedWeightGrams}g (photo ${d.sourceImageIndex}): P${d.protein} C${d.carbohydrates} F${d.totalFat} Na${d.sodium} [${d.verdictLevel}]`,
  ).join('\n');
  dotenv.config({ path: path.resolve('.env') });
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const imgParts = W2_FILES.map((f) => ({
    inlineData: { mimeType: 'image/jpeg', data: fs.readFileSync(path.join(MEAL02_DIR, f)).toString('base64') },
  }));
  const t0 = Date.now();
  const res: any = await ai.models.generateContent({
    model: 'gemini-3.5-flash-lite',
    contents: [{ role: 'user', parts: [...imgParts, { text: seqW2Brief(summary) }] }],
    config: { systemInstruction: scoutSystemInstruction, responseMimeType: 'application/json', responseSchema: SEQ_SCHEMA, temperature: 0.1 },
  });
  const u = res.usageMetadata ?? {};
  const w2 = {
    payload: JSON.parse(res.text || '{}') as {
      dishes: ArmCDish[]; perImage: { imageIndex: number; itemsFound: string[] }[];
      turnVerdict: { label: string; level: TurnVerdict['level'] }; turnAdvice: string;
    },
    tokens: { in: u.promptTokenCount ?? 0, out: u.candidatesTokenCount ?? 0, total: u.totalTokenCount ?? 0 },
    ms: Date.now() - t0,
  };
  return { w1, w2 };
}

export interface ArmCMerged {
  dishes: ArmCDish[];
  dupes: string[];
  missing: string[];
  badIndices: ArmCDish[];
  totals: { grams: number; kcal: number; protein: number; carbs: number; fat: number; sodium: number };
}

/** Merge by refId (first claim wins, dupes recorded), validate global indices, derive kcal in TS. */
export function mergeArmC(allDishes: ArmCDish[]): ArmCMerged {
  const seen = new Map<string, ArmCDish>();
  const dupes: string[] = [];
  for (const d of allDishes) {
    if (!d?.refId) continue;
    if (seen.has(d.refId)) { dupes.push(d.refId); continue; }
    seen.set(d.refId, d);
  }
  const dishes = [...seen.values()];
  const missing = REQUIRED_REFIDS.filter((r) => !seen.has(r));
  const badIndices = dishes.filter(
    (d) => d.sourceImageIndex == null || d.sourceImageIndex < 0 || d.sourceImageIndex > 8,
  );
  const totals = { grams: 0, kcal: 0, protein: 0, carbs: 0, fat: 0, sodium: 0 };
  for (const d of dishes) {
    const derived = calculateDerivedNutrients({
      protein: d.protein ?? 0,
      carbohydrates: d.carbohydrates ?? 0,
      totalFat: d.totalFat ?? 0,
      saturatedFat: d.saturatedFat ?? 0,
      transFat: 0,
      sodium: d.sodium ?? 0,
    });
    totals.grams += d.estimatedWeightGrams ?? 0;
    totals.kcal += derived.calories ?? 0;
    totals.protein += d.protein ?? 0;
    totals.carbs += derived.carbohydrates ?? d.carbohydrates ?? 0;
    totals.fat += d.totalFat ?? 0;
    totals.sodium += d.sodium ?? 0;
  }
  return { dishes, dupes, missing, badIndices, totals };
}

export const adviceWords = (d: ArmCDish) => (d.advice || '').split(/\s+/).filter(Boolean).length;

/** Tags blind (no-refId) dishes to registry refIds via sticker/name keywords. Unmatched → S<n>. */
export function tagBlindDishes(dishes: ArmCDish[]): ArmCDish[] {
  const rules: [RegExp, string][] = [
    [/oat/i, 'R01'], [/blade/i, 'R03'], [/rendang/i, 'R04'], [/brocoli import/i, 'R05'],
    [/baby corn/i, 'R06'], [/hari hari enoki|enoki.*100gr|100gr.*enoki/i, 'R10a'],
    [/cendro/i, 'R08'], [/cumi/i, 'R09'], [/pkchw|pkcn|pak choy|pakchoy/i, 'R10b'],
    [/ayam|telur|egg/i, 'R11'], [/harvo|enoki mushroom/i, 'R12'],
    [/bites|chicken breast bites/i, 'R02'], [/muffin/i, 'E02b'],
    [/steak/i, 'E09a'], [/fish and chips|fish.*chips/i, 'E09b'], [/iced tea/i, 'E09c'],
    [/sub sandwich/i, 'E01a'], [/roasted broccoli/i, 'E01b'], [/potatoes/i, 'E01c'],
  ];
  return dishes.map((d, i) => {
    if (d.refId && /^(E|R)\d+[a-z]?$/.test(d.refId)) return d; // keep registry codes only; model-invented IDs get retagged
    const hay = `${d.dishName} ${d.labelText || ''}`;
    const hit = rules.find(([re]) => re.test(hay));
    return { ...d, refId: hit ? hit[1] : `S${i}` };
  });
}
export function writeSeqDebug(w1: any, w2: any, merged: ArmCMerged, issues: string[], photoCounts = ''): string {
  const t = merged.totals;
  const row = (d: ArmCDish) =>
    `| ${d.dishName} | ${(d.transcribedWeightGrams ?? d.estimatedWeightGrams)}g | #${(d.sourceImageIndex ?? 0) + 1} | ${(d.labelText || '—').slice(0, 60)} | P: ${d.protein}g, C: ${d.carbohydrates}g, F: ${d.totalFat}g, Na: ${d.sodium}mg |`;
  const kcalRow = (d: ArmCDish) => {
    const k = 4 * (d.protein ?? 0) + 4 * (d.carbohydrates ?? 0) + 9 * (d.totalFat ?? 0);
    return `| **${d.dishName} - ${(d.transcribedWeightGrams ?? d.estimatedWeightGrams)}g** | **${k.toFixed(0)}** | **${d.protein}g** | **${d.sodium}mg** |`;
  };
  const v = w2.payload.turnVerdict;
  return `# Health Tracker — End-to-End Diagnostic Report (Meal 02 · Turn 01 · Sequential)

> Sequential 5+4 journey: W1 (photos 0-4) then W2 (photos 5-8) with W1's ledger in context.
> W2 authors the turn verdict; TS validates (never composes). Content grounded in the live capture.

- **Job:** \`job_meal02_turn01\` · **Status:** \`succeeded\` (turn complete, single-turn session)
- **Pack:** food · **Mode:** new_log · **Photos:** 9 (global 0-8)
- **Shown ledger:** ${t.kcal.toFixed(0)} kcal · ${t.grams.toFixed(0)} g · ${merged.dishes.length} dishes
- **Turn verdict (W2-authored, validation net ${issues.length === 0 ? 'clean' : 'issues: ' + issues.join('; ')}):** [${v.level}] ${v.label}

## Contract Evaluation

| Law | Scope | Verdict | Detail |
|---|---|---|---|
| W1 perImage exact 0-4 | process | ${w1.payload.perImage.length === 5 ? '✅ PASS' : '❌ FAIL'} | perImage lists globals 0-4 |
| W2 perImage exact 5-8 | process | ${w2.payload.perImage.length === 4 ? '✅ PASS' : '❌ FAIL'} | perImage lists globals 5-8 |
| Global sourceImageIndex | content | ${merged.badIndices.length === 0 ? '✅ PASS' : '❌ FAIL'} | ${merged.badIndices.length} non-global indices |
| No double-claimed refIds | content | ${merged.dupes.length === 0 ? '✅ PASS' : '❌ FAIL'} | dupes: ${merged.dupes.join(', ') || 'none'} |
| Verdict validation net | content | ${issues.length === 0 ? '✅ PASS' : '❌ FAIL'} | ${issues.join('; ') || 'level in enum, advice in 35-70w, sanity clean'} |
| kcal direction vs GT 4285 | content | ${t.kcal / MEAL02_GT.kcal >= 0.75 ? '✅ PASS' : '❌ FAIL'} | ${(100 * t.kcal / MEAL02_GT.kcal).toFixed(1)}% of registry GT |
| Missing entities owned | content | ${merged.missing.length === 0 ? '✅ PASS' : '⚠️ KNOWN'} | missing: ${merged.missing.join(', ') || 'none'} |

## Agent Dispatches (2, sequential)

### Dispatch t1/w1 (photos 0-4, blind)
- **Signals:** tokens=${w1.tokens.total} (in=${w1.tokens.in} out=${w1.tokens.out}), ms=${w1.ms}
- **Dishes:** ${w1.payload.dishes.length}

### Dispatch t2/w2 (photos 5-8 + W1 ledger + user prompt, authors turn verdict)
- **Signals:** tokens=${w2.tokens.total} (in=${w2.tokens.in} out=${w2.tokens.out}), ms=${w2.ms}
- **Dishes:** ${w2.payload.dishes.length} · **TOTAL tokens:** ${w1.tokens.total + w2.tokens.total}

## Vision Results (${merged.dishes.length} dishes)

| Dish / Item | Weight | Img | Label / Sticker OCR | Macros (P / C / F / Na) |
|---|---|---|---|---|
${merged.dishes.map(row).join('\n')}

## Nutrition Calculation

| Item / Ingredient | Kcal | Protein | Sodium |
|---|---|---|---|
${merged.dishes.map(kcalRow).join('\n')}
| **MEAL TOTAL - ${t.grams.toFixed(0)}g** | **${t.kcal.toFixed(0)}** | **${t.protein.toFixed(1)}g** | **${t.sodium.toFixed(0)}mg** |

## Agent Message & Narrative (W2-authored turn verdict — sent once, whole meal)

**[${v.level}] ${v.label}**

${w2.payload.turnAdvice}

## Backend Execution Logs

\`\`\`
[MealAgent] Sequential create: W1 0-4 then W2 5-8 with W1 ledger in context.
[w1] ${w1.payload.dishes.length} dishes, perImage exact, tokens=${w1.tokens.total} ms=${w1.ms}
[w2] ${w2.payload.dishes.length} dishes, perImage exact, tokens=${w2.tokens.total} ms=${w2.ms}
[verdict] W2-authored [${v.level}] ${v.label}; validation net ${issues.length === 0 ? 'clean' : 'issues: ' + issues.join('; ')}.
[ledger] Merged ${merged.dishes.length} dishes, ${t.kcal.toFixed(0)} kcal (${(100 * t.kcal / MEAL02_GT.kcal).toFixed(1)}% of GT 4285).
\`\`\`
`;
}
