const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf-8');

const regex = /\/\/ Merge profile fields based on newest timestamp[\s\S]*?\/\/ Determine if we need to write changes back to the cloud/m;

const replacement = `// Merge logic
          if (!localHasEdits) {
            console.log("[Sync] Local device has no new edits since last sync. Taking cloud data as truth.");
            mergedProfile = {
              ...cloudProfile,
              customBiomarkers: mergedCustomBiomarkers,
              deletedFoodLogIds: Array.from(deletedFoods),
              deletedBiomarkerLogIds: Array.from(deletedBioLogs),
              deletedCustomBiomarkerKeys: Array.from(deletedCustomKeys)
            } as UserProfile;
            mergedFoods = [...filteredFoods];
            mergedBioHistory = [...filteredBioHistory];
            mergedActions = [...acts];
            mergedBenefits = [...bens];
            mergedReport = cloudReport;
          } else {
            console.log("[Sync] Local device has edits. Merging bidirectionally.");
            const isLocalProfileNewer = localTime >= cloudTime;
            if (isLocalProfileNewer) {
              mergedProfile = {
                ...cloudProfile,
                ...localProfile,
                customBiomarkers: mergedCustomBiomarkers,
                deletedFoodLogIds: Array.from(deletedFoods),
                deletedBiomarkerLogIds: Array.from(deletedBioLogs),
                deletedCustomBiomarkerKeys: Array.from(deletedCustomKeys)
              } as UserProfile;
            } else {
              mergedProfile = {
                ...localProfile,
                ...cloudProfile,
                customBiomarkers: mergedCustomBiomarkers,
                deletedFoodLogIds: Array.from(deletedFoods),
                deletedBiomarkerLogIds: Array.from(deletedBioLogs),
                deletedCustomBiomarkerKeys: Array.from(deletedCustomKeys)
              } as UserProfile;
            }

            mergedFoods = [...filteredFoods];
            filteredLocalFoods.forEach(localFood => {
              const existingCloudIndex = mergedFoods.findIndex(f => f.id === localFood.id);
              if (existingCloudIndex === -1) {
                mergedFoods.push(localFood);
              } else {
                const cloudFood = mergedFoods[existingCloudIndex];
                if (localTime >= cloudTime) {
                  mergedFoods[existingCloudIndex] = {
                    ...cloudFood,
                    ...localFood,
                    imageUrl: localFood.imageUrl || cloudFood.imageUrl,
                    imageUrls: (localFood.imageUrls && localFood.imageUrls.length > 0) ? localFood.imageUrls : cloudFood.imageUrls,
                  };
                }
              }
            });

            mergedBioHistory = [...filteredBioHistory];
            filteredLocalBioHistory.forEach(localLog => {
              const existingCloudIndex = mergedBioHistory.findIndex(b => b.id === localLog.id);
              if (existingCloudIndex === -1) {
                mergedBioHistory.push(localLog);
              } else {
                if (localTime >= cloudTime) {
                  mergedBioHistory[existingCloudIndex] = {
                    ...mergedBioHistory[existingCloudIndex],
                    ...localLog,
                    biomarkers: { ...mergedBioHistory[existingCloudIndex].biomarkers, ...localLog.biomarkers }
                  };
                }
              }
            });

            mergedActions = [...acts];
            localActions.forEach(localAct => {
              const existingCloudIndex = mergedActions.findIndex(a => a.id === localAct.id);
              if (existingCloudIndex === -1) {
                mergedActions.push(localAct);
              } else {
                if (localTime >= cloudTime) {
                  mergedActions[existingCloudIndex] = { ...mergedActions[existingCloudIndex], ...localAct };
                }
              }
            });

            mergedBenefits = [...bens];
            localBenefits.forEach(localBen => {
              const existingCloudIndex = mergedBenefits.findIndex(b => b.id === localBen.id);
              if (existingCloudIndex === -1) {
                mergedBenefits.push(localBen);
              } else {
                if (localTime >= cloudTime) {
                  mergedBenefits[existingCloudIndex] = { ...mergedBenefits[existingCloudIndex], ...localBen };
                }
              }
            });
          }

          // Determine if we need to write changes back to the cloud`;

code = code.replace(regex, replacement);
fs.writeFileSync('src/App.tsx', code);
