const fs = require('fs');
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

code = code.replace(
  `          .then(data => {
            console.log('[LogChat] Job successfully submitted to server:', data);
            JobStore.updateJob(currentJobId, {
              status: 'queued',
              statusMessage: 'Analyzing on server...',
              serverSubmittedAt: Date.now(),
              clientSubmitPending: false,
            });
            JobQueueRunner.wake();
          })`,
  `          .then(data => {
            console.log('[LogChat] Job successfully submitted to server:', data);
            JobStore.updateJob(currentJobId, {
              status: 'queued',
              statusMessage: 'Analyzing on server...',
              serverSubmittedAt: Date.now(),
              clientSubmitPending: false,
            });
            JobQueueRunner.wake();
            clearBreadcrumbs();
          })`
);

fs.writeFileSync('src/components/LogChat.tsx', code, 'utf8');
console.log('Fixed LogChat.tsx clearBreadcrumbs');
