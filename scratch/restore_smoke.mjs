import { pickQueryScopedMatch, filterMatchesForQuery } from '../server_query_scoped_match.ts';
import {
  reconcileDietitianToScout,
  applySoftReceiptAlignment,
  namesReferToSameFood,
} from '../server_scout_reconcile.ts';
import { compileGoldenMeal } from '../src/utils/goldenLedger.ts';

const pool = [
  { id: '172522', name: 'flour tortilla', source: 'internal_catalog', searchQuery: 'flour tortilla' },
  { id: '171327', name: 'Spices, onion powder', source: 'off', searchQuery: 'crispy onions' },
  { id: '171057', name: 'Chicken, breaded, fried', source: 'usda', searchQuery: 'crispy fried chicken breast' },
];
const chicken = pickQueryScopedMatch('crispy fried chicken breast', pool);
if (chicken?.id !== '171057') throw new Error('query-scope steal still possible');
if (filterMatchesForQuery('crispy fried chicken breast', pool).length !== 1) throw new Error('scoped pool leak');

const scout = [
  { scoutIndex: 0, originalName: 'Crispy chicken wrap' },
  { scoutIndex: 1, originalName: 'Grilled Chicken & Avocado Salad' },
  { scoutIndex: 3, originalName: 'Cinnamon roll' },
  { scoutIndex: 4, originalName: '2 Butter Croissants' },
];
const dietitian = [
  { scoutIndex: 0, canonicalDbName: 'Crispy chicken wrap' },
  { scoutIndex: 1, canonicalDbName: 'Grilled Chicken & Avocado Salad' },
  { scoutIndex: 2, canonicalDbName: 'Cinnamon roll' },
  { scoutIndex: 3, canonicalDbName: '2 Butter Croissants' },
];
const rec = reconcileDietitianToScout(dietitian, scout);
if (rec.reinjected.length !== 0) throw new Error('phantom croissant re-inject');
if (!namesReferToSameFood('2 Butter Croissants', 'Butter Croissants')) throw new Error('name match');

const soft = applySoftReceiptAlignment(1089, 544.6);
if (soft.scaled) throw new Error('soft receipt scaled rows');
if (soft.itemCalories !== 544.6) throw new Error('itemCal should follow rowSum');

const cat = compileGoldenMeal({ replayMode: 'catalog', foodLog: { nutrients: { calories: 100 } } });
if (cat.mayPromote) throw new Error('catalog must not promote');

const tape = compileGoldenMeal({
  logText: 'macroTotals={"calories":2621.4}\n[ReceiptInvariant] REPAIRED rows→item soft factor=2.000',
  foodLog: { nutrients: { calories: 4106 } },
});
if (tape.mayPromote || tape.compiler !== 'unbalanced') throw new Error('2621 vs 4106 must stay red');

console.log('RESTORE SMOKE OK');
console.log('  query-scope: chicken=%s', chicken.id);
console.log('  identity: dishes=%d reinjected=%d', rec.items.length, rec.reinjected.length);
console.log('  receipt: itemCal=%s scaled=%s', soft.itemCalories, soft.scaled);
console.log('  compiler catalog mayPromote=%s tape=%s', cat.mayPromote, tape.compiler);
