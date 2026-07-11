const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

code = code.replace(`type: 'profile' | 'foodLog' | 'biomarkerLog'`, `type: 'profile' | 'foodLog' | 'biomarkerLog' | 'biomarkerLogsBatch'`);
code = code.replace(`targetId?: string;`, `targetId?: string;\n      targetIds?: string[];`);

const newBranch = `        } else if (specificUpdate.type === 'biomarkerLogsBatch' && specificUpdate.targetIds) {
          const promises = specificUpdate.targetIds.map(id => {
            const b = currBioHistory.find(item => item.id === id);
            if (b) {
              const itemTrackId = logInteraction('upload', \`users/\${uid}/biomarkerHistory/\${b.id}\`, b);
              return setDoc(doc(db, 'users', uid, 'biomarkerHistory', b.id), cleanData(b))
                .then(() => completeInteraction(itemTrackId, true, JSON.stringify(b).length))
                .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); handleFirestoreError(err); console.error(err); });
            }
            return Promise.resolve();
          });
          
          const profilePromise = setDoc(doc(db, 'users', uid), cleanData(profileForCloud)).catch(err => handleFirestoreError(err));
          
          await withTimeout(Promise.all([...promises, profilePromise]), 3000, 'biomarkerLogsBatch');
`;

code = code.replace(`} else if (specificUpdate.type === 'actions') {`, newBranch + `        } else if (specificUpdate.type === 'actions') {`);

fs.writeFileSync('src/App.tsx', code);
console.log("Updated saveAndSync");
