const fs = require('fs');
let code = fs.readFileSync('src/types.ts', 'utf8');

const newTypes = `export type Severity = 'Normal' | 'Borderline at risk' | 'At risk';

export interface SimpleRangeCondition {
  operator: '>=' | '<=' | '>' | '<';
  value: number;
  alias: string;
  severity: Severity;
}

export interface SimpleRange {
  type: 'simple';
  conditions: [SimpleRangeCondition, SimpleRangeCondition];
}

export interface BracketRangeCondition {
  min: number | null;
  max: number | null;
  alias: string;
  severity: Severity;
}

export interface BracketRange {
  type: 'bracket';
  brackets: BracketRangeCondition[];
}

export type RangeConfig = SimpleRange | BracketRange;

export interface CustomRangeFilter {
  ethnicity?: string;
  gender?: string;
  minAge?: number | '';
  maxAge?: number | '';
}

export interface CustomRangeDef {
  id: string;
  filters: CustomRangeFilter;
  range: RangeConfig;
}

`;

code = newTypes + code;

code = code.replace(
  '      normalRange: string;',
  '      normalRange: string;\n      rangeConfig?: RangeConfig;\n      customRanges?: CustomRangeDef[];'
);

fs.writeFileSync('src/types.ts', code);
console.log("Patched types.ts");
