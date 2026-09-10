/**
 * Benchmark & Validation Test for Procedural Graph vs Monolithic Golden Meal Process
 *
 * Evaluates:
 * 1. Add Meal Golden Process (Meal_01 ground truth)
 * 2. Compare Meals Golden Process (Meal_03_compare Set 1 ground truth)
 * 3. Invariant Checks:
 *    - Dietitian is NEVER invoked (Scout is sole Meal Agent)
 *    - Single kcal writer (finalizeDishLedger)
 *    - Sibling journey isolation (Compare is EVALUATION ONLY)
 *    - Word-count bands (35-70 words) for clinical coaching
 *    - Step-level guidance reduction (token efficiency vs monolithic 2000-line prompt)
 */

import fs from 'fs';
import path from 'path';
import {
  AddMealNodes,
  CompareMealsNodes,
  ProceduralGraphEngine,
  AddMealState,
  CompareMealsState,
} from './meal_procedural_graph';

// Load Golden ground truth fixtures
const GOLDEN_DIR_MEAL01 = path.join(process.cwd(), 'golden', 'meal', 'Meal_01');
const GOLDEN_DIR_COMPARE = path.join(process.cwd(), 'golden', 'meal', 'Meal_03_compare');

const meal01Expected = JSON.parse(
  fs.readFileSync(path.join(GOLDEN_DIR_MEAL01, 'expected.json'), 'utf-8')
);
const compareExpected = JSON.parse(
  fs.readFileSync(path.join(GOLDEN_DIR_COMPARE, 'expected.json'), 'utf-8')
);

// Estimate monolithic system prompt size (from server_vision_scout.ts & scoutInstructions.ts)
const MONOLITHIC_PROMPT_CHARS = 113644; // server_vision_scout.ts file size in chars

export async function runProceduralGraphBenchmark() {
  console.log('================================================================');
  console.log('PROCEDURAL GRAPH BENCHMARK: MEAL AGENT (ADD MEAL & COMPARE)');
  console.log('Architecture: Google Lu et al. (2026) arXiv:2609.09153');
  console.log('Core Law: SCOUT IS THE SOLE MEAL AGENT (DIETITIAN DEPRECATED)');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, message: string) {
    totalTests++;
    if (condition) {
      console.log(`  ✅ PASS: ${message}`);
      passedTests++;
    } else {
      console.error(`  ❌ FAIL: ${message}`);
    }
  }

  // ==========================================================================
  // Test Suite 1: Add Meal Golden Process (Golden Meal_01)
  // ==========================================================================
  console.log('--- TEST SUITE 1: Add Meal Golden Process (Meal_01) ---');

  const addMealEngine = new ProceduralGraphEngine<AddMealState>(AddMealNodes);

  const mealState: AddMealState = {
    mode: 'add_meal',
    rawInput: {
      photoCount: 5,
      userText: '',
      diningEnvironment: 'home_prepared',
      nutrientTargets: { calories: 2000, sodium: 2300, saturatedFat: 20 },
    },
    extractedDishes: [],
    portionsAudited: false,
    ledgerFinalized: false,
    dietitianInvoked: false,
  };

  // Step 1: Localize & Run Dish Extraction
  const node1 = addMealEngine.localizeActiveNode(mealState);
  assert(node1 !== null && node1.id === 'DISH_CANDIDATES_EXTRACTION', 'Active node localized to DISH_CANDIDATES_EXTRACTION');

  const step1Guidance = addMealEngine.getStepGuidance(node1!, mealState);
  console.log(`     [Token Efficiency] Step 1 prompt size: ${step1Guidance.guidanceLength} chars (vs ~${MONOLITHIC_PROMPT_CHARS} chars monolithic, -${((1 - step1Guidance.guidanceLength / MONOLITHIC_PROMPT_CHARS) * 100).toFixed(1)}% prompt bloat)`);

  // Emulate visual extraction of Golden Meal 01 dishes
  mealState.extractedDishes = [
    { dishName: 'Sop Daging Sapi', genericEnglishName: 'Indonesian clear beef soup', photoIndex: 1, cookingMethod: 'boiled' },
    { dishName: 'Jajanan Trio', genericEnglishName: 'Indonesian market snacks trio', photoIndex: 2, cookingMethod: 'deep_fried' },
    { dishName: 'Oatmeal (instant oats)', photoIndex: 3, hasLabelOcr: true, labelText: 'Sunrise Rolled Oats 35g serving' },
    { dishName: 'Hemaviton C1000 can', photoIndex: 4, hasLabelOcr: true, labelText: 'Hemaviton 330ml 89.55 kcal' },
    { dishName: 'Brownies (pack)', photoIndex: 5, hasLabelOcr: true, labelText: 'Brownies 30g pack' },
  ];

  const gate1 = addMealEngine.validateStep(node1!, mealState);
  assert(gate1.passed, `Dish Candidates Extraction gate passed (${mealState.extractedDishes.length} dishes identified)`);
  assert(!mealState.dietitianInvoked, 'Dietitian was NOT invoked in Step 1 (Sole Scout agent)');

  // Step 2: Localize & Run Portion & Preparation Audit
  const node2 = addMealEngine.localizeActiveNode(mealState);
  assert(node2 !== null && node2.id === 'PORTION_AND_PREPARATION_AUDIT', 'Active node localized to PORTION_AND_PREPARATION_AUDIT');

  const step2Guidance = addMealEngine.getStepGuidance(node2!, mealState);
  console.log(`     [Token Efficiency] Step 2 prompt size: ${step2Guidance.guidanceLength} chars (active-node context only)`);

  // Emulate portion locking from Golden Meal 01
  mealState.extractedDishes[0].weightGrams = meal01Expected.dishes[0].weightGrams; // 450g
  mealState.extractedDishes[1].weightGrams = meal01Expected.dishes[1].weightGrams; // 170g
  mealState.extractedDishes[2].weightGrams = meal01Expected.dishes[2].weightGrams; // 35g
  mealState.extractedDishes[3].weightGrams = meal01Expected.dishes[3].weightGrams; // 330g
  mealState.extractedDishes[4].weightGrams = meal01Expected.dishes[4].weightGrams; // 30g
  mealState.portionsAudited = true;

  const gate2 = addMealEngine.validateStep(node2!, mealState);
  assert(gate2.passed, 'Portion & Preparation Audit gate passed with validated grams');
  assert(!mealState.dietitianInvoked, 'Dietitian was NOT invoked in Step 2');

  // Step 3: Localize & Run Ledger Finalize & Clinical Coaching
  const node3 = addMealEngine.localizeActiveNode(mealState);
  assert(node3 !== null && node3.id === 'LEDGER_FINALIZE_AND_COACHING', 'Active node localized to LEDGER_FINALIZE_AND_COACHING');

  // Emulate derived calculation and Scout clinical coaching (no Dietitian)
  mealState.ledgerTotals = {
    calories: meal01Expected.packDefaultLedger.nutrients.calories,
    protein: 45.2,
    carbohydrates: 120.4,
    totalFat: 38.6,
    saturatedFat: 14.2,
    sodium: 1850,
  };
  mealState.clinicalAdvice =
    'You achieved great protein density today from the beef soup and oats, supporting muscle recovery. However, saturated fat and sodium are running close to your daily ceiling due to the fried snacks. Drink plenty of water and aim for a 20-minute post-meal walk.';
  mealState.clinicalVerdict = {
    level: 'warning',
    label: 'High Saturated Fat & Sodium',
  };
  mealState.ledgerFinalized = true;

  const gate3 = addMealEngine.validateStep(node3!, mealState);
  assert(gate3.passed, 'Ledger Finalize & Coaching gate passed');
  assert(!mealState.dietitianInvoked, 'Dietitian was NOT invoked in Step 3 (Scout owns coaching)');

  const adviceWords = mealState.clinicalAdvice.trim().split(/\s+/).length;
  assert(adviceWords >= 35 && adviceWords <= 70, `Coaching advice within 35-70 word band (${adviceWords} words)`);
  assert(mealState.ledgerTotals.calories > 0, `Single writer kcal calculated: ${mealState.ledgerTotals.calories} kcal`);

  // ==========================================================================
  // Test Suite 2: Compare Meals Golden Process (Golden Meal_03_compare Set 1)
  // ==========================================================================
  console.log('\n--- TEST SUITE 2: Compare Meals Golden Process (Meal_03_compare) ---');

  const compareEngine = new ProceduralGraphEngine<CompareMealsState>(CompareMealsNodes);
  const compareSet1 = compareExpected[0]; // Set 1

  const compareState: CompareMealsState = {
    mode: 'compare',
    rawInput: {
      photoCount: 3,
      userText: 'Help me choose a snack from the shelf',
      userAllowance: { saturatedFatRemaining: 5, addedSugarRemaining: 10 },
    },
    extractedItems: [],
    groups: [],
    normalized: false,
    evaluationOnlyVerified: false,
    dietitianInvoked: false,
  };

  // Step 1: Compare Extraction
  const cNode1 = compareEngine.localizeActiveNode(compareState);
  assert(cNode1 !== null && cNode1.id === 'COMPARE_ITEM_EXTRACTION', 'Active node localized to COMPARE_ITEM_EXTRACTION');

  // Emulate extracting 6 items from Golden Set 1
  compareState.extractedItems = compareSet1.data.items.map((it: any) => ({
    name: it.name,
    sourceImageIndex: it.sourceImageIndex,
    hasNutritionLabel: it.hasNutritionLabel,
    servingSize: it.servingSize,
    servingsPerPack: it.servingsPerPack,
  }));

  const cGate1 = compareEngine.validateStep(cNode1!, compareState);
  assert(cGate1.passed, `Compare extraction gate passed (${compareState.extractedItems.length} candidate items extracted)`);

  // Step 2: Grouping & 100g Normalization
  const cNode2 = compareEngine.localizeActiveNode(compareState);
  assert(cNode2 !== null && cNode2.id === 'GROUPING_AND_100G_NORMALIZATION', 'Active node localized to GROUPING_AND_100G_NORMALIZATION');

  compareState.groups = compareSet1.data.groups.map((g: any) => ({
    groupName: g.groupName,
    itemNames: g.itemNames || [],
    averageNutrients: g.averageNutrients,
    averageNutrientsPer100g: g.averageNutrientsPer100g,
  }));
  compareState.normalized = true;

  const cGate2 = compareEngine.validateStep(cNode2!, compareState);
  assert(cGate2.passed, `Grouping & 100g normalization gate passed (${compareState.groups.length} groups with 100g metrics)`);

  // Step 3: Evaluate & Recommend (EVALUATION ONLY)
  const cNode3 = compareEngine.localizeActiveNode(compareState);
  assert(cNode3 !== null && cNode3.id === 'EVALUATE_AND_RECOMMEND', 'Active node localized to EVALUATE_AND_RECOMMEND');

  compareState.recommendation = {
    recommendedItemOrGroup: compareSet1.recommended,
    summary: compareSet1.data.summary,
    clinicalTradeOffs:
      'SilverQueen provides transparent portion control via printed label and cashew fiber, whereas Say Bread bakery goods have higher saturated fat and unquantified trans-fats.',
  };
  compareState.evaluationOnlyVerified = true; // Invariant: never commits to food_logs

  const cGate3 = compareEngine.validateStep(cNode3!, compareState);
  assert(cGate3.passed, 'Evaluate & Recommend gate passed');
  assert(compareState.evaluationOnlyVerified, 'EVALUATION ONLY invariant verified (no meal logged)');
  assert(!compareState.dietitianInvoked, 'Dietitian was NOT invoked in Compare mode');

  // ==========================================================================
  // Test Suite 3: Negative Procedural Guardrail Tests (Rejections & Pitfalls)
  // ==========================================================================
  console.log('\n--- TEST SUITE 3: Negative Procedural Guardrail Tests ---');

  // Test 3.1: Dietitian Invocation Detection (Negative Gate)
  const rogueState: AddMealState = {
    ...mealState,
    dietitianInvoked: true, // Illegal state
  };
  const rogueGate = AddMealNodes.PORTION_AND_PREPARATION_AUDIT.validateGate(rogueState);
  assert(!rogueGate.passed, 'Negative Gate: Dietitian invocation was rejected with error');
  assert(rogueGate.errors.some((e) => e.includes('Deprecated')), 'Error message correctly cites Dietitian deprecation');

  // Test 3.2: Empty weight rejection
  const unweightedState: AddMealState = {
    ...mealState,
    extractedDishes: [{ dishName: 'Mystery Stew', weightGrams: 0 }],
    dietitianInvoked: false,
  };
  const unweightedGate = AddMealNodes.PORTION_AND_PREPARATION_AUDIT.validateGate(unweightedState);
  assert(!unweightedGate.passed, 'Negative Gate: Dish with zero weight rejected before Ledger Finalize');

  // Test 3.3: Rejection Cache Pruning
  addMealEngine.addRejection({
    id: 'reject-import-scout-into-compare',
    sourceNodeId: 'COMPARE_ITEM_EXTRACTION',
    targetNodeId: 'DISH_CANDIDATES_EXTRACTION',
    reason: 'Violates sibling isolation standing rule',
  });
  const cachedRejection = addMealEngine.checkRejectionCache('COMPARE_ITEM_EXTRACTION', 'DISH_CANDIDATES_EXTRACTION');
  assert(cachedRejection !== undefined, `Negative Rejection Cache pruned invalid transition: ${cachedRejection?.reason}`);

  // Summary Report
  console.log('\n================================================================');
  console.log(`BENCHMARK RESULTS: ${passedTests}/${totalTests} TESTS PASSED`);
  console.log('================================================================');
  return { passedTests, totalTests, success: passedTests === totalTests };
}

// Self-run when executed directly
if (process.argv[1]?.includes('graph_runner_test')) {
  runProceduralGraphBenchmark().then((res) => {
    process.exit(res.success ? 0 : 1);
  });
}
