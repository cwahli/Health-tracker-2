import { execSync } from 'child_process';
try {
  console.log('Running automated baseline regression test for Biomarker C1-C7 (dry run)...');
  execSync('npx tsx prototype/biomarkers/runner.ts --only "C1, C2, C3, C4, C5, C6, C7" --dry-run', { stdio: 'inherit' });
  console.log('\n✅ All C1-C7 prototype baseline tests PASSED.');
  process.exit(0);
} catch (error) {
  console.error('\n❌ Baseline tests FAILED. Production wiring or instruction updates caused a regression.');
  process.exit(1);
}
