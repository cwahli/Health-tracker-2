import fs from 'fs';

let jobEvents = fs.readFileSync('src/jobs/jobEvents.ts', 'utf-8');
jobEvents = jobEvents.replace(
  "export type JobEvent = { error?: any; attemptCount?: number; resumeStage?: string; progressPercent?: number; clientSubmitPending?: boolean; photoUrl?: string; debugUrl?: string; mealBuild?: any; inFlightTurnAt?: number; attemptByStep?: any; abortController?: any; startedAt?: string; finishedAt?: string; retryNotBefore?: number }",
  "export type JobEvent = { result?: any; status?: any; error?: any; attemptCount?: number; resumeStage?: string; progressPercent?: number; clientSubmitPending?: boolean; photoUrl?: string; debugUrl?: string; mealBuild?: any; inFlightTurnAt?: number; attemptByStep?: any; abortController?: any; startedAt?: string; finishedAt?: string; retryNotBefore?: number }"
);
fs.writeFileSync('src/jobs/jobEvents.ts', jobEvents);

let sync = fs.readFileSync('src/jobs/SupabaseJobSync.ts', 'utf-8');
sync = sync.replace(
  "if (row.status === 'succeeded' && cleanRes && !cleanRes.is_r2) {",
  "let assistantMsg: any = undefined;\n          if (row.status === 'succeeded' && cleanRes && !cleanRes.is_r2) {"
);
fs.writeFileSync('src/jobs/SupabaseJobSync.ts', sync);
