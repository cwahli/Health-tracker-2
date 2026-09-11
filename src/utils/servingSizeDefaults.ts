export interface ServingSizeDefault {
  basisType: string;
  label: string;
  grams?: number;
}

export function defaultServingSizeFor(sourceType: 'restaurant' | 'catalog' | 'packaged' | string): ServingSizeDefault {
  switch (sourceType) {
    case 'restaurant':
      return { basisType: 'per_serving', label: '1 serving (restaurant prepared)', grams: 250 };
    case 'catalog':
    case 'usda':
      return { basisType: 'per_100g', label: '100g reference amount', grams: 100 };
    case 'packaged':
      return { basisType: 'per_package', label: '1 package / container', grams: 150 };
    default:
      return { basisType: 'per_serving', label: '1 serving (default)', grams: 100 };
  }
}
