const fs = require('fs');
const content = fs.readFileSync('src/utils/biomarkerAuditEngine.ts', 'utf8');

const search = `export function runGeneralizedBiomarkerAudit(
  customBiomarkers: Record<string, any>,
  biomarkerHistory: any[],
  currentBiomarkers: Record<string, any> = {},
  deletedCustomBiomarkerKeys: Record<string, number> = {}
): BiomarkerAuditReport {`;

const replace = `let _lastAuditArgs: any[] = [];
let _lastAuditResult: BiomarkerAuditReport | null = null;

export function runGeneralizedBiomarkerAudit(
  customBiomarkers: Record<string, any>,
  biomarkerHistory: any[],
  currentBiomarkers: Record<string, any> = {},
  deletedCustomBiomarkerKeys: Record<string, number> = {}
): BiomarkerAuditReport {
  if (
    _lastAuditArgs[0] === customBiomarkers &&
    _lastAuditArgs[1] === biomarkerHistory &&
    _lastAuditArgs[2] === currentBiomarkers &&
    _lastAuditArgs[3] === deletedCustomBiomarkerKeys &&
    _lastAuditResult !== null
  ) {
    return _lastAuditResult;
  }
  _lastAuditResult = _runGeneralizedBiomarkerAudit(customBiomarkers, biomarkerHistory, currentBiomarkers, deletedCustomBiomarkerKeys);
  _lastAuditArgs = [customBiomarkers, biomarkerHistory, currentBiomarkers, deletedCustomBiomarkerKeys];
  return _lastAuditResult;
}

function _runGeneralizedBiomarkerAudit(
  customBiomarkers: Record<string, any>,
  biomarkerHistory: any[],
  currentBiomarkers: Record<string, any> = {},
  deletedCustomBiomarkerKeys: Record<string, number> = {}
): BiomarkerAuditReport {`;

fs.writeFileSync('src/utils/biomarkerAuditEngine.ts', content.replace(search, replace));
