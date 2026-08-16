import { Router } from 'express';
import { lookupCanonicalBaseFood } from './server_food_db.js';
import { buildFoodSearchQuerySet } from './server_query_set.js';

export const foodRouter = Router();

/**
 * Health & Query helper router for food domain
 */
foodRouter.get('/api/food/health', (req, res) => {
  res.json({ status: 'ok', domain: 'food', timestamp: new Date().toISOString() });
});

foodRouter.post('/api/food/query-set', (req, res) => {
  const { query } = req.body || {};
  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'query is required' });
  }
  const querySet = buildFoodSearchQuerySet([{ originalName: query }]);
  const canonical = lookupCanonicalBaseFood(query);
  return res.json({ query, querySet, canonical });
});
