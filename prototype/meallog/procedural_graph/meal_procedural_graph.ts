/**
 * Procedural Graph Engine for Meal Agent (Add Meal & Compare)
 *
 * NOTE: DIETITIAN IS FULLY DEPRECATED.
 * Scout is the sole Meal Agent across both Add Meal and Compare.
 *
 * Implements:
 * 1. (procedure, relation, procedure) Triplet Graph
 * 2. Active Node Localization
 * 3. Step-Level Situational Guidance (2-hop neighborhood)
 * 4. Deterministic State Transition Gates
 * 5. Negative Rejection Memory
 */

import {
  ProceduralNode,
  ProceduralTriplet,
  ProceduralGateResult,
  RejectedEdit,
  ProceduralGraphExecutionTrace,
} from './procedural_graph_types';

// ============================================================================
// State Schemas
// ============================================================================

export interface AddMealState {
  mode: 'add_meal';
  rawInput: {
    photoCount: number;
    userText?: string;
    diningEnvironment?: string;
    nutrientTargets?: Record<string, number>;
  };
  // Procedural intermediate state
  extractedDishes: Array<{
    dishName: string;
    genericEnglishName?: string;
    components?: Array<{ name: string; weightGrams?: number }>;
    photoIndex?: number;
    hasLabelOcr?: boolean;
    labelText?: string;
    cookingMethod?: string;
    weightGrams?: number;
    nutrients?: Record<string, number>;
  }>;
  portionsAudited: boolean;
  ledgerFinalized: boolean;
  ledgerTotals?: {
    calories: number;
    protein: number;
    carbohydrates: number;
    totalFat: number;
    saturatedFat: number;
    sodium: number;
    [k: string]: number;
  };
  clinicalAdvice?: string;
  clinicalVerdict?: {
    level: 'good' | 'warning' | 'alert' | 'neutral';
    label: string;
  };
  dietitianInvoked: boolean; // Must remain FALSE at all times
}

export interface CompareMealsState {
  mode: 'compare';
  rawInput: {
    photoCount: number;
    userText?: string;
    userAllowance?: Record<string, number>;
  };
  extractedItems: Array<{
    name: string;
    sourceImageIndex?: number;
    hasNutritionLabel?: boolean;
    servingSize?: string;
    servingsPerPack?: string;
    price?: number;
  }>;
  groups: Array<{
    groupName: string;
    itemNames: string[];
    averageNutrients: Record<string, number>;
    averageNutrientsPer100g: Record<string, number>;
  }>;
  normalized: boolean;
  recommendation?: {
    recommendedItemOrGroup: string;
    summary: string;
    clinicalTradeOffs: string;
  };
  evaluationOnlyVerified: boolean;
  dietitianInvoked: boolean; // Must remain FALSE at all times
}

// ============================================================================
// Procedural Triplets
// ============================================================================

export const ADD_MEAL_TRIPLETS: ProceduralTriplet[] = [
  {
    sourceNodeId: 'DISH_CANDIDATES_EXTRACTION',
    relation: 'precedes',
    targetNodeId: 'PORTION_AND_PREPARATION_AUDIT',
    conditionDescription: 'Dishes extracted with names and visual candidates identified',
  },
  {
    sourceNodeId: 'PORTION_AND_PREPARATION_AUDIT',
    relation: 'precedes',
    targetNodeId: 'LEDGER_FINALIZE_AND_COACHING',
    conditionDescription: 'Grams and cooking preparation methods locked; dining environment checked',
  },
];

export const COMPARE_MEALS_TRIPLETS: ProceduralTriplet[] = [
  {
    sourceNodeId: 'COMPARE_ITEM_EXTRACTION',
    relation: 'precedes',
    targetNodeId: 'GROUPING_AND_100G_NORMALIZATION',
    conditionDescription: 'All retail / menu choices extracted into distinct items',
  },
  {
    sourceNodeId: 'GROUPING_AND_100G_NORMALIZATION',
    relation: 'precedes',
    targetNodeId: 'EVALUATE_AND_RECOMMEND',
    conditionDescription: 'Groups formed with both per-serving and per-100g nutritional allowances',
  },
];

// ============================================================================
// Add Meal Nodes (Scout Sole Meal Agent)
// ============================================================================

export const AddMealNodes: Record<string, ProceduralNode<AddMealState>> = {
  DISH_CANDIDATES_EXTRACTION: {
    id: 'DISH_CANDIDATES_EXTRACTION',
    label: 'Extract Dish Candidates & Label OCR',
    purpose: 'Identify distinct plated items, packaging labels, and ingredient breakdown without prompt dilution',
    allowedTransitions: ['PORTION_AND_PREPARATION_AUDIT'],
    pitfalls: [
      'Do not guess calories or macros in this step',
      'Distinguish false friends (e.g. coconut milk vs dairy, sweet vs savory sauces)',
      'Never invoke Dietitian (deprecated)',
      'Keep distinct plated items separate; do not merge drinks into food',
    ],
    condition: (state) => state.extractedDishes.length === 0,
    situationalGuidance: (state) =>
      `[Procedural Node: Dish Extraction]\n` +
      `Identify all distinct food dishes and drinks from the provided ${state.rawInput.photoCount} photos.\n` +
      `For packaged items, transcribe the exact nutrition label text.\n` +
      `DO NOT compute calories or macronutrients yet. Focus strictly on dish identity, ingredients, and visual boundaries.`,
    validateGate: (state) => {
      const errors: string[] = [];
      if (state.dietitianInvoked) errors.push('Dietitian was invoked! (Deprecated — Scout is sole meal agent)');
      if (state.extractedDishes.length === 0) errors.push('No dishes were extracted from photos');
      for (const d of state.extractedDishes) {
        if (!d.dishName || d.dishName.trim().length === 0) {
          errors.push('Found dish with empty dishName');
        }
      }
      return { passed: errors.length === 0, errors };
    },
  },

  PORTION_AND_PREPARATION_AUDIT: {
    id: 'PORTION_AND_PREPARATION_AUDIT',
    label: 'Portion & Commercial Preparation Audit',
    purpose: 'Determine grams, cooking methods, and commercial oil/sodium factors',
    allowedTransitions: ['LEDGER_FINALIZE_AND_COACHING'],
    pitfalls: [
      'Underestimating commercial oil absorption in deep-fried / restaurant meals',
      'Assuming packaged weight when prepared-dish volume differs',
      'Altering dish identity while adjusting portions',
    ],
    condition: (state) => state.extractedDishes.length > 0 && !state.portionsAudited,
    situationalGuidance: (state) =>
      `[Procedural Node: Portion & Preparation Audit]\n` +
      `Dishes detected: ${state.extractedDishes.map((d) => d.dishName).join(', ')}.\n` +
      `Now verify realistic portion weights (grams) and cooking methods (boiled, deep_fried, raw, baked).\n` +
      (state.rawInput.diningEnvironment ? `Dining Environment: ${state.rawInput.diningEnvironment}.\n` : '') +
      `Audit hidden fats (dressings, frying oil, butter) without changing the dish roster.`,
    validateGate: (state) => {
      const errors: string[] = [];
      if (state.dietitianInvoked) errors.push('Dietitian was invoked! (Deprecated)');
      for (const d of state.extractedDishes) {
        if (!d.weightGrams || d.weightGrams <= 0) {
          errors.push(`Dish "${d.dishName}" is missing valid weightGrams`);
        }
      }
      return { passed: errors.length === 0, errors };
    },
  },

  LEDGER_FINALIZE_AND_COACHING: {
    id: 'LEDGER_FINALIZE_AND_COACHING',
    label: 'Finalize Dish Ledger & Two-Sided Coaching',
    purpose: 'Derive 32 nutrients, enforce single-writer calorie ownership, and emit balanced coaching advice',
    allowedTransitions: [],
    pitfalls: [
      'Multiple writers for calories (finalizeDishLedger must be the sole writer)',
      'Clinical coaching advice outside the 35–70 word range',
      'One-sided negative critique (must balance positive nutrient achievements with alerts)',
    ],
    condition: (state) => state.portionsAudited && !state.ledgerFinalized,
    situationalGuidance: (state) =>
      `[Procedural Node: Ledger Finalize & Coaching]\n` +
      `Compute the final dish ledger nutrients and totals.\n` +
      `Provide a concise 35-70 word clinical coaching narrative in 2nd person:\n` +
      `1. Praise positive nutrient density achieved (e.g. protein, fiber).\n` +
      `2. Alert clearly if sodium or saturated fat exceeds targets.\n` +
      `3. Give one practical movement or hydration action.`,
    validateGate: (state) => {
      const errors: string[] = [];
      if (state.dietitianInvoked) errors.push('Dietitian was invoked! (Deprecated)');
      if (!state.ledgerTotals || typeof state.ledgerTotals.calories !== 'number') {
        errors.push('Missing finalized ledger totals');
      }
      if (!state.clinicalAdvice) {
        errors.push('Missing clinical coaching advice');
      } else {
        const wordCount = state.clinicalAdvice.trim().split(/\s+/).filter(Boolean).length;
        if (wordCount < 35 || wordCount > 75) {
          errors.push(`Clinical advice word count (${wordCount}) outside 35-70 word target band`);
        }
      }
      if (!state.clinicalVerdict) {
        errors.push('Missing clinical verdict level and label');
      }
      return { passed: errors.length === 0, errors };
    },
  },
};

// ============================================================================
// Compare Meals Nodes (Scout Compare Mode D)
// ============================================================================

export const CompareMealsNodes: Record<string, ProceduralNode<CompareMealsState>> = {
  COMPARE_ITEM_EXTRACTION: {
    id: 'COMPARE_ITEM_EXTRACTION',
    label: 'Extract Compare Items & Shelf Choices',
    purpose: 'Identify all selectable items, bakery shelf foods, or menu items into items[]',
    allowedTransitions: ['GROUPING_AND_100G_NORMALIZATION'],
    pitfalls: [
      'Do not write to meal log (must remain EVALUATION ONLY)',
      'Do not drop unlabelled items on the shelf',
      'Retain allExtractedDishes schema parity',
    ],
    condition: (state) => state.extractedItems.length === 0,
    situationalGuidance: (state) =>
      `[Procedural Node: Compare Item Extraction]\n` +
      `Extract all candidate food items, snacks, or bakery options across the ${state.rawInput.photoCount} photos.\n` +
      `Keep EVALUATION ONLY. Do not create a logged meal. Capture exact names, tiers, and label availability.`,
    validateGate: (state) => {
      const errors: string[] = [];
      if (state.dietitianInvoked) errors.push('Dietitian was invoked! (Compare is Scout-only)');
      if (state.extractedItems.length < 2) {
        errors.push(`Compare requires at least 2 items (found ${state.extractedItems.length})`);
      }
      return { passed: errors.length === 0, errors };
    },
  },

  GROUPING_AND_100G_NORMALIZATION: {
    id: 'GROUPING_AND_100G_NORMALIZATION',
    label: 'Group Candidates & Normalize to 100g Metrics',
    purpose: 'Cluster choices into categories and compute both serving and 100g average nutrients',
    allowedTransitions: ['EVALUATE_AND_RECOMMEND'],
    pitfalls: [
      'Comparing raw portions of unequal sizes without 100g normalization',
      'Missing averageNutrientsPer100g on groups',
      'Grouping incompatible food classes together',
    ],
    condition: (state) => state.extractedItems.length >= 2 && !state.normalized,
    situationalGuidance: (state) =>
      `[Procedural Node: Grouping & 100g Normalization]\n` +
      `Group extracted items (${state.extractedItems.length} choices) by nutritional profile.\n` +
      `Ensure every group provides both averageNutrients (per serving) AND averageNutrientsPer100g.`,
    validateGate: (state) => {
      const errors: string[] = [];
      if (state.groups.length === 0) errors.push('No comparison groups were created');
      for (const g of state.groups) {
        if (!g.averageNutrients || typeof g.averageNutrients.calories !== 'number') {
          errors.push(`Group "${g.groupName}" missing averageNutrients`);
        }
        if (!g.averageNutrientsPer100g || typeof g.averageNutrientsPer100g.calories !== 'number') {
          errors.push(`Group "${g.groupName}" missing averageNutrientsPer100g`);
        }
      }
      return { passed: errors.length === 0, errors };
    },
  },

  EVALUATE_AND_RECOMMEND: {
    id: 'EVALUATE_AND_RECOMMEND',
    label: 'Clinical Trade-off Evaluation & Recommendation',
    purpose: 'Select top recommendation based on user allowance and state clear nutritional trade-offs',
    allowedTransitions: [],
    pitfalls: [
      'Overriding user nutrient allowance targets',
      'Conflating compare evaluation with meal logging',
      'Giving a vague recommendation without trade-off justification',
    ],
    condition: (state) => state.normalized && !state.recommendation,
    situationalGuidance: (state) =>
      `[Procedural Node: Evaluate & Recommend]\n` +
      `Evaluate groups against the user's nutrient allowance.\n` +
      `Select the healthiest choice, explain the metabolic trade-offs clearly, and conclude evaluation.`,
    validateGate: (state) => {
      const errors: string[] = [];
      if (!state.recommendation) {
        errors.push('Missing recommendation object');
      } else {
        if (!state.recommendation.recommendedItemOrGroup) errors.push('Missing recommendedItemOrGroup');
        if (!state.recommendation.clinicalTradeOffs) errors.push('Missing clinicalTradeOffs');
      }
      if (!state.evaluationOnlyVerified) {
        errors.push('Failed EVALUATION ONLY invariant: compare must not commit to food log');
      }
      return { passed: errors.length === 0, errors };
    },
  },
};

// ============================================================================
// Procedural Graph Engine Class
// ============================================================================

export class ProceduralGraphEngine<TState extends AddMealState | CompareMealsState> {
  private nodes: Record<string, ProceduralNode<TState>>;
  private rejectionCache: RejectedEdit[] = [];
  private executionTrace: ProceduralGraphExecutionTrace[] = [];

  constructor(nodes: Record<string, ProceduralNode<TState>>, rejectedEdits: RejectedEdit[] = []) {
    this.nodes = nodes;
    this.rejectionCache = [...rejectedEdits];
  }

  public localizeActiveNode(state: TState): ProceduralNode<TState> | null {
    for (const node of Object.values(this.nodes)) {
      if (node.condition(state)) {
        return node;
      }
    }
    return null;
  }

  public getStepGuidance(activeNode: ProceduralNode<TState>, state: TState): {
    guidanceText: string;
    pitfalls: string[];
    guidanceLength: number;
  } {
    const base = activeNode.situationalGuidance(state);
    const pitfallText = activeNode.pitfalls.map((p) => `  ⚠️ Pitfall to avoid: ${p}`).join('\n');
    const guidanceText = `${base}\n\n[Active Safeguards]:\n${pitfallText}`;
    return {
      guidanceText,
      pitfalls: activeNode.pitfalls,
      guidanceLength: guidanceText.length,
    };
  }

  public validateStep(activeNode: ProceduralNode<TState>, state: TState): ProceduralGateResult {
    const res = activeNode.validateGate(state);
    this.executionTrace.push({
      nodeId: activeNode.id,
      stepIndex: this.executionTrace.length + 1,
      timestamp: new Date().toISOString(),
      guidanceLengthChars: activeNode.situationalGuidance(state).length,
      gateResult: res,
      stateSnapshotSummary:
        state.mode === 'add_meal'
          ? `Dishes: ${(state as AddMealState).extractedDishes.length}, PortionsAudited: ${(state as AddMealState).portionsAudited}, LedgerFinalized: ${(state as AddMealState).ledgerFinalized}`
          : `Items: ${(state as CompareMealsState).extractedItems.length}, Groups: ${(state as CompareMealsState).groups.length}, Recommended: ${Boolean((state as CompareMealsState).recommendation)}`,
    });
    return res;
  }

  public checkRejectionCache(sourceNodeId: string, targetNodeId: string): RejectedEdit | undefined {
    return this.rejectionCache.find(
      (r) => r.sourceNodeId === sourceNodeId && r.targetNodeId === targetNodeId
    );
  }

  public addRejection(edit: RejectedEdit) {
    this.rejectionCache.push(edit);
  }

  public getTrace(): ProceduralGraphExecutionTrace[] {
    return this.executionTrace;
  }
}
