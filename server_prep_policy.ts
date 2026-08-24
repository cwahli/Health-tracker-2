import { COMPOUND_BOWL_PATTERN, BEVERAGE_PATTERN, calculateUniversalAddedNutrients } from "./server_food_db";
import { checkIfItemIsAlreadyPrepared } from "./server_pure_helpers";

export function isCompositeDishForm(input: {
  physicalForm?: string | null;
  dishName?: string | null;
  keyword?: string | null;
  canonicalDbName?: string | null;
  componentCount?: number;
  foodType?: string | null;
}): boolean {
  if (input.componentCount !== undefined && input.componentCount >= 2) {
    return true;
  }

  const nameCorpus = [input.dishName, input.keyword, input.canonicalDbName]
    .filter(Boolean)
    .join(" ");

  if (nameCorpus && (COMPOUND_BOWL_PATTERN.test(nameCorpus) || /\b(with\s+rice|and\s+rice|over\s+rice|fried\s+rice|pad\s+thai|stir-?fry|curry|stew|casserole|bento|platter)\b/i.test(nameCorpus))) {
    return true;
  }

  const foodTypeLower = (input.foodType || "").toLowerCase();
  if (
    foodTypeLower.includes("meal bowl") ||
    foodTypeLower.includes("poke") ||
    foodTypeLower.includes("compound_meal") ||
    foodTypeLower.includes("prepared dish") ||
    foodTypeLower.includes("entree")
  ) {
    return true;
  }

  if (
    input.physicalForm === "COMPOUND_MEAL" &&
    /\b(bowl|poke|salad|bento|platter|combo|wrap|burrito|taco|sandwich|entree|prepared dish|rice)\b/i.test(nameCorpus)
  ) {
    return true;
  }

  return false;
}

export function buildFoodMatrix(input: {
  dishName?: string | null;
  keyword?: string | null;
  canonicalDbName?: string | null;
  foodType?: string | null;
}): string {
  const nameCorpus = [input.dishName, input.keyword, input.canonicalDbName].filter(Boolean).join(" ").toLowerCase();
  if (
    input.foodType === 'ultra_processed' ||
    input.foodType === 'root_veg' ||
    nameCorpus.includes('potato') ||
    nameCorpus.includes('wedge') ||
    nameCorpus.includes('fry') ||
    nameCorpus.includes('fries') ||
    nameCorpus.includes('chip')
  ) {
    return 'CELLULAR_STARCH';
  }
  return 'WHOLE_FOOD';
}

export const USER_EXPLICIT_FAT_REGEX = /\b(pan-fried in|fried in|cooked in|basted with|brushed with)\s+(oil|butter|margarine|ghee|fat)\b/i;

export interface PrepPolicyInput {
  weightGrams: number;
  cookingMethod?: string | null;
  physicalForm?: string | null;
  dishName?: string | null;
  keyword?: string | null;
  canonicalDbName?: string | null;
  foodType?: string | null;
  componentCount?: number;
  hasLockedTruth?: boolean;
  userExplicitFat?: boolean;
  userText?: string | null;
  isAlreadyPrepared?: boolean;
  cookingAdded?: { addedCalories?: number; addedFat?: number; addedSaturatedFat?: number; addedSodium?: number } | null;
  visualSheen?: number;
  hasFatBearingComponent?: boolean;
  addDebugLog?: (msg: string) => void;
  visualCoating?: number;
  diningEnvironment?: string;
  hasSauceOrDressing?: boolean;
  proteinMassGrams?: number | null;
  dbSource?: string | null;
}

export interface PrepAddition {
  addedCalories: number;
  addedFat: number;
  addedSaturatedFat: number;
  addedSodium: number;
  reason?: string;
}

export function decidePrepAddition(input: PrepPolicyInput): PrepAddition {
  const zeroPrep: PrepAddition = { addedCalories: 0, addedFat: 0, addedSaturatedFat: 0, addedSodium: 0 };

  if (input.weightGrams <= 0) {
    return { ...zeroPrep, reason: 'zero_weight' };
  }

  if (input.hasLockedTruth) {
    return { ...zeroPrep, reason: 'locked_truth' };
  }

  const isUserExplicit = input.userExplicitFat || (input.userText ? USER_EXPLICIT_FAT_REGEX.test(input.userText) : false);

  const composite = isCompositeDishForm({
    physicalForm: input.physicalForm,
    dishName: input.dishName,
    keyword: input.keyword,
    canonicalDbName: input.canonicalDbName,
    componentCount: input.componentCount,
    foodType: input.foodType,
  });

  if (composite && !isUserExplicit) {
    return { ...zeroPrep, reason: 'composite_dish_suppress_top_level_prep' };
  }

  const nameCorpus = [input.dishName, input.keyword, input.canonicalDbName].filter(Boolean).join(" ");
  const isCookedEntree = /\b(braised?|glazed?|stir-?fry|stir-?fried|fried|baked|curry|stew|roast|roasted|with\s+rice|and\s+rice)\b/i.test(nameCorpus);

  const isWholeFood = (input.physicalForm === 'SOLID_FRUIT_VEG' || input.dbSource === 'canonical_dict') && !composite && !isCookedEntree;
  if (isWholeFood) {
    return { ...zeroPrep, reason: 'raw_whole_food' };
  }

  if (input.hasFatBearingComponent && !isUserExplicit) {
    if (input.addDebugLog) input.addDebugLog('[PrepXOR] Suppressing prep addition because dish has fat-bearing components');
    return { ...zeroPrep, reason: 'prep_xor_fat_bearing' };
  }

  const nameForPreparedCheck = input.dishName || input.keyword || input.canonicalDbName || "";
  const isGlazedOrBraisedSauced = /\b(glazed?|braised?|teriyaki|sweet\s*and\s*sour|kung\s*pao|stir-?fry)\b/i.test(nameForPreparedCheck);
  const itemAlreadyPrep = (input.isAlreadyPrepared ?? checkIfItemIsAlreadyPrepared(nameForPreparedCheck, input.keyword || "", undefined, undefined)) && !isGlazedOrBraisedSauced;

  if (itemAlreadyPrep && !isUserExplicit) {
    return { ...zeroPrep, reason: 'already_prepared' };
  }

  const rawMethod = (input.cookingMethod || 'unknown').toLowerCase();
  if (
    rawMethod === 'raw' ||
    rawMethod === 'brewed' ||
    rawMethod === 'brewed_espresso' ||
    rawMethod === 'poured' ||
    BEVERAGE_PATTERN.test(rawMethod) ||
    (input.foodType && BEVERAGE_PATTERN.test(input.foodType))
  ) {
    return { ...zeroPrep, reason: 'raw_or_beverage' };
  }

  if (input.cookingAdded && !composite && (
    (input.cookingAdded.addedCalories || 0) > 0 ||
    (input.cookingAdded.addedFat || 0) > 0 ||
    (input.cookingAdded.addedSodium || 0) > 0
  )) {
    return {
      addedCalories: Math.round(input.cookingAdded.addedCalories || 0),
      addedFat: Math.round((input.cookingAdded.addedFat || 0) * 10) / 10,
      addedSaturatedFat: Math.round((input.cookingAdded.addedSaturatedFat || 0) * 10) / 10,
      addedSodium: Math.round(input.cookingAdded.addedSodium || 0),
      reason: 'explicit_cooking_added',
    };
  }

  if (rawMethod === 'unknown') {
    return { ...zeroPrep, reason: 'method_unknown' };
  }

  const matrix = buildFoodMatrix({
    dishName: input.dishName,
    keyword: input.keyword,
    canonicalDbName: input.canonicalDbName,
    foodType: input.foodType,
  });

  const effectiveWeight = (input.proteinMassGrams && input.proteinMassGrams > 0) ? input.proteinMassGrams : input.weightGrams;

  const calc = calculateUniversalAddedNutrients(
    matrix,
    rawMethod,
    effectiveWeight,
    input.visualSheen ?? 0.5,
    input.visualCoating ?? 0.5,
    input.diningEnvironment || 'unknown',
    isUserExplicit ? false : itemAlreadyPrep,
    input.hasSauceOrDressing ?? false
  );

  return {
    addedCalories: Math.round(calc.addedCalories),
    addedFat: Math.round(calc.addedFat * 10) / 10,
    addedSaturatedFat: Math.round(calc.addedSaturatedFat * 10) / 10,
    addedSodium: Math.round(calc.addedSodium),
    reason: 'calculated_prep',
  };
}
