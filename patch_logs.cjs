const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

code = code.replace(
  /const imagesSnap = await getDocs\(collection\(db, 'users', uid, 'foodImages'\)\);/g,
  `console.log("Fetching foodImages...");\n              const imagesSnap = await getDocs(collection(db, 'users', uid, 'foodImages'));\n              console.log("Fetched foodImages successfully.");`
);

code = code.replace(
  /const foodLogsSnap = await withTimeout\(getDocs\(collection\(db, 'users', uid, 'foodLogs'\)\), 15000, 'getDocs \(foodLogs\)'\);/g,
  `console.log("Fetching foodLogs...");\n              const foodLogsSnap = await withTimeout(getDocs(collection(db, 'users', uid, 'foodLogs')), 15000, 'getDocs (foodLogs)');\n              console.log("Fetched foodLogs successfully.");`
);

fs.writeFileSync('src/App.tsx', code);
