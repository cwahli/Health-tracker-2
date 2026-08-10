import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Info, Sparkles, Database, CheckCircle2, Droplets, Utensils, Pizza, Carrot, Wheat, Package, Coffee, HelpCircle } from 'lucide-react';
import { FoodItemBreakdown, PhysicalFormClassification } from '../types';

// Client-side classifier fallback so 100% of items display classification info even if logged earlier
export function classifyUniversalPhysicalFormClient(item: {
  name?: string;
  canonicalDbName?: string;
  originalLocalName?: string;
  keyword?: string;
  visualIngredients?: string[] | string;
  components?: string[] | string;
}): PhysicalFormClassification {
  const primaryName = (item.canonicalDbName || item.name || '').toLowerCase();
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

  // 1. COMPOUND MEAL DETECTOR
  const isCompoundMeal = (
    (hasWord('topped') || hasWord('with') || hasWord('served') || hasWord('and')) &&
    ((hasWord('chicken') || hasWord('beef') || hasWord('bagel') || hasWord('pasta') || hasWord('parmigiana')) && 
     (hasWord('cheese') || hasWord('sauce') || hasWord('dressing')))
  );
  if (isCompoundMeal && !hasWord('latte') && !hasWord('soup') && !hasWord('macchiato')) {
    return {
      physicalForm: 'COMPOUND_MEAL',
      primaryCategory: 'compound_dish',
      matchedTokens: ['multi-component dish'],
      explanation: 'Detected multi-component dish combining main food item with toppings or sauce.'
    };
  }

  // 2. VISCOUS / SAUCE / CONDIMENT DETECTOR
  const SAUCE_WORDS = ['sauce', 'dressing', 'mayo', 'mayonnaise', 'ketchup', 'gravy', 'sriracha', 'dip', 'condiment', 'pesto', 'hummus', 'guacamole', 'hollandaise', 'teriyaki', 'bumbu', 'kecap', 'salsa', 'relish', 'paste'];
  const matchedSaucesInPrimary = Array.from(new Set(SAUCE_WORDS.filter(w => primaryHasWord(w))));
  if (matchedSaucesInPrimary.length > 0 && !primaryHasWord('pasta') && !primaryHasWord('spaghetti')) {
    return {
      physicalForm: 'VISCOUS_SAUCE',
      primaryCategory: 'sauce_condiment',
      matchedTokens: matchedSaucesInPrimary,
      explanation: `Explicit sauce/condiment name matched: "${matchedSaucesInPrimary.join(', ')}".`
    };
  }

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
  const isBakeryDessert = (
    primaryHasWord('cheesecake') || primaryHasWord('cake') || primaryHasWord('cookie') ||
    primaryHasWord('doughnut') || primaryHasWord('donut') || primaryHasWord('muffin') ||
    primaryHasWord('croissant') || primaryHasWord('chocolate') || primaryHasWord('pie')
  ) && !hasWord('milkshake') && !hasWord('smoothie') && !hasWord('shake');

  if (matchedBeverages.length > 0 && !isExplicitCheese && !isSolidCoconut && !isBakeryDessert) {
    return {
      physicalForm: 'LIQUID_BEVERAGE',
      primaryCategory: 'beverage',
      matchedTokens: matchedBeverages,
      explanation: `Matched liquid beverage keywords: "${matchedBeverages.join(', ')}".`
    };
  }

  // 4. BAKERY / DESSERT DETECTOR
  if (isBakeryDessert) {
    return {
      physicalForm: 'SOLID_GRAIN_BAKERY',
      primaryCategory: 'bakery_dessert',
      matchedTokens: ['baked good / dessert'],
      explanation: 'Item identified as a baked good, dessert, or chocolate bar.'
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
  const MEAT_WORDS = ['steak', 'salmon', 'chicken', 'beef', 'pork', 'fish', 'shrimp', 'prawn', 'squid', 'calamari', 'turkey', 'lamb', 'duck', 'bacon', 'cod', 'catfish', 'tuna', 'meatball', 'ayam', 'ikan', 'sapi', 'daging', 'lele'];
  const matchedMeats = Array.from(new Set(MEAT_WORDS.filter(w => hasWord(w))));
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

  // 8. RAW / WHOLE POWDER / OIL / DRY FAT DETECTOR
  const POWDER_OIL_WORDS = ['oil', 'flour', 'sugar', 'powder', 'cocoa', 'salt', 'spice', 'baking mix'];
  const matchedPowders = Array.from(new Set(POWDER_OIL_WORDS.filter(w => hasWord(w))));
  if (matchedPowders.length > 0) {
    return {
      physicalForm: 'POWDER_OIL_FAT',
      primaryCategory: 'raw_ingredient_dry_fat',
      matchedTokens: matchedPowders,
      explanation: `Matched raw oil, flour, sugar, or dry powder ingredient: "${matchedPowders.join(', ')}".`
    };
  }

  // 9. GRAINS / BREADS / BAKERY / SNACKS DETECTOR
  const GRAIN_WORDS = ['rice', 'bread', 'noodle', 'ramen', 'pasta', 'spaghetti', 'tortilla', 'bagel', 'porridge', 'oatmeal', 'pancake', 'fries', 'chips', 'roll'];
  const matchedGrains = Array.from(new Set(GRAIN_WORDS.filter(w => hasWord(w))));
  if (matchedGrains.length > 0) {
    return {
      physicalForm: 'SOLID_GRAIN_BAKERY',
      primaryCategory: 'grain_bakery_snack',
      matchedTokens: matchedGrains,
      explanation: `Matched grain, bread, pasta, or snack: "${matchedGrains.join(', ')}".`
    };
  }

  // 10. RAW / WHOLE FRUIT & VEGETABLE DETECTOR
  const FRUIT_VEG_PATTERNS = [
    'watermelon', 'tomatoes?', 'spinach', 'apples?', 'bananas?', 'avocados?', 'broccoli', 'cucumbers?', 'carrots?',
    'strawberr(y|ies)', 'blueberr(y|ies)', 'raspberr(y|ies)', 'blackberr(y|ies)', 'berr(y|ies)', 'melons?', 'flesh', 'copra',
    'lettuce', 'fruits?', 'vegetables?', 'nectarines?', 'tangerines?', 'mandarins?', 'oranges?', 'grapes?', 'peaches?',
    'pears?', 'plums?', 'cherr(y|ies)', 'mangos?', 'mangoes?', 'pineapples?', 'kiwis?', 'lemons?', 'limes?', 'cantaloupes?',
    'papayas?', 'figs?', 'apricots?', 'onions?', 'garlic', 'cabbage', 'cauliflower', 'kale', 'radish', 'daikon',
    'zucchini', 'eggplant', 'aubergine', 'squash', 'pumpkin', 'peppers?', 'capsicums?', 'celery', 'asparagus', 'mushrooms?'
  ];
  const matchedFruitVeg = Array.from(new Set(FRUIT_VEG_PATTERNS.filter(w => hasWord(w))));
  if (matchedFruitVeg.length > 0 || (item as any).foodType === 'fruit' || (item as any).foodType === 'leafy_veg' || (item as any).foodType === 'root_veg') {
    return {
      physicalForm: 'SOLID_FRUIT_VEG',
      primaryCategory: 'fruit_vegetable',
      matchedTokens: matchedFruitVeg.length > 0 ? matchedFruitVeg : ['fruit/vegetable produce'],
      explanation: `Matched fruit/vegetable produce: "${matchedFruitVeg.length > 0 ? matchedFruitVeg.join(', ') : (item as any).foodType}".`
    };
  }

  return {
    physicalForm: 'UNKNOWN_SOLID',
    primaryCategory: 'general_food',
    matchedTokens: [],
    explanation: 'Default fallback classification.'
  };
}

interface PhysicalFormBadgeProps {
  item: FoodItemBreakdown;
  compact?: boolean;
}

export const PhysicalFormBadge: React.FC<PhysicalFormBadgeProps> = ({ item, compact = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverContentRef = useRef<HTMLDivElement>(null);

  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    isAbove: boolean;
    arrowLeft: number;
  } | null>(null);

  const classification: PhysicalFormClassification = item.physicalFormClassification || classifyUniversalPhysicalFormClient({
    name: item.name,
    canonicalDbName: item.canonicalDbName,
    originalLocalName: item.originalLocalName || undefined,
    keyword: item.name,
    visualIngredients: item.visualIngredients || undefined,
    components: item.components || undefined
  });

  useEffect(() => {
    if (!isOpen) {
      setCoords(null);
      return;
    }

    const updatePos = () => {
      if (!buttonRef.current) return;
      const btnRect = buttonRef.current.getBoundingClientRect();

      let popoverWidth = 280;
      let popoverHeight = 140;
      if (popoverContentRef.current) {
        const pr = popoverContentRef.current.getBoundingClientRect();
        if (pr.width > 0) popoverWidth = pr.width;
        if (pr.height > 0) popoverHeight = pr.height;
      }

      const padding = 12;
      const gap = 8;

      const spaceAbove = btnRect.top;
      const spaceBelow = window.innerHeight - btnRect.bottom;

      let isAbove = false;
      if (spaceBelow >= popoverHeight + gap + padding) {
        isAbove = false;
      } else if (spaceAbove >= popoverHeight + gap + padding) {
        isAbove = true;
      } else {
        isAbove = spaceAbove >= spaceBelow;
      }

      let top = isAbove ? btnRect.top - popoverHeight - gap : btnRect.bottom + gap;
      top = Math.max(padding, Math.min(window.innerHeight - popoverHeight - padding, top));

      const btnCenterX = btnRect.left + btnRect.width / 2;
      let left = btnCenterX - popoverWidth / 2;
      left = Math.max(padding, Math.min(window.innerWidth - popoverWidth - padding, left));

      const arrowLeft = Math.max(16, Math.min(popoverWidth - 16, btnCenterX - left));

      setCoords({ top, left, isAbove, arrowLeft });
    };

    updatePos();
    const timer = setTimeout(updatePos, 10);

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        buttonRef.current && !buttonRef.current.contains(target) &&
        popoverContentRef.current && !popoverContentRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', updatePos);
    window.addEventListener('scroll', updatePos, true);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', updatePos);
      window.removeEventListener('scroll', updatePos, true);
    };
  }, [isOpen]);

  const getFormStyle = (form: string) => {
    switch (form) {
      case 'LIQUID_BEVERAGE':
        return {
          label: 'Liquid / Beverage',
          badgeBg: 'bg-cyan-50 dark:bg-cyan-950/60 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800',
          icon: <Coffee className="w-3 h-3 text-cyan-600 dark:text-cyan-400 shrink-0" />,
          colorTheme: 'cyan'
        };
      case 'VISCOUS_SAUCE':
        return {
          label: 'Viscous / Sauce',
          badgeBg: 'bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
          icon: <Droplets className="w-3 h-3 text-purple-600 dark:text-purple-400 shrink-0" />,
          colorTheme: 'purple'
        };
      case 'SOLID_MEAT_FISH':
        return {
          label: 'Meat / Seafood',
          badgeBg: 'bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800',
          icon: <Utensils className="w-3 h-3 text-rose-600 dark:text-rose-400 shrink-0" />,
          colorTheme: 'rose'
        };
      case 'SOLID_CHEESE_DAIRY':
        return {
          label: 'Cheese / Dairy Solid',
          badgeBg: 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
          icon: <Pizza className="w-3 h-3 text-amber-600 dark:text-amber-400 shrink-0" />,
          colorTheme: 'amber'
        };
      case 'SOLID_GRAIN_BAKERY':
        return {
          label: 'Grain / Bakery',
          badgeBg: 'bg-orange-50 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800',
          icon: <Wheat className="w-3 h-3 text-orange-600 dark:text-orange-400 shrink-0" />,
          colorTheme: 'orange'
        };
      case 'SOLID_FRUIT_VEG':
        return {
          label: 'Fruit / Veg Produce',
          badgeBg: 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
          icon: <Carrot className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />,
          colorTheme: 'emerald'
        };
      case 'POWDER_OIL_FAT':
        return {
          label: 'Raw Powder / Oil',
          badgeBg: 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
          icon: <Package className="w-3 h-3 text-slate-600 dark:text-slate-400 shrink-0" />,
          colorTheme: 'slate'
        };
      case 'COMPOUND_MEAL':
        return {
          label: 'Compound Meal',
          badgeBg: 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800',
          icon: <Sparkles className="w-3 h-3 text-indigo-600 dark:text-indigo-400 shrink-0" />,
          colorTheme: 'indigo'
        };
      default:
        return {
          label: 'Solid Food',
          badgeBg: 'bg-slate-50 dark:bg-slate-800/80 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700',
          icon: <HelpCircle className="w-3 h-3 text-slate-500 shrink-0" />,
          colorTheme: 'slate'
        };
    }
  };

  const style = getFormStyle(classification.physicalForm);
  const matchReason = item.matchReasonInfo;
  const dbSourceText = item.dbSource === 'usda' ? 'USDA FDC Entry' : item.dbSource === 'off' ? 'Open Food Facts Entry' : item.dbSource === 'canonical' || item.dbSource === 'backend_calculated' ? 'Canonical Reference' : 'Universal Nutrient Estimator';

  const rawTokens = classification.matchedTokens || [];
  const tokensArray = Array.isArray(rawTokens) ? rawTokens : [String(rawTokens)];
  const uniqueTokens = Array.from(new Set(tokensArray.map(t => String(t).trim().toLowerCase()))).filter(Boolean);
  const matchedKeywordsStr = uniqueTokens.length > 0 ? uniqueTokens.join(', ') : 'none';
  const rawDbId = item.dbId ? String(item.dbId).replace(/^canonical_/i, '') : '';
  const matchIdentifier = item.dbId ? `Canonical_${rawDbId}` : (matchReason?.matchType || dbSourceText);

  return (
    <div className="relative inline-block text-left font-sans">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] font-semibold transition-all cursor-pointer hover:shadow-sm ${style.badgeBg}`}
        title="Click to see physical form classification"
      >
        {style.icon}
        <span>{style.label}</span>
        <Info className="w-2.5 h-2.5 opacity-60 hover:opacity-100 transition-opacity" />
      </button>

      {isOpen &&
        createPortal(
          <div
            ref={popoverContentRef}
            className="fixed p-3 bg-slate-900/95 dark:bg-slate-800/95 backdrop-blur text-white text-[11px] rounded-xl shadow-2xl border border-slate-700/80 z-[99999] space-y-1 text-left font-sans w-72 transition-opacity duration-150"
            style={{
              top: coords ? `${coords.top}px` : '-9999px',
              left: coords ? `${coords.left}px` : '-9999px',
              opacity: coords ? 1 : 0,
            }}
          >
            {/* Classification Header */}
            <div className="font-mono font-bold text-[10px] text-cyan-300 border-b border-slate-700/80 pb-1 tracking-wider">
              classification: {classification.physicalForm}
            </div>

            {/* Item Name */}
            <div className="font-semibold text-indigo-300 text-[11px]">
              "{item.canonicalDbName || item.name}"
            </div>

            {/* Matched Keywords */}
            <div className="text-[10px] text-slate-300">
              <span className="font-bold text-slate-400 uppercase tracking-wider">Matched Keywords: </span>
              <span className="font-mono text-emerald-300">{matchedKeywordsStr}</span>
            </div>

            {/* Identifier / Match Type */}
            <div className="pt-0.5 border-t border-slate-700/60 text-[9px] font-mono text-slate-400">
              {matchIdentifier}
            </div>

            {coords && (
              <span
                className={`absolute border-4 border-transparent ${
                  coords.isAbove
                    ? 'top-full -mt-0.5 border-t-slate-900 dark:border-t-slate-800'
                    : 'bottom-full -mb-0.5 border-b-slate-900 dark:border-b-slate-800'
                }`}
                style={{ left: `${coords.arrowLeft}px`, transform: 'translateX(-50%)' }}
              />
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
