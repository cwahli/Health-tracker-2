const fs = require('fs');
let code = fs.readFileSync('src/utils/biomarkers.ts', 'utf8');

const evaluateCode = `
export function evaluateStructuredRange(num: number, customDef: any, profile?: any): { label: string, severity: string } | null {
  if (!customDef) return null;
  const { rangeConfig, customRanges } = customDef;
  
  if (!rangeConfig && (!customRanges || customRanges.length === 0)) return null;

  let activeRange = rangeConfig;

  // Check custom ranges first (they override)
  if (customRanges && customRanges.length > 0) {
    for (const cr of customRanges) {
      let match = true;
      if (profile && cr.filters) {
        if (cr.filters.gender && profile.gender && cr.filters.gender.toLowerCase() !== profile.gender.toLowerCase()) match = false;
        if (cr.filters.ethnicity && profile.ethnicity) {
          const t = cr.filters.ethnicity.toLowerCase();
          const p = profile.ethnicity.toLowerCase();
          if (!p.includes(t) && !t.includes(p)) match = false;
        }
        if (cr.filters.minAge !== undefined && cr.filters.minAge !== '' && profile.age && profile.age < Number(cr.filters.minAge)) match = false;
        if (cr.filters.maxAge !== undefined && cr.filters.maxAge !== '' && profile.age && profile.age > Number(cr.filters.maxAge)) match = false;
      }
      if (match) {
        activeRange = cr.range;
        break;
      }
    }
  }

  if (!activeRange) return null;

  if (activeRange.type === 'simple') {
    for (const cond of activeRange.conditions) {
      let isMatch = false;
      switch (cond.operator) {
        case '>=': isMatch = num >= cond.value; break;
        case '<=': isMatch = num <= cond.value; break;
        case '>': isMatch = num > cond.value; break;
        case '<': isMatch = num < cond.value; break;
      }
      if (isMatch) return { label: cond.alias, severity: cond.severity };
    }
  } else if (activeRange.type === 'bracket') {
    for (const br of activeRange.brackets) {
      let isMatch = true;
      if (br.min !== null && num < br.min) isMatch = false;
      if (br.max !== null && num >= br.max) isMatch = false;
      if (isMatch) return { label: br.alias, severity: br.severity };
    }
  }

  return null;
}
`;

code = evaluateCode + '\n' + code;

const oldGetStatus = `export const getBiomarkerStatus = (key: string, val: number | string, normalRangeStr?: string, customDef?: any, profile?: any): 'normal' | 'low' | 'high' | 'critical' | 'unknown' => {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return 'unknown';

  if (customDef?.structuredRanges?.length > 0) {`;

const newGetStatus = `export const getBiomarkerStatus = (key: string, val: number | string, normalRangeStr?: string, customDef?: any, profile?: any): 'normal' | 'low' | 'high' | 'critical' | 'unknown' => {
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return 'unknown';

  const res = evaluateStructuredRange(num, customDef, profile);
  if (res) {
    if (res.severity === 'At risk') return 'critical';
    if (res.severity === 'Borderline at risk') return 'high';
    return 'normal';
  }

  if (customDef?.structuredRanges?.length > 0) {`;

code = code.replace(oldGetStatus, newGetStatus);

const oldGetLabel = `export const getCustomStatusLabel = (key: string, value: number | string, customDef: any, profile?: any): string | null => {
  if (!customDef) return null;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return null;

  if (customDef.structuredRanges && customDef.structuredRanges.length > 0) {`;

const newGetLabel = `export const getCustomStatusLabel = (key: string, value: number | string, customDef: any, profile?: any): string | null => {
  if (!customDef) return null;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return null;

  const res = evaluateStructuredRange(num, customDef, profile);
  if (res) return res.label;

  if (customDef.structuredRanges && customDef.structuredRanges.length > 0) {`;

code = code.replace(oldGetLabel, newGetLabel);

fs.writeFileSync('src/utils/biomarkers.ts', code);
console.log("Patched biomarkers.ts utils");
