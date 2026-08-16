import { Router } from 'express';
import { getMappedBiomarkerKey } from './src/utils/biomarkers.js';
import { lexTable, buildIngestBatch } from './src/utils/biomarkerLifecycle.js';

export const biomarkerRouter = Router();

/**
 * Health & Ingest Helper router for biomarker domain
 */
biomarkerRouter.get('/api/biomarkers/health', (req, res) => {
  res.json({ status: 'ok', domain: 'biomarkers', timestamp: new Date().toISOString() });
});

biomarkerRouter.post('/api/biomarkers/map-key', (req, res) => {
  const { name } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'name is required' });
  }
  const key = getMappedBiomarkerKey(name);
  return res.json({ name, mappedKey: key });
});

biomarkerRouter.post('/api/biomarkers/lex-table', (req, res) => {
  const { text, jobId } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }
  const rows = lexTable(text);
  const trace = buildIngestBatch(rows, jobId);
  return res.json({ rows, trace });
});
