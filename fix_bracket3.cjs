const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerRangeBuilder.tsx', 'utf8');

// Undo the aggressive sed
code = code.replace(/  \]\n};\n/g, '  ]\n');

// Now explicitly add }; after defaultSimpleRange and defaultBracketRange
// Luckily they look like:
// const defaultSimpleRange: SimpleRange = {
// ...
//   ]

code = code.replace(/const defaultSimpleRange: SimpleRange = \{[\s\S]*?  \]/m, match => match + '\n};');
code = code.replace(/const defaultBracketRange: BracketRange = \{[\s\S]*?  \]/m, match => match + '\n};');

fs.writeFileSync('src/components/BiomarkerRangeBuilder.tsx', code);
