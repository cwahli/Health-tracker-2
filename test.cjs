const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regex = /                              <tbody className="divide-y divide-slate-50 dark:divide-slate-800\/30">[\s\S]*?                              <\/tbody>/g;
console.log(code.match(regex)[0]);
