const fs = require('fs');
let code = fs.readFileSync('src/utils/debugPayload.ts', 'utf8');

code = code.replace(
  '    lastUserAction: result.lastUserAction || msg?.data?.lastUserAction,',
  '    lastUserAction: result.lastUserAction || msg?.data?.lastUserAction,\n    userActionBreadcrumbs: result.userActionBreadcrumbs || msg?.data?.userActionBreadcrumbs || job?.inputSnapshot?.userActionBreadcrumbs,'
);

fs.writeFileSync('src/utils/debugPayload.ts', code, 'utf8');
console.log('Fixed breadcrumbs extraction in debugPayload.ts');
