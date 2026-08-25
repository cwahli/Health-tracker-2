/**
 * server_dish_classify.ts
 *
 * Shared classification utilities for dishes:
 * - PARENT_DISH_RE: Regular expression to identify parent composed meals (sandwiches, salads, sushi, bowls, etc.)
 * - isStandaloneCondimentPacket: Distinguishes standalone condiments from parent dishes containing sauces/dressings
 * - classifyDishAtomic: Distinguishes atomic single-staple commodities from composed culinary dishes
 */

export const PARENT_DISH_RE = /\b(sandwiches|sandwich|wraps|wrap|salads|salad|bowls|bowl|smoothies|smoothie|parfaits|parfait|cakes|cake|pies|pie|soups|soup|burgers|burger|subs|sub|toasties|toastie|burritos|burrito|tacos|taco|paninis|panini|noodles|noodle|pastas|pasta|fried rice|stir-?fries|stir-?fry|fries|chips|sushi|maki|nigiri|pizzas|pizza|curries|curry|omelettes|omelette|omelets|omelet|macaroni|risotto|stews|stew|casseroles|casserole|biryani|rolls|roll|steak|steaks|plate|plates|platter|platters|meal|meals|combo|combos|skewer|skewers|kebab|kebabs|meat|chicken|pork|fish|seafood|beef)\b/i;

export const CONDIMENT_RE = /\b(mayonnaise|mayo|ranch|dressing|sauce|ketchup|mustard|dip)\b/i;

export function isStandaloneCondimentPacket(item: {
  originalName?: string | null;
  keyword?: string | null;
}): boolean {
  const haystack = `${item.originalName || ''} ${item.keyword || ''}`;
  if (!CONDIMENT_RE.test(haystack)) return false;
  if (PARENT_DISH_RE.test(haystack)) return false;
  return true;
}

export const COMPOSED_IDIOM_RE = /\b(grilled cheese|butter chicken|macaroni and cheese|cheese pizza|avocado toast|chicken rice|fried rice)\b/i;

export const STAPLE_PHRASES = new Set([
  'croissant', 'croissants', 'butter croissant', 'dinner roll', 'baguette', 'bread', 'toast',
  'muffin', 'scone', 'cookie', 'cupcake', 'biscuit', 'pancake', 'waffle', 'pastry',
  'doughnut', 'donut', 'bun', 'brioche', 'banana', 'apple', 'orange', 'pear', 'plum',
  'egg', 'eggs', 'boiled egg', 'poached egg', 'fried egg', 'scrambled egg',
  'milk', 'butter', 'ghee', 'oil', 'jam', 'preserves', 'marmalade',
  'strawberry jam', 'raspberry jam', 'apricot jam', 'fruit jam', 'peanut butter',
  'honey', 'yogurt drink', 'actimel', 'chicken breast', 'rice', 'white rice', 'brown rice',
  'oat', 'oats', 'rolled oats', 'oatmeal', 'yogurt', 'yoghurt', 'cheese', 'avocado',
  'coffee', 'espresso', 'latte', 'water', 'tea', 'ketchup', 'mustard', 'mayonnaise', 'mayo',
  'pain au chocolat', 'tofu', 'edamame', 'kimchi', 'naan', 'pita', 'roti',
]);

// Staples that contain a word from PARENT_DISH_RE (e.g. "roll", "croissant", "chicken")
const STAPLE_PHRASES_WITH_PARENT_TOKENS = new Set([
  'dinner roll', 'butter croissant', 'pain au chocolat', 'baguette', 'chicken breast', 'salmon fillet', 'beef steak'
]);

export function residualStaplePhrase(raw: string): string {
  let s = (raw || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/^\d+\s+/, '').replace(/^(two|three|four|a|an)\s+/, '');
  s = s.replace(/^(yolk|duerr'?s|sainsbury'?s?|heinz|lurpak|mcdonald'?s?|starbucks)\s+/, '');
  s = s.replace(/^(grilled|roasted|baked|fried|steamed|boiled|raw|fresh|organic|whole|sliced|cut|salted|unsalted|smoked|poached|spreadable|french)\s+/, '');
  s = s.replace(/\s+(packet|sachet|pot|bottle|can|cup|slice|slices|piece|pieces)$/, '');
  return s.trim();
}

export function classifyDishAtomic(item: {
  originalName?: string | null;
  keyword?: string | null;
  ingredients?: string[] | null;
}): 'atomic' | 'composed' {
  const originalName = item.originalName || '';
  const keyword = item.keyword || '';
  const combinedName = `${originalName} ${keyword}`.trim();

  // Composed idioms like "grilled cheese", "butter chicken", "fried rice" are always composed
  if (COMPOSED_IDIOM_RE.test(originalName) || COMPOSED_IDIOM_RE.test(keyword) || COMPOSED_IDIOM_RE.test(combinedName)) {
    return 'composed';
  }

  // Check originalName and keyword residuals
  const resOriginal = residualStaplePhrase(originalName);
  const resKeyword = residualStaplePhrase(keyword);

  // If a parent dish token is present (e.g. sushi roll, noodle bowl, sandwich, fried rice)
  if (PARENT_DISH_RE.test(originalName) || PARENT_DISH_RE.test(keyword)) {
    // Only atomic if the residual itself is an explicit staple phrase (e.g. "dinner roll")
    if (STAPLE_PHRASES_WITH_PARENT_TOKENS.has(resOriginal) || STAPLE_PHRASES_WITH_PARENT_TOKENS.has(resKeyword)) {
      return 'atomic';
    }
    return 'composed';
  }

  // If either clean residual matches a known staple commodity
  if (STAPLE_PHRASES.has(resOriginal) || STAPLE_PHRASES.has(resKeyword)) {
    return 'atomic';
  }

  const resCombined = residualStaplePhrase(combinedName);
  if (STAPLE_PHRASES.has(resCombined)) {
    return 'atomic';
  }

  // Single ingredient / single word fallback
  const distinct = new Set((item.ingredients || []).map(s => s.trim().toLowerCase()).filter(Boolean));
  if (distinct.size <= 1 && (resOriginal.split(' ').length <= 1 || resKeyword.split(' ').length <= 1) && (resOriginal.length > 0 || resKeyword.length > 0)) {
    return 'atomic';
  }

  return 'composed';
}

export type ContainerForm = 'sizzling_skillet' | 'side_bowl' | 'entree_plate' | 'unbounded';

export const CONTAINER_MAX_CAPACITIES_GRAMS: Record<ContainerForm, number> = {
  sizzling_skillet: 320,
  side_bowl: 220,
  entree_plate: 650,
  unbounded: 2500,
};

export function detectContainerForm(haystack: string): ContainerForm {
  const s = haystack.toLowerCase();
  if (/\b(sizzling|skillet|hot\s*plate|cast\s*iron)\b/i.test(s)) return 'sizzling_skillet';
  if (/\b(side\s*bowl|soup\s*bowl)\b/i.test(s) && !/\b(entree|main|plate|tray|board)\b/i.test(s)) return 'side_bowl';
  return 'unbounded';
}

export function reconcileContainerVolumeBudget(items: any[], addDebugLog?: (msg: string) => void): any[] {
  if (!items || items.length === 0) return items || [];

  const imageGroups = new Map<number, any[]>();
  items.forEach((it, idx) => {
    const imgIdx = it.sourceImageIndex ?? 0;
    if (!imageGroups.has(imgIdx)) imageGroups.set(imgIdx, []);
    imageGroups.get(imgIdx)!.push({ ...it, _origIdx: idx });
  });

  const updatedItems = items.map(it => ({ ...it }));

  for (const [imgIdx, imgItems] of imageGroups.entries()) {
    const combinedText = imgItems.map(it => `${it.originalName || ''} ${it.keyword || ''}`).join(' ');
    const container = detectContainerForm(combinedText);

    if (container !== 'unbounded' && container !== 'entree_plate') {
      const maxCapacity = CONTAINER_MAX_CAPACITIES_GRAMS[container];
      const totalWeight = imgItems.reduce((sum, it) => sum + (Number(it.estimatedWeightGrams) || 0), 0);

      if (totalWeight > maxCapacity && maxCapacity > 0) {
        const scaleFactor = maxCapacity / totalWeight;
        if (addDebugLog) {
          addDebugLog(`[Container Volume Budget] Image ${imgIdx} (${container}) total weight ${totalWeight}g exceeds capacity ${maxCapacity}g. Scaling co-located items by factor ${(scaleFactor).toFixed(2)}.`);
        }
        imgItems.forEach(it => {
          const origW = Number(it.estimatedWeightGrams) || 100;
          const newW = Math.max(15, Math.round(origW * scaleFactor));
          const target = updatedItems[it._origIdx];
          target.estimatedWeightGrams = newW;
          target.nutrientBasisWeight = newW;
          if (target.nutrients && typeof target.nutrients === 'object') {
            for (const [k, v] of Object.entries(target.nutrients)) {
              if (typeof v === 'number' && Number.isFinite(v)) {
                target.nutrients[k] = (k === 'calories' || k === 'sodium' || k === 'potassium' || k === 'calcium' || k === 'magnesium')
                  ? Math.round(v * scaleFactor)
                  : Math.round(v * scaleFactor * 10) / 10;
              }
            }
          }
        });

        let curSum = imgItems.reduce((s, it) => s + updatedItems[it._origIdx].estimatedWeightGrams, 0);
        while (curSum > maxCapacity) {
          const largest = imgItems.map(it => updatedItems[it._origIdx]).sort((a, b) => b.estimatedWeightGrams - a.estimatedWeightGrams)[0];
          largest.estimatedWeightGrams -= 1;
          largest.nutrientBasisWeight = largest.estimatedWeightGrams;
          curSum -= 1;
        }
      }
    }
  }

  return updatedItems;
}

