/**
 * server_food_flags.ts
 *
 * Feature flag definitions for food calculation pipeline inversion:
 * - FOOD_DISH_ESTIMATE: Direct dish-level estimate with USDA as atomic dictionary.
 */

export function isDishEstimateEnabled(req?: any): boolean {
  if (req?.body?.flags?.foodDishEstimate !== undefined) {
    return Boolean(req.body.flags.foodDishEstimate);
  }
  if (process.env.FOOD_DISH_ESTIMATE !== undefined) {
    return process.env.FOOD_DISH_ESTIMATE === '1' || process.env.FOOD_DISH_ESTIMATE === 'true';
  }
  // Default is true for the inverted dish estimate pipeline
  return true;
}
