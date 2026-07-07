const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regex = /      const parsed = data\.groups \|\| \[\];\n      setConsolidationGroups\(parsed\);/g;
const newText = `      const parsed = data.groups || [];
      setConsolidationGroups(parsed);

      const newAnalysis = {
        id: \`analysis_\${Date.now()}_\${Math.random().toString(36).substring(2, 9)}\`,
        agentType: 'name_consolidation',
        date: new Date().toISOString(),
        result: {
          inputText: userMsg?.content || "Auto-Consolidation",
          explanation: data.explanation || '',
          groups: parsed
        }
      };

      if (onAgentAnalysisSaved) {
        await onAgentAnalysisSaved('name_consolidation', newAnalysis.result);
      } else {
        const currentAnalyses = profile.agentAnalyses || [];
        onUpdateProfile({
          agentAnalyses: [...currentAnalyses, newAnalysis]
        });
      }`;

if (code.match(regex)) {
  code = code.replace(regex, newText);
  fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
  console.log('Fixed UI');
} else {
  console.log('Regex did not match');
}
