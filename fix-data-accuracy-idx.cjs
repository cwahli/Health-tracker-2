const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const fixUnitRegex = /                                <\/tr>\n                                \{\/\* Unit \*\/\}\n                                <tr className="py-2">/g;

code = code.replace(fixUnitRegex, `                                </tr>}
                                {/* Unit */}
                                {idx === 0 && <tr className="py-2">`);

const fixValueRegex = /                                <\/tr>\n                                \{\/\* Value \*\/\}\n                                <tr className="py-2">/g;
code = code.replace(fixValueRegex, `                                </tr>}
                                {/* Value */}
                                <tr className="py-2">`);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
