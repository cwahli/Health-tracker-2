const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

code = code.replace(
  `const v2FoodDoc = await getDoc(doc(db, 'users', uid, 'metadata', 'foodLogs_v2'));`,
  `console.log("Fetching v2FoodDoc for uid:", uid);
            const v2FoodDoc = await getDoc(doc(db, 'users', uid, 'metadata', 'foodLogs_v2'));
            console.log("Successfully fetched v2FoodDoc. Exists:", v2FoodDoc.exists());`
);

code = code.replace(
  `const imagesSnap = await getDocs(collection(db, 'users', uid, 'foodImages'));`,
  `console.log("Fetching foodImages...");
              const imagesSnap = await getDocs(collection(db, 'users', uid, 'foodImages'));
              console.log("Successfully fetched foodImages.");`
);

code = code.replace(
  `const foodLogsSnap = await withTimeout(getDocs(collection(db, 'users', uid, 'foodLogs')), 15000, 'getDocs (foodLogs)');`,
  `console.log("Fetching foodLogs...");
              const foodLogsSnap = await withTimeout(getDocs(collection(db, 'users', uid, 'foodLogs')), 15000, 'getDocs (foodLogs)');
              console.log("Successfully fetched foodLogs.");`
);

fs.writeFileSync('src/App.tsx', code);
