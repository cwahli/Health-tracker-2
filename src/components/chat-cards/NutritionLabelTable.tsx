import React from 'react';
import { Camera, Search } from 'lucide-react';
import { nutrientDefinitions } from '../../utils/nutrition';
import { translations } from '../../utils/translations';
import { PositionedTooltip } from '../ui/PositionedTooltip';

function parseLabelCalories(raw: any): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'object') {
    const v = raw.calories ?? raw.energy ?? raw.kcal ?? raw['Energy (kcal)'];
    return parseLabelCalories(v);
  }
  const s = String(raw).replace(/,/g, '').trim();

  const kcalMatch = s.match(/(-?\d+(?:\.\d+)?)\s*kcal/i);
  if (kcalMatch) {
    const n = parseFloat(kcalMatch[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const kjMatch = s.match(/(-?\d+(?:\.\d+)?)\s*kj/i);
  if (kjMatch) {
    const kj = parseFloat(kjMatch[1]);
    if (Number.isFinite(kj) && kj > 0) {
      return Math.round((kj / 4.184) * 10) / 10;
    }
  }

  const m = s.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseServingSizeGrams(ssVal: string, totalItemWeight: number): number {
  if (!ssVal) return 100;
  const lower = ssVal.toLowerCase().trim();

  // 1. Explicit gram match e.g. "160g", "160 g", "(160g edible portion)", "per 160g"
  const gMatch = lower.match(/(\d+(?:\.\d+)?)\s*g\b/);
  if (gMatch) {
    const val = parseFloat(gMatch[1]);
    if (val > 0) return val;
  }

  // 2. Explicit ml match e.g. "250ml", "250 ml"
  const mlMatch = lower.match(/(\d+(?:\.\d+)?)\s*ml\b/);
  if (mlMatch) {
    const val = parseFloat(mlMatch[1]);
    if (val > 0) return val;
  }

  // 3. Explicit oz match e.g. "1oz", "1 oz"
  const ozMatch = lower.match(/(\d+(?:\.\d+)?)\s*oz\b/);
  if (ozMatch) {
    const val = parseFloat(ozMatch[1]);
    if (val > 0) return val * 28.35;
  }

  // 4. Fraction of pack/container check if no explicit g/ml match
  const isFractionHalf = lower.includes('1/2') || lower.includes('half');
  const isFractionThird = lower.includes('1/3') || lower.includes('third');
  const isFractionQuarter = lower.includes('1/4') || lower.includes('quarter');

  if (totalItemWeight > 0) {
    if (isFractionHalf) return totalItemWeight / 2;
    if (isFractionThird) return totalItemWeight / 3;
    if (isFractionQuarter) return totalItemWeight / 4;
  }

  // 5. Whole pack/wrap/container or explicit count/piece
  if (lower.includes('pack') || lower.includes('wrap') || lower.includes('container') || lower.includes('tub') || lower.includes('bag') || lower.includes('pouch') || lower.includes('piece') || lower.includes('slice') || lower.includes('portion') || lower.includes('serving') || lower.includes('biscuit') || lower.includes('cookie') || lower.includes('bun') || lower.includes('can') || lower.includes('bottle')) {
    return totalItemWeight > 0 ? totalItemWeight : 100;
  }

  // 6. Generic number match e.g. "160" or "serving (30)"
  const numMatch = lower.match(/[\d.]+/);
  if (numMatch) {
    const val = parseFloat(numMatch[0]);
    // If it's a very small number like 1 or 2, it's almost certainly a piece count, not grams
    if (val <= 10 && totalItemWeight > 0) {
      return totalItemWeight; 
    }
    if (val > 0) return val;
  }

  return 100;
}

function normalizeNutritionKeys(obj: any) {
  if (!obj || typeof obj !== 'object') return obj;
  const normalized: any = {};
  
  // Mapping of variation to standard camelCase keys
  const keyMapping: { [key: string]: string } = {
    'calories': 'calories', 'energy': 'calories', 'energi': 'calories', 'energitotal': 'calories', 'energi total': 'calories',
    'totalfat': 'totalFat', 'lemaktotal': 'totalFat', 'lemak total': 'totalFat',
    'saturatedfat': 'saturatedFat', 'lemakjenuh': 'saturatedFat', 'lemak jenuh': 'saturatedFat',
    'saturatedfatenergy': 'saturatedFatEnergy', 'energidarilemakjenuh': 'saturatedFatEnergy',
    'energyfromfat': 'energyFromFat', 'energidarilemak': 'energyFromFat',
    'totalcarbohydrate': 'totalCarbohydrate', 'totalcarbs': 'totalCarbohydrate', 'karbohidrat': 'totalCarbohydrate', 'karbohidrattotal': 'totalCarbohydrate', 'karbohidrat total': 'totalCarbohydrate',
    'sugar': 'sugar', 'gula': 'sugar', 'gulatotal': 'sugar', 'gula total': 'sugar',
    'salt': 'salt', 'garam': 'salt', 'sodium': 'sodium', 'natrium': 'sodium',
    'protein': 'protein',
    'servingsize': 'servingSize', 'takaransaji': 'servingSize', 'takaran saji': 'servingSize',
    'servingspercontainer': 'servingsPerContainer', 'jumlahsajianperkemasan': 'servingsPerContainer', 'sajianperkemasan': 'servingsPerContainer', 'sajian per kemasan': 'servingsPerContainer'
  };

  Object.keys(obj).forEach(k => {
    const cleanKey = k.toLowerCase().replace(/_/g, '').replace(/-/g, '').trim();
    const standardKey = keyMapping[cleanKey] || k;
    normalized[standardKey] = obj[k];
  });

  if (normalized.calories) {
    const parsedC = parseLabelCalories(normalized.calories);
    if (parsedC !== null && parsedC > 0) {
      normalized.calories = `${parsedC} kcal`;
    }
  }
  
  return normalized;
}

function getSourceBadge(item: any) {
  const subComps = (Array.isArray(item.componentsDetailList) && item.componentsDetailList.length > 0)
    ? item.componentsDetailList
    : ((Array.isArray(item.components) && item.components.length > 0)
      ? item.components
      : ((Array.isArray(item.compositeSiblings) && item.compositeSiblings.length > 0)
        ? item.compositeSiblings
        : ((Array.isArray(item.componentsDetail) && item.componentsDetail.length > 0)
          ? item.componentsDetail
          : [])));
  const isGenuineOcr = (item.dbSource === 'label' || (item.source === 'label' && !item.isComponentOfComposite)) && Boolean(item.rawNutritionLabel && !item.dbSource?.includes('fallback') && !item.dbSource?.includes('composite'));
  const SINGLE_STAPLE_RE = /\b(croissant|croissants|baguette|bread|toast|muffin|scone|cookie|cupcake|biscuit|pancake|waffle|pastry|doughnut|donut|bun|roll|brioche)\b/i;
  const isSingleStaple = SINGLE_STAPLE_RE.test(String(item.originalName || item.name || item.canonicalDbName || ''));
  const isComposite = !isSingleStaple && (item.dbSource === 'composite' || item.isComposite) && Array.isArray(subComps) && subComps.length > 1;
  const brandTitle = item.chainName || item.brand || item.brandName;
  const hasDirectBrandRecord = item.dbSource === 'brand_official' || item.source === 'brand_official' || String(item.dbId || '').includes('brand_menu_') || String(item.fdcId || '').includes('brand_menu_');
  const isBrand = hasDirectBrandRecord && !isComposite;
  const isOFF = item.dbSource === 'off' || item.dbSource === 'open_food_facts' || item.dbSource === 'openfoodfacts';
  const isFallback = item.dbSource === 'category_fallback' || item.dbSource === 'estimated' || String(item.dbId || '').startsWith('fallback_') || String(item.originalName || item.name || '').toLowerCase().includes('category fallback');
  const isUsda = (item.dbSource === 'usda' || item.dbSource === 'canonical_dict' || item.dbSource === 'web_search') && !isGenuineOcr && !isBrand && !isOFF && !isFallback && !isComposite;
  const isVisual = item.source === 'visual' || item.isVisualIdentification || (!isGenuineOcr && !isBrand && !isOFF && !isUsda && !isFallback && !isComposite);

  if (isGenuineOcr) {
    return {
      text: 'Nutrition Facts (OCR Label)',
      className: 'bg-emerald-100/90 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
    };
  }
  if (isComposite && Array.isArray(subComps) && subComps.length > 1) {
    const hasBranded = subComps.some((c: any) => (c.chainName || c.brand || c.brandName || c.dbSource === 'brand_official') && !/^(milk|berry|berries|banana|apple|water|grape|grapes|strawberry|strawberries|blueberries|raspberry|almond|almonds|walnut|fresh fruit|mixed fruits|fruit)$/i.test(String(c.primaryBaseMatchName || c.name || c.keyword || '')));
    const hasFresh = subComps.some((c: any) => !c.chainName && !c.brand && !c.brandName && c.dbSource !== 'brand_official');
    return {
      text: hasBranded && hasFresh ? 'Composite (Brand + Fresh)' : 'Composite',
      className: 'bg-purple-100/90 dark:bg-purple-900/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
    };
  }
  if (isBrand && brandTitle) {
    return {
      text: `${brandTitle} Official`,
      className: 'bg-indigo-100/90 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
    };
  }
  if (isOFF) {
    return {
      text: 'Open Food Facts',
      className: 'bg-sky-100/90 dark:bg-sky-900/60 text-sky-700 dark:text-sky-300 border border-sky-200 dark:border-sky-800'
    };
  }
  if (isUsda || isVisual || !isFallback) {
    return {
      text: 'USDA FoodData Central',
      className: 'bg-blue-100/90 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
    };
  }
  return {
    text: 'Estimated: Category Baseline',
    className: 'bg-amber-100/90 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
  };
}

export function NutritionLabelTable({ activeScoutItems, onConfirmItem, defaultOpen = true, hideOwnToggle = false, language = "en" }: { activeScoutItems: any[], onConfirmItem?: (idx: any) => void, defaultOpen?: boolean, hideOwnToggle?: boolean, language?: string }) {
  const t = translations[language || "en"] || translations.en;
  const [showEstimatedMap, setShowEstimatedMap] = React.useState<Record<number, boolean>>({});
  const toggleShowEstimated = (idx: number) => {
    setShowEstimatedMap(prev => ({ ...prev, [idx]: !prev[idx] }));
  };
  let items = activeScoutItems;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch(e) { items = []; }
  }
  const NON_NUTRIENT_LABEL_KEYS = new Set([
    'servingsize',
    'servingSize',
    'weight',
    'servingspercontainer',
    'servingsPerContainer',
    'basistype',
    'basisType',
    'isdishbasis',
    'isDishBasis',
    'density',
    'servingsizegrams',
    'servingSizeGrams',
    'servings',
    'source',
    'dbsource',
    'dbSource',
    'isrealtruth',
    'isRealTruth',
    'compositesiblings',
    'compositeSiblings'
  ]);

  if (!Array.isArray(items) || !items.length) return null;
  // Only `rawNutritionLabel` is gated on "a real physical panel is visible" — `nutritionFacts`
  // is a general-purpose estimate field and must never be treated as evidence of a real label.
  const expandedItems: any[] = [];
  (items || []).forEach(item => {
    if (!item) return;
    const subComps = (Array.isArray(item.componentsDetailList) && item.componentsDetailList.length > 0)
      ? item.componentsDetailList
      : ((Array.isArray(item.components) && item.components.length > 0)
        ? item.components
        : ((Array.isArray(item.componentsDetail) && item.componentsDetail.length > 0)
          ? item.componentsDetail
          : []));
    
    // Check if subComps contains official / brand / label / truth components
    const officialSubComps: any[] = [];
    const allDishComps: any[] = [];

    if (Array.isArray(subComps) && subComps.length > 0) {
      subComps.forEach((comp: any) => {
        if (!comp) return;
        allDishComps.push(comp);
        const compSrc = String(comp.dbSource || comp.source || '').toLowerCase();
        const isStandardRef = ['canonical_dict', 'canonical', 'internal_catalog', 'usda'].includes(compSrc);
        const rawName = comp.primaryBaseMatchName || comp.name || comp.searchQuery || comp.keyword || comp.dish_name || '';
        const cleanName = String(rawName).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^[📖\s]+/, '').trim();
        const isGenericStaple = /^(milk|berry|berries|banana|apple|water|grape|grapes|strawberry|strawberries|blueberries|raspberry|raspberries|almond|almonds|walnut|fresh fruit|mixed fruits|fruit)$/i.test(cleanName);
        const hasDirectBrand = Boolean((comp.dbId && String(comp.dbId).includes('brand_menu_')) || (comp.fdcId && String(comp.fdcId).includes('brand_menu_')) || (comp.chainName && !isGenericStaple) || (comp.brand && !isGenericStaple));
        const isCompOfficial = !isStandardRef && (comp.dbSource === 'brand_official' || comp.dbSource === 'label' || comp.dbSource === 'off' || comp.dbSource === 'open_food_facts' || comp.dbSource === 'openfoodfacts' || comp.source === 'brand_official' || comp.source === 'label' || Boolean(comp.isRealTruth) || hasDirectBrand);
        const compLabelSource = comp.baseNutrients100g || comp.primaryBase100g || comp.labelNutrientsPerServing || comp.nutrients;
        if (isCompOfficial && (comp.rawNutritionLabel || compLabelSource)) {
          const compWeight = comp.weightGrams || comp.estimatedWeightGrams || comp.primaryBaseWeightG;
          
          // Build pure component raw label from its own 100g source if comp.rawNutritionLabel was cloned from parent or absent
          let compRawLabel = comp.rawNutritionLabel;
          if (compLabelSource && typeof compLabelSource === 'object') {
            const cals = compLabelSource.calories ?? compLabelSource.energy;
            if (cals != null && cals !== '') {
              const calNum = parseLabelCalories(cals) ?? Number(cals);
              compRawLabel = {
                servingSize: '100g',
                basisType: 'per_100g',
                calories: !isNaN(calNum) ? `${calNum} kcal` : `${cals}`,
                protein: compLabelSource.protein != null ? `${compLabelSource.protein}g` : undefined,
                totalFat: (compLabelSource.totalFat ?? compLabelSource.fat) != null ? `${compLabelSource.totalFat ?? compLabelSource.fat}g` : undefined,
                saturatedFat: compLabelSource.saturatedFat != null ? `${compLabelSource.saturatedFat}g` : undefined,
                totalCarbohydrate: (compLabelSource.totalCarbohydrate ?? compLabelSource.carbohydrates ?? compLabelSource.carbs) != null ? `${compLabelSource.totalCarbohydrate ?? compLabelSource.carbohydrates ?? compLabelSource.carbs}g` : undefined,
                sugar: compLabelSource.sugar != null ? `${compLabelSource.sugar}g` : (compLabelSource.addedSugar != null ? `${compLabelSource.addedSugar}g` : undefined),
                addedSugar: compLabelSource.addedSugar != null ? `${compLabelSource.addedSugar}g` : undefined,
                totalFibre: (compLabelSource.totalFibre ?? compLabelSource.fiber) != null ? `${compLabelSource.totalFibre ?? compLabelSource.fiber}g` : undefined,
                sodium: compLabelSource.sodium != null ? `${compLabelSource.sodium}mg` : undefined,
                salt: compLabelSource.salt != null ? `${compLabelSource.salt}g` : undefined
              };
            }
          }

          officialSubComps.push({
            ...comp,
            keyword: cleanName,
            originalName: cleanName,
            name: cleanName,
            chainName: hasDirectBrand ? (comp.chainName || comp.brand || comp.brandName || null) : null,
            brand: hasDirectBrand ? (comp.brand || comp.chainName || comp.brandName || null) : null,
            primaryBaseMatchName: cleanName,
            dbSource: comp.dbSource || comp.source || (hasDirectBrand ? 'brand_official' : 'usda'),
            source: comp.source || comp.dbSource || (hasDirectBrand ? 'brand_official' : 'usda'),
            rawNutritionLabel: compRawLabel,
            nutritionFacts: comp.nutritionFacts || compLabelSource || null,
            labelNutrientsPerServing: compLabelSource,
            primaryBase100g: compLabelSource,
            estimatedWeightGrams: compWeight,
            primaryBaseWeightG: compWeight,
            isRealTruth: Boolean(hasDirectBrand || comp.dbSource === 'brand_official' || comp.rawNutritionLabel),
            isComponentOfComposite: true
          });
        }
      });
    }

    if (officialSubComps.length > 0) {
      officialSubComps.forEach((comp) => {
        // Find sibling ingredients that are NOT this current component
        const siblings = allDishComps.filter((c: any) => {
          const cName = String(c.primaryBaseMatchName || c.name || c.searchQuery || c.keyword || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^[📖\s]+/, '').trim().toLowerCase();
          const compName = String(comp.primaryBaseMatchName || comp.name || comp.keyword || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^[📖\s]+/, '').trim().toLowerCase();
          return cName !== compName && c !== comp;
        });

        expandedItems.push({
          ...comp,
          compositeSiblings: siblings
        });
      });
    } else {
      // Include the top-level dish/item when there are no decomposed official subcomponents
      const isMultiCompComposite = (Array.isArray(subComps) && subComps.length >= 2) || item.dbSource === 'composite';
      const itemLabelSource = item.labelNutrientsPerServing || item.baseNutrients100g || item.primaryBase100g || item.nutritionFacts || item.nutrients || item;
      let itemRawLabel = item.rawNutritionLabel;
      
      if ((!itemRawLabel || Object.keys(normalizeNutritionKeys(itemRawLabel) || {}).length === 0) && itemLabelSource && typeof itemLabelSource === 'object') {
        const cals = itemLabelSource.calories ?? itemLabelSource.energy ?? itemLabelSource.cals ?? item.calories ?? item.energy;
        const protein = itemLabelSource.protein ?? item.protein;
        const totalFat = itemLabelSource.totalFat ?? itemLabelSource.fat ?? item.totalFat ?? item.fat;
        const saturatedFat = itemLabelSource.saturatedFat ?? item.saturatedFat;
        const totalCarbohydrate = itemLabelSource.totalCarbohydrate ?? itemLabelSource.carbohydrates ?? itemLabelSource.carbs ?? item.totalCarbohydrate ?? item.carbohydrates ?? item.carbs;
        const sugar = itemLabelSource.sugar ?? item.sugar;
        const addedSugar = itemLabelSource.addedSugar ?? item.addedSugar;
        const totalFibre = itemLabelSource.totalFibre ?? itemLabelSource.fiber ?? item.totalFibre ?? item.fiber;
        const sodium = itemLabelSource.sodium ?? item.sodium;
        const salt = itemLabelSource.salt ?? item.salt;

        const isDishBasis = itemLabelSource.basisType === 'per_dish' || itemLabelSource.basisType === 'total' || itemLabelSource.basisType === 'per_portion' || itemLabelSource.basisType === 'per_serving' || itemLabelSource.basisType === 'per_pack' || item.basisType === 'per_dish';
        const servingSizeStr = itemLabelSource.servingSizeGrams 
          ? `${itemLabelSource.servingSizeGrams}g` 
          : (isDishBasis ? `${item.estimatedWeightGrams || item.weightGrams || 100}g` : '100g');
        const calNum = parseLabelCalories(cals) ?? Number(cals);

        itemRawLabel = {
          servingSize: servingSizeStr,
          basisType: itemLabelSource.basisType || item.basisType || (isDishBasis ? 'per_dish' : 'per_100g'),
          calories: (cals != null && cals !== '') ? (!isNaN(calNum) ? `${calNum} kcal` : `${cals}`) : undefined,
          protein: protein != null ? `${protein}g` : undefined,
          totalFat: totalFat != null ? `${totalFat}g` : undefined,
          saturatedFat: saturatedFat != null ? `${saturatedFat}g` : undefined,
          totalCarbohydrate: totalCarbohydrate != null ? `${totalCarbohydrate}g` : undefined,
          sugar: sugar != null ? `${sugar}g` : (addedSugar != null ? `${addedSugar}g` : undefined),
          addedSugar: addedSugar != null ? `${addedSugar}g` : undefined,
          totalFibre: totalFibre != null ? `${totalFibre}g` : undefined,
          sodium: sodium != null ? `${sodium}mg` : undefined,
          salt: salt != null ? `${salt}g` : undefined
        };
      }

      expandedItems.push({
        ...item,
        rawNutritionLabel: itemRawLabel || item.rawNutritionLabel || {},
        dbSource: item.dbSource || (isMultiCompComposite ? 'composite' : (item.source === 'label' ? 'label' : 'visual')),
        compositeSiblings: isMultiCompComposite ? allDishComps : []
      });
    }
  });

  const processedItems = expandedItems.map(item => {
    if (!item) return item;
    let parsedRaw = item.rawNutritionLabel;
    if (typeof parsedRaw === 'string') {
      try { parsedRaw = JSON.parse(parsedRaw.replace(/'/g, '"')); } catch (e) { parsedRaw = null; }
    }
    let parsedFacts = item.nutritionFacts;
    if (typeof parsedFacts === 'string') {
      try { parsedFacts = JSON.parse(parsedFacts.replace(/'/g, '"')); } catch (e) { parsedFacts = null; }
    }
    
    let autoCorrectedCalories = item.autoCorrectedCalories || false;
    let originalCalories = item.originalCalories || null;
    let correctedRaw = normalizeNutritionKeys(parsedRaw);
    let correctedFacts = normalizeNutritionKeys(parsedFacts);

    const isRealTruth = item.dbSource === 'label' || item.dbSource === 'brand_official' || item.dbSource === 'label_partial' || item.dbSource === 'off' || item.dbSource === 'open_food_facts' || item.dbSource === 'openfoodfacts' || item.source === 'label' || item.source === 'brand_official' || Boolean(item.isRealTruth);
    const labelSource = item.labelNutrientsPerServing || item.baseNutrients100g || item.primaryBase100g || item.nutritionFacts || item.nutrients;
    if ((!correctedRaw || typeof correctedRaw !== 'object' || Object.keys(correctedRaw).length === 0) && labelSource) {
      const source = labelSource;
      if (source && typeof source === 'object') {
        const cals = source.calories ?? source.energy;
        if (cals != null && cals !== '') {
          const isDishBasis = source.basisType === 'per_dish' || source.basisType === 'total' || source.basisType === 'per_portion' || source.basisType === 'per_serving' || source.basisType === 'per_pack';
          const servingSizeStr = source.servingSizeGrams 
            ? `${source.servingSizeGrams}g` 
            : (isDishBasis ? `${item.estimatedWeightGrams || item.weightGrams || 100}g` : '100g');
          const calNum = parseLabelCalories(cals) ?? Number(cals);
          correctedRaw = {
            servingSize: servingSizeStr,
            basisType: source.basisType || (isDishBasis ? 'per_dish' : 'per_100g'),
            calories: !isNaN(calNum) ? `${calNum} kcal` : `${cals}`,
            protein: source.protein != null ? `${source.protein}g` : undefined,
            totalFat: (source.totalFat ?? source.fat) != null ? `${source.totalFat ?? source.fat}g` : undefined,
            saturatedFat: source.saturatedFat != null ? `${source.saturatedFat}g` : undefined,
            totalCarbohydrate: (source.totalCarbohydrate ?? source.carbohydrates ?? source.carbs) != null ? `${source.totalCarbohydrate ?? source.carbohydrates ?? source.carbs}g` : undefined,
            sugar: source.sugar != null ? `${source.sugar}g` : (source.addedSugar != null ? `${source.addedSugar}g` : undefined),
            addedSugar: source.addedSugar != null ? `${source.addedSugar}g` : undefined,
            totalFibre: (source.totalFibre ?? source.fiber) != null ? `${source.totalFibre ?? source.fiber}g` : undefined,
            sodium: source.sodium != null ? `${source.sodium}mg` : undefined,
            salt: source.salt != null ? `${source.salt}g` : undefined
          };
        }
      }
    }
    
    // Check if anomalyFlags indicate calorie correction
    if (item.anomalyFlags && Array.isArray(item.anomalyFlags)) {
      const calorieFlag = item.anomalyFlags.find((f: string) => f.includes("calories mathematically auto-corrected from"));
      if (calorieFlag) {
        autoCorrectedCalories = true;
        const match = calorieFlag.match(/from (\d+(?:\.\d+)?) to/);
        if (match) {
          originalCalories = match[1];
        }
      }
    }
    
    return { 
      ...item, 
      rawNutritionLabel: correctedRaw, 
      nutritionFacts: correctedFacts,
      autoCorrectedCalories,
      originalCalories,
      isRealTruth
    };
  });

  const hasLabels = processedItems.some((item: any) => {
    if (!item) return false;
    return true;
  });

  if (!hasLabels) return null;

  const renderedItems = processedItems.map((item: any, i: number) => {
            const meaningfulRawKeys = item.rawNutritionLabel
              ? Object.keys(item.rawNutritionLabel).filter((k: string) =>
                  !NON_NUTRIENT_LABEL_KEYS.has(k) &&
                  !NON_NUTRIENT_LABEL_KEYS.has(k.toLowerCase()) &&
                  item.rawNutritionLabel[k] !== undefined &&
                  item.rawNutritionLabel[k] !== null &&
                  item.rawNutritionLabel[k] !== '' &&
                  item.rawNutritionLabel[k] !== '-' &&
                  item.rawNutritionLabel[k] !== '--'
                )
              : [];
            const hasRaw = meaningfulRawKeys.length > 0;
            const hasNut = item.nutritionFacts && Object.keys(item.nutritionFacts).length > 0;
            const hasIngredients = !!(item.ingredientsList && String(item.ingredientsList).trim());

            const isStandaloneLabelPhoto = item.source === 'label' && (!item.estimatedWeightGrams || Number(item.estimatedWeightGrams) === 0);
            const missingWeight = !isStandaloneLabelPhoto && (!item.estimatedWeightGrams || isNaN(Number(item.estimatedWeightGrams)));

            const cleanAnomalyFlags = (item.anomalyFlags || []).filter((f: string) => 
              typeof f === 'string' &&
              !f.includes("Converted printed salt") &&
              !f.includes("Formula: 1g salt") &&
              !f.toLowerCase().includes("converted printed salt")
            );

            const isUnclear = (item.itemConfidence?.toLowerCase().includes('low') || 
                               item.itemConfidence?.toLowerCase().includes('medium')) || 
                              (cleanAnomalyFlags.length > 0);
            const showWarning = missingWeight || isUnclear;

            const saltConversionNoteText = item.saltConversionNote ||
              (Array.isArray(item.anomalyFlags) && item.anomalyFlags.find((f: string) => typeof f === 'string' && f.includes("Converted printed salt"))) ||
              (item.rawNutritionLabel?.salt && (item.rawNutritionLabel?.sodium || item.nutritionFacts?.sodium)
                ? `Converted printed salt (${item.rawNutritionLabel.salt}${item.rawNutritionLabel?.servingSize ? ` per ${item.rawNutritionLabel.servingSize}` : ''}) to sodium. Formula: 1g salt = 400mg sodium.`
                : null);

            // Merge keys for table
            // Defensive guard: if calories are present but every core macro (protein/fat/carbs)
            // reads exactly 0, that pattern means the source data was never actually captured
            // for those fields (a real food with real calories always has non-zero macros
            // somewhere). Treat those specific 0-valued fields as "not captured" and hide them,
            // rather than showing misleading zeros. A genuine single-field zero (e.g. real
            // "0g trans fat" sitting next to normal non-zero macros) is left untouched.
            const parseRowNumber = (raw: any): number | null => {
              if (raw === undefined || raw === null || raw === '') return null;
              const m = String(raw).match(/-?\d+(?:\.\d+)?/);
              return m ? parseFloat(m[0]) : null;
            };
            const calsForZeroCheck = parseLabelCalories(item.rawNutritionLabel?.calories ?? item.nutritionFacts?.calories);
            const macroKeysForZeroCheck = ['protein', 'totalFat', 'totalCarbohydrate', 'carbohydrates'];
            const macroValsForZeroCheck = macroKeysForZeroCheck
              .map(k => parseRowNumber(item.rawNutritionLabel?.[k] ?? item.nutritionFacts?.[k]))
              .filter((v): v is number => v !== null);
            const hasImplausibleAllZeroMacros = (calsForZeroCheck || 0) > 0 &&
              macroValsForZeroCheck.length > 0 &&
              macroValsForZeroCheck.every(v => v === 0);

            const allKeys = Array.from(
              new Set([
                ...(hasRaw ? Object.keys(item.rawNutritionLabel) : []),
                ...(hasNut ? Object.keys(item.nutritionFacts) : []),
              ])
            ).filter((k) => {
              if (NON_NUTRIENT_LABEL_KEYS.has(k) || NON_NUTRIENT_LABEL_KEYS.has(k.toLowerCase())) return false;
              const rawVal = item.rawNutritionLabel?.[k];
              const nutVal = item.nutritionFacts?.[k];
              const val = rawVal !== undefined ? rawVal : nutVal;
              
              if (val === undefined || val === null || val === '' || val === '-' || val === '--') return false;
              const numVal = parseRowNumber(val);
              
              if (hasImplausibleAllZeroMacros && !k.toLowerCase().includes('calorie') && !k.toLowerCase().includes('energy')) {
                if (numVal === 0) return false;
              }
              
              // Hide 0-value trace nutrients for branded/official foods if they weren't explicitly printed on the label.
              // Brand databases often default trace nutrients to 0, which clutters the UI with implausible zeros.
              if (numVal === 0) {
                const isMacro = ['calories', 'protein', 'totalfat', 'fat', 'carbohydrates', 'totalcarbohydrate', 'sodium', 'sugar', 'addedsugar', 'saturatedfat', 'transfat', 'totalfibre', 'fiber'].includes(k.toLowerCase());
                const isOfficial = Boolean(item.chainName || item.brand || item.brandName || item.dbSource === 'brand_official' || item.dbSource === 'label' || item.source === 'brand_official' || item.source === 'label');
                
                if (isOfficial && !isMacro) {
                  // If it's a 0 trace nutrient on a branded food, only show it if the printed label explicitly stated it was 0.
                  if (rawVal === undefined || rawVal === null || rawVal === '') {
                    return false;
                  }
                }
              }
              
              return true;
            });

              const rawTitle = item.primaryBaseMatchName || item.labelProductName || item.scoutOriginalName || item.originalName || item.keyword || 'Food Item';
              const cleanTitle = String(rawTitle)
                .replace(/^Estimated:\s*/i, '')
                .replace(/\s*\(category fallback\)/gi, '')
                .trim();
              const visualText = Array.isArray(item.visualIngredients) && item.visualIngredients.length > 0
                ? item.visualIngredients.join(', ')
                : (item.components || []).map((c: any) => typeof c === 'string' ? c : (c.searchQuery || c.name || c.keyword)).join(', ');
              const mainName = item.originalName || item.keyword || item.primaryBaseMatchName;
              const hasDescription = visualText && visualText.toLowerCase().trim() !== (mainName || '').toLowerCase().trim();
              const cookingMethod = item.cookingMethod || item.cooking_method;
              const sourceBadge = getSourceBadge(item);

              return (
                <div
                  key={`nut-${i}`}
                  className="text-[10px] text-theme-text-secondary bg-slate-50 dark:bg-slate-800/50 p-2.5 rounded-xl border border-theme-border/80"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex flex-col text-left min-w-0">
                      <strong className="block text-slate-800 dark:text-slate-200 font-display text-xs">
                        {(item.chainName || item.brand || item.brandName) && (item.dbSource === 'brand_official' || String(item.dbId || '').includes('brand_menu_') || String(item.fdcId || '').includes('brand_menu_')) ? (
                          <>
                            <span className="text-indigo-500 dark:text-indigo-400">{item.chainName || item.brand || item.brandName}</span>
                            {' · '}
                          </>
                        ) : null}
                        {cleanTitle}
                      </strong>
                      {hasDescription && (
                        <span className="text-[10px] font-medium leading-relaxed text-indigo-600 dark:text-indigo-400 break-words mt-0.5 font-sans">
                          {visualText}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {sourceBadge && (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium shrink-0 ${sourceBadge.className}`}>
                          {sourceBadge.text}
                        </span>
                      )}
                      {cookingMethod && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700 shrink-0 capitalize">
                          {cookingMethod}
                        </span>
                      )}
                    </div>
                  </div>

                <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-[10px]">
                  {item.isRealTruth && (
                    <div className="font-medium text-theme-neutral">
                      <span className="text-slate-400 font-normal">
                        {String(item.rawNutritionLabel?.servingSize || item.nutritionFacts?.servingSize || '').toLowerCase().includes('ml') ? 'Volume:' : t.weightLabelWithColon}
                      </span>{' '}
                      {missingWeight ? <span className="text-amber-500 font-bold">{t.unknown}</span> : `${item.estimatedWeightGrams}${String(item.rawNutritionLabel?.servingSize || item.nutritionFacts?.servingSize || '').toLowerCase().includes('ml') ? 'ml' : 'g'}`}
                    </div>
                  )}
                  {((item.rawNutritionLabel?.servingsPerContainer !== undefined && item.rawNutritionLabel?.servingsPerContainer !== null) || 
                    (item.nutritionFacts?.servingsPerContainer !== undefined && item.nutritionFacts?.servingsPerContainer !== null)) && (
                    <div className="font-medium text-theme-neutral">
                      <span className="text-slate-400 font-normal">{t.servingsPerContainerColon}</span>{' '}
                      {item.rawNutritionLabel?.servingsPerContainer !== undefined && item.rawNutritionLabel?.servingsPerContainer !== null 
                        ? item.rawNutritionLabel.servingsPerContainer 
                        : item.nutritionFacts?.servingsPerContainer}
                    </div>
                  )}
                </div>

                {item.lockedNutrientKeys && Array.isArray(item.lockedNutrientKeys) && item.lockedNutrientKeys.length > 0 && (
                  <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/30 text-[10px] text-amber-800 dark:text-amber-200 flex items-start gap-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 shrink-0 mt-0.5">
                      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
                      <path d="M12 9v4"></path>
                      <path d="M12 17h.01"></path>
                    </svg>
                    <div>
                      <span className="font-bold">Partial Printed Label:</span> Official truth locked for <span className="font-semibold underline">{item.lockedNutrientKeys.join(', ')}</span>. Unprinted macros (<span className="font-bold text-amber-600 dark:text-amber-400">⚠️</span>) are estimated by AI agent heuristic knowledge.
                    </div>
                  </div>
                )}

                {allKeys.length > 0 && (() => {
                  const isKeyLocked = (k: string) => {
                    const standardMapping: Record<string, string> = {
                      calories: 'calories',
                      protein: 'protein',
                      totalfat: 'totalFat',
                      saturatedfat: 'saturatedFat',
                      sodium: 'sodium',
                      totalcarbohydrate: 'carbohydrates',
                      carbohydrates: 'carbohydrates',
                      totalcarbs: 'carbohydrates',
                      totalfibre: 'totalFibre',
                      fiber: 'totalFibre',
                      fibre: 'totalFibre',
                      sugar: 'sugar',
                      addedsugar: 'addedSugar',
                      transfat: 'transFat'
                    };
                    const normKey = standardMapping[k.toLowerCase()] || k;
                    const isFromRawLabel = item.rawNutritionLabel?.[k] !== undefined && 
                                           item.rawNutritionLabel?.[k] !== null && 
                                           item.rawNutritionLabel?.[k] !== '' &&
                                           item.rawNutritionLabel?.[k] !== '-';
                    const normLower = String(normKey).toLowerCase();
                    const kLower = String(k).toLowerCase();
                    const isExplicitlyEstimated = (Array.isArray(item.estimatedFields) && item.estimatedFields.map((f: string) => String(f).toLowerCase()).includes(normLower)) ||
                                                 (Array.isArray(item._estimatedFields) && item._estimatedFields.map((f: string) => String(f).toLowerCase()).includes(normLower));
                    const hasLockedKeys = Array.isArray(item.lockedNutrientKeys) && item.lockedNutrientKeys.length > 0;
                    const inLockedKeys = hasLockedKeys && item.lockedNutrientKeys.some((lk: string) => {
                      const lkLower = String(lk).toLowerCase();
                      return lkLower === normLower ||
                        lkLower === kLower ||
                        (normLower === 'carbohydrates' && (lkLower === 'carbohydrate' || lkLower === 'carbs' || lkLower === 'totalcarbohydrate')) ||
                        (normLower === 'totalfat' && (lkLower === 'fat' || lkLower === 'totalfat')) ||
                        (normLower === 'totalfibre' && (lkLower === 'fiber' || lkLower === 'fibre' || lkLower === 'totalfibre')) ||
                        (normLower === 'calories' && (lkLower === 'energy' || lkLower === 'cals'));
                    });
                    if (isExplicitlyEstimated) return false;
                    if (hasLockedKeys) return inLockedKeys;
                    if (isFromRawLabel) return true;
                    const isCoreMacro = ['calories', 'protein', 'totalfat', 'fat', 'carbohydrates', 'totalcarbohydrate', 'sodium'].includes(kLower) || ['calories', 'protein', 'totalfat', 'carbohydrates', 'sodium'].includes(normLower);
                    return isCoreMacro;
                  };

                  const hasEstimatedNutrients = allKeys.some(k => !isKeyLocked(k));
                  const isEstimatedExpanded = Boolean(showEstimatedMap[i]);
                  const visibleKeys = allKeys.filter(k => isEstimatedExpanded || isKeyLocked(k));

                  return (
                    <div>
                      {visibleKeys.length > 0 && (
                        <div className="overflow-x-auto rounded-lg border border-theme-border/50">
                          <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-slate-100/50 dark:bg-slate-800/50">
                              <th className="py-1.5 px-2 font-bold text-theme-text-secondary border-b border-theme-border/50">
                                Nutrient
                              </th>
                              <th className="py-1.5 px-2 font-bold text-theme-text-secondary border-b border-theme-border/50">
                                {(() => {
                                   const ssRaw = String(item.rawNutritionLabel?.servingSize || item.nutritionFacts?.servingSize || '').trim();
                                   const totalG = (item.primaryBaseWeightG || item.estimatedWeightGrams) ? Number(item.primaryBaseWeightG || item.estimatedWeightGrams) : null;
                                   const ssGramsMatch = ssRaw.match(/^(\d+(?:\.\d+)?)\s*g$/i);
                                   const isExplicit100g = /\b100\s*g\b/i.test(ssRaw);
                                   const bType = item.rawNutritionLabel?.basisType || item.basisType || (isExplicit100g ? 'per_100g' : ((item.source === 'brand_official' || item.brandPriority) ? 'per_dish' : 'per_100g'));
                                   if (bType === 'per_100g' || isExplicit100g) {
                                     return 'Per 100g';
                                   }
                                   if (ssRaw && ssGramsMatch && totalG && Math.abs(parseFloat(ssGramsMatch[1]) - totalG) < 0.5) {
                                     return 'Serving Size (1 dish)';
                                   }
                                   if (ssRaw) return `Serving Size (${ssRaw})`;
                                   if (bType === 'per_dish' || bType === 'total' || bType === 'per_portion') {
                                     return 'Per Dish';
                                   }
                                   return 'Per 100g';
                                })()}
                              </th>
                              <th className="py-1.5 px-2 font-bold text-theme-text-secondary border-b border-theme-border/50 whitespace-nowrap">
                                Total{(item.primaryBaseWeightG || item.estimatedWeightGrams) ? ` (${item.primaryBaseWeightG || item.estimatedWeightGrams}g)` : ''}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                            {visibleKeys.map((k) => {
                              const originalVal = item.rawNutritionLabel?.[k] !== undefined 
                                ? item.rawNutritionLabel?.[k] 
                                : item.nutritionFacts?.[k];
                                
                              const isCalorieKey = k.toLowerCase().includes('calories') || k.toLowerCase().includes('energy');
                              let numVal = null;
                              if (originalVal !== undefined && originalVal !== null) {
                                if (isCalorieKey) {
                                  numVal = parseLabelCalories(originalVal);
                                } else {
                                  const match = String(originalVal).match(/[\d.]+/);
                                  if (match) numVal = parseFloat(match[0]);
                                }
                              }
                              
                              const isServingField = k.toLowerCase().includes('serving');
                              
                              let totalStr = '-';
                              let originalDisplay = '-';
                              
                              if (originalVal !== undefined && originalVal !== null) {
                                const hasUnit = /[a-zA-Z%]/.test(String(originalVal));
                                const nutDef = nutrientDefinitions.find((n: any) => n.key.toLowerCase() === k.toLowerCase());
                                const defaultUnit = isCalorieKey ? 'kcal' : (isServingField ? '' : (nutDef ? nutDef.unit : 'g'));
                                const unit = isCalorieKey ? 'kcal' : (String(originalVal).replace(/[\d.\s]/g, '') || defaultUnit);
                                
                                if (isCalorieKey && numVal !== null) {
                                  originalDisplay = `${numVal} kcal`;
                                } else {
                                  originalDisplay = (hasUnit && !isServingField) ? String(originalVal) : `${originalVal}${defaultUnit}`;
                                }
                                
                                if (numVal !== null && !missingWeight && !isServingField) {
                                  const ssServingSize = String(item.rawNutritionLabel?.servingSize || item.nutritionFacts?.servingSize || '').trim();
                                  const isExplicit100gServing = /\b100\s*g\b/i.test(ssServingSize);
                                  const bType = item.rawNutritionLabel?.basisType || item.basisType || (isExplicit100gServing ? 'per_100g' : ((item.source === 'brand_official' || item.brandPriority) ? 'per_dish' : 'per_100g'));
                                  const isDishBasis = !isExplicit100gServing && (bType === 'per_dish' || bType === 'total' || bType === 'per_portion' || bType === 'per_serving' || bType === 'per_pack');

                                  const weightToDisplay = item.primaryBaseWeightG || item.estimatedWeightGrams || 100;
                                  let labelServingGrams = isDishBasis ? weightToDisplay : 100;
                                  const wasFromRaw = item.rawNutritionLabel?.[k] !== undefined;
                                  
                                  if (wasFromRaw && item.rawNutritionLabel?.servingSize) {
                                     const ssRaw = String(item.rawNutritionLabel.servingSize);
                                     labelServingGrams = parseServingSizeGrams(ssRaw, weightToDisplay);
                                  }
                                  
                                  const multiplier = (isDishBasis && (!item.rawNutritionLabel?.servingSize || item.rawNutritionLabel?.servingSize === '1 dish' || item.rawNutritionLabel?.servingSize === '1 serving'))
                                    ? 1.0 
                                    : (labelServingGrams > 0 ? (weightToDisplay / labelServingGrams) : 1.0);
                                  const total = (numVal * multiplier).toFixed(1).replace(/\.0$/, '');
                                  totalStr = `${total}${unit}`;
                                }
                              }

                              const standardMapping: Record<string, string> = {
                                calories: 'calories',
                                protein: 'protein',
                                totalfat: 'totalFat',
                                saturatedfat: 'saturatedFat',
                                sodium: 'sodium',
                                totalcarbohydrate: 'carbohydrates',
                                carbohydrates: 'carbohydrates',
                                totalcarbs: 'carbohydrates',
                                totalfibre: 'totalFibre',
                                fiber: 'totalFibre',
                                fibre: 'totalFibre',
                                sugar: 'sugar',
                                addedsugar: 'addedSugar',
                                transfat: 'transFat'
                              };
                              const normKey = standardMapping[k.toLowerCase()] || k;

                              const isFromRawLabel = item.rawNutritionLabel?.[k] !== undefined && 
                                                     item.rawNutritionLabel?.[k] !== null && 
                                                     item.rawNutritionLabel?.[k] !== '' &&
                                                     item.rawNutritionLabel?.[k] !== '-';

                              const normLower = String(normKey).toLowerCase();
                              const kLower = String(k).toLowerCase();

                              const isExplicitlyEstimated = (Array.isArray(item.estimatedFields) && item.estimatedFields.map((f: string) => String(f).toLowerCase()).includes(normLower)) ||
                                                           (Array.isArray(item._estimatedFields) && item._estimatedFields.map((f: string) => String(f).toLowerCase()).includes(normLower));

                              const hasLockedKeys = Array.isArray(item.lockedNutrientKeys) && item.lockedNutrientKeys.length > 0;
                              const inLockedKeys = hasLockedKeys && item.lockedNutrientKeys.some((lk: string) => {
                                const lkLower = String(lk).toLowerCase();
                                return lkLower === normLower ||
                                  lkLower === kLower ||
                                  (normLower === 'carbohydrates' && (lkLower === 'carbohydrate' || lkLower === 'carbs' || lkLower === 'totalcarbohydrate')) ||
                                  (normLower === 'totalfat' && (lkLower === 'fat' || lkLower === 'totalfat')) ||
                                  (normLower === 'totalfibre' && (lkLower === 'fiber' || lkLower === 'fibre' || lkLower === 'totalfibre')) ||
                                  (normLower === 'calories' && (lkLower === 'energy' || lkLower === 'cals'));
                              });

                              const isLocked = !isExplicitlyEstimated && (hasLockedKeys ? inLockedKeys : isFromRawLabel);

                              const isSodium = k.toLowerCase().includes('sodium') || k.toLowerCase().includes('salt');

                              const sourceKey = item.nutrientSourceMap?.[k] || item.nutrientSourceMap?.[normKey];
                              const estimateTooltipText = sourceKey === 'usda_database' ? 'From a matched USDA database entry, not the printed label'
                                : sourceKey === 'openfoodfacts_database' ? 'From a matched Open Food Facts database entry, not the printed label'
                                : sourceKey === 'brand_label_data' ? 'From the brand\'s published nutrition data, not this specific printed label'
                                : sourceKey === 'matched_database_entry' ? 'From a matched food database entry, not the printed label'
                                : sourceKey === 'foodtype_estimate' ? 'Estimated from typical values for this type of food — not from a database or label'
                                : 'Estimated — not from a verified label or database';

                              return (
                                <tr key={k} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                                  <td className="py-1.5 px-2 font-medium text-theme-neutral capitalize">
                                    <div className="flex items-center gap-1">
                                      <span>{k.replace(/([A-Z])/g, ' $1').trim()}</span>
                                      {isLocked ? null : (!isServingField && (
                                        <div className="inline-flex items-center ml-1 z-20">
                                          <PositionedTooltip
                                            trigger={
                                              <div
                                                className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 cursor-pointer transition-colors"
                                                aria-label="Estimated value notice"
                                              >
                                                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-500">
                                                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
                                                  <path d="M12 9v4"></path>
                                                  <path d="M12 17h.01"></path>
                                                </svg>
                                                !
                                              </div>
                                            }
                                            content={estimateTooltipText}
                                            contentClassName="bg-slate-900/95 dark:bg-slate-950/95 text-amber-200 border-amber-500/30 text-center text-[10px]"
                                          />
                                        </div>
                                      ))}
                                      {isSodium && saltConversionNoteText && (
                                        <div className="inline-flex items-center z-20 ml-1">
                                          <PositionedTooltip
                                            trigger={
                                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500 hover:text-blue-600 cursor-help shrink-0">
                                                <circle cx="12" cy="12" r="10"></circle>
                                                <line x1="12" y1="16" x2="12" y2="12"></line>
                                                <line x1="12" y1="8" x2="12.01" y2="8"></line>
                                              </svg>
                                            }
                                            content={saltConversionNoteText}
                                            contentClassName="bg-slate-800 text-white text-[10px]"
                                          />
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-1.5 px-2 text-theme-text-secondary relative group/tooltip">
                                    <div className="flex items-center gap-1">
                                      {originalDisplay}
                                      {k.toLowerCase().includes('calories') && item.autoCorrectedCalories && (
                                        <div className="inline-flex items-center z-50 ml-1">
                                          <PositionedTooltip
                                            trigger={
                                              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 cursor-help">
                                                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path>
                                                <path d="M12 9v4"></path>
                                                <path d="M12 17h.01"></path>
                                              </svg>
                                            }
                                            content={t.abnormalValueMsg.replace("{item.originalCalories}", item.originalCalories).replace("{originalDisplay}", originalDisplay)}
                                            contentClassName="bg-slate-800 text-white text-[10px] text-center"
                                          />
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                  <td className="py-1.5 px-2 text-indigo-600 dark:text-indigo-400 font-bold">
                                    {totalStr}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      )}
                      {hasEstimatedNutrients && (
                        <div className="mt-2 text-center font-sans">
                          <button
                            type="button"
                            onClick={() => toggleShowEstimated(i)}
                            className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer inline-flex items-center gap-1 py-1 px-2.5 rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                          >
                            <span>{isEstimatedExpanded ? "Hide estimated nutrients" : "Show estimated nutrients"}</span>
                            <svg
                              className={`w-3.5 h-3.5 transition-transform ${isEstimatedExpanded ? 'rotate-180' : ''}`}
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {item.compositeSiblings && item.compositeSiblings.length > 0 && (
                  <div className="mt-3 pt-2.5 border-t border-theme-border/60">
                    <details className="group [&_summary::-webkit-details-marker]:hidden" open>
                      <summary className="flex items-center gap-1 cursor-pointer font-bold text-theme-text-secondary uppercase tracking-wider text-[9px] select-none">
                        <svg
                          className="w-3 h-3 transition-transform group-open:rotate-90"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                        </svg>
                        <span>Estimated Ingredient Breakdown</span>
                      </summary>
                      <div className="space-y-1.5 mt-2 ml-1">
                        {item.compositeSiblings.map((sib: any, sibIdx: number) => {
                          const sibName = String(sib.primaryBaseMatchName || sib.name || sib.searchQuery || sib.keyword || 'Ingredient')
                            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
                            .replace(/^[📖\s]+/, '')
                            .replace(/\s*\((internal_catalog|usual_catalog|canonical base)\)/gi, '')
                            .trim();
                          const sibWeight = sib.weightGrams || sib.estimatedWeightGrams || 0;
                          const isLiquid = /milk|water|juice|oil|broth|sauce|drink|beverage|soup/i.test(sibName);
                          const unitLabel = isLiquid ? 'ml' : 'g';
                          const sibSrc = String(sib.dbSource || sib.source || '').toLowerCase();
                          const isStandardRef = ['canonical_dict', 'canonical', 'internal_catalog', 'usda'].includes(sibSrc);
                          const isBrand = !isStandardRef && (sib.dbSource === 'brand_official' || sib.source === 'brand_official' || Boolean(sib.brandName || sib.chainName || sib.brand));
                          const brandLabel = sib.chainName || sib.brandName || sib.brand;
                          const isUsda = !isBrand && (sib.dbSource === 'usda' || String(sib.dbId).length > 4 || String(sib.name).includes('fdc.nal.usda.gov'));
                          const isOff = !isBrand && !isUsda && (sib.dbSource === 'off' || sib.source === 'off' || String(sib.name).includes('world.openfoodfacts.org'));
                          const sourceBadge = isBrand
                            ? (brandLabel ? `${brandLabel} Official` : 'Brand Official')
                            : (isUsda 
                                ? 'USDA FoodData Central' 
                                : (isOff
                                    ? 'Open Food Facts'
                                    : (sib.dbSource === 'canonical_dict' ? 'Base Catalog Truth' : 'Standard Reference')));
                          
                          const cals = sib.calories ?? (sib.baseNutrients100g ? Math.round((sib.baseNutrients100g.calories || 0) * (sibWeight / 100)) : null);
                          const protein = sib.protein ?? (sib.baseNutrients100g ? Math.round((sib.baseNutrients100g.protein || 0) * (sibWeight / 100) * 10) / 10 : null);
                          const fat = (sib.totalFat ?? sib.fat) ?? (sib.baseNutrients100g ? Math.round((sib.baseNutrients100g.totalFat ?? sib.baseNutrients100g.fat ?? 0) * (sibWeight / 100) * 10) / 10 : null);
                          const carbs = (sib.carbohydrates ?? sib.carbs ?? sib.totalCarbohydrate) ?? (sib.baseNutrients100g ? Math.round((sib.baseNutrients100g.totalCarbohydrate ?? sib.baseNutrients100g.carbohydrates ?? 0) * (sibWeight / 100) * 10) / 10 : null);
                          const base100gCals = sib.baseNutrients100g?.calories ?? (sibWeight > 0 && cals ? Math.round((cals / sibWeight) * 100) : null);

                          return (
                            <div key={`sib-${sibIdx}`} className="p-2 rounded-lg bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-100/60 dark:border-indigo-900/40 text-[10px]">
                              <div className="flex items-center justify-between gap-2 mb-1">
                                <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                                  <span>{sibName}</span>
                                  <span className="text-slate-500 dark:text-slate-400 font-normal">({sibWeight}{unitLabel})</span>
                                </div>
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8.5px] font-medium bg-indigo-100/80 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300">
                                  [{sourceBadge}]
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-slate-600 dark:text-slate-300 text-[9.5px]">
                                {cals != null && (
                                  <span>
                                    <strong>{cals} kcal</strong>
                                    {base100gCals ? <span className="text-slate-400 font-normal text-[8.5px]"> ({base100gCals} kcal/100{unitLabel})</span> : null}
                                  </span>
                                )}
                                {protein != null && <><span className="text-slate-400 opacity-60">·</span> <span>Protein: <strong>{protein}g</strong></span></>}
                                {fat != null && <><span className="text-slate-400 opacity-60">·</span> <span>Fat: <strong>{fat}g</strong></span></>}
                                {carbs != null && <><span className="text-slate-400 opacity-60">·</span> <span>Carbs: <strong>{carbs}g</strong></span></>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  </div>
                )}

                {item.ingredientsList && String(item.ingredientsList).trim() && (
                  <div className="mt-2.5 p-2 bg-slate-100/60 dark:bg-slate-800/40 rounded-lg text-[9.5px] leading-normal border border-slate-200/40 dark:border-slate-700/30 text-left">
                    <span className="font-bold text-theme-text-secondary uppercase tracking-wider block mb-1 text-[8.5px]">{t.ingredientsLabel}</span>
                    <span className="text-theme-neutral font-normal">{item.ingredientsList}</span>
                  </div>
                )}

                {showWarning && (
                  <div className="mt-2 flex flex-col gap-1.5 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/50 rounded-lg p-2 font-sans">
                    <div className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400">
                      <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div className="flex flex-col">
                        <span className="text-[11px] font-bold leading-tight">
                          {missingWeight ? t.missingPortionSize : t.visualScoutUnclear}
                        </span>
                        <span className="text-[10px] font-medium leading-tight opacity-90 mt-0.5">
                          {isUnclear 
                            ? `Low confidence or anomalies detected (${cleanAnomalyFlags.join(', ') || 'unclear detail'}).` 
                            : t.providePortionSize}
                        </span>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-1">
                      <button 
                        onClick={() => { document.getElementById('food-chat-input')?.focus(); }} 
                        className="flex-1 text-[10px] font-bold bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 py-1.5 px-3 rounded-md shadow-sm hover:bg-amber-50 dark:hover:bg-amber-900/40 active:scale-95 transition-all text-center"
                      >
                        Edit Item
                      </button>
                      <button 
                        onClick={() => { 
                          if (onConfirmItem) {
                            onConfirmItem(item.scoutIndex ?? i);
                          }
                        }} 
                        className="flex-1 text-[10px] font-bold bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 py-1.5 px-3 rounded-md shadow-sm hover:bg-amber-50 dark:hover:bg-amber-900/40 active:scale-95 transition-all text-center"
                      >
                        This is correct
                      </button>
                    </div>
                  </div>
                )}
                {item._preservedAnomalyFlags && item._preservedAnomalyFlags.length > 0 && (
                  <div className="mt-2 text-[10px] text-theme-text-secondary font-sans px-1">
                    t.noteAnomaly
                  </div>
                )}
              </div>
            );
          }).filter(Boolean);

  if (!renderedItems || renderedItems.length === 0) return null;

  const labelsContent = (
    <div className="mt-2 space-y-3 pl-2 border-l-2 border-indigo-100 dark:border-indigo-900/30">
      {renderedItems}
    </div>
  );

  if (hideOwnToggle) {
    return <div className="mt-2 text-left pt-1 font-sans">{labelsContent}</div>;
  }

  return (
    <div className="mt-2 text-left pt-1 font-sans">
      <details className="group [&_summary::-webkit-details-marker]:hidden" open={defaultOpen}>
        <summary className="flex items-center gap-1.5 cursor-pointer text-[10px] font-bold text-indigo-600 dark:text-indigo-400 select-none">
          <span>{t.viewNutritionLabels}</span>
          <svg
            className="w-3 h-3 transition-transform group-open:rotate-180"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        {labelsContent}
      </details>
    </div>
  );
}

export function checkHasNutritionLabels(activeScoutItems: any[]): boolean {
  let items = activeScoutItems;
  if (typeof items === 'string') {
    try { items = JSON.parse(items); } catch(e) { items = []; }
  }
  if (!Array.isArray(items) || !items.length) return false;

  const NON_NUTRIENT_LABEL_KEYS = new Set([
    'servingsize',
    'servingSize',
    'weight',
    'servingspercontainer',
    'servingsPerContainer',
    'basistype',
    'basisType',
    'isdishbasis',
    'isDishBasis',
    'compositesiblings',
    'compositeSiblings'
  ]);

  const expandedItems: any[] = [];
  (items || []).forEach(item => {
    if (!item) return;
    const subComps = (Array.isArray(item.componentsDetailList) && item.componentsDetailList.length > 0)
      ? item.componentsDetailList
      : ((Array.isArray(item.components) && item.components.length > 0)
        ? item.components
        : ((Array.isArray(item.componentsDetail) && item.componentsDetail.length > 0)
          ? item.componentsDetail
          : []));
    
    const officialSubComps: any[] = [];
    const allDishComps: any[] = [];

    if (Array.isArray(subComps) && subComps.length > 0) {
      subComps.forEach((comp: any) => {
        if (!comp) return;
        allDishComps.push(comp);
        const compSrc = String(comp.dbSource || comp.source || '').toLowerCase();
        const isStandardRef = ['canonical_dict', 'canonical', 'internal_catalog', 'usda'].includes(compSrc);
        const isCompOfficial = !isStandardRef && (comp.dbSource === 'brand_official' || comp.dbSource === 'label' || comp.dbSource === 'off' || comp.dbSource === 'open_food_facts' || comp.dbSource === 'openfoodfacts' || comp.source === 'brand_official' || comp.source === 'label' || Boolean(comp.isRealTruth) || (comp.dbId && String(comp.dbId).includes('brand_menu_')) || (comp.fdcId && String(comp.fdcId).includes('brand_menu_')) || Boolean(comp.chainName) || Boolean(comp.brand) || Boolean(comp.brandName));
        const compLabelSource = comp.baseNutrients100g || comp.primaryBase100g || comp.labelNutrientsPerServing || comp.nutrients;
        if (isCompOfficial && (comp.rawNutritionLabel || compLabelSource)) {
          const rawName = comp.primaryBaseMatchName || comp.name || comp.searchQuery || comp.keyword || comp.dish_name;
          const cleanName = String(rawName).replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^[📖\s]+/, '').trim();
          const compWeight = comp.weightGrams || comp.estimatedWeightGrams || comp.primaryBaseWeightG;
          
          let compRawLabel = comp.rawNutritionLabel;
          if (compLabelSource && typeof compLabelSource === 'object') {
            const cals = compLabelSource.calories ?? compLabelSource.energy;
            if (cals != null && cals !== '') {
              const calNum = parseLabelCalories(cals) ?? Number(cals);
              compRawLabel = {
                servingSize: '100g',
                basisType: 'per_100g',
                calories: !isNaN(calNum) ? `${calNum} kcal` : `${cals}`,
                protein: compLabelSource.protein != null ? `${compLabelSource.protein}g` : undefined,
                totalFat: (compLabelSource.totalFat ?? compLabelSource.fat) != null ? `${compLabelSource.totalFat ?? compLabelSource.fat}g` : undefined,
                saturatedFat: compLabelSource.saturatedFat != null ? `${compLabelSource.saturatedFat}g` : undefined,
                totalCarbohydrate: (compLabelSource.totalCarbohydrate ?? compLabelSource.carbohydrates ?? compLabelSource.carbs) != null ? `${compLabelSource.totalCarbohydrate ?? compLabelSource.carbohydrates ?? compLabelSource.carbs}g` : undefined,
                sugar: compLabelSource.sugar != null ? `${compLabelSource.sugar}g` : (compLabelSource.addedSugar != null ? `${compLabelSource.addedSugar}g` : undefined),
                addedSugar: compLabelSource.addedSugar != null ? `${compLabelSource.addedSugar}g` : undefined,
                totalFibre: (compLabelSource.totalFibre ?? compLabelSource.fiber) != null ? `${compLabelSource.totalFibre ?? compLabelSource.fiber}g` : undefined,
                sodium: compLabelSource.sodium != null ? `${compLabelSource.sodium}mg` : undefined,
                salt: compLabelSource.salt != null ? `${compLabelSource.salt}g` : undefined
              };
            }
          }

          officialSubComps.push({
            ...comp,
            name: cleanName,
            originalName: cleanName,
            keyword: cleanName,
            chainName: comp.chainName || comp.brand || comp.brandName || null,
            brand: comp.brand || comp.chainName || comp.brandName || null,
            rawNutritionLabel: compRawLabel
          });
        }
      });
    }

    if (officialSubComps.length > 0) {
      officialSubComps.forEach((comp) => {
        expandedItems.push(comp);
      });
    }

    const isMultiCompComposite = (Array.isArray(subComps) && subComps.length >= 2) || item.dbSource === 'composite';
    const itemLabelSource = item.labelNutrientsPerServing || item.baseNutrients100g || item.primaryBase100g || item.nutritionFacts || item.nutrients;
    let itemRawLabel = item.rawNutritionLabel;
    
    if ((!itemRawLabel || Object.keys(normalizeNutritionKeys(itemRawLabel) || {}).length === 0) && itemLabelSource && typeof itemLabelSource === 'object') {
      const cals = itemLabelSource.calories ?? itemLabelSource.energy;
      if (cals != null && cals !== '') {
        const isDishBasis = itemLabelSource.basisType === 'per_dish' || itemLabelSource.basisType === 'total' || itemLabelSource.basisType === 'per_portion' || itemLabelSource.basisType === 'per_serving' || itemLabelSource.basisType === 'per_pack';
        const servingSizeStr = itemLabelSource.servingSizeGrams 
          ? `${itemLabelSource.servingSizeGrams}g` 
          : (isDishBasis ? `${item.estimatedWeightGrams || item.weightGrams || 100}g` : '100g');
        const calNum = parseLabelCalories(cals) ?? Number(cals);
        itemRawLabel = {
          servingSize: servingSizeStr,
          basisType: itemLabelSource.basisType || (isDishBasis ? 'per_dish' : 'per_100g'),
          calories: !isNaN(calNum) ? `${calNum} kcal` : `${cals}`,
          protein: itemLabelSource.protein != null ? `${itemLabelSource.protein}g` : undefined,
          totalFat: (itemLabelSource.totalFat ?? itemLabelSource.fat) != null ? `${itemLabelSource.totalFat ?? itemLabelSource.fat}g` : undefined,
          saturatedFat: itemLabelSource.saturatedFat != null ? `${itemLabelSource.saturatedFat}g` : undefined,
          totalCarbohydrate: (itemLabelSource.totalCarbohydrate ?? itemLabelSource.carbohydrates ?? itemLabelSource.carbs) != null ? `${itemLabelSource.totalCarbohydrate ?? itemLabelSource.carbohydrates ?? itemLabelSource.carbs}g` : undefined,
          sugar: itemLabelSource.sugar != null ? `${itemLabelSource.sugar}g` : (itemLabelSource.addedSugar != null ? `${itemLabelSource.addedSugar}g` : undefined),
          addedSugar: itemLabelSource.addedSugar != null ? `${itemLabelSource.addedSugar}g` : undefined,
          totalFibre: (itemLabelSource.totalFibre ?? itemLabelSource.fiber) != null ? `${itemLabelSource.totalFibre ?? itemLabelSource.fiber}g` : undefined,
          sodium: itemLabelSource.sodium != null ? `${itemLabelSource.sodium}mg` : undefined,
          salt: itemLabelSource.salt != null ? `${itemLabelSource.salt}g` : undefined
        };
      }
    }

    if (itemRawLabel && Object.keys(normalizeNutritionKeys(itemRawLabel) || {}).length > 0) {
      expandedItems.push({
        ...item,
        rawNutritionLabel: itemRawLabel
      });
    }
  });

  const processedItems = expandedItems.map(item => {
    if (!item) return item;
    let parsedRaw = item.rawNutritionLabel;
    if (typeof parsedRaw === 'string') {
      try { parsedRaw = JSON.parse(parsedRaw.replace(/'/g, '"')); } catch (e) { parsedRaw = null; }
    }
    let correctedRaw = normalizeNutritionKeys(parsedRaw);
    const isRealTruth = item.dbSource === 'label' || item.dbSource === 'brand_official' || item.dbSource === 'label_partial' || item.dbSource === 'off' || item.dbSource === 'open_food_facts' || item.dbSource === 'openfoodfacts' || item.source === 'label' || item.source === 'brand_official' || Boolean(item.isRealTruth);
    const labelSource = item.labelNutrientsPerServing || item.baseNutrients100g || item.primaryBase100g || item.nutritionFacts || item.nutrients;
    if ((!correctedRaw || typeof correctedRaw !== 'object' || Object.keys(correctedRaw).length === 0) && labelSource) {
      const source = labelSource;
      if (source && typeof source === 'object') {
        const cals = source.calories ?? source.energy;
        if (cals != null && cals !== '') {
          const isDishBasis = source.basisType === 'per_dish' || source.basisType === 'total' || source.basisType === 'per_portion' || source.basisType === 'per_serving' || source.basisType === 'per_pack';
          const servingSizeStr = source.servingSizeGrams 
            ? `${source.servingSizeGrams}g` 
            : (isDishBasis ? `${item.estimatedWeightGrams || item.weightGrams || 100}g` : '100g');
          const calNum = parseLabelCalories(cals) ?? Number(cals);
          correctedRaw = {
            servingSize: servingSizeStr,
            basisType: source.basisType || (isDishBasis ? 'per_dish' : 'per_100g'),
            calories: !isNaN(calNum) ? `${calNum} kcal` : `${cals}`,
            protein: source.protein != null ? `${source.protein}g` : undefined,
            totalFat: (source.totalFat ?? source.fat) != null ? `${source.totalFat ?? source.fat}g` : undefined,
            saturatedFat: source.saturatedFat != null ? `${source.saturatedFat}g` : undefined,
            totalCarbohydrate: (source.totalCarbohydrate ?? source.carbohydrates ?? source.carbs) != null ? `${source.totalCarbohydrate ?? source.carbohydrates ?? source.carbs}g` : undefined,
            sugar: source.sugar != null ? `${source.sugar}g` : (source.addedSugar != null ? `${source.addedSugar}g` : undefined),
            addedSugar: source.addedSugar != null ? `${source.addedSugar}g` : undefined,
            totalFibre: (source.totalFibre ?? source.fiber) != null ? `${source.totalFibre ?? source.fiber}g` : undefined,
            sodium: source.sodium != null ? `${source.sodium}mg` : undefined,
            salt: source.salt != null ? `${source.salt}g` : undefined
          };
        }
      }
    }
    
    return { 
      ...item, 
      rawNutritionLabel: correctedRaw
    };
  });

  const hasAnyMeaningfulLabel = processedItems.some(item => {
    if (!item || !item.rawNutritionLabel || typeof item.rawNutritionLabel !== 'object') return false;
    const meaningfulKeys = Object.keys(item.rawNutritionLabel).filter(k => 
      !NON_NUTRIENT_LABEL_KEYS.has(k) &&
      !NON_NUTRIENT_LABEL_KEYS.has(k.toLowerCase()) &&
      item.rawNutritionLabel[k] !== undefined &&
      item.rawNutritionLabel[k] !== null &&
      item.rawNutritionLabel[k] !== '' &&
      item.rawNutritionLabel[k] !== '-' &&
      item.rawNutritionLabel[k] !== '--'
    );
    return meaningfulKeys.length > 0;
  });

  return hasAnyMeaningfulLabel;
}
