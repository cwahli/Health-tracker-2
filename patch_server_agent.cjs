const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  "2. Risk Categories. A JSON array of string tags (e.g. [\"Cardiovascular\", \"Metabolic\"]) representing associated risks.",
  "2. Risk Categories. A JSON array of string tags representing associated risks. YOU MUST ONLY CHOOSE FROM THESE EXACT CATEGORIES: \"Cardiovascular\", \"Kidney\", \"Metabolic\", \"Liver\", \"Hematology\", \"Biometric\", \"Psychologic\", \"Other\". Do NOT invent new ones."
);

fs.writeFileSync('server.ts', code);
console.log("Patched server.ts instructions");
