const fs = require('fs');
const content = fs.readFileSync('server_matching_engine.ts', 'utf8');
const lines = content.split('\n');
lines.splice(335, 9); // Remove lines 336-344 (index 335 to 343)
fs.writeFileSync('server_matching_engine.ts', lines.join('\n'));
