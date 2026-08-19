const fs = require('fs');
let content = fs.readFileSync('AI_HANDOVER.md', 'utf8');
content += `
35. **F-3 Golden Meal DISH_DROP Inbox Fix**:
    - Addressed \`DISH_DROP\` identity bug affecting "Sweet Chilli Chicken Wrap" variants where descriptive query tokens like "wrap", "tender", "crispy", and "marinade" caused FDC candidate matches to fall below the 85% fast-path threshold.
    - **Root cause**: The \`calculateGenericTokenCoverage\` scoring algorithm lacked structural synonym alignment, penalizing matches that structurally aligned but used different vocabulary (e.g., query "wrap" vs DB "tortilla").
    - **Fix**: Upgraded \`isTokenMatch\` in \`server_matching_engine.ts\` to use a static \`SYNONYMS\` mapping dictionary. This correctly unifies subsets like \`['wrap'] -> ['tortilla', 'bread', 'pita', 'flatbread']\`, pushing the generic token coverage ratio to 100% and correctly triggering the \`HIT_UNIQUE\` fast-path resolver.
    - **Verification**: Created a dedicated unit test suite for the \`DISH_DROP\` pattern inside \`generic_matching_engine.test.ts\`. Promoted both "Sweet Chilli Chicken Wrap" cases to G15 and G16. Ran full test suites, \`tsc\`, and curator gates. All tests green.
`;
fs.writeFileSync('AI_HANDOVER.md', content);
