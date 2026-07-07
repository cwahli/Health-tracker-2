const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regex = /<div className="flex items-center gap-2 animation-fade-in overflow-x-auto pb-2 -mx-2 px-2 hide-scrollbar w-full">/;

const newClasses = `<div className="flex flex-wrap items-center gap-2 animation-fade-in pb-2 w-full">`;

code = code.replace(regex, newClasses);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched dropdown cropping");
