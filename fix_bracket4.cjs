const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerRangeBuilder.tsx', 'utf8');

const targetStr = '  );\nconst RangeEditor:';
if (code.includes(targetStr)) {
  code = code.replace(targetStr, '  );\n};\n\nconst RangeEditor:');
  fs.writeFileSync('src/components/BiomarkerRangeBuilder.tsx', code);
  console.log("Fixed!");
} else {
  const targetStr2 = '  );\nconst RangeEditor';
  if (code.includes(targetStr2)) {
    code = code.replace(targetStr2, '  );\n};\n\nconst RangeEditor');
    fs.writeFileSync('src/components/BiomarkerRangeBuilder.tsx', code);
    console.log("Fixed 2!");
  } else {
    console.log("Not found.");
  }
}
