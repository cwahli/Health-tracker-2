const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const startIdx = code.indexOf('function robustParseJson');
if (startIdx !== -1) {
  const throwIdx = code.indexOf('throw parseErr;', startIdx);
  const endIdx = code.indexOf('}', throwIdx);
  const replacement = `function robustParseJson(cleanJson: string): any {
  let cleaned = cleanJson.replace(/\\\`\\\`\\\`(?:json)?/gi, "").replace(/\\\`\\\`\\\`/g, "").trim();
  
  // Array fallback
  if (cleaned.startsWith("[")) {
      let depth = 0;
      for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] === "[") depth++;
        else if (cleaned[i] === "]") depth--;
        if (depth === 0) {
          return JSON.parse(cleaned.substring(0, i + 1));
        }
      }
  }
  
  return JSON.parse(extractBalancedJson(cleaned));
}`;

  code = code.substring(0, startIdx) + replacement + code.substring(endIdx + 1);
  fs.writeFileSync('server.ts', code);
  console.log("Fixed robustParseJson");
}
