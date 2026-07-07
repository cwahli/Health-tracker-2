const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const regex3 = /3\. Compare the following 5 fields between the user's current data \(from their dictionary and latest historical logs\) and the shared data:\n   - Biomarker Name \(dictionary def name\)\n   - Unit \(dictionary def unit\)\n   - Value \(latest log value for that key\)\n   - Date \(latest log date for that key\)\n   - Comments \(latest log note or specific test doctor comment, or general remarks\)/g;

const newText3 = `3. Compare the following 5 fields between the user's current data (from their dictionary and historical logs) and the shared data:
   - Biomarker Name (dictionary def name)
   - Unit (dictionary def unit)
   - Value (historical log value for that key on the matching date, or latest)
   - Date (historical log date for that key)
   - Comments (historical log note or specific test doctor comment)
   Match the date of the shared data with the historical logs to find the exact existing log. If no exact date match exists, compare against null or mark as a new log.`;

code = code.replace(regex3, newText3);
fs.writeFileSync('server.ts', code);
