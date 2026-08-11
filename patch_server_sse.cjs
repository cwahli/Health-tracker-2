const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const target1 = `app.post("/api/gemini/food-analyze", async (req, res) => {`;
const replacement1 = `app.post("/api/gemini/food-analyze", async (req, res) => {
  if (!req.headers['x-session-id'] || !req.headers['x-session-id'].toString().startsWith('server-job-')) {
    return res.status(403).json({ error: 'This SSE path is deprecated and strictly reserved for internal loopback execution.' });
  }`;

const target2 = `app.post("/api/gemini/medical-analyze", async (req, res) => {`;
const replacement2 = `app.post("/api/gemini/medical-analyze", async (req, res) => {
  if (!req.headers['x-session-id'] || !req.headers['x-session-id'].toString().startsWith('server-job-')) {
    return res.status(403).json({ error: 'This SSE path is deprecated and strictly reserved for internal loopback execution.' });
  }`;

code = code.replace(target1, replacement1);
code = code.replace(target2, replacement2);
fs.writeFileSync('server.ts', code);
console.log('Patched SSE endpoints to be internal-only');
