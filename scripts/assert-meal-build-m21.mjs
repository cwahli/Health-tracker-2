import fs from 'fs';
import path from 'path';

function checkFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`Missing file: ${filePath}`);
    process.exit(1);
  }
}

function checkFileContains(filePath, strings) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const str of strings) {
    if (!content.includes(str)) {
      console.error(`Missing string in ${filePath}: ${str}`);
      process.exit(1);
    }
  }
}

function checkFileMatches(filePath, regexes) {
  const content = fs.readFileSync(filePath, 'utf8');
  for (const regex of regexes) {
    if (!regex.test(content)) {
      console.error(`Missing regex pattern in ${filePath}: ${regex}`);
      process.exit(1);
    }
  }
}

// 1. Files exist
const filesToCheck = [
  'src/mealBuild/types.ts',
  'src/mealBuild/consolidate.ts',
  'src/mealBuild/adapters.ts',
  'src/mealBuild/fieldInventory.ts',
  'plan/MEAL_BUILD_DURABLE_STATE.md'
];

for (const file of filesToCheck) {
  checkFileExists(file);
}

// 2. Source strings
const sourceFiles = [
  'src/mealBuild/types.ts',
  'src/mealBuild/consolidate.ts',
  'src/mealBuild/adapters.ts',
  'src/mealBuild/fieldInventory.ts'
];

let allContent = '';
for (const file of sourceFiles) {
  allContent += fs.readFileSync(file, 'utf8') + '\n';
}

const requiredStrings = [
  'CRITICAL_PRESERVE_FIELDS',
  'consolidateMeal',
  'toPendingFoodLog',
  'ComparisonSet',
  'degradedStages',
  'stageLedger',
  'savable',
  'historyLog',
  'migrateMealSchema'
];

for (const str of requiredStrings) {
  if (!allContent.includes(str)) {
    console.error(`Missing global source string: ${str}`);
    process.exit(1);
  }
}

if (!allContent.includes('stageKey') && !allContent.includes('makeStageKey')) {
  console.error(`Missing stageKey or makeStageKey`);
  process.exit(1);
}

if (!allContent.includes('expectedVersion') && !allContent.includes('lastUpdatedBy')) {
  console.error(`Missing expectedVersion or lastUpdatedBy`);
  process.exit(1);
}


// 3. server.ts or orchestrator contains dietitian degrade / savable path
const serverContent = fs.existsSync('server_meal_orchestrator.ts') 
  ? fs.readFileSync('server.ts', 'utf8') + fs.readFileSync('server_meal_orchestrator.ts', 'utf8')
  : fs.readFileSync('server.ts', 'utf8');

if (!serverContent.includes('retry_advice') && !serverContent.includes('degradedStages')) {
  console.error(`server.ts missing dietitian degrade path (retry_advice or degradedStages)`);
  process.exit(1);
}
if (!serverContent.includes('savable')) {
  console.error(`server.ts missing savable`);
  process.exit(1);
}

// 4. TaskPlaceholderCard shows save path
checkFileMatches('src/components/TaskPlaceholderCard.tsx', [
  /degradedStages|savable|Retry Advice/i
]);

// 5. Does not require Temporal/LangGraph
if (serverContent.includes('Temporal') || serverContent.includes('LangGraph')) {
  console.error(`server.ts contains Temporal or LangGraph`);
  process.exit(1);
}

// 6. fieldInventory lists critical items
checkFileContains('src/mealBuild/fieldInventory.ts', [
  'rawNutritionLabel',
  'estimatedCalories',
  'componentsDetailList',
  'scoutIndex',
  'primaryBase100g',
  'diningEnvironment'
]);

// 7. debugPayload or report builder references stageLedger or historyLog
checkFileMatches('src/utils/debugPayload.ts', [
  /stageLedger|historyLog/
]);

console.log('assert-meal-build-m21.mjs: ALL PASSED');
process.exit(0);
