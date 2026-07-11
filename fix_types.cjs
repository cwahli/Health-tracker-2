const fs = require('fs');
let code = fs.readFileSync('src/types.ts', 'utf8');

const target = `  customBiomarkers?: {
    [key: string]: {
      name: string;
      unit: string;
      normalRange: string;
      rangeConfig?: RangeConfig;
      customRanges?: CustomRangeDef[];
      structuredRanges?: {`;

const replace = `  customBiomarkers?: {
    [key: string]: {
      name: string;
      unit: string;
      normalRange: string;
      needsApproval?: boolean;
      rangeConfig?: RangeConfig;
      customRanges?: CustomRangeDef[];
      structuredRanges?: {`;

if (code.includes(target)) {
  code = code.split(target).join(replace);
  fs.writeFileSync('src/types.ts', code);
  console.log("Updated types.ts successfully.");
} else {
  console.log("Targets not found in types.ts!");
}
