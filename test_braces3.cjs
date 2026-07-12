const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf8');
let lines = content.split('\n');
let stack = [];
for (let j = 1915; j < 2714; j++) {
    const l = lines[j];
    for (let c of l) {
        if (c === '{') stack.push(j+1);
        if (c === '}') stack.pop();
    }
}
console.log("Unclosed braces opened at lines:", stack);
