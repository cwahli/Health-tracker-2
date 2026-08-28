import fs from 'fs';
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const target = `const inputSnapshot = {
          text: userContent,
          imageRefs: [],`;
const replace = `const inputSnapshot = {
          text: userContent,
          explicitFoodTags,
          imageRefs: [],`;

code = code.replace(target, replace);
fs.writeFileSync('src/components/LogChat.tsx', code);
console.log("Patched inputSnapshot");
