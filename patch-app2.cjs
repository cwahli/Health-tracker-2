const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

code = code.replace(
    /aliases: row\.newCatalogDraft\.aliases \|\| \[\],/g,
    ""
);

code = code.replace(
    /const existing = updatedCustoms\[key\] \|\| \{ name: row\.printed, unit: row\.unit \};/g,
    "const existing = updatedCustoms[key] || { name: row.printed, unit: row.unit, normalRange: '', description: '' };"
);

code = code.replace(
    /type: 'medicalAnalyzeBatch',/g,
    "type: 'biomarkerLogsBatch',"
);

fs.writeFileSync('src/App.tsx', code, 'utf-8');
