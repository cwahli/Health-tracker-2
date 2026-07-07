const val = "80-120 ml/min".trim().toLowerCase();
const bracketMatch = val.match(/^([\d.]+)\s*-\s*([\d.]+)(?:\s+.*)?$/);
console.log(bracketMatch);

const val2 = "< 0".trim().toLowerCase();
const lessMatch = val2.match(/^(<|<=|under|less than|below)\s*([\d.]+)(?:\s+.*)?$/);
console.log(lessMatch);

const val3 = "<0".trim().toLowerCase();
const lessMatch3 = val3.match(/^(<|<=|under|less than|below)\s*([\d.]+)(?:\s+.*)?$/);
console.log(lessMatch3);

const val4 = "150 mmol/L".trim().toLowerCase();
const plainMatch = val4.match(/^([\d.]+)(?:\s+.*)?$/);
console.log(plainMatch);

