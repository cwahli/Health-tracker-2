export function defaultServingSizeFor(context: 'restaurant' | 'catalog'): { basisType: string; label: string } {
  return context === 'restaurant'
    ? { basisType: 'per_dish', label: 'Per Dish / Portion' }
    : { basisType: 'per_100g', label: 'Per 100g' };
}
