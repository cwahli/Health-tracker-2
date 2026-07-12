const fs = require('fs');
const content = fs.readFileSync('server.ts', 'utf8');

let count = 0;
let lines = content.split('\n');

for (let j = 1915; j < 2720; j++) {
    const l = lines[j];
    for (let c of l) {
        if (c === '{') count++;
        if (c === '}') count--;
    }
    if (j >= 2710 && j <= 2720) {
        console.log(`Line ${j+1} (${count}): ${l}`);
    }
}
