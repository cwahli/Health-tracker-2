const fs = require('fs');
const content = fs.readFileSync('src/jobs/SupabaseJobSync.ts', 'utf8');

const broken = `export function initSupabaseJobSync(userId?: string): () => void {
  // Always hydrate initial jobs from server API on mount
  hydrateUserJobs(userId);`;

const fixed = `export function initSupabaseJobSync(userId?: string): () => void {
  // Always hydrate initial jobs from server API on mount (deferred to avoid blocking TTI)
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => { hydrateUserJobs(userId).catch(() => {}); }, { timeout: 2000 });
  } else {
    setTimeout(() => { hydrateUserJobs(userId).catch(() => {}); }, 1500);
  }`;

fs.writeFileSync('src/jobs/SupabaseJobSync.ts', content.replace(broken, fixed));
