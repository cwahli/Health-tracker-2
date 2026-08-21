const fs = require('fs');
let code = fs.readFileSync('server_food_resolver_curator.ts', 'utf8');

const injection = `
      const verifyId = async (id: string, nameToMatch: string) => {
        if (!fetchFoodDetailsFn) return true;
        try {
          const details = await fetchFoodDetailsFn(id);
          if (details) {
            const overlap = calculateTokenOverlap(gap.query, details.title);
            if (overlap < 0.65 && !hasCoreTokenOverlap(gap.query, details.title)) {
              addDebugLog(\`[TitleVerification] REJECTED: FDC \${id} title "\${details.title}" has low similarity with query "\${gap.query}".\`);
              return false;
            }
            const macroCheck = checkMacroBoundary(gap.query, details.nutrients);
            if (!macroCheck.passed) {
              addDebugLog(\`[MacroBoundaryFilter] REJECTED: FDC \${id} \${macroCheck.reason}\`);
              return false;
            }
            return true;
          }
        } catch (e) {}
        return true;
      };
`;

code = code.replace(/let finalChosenId: string \| null = null;/, 'let finalChosenId: string | null = null;' + injection);

fs.writeFileSync('server_food_resolver_curator.ts', code);
