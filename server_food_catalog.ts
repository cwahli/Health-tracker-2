import { supabaseAdmin, isSupabaseConfigured } from './supabaseAdmin';
import { CANONICAL_BASE_FOODS } from './server_food_db';
import { NUTRIENT_KEYS } from './src/utils/nutrients';
import { ensureFoodCatalogSchema, resetFoodCatalogSchemaEnsure } from "./server_food_catalog_schema.js";
import { isKnownDatabaseBrandSync, isGroceryBrandSync } from "./serverBrandMenu.js";

export function normalizeFoodKey(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export const DISH_SYNONYMS: Record<string, string> = {
  'mac_cheese': 'macaroni_and_cheese',
  'mac_and_cheese': 'macaroni_and_cheese',
  'mac_n_cheese': 'macaroni_and_cheese',
  'macaroni_cheese': 'macaroni_and_cheese',
  'macaroni_and_cheese': 'macaroni_and_cheese',
  'poke_bowl': 'poke_bowl',
  'chicken_tikka_masala': 'chicken_tikka_masala',
  'tikka_masala': 'chicken_tikka_masala',
};

export function normalizeDishKey(name: string): string {
  const norm = normalizeFoodKey(name);
  if (DISH_SYNONYMS[norm]) {
    return DISH_SYNONYMS[norm];
  }
  return norm;
}

export interface InternalFoodMatch {
  food_id: string;
  food_key: string;
  display_name: string;
  nutrients_per_100g: Record<string, number>;
  source: 'canonical_local' | 'supabase_active' | 'alias_active' | 'supabase_candidate';
  confidence: number;
  fdc_id?: string;
  form_tags?: string[];
  state?: string;
}

export interface InternalDishMatch {
  dish_key: string;
  display_name: string;
  core_nutrients: Record<string, number>;
  basis_type: string;
  serving_grams: number;
  confidence: number;
  source: 'supabase_active' | 'dish_alias';
}

export async function resolveInternalFood(query: string): Promise<InternalFoodMatch | null> {
  if (!query) return null;
  const key = normalizeFoodKey(query);
  if (!key) return null;

  // 1. Check local canonical base foods map
  const canonical = CANONICAL_BASE_FOODS[key];
  if (canonical) {
    const { fdcId, foodType, ...nutrients } = canonical as any;
    return {
      food_id: fdcId || key,
      food_key: key,
      display_name: query,
      nutrients_per_100g: nutrients,
      source: 'canonical_local',
      confidence: 0.95,
      fdc_id: fdcId,
    };
  }

  // 2. Query Supabase for active/candidate food item or alias
  if (!isSupabaseConfigured) {
    return null;
  }

  try {
    const { data: itemData, error: itemError } = await supabaseAdmin
      .from('food_items')
      .select('food_id, food_key, display_name, nutrients_per_100g, status, confidence, fdc_id, form_tags, state')
      .eq('food_key', key)
      .maybeSingle();

    if (itemData && !itemError) {
      if (itemData.status === 'active') {
        return {
          food_id: itemData.food_id,
          food_key: itemData.food_key,
          display_name: itemData.display_name,
          nutrients_per_100g: itemData.nutrients_per_100g,
          source: 'supabase_active',
          confidence: itemData.confidence || 0.9,
          fdc_id: itemData.fdc_id,
          form_tags: itemData.form_tags,
          state: itemData.state,
        };
      } else if (itemData.status === 'candidate') {
        const atwater = checkAtwaterValidity(itemData.nutrients_per_100g);
        if ((itemData.confidence || 0.5) >= 0.65 && atwater.valid) {
          return {
            food_id: itemData.food_id,
            food_key: itemData.food_key,
            display_name: itemData.display_name,
            nutrients_per_100g: itemData.nutrients_per_100g,
            source: 'supabase_candidate',
            confidence: itemData.confidence || 0.5,
            fdc_id: itemData.fdc_id,
            form_tags: itemData.form_tags,
            state: itemData.state,
          };
        }
      }
    }
    // Check alias
    const { data: aliasData, error: aliasError } = await supabaseAdmin
      .from('food_aliases')
      .select('*, food_items!inner(*)')
      .eq('alias_key', key)
      .maybeSingle();

    if (aliasData && aliasData.food_items) {
      const fi = aliasData.food_items;
      if (fi.status === 'active' || (fi.status === 'candidate' && (fi.confidence || 0.5) >= 0.65 && checkAtwaterValidity(fi.nutrients_per_100g).valid)) {
        console.log(`[AliasHit] Found alias mapping for ${key} -> ${fi.food_id}`);
        return {
          food_id: fi.food_id,
          food_key: fi.food_key,
          display_name: fi.display_name,
          nutrients_per_100g: fi.nutrients_per_100g,
          source: fi.status === 'active' ? 'alias_active' : 'supabase_candidate',
          confidence: (fi.confidence || 0.9) * (aliasData.weight || 1.0),
          fdc_id: fi.fdc_id,
          form_tags: fi.form_tags,
          state: fi.state,
        };
      }
    }
  } catch (err) {
    // Fail-open logging
    console.warn('[resolveInternalFood] DB resolution error (fallback to external):', err);
  }

  return null;
}

/**
 * Direct lookup of a compiled dish by canonical key.
 */
export async function lookupDishInCatalog(key: string): Promise<any | null> {
  if (!isSupabaseConfigured) {
    return null;
  }

  try {
    const { data: dish, error } = await supabaseAdmin
      .from('dish_cache')
      .select('dish_key, display_name, core_nutrients, basis_type, components, confidence')
      .eq('dish_key', key)
      .eq('status', 'active')
      .maybeSingle();

    if (dish && !error) {
      return dish;
    }
  } catch (err) {
    console.warn(`[FoodCatalog] Supabase dish lookup error for key ${key}:`, err);
  }

  return null;
}

export async function resolveDishCache(query: string): Promise<InternalDishMatch | null> {
  if (!query) return null;
  const key = normalizeDishKey(query);
  if (!key) return null;
  if (!isSupabaseConfigured) {
    return null;
  }

  try {
    const { data: dish, error } = await supabaseAdmin
      .from('dish_cache')
      .select('*')
      .eq('dish_key', key)
      .eq('status', 'active')
      .maybeSingle();

    if (dish && !error) {
      return {
        dish_key: dish.dish_key,
        display_name: dish.display_name,
        core_nutrients: dish.core_nutrients,
        basis_type: dish.basis_type || 'per_serving',
        serving_grams: dish.serving_grams || 100,
        confidence: dish.confidence || 0.9,
        source: 'supabase_active',
      };
    }

    // Check dish_aliases
    const { data: alias, error: aliasError } = await supabaseAdmin
      .from('dish_aliases')
      .select('dish_key')
      .eq('alias_key', key)
      .maybeSingle();

    if (alias && !aliasError) {
      const { data: targetDish } = await supabaseAdmin
        .from('dish_cache')
        .select('*')
        .eq('dish_key', alias.dish_key)
        .eq('status', 'active')
        .maybeSingle();

      if (targetDish) {
        return {
          dish_key: targetDish.dish_key,
          display_name: targetDish.display_name,
          core_nutrients: targetDish.core_nutrients,
          basis_type: targetDish.basis_type || 'per_serving',
          serving_grams: targetDish.serving_grams || 100,
          confidence: targetDish.confidence || 0.85,
          source: 'dish_alias',
        };
      }
    }
  } catch (err) {
    console.warn('[resolveDishCache] DB resolution error:', err);
  }

  return null;
}

export async function upsertFoodAlias(alias: {
  alias_key: string;
  food_key?: string;
  food_id?: string;
  weight?: number;
  source?: string;
}): Promise<{ success: boolean; error?: string }> {
  if (!isSupabaseConfigured) {
    return { success: true };
  }
  try {
    const ens = await ensureFoodCatalogSchema();
    if (!ens.ok && /schema cache|does not exist|Could not find the table/i.test(ens.error || '')) {
      // fall through
    }
    const normAlias = normalizeFoodKey(alias.alias_key);
    if (!normAlias) return { success: false, error: 'Alias key required' };
    
    const targetFoodId = alias.food_id || alias.food_key || normAlias;
    if (normAlias === targetFoodId) {
      // Issue #8: Generated redundant aliases for exact query strings. Add a local check to skip exact self-references.
      console.debug(`[upsertFoodAlias] Skipping self-referential alias: ${normAlias}`);
      return { success: true };
    }

    const { error } = await supabaseAdmin
      .from('food_aliases')
      .upsert({
        alias_key: normAlias,
        food_id: targetFoodId,
        weight: alias.weight ?? 1.0,
        source: alias.source || 'food_resolver',
        created_at: new Date().toISOString()
      }, { onConflict: 'alias_key' });

    if (error) {
      if (/fetch failed|TypeError|AbortError|network/i.test(error.message || '')) {
        console.debug(`[upsertFoodAlias] Supabase notice: ${error.message}`);
      } else {
        console.warn(`[upsertFoodAlias] Supabase notice: ${error.message}`);
      }
      return { success: true };
    }
    return { success: true };
  } catch (err: any) {
    if (/schema cache|does not exist|Could not find the table/i.test(err.message || String(err))) { console.error("[CatalogSchema] Write failed because schema is missing. Run SQL: supabase/migrations/20260805_food_catalog_schema.sql or set DATABASE_URL and POST /api/admin/food-catalog/ensure-schema"); resetFoodCatalogSchemaEnsure(); }
    else if (/fetch failed|TypeError|AbortError|network/i.test(err.message || String(err))) { console.debug('[upsertFoodAlias] Supabase network notice:', err.message || String(err)); }
    return { success: true, error: err.message || String(err) };
  }
}

export async function upsertFoodItemCandidate(item: {
  food_id: string;
  food_key: string;
  display_name: string;
  nutrients_per_100g: Record<string, number>;
  fdc_id?: string;
  form_tags?: string[];
  state?: string;
  status?: string;
  confidence?: number;
  provenance?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const ens = await ensureFoodCatalogSchema();
    if (!ens.ok && /schema cache|does not exist|Could not find the table/i.test(ens.error || '')) {
      // fall through
    }
    const normKey = normalizeFoodKey(item.food_key);
    const displayName = item.display_name || '';

    // Guard 1: Do not insert branded items into unbranded food_catalog (food_items); redirect to brand_menu_items
    if (isKnownDatabaseBrandSync(displayName) || isKnownDatabaseBrandSync(normKey) || isGroceryBrandSync(displayName)) {
      console.log(`[FoodCatalog] Redirecting branded candidate "${displayName}" to brand_menu_items...`);
      try {
        const { autoRegisterChainMenuItem, normalizeChainKey } = await import('./serverBrandMenu.js');
        const chainKey = normalizeChainKey(displayName) || normalizeChainKey(normKey) || 'sainsbury';
        const { supabaseAdmin } = await import('./supabaseAdmin.js');
        if (supabaseAdmin) {
          await autoRegisterChainMenuItem(
            supabaseAdmin,
            {
              chainName: chainKey,
              dishName: displayName,
              originalName: displayName,
              rawNutritionLabel: item.nutrients_per_100g || {},
              lockedNutrientKeys: Object.keys(item.nutrients_per_100g || {}),
              estimatedWeightGrams: 100
            },
            'GB',
            (msg: string) => console.log(msg)
          );
        }
      } catch (brandErr) {
        console.warn(`[FoodCatalog] Failed auto-registering branded item "${displayName}":`, brandErr);
      }
      return { success: true };
    }

    // Guard 2: Reject candidate items with zero calories and zero macros - REMOVED
    // We allow zero-macro candidate items (like water, black coffee, diet drinks)
    
    // Check if existing candidate to count captures and check Atwater
    const { data: existingById } = await supabaseAdmin
      .from('food_items')
      .select('*')
      .eq('food_id', item.food_id)
      .maybeSingle();

    const { data: existingByKey } = await supabaseAdmin
      .from('food_items')
      .select('*')
      .eq('food_key', normKey)
      .maybeSingle();

    let finalKey = normKey;
    let existing = existingById || existingByKey;

    if (existingById) {
      // Keep original food_key of the existing food_id row to prevent UNIQUE violations or key changes
      finalKey = existingById.food_key;
      existing = existingById;
    } else if (existingByKey) {
      // The food_key is in use by another food_id. Make our new entry's key unique to prevent UNIQUE constraint violation.
      finalKey = `${normKey}_${item.food_id}`;
      existing = null;
    }

    let newStatus = item.status || 'candidate';
    let captureCount = 1;

    if (existing) {
      captureCount = (existing.capture_count || 1) + 1;
      const atwater = checkAtwaterValidity(item.nutrients_per_100g);
      if (captureCount >= 2 && atwater.valid && existing.status === 'candidate') {
        newStatus = 'active';
      }
    } else {
      const atwater = checkAtwaterValidity(item.nutrients_per_100g);
      const hasNutrients = Number(item.nutrients_per_100g?.calories || 0) > 0 &&
        (item.nutrients_per_100g?.protein != null || item.nutrients_per_100g?.carbohydrates != null || item.nutrients_per_100g?.totalFat != null);
      if (atwater.valid && hasNutrients && (item.provenance === 'food_resolver_agent' || item.provenance === 'food_resolver' || item.provenance === 'resolver_candidate' || (item.confidence && item.confidence >= 0.7))) {
        newStatus = 'active';
        recordSyncEvent({
          event_type: 'auto_promote',
          payload: { food_key: finalKey, food_id: item.food_id }
        }).catch(() => {});
      } else if (!atwater.valid) {
        newStatus = 'quarantine';
      }
    }

    const { error } = await supabaseAdmin
      .from('food_items')
      .upsert({
        food_id: item.food_id,
        food_key: finalKey,
        display_name: item.display_name,
        nutrients_per_100g: item.nutrients_per_100g,
        fdc_id: item.fdc_id || null,
        form_tags: item.form_tags || [],
        state: item.state || null,
        status: newStatus,
        capture_count: captureCount,
        confidence: item.confidence ?? 0.5,
        provenance: item.provenance || 'resolver_candidate',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'food_id' });

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    if (/schema cache|does not exist|Could not find the table/i.test(err.message || String(err))) { console.error("[CatalogSchema] Write failed because schema is missing. Run SQL: supabase/migrations/20260805_food_catalog_schema.sql or set DATABASE_URL and POST /api/admin/food-catalog/ensure-schema"); resetFoodCatalogSchemaEnsure(); } return { success: false, error: err.message || String(err) };
  }
}

export function checkAtwaterValidity(nutrients: Record<string, number>): { valid: boolean; diffRatio: number } {
  if (!nutrients) return { valid: true, diffRatio: 0 };
  const statedCals = Number(nutrients.calories || 0);
  const p = Number(nutrients.protein || 0);
  const c = Number(nutrients.carbohydrates || nutrients.carbs || 0);
  const f = Number(nutrients.totalFat || nutrients.fat || 0);
  const calcCals = p * 4 + c * 4 + f * 9;

  if (statedCals <= 20 && calcCals <= 20) {
    return { valid: true, diffRatio: 0 };
  }

  if (statedCals > 0 && calcCals === 0) {
    return { valid: false, diffRatio: 1.0 };
  }

  const diff = Math.abs(statedCals - calcCals);
  const ratio = statedCals > 0 ? diff / statedCals : 1.0;

  return {
    valid: ratio <= 0.35,
    diffRatio: ratio
  };
}

export const DEFAULT_CATEGORY_PROFILES: Record<string, Record<string, number>> = {
  produce: { calories: 40, protein: 1, carbohydrates: 9, totalFat: 0.2, totalFibre: 2, sodium: 5 },
  meat: { calories: 200, protein: 22, carbohydrates: 0, totalFat: 12, saturatedFat: 4, sodium: 70 },
  poultry: { calories: 165, protein: 31, carbohydrates: 0, totalFat: 3.6, saturatedFat: 1, sodium: 74 },
  fish: { calories: 140, protein: 20, carbohydrates: 0, totalFat: 6, saturatedFat: 1.2, sodium: 60 },
  egg: { calories: 155, protein: 13, carbohydrates: 1.1, totalFat: 11, saturatedFat: 3.3, sodium: 124 },
  nuts_seeds: { calories: 580, protein: 20, carbohydrates: 20, totalFat: 50, saturatedFat: 7, totalFibre: 8, sodium: 5 },
  dairy: { calories: 60, protein: 3.2, carbohydrates: 4.8, totalFat: 3.2, saturatedFat: 2, sodium: 40 },
  cheese: { calories: 300, protein: 22, carbohydrates: 2, totalFat: 24, saturatedFat: 15, sodium: 600 },
  beverage: { calories: 0, protein: 0, carbohydrates: 0, totalFat: 0, sodium: 5 },
  starch: { calories: 130, protein: 2.7, carbohydrates: 28, totalFat: 0.3, totalFibre: 1, sodium: 1 },
  cereal: { calories: 420, protein: 12, carbohydrates: 65, totalFat: 12, totalFibre: 8, sodium: 50 },
  legume: { calories: 160, protein: 8, carbohydrates: 25, totalFat: 3, totalFibre: 7, sodium: 200 },
  pastry: { calories: 410, protein: 8, carbohydrates: 46, totalFat: 21, saturatedFat: 12, totalFibre: 2, sodium: 450 },
  dessert: { calories: 450, protein: 5, carbohydrates: 55, totalFat: 24, saturatedFat: 12, totalFibre: 2, sodium: 200 },
  general_dish: { calories: 150, protein: 6, carbohydrates: 18, totalFat: 6, saturatedFat: 1.5, totalFibre: 1.5, sodium: 300 }
};

export function getFallbackCategoryProfile(query: string): Record<string, number> {
  const q = (query || '').toLowerCase();
  let base: Record<string, number> = { ...DEFAULT_CATEGORY_PROFILES.general_dish };
  if (/\b(beverage|drink|water|tea|coffee|soda)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.beverage };
  else if (/\b(brownies?|cakes?|cookies?|chocolates?|cand(?:y|ies)|pies?|tarts?|fudge|desserts?|sweets?|biscuits?|puddings?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.dessert };
  else if (/\b(croissants?|pastr(?:y|ies)|danish(?:es)?|muffins?|donuts?|doughnuts?|brioche|scones?|puffs?|bakery|bakeries)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.pastry };
  else if (/\b(eggs?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.egg };
  else if (/\b(chicken|turkey|poultry)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.poultry };
  else if (/\b(fish|salmon|tuna|cod|shrimp|seafood)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.fish };
  else if (/\b(beef|pork|steak|lamb|mutton|meat)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.meat };
  else if (/\b(feta|cheddar|mozzarella|parmesan|cheese)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.cheese };
  else if (/\b(milk|yogurt|yoghurt|greek|cream|butter|dairy)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.dairy };
  else if (/\b(granola|muesli|oats?|cereals?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.cereal };
  else if (/\b(chickpeas?|hummus|lentils?|beans?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.legume };
  else if (/\b(rice|bread|pasta|potatoe?s?|noodles?|starch)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.starch };
  else if (/\b(sesame|almonds?|walnuts?|cashews?|pistachios?|peanuts?|pecans?|hazelnuts?|seeds?|nuts?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.nuts_seeds };
  else if (/\b(cucumbers?|tomatoe?s?|apples?|bananas?|berr(?:y|ies)|carrots?|salads?|spinach|lettuce|olives?|broccoli|vegetables?|fruits?|produce|clementines?|oranges?|citrus|mandarins?|tangerines?|lemons?|limes?|grapefruits?|grapes?|peaches?|plums?|pears?|mangoes?|mangos?|kiwis?|pineapples?|melons?|watermelons?|cantaloupes?|honeydews?|nectarines?|apricots?|cherries|cherry|figs?|dates?|raisins?|avocados?|onions?|peppers?|garlics?|mushrooms?)\b/.test(q)) base = { ...DEFAULT_CATEGORY_PROFILES.produce };

  const fullProfile: Record<string, number> = {};
  for (const k of NUTRIENT_KEYS) {
    fullProfile[k] = base[k] ?? 0;
  }
  return fullProfile;
}

export async function getCatalogSyncStatus(): Promise<any> {
  try {
    const ens = await ensureFoodCatalogSchema();
    if (!ens.ok && /schema cache|does not exist|Could not find the table/i.test(ens.error || '')) {
      // fall through
    }
    const { count: foodTotal } = await supabaseAdmin.from('food_items').select('*', { count: 'exact', head: true });
    const { count: foodActive } = await supabaseAdmin.from('food_items').select('*', { count: 'exact', head: true }).eq('status', 'active');
    const { count: foodCandidate } = await supabaseAdmin.from('food_items').select('*', { count: 'exact', head: true }).eq('status', 'candidate');
    
    const { count: dishTotal } = await supabaseAdmin.from('dish_cache').select('*', { count: 'exact', head: true });
    const { count: dishActive } = await supabaseAdmin.from('dish_cache').select('*', { count: 'exact', head: true }).eq('status', 'active');
    
    const { count: deferredGaps } = await supabaseAdmin.from('food_observations').select('*', { count: 'exact', head: true }).eq('event_type', 'deferred_gap');
    const { count: resolverCalls } = await supabaseAdmin.from('food_observations').select('*', { count: 'exact', head: true }).in('event_type', ['resolver_invoked', 'deferred_gap', 'food_resolver']);

    const { data: syncEvts } = await supabaseAdmin.from('food_catalog_sync_events').select('event_type');
    const realFailures = (syncEvts || []).filter((e: any) => /fail|_failure/i.test(e.event_type || '')).length;

    const { data: latestEvents } = await supabaseAdmin.from('food_catalog_sync_events').select('*').order('created_at', { ascending: false }).limit(10);

    return {
      success: true,
      food_items: { total: foodTotal || 0, active: foodActive || 0, candidate: foodCandidate || 0 },
      dish_cache: { total: dishTotal || 0, active: dishActive || 0 },
      open_deferred_gaps: deferredGaps || 0,
      sync_failures: realFailures,
      resolver_call_count: resolverCalls || 0,
      latest_sync_events: latestEvents || []
    };
  } catch (err: any) {
    if (/schema cache|does not exist|Could not find the table/i.test(err.message || String(err))) { console.error("[CatalogSchema] Write failed because schema is missing. Run SQL: supabase/migrations/20260805_food_catalog_schema.sql or set DATABASE_URL and POST /api/admin/food-catalog/ensure-schema"); resetFoodCatalogSchemaEnsure(); } return { success: false, error: err.message || String(err) };
  }
}

export async function mergeFoodCatalogItems(
  sourceKeyOrParams: string | { source_id?: string; target_id?: string; sourceKey?: string; targetKey?: string; form_tags_source?: string[]; form_tags_target?: string[] },
  targetKeyParam?: string
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    let sourceKey = '';
    let targetKey = '';
    let passedSourceTags: string[] = [];
    let passedTargetTags: string[] = [];

    if (typeof sourceKeyOrParams === 'object' && sourceKeyOrParams !== null) {
      sourceKey = sourceKeyOrParams.source_id || sourceKeyOrParams.sourceKey || '';
      targetKey = sourceKeyOrParams.target_id || sourceKeyOrParams.targetKey || '';
      passedSourceTags = sourceKeyOrParams.form_tags_source || [];
      passedTargetTags = sourceKeyOrParams.form_tags_target || [];
    } else {
      sourceKey = String(sourceKeyOrParams || '');
      targetKey = String(targetKeyParam || '');
    }

    const normSource = normalizeFoodKey(sourceKey);
    const normTarget = normalizeFoodKey(targetKey);

    if (!normSource || !normTarget) {
      return { success: false, error: 'Source and target keys required' };
    }

    // Check explicitly passed tags first
    const sourceHasBar = passedSourceTags.includes('bar');
    const targetHasBar = passedTargetTags.includes('bar');
    const sourceHasLoose = passedSourceTags.includes('loose') || passedSourceTags.includes('loose/cup');
    const targetHasLoose = passedTargetTags.includes('loose') || passedTargetTags.includes('loose/cup');

    if ((sourceHasBar && targetHasLoose) || (sourceHasLoose && targetHasBar)) {
      return { success: false, error: 'Refused merge: Incompatible physical form tags (bar vs loose/cup)' };
    }

    if (!isSupabaseConfigured) {
      return { success: true, message: 'Offline mode: merge skipped' };
    }

    const { data: sourceItem } = await supabaseAdmin.from('food_items').select('*').eq('food_key', normSource).maybeSingle();
    const { data: targetItem } = await supabaseAdmin.from('food_items').select('*').eq('food_key', normTarget).maybeSingle();

    if (sourceItem && targetItem) {
      const sourceTags = [...(sourceItem.form_tags || []), ...passedSourceTags];
      const targetTags = [...(targetItem.form_tags || []), ...passedTargetTags];
      const sourceIsBar = sourceTags.includes('bar') || /\bbar\b/i.test(sourceItem.display_name || '');
      const targetIsBar = targetTags.includes('bar') || /\bbar\b/i.test(targetItem.display_name || '');
      const sourceIsLoose = sourceTags.includes('loose') || sourceTags.includes('loose/cup') || /\b(loose|bowl|cup)\b/i.test(sourceItem.display_name || '');
      const targetIsLoose = targetTags.includes('loose') || targetTags.includes('loose/cup') || /\b(loose|bowl|cup)\b/i.test(targetItem.display_name || '');

      if ((sourceIsBar && targetIsLoose) || (sourceIsLoose && targetIsBar)) {
        return { success: false, error: 'Refused merge: Incompatible physical form tags (bar vs loose/cup)' };
      }
    }

    await supabaseAdmin.from('food_aliases').upsert({
      alias_key: normSource,
      food_id: targetItem?.food_id || normTarget,
      weight: 1.0,
      source: 'admin_merge'
    }, { onConflict: 'alias_key' });

    await supabaseAdmin.from('food_items').update({
      status: 'merged',
      parent_id: targetItem?.food_id || normTarget,
      updated_at: new Date().toISOString()
    }).eq('food_key', normSource);

    await recordSyncEvent({
      event_type: 'item_merged',
      payload: { sourceKey: normSource, targetKey: normTarget }
    });

    return { success: true, message: `Merged ${normSource} into ${normTarget}` };
  } catch (err: any) {
    if (/schema cache|does not exist|Could not find the table/i.test(err.message || String(err))) { console.error("[CatalogSchema] Write failed because schema is missing. Run SQL: supabase/migrations/20260805_food_catalog_schema.sql or set DATABASE_URL and POST /api/admin/food-catalog/ensure-schema"); resetFoodCatalogSchemaEnsure(); } return { success: false, error: err.message || String(err) };
  }
}

export async function quarantineAtwaterFailures(): Promise<{ success: boolean; quarantinedCount: number }> {
  try {
    const { data: items } = await supabaseAdmin.from('food_items').select('*').eq('status', 'candidate');
    let count = 0;
    if (items && items.length > 0) {
      for (const item of items) {
        const { valid } = checkAtwaterValidity(item.nutrients_per_100g);
        if (!valid) {
          await supabaseAdmin.from('food_items').update({
            status: 'quarantine',
            updated_at: new Date().toISOString()
          }).eq('food_key', item.food_key);
          count++;
          await recordSyncEvent({
            event_type: 'atwater_quarantine',
            payload: { food_key: item.food_key, nutrients: item.nutrients_per_100g }
          });
        }
      }
    }
    return { success: true, quarantinedCount: count };
  } catch (err: any) {
    return { success: false, quarantinedCount: 0 };
  }
}

export async function upsertDishCacheCandidate(dish: {
  dish_key: string;
  display_name: string;
  core_nutrients: Record<string, number>;
  basis_type?: string;
  serving_grams?: number;
  confidence?: number;
  provenance?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const ens = await ensureFoodCatalogSchema();
    if (!ens.ok && /schema cache|does not exist|Could not find the table/i.test(ens.error || '')) {
      // fall through
    }
    const key = normalizeDishKey(dish.dish_key);
    const { error } = await supabaseAdmin
      .from('dish_cache')
      .upsert({
        dish_key: key,
        display_name: dish.display_name,
        core_nutrients: dish.core_nutrients,
        basis_type: dish.basis_type || 'per_serving',
        serving_grams: dish.serving_grams || 100,
        confidence: dish.confidence ?? 0.5,
        provenance: dish.provenance || 'resolver_dish_core',
        status: 'active',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'dish_key' });

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    if (/schema cache|does not exist|Could not find the table/i.test(err.message || String(err))) { console.error("[CatalogSchema] Write failed because schema is missing. Run SQL: supabase/migrations/20260805_food_catalog_schema.sql or set DATABASE_URL and POST /api/admin/food-catalog/ensure-schema"); resetFoodCatalogSchemaEnsure(); } return { success: false, error: err.message || String(err) };
  }
}

export async function recordFoodObservation(obs: {
  idempotency_key?: string;
  event_type: string;
  snapshots?: any;
  payload?: any;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabaseAdmin
      .from('food_observations')
      .insert({
        idempotency_key: obs.idempotency_key || null,
        event_type: obs.event_type,
        snapshots: obs.snapshots || null,
        payload: obs.payload || null,
      });

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    if (/schema cache|does not exist|Could not find the table/i.test(err.message || String(err))) { console.error("[CatalogSchema] Write failed because schema is missing. Run SQL: supabase/migrations/20260805_food_catalog_schema.sql or set DATABASE_URL and POST /api/admin/food-catalog/ensure-schema"); resetFoodCatalogSchemaEnsure(); } return { success: false, error: err.message || String(err) };
  }
}

export async function recordSyncEvent(evt: {
  event_type: string;
  payload?: any;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { error } = await supabaseAdmin
      .from('food_catalog_sync_events')
      .insert({
        event_type: evt.event_type,
        payload: evt.payload || null,
      });

    if (error) return { success: false, error: error.message };
    return { success: true };
  } catch (err: any) {
    if (/schema cache|does not exist|Could not find the table/i.test(err.message || String(err))) { console.error("[CatalogSchema] Write failed because schema is missing. Run SQL: supabase/migrations/20260805_food_catalog_schema.sql or set DATABASE_URL and POST /api/admin/food-catalog/ensure-schema"); resetFoodCatalogSchemaEnsure(); } return { success: false, error: err.message || String(err) };
  }
}

