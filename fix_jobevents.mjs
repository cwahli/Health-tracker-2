import fs from 'fs';

let content = fs.readFileSync('src/jobs/jobEvents.ts', 'utf-8');
content = content.replace("retryNotBefore?: number", "retryNotBefore?: string");
fs.writeFileSync('src/jobs/jobEvents.ts', content);
