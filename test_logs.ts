import fs from 'fs';
const data = JSON.parse(fs.readFileSync('debug4.json', 'utf-8'));
const logs = data.backendLogs || '';
const fallbacks = [...logs.matchAll(/Created category fallback for gap "([^"]+)"/g)].map(m => m[1]);
console.log('Fallbacks:', fallbacks);
