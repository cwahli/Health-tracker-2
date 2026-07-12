const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf8');
let count = 0;
for (let c of content) {
    if (c === '{') count++;
    if (c === '}') count--;
}
console.log("Total brace count for server.ts:", count);
