import fs from 'fs';

let content = fs.readFileSync('src/jobs/JobQueueRunner.ts', 'utf-8');
content = content.replace("JobStore.apply({ id: job.id, type: 'ServerStatus',\\n            result: cleanResult,", "JobStore.apply({ id: job.id, type: 'AnalyzeFinished',\\n            result: cleanResult,");
fs.writeFileSync('src/jobs/JobQueueRunner.ts', content);
