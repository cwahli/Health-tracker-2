import fs from 'fs';
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const targetStr = `      const words = inputText.trim().split(/\\s+/);
      const searchTerms = words.slice(Math.max(words.length - 4, 0)).join(' ');`;

const replacement = `      // Strip out anything inside brackets to avoid searching for already tagged items
      const strippedInput = inputText.replace(/\\[.*?\\]/g, '').trim();
      if (strippedInput.length < 3) {
        setCatalogMatches([]);
        return;
      }
      const words = strippedInput.split(/\\s+/);
      const searchTerms = words.slice(Math.max(words.length - 4, 0)).join(' ');`;

code = code.replace(targetStr, replacement);
fs.writeFileSync('src/components/LogChat.tsx', code);
console.log("Patched search trigger to ignore tags");
