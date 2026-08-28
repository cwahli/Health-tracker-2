import fs from 'fs';
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const target = `    if (type !== 'food' || inputText.trim().length < 3) {
      setCatalogMatches([]);
      return;
    }`;
const replace = `    // Sync tags with text - if a tag text is no longer in the input, remove it from state
    setExplicitFoodTags(prev => prev.filter(tag => inputText.includes(\`[\${tag.name} \${tag.weightGrams}g]\`)));

    if (type !== 'food' || inputText.trim().length < 3) {
      setCatalogMatches([]);
      return;
    }`;

code = code.replace(target, replace);
fs.writeFileSync('src/components/LogChat.tsx', code);
console.log("Patched sync_tags");
