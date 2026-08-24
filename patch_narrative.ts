import fs from 'fs';
let code = fs.readFileSync('server_pure_helpers.ts', 'utf8');

// Protein
code = code.replace(
  /\\\\b\\[\\\\d,\\]\\+\\(\\\\\\.\\\\d\\+\\)\\?\\\\s\\*g\\\\s\\*\\(of\\\\s\\*\\)\\?protein\\\\b/gi,
  '\\b[\\d,]+(\\.\\d+)?\\s*g\\s*(of\\s*)?([a-zA-Z-]+\\s+)*protein\\b'
);

// We need a better script to replace the regexes
