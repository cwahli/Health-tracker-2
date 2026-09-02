const fs = require('fs');
let text = fs.readFileSync('AI_HANDOVER.md', 'utf-8');
text = text.replace(
  "| **Track B** | C1-C7 shipped. Modal wiring next. | B0 Apply smoke. Modal wiring. |",
  "| **Track B** | B0 Apply smoke & Modal wiring COMPLETE. | B8.2/8.3 or next open Track B. |"
);
fs.writeFileSync('AI_HANDOVER.md', text, 'utf-8');
console.log("Updated AI_HANDOVER.md");
