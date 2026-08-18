import fs from 'fs';

// Fix TrendsTab imports
let trendsPath = 'src/components/TrendsTab.tsx';
let trendsCode = fs.readFileSync(trendsPath, 'utf8');

trendsCode = trendsCode.replace(
  "import React, { useState } from 'react';",
  "import React, { useState, useMemo, useCallback } from 'react';"
);
trendsCode = trendsCode.replace(
  "import React, { useState, useMemo } from 'react';",
  "import React, { useState, useMemo, useCallback } from 'react';"
);

fs.writeFileSync(trendsPath, trendsCode);

// Fix BiomarkerDictionaryModal Props
let modalPath = 'src/components/BiomarkerDictionaryModal.tsx';
let modalCode = fs.readFileSync(modalPath, 'utf8');

modalCode = modalCode.replace(
  "  onConfirm: (approvedKeys: string[]) => void;\n}",
  "  onConfirm: (approvedKeys: string[]) => void;\n  auditReport?: any;\n}"
);

fs.writeFileSync(modalPath, modalCode);
