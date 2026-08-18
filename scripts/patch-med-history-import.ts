import fs from 'fs';
const path = 'src/components/MedicalHistoryTab.tsx';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('import { runGeneralizedBiomarkerAudit }')) {
  code = code.replace(
    "import { getAgentCalibration, formatOptimalTargetValue } from '../utils/agentCalibration';",
    "import { getAgentCalibration, formatOptimalTargetValue } from '../utils/agentCalibration';\nimport { runGeneralizedBiomarkerAudit } from '../utils/biomarkerAuditEngine';"
  );
  fs.writeFileSync(path, code);
}
