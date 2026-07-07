const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const targetStr = `          let cleanJson = textOutput.replace(/\\\`\\\`\\\`(?:json)?/gi, "").trim();
          res.json(JSON.parse(cleanJson));`;

const replacement = `          let cleanJson = textOutput.replace(/\\\`\\\`\\\`(?:json)?/gi, "").trim();
          let parsed;
          try {
            parsed = JSON.parse(cleanJson);
          } catch (e) {
            const firstBrace = cleanJson.indexOf("{");
            const lastBrace = cleanJson.lastIndexOf("}");
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
              parsed = JSON.parse(cleanJson.substring(firstBrace, lastBrace + 1));
            } else {
              throw e;
            }
          }
          res.json(parsed);`;

code = code.replace(targetStr, replacement);
fs.writeFileSync('server.ts', code);
console.log("Patched route-chat JSON parsing");
