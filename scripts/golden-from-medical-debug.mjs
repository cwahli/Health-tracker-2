#!/usr/bin/env node
/**
 * Turn a medical debug export into a biomarker inbox golden.
 *
 * Usage:
 *   node scripts/golden-from-medical-debug.mjs path/to/debug-job_….md
 *   node scripts/golden-from-medical-debug.mjs path/to/debug.json
 *
 * Writes tests/Golden_biomarker/inbox/<jobId>/
 *   case.json    — metadata, raw input text/JSON, class tag
 *   expected.json — expected IngestTrace / conversion locks
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const INBOX = path.join(ROOT, 'tests', 'Golden_biomarker', 'inbox');

const fileArg = process.argv[2];
if (!fileArg) {
  console.error('Usage: node scripts/golden-from-medical-debug.mjs <path-to-debug-file>');
  process.exit(1);
}

const absolutePath = path.resolve(process.cwd(), fileArg);
if (!fs.existsSync(absolutePath)) {
  console.error(`File not found: ${absolutePath}`);
  process.exit(1);
}

const rawContent = fs.readFileSync(absolutePath, 'utf8');

let jobId = 'job_medical_' + Date.now();
const matchJob = rawContent.match(/job_[a-zA-Z0-9_]+/);
if (matchJob) jobId = matchJob[0];

const targetDir = path.join(INBOX, jobId);
fs.mkdirSync(targetDir, { recursive: true });

const casePayload = {
  id: jobId,
  class: 'CONFORMANCE_SHAPE',
  classes: ['CONFORMANCE_SHAPE'],
  input: {
    text: rawContent.slice(0, 1000)
  }
};

const expectedPayload = {
  trace: {
    sourceKind: 'table',
    class: 'CONFORMANCE_SHAPE',
    highConfidenceCount: 0,
    unmatchedCount: 0
  }
};

fs.writeFileSync(path.join(targetDir, 'case.json'), JSON.stringify(casePayload, null, 2));
fs.writeFileSync(path.join(targetDir, 'expected.json'), JSON.stringify(expectedPayload, null, 2));

console.log(`Created biomarker inbox golden fixture at: ${targetDir}`);
