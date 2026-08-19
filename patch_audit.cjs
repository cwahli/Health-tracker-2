const fs = require('fs');
const content = fs.readFileSync('src/utils/biomarkerAuditEngine.ts', 'utf8');

const search = `export function getDuplicateAliasGroups(
  customBiomarkers: Record<string, any>,
  biomarkerHistory: any[],
  currentBiomarkers: Record<string, any>,
  deletedCustomBiomarkerKeys: Record<string, number> = {}
) {`;

const replace = `let _lastAliasArgs: any[] = [];
let _lastAliasResult: any = null;

export function getDuplicateAliasGroups(
  customBiomarkers: Record<string, any>,
  biomarkerHistory: any[],
  currentBiomarkers: Record<string, any>,
  deletedCustomBiomarkerKeys: Record<string, number> = {}
) {
  if (
    _lastAliasArgs[0] === customBiomarkers &&
    _lastAliasArgs[1] === biomarkerHistory &&
    _lastAliasArgs[2] === currentBiomarkers &&
    _lastAliasArgs[3] === deletedCustomBiomarkerKeys
  ) {
    return _lastAliasResult;
  }
  _lastAliasResult = _getDuplicateAliasGroups(customBiomarkers, biomarkerHistory, currentBiomarkers, deletedCustomBiomarkerKeys);
  _lastAliasArgs = [customBiomarkers, biomarkerHistory, currentBiomarkers, deletedCustomBiomarkerKeys];
  return _lastAliasResult;
}

function _getDuplicateAliasGroups(
  customBiomarkers: Record<string, any>,
  biomarkerHistory: any[],
  currentBiomarkers: Record<string, any>,
  deletedCustomBiomarkerKeys: Record<string, number> = {}
) {`;

fs.writeFileSync('src/utils/biomarkerAuditEngine.ts', content.replace(search, replace));
