const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

// fix dashboard writes
code = code.replace(/setDoc\(doc\(db, 'users', uid, 'metadata', 'dashboard'\), \{\s*actions: currActions\.map\(cleanData\)\s*\}\)/g, "setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), { actions: currActions.map(cleanData) }, { merge: true })");

code = code.replace(/setDoc\(doc\(db, 'users', uid, 'metadata', 'dashboard'\), \{\s*dailyBenefits: currBenefits\.map\(cleanData\)\s*\}\)/g, "setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), { dailyBenefits: currBenefits.map(cleanData) }, { merge: true })");

code = code.replace(/setDoc\(doc\(db, 'users', uid, 'metadata', 'dashboard'\), \{\s*foodIdeas: currFoodIdeas\.map\(cleanData\)\s*\}\)/g, "setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), { foodIdeas: currFoodIdeas.map(cleanData) }, { merge: true })");

// fix initial login
code = code.replace(/setDoc\(userDocRef, cleanData\(localProfile\)\)/g, "setDoc(userDocRef, cleanData(localProfile), { merge: true })");
code = code.replace(/setDoc\(userDocRef, cleanData\(newProfile\)\)/g, "setDoc(userDocRef, cleanData(newProfile), { merge: true })");

fs.writeFileSync('src/App.tsx', code);
