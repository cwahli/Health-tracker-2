import fs from 'fs';

let content = fs.readFileSync('src/jobs/JobQueueRunner.ts', 'utf-8');

content = content.replace(/JobStore\.updateJob\(job\.id, \{/g, 'JobStore.apply({ id: job.id, type: \\'ServerStatus\\', /* will adjust below */');

fs.writeFileSync('src/jobs/JobQueueRunner.ts', content);
