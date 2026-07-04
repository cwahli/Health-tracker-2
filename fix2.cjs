const fs = require('fs');
let content = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

// Add import
content = "import { ErrorBoundary } from './ErrorBoundary';\n" + content;

// Replace <AgentResultTable
content = content.replace(/<AgentResultTable/g, '<ErrorBoundary>\n                        <AgentResultTable');

// Carefully replace the closing tag of AgentResultTable
// It looks like:
//                          }}
//                        />
content = content.replace(/                          }}\n                        \/>/g, '                          }}\n                        />\n                        </ErrorBoundary>');

fs.writeFileSync('src/components/LogChat.tsx', content);
