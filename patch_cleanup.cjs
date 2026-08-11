const fs = require('fs');

let logchat = fs.readFileSync('src/components/LogChat.tsx', 'utf8');
logchat = logchat.replace(`import { executeFoodAgent, FoodAgentExecutorInput } from '../jobs/FoodAgentExecutor';`, '');
logchat = logchat.replace(`import { executeMedicalAgent } from '../jobs/MedicalAgentExecutor';`, '');
fs.writeFileSync('src/components/LogChat.tsx', logchat);

let appTsx = fs.readFileSync('src/App.tsx', 'utf8');
appTsx = appTsx.replace(`import { executeFoodAgent } from './jobs/FoodAgentExecutor';`, '');
appTsx = appTsx.replace(`import { executeMedicalAgent } from './jobs/MedicalAgentExecutor';`, '');
fs.writeFileSync('src/App.tsx', appTsx);

let runner = fs.readFileSync('src/jobs/JobQueueRunner.ts', 'utf8');
runner = runner.replace(`import { executeFoodAgent } from './FoodAgentExecutor';`, '');
// Replace the executor logic with a no-op dummy
const startIdx = runner.indexOf(`  private executor: JobExecutor = async (job, signal) => {`);
const endIdx = runner.indexOf(`  setExecutor(executor: JobExecutor) {`);
if (startIdx !== -1 && endIdx !== -1) {
  const replacement = `  private executor: JobExecutor = async (job, signal) => {
    throw new Error('Default local executor is disabled. Jobs are processed server-side.');
  };

`;
  runner = runner.substring(0, startIdx) + replacement + runner.substring(endIdx);
  fs.writeFileSync('src/jobs/JobQueueRunner.ts', runner);
}

console.log('Cleanup done');
