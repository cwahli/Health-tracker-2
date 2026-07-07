const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

// Find the original handleNormalRangeChange by looking for the one that is NOT immediately after biomarkerDefiniti
// Actually, I can just find the string "const handleNormalRangeChange = (val: string) => {" and its last index!
const firstHandle = code.indexOf('  const handleNormalRangeChange = (val: string) => {');
const lastHandle = code.lastIndexOf('  const handleNormalRangeChange = (val: string) => {');

console.log("First Handle:", firstHandle);
console.log("Last Handle:", lastHandle);

// What's before lastHandle?
console.log("Before lastHandle:");
console.log(code.substring(lastHandle - 50, lastHandle));

