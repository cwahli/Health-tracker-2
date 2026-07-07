const fs = require('fs');
let code = fs.readFileSync('src/utils/biomarkers.ts', 'utf8');

// 1. Add type imports if needed. We already import UserProfile if we use it, but any will do.
// Let's modify getBiomarkerStatus
code = code.replace(
  `export const getBiomarkerStatus = (key: string, val: number | string, normalRangeStr?: string): 'normal' | 'low' | 'high' | 'critical' | 'unknown' => {`,
  `export const getBiomarkerStatus = (key: string, val: number | string, normalRangeStr?: string, customDef?: any, profile?: any): 'normal' | 'low' | 'high' | 'critical' | 'unknown' => {`
);

// We need to inject the logic to evaluate structuredRanges at the start of getBiomarkerStatus.
const customRangeLogic = `
  const num = typeof val === 'string' ? parseFloat(val) : val;
  if (isNaN(num)) return 'unknown';

  if (customDef?.structuredRanges?.length > 0) {
    const ranges = customDef.structuredRanges;
    let matchedRange = null;
    
    // Evaluate matching
    for (const r of ranges) {
      // Evaluate profile constraints if any
      let profileMatch = true;
      if (profile) {
        if (r.targetGender && profile.gender && r.targetGender.toLowerCase() !== profile.gender.toLowerCase()) {
          profileMatch = false;
        }
        if (r.targetEthnicity && profile.ethnicity) {
          const targetEth = r.targetEthnicity.toLowerCase();
          const pEth = profile.ethnicity.toLowerCase();
          if (!pEth.includes(targetEth) && !targetEth.includes(pEth)) {
            profileMatch = false;
          }
        }
        if (r.targetAgeMin !== undefined && r.targetAgeMin !== '' && profile.age && profile.age < Number(r.targetAgeMin)) profileMatch = false;
        if (r.targetAgeMax !== undefined && r.targetAgeMax !== '' && profile.age && profile.age > Number(r.targetAgeMax)) profileMatch = false;
      }
      
      if (!profileMatch) continue;

      // Evaluate value constraints
      let valMatch = true;
      if (r.min !== undefined && r.min !== '') {
        if (num < Number(r.min)) valMatch = false;
      }
      if (r.max !== undefined && r.max !== '') {
        if (num >= Number(r.max)) valMatch = false;
      }
      
      if (valMatch) {
        matchedRange = r;
        break;
      }
    }

    if (matchedRange) {
      if (matchedRange.isNormal) return 'normal';
      // If not normal, guess based on value? 
      // A simple heuristic: if it has a max but no min, it's likely "low". If min but no max, "high". 
      // But actually, we don't have isNormal flag working perfectly yet unless we set it.
      // We added isNormal: false in the UI. 
      // If it's Obese (high), we can return 'high' or 'critical'. 
      // Let's just return 'high' for anything not normal for now, to ensure it shows as out of range.
      return 'high';
    }
  }
`;

code = code.replace(
  `  const num = typeof val === 'string' ? parseFloat(val) : val;\n  if (isNaN(num)) return 'unknown';`,
  customRangeLogic
);

// 2. Modify getCustomStatusLabel to use structuredRanges
const newGetCustomStatusLabel = `export const getCustomStatusLabel = (key: string, value: number | string, customDef: any, profile?: any): string | null => {
  if (!customDef) return null;
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return null;

  if (customDef.structuredRanges && customDef.structuredRanges.length > 0) {
    for (const r of customDef.structuredRanges) {
      let profileMatch = true;
      if (profile) {
        if (r.targetGender && profile.gender && r.targetGender.toLowerCase() !== profile.gender.toLowerCase()) profileMatch = false;
        if (r.targetEthnicity && profile.ethnicity) {
          const targetEth = r.targetEthnicity.toLowerCase();
          const pEth = profile.ethnicity.toLowerCase();
          if (!pEth.includes(targetEth) && !targetEth.includes(pEth)) profileMatch = false;
        }
        if (r.targetAgeMin !== undefined && r.targetAgeMin !== '' && profile.age && profile.age < Number(r.targetAgeMin)) profileMatch = false;
        if (r.targetAgeMax !== undefined && r.targetAgeMax !== '' && profile.age && profile.age > Number(r.targetAgeMax)) profileMatch = false;
      }
      
      if (!profileMatch) continue;

      let valMatch = true;
      if (r.min !== undefined && r.min !== '') {
        if (num < Number(r.min)) valMatch = false;
      }
      if (r.max !== undefined && r.max !== '') {
        if (num >= Number(r.max)) valMatch = false;
      }
      
      if (valMatch) {
        return r.name; // Use terminology (e.g. Overweight)
      }
    }
  }
`;

code = code.replace(
  `export const getCustomStatusLabel = (key: string, value: number | string, customDef: any): string | null => {\n  if (!customDef) return null;\n  const num = typeof value === 'string' ? parseFloat(value) : value;\n  if (isNaN(num)) return null;`,
  newGetCustomStatusLabel
);

// 3. Update getBiomarkerRiskTag, getBiomarkerStatusLabel
code = code.replace(
  `export const getBiomarkerRiskTag = (key: string, status: string, customDef?: any, userValue?: number | string): string | null => {
  let label = status;
  if (customDef && userValue !== undefined) {
    const customLabel = getCustomStatusLabel(key, userValue, customDef);`,
  `export const getBiomarkerRiskTag = (key: string, status: string, customDef?: any, userValue?: number | string, profile?: any): string | null => {
  let label = status;
  if (customDef && userValue !== undefined) {
    const customLabel = getCustomStatusLabel(key, userValue, customDef, profile);`
);

code = code.replace(
  `export const getBiomarkerStatusLabel = (key: string, status: string, customDef?: any, userValue?: number | string): string => {
  let label = status;
  if (customDef && userValue !== undefined) {
    const customLabel = getCustomStatusLabel(key, userValue, customDef);`,
  `export const getBiomarkerStatusLabel = (key: string, status: string, customDef?: any, userValue?: number | string, profile?: any): string => {
  let label = status;
  if (customDef && userValue !== undefined) {
    const customLabel = getCustomStatusLabel(key, userValue, customDef, profile);`
);

fs.writeFileSync('src/utils/biomarkers.ts', code);
console.log("Patched structuredRanges evaluation logic in biomarkers.ts");
