const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// Replace { type: 'profile' } with { type: 'fullPush' } for bulk biomarker modifications
code = code.replace(/handleDeleteEmptyBiomarkers([^]*?)type: 'profile'/g, "handleDeleteEmptyBiomarkers$1type: 'fullPush'");
code = code.replace(/handleDeleteBiomarker =([^]*?)type: 'profile'/g, "handleDeleteBiomarker =$1type: 'fullPush'");
code = code.replace(/handleDeleteMultipleBiomarkers([^]*?)type: 'profile'/g, "handleDeleteMultipleBiomarkers$1type: 'fullPush'");
code = code.replace(/handleStandardizeBiomarkerUnits([^]*?)type: 'multi'/g, "handleStandardizeBiomarkerUnits$1type: 'fullPush'");
code = code.replace(/handleCombineBiomarkers([^]*?)type: 'profile'/g, "handleCombineBiomarkers$1type: 'fullPush'");
code = code.replace(/handleBatchCombineBiomarkers([^]*?)type: 'profile'/g, "handleBatchCombineBiomarkers$1type: 'fullPush'");
code = code.replace(/handleBatchConsolidate([^]*?)type: 'multi'/g, "handleBatchConsolidate$1type: 'fullPush'");

fs.writeFileSync('src/App.tsx', code);
console.log("Updated sync types successfully.");
