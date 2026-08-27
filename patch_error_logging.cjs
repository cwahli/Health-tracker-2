const fs = require('fs');

let serverCode = fs.readFileSync('server.ts', 'utf8');
if (!serverCode.includes('/api/log-error')) {
  serverCode = serverCode.replace(
    'app.get("/api/health"',
    `app.post("/api/log-error", (req, res) => {
      let body = "";
      req.on('data', chunk => body += chunk.toString());
      req.on('end', () => {
        const fs = require('fs');
        fs.appendFileSync('client_errors.log', body + "\\n");
        res.end();
      });
    });
app.get("/api/health"`
  );
  fs.writeFileSync('server.ts', serverCode);
}

let mainCode = fs.readFileSync('src/main.tsx', 'utf8');
if (!mainCode.includes('/api/log-error')) {
  mainCode = mainCode.replace(
    'const origError = console.error;',
    `window.addEventListener('error', (e) => {
      try { fetch('/api/log-error', { method: 'POST', body: e.message || e.error?.message }).catch(()=>null); } catch(err){}
    });
    window.addEventListener('unhandledrejection', (e) => {
      try { fetch('/api/log-error', { method: 'POST', body: e.reason?.message || String(e.reason) }).catch(()=>null); } catch(err){}
    });
const origError = console.error;`
  );
  fs.writeFileSync('src/main.tsx', mainCode);
}
