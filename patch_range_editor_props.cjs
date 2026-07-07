const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerRangeBuilder.tsx', 'utf8');

const oldNormal = `<RangeEditor 
            range={rangeConfig} 
            onChange={updateNormalRange} 
            title="Base Normal Range"
          />`;
const newNormal = `<RangeEditor 
            range={rangeConfig}
            normalRangeStr={normalRangeStr} 
            onChange={updateNormalRange} 
            title="Base Normal Range"
          />`;
code = code.replace(oldNormal, newNormal);

const oldCustom = `<RangeEditor 
                  range={cr.range} 
                  onChange={(r) => {`;
const newCustom = `<RangeEditor 
                  range={cr.range}
                  normalRangeStr={normalRangeStr} 
                  onChange={(r) => {`;
code = code.replace(oldCustom, newCustom);

fs.writeFileSync('src/components/BiomarkerRangeBuilder.tsx', code);
console.log("Patched");
