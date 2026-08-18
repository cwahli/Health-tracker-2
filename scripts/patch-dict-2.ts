import fs from 'fs';
const path = 'src/components/BiomarkerDictionaryModal.tsx';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('runGeneralizedBiomarkerAudit')) {
  code = code.replace(
    "import { saveAgentRequestLog } from '../utils/agentLogsTracker';",
    "import { saveAgentRequestLog } from '../utils/agentLogsTracker';\nimport { runGeneralizedBiomarkerAudit } from '../utils/biomarkerAuditEngine';"
  );
}

fs.writeFileSync(path, code);
