const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerRangeBuilder.tsx', 'utf8');

const oldProps = `const RangeEditor: React.FC<{ range?: RangeConfig, onChange: (r?: RangeConfig) => void, title?: string }> = ({ range, onChange, title }) => {`;
const newProps = `const RangeEditor: React.FC<{ range?: RangeConfig, normalRangeStr?: string, onChange: (r?: RangeConfig) => void, title?: string }> = ({ range, normalRangeStr, onChange, title }) => {`;

code = code.replace(oldProps, newProps);
fs.writeFileSync('src/components/BiomarkerRangeBuilder.tsx', code);
console.log("Patched RangeEditor props");
