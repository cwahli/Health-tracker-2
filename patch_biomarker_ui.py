import re

with open('src/components/BiomarkerDictionaryModal.tsx', 'r') as f:
    content = f.read()

# Update handleRunStandardizationAgent to expect jsonResponse
content = re.sub(
    r'setStandardizationYaml\(data\.yamlText\);\s*const parsed = parseStandardizationYaml\(data\.yamlText\);',
    r'''
      const jsonData = typeof data.jsonResponse === 'string' ? JSON.parse(data.jsonResponse) : data.jsonResponse;
      setStandardizationYaml(JSON.stringify(jsonData, null, 2));
      let parsed = jsonData.mappedBiomarkers || jsonData.categorisedBiomarkers || [];
      // Normalize key
      parsed = parsed.map((item: any) => ({
        ...item,
        key: item.originalKey || item.key
      }));
''',
    content
)

with open('src/components/BiomarkerDictionaryModal.tsx', 'w') as f:
    f.write(content)
