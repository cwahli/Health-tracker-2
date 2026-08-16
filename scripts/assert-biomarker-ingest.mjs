/**
 * Track B — Biomarker Ingest & Class-First Gate (assert-biomarker-ingest.mjs)
 * Verifies N1-N3 invariants per plan/QUALITY.md §9.
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let failed = 0;
function ok(cond, id, msg) {
  if (cond) {
    console.log(`PASS ${id}`);
  } else {
    failed += 1;
    console.error(`FAIL ${id}: ${msg}`);
  }
}

// 1. Types & IngestTrace definition (N1 & N3)
const types = read('src/types.ts');
ok(types.includes('export interface IngestTrace'), 'N1:types', 'missing IngestTrace interface in src/types.ts');
ok(types.includes('export type BiomarkerClassId') || types.includes('export type ClassId'), 'N3:types', 'missing ClassId type in src/types.ts');
ok(types.includes('IDENTITY_FALSE_FRIEND'), 'N3:classes', 'missing IDENTITY_FALSE_FRIEND in ClassId');
ok(types.includes('CONFORMANCE_UNIT'), 'N3:classes', 'missing CONFORMANCE_UNIT in ClassId');
ok(types.includes('APPLY_MISS'), 'N3:classes', 'missing APPLY_MISS in ClassId');
ok(types.includes('SILENT_REWRITE'), 'N3:classes', 'missing SILENT_REWRITE in ClassId');

// 2. Server Jobs IngestTrace preservation (N1)
const serverJobs = read('serverJobs.ts');
ok(serverJobs.includes('ingestTrace:'), 'N1:serverJobs', 'serverJobs.ts does not include ingestTrace on cleanResult/agentResult');

// 3. Debug Payload IngestTrace support (N1)
const debugPayload = read('src/utils/debugPayload.ts');
ok(debugPayload.includes('ingestTrace'), 'N1:debugPayload', 'debugPayload.ts does not process ingestTrace');

// 4. G-B1 expected.json and locked numbers (N2)
const gb1ExpectedPath = path.join(root, 'tests/Golden_biomarker/examples/G-B1/expected.json');
ok(fs.existsSync(gb1ExpectedPath), 'N2:gb1_exists', 'missing tests/Golden_biomarker/examples/G-B1/expected.json');
if (fs.existsSync(gb1ExpectedPath)) {
  const gb1Expected = read('tests/Golden_biomarker/examples/G-B1/expected.json');
  for (const n of ['1.293', '1.411', '3.362', '79.56', '13.68']) {
    ok(gb1Expected.includes(n), 'N2:locked_number', `G-B1 expected.json missing locked number ${n}`);
  }
}

// 5. G-B1 case.json existence and class mapping (N2)
const gb1CasePath = path.join(root, 'tests/Golden_biomarker/examples/G-B1/case.json');
ok(fs.existsSync(gb1CasePath), 'N2:gb1_case', 'missing tests/Golden_biomarker/examples/G-B1/case.json');
if (fs.existsSync(gb1CasePath)) {
  const gb1Case = read('tests/Golden_biomarker/examples/G-B1/case.json');
  ok(gb1Case.includes('APPLY_MISS'), 'N2:gb1_class', 'G-B1 case.json missing APPLY_MISS class');
}

// 6. Test harness existence
const testFile = path.join(root, 'tests/golden_biomarker.test.ts');
ok(fs.existsSync(testFile), 'N2:test_harness', 'missing tests/golden_biomarker.test.ts');

// 7. G-B4 false friend guard check (N7 & N8)
const gb4CasePath = path.join(root, 'tests/Golden_biomarker/examples/G-B4_specimen_false_friend/case.json');
ok(fs.existsSync(gb4CasePath), 'N7:gb4_case_exists', 'missing G-B4 case.json');

const gb4ExpectedPath = path.join(root, 'tests/Golden_biomarker/examples/G-B4_specimen_false_friend/expected.json');
ok(fs.existsSync(gb4ExpectedPath), 'N7:gb4_expected_exists', 'missing G-B4 expected.json');

const biomarkersTs = read('src/utils/biomarkers.ts');
ok(biomarkersTs.includes('export function getMappedBiomarkerKey'), 'N7:getMappedBiomarkerKey', 'missing getMappedBiomarkerKey export');
ok(biomarkersTs.includes('isUrine') || biomarkersTs.includes('urine'), 'N7:specimen_guard', 'missing specimen guard in biomarkers.ts');

const lifecycleTs = read('src/utils/biomarkerLifecycle.ts');
ok(lifecycleTs.includes('convertViaTable'), 'N8:unit_gate', 'biomarkerLifecycle.ts missing convertViaTable unit gate');
ok(lifecycleTs.includes('lexTable') && lifecycleTs.includes('buildIngestBatch'), 'N6:lexer_exports', 'biomarkerLifecycle.ts missing lexTable / buildIngestBatch exports');
ok(lifecycleTs.includes('shouldAbortTablePath'), 'N10:shouldAbortTablePath', 'biomarkerLifecycle.ts missing shouldAbortTablePath export');

// 8. G-B2 EMIS / NHS print table outer counts check (N9)
const gb2CasePath = path.join(root, 'tests/Golden_biomarker/examples/G-B2_emis_nhs_table/case.json');
ok(fs.existsSync(gb2CasePath), 'N9:gb2_case_exists', 'missing G-B2 case.json');

const gb2ExpectedPath = path.join(root, 'tests/Golden_biomarker/examples/G-B2_emis_nhs_table/expected.json');
ok(fs.existsSync(gb2ExpectedPath), 'N9:gb2_expected_exists', 'missing G-B2 expected.json');
if (fs.existsSync(gb2ExpectedPath)) {
  const gb2Expected = read('tests/Golden_biomarker/examples/G-B2_emis_nhs_table/expected.json');
  ok(gb2Expected.includes('classCounts') || gb2Expected.includes('assertByClassCounts'), 'N9:class_counts_assert', 'G-B2 expected.json must assert class counts');
}

// 8b. G-B5 WRONG_DOOR check
const gb5CasePath = path.join(root, 'tests/Golden_biomarker/examples/G-B5_food_in_medical/case.json');
ok(fs.existsSync(gb5CasePath), 'N10:gb5_case_exists', 'missing G-B5 case.json');
const gb5ExpectedPath = path.join(root, 'tests/Golden_biomarker/examples/G-B5_food_in_medical/expected.json');
ok(fs.existsSync(gb5ExpectedPath), 'N10:gb5_expected_exists', 'missing G-B5 expected.json');
if (fs.existsSync(gb5ExpectedPath)) {
  const gb5Expected = read('tests/Golden_biomarker/examples/G-B5_food_in_medical/expected.json');
  ok(gb5Expected.includes('WRONG_DOOR'), 'N10:gb5_wrong_door', 'G-B5 expected.json must assert WRONG_DOOR class');
}

// 9. Flagged apply calls enrich / applyModificationCommands (N11)
ok(lifecycleTs.includes('applyModificationCommands') || lifecycleTs.includes('enrichReviewModificationCommands'), 'N11:flagged_apply', 'biomarkerLifecycle.ts missing applyModificationCommands/enrichReviewModificationCommands');

// 10. sourceReportId on ingest merge and filterHistoryForUse (N12)
const dateUtilsTs = read('src/utils/dateUtils.ts');
ok(dateUtilsTs.includes('sourceReportId'), 'N12:sourceReportId', 'dateUtils.ts missing sourceReportId on ingest merge');
ok(lifecycleTs.includes('filterHistoryForUse'), 'N12:filterHistoryForUse', 'biomarkerLifecycle.ts missing filterHistoryForUse export');

// 11. Inbox mentions Biomarkers and domain tab (N13)
const inboxPanel = read('src/components/GoldenInboxPanel.tsx');
ok(inboxPanel.includes('biomarkers') && inboxPanel.includes('domainTab'), 'N13:inbox_domain_tab', 'GoldenInboxPanel.tsx missing biomarkers domain tab');

if (failed > 0) {
  console.error(`\nGate FAILED with ${failed} failure(s).`);
  process.exit(1);
} else {
  console.log('\nAll Biomarker Ingest assertions PASSED (exit 0).');
  process.exit(0);
}
