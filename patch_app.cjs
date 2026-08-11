const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetMedicalStart = `          if (job.kind === 'medical') {`;
const targetFoodLocal = `          if ((job.kind === 'food_log' || job.kind === 'food_compare') && (job.resumeStage || job.statusMessage?.includes('Retry'))) {`;
const targetServerOwned = `          // Durable food jobs execute on server via /api/jobs/submit
          if ((job.kind === 'food_log' || job.kind === 'food_compare') && !job.resumeStage && !job.statusMessage?.includes('Retry')) {`;

const startIndex = code.indexOf(targetMedicalStart);
const endIndex = code.indexOf(targetServerOwned);

if (startIndex !== -1 && endIndex !== -1) {
  const replacement = `          // Durable jobs execute on server via /api/jobs/submit
          if (job.kind === 'food_log' || job.kind === 'food_compare' || job.kind === 'medical') {
`;
  code = code.substring(0, startIndex) + replacement + code.substring(endIndex + targetServerOwned.length + 1);
  fs.writeFileSync('src/App.tsx', code);
  console.log('Patched src/App.tsx');
} else {
  console.log('Targets not found');
}
