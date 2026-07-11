const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

code = code.replace(
  `    const uid = forceUserId || auth.currentUser?.uid;`,
  `    const uid = forceUserId || auth.currentUser?.uid;
    console.log("Checking DB changes for UID:", uid);`
);

fs.writeFileSync('src/App.tsx', code);
