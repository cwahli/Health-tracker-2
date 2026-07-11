const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

code = code.replace(
  `          const localHasEdits = localProfile?.lastUpdatedAt && lastSyncedAt && (localProfile.lastUpdatedAt > lastSyncedAt + 2000);
          const cloudHasEdits = cloudProfile?.lastUpdatedAt && lastSyncedAt && (cloudProfile.lastUpdatedAt > lastSyncedAt + 2000);`,
  `          const localHasEdits = !!(localProfile?.lastUpdatedAt && (!lastSyncedAt || localProfile.lastUpdatedAt > lastSyncedAt + 2000));
          const cloudHasEdits = !!(cloudProfile?.lastUpdatedAt && (!lastSyncedAt || cloudProfile.lastUpdatedAt > lastSyncedAt + 2000));`
);

code = code.replace(
  `          // The user explicitly requested: "Then whenever the desktop or mobile do a sync, it should take the latest entry from firebase and update the device accordingly"
          // So we will just rely on the bidirectional merge below and never show the conflict panel.
          const isConflict = false;`,
  `          // Show the conflict panel if BOTH cloud and local have independent edits that might conflict
          // AND there's an actual difference in the data lengths.
          // Otherwise, we rely on the bidirectional merge below.
          const isConflict = localHasEdits && cloudHasEdits && (hasDifferentFoods || hasDifferentBioHistory || hasDifferentActions || hasDifferentBenefits);`
);

fs.writeFileSync('src/App.tsx', code);
