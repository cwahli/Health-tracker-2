const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

code = code.replace(
  `  const withTimeout = <T,>(promise: Promise<T> | T, timeoutMs: number, label: string): Promise<T | void> => {
    return Promise.race([
      Promise.resolve(promise),
      new Promise<void>((resolve) => {
        setTimeout(() => {
          console.warn(\`[Firestore Sync Timeout] \${label} took more than \${timeoutMs}ms. Continuing in background/offline cache.\`);
          setSyncState('local');
          resolve();
        }, timeoutMs);
      })
    ]);
  };`,
  `  const withTimeout = <T,>(promise: Promise<T> | T, timeoutMs: number, label: string): Promise<T | void> => {
    let timeoutId: any;
    return Promise.race([
      Promise.resolve(promise).then(res => {
        clearTimeout(timeoutId);
        return res;
      }).catch(err => {
        clearTimeout(timeoutId);
        throw err;
      }),
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(\`[Firestore Sync Timeout] \${label} took more than \${timeoutMs}ms. Continuing in background/offline cache.\`);
          setSyncState('local');
          resolve();
        }, timeoutMs);
      })
    ]);
  };`
);

fs.writeFileSync('src/App.tsx', code);
