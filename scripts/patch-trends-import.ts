import fs from 'fs';
const path = 'src/components/TrendsTab.tsx';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('useCallback')) {
  code = code.replace("import React, { useState, useMemo } from 'react';", "import React, { useState, useMemo, useCallback } from 'react';");
}

fs.writeFileSync(path, code);
