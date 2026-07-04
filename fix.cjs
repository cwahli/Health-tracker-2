const fs = require('fs');
let content = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

content = content.replace('import { ErrorBoundary } from "./ErrorBoundary";\n', '');
content = content.replace(/<ErrorBoundary><AgentResultTable/g, '<AgentResultTable');
content = content.replace(/<\/ErrorBoundary>\n                        <\/div>/g, '/>\n                        </div>');
content = content.replace(/<\/ErrorBoundary>\n                      \) : \(/g, '/>\n                      ) : (');
content = content.replace(/<\/ErrorBoundary>\n                      \)}/g, '/>\n                      )}');

fs.writeFileSync('src/components/LogChat.tsx', content);
