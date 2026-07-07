const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const nameRegex = /                                \{\/\* Name \*\/\}\n                                <tr className="py-2">/g;
code = code.replace(nameRegex, `                                {/* Name */}
                                {idx === 0 && <tr className="py-2">`);

const unitRegex = /                                <\/tr>\n                                \{\/\* Unit \*\/\}\n                                <tr className="py-2">/g;
code = code.replace(unitRegex, `                                </tr>}
                                {/* Unit */}
                                {idx === 0 && <tr className="py-2">`);

const valueRegex = /                                <\/tr>\n                                \{\/\* Value \*\/\}\n                                <tr className="py-2">/g;
code = code.replace(valueRegex, `                                </tr>}
                                {/* Value */}
                                <tr className="py-2">`);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
