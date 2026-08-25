const fs = require('fs');
let code = fs.readFileSync('src/components/AllAnalysesModal.tsx', 'utf8');

const modalStart = code.indexOf('{/* Delete Confirmation Modal */}');
if (modalStart !== -1) {
  const modalEnd = code.indexOf('</div>\n        </div>\n      )}', modalStart);
  if (modalEnd !== -1) {
    code = code.substring(0, modalStart) + code.substring(modalEnd + '</div>\n        </div>\n      )}'.length);
  }
}

fs.writeFileSync('src/components/AllAnalysesModal.tsx', code);
