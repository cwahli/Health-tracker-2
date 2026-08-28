import fs from 'fs';
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const target = `            portionChoices: extraOptions?.portionChoices,`;
const replace = `            explicitFoodTags,
            portionChoices: extraOptions?.portionChoices,`;

code = code.replace(target, replace);
fs.writeFileSync('src/components/LogChat.tsx', code);
console.log("Patched submitPayload");
