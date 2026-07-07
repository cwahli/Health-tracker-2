const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const oldRegex = /4\. Determine if each field is "same" or "different":\n   - Use comparison logic\. If one is missing or empty on one side and present on the other, it is "different"\.\n   - Set status to "same" if the content matches closely \(case-insensitive, trimmed, numeric values with different decimal places like 5 and 5\.0 are considered "same"\)\.\n   - Set status to "different" if there is any difference\./;

const newText = `4. Determine if each field is "same" or "different":
   - Use comparison logic. If one is missing or empty on one side and present on the other, it is "different".
   - Set status to "same" if the content matches closely (case-insensitive, trimmed, numeric values with different decimal places like 5 and 5.0 are considered "same").
   - Set status to "different" if there is any difference.

5. IMPORTANT: Handling Multiple Entries for the Same Biomarker:
   - If the user's input contains multiple log entries for the SAME biomarker (e.g., tests taken on multiple different dates, or multiple values), you MUST create and return a SEPARATE object in the \`comparisonResults\` array for EACH distinct instance or date. Do not combine or skip them.`;

code = code.replace(oldRegex, newText);

fs.writeFileSync('server.ts', code);
