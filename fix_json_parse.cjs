const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const targetStr = `    const firstBrace = resultText.indexOf("{");
    const lastBrace = resultText.lastIndexOf("}");
    let cleanedText = resultText;
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanedText = resultText.substring(firstBrace, lastBrace + 1);
    } else {
      cleanedText = cleanedText.replace(/\`\`\`json/g, "").replace(/\`\`\`/g, "").trim();
    }`;

const insertStr = `    let cleanedText = resultText.replace(/\`\`\`(?:json)?/gi, "").replace(/\`\`\`/g, "").trim();
    // Safely extract the first balanced JSON object to avoid trailing text issues
    const startIdx = cleanedText.indexOf("{");
    if (startIdx !== -1) {
      let depth = 0;
      for (let i = startIdx; i < cleanedText.length; i++) {
        if (cleanedText[i] === "{") depth++;
        else if (cleanedText[i] === "}") depth--;
        if (depth === 0) {
          cleanedText = cleanedText.substring(startIdx, i + 1);
          break;
        }
      }
    }`;

code = code.replace(targetStr, insertStr);
fs.writeFileSync('server.ts', code);
