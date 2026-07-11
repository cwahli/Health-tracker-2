const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const insertFunc = `function extractBalancedJson(text: string): string {
  let cleaned = text.replace(/\`\`\`(?:json)?/gi, "").replace(/\`\`\`/g, "").trim();
  const startIdx = cleaned.indexOf("{");
  if (startIdx !== -1) {
    let depth = 0;
    for (let i = startIdx; i < cleaned.length; i++) {
      if (cleaned[i] === "{") depth++;
      else if (cleaned[i] === "}") depth--;
      if (depth === 0) {
        return cleaned.substring(startIdx, i + 1);
      }
    }
  }
  return cleaned;
}
`;

if (!code.includes('function extractBalancedJson')) {
  code = code.replace('const app = express();', insertFunc + '\\nconst app = express();');
  fs.writeFileSync('server.ts', code);
}
