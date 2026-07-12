import re
with open('src/components/BiomarkerDictionaryModal.tsx', 'r') as f:
    content = f.read()
content = content.replace("const parsed = data.groups || [];", "const parsed = data.consolidatedGroups || data.groups || [];")
content = content.replace("setConsolidationYaml(JSON.stringify(data.groups, null, 2));", "setConsolidationYaml(JSON.stringify(parsed, null, 2));")

# Also for accuracy agent
content = content.replace("const parsed = data.anomalies || [];", "const parsed = data.anomalies || [];\n      setAccuracyYaml(JSON.stringify(data.anomalies || [], null, 2));")
with open('src/components/BiomarkerDictionaryModal.tsx', 'w') as f:
    f.write(content)
