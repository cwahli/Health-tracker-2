/**
 * Pure Generic Matching Engine Module
 * Handles:
 * 1. Generic Diluent & Non-Nutritive Filter (ice, water, sparkling water)
 * 2. Token Coverage Ratio Scoring (|Query Tokens ∩ Candidate Tokens| / |Query Tokens|)
 * 3. Generic Modifier Inversion Engine (rejecting 'sugar-free' when querying 'sugar', 'decaf' when querying 'coffee', etc.)
 */

export interface PhysicalFormClassification {
  physicalForm: 'LIQUID_BEVERAGE' | 'SOLID_CHEESE_DAIRY' | 'VISCOUS_SAUCE' | 'SOLID_MEAT_FISH' | 'SOLID_GRAIN_BAKERY' | 'SOLID_FRUIT_VEG' | 'POWDER_OIL_FAT' | 'COMPOUND_MEAL' | 'UNKNOWN_SOLID';
  primaryCategory: string;
  matchedTokens: string[];
  explanation: string;
}

export function classifyUniversalPhysicalFormV3(item: {
  name?: string;
  canonicalDbName?: string;
  originalLocalName?: string;
  keyword?: string;
  visualIngredients?: string[] | string;
  components?: string[] | string;
  foodType?: string;
}): PhysicalFormClassification {
  const primaryName = (item.canonicalDbName || item.name || '').toLowerCase();
  
  if (Array.isArray(item.components) && item.components.length >= 2 &&
      /\b(salad|bowl|platter|bento|poke)\b/i.test(String(item.originalLocalName || item.keyword || item.name || ''))) {
    return {
      physicalForm: 'COMPOUND_MEAL',
      primaryCategory: 'compound_dish',
      matchedTokens: ['multi-component dish'],
      explanation: 'Forced compound meal for multi-component salad/bowl.'
    };
  }

  const visStr = Array.isArray(item.visualIngredients) ? item.visualIngredients.join(' ') : (item.visualIngredients || '');
  const compStr = Array.isArray(item.components) ? item.components.join(' ') : (item.components || '');

  const textCorpus = [
    item.name || '',
    item.canonicalDbName || '',
    item.originalLocalName || '',
    item.keyword || '',
    visStr,
    compStr
  ].join(' ').toLowerCase();

  const hasWord = (pattern: string) => new RegExp(`\\b${pattern}\\b`, 'i').test(textCorpus);
  const primaryHasWord = (pattern: string) => new RegExp(`\\b${pattern}\\b`, 'i').test(primaryName);

  const MEAT_WORDS = ['steak', 'steaks', 'salmon', 'salmons', 'chicken', 'chickens', 'beef', 'pork', 'fish', 'fishes', 'shrimp', 'shrimps', 'prawn', 'prawns', 'squid', 'squids', 'calamari', 'turkey', 'lamb', 'duck', 'bacon', 'cod', 'catfish', 'tuna', 'meatball', 'meatballs', 'ham', 'sausage', 'sausages', 'pepperoni', 'salami', 'ayam', 'ikan', 'sapi', 'daging', 'lele'];
  const matchedMeats = Array.from(new Set(MEAT_WORDS.filter(w => hasWord(w))));

  // 1. VISCOUS / SAUCE / CONDIMENT DETECTOR (Check sauce FIRST if item name explicitly ends with sauce / dressing / gravy / paste)
  const SAUCE_WORDS = ['sauce', 'sauces', 'dressing', 'dressings', 'mayo', 'mayonnaise', 'ketchup', 'gravy', 'sriracha', 'dip', 'dips', 'condiment', 'condiments', 'pesto', 'hummus', 'guacamole', 'hollandaise', 'teriyaki', 'bumbu', 'kecap', 'salsa', 'relish', 'paste', 'vinaigrette', 'aioli', 'marinara', 'tahini'];
  const matchedSaucesInPrimary = Array.from(new Set(SAUCE_WORDS.filter(w => primaryHasWord(w))));
  if (matchedSaucesInPrimary.length > 0 && matchedMeats.length === 0 && !primaryHasWord('pasta') && !primaryHasWord('spaghetti') && !primaryHasWord('bowl') && !primaryHasWord('poke') && !primaryHasWord('salad') && !primaryHasWord('bento')) {
    return {
      physicalForm: 'VISCOUS_SAUCE',
      primaryCategory: 'sauce_condiment',
      matchedTokens: matchedSaucesInPrimary,
      explanation: `Explicit sauce/condiment name matched: "${matchedSaucesInPrimary.join(', ')}".`
    };
  }

  // BAKERY CONTAINER / DESSERT TERMS & PHRASES (Evaluated early to distinguish standalone bakery from compound meals)
  const PLAIN_BREAD_TERMS = [
    'baguette', 'baguettes', 'bread', 'breads', 'loaf', 'loaves', 'roll', 'rolls', 'bagel', 'bagels',
    'sourdough', 'ciabatta', 'focaccia', 'pretzel', 'pretzels', 'bun', 'buns', 'crumpet', 'crumpets',
    'flatbread', 'pita', 'pitta', 'naan', 'tortilla', 'tortillas', 'roti', 'chapati'
  ];
  const SWEET_BAKERY_TERMS = [
    'pie', 'pies', 'cobbler', 'cobblers', 'tart', 'tarts', 'cake', 'cakes', 'muffin', 'muffins',
    'cookie', 'cookies', 'croissant', 'croissants', 'cheesecake', 'cheesecakes', 'cupcake', 'cupcakes',
    'brownie', 'brownies', 'shortcake', 'crumble', 'strudel', 'turnover', 'turnovers', 'danish', 'pudding',
    'custard', 'praline', 'pralines', 'truffle', 'truffles', 'fudge', 'toffee', 'bonbon', 'bonbons', 'pattie', 'patties', 'patty',
    'pastry', 'pastries', 'swirl', 'swirls', 'brioche', 'scone', 'scones', 'waffle', 'waffles', 'pancake', 'pancakes',
    'eclair', 'eclairs', 'macaron', 'macarons', 'macaroon', 'macaroons', 'churros', 'biscuit', 'biscuits',
    'chocolatine', 'pain suisse'
  ];
  const BAKERY_CONTAINER_TERMS = [...PLAIN_BREAD_TERMS, ...SWEET_BAKERY_TERMS];
  const hasBakeryPhrase = /\b(pain au\b|pain aux\b|pain suisse\b|chausson\b|cinnamon roll\b|cinnamon bun\b|cinnamon swirl\b|danish pastry\b|fruit danish\b|apple turnover\b|raisin swirl\b|raisin pastry\b)/i.test(primaryName) ||
    /\b(pain au\b|pain aux\b|pain suisse\b|chausson\b|cinnamon roll\b|cinnamon bun\b|cinnamon swirl\b|danish pastry\b|fruit danish\b|apple turnover\b|raisin swirl\b|raisin pastry\b)/i.test(textCorpus);
  const hasBakeryContainer = BAKERY_CONTAINER_TERMS.some(w => primaryHasWord(w)) || hasBakeryPhrase;

  // 2. COMPOUND MEAL DETECTOR
  const COMPOUND_BOWL_PATTERN = /\b(bowl|bowls|poke|salad|salads|bento|combo|platter|box|curry|stew|casserole|wrap|burrito|taco|sandwich|sushi|tartare|compound_meal|meal bowl)\b/i;
  const hasMultipleComponents = Array.isArray(item.components) ? item.components.length >= 2 : false;
  const isCompoundName = COMPOUND_BOWL_PATTERN.test(textCorpus);
  const isStandaloneBakery = hasBakeryContainer && !isCompoundName && !hasWord('sandwich') && !hasWord('burger') && !hasWord('wrap');
  const isCompoundMeal = (
    !isStandaloneBakery && (
      hasMultipleComponents ||
      isCompoundName ||
      ((item.foodType || '').toLowerCase().includes('meal bowl') || (item.foodType || '').toLowerCase().includes('poke') || (item.foodType || '').toLowerCase().includes('compound_meal')) ||
      (((hasWord('topped') || hasWord('with') || hasWord('served') || hasWord('and')) &&
        ((hasWord('chicken') || hasWord('beef') || hasWord('bagel') || hasWord('pasta') || hasWord('parmigiana')) && 
         (hasWord('cheese') || hasWord('sauce') || hasWord('dressing')))))
    )
  );

  if (isCompoundMeal && !hasWord('latte') && !hasWord('soup') && !hasWord('macchiato')) {
    return {
      physicalForm: 'COMPOUND_MEAL',
      primaryCategory: 'compound_dish',
      matchedTokens: ['multi-component dish'],
      explanation: 'Detected multi-component dish combining main food item with toppings or sauce.'
    };
  }

  // COMPREHENSIVE PRODUCE LEXICON (Exact singular & plural terms)
  const PRODUCE_WORDS = [
    // Tree & Stone Fruits
    'apple', 'apples', 'pear', 'pears', 'quince', 'quinces',
    'peach', 'peaches', 'nectarine', 'nectarines', 'plum', 'plums', 'apricot', 'apricots',
    'cherry', 'cherries', 'prune', 'prunes', 'persimmon', 'persimmons', 'fig', 'figs', 'date', 'dates',
    // Citrus Fruits
    'orange', 'oranges', 'tangerine', 'tangerines', 'mandarin', 'mandarins', 'clementine', 'clementines',
    'satsuma', 'satsumas', 'grapefruit', 'grapefruits', 'lemon', 'lemons', 'lime', 'limes', 'pomelo', 'kumquat', 'yuzu',
    // Berries & Grapes
    'strawberry', 'strawberries', 'blueberry', 'blueberries', 'raspberry', 'raspberries',
    'blackberry', 'blackberries', 'cranberry', 'cranberries', 'gooseberry', 'gooseberries',
    'elderberry', 'elderberries', 'boysenberry', 'boysenberries', 'mulberry', 'mulberries',
    'currant', 'currants', 'berry', 'berries', 'grape', 'grapes', 'raisin', 'raisins',
    // Tropical, Exotic & Melons
    'banana', 'bananas', 'plantain', 'plantains', 'mango', 'mangoes', 'mangos', 'pineapple', 'pineapples',
    'papaya', 'papayas', 'guava', 'guavas', 'passionfruit', 'dragonfruit', 'lychee', 'rambutan',
    'mangosteen', 'starfruit', 'durian', 'jackfruit', 'breadfruit', 'pomegranate', 'pomegranates',
    'kiwi', 'kiwis', 'kiwifruit', 'avocado', 'avocados', 'coconut', 'coconuts',
    'watermelon', 'watermelons', 'cantaloupe', 'cantaloupes', 'honeydew', 'honeydews', 'melon', 'melons',
    // Vegetables (Root, Leafy, Nightshades, Cruciferous, Gourds, Fungi)
    'tomato', 'tomatoes', 'potato', 'potatoes', 'sweet potato', 'sweet potatoes', 'yam', 'yams', 'cassava', 'taro',
    'broccoli', 'cauliflower', 'cabbage', 'cabbages', 'kale', 'spinach', 'lettuce', 'arugula', 'bok choy', 'chard', 'collard', 'collards', 'sprout', 'sprouts', 'watercress',
    'carrot', 'carrots', 'onion', 'onions', 'garlic', 'shallot', 'shallots', 'leek', 'leeks', 'radish', 'radishes', 'daikon', 'turnip', 'turnips', 'beet', 'beets', 'beetroot', 'beetroots',
    'zucchini', 'zucchinis', 'courgette', 'courgettes', 'eggplant', 'eggplants', 'aubergine', 'aubergines', 'squash', 'squashes', 'pumpkin', 'pumpkins', 'cucumber', 'cucumbers',
    'pepper', 'peppers', 'capsicum', 'capsicums', 'chili', 'chilis', 'chilli', 'chillies', 'celery', 'asparagus', 'artichoke', 'artichokes', 'mushroom', 'mushrooms', 'okra', 'corn', 'maize', 'pea', 'peas', 'green bean', 'green beans', 'edamame',
    // Generic Produce Identifiers
    'fruit', 'fruits', 'vegetable', 'vegetables', 'produce', 'salad', 'salads', 'microgreens'
  ];

  const matchedProduceInCorpus = Array.from(new Set(PRODUCE_WORDS.filter(w => hasWord(w))));
  const matchedProduceInPrimary = Array.from(new Set(PRODUCE_WORDS.filter(w => primaryHasWord(w))));
  const hasProduceWord = matchedProduceInCorpus.length > 0;

  const isExplicitCandy = primaryHasWord('candy') || primaryHasWord('candies') || primaryHasWord('chocolate');
  const isDoughnutWord = primaryHasWord('donut') || primaryHasWord('doughnut');
  // Donut/Doughnut word indicates a pastry UNLESS a produce item (e.g. donut peach, doughnut nectarine) is present
  const isDoughnutPastry = isDoughnutWord && matchedProduceInPrimary.length === 0;

  const isBakeryDessert = (hasBakeryContainer || isExplicitCandy || isDoughnutPastry) &&
    !hasWord('milkshake') && !hasWord('smoothie') && !hasWord('shake');

  // 3. LIQUID BEVERAGE DETECTOR
  const BEVERAGE_WORDS = [
    'coffee', 'espresso', 'latte', 'cappuccino', 'macchiato', 'mocha',
    'tea', 'chai', 'matcha', 'juice', 'soda', 'cola', 'coca', 'pepsi', 'sprite', 'fanta',
    'water', 'smoothie', 'shake', 'milkshake', 'broth', 'soup', 'beverage', 'drink',
    'lemonade', 'cider', 'kombucha', 'beer', 'wine', 'cocktail', 'milk'
  ];

  const matchedBeverages = Array.from(new Set(BEVERAGE_WORDS.filter(w => hasWord(w))));
  const isExplicitCheese = hasWord('cheese') || hasWord('mozzarella') || hasWord('cheddar') || hasWord('parmesan') || hasWord('ricotta') || hasWord('feta') || hasWord('gouda') || hasWord('brie') || hasWord('provolone') || hasWord('paneer') || hasWord('halloumi');
  const isSolidCoconut = hasWord('flesh') || hasWord('copra') || hasWord('flake') || hasWord('shredded');

  // Skip beverage classification if the only matches are soup/broth but there is meat present, or if it's a compound name
  const isSoupWithMeatOrCompound = (matchedBeverages.length > 0 && matchedBeverages.every(w => w === 'soup' || w === 'broth') && (matchedMeats.length > 0 || isCompoundName));

  if (matchedBeverages.length > 0 && !isExplicitCheese && !isSolidCoconut && !isBakeryDessert && !isSoupWithMeatOrCompound) {
    return {
      physicalForm: 'LIQUID_BEVERAGE',
      primaryCategory: 'beverage',
      matchedTokens: matchedBeverages,
      explanation: `Matched liquid beverage keywords: "${matchedBeverages.join(', ')}".`
    };
  }

  // 4. BAKERY / DESSERT DETECTOR
  if (isBakeryDessert) {
    const isPlainBread = PLAIN_BREAD_TERMS.some(w => primaryHasWord(w)) && !SWEET_BAKERY_TERMS.some(w => primaryHasWord(w)) && !hasBakeryPhrase && !isExplicitCandy && !isDoughnutPastry;
    return {
      physicalForm: 'SOLID_GRAIN_BAKERY',
      primaryCategory: isPlainBread ? 'grain_bakery_snack' : 'bakery_dessert',
      matchedTokens: [isPlainBread ? 'bread / roll / grain' : 'baked good / dessert'],
      explanation: isPlainBread ? 'Item identified as standalone bread or roll.' : 'Item identified as a baked good, dessert, or chocolate bar.'
    };
  }

  // 4B. GENERIC MULTI-INGREDIENT COMPOSITE DETECTOR
  const compositeIngredientList = Array.isArray(item.visualIngredients) && item.visualIngredients.length > 0
    ? item.visualIngredients
    : (Array.isArray(item.components) ? item.components : []);
  const distinctIngredientCount = new Set(
    compositeIngredientList
      .map((x: any) => String(typeof x === 'string' ? x : (x?.searchQuery || x?.name || x?.keyword || '')).toLowerCase().trim())
      .filter(Boolean)
  ).size;
  if (distinctIngredientCount >= 3) {
    return {
      physicalForm: 'COMPOUND_MEAL',
      primaryCategory: 'compound_dish',
      matchedTokens: ['multi-ingredient composite dish'],
      explanation: `Item has ${distinctIngredientCount} distinct ingredients/components; classified as a composite dish rather than any single ingredient.`
    };
  }

  // 5. VISCOUS / SAUCE / CONDIMENT DETECTOR (secondary corpus check)
  const matchedSaucesCorpus = Array.from(new Set(SAUCE_WORDS.filter(w => hasWord(w))));
  if (matchedSaucesCorpus.length > 0 && !hasWord('pasta') && !hasWord('spaghetti')) {
    return {
      physicalForm: 'VISCOUS_SAUCE',
      primaryCategory: 'sauce_condiment',
      matchedTokens: matchedSaucesCorpus,
      explanation: `Matched sauce/condiment in text corpus: "${matchedSaucesCorpus.join(', ')}".`
    };
  }

  // 6. SOLID MEAT / FISH / SEAFOOD DETECTOR
  if (matchedMeats.length > 0) {
    return {
      physicalForm: 'SOLID_MEAT_FISH',
      primaryCategory: 'meat_seafood',
      matchedTokens: matchedMeats,
      explanation: `Matched solid meat/fish/seafood: "${matchedMeats.join(', ')}".`
    };
  }

  // 7. SOLID CHEESE & CHEESE BLOCK DETECTOR
  if (isExplicitCheese || (hasWord('butter') && primaryHasWord('butter')) || hasWord('curd')) {
    return {
      physicalForm: 'SOLID_CHEESE_DAIRY',
      primaryCategory: 'dairy_solid',
      matchedTokens: ['cheese/butter'],
      explanation: 'Item is a solid cheese, block of butter, or dairy curd.'
    };
  }

  // 8. RAW / WHOLE FRUIT & VEGETABLE DETECTOR
  const isExplicitFruitType = item.foodType === 'fruit' || item.foodType === 'leafy_veg' || item.foodType === 'root_veg' || item.foodType === 'produce';
  if (hasProduceWord || isExplicitFruitType) {
    const tokens = matchedProduceInCorpus.length > 0 ? matchedProduceInCorpus : [item.foodType || 'fruit/vegetable produce'];
    return {
      physicalForm: 'SOLID_FRUIT_VEG',
      primaryCategory: 'fruit_vegetable',
      matchedTokens: tokens,
      explanation: `Matched fruit/vegetable produce: "${tokens.join(', ')}".`
    };
  }

  // 9. RAW / WHOLE POWDER / OIL / DRY FAT DETECTOR
  const POWDER_OIL_WORDS = ['oil', 'oils', 'flour', 'flours', 'sugar', 'sugars', 'powder', 'powders', 'cocoa', 'salt', 'spice', 'spices', 'baking mix'];
  const matchedPowders = POWDER_OIL_WORDS.filter(w => hasWord(w));
  if (matchedPowders.length > 0) {
    return {
      physicalForm: 'POWDER_OIL_FAT',
      primaryCategory: 'raw_ingredient_dry_fat',
      matchedTokens: matchedPowders,
      explanation: `Matched raw oil, flour, sugar, or dry powder ingredient: "${matchedPowders.join(', ')}".`
    };
  }

  // 10. GRAINS / BREADS / BAKERY / SNACKS DETECTOR
  const GRAIN_WORDS = ['rice', 'bread', 'noodle', 'noodles', 'ramen', 'pasta', 'spaghetti', 'tortilla', 'tortillas', 'bagel', 'bagels', 'porridge', 'oatmeal', 'oat', 'oats', 'pancake', 'pancakes', 'fries', 'chips', 'roll', 'rolls', 'bun', 'buns'];
  const matchedGrains = GRAIN_WORDS.filter(w => hasWord(w));
  if (matchedGrains.length > 0) {
    return {
      physicalForm: 'SOLID_GRAIN_BAKERY',
      primaryCategory: 'grain_bakery_snack',
      matchedTokens: matchedGrains,
      explanation: `Matched grain, bread, pasta, or snack: "${matchedGrains.join(', ')}".`
    };
  }

  return {
    physicalForm: 'UNKNOWN_SOLID',
    primaryCategory: 'general_food',
    matchedTokens: [],
    explanation: 'Default fallback classification.'
  };
}

export interface NutrientVector {
  calories: number;
  protein: number;
  totalFat: number;
  saturatedFat: number;
  transFat: number;
  carbohydrates: number;
  sugar: number;
  sodium: number;
  fiber: number;
  foodType: string;
}

const DILUENT_KEYWORDS = new Set([
  'ice', 'ice_cube', 'ice_cubes', 'crushed_ice', 'water', 'tap_water',
  'drinking_water', 'sparkling_water', 'soda_water', 'club_soda', 'steam'
]);

export function isGenericZeroNutrientDiluent(query: string): boolean {
  if (!query) return false;
  const clean = query.toLowerCase().trim().replace(/[^a-z0-9]/g, '_');
  const tokens = clean.split('_').filter(Boolean);
  return tokens.some(t => DILUENT_KEYWORDS.has(t)) || clean.includes('ice_cube') || clean.includes('sparkling_water');
}

export function getZeroNutrientVector(): NutrientVector {
  return {
    calories: 0,
    protein: 0,
    totalFat: 0,
    saturatedFat: 0,
    transFat: 0,
    carbohydrates: 0,
    sugar: 0,
    sodium: 0,
    fiber: 0,
    foodType: 'unknown'
  };
}

export function calculateGenericTokenCoverage(queryTokens: string[], candidateTokens: string[]): { ratio: number; allMatched: boolean } {
  const stopWords = new Set(['or', 'and', 'with', 'the', 'a', 'an', 'in', 'of', 'for']);
  const nonStopKw = queryTokens.filter(t => !stopWords.has(t.toLowerCase()) && t.length > 1);
  if (nonStopKw.length === 0) return { ratio: 1.0, allMatched: true };

  const SYNONYMS: Record<string, string[]> = {
    'wrap': ['tortilla', 'bread', 'pita', 'flatbread'],
    'tender': ['breast', 'chicken', 'nugget', 'strip'],
    'tenders': ['breast', 'chicken', 'nugget', 'strip'],
    'strip': ['breast', 'chicken', 'tender', 'nugget'],
    'strips': ['breast', 'chicken', 'tender', 'nugget'],
    'greens': ['lettuce', 'salad', 'spinach', 'kale'],
    'salad': ['lettuce', 'greens', 'spinach', 'kale'],
    'marinade': ['sauce', 'dressing', 'glaze'],
    'crispy': ['fresh', 'raw', 'crunchy'],
    'crunchy': ['fresh', 'raw', 'crispy'],
    'baked': ['homemade', 'readytoeat', 'roasted'],
    'falafel': ['homemade'],
    'mayonnaise': ['regular', 'dressing', 'sauce'],
    'garlic': ['mayonnaise', 'sauce'],
    'boiled': ['hardboiled', 'softboiled', 'cooked'],
    'hard': ['hardboiled', 'cooked'],
    'egg': ['hardboiled', 'cooked', 'whole'],
    'breast': ['meat', 'only', 'cooked', 'roasted'],
    'grilled': ['roasted', 'cooked', 'broilers', 'fryers']
  };

  const isTokenMatch = (t1: string, t2: string) => {
    const s1 = t1.toLowerCase();
    const s2 = t2.toLowerCase();
    if (s1 === s2) return true;
    if (s1 + 's' === s2 || s2 + 's' === s1) return true;
    if (s1 + 'es' === s2 || s2 + 'es' === s1) return true;
    if (s1.length >= 4 && s2.length >= 4 && s1.slice(0, 4) === s2.slice(0, 4)) return true;
    
    // Check structural synonyms
    if (SYNONYMS[s2] && SYNONYMS[s2].some(syn => s1 === syn || s1 + 's' === syn || syn + 's' === s1 || (s1.length >= 4 && syn.length >= 4 && s1.slice(0, 4) === syn.slice(0, 4)))) return true;
    if (SYNONYMS[s1] && SYNONYMS[s1].some(syn => s2 === syn || s2 + 's' === syn || syn + 's' === s2 || (s2.length >= 4 && syn.length >= 4 && s2.slice(0, 4) === syn.slice(0, 4)))) return true;

    return false;
  };
  let matchedCount = 0;
  nonStopKw.forEach(kwToken => {
    if (candidateTokens.some(cToken => isTokenMatch(cToken, kwToken))) {
      matchedCount++;
    }
  });

  const ratio = matchedCount / nonStopKw.length;
  return {
    ratio,
    allMatched: matchedCount === nonStopKw.length
  };
}

export function evaluateGenericModifierInversionPenalty(query: string, candidateName: string, diningEnvironment?: string): number {
  const qLower = query.toLowerCase();
  const cLower = candidateName.toLowerCase();

  const INVERSION_PAIRS: Array<{ positive: string[]; negative: string[] }> = [
    { positive: ['sugar', 'syrup', 'sweetened', 'honey', 'caramel'], negative: ['sugar free', 'sugar-free', 'zero sugar', 'no sugar', 'diet', 'unsweetened', 'artificially'] },
    { positive: ['fat', 'butter', 'cream', 'oil', 'lard'], negative: ['fat free', 'fat-free', 'non fat', 'non-fat', '0% fat', 'skim', 'zero fat'] },
    { positive: ['salt', 'sodium', 'salted'], negative: ['salt free', 'salt-free', 'no salt', 'unsalted', 'low sodium', 'sodium free'] },
    { positive: ['caffeine', 'coffee', 'espresso', 'tea'], negative: ['decaf', 'decaffeinated', 'caffeine free', 'caffeine-free'] },
    { positive: ['gluten', 'wheat', 'flour'], negative: ['gluten free', 'gluten-free', 'wheat free'] },
    { positive: ['milk', 'cow milk', 'whole milk', 'fluid milk', 'steamed milk', 'dairy milk', 'skim milk'], negative: ['cheese', 'mozzarella', 'ricotta', 'cheddar', 'parmesan', 'gouda', 'brie', 'swiss', 'jben', 'cottage cheese', 'cream cheese'] },
    { positive: ['cheese', 'mozzarella', 'ricotta', 'cheddar', 'parmesan', 'gouda', 'brie', 'swiss', 'jben'], negative: ['fluid milk', 'steamed milk', 'beverage'] },
    { positive: ['candy', 'candies', 'patty', 'pattie', 'fondant', 'sweet', 'chocolate', 'confection', 'syrup', 'frosting', 'glaze', 'icing', 'filling', 'fudge', 'praline', 'truffle'], negative: ['fresh', 'raw', 'herb', 'leaf', 'leaves', 'uncooked', 'vegetable'] },
    { positive: ['fondant', 'candy', 'candies', 'praline', 'truffle', 'bonbon', 'patty', 'pattie', 'confection'], negative: ['ice cream', 'ice creams', 'sorbet', 'gelato', 'frozen yogurt'] },
    // Strict semantic separation for dips vs dressings (Tahini vs Hummus Tahini)
    { positive: ['tahini', 'tahina', 'sesame paste', 'tahini sauce', 'tahini dressing'], negative: ['hummus', 'houmous', 'chickpea'] },
    // Plant flesh vs seeds/kernels (Roasted squash vs Pumpkin kernels)
    { positive: ['squash', 'pumpkin', 'zucchini', 'gourd', 'eggplant', 'aubergine', 'butternut', 'sweet potato'], negative: ['seed', 'seeds', 'kernel', 'kernels', 'pepitas', 'nut', 'nuts'] }
  ];

  let penalty = 0;

  for (const pair of INVERSION_PAIRS) {
    const queryHasPositive = pair.positive.some(p => qLower.includes(p));
    const queryHasNegative = pair.negative.some(n => qLower.includes(n));

    if (queryHasPositive && !queryHasNegative) {
      const candidateHasNegative = pair.negative.some(n => cLower.includes(n));
      if (candidateHasNegative) {
        penalty += 3000;
      }
    }
  }

  penalty += evaluateUniversalCategoryDisparity(query, candidateName);
  penalty += evaluateEnvironmentPackagingDisparity(query, candidateName, diningEnvironment);

  return penalty;
}

export function evaluateEnvironmentPackagingDisparity(query: string, candidateName: string, diningEnvironment?: string): number {
  if (!diningEnvironment) return 0;
  const env = diningEnvironment.toLowerCase();
  const isFreshSetting = env === 'casual_restaurant' || env === 'home_cooked' || env === 'fine_dining' || env === 'airline';
  if (!isFreshSetting) return 0;

  const cLower = candidateName.toLowerCase();
  const PACKAGED_BRAND_KEYWORDS = ['sera', 'brand', 'jar', 'canned', 'canning', 'brine', 'preserves', 'packaged', 'grocery', 'in oil', 'pickled'];
  const hasPackagingKeyword = PACKAGED_BRAND_KEYWORDS.some(k => cLower.includes(k));

  if (hasPackagingKeyword) {
    return 2500; // Penalize retail jar/can entries in fresh restaurant/home settings
  }
  return 0;
}

export function evaluateUniversalCategoryDisparity(query: string, candidateName: string): number {
  const qForm = classifyUniversalPhysicalFormV3({ name: query });
  const cForm = classifyUniversalPhysicalFormV3({ name: candidateName });

  // 1. Confection/Dessert vs Produce/Herb Disparity
  if (qForm.primaryCategory === 'bakery_dessert' && cForm.primaryCategory === 'fruit_vegetable') {
    return 3000;
  }

  // 1b. Sweet Spread / Jam vs Raw Fruit Disparity
  if (/\b(jam|jelly|preserves?|marmalade|fruit\s*spread|syrup|honey|nutella)\b/i.test(query) &&
      /\b(raw|fresh|unprepared)\b/i.test(candidateName) &&
      !/\b(jam|jelly|preserves?|marmalade|spread|sweetened)\b/i.test(candidateName)) {
    return 3000;
  }

  // 1c. Dressed / Prepared Salad vs Raw Produce Commodity Disparity
  if (/\b(seaweed\s*salad|wakame\s*salad|potato\s*salad|pasta\s*salad|coleslaw|egg\s*salad|chicken\s*salad|tuna\s*salad)\b/i.test(query) &&
      /\b(raw|kelp|seaweed|sea\s*vegetable|potato|pasta|cabbage)\b/i.test(candidateName) &&
      !/\b(salad|prepared|dressed|mayonnaise|sesame\s*oil|vinaigrette)\b/i.test(candidateName)) {
    return 3000;
  }

  // 2. Liquid Beverage vs Solid Cheese/Meat Disparity
  if (qForm.primaryCategory === 'beverage' && (cForm.primaryCategory === 'meat_seafood' || cForm.primaryCategory === 'dairy_solid')) {
    return 3000;
  }

  // 3. Sauce/Condiment vs Bakery/Dessert Disparity
  if (qForm.primaryCategory === 'sauce_condiment' && cForm.primaryCategory === 'bakery_dessert') {
    return 2000;
  }
  // 4. Liquid Beverage vs Solid Grain/Bakery Disparity
  if (qForm.primaryCategory === 'beverage' && cForm.primaryCategory === 'grain_bakery_snack') {
    return 3000;
  }

  return 0;
}
