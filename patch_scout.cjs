const fs = require('fs');
let code = fs.readFileSync('agents/scoutInstructions.ts', 'utf8');

code = code.replace(
/  const baseInstruction = \`Analyze the provided \$\{imageCount > 1 \? imageCount \+ ' meal images' : 'meal image'\}\. Inspect all visible prepared dishes, cooking pots, grocery packages, and barcode labels\. Read any visible OCR text on cups, wrappers, or menus to identify fast-food brands or commercial chains, and use these to anchor the nutritional estimation \(e\.g\. calories and fat for commercial deep-fried items\) to standard commercial nutrition tables\. Ingest all visible foods and packages completely into dishes and constituent foods\.\`;/g,
`  const multiImageRule = imageCount > 1 
    ? " CRITICAL MULTI-IMAGE REQUIREMENT: Extract ALL distinct food items seen across ALL images. Do not ignore any food item."
    : "";
  const baseInstruction = \`Analyze the provided \${imageCount > 1 ? imageCount + ' meal images' : 'meal image'}. Inspect all visible prepared dishes, cooking pots, grocery packages, and barcode labels. Read any visible OCR text on cups, wrappers, or menus to identify fast-food brands or commercial chains, and use these to anchor the nutritional estimation (e.g. calories and fat for commercial deep-fried items) to standard commercial nutrition tables. Ingest all visible foods and packages completely into dishes and constituent foods.\${multiImageRule}\`;`
);

fs.writeFileSync('agents/scoutInstructions.ts', code);
