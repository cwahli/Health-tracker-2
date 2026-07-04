const fs = require('fs');
const code = fs.readFileSync('src/App.tsx', 'utf-8');
const lines = code.split('\n');
let start = lines.findIndex(l => l.includes('const handleDeleteEmptyBiomarkers ='));
let end = lines.findIndex((l, i) => i > start && l.startsWith('  const handleEditBiomarkerLog ='));
console.log(lines.slice(start, end).join('\n'));
