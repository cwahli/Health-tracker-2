const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerRangeBuilder.tsx', 'utf8');

code = code.replace(`    }
};
};

export const BiomarkerRangeBuilder`, `    }
};

export const BiomarkerRangeBuilder`);

fs.writeFileSync('src/components/BiomarkerRangeBuilder.tsx', code);
