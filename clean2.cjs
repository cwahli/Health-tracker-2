const fs = require('fs');
let code = fs.readFileSync('src/components/AllAnalysesModal.tsx', 'utf8');

// The portal is not used, it is just in the render
const regex = /\{\/\* Delete Confirmation Modal \*\/\}[\s\S]*?<\/div>\s*\)\s*\}\s*<\/div>\s*,\s*document\.body\s*\)\s*;\s*\}/;
// Actually wait, let's just use string replace.
let parts = code.split('{/* Delete Confirmation Modal */}');
if (parts.length > 1) {
  let bottom = parts[1];
  let endOfModal = bottom.indexOf('{/* Add to history toast */}');
  if (endOfModal === -1) {
    endOfModal = bottom.indexOf('</div>,');
    if (endOfModal === -1) {
        endOfModal = bottom.indexOf('</div>\n    </div>,\n    document.body\n  );\n}');
        if (endOfModal !== -1) {
           code = parts[0] + '</div>\n    </div>,\n    document.body\n  );\n}';
        }
    }
  }
}

// Ensure jobToDelete is completely gone
code = code.replace(/const \[jobToDelete, setJobToDelete\] = useState<string \| null>\(null\);\s*/, '');
code = code.replace(/const confirmDeleteJob = async \(\) => \{[\s\S]*?\}\s*;\s*/, '');
fs.writeFileSync('src/components/AllAnalysesModal.tsx', code);
