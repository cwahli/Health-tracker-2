import { AnalyzeRunContext } from './server_food_analyze_run_types.js';
import { runDatabaseSearchStage } from './src/server/food/server_food_db_search.js';
import { isDishEstimateEnabled } from './server_food_flags.js';
import { inferPackagedBindChains, injectExplicitFoodTags, checkMenuScaleBypass } from './src/server/food/server_food_scout_source.js';
import { isPackagedBindItem } from './server_brand_match.js';
import { buildFoodSearchQuerySet } from './server_query_set.js';
import { detectChainKeyFromText, enrichScoutComponentsWithMatches } from './src/server/food/server_food_analyze_helpers.js';
import { buildPortionClarifyPayload } from './server_portion_clarify.js';
import { collectFdcHintTasks, isFdcHintRelevant, mapLedgersToPrecalcItems } from './src/server/food/server_food_precalc.js';
import { finalizeDishLedger } from './server_dish_finalize.js';
import { extractUSDANutrientsPer100g, extractOFFNutrientsPer100g } from './server_pure_helpers.js';
import { NUTRIENT_KEYS } from './src/utils/nutrients.js';
import {
  searchUSDA,
  searchOpenFoodFacts,
  fetchUSDAFoodById,
  fetchOFFProductByBarcode,
  lookupChainMenuSources,
  isUsableWebNutritionHit,
  callUnifiedLLM,
} from './server.js';
import {
  searchBrandMenuItems,
  isKnownDatabaseBrand,
  isKnownDatabaseBrandSync,
  getBrandMenuItemById,
  brandHitFitsQuery,
  sanitizeDishTitle,
  selfCleanBrandDatabase,
} from './serverBrandMenu.js';
import {
  resolveInternalFood,
  resolveDishCache,
  normalizeFoodKey,
  getFallbackCategoryProfile,
  recordFoodObservation,
  upsertFoodItemCandidate,
  upsertFoodAlias,
} from './server_food_catalog.js';
import { rankAndClassifyCandidates, writeAliasIfHitUnique } from './server_fdc_resolve.js';
import { executeFoodResolverCurator } from './server_food_resolver_curator.js';

export async function executePrecalcPhase(ctx: AnalyzeRunContext, dbDeps?: any): Promise<void> {
  const isMenuScale = checkMenuScaleBypass({
    visionScoutContentType: ctx.visionScoutContentType,
    scoutRecommendedMode: ctx.scoutRecommendedMode,
  });

  const injectTagsFn = dbDeps?.injectExplicitFoodTags || injectExplicitFoodTags;
  if (Array.isArray(ctx.req.body?.explicitFoodTags) && ctx.req.body.explicitFoodTags.length > 0) {
    injectTagsFn({
      visionScoutItems: ctx.visionScoutItems,
      explicitFoodTags: ctx.req.body.explicitFoodTags,
      onLog: ctx.addDebugLog,
    });
  }

  const uniqueQueries = buildFoodSearchQuerySet(ctx.visionScoutItems || []);
  const detectedChainKey =
    ctx.visionScoutItems?.map((it: any) => it.originalName || it.keyword || it.name).map(detectChainKeyFromText).find(Boolean) ||
    uniqueQueries.map(detectChainKeyFromText).find(Boolean);

  let registeredChainSources: any[] = [];
  const lookupChainsFn = dbDeps?.lookupChainMenuSources || lookupChainMenuSources;
  if (detectedChainKey) {
    registeredChainSources = await lookupChainsFn(detectedChainKey, 'GB');
    if (registeredChainSources.length > 0) {
      ctx.addDebugLog(`[ChainSource] Found ${registeredChainSources.length} source(s) for ${detectedChainKey}: ${registeredChainSources.map((s: any) => s.url).join(' | ')}`);
    } else {
      ctx.addDebugLog(`[ChainSource] No official source for "${detectedChainKey}". Preferring component/USDA path over web_search absolute injection.`);
    }
  }

  const isEvaluationScale = (ctx.visionScoutItems || []).length >= 15;
  const packagedBindItems = (ctx.visionScoutItems || []).filter((it: any) => isPackagedBindItem(it));

  if (isDishEstimateEnabled(ctx.req)) {
    if (packagedBindItems.length > 0) {
      ctx.addDebugLog(`[PackagedBind] ${packagedBindItems.length} packaged/OCR item(s) bind via finalize brand/OCR rungs; generic USDA curator still skipped.`);
      inferPackagedBindChains({ packagedBindItems, onLog: ctx.addDebugLog });
    } else {
      ctx.addDebugLog('[CuratorSkipped] Dish estimate pipeline active, skipping hot-path database search and resolver curator.');
    }
  }

  const shouldRunDbSearch =
    ctx.userSelectedMode !== 'compare' &&
    !isDishEstimateEnabled(ctx.req) &&
    !ctx.isWeightModification &&
    !isMenuScale &&
    !isEvaluationScale &&
    ctx.databaseMatchesArray.length === 0 &&
    (ctx.visionScoutRanAndReturnedItems || (ctx.hasNoNewImages && uniqueQueries.length > 0));

  if (shouldRunDbSearch && uniqueQueries.length > 0) {
    ctx.databaseMatches = await runDatabaseSearchStage(
      {
        uniqueQueries,
        visionScoutItems: ctx.visionScoutItems,
        visionScoutContentType: ctx.visionScoutContentType,
        detectedChainKey,
        explicitFoodTags: ctx.req.body?.explicitFoodTags,
        engine: ctx.engine,
        databaseMatchesArray: ctx.databaseMatchesArray,
        dbMatchMap: ctx.dbMatchMap,
        quarantinedIdsSet: ctx.quarantinedIdsSet,
      },
      {
        sendStreamEvent: ctx.sendStreamEvent,
        flushRes: () => {
          if (typeof (ctx.res as any).flush === 'function') (ctx.res as any).flush();
        },
        sendLog: ctx.sendLog,
        addDebugLog: ctx.addDebugLog,
        searchUSDA: dbDeps?.searchUSDA || searchUSDA,
        searchOpenFoodFacts: dbDeps?.searchOpenFoodFacts || searchOpenFoodFacts,
        searchBrandMenuItems: dbDeps?.searchBrandMenuItems || searchBrandMenuItems,
        isKnownDatabaseBrand: dbDeps?.isKnownDatabaseBrand || isKnownDatabaseBrand,
        isKnownDatabaseBrandSync: dbDeps?.isKnownDatabaseBrandSync || isKnownDatabaseBrandSync,
        getBrandMenuItemById: dbDeps?.getBrandMenuItemById || getBrandMenuItemById,
        isUsableWebNutritionHit: dbDeps?.isUsableWebNutritionHit || isUsableWebNutritionHit,
        brandHitFitsQuery: dbDeps?.brandHitFitsQuery || brandHitFitsQuery,
        extractUSDANutrientsPer100g,
        extractOFFNutrientsPer100g,
        resolveInternalFood: dbDeps?.resolveInternalFood || resolveInternalFood,
        resolveDishCache: dbDeps?.resolveDishCache || resolveDishCache,
        rankAndClassifyCandidates: dbDeps?.rankAndClassifyCandidates || rankAndClassifyCandidates,
        writeAliasIfHitUnique: dbDeps?.writeAliasIfHitUnique || writeAliasIfHitUnique,
        sanitizeDishTitle: dbDeps?.sanitizeDishTitle || sanitizeDishTitle,
        normalizeFoodKey: dbDeps?.normalizeFoodKey || normalizeFoodKey,
        fetchUSDAFoodById: dbDeps?.fetchUSDAFoodById || fetchUSDAFoodById,
        fetchOFFProductByBarcode: dbDeps?.fetchOFFProductByBarcode || fetchOFFProductByBarcode,
        getFallbackCategoryProfile: dbDeps?.getFallbackCategoryProfile || getFallbackCategoryProfile,
        recordFoodObservation: dbDeps?.recordFoodObservation || recordFoodObservation,
        upsertFoodItemCandidate: dbDeps?.upsertFoodItemCandidate || upsertFoodItemCandidate,
        upsertFoodAlias: dbDeps?.upsertFoodAlias || upsertFoodAlias,
        callUnifiedLLM: ctx.callUnifiedLLM || callUnifiedLLM,
        executeFoodResolverCurator: dbDeps?.executeFoodResolverCurator || executeFoodResolverCurator,
        importSupabaseAdmin: async () => await import('./supabaseAdmin.js'),
        selfCleanBrandDatabase: dbDeps?.selfCleanBrandDatabase || selfCleanBrandDatabase,
      }
    );
  }

  enrichScoutComponentsWithMatches(ctx.visionScoutItems, ctx.databaseMatchesArray);
  ctx.portionClarify = buildPortionClarifyPayload(ctx.visionScoutItems);
  if (ctx.portionClarify) {
    ctx.addDebugLog(`[PortionClarify] Non-blocking clarification check attached for: ${ctx.portionClarify.items.map((i: any) => i.name).join('; ')}`);
  }

  const hintFetchTasks = collectFdcHintTasks(ctx.visionScoutItems);
  const fetchUsdaFn = dbDeps?.fetchUSDAFoodById || fetchUSDAFoodById;
  if (hintFetchTasks.length > 0) {
    const hintResults = await Promise.all(
      hintFetchTasks.map(async (task) => {
        const food = await fetchUsdaFn(task.fdcId);
        return { task, food };
      })
    );
    hintResults.forEach(({ task, food }) => {
      if (!food || !food.description) {
        ctx.addDebugLog(`[ScoutFdcHint] id=${task.fdcId} for query "${task.query}" did not resolve.`);
        return;
      }
      const relevant = isFdcHintRelevant(task.query, food.description);
      if (!relevant) {
        ctx.addDebugLog(`[ScoutFdcHint] Relevance check rejected hint id=${task.fdcId}`);
        return;
      }
      const fdcIdStr = String(food.fdcId || task.fdcId);
      const nutrients100g = extractUSDANutrientsPer100g(food);
      ctx.dbMatchMap.set(fdcIdStr, nutrients100g);
      const verifiedHit = {
        id: fdcIdStr,
        source: 'usda_direct_hint',
        name: food.description || '',
        calories: String(nutrients100g.calories || 0),
        protein: nutrients100g.protein,
        fat: nutrients100g.totalFat,
        saturatedFat: nutrients100g.saturatedFat,
        sodium: nutrients100g.sodium,
      };
      ctx.databaseMatchesArray.push(verifiedHit);
      ctx.verifiedFdcHintMap.set(task.key, verifiedHit);
      ctx.addDebugLog(`[ScoutFdcHint] Verified hint id=${fdcIdStr} accepted.`);
    });
  }

  const ledgers = await Promise.all(
    ctx.visionScoutItems.map(async (vItem: any, vIdx: number) => {
      if (vItem._alreadyFinalized && vItem.nutrients && !ctx.isModifySession) {
        ctx.addDebugLog(`[Single-Path] Reusing saved ledger for "${vItem.originalName || vItem.keyword}".`);
        return {
          scoutIndex: vItem.scoutIndex ?? vIdx,
          originalName: vItem.originalName || vItem.keyword,
          keyword: vItem.keyword,
          weightGrams: vItem.estimatedWeightGrams || vItem.weightGrams,
          nutrients: vItem.nutrients,
          lockedNutrientKeys: vItem.lockedNutrientKeys || [],
          dbSource: vItem.dbSource || 'estimated',
          dbId: vItem.dbId || null,
          boundingBox2D: vItem.boundingBox2D || null,
          sourceImageIndex: vItem.sourceImageIndex,
          components: vItem.components,
          componentsDetailList: vItem.componentsDetailList || vItem.components || [],
          hasComponents: Boolean(vItem.componentsDetailList && vItem.componentsDetailList.length > 1),
          ingredientsList: vItem.ingredientsList || null,
          visualIngredients: vItem.visualIngredients || null,
          dishClass: vItem.foodType || vItem.dishClass || 'composed',
          brandLock: vItem.brandLock || null,
          atwaterFlag: vItem.atwaterFlag || null,
          ingredients: vItem.ingredients || [],
        };
      }
      return finalizeDishLedger({
        item: { ...vItem, scoutIndex: vItem.scoutIndex ?? vIdx },
        nutrientBasisWeight: vItem.nutrientBasisWeight || vItem.estimatedWeightGrams,
        consumedWeight: vItem.estimatedWeightGrams,
        diningEnvironment: ctx.diningEnvironment || vItem.diningEnvironment,
      });
    })
  );

  ctx.preCalculatedItems = mapLedgersToPrecalcItems({
    ledgers,
    visionScoutItems: ctx.visionScoutItems,
    onLog: ctx.addDebugLog,
  });

  if (ctx.preCalculatedItems.length > 0) {
    ctx.preCalculatedItems.reduce((acc: any, it: any) => {
      const n = it.nutrients || {};
      NUTRIENT_KEYS.forEach((k: string) => {
        acc[k] = (acc[k] || 0) + (Number(n[k]) || 0);
      });
      acc.weightGrams = (acc.weightGrams || 0) + (Number(it.estimatedWeightGrams) || 0);
      return acc;
    }, { weightGrams: 0 });
  }
}
