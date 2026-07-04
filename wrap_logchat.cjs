const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

if (!content.includes('import { ErrorBoundary }')) {
  content = content.replace("import React, { useState, useEffect } from 'react';", "import React, { useState, useEffect } from 'react';\nimport { ErrorBoundary } from './components/LogChat';");
}

content = content.replace(/<LogChat\s+type="food"/g, "<ErrorBoundary><LogChat type=\"food\"");
content = content.replace(/setIsManualFoodLogOpen\(true\);\n\s*\}\}\n\s*\/>/g, "setIsManualFoodLogOpen(true);\n        }}\n      /></ErrorBoundary>");

content = content.replace(/<LogChat\s+key={`medical_\$\{activeAgentType \|\| 'general'\}`}/g, "<ErrorBoundary><LogChat key={`medical_${activeAgentType || 'general'}`}");
content = content.replace(/setIsManualMedicalLogOpen\(true\);\n\s*\}\}\n\s*\/>/g, "setIsManualMedicalLogOpen(true);\n        }}\n      /></ErrorBoundary>");

fs.writeFileSync('src/App.tsx', content);
