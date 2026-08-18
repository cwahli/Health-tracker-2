import fs from 'fs';

const path = 'src/components/BiomarkerDictionaryModal.tsx';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('runGeneralizedBiomarkerAudit')) {
  code = code.replace(
    "import { isPendingCatalogApproval } from '../utils/biomarkerAuditEngine';",
    "import { isPendingCatalogApproval, runGeneralizedBiomarkerAudit } from '../utils/biomarkerAuditEngine';"
  );
}

fs.writeFileSync(path, code);
