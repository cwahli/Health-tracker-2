/**
 * server_derivation.ts
 *
 * Pure TypeScript derivation utilities for nutrients:
 * - Unsaturated Fat (g) = Math.max(0, TotalFat - (SaturatedFat + TransFat))
 * - Salt (g) = (Sodium in mg * 2.54) / 1000
 * - Carbohydrates from energy (g) = Math.max(0, (Calories - (4 * Protein) - (9 * TotalFat)) / 4) [Fallback only when C is missing]
 */

export function computeUnsaturatedFat(totalFat?: number | null, saturatedFat?: number | null, transFat?: number | null): number {
  const tf = totalFat ?? 0;
  const sf = saturatedFat ?? 0;
  const tr = transFat ?? 0;
  const raw = tf - (sf + tr);
  return Math.max(0, Math.round(raw * 10) / 10);
}

export function computeSaltFromSodium(sodiumMg?: number | null): number {
  const na = sodiumMg ?? 0;
  const rawSalt = (na * 2.54) / 1000;
  return Math.round(rawSalt * 100) / 100;
}

export function deriveCarbohydratesFromEnergy(calories?: number | null, protein?: number | null, totalFat?: number | null): number {
  const cal = calories ?? 0;
  const p = protein ?? 0;
  const tf = totalFat ?? 0;
  const rawCarbs = (cal - 4 * p - 9 * tf) / 4;
  return Math.max(0, Math.round(rawCarbs * 10) / 10);
}

export interface BaseNutrientInputs {
  calories?: number | null;
  protein?: number | null;
  totalFat?: number | null;
  saturatedFat?: number | null;
  transFat?: number | null;
  sodium?: number | null;
  carbohydrates?: number | null;
}

export interface DerivedNutrientOutputs {
  unsaturatedFat: number;
  salt: number;
  carbohydrates: number;
}

export function calculateDerivedNutrients(base: BaseNutrientInputs): DerivedNutrientOutputs {
  const unsaturatedFat = computeUnsaturatedFat(base.totalFat, base.saturatedFat, base.transFat);
  const salt = computeSaltFromSodium(base.sodium);
  // Carbohydrates: use emitted value if present, else derive from energy equation
  const carbohydrates = base.carbohydrates !== undefined && base.carbohydrates !== null
    ? Math.round(base.carbohydrates * 10) / 10
    : deriveCarbohydratesFromEnergy(base.calories, base.protein, base.totalFat);

  return {
    unsaturatedFat,
    salt,
    carbohydrates,
  };
}
