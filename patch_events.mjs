import fs from 'fs';

let content = fs.readFileSync('src/jobs/jobEvents.ts', 'utf-8');
content = content.replace(
  "export type JobEvent = { photoUrl?: string; debugUrl?: string; mealBuild?: any; inFlightTurnAt?: number; attemptByStep?: any; abortController?: any; startedAt?: string; finishedAt?: string; retryNotBefore?: number }",
  "export type JobEvent = { error?: any; attemptCount?: number; resumeStage?: string; progressPercent?: number; clientSubmitPending?: boolean; photoUrl?: string; debugUrl?: string; mealBuild?: any; inFlightTurnAt?: number; attemptByStep?: any; abortController?: any; startedAt?: string; finishedAt?: string; retryNotBefore?: number }"
);
// Fix line 35
content = content.replace("patch.inFlightTurnAt = event.inFlightTurnAt;", "patch.inFlightTurnAt = event.inFlightTurnAt as any;");
fs.writeFileSync('src/jobs/jobEvents.ts', content);
