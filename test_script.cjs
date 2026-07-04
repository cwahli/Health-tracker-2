const fs = require('fs');
console.log(fs.readFileSync('src/types.ts', 'utf-8').includes('consumedAmount'));
