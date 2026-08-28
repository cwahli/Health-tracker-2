import fs from 'fs';
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const target = `setInputText('');`;
const replace = `setInputText('');
        setExplicitFoodTags([]);`;

code = code.replace(target, replace);
fs.writeFileSync('src/components/LogChat.tsx', code);
console.log("Patched clear explicitFoodTags");
