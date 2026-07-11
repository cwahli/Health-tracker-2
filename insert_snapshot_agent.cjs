const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetStr = `        onAgentFinish={async (agentType, agentResult) => {
          setIsMedicalChatOpen(false);`;

const insertStr = `        onAgentFinish={async (agentType, agentResult) => {
          // \u2500\u2500\u2500 SNAPSHOT BEFORE ANY CHANGE (FIX-8) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
          const snapLabel = \`Before \${agentType} approval (\${new Date().toLocaleTimeString()})\`;
          saveLocalSnapshot(snapLabel, profile?.email, {
            profile,
            foodLogs,
            biomarkers,
            biomarkerHistory,
            actions,
            dailyBenefits,
            report
          });
          if (profile?.email) {
            setSnapshots(loadLocalSnapshots(profile.email));
          }
          setLastSnapshotLabel(snapLabel);
          // \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
          setIsMedicalChatOpen(false);`;

code = code.replace(targetStr, insertStr);
fs.writeFileSync('src/App.tsx', code);
