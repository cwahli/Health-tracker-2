const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regexHandler = /\/\/ Run Name Consolidation Agent\n  const handleRunConsolidationAgent = async \(\) => \{[\s\S]*?setConsolidationLoading\(false\);\n    \}\n  \};/;

const replacement = `// Run Name Consolidation Agent (Chat Interface)
  const handleRunConsolidationAgent = async (isManualClick = false) => {
    if (selectedKeys.length === 0) return;
    
    let userMsg = null;
    const text = consolidationInput.trim();
    if (text || isManualClick) {
      userMsg = {
        role: 'user',
        content: text || "Please identify the duplicates from the provided list and consolidate them.",
        timestamp: new Date().toISOString()
      };
      setConsolidationMessages(prev => [...prev, userMsg]);
    }
    
    setConsolidationInput('');
    setConsolidationLoading(true);
    setConsolidationYaml(null);
    setConsolidationGroups(null);

    try {
      const selectedBiomarkerDetails = selectedKeys.map(k => {
        const customDef: any = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((b: any) => b.key === k);
        return {
          key: k,
          name: customDef?.name || k,
          medicalGrouping: customDef?.standardMedicalGrouping || customDef?.medicalGrouping || '',
          unit: customDef?.unit || '',
          range: customDef?.normalRange || '',
          description: customDef?.description || ''
        };
      });

      const sessionId = getSessionId();

      const res = await fetch('/api/gemini/consolidate-names', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        },
        body: JSON.stringify({
          inputText: userMsg?.content,
          selectedBiomarkers: selectedBiomarkerDetails,
          engine: nameConsolidationModel,
          customSystemInstruction: localStorage.getItem('custom_system_instruction_consolidate_names') || undefined
        })
      });

      if (!res.ok) throw new Error("Failed to contact name consolidation agent");
      const data = await res.json();
      
      setConsolidationYaml(data.yamlText);
      const parsed = parseConsolidationYaml(data.yamlText || '');
      setConsolidationGroups(parsed);

      const initialEdits: any = {};
      parsed.forEach((group: any, idx: number) => {
        const firstKey = group.biomarkers?.[0]?.key || group.recommendedUniqueKey || '';
        initialEdits[idx] = {
          recommendedClinicalName: group.recommendedClinicalName || group.groupName || '',
          recommendedUniqueKey: group.recommendedUniqueKey || '',
          masterKey: firstKey,
          excludedKeys: {}
        };
      });
      setGroupEdits(initialEdits);

      if (data.explanation) {
        setConsolidationMessages(prev => [...prev, {
          role: 'agent',
          content: data.explanation,
          timestamp: new Date().toISOString()
        }]);
      }
    } catch (error: any) {
      console.error(error);
      alert("Error running name consolidation agent: " + error.message);
      setConsolidationMessages(prev => [...prev, {
        role: 'agent',
        content: "Error: " + error.message,
        isError: true,
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setConsolidationLoading(false);
    }
  };`;

code = code.replace(regexHandler, replacement);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
