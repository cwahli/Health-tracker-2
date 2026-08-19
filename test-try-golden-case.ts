import { test } from 'vitest';
import * as fs from 'fs';
import { replayScoutAgainstCatalog } from './src/utils/goldenReplay.js';
import { lookupCanonicalBaseFood } from './server_food_db.js';

const spec = JSON.parse(fs.readFileSync('tests/Golden_meal/inbox/try-golden--1786698595796_ghow/case.json', 'utf8'));

// Wait, I can't just run replayScoutAgainstCatalog without the scout!
console.log(spec);
