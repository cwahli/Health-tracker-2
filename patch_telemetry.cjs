const fs = require('fs');
const content = fs.readFileSync('src/utils/biomarkers.ts', 'utf8');

const search = `export function detectFlaggedTelemetryErrors(
  resolvedBiomarkers: Record<string, any>,
  profile: any,
  activeHistory: any[],
  allDefinitions: any[]
): FlaggedTelemetryError[] {`;

const replace = `let _lastFlaggedArgs: any[] = [];
let _lastFlaggedResult: FlaggedTelemetryError[] = [];

export function detectFlaggedTelemetryErrors(
  resolvedBiomarkers: Record<string, any>,
  profile: any,
  activeHistory: any[],
  allDefinitions: any[]
): FlaggedTelemetryError[] {
  if (
    _lastFlaggedArgs[0] === resolvedBiomarkers &&
    _lastFlaggedArgs[1] === profile &&
    _lastFlaggedArgs[2] === activeHistory &&
    _lastFlaggedArgs[3] === allDefinitions
  ) {
    return _lastFlaggedResult;
  }
  _lastFlaggedResult = _detectFlaggedTelemetryErrors(resolvedBiomarkers, profile, activeHistory, allDefinitions);
  _lastFlaggedArgs = [resolvedBiomarkers, profile, activeHistory, allDefinitions];
  return _lastFlaggedResult;
}

function _detectFlaggedTelemetryErrors(
  resolvedBiomarkers: Record<string, any>,
  profile: any,
  activeHistory: any[],
  allDefinitions: any[]
): FlaggedTelemetryError[] {`;

fs.writeFileSync('src/utils/biomarkers.ts', content.replace(search, replace));
