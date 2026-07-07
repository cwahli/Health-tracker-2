const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const regex = /JSON Schema:\n\{\n  "explanation": "A friendly conversational summary answering the user's prompt or explaining the proposed groupings\.",\n  "yamlText": "The RAW YAML text containing the flat YAML array of objects representing the groups\. IMPORTANT: The yamlText field must contain a string formatted in valid YAML as shown below\."\n\}\nExpected YAML structure for the 'yamlText' field string:\n- groupName: "Group Title \(e\.g\. Serum Albumin\)"\n  recommendedClinicalName: "Recommended Clinical Name"\n  recommendedUniqueKey: "recommended_unique_key"\n  biomarkers:\n    - key: "original_biomarker_key"\n      name: "Original Biomarker Name"\n      medicalGrouping: "Original Medical Grouping"\n      unit: "Original Unit"\n      range: "Original normal range"\n      description: "Original description"/g;

const newText = `JSON Schema:
{
  "explanation": "A friendly conversational summary answering the user's prompt or explaining the proposed groupings.",
  "groups": [
    {
      "groupName": "Group Title (e.g. Serum Albumin)",
      "recommendedClinicalName": "Recommended Clinical Name",
      "recommendedUniqueKey": "recommended_unique_key",
      "biomarkers": [
        {
          "key": "original_biomarker_key",
          "name": "Original Biomarker Name",
          "medicalGrouping": "Original Medical Grouping",
          "unit": "Original Unit",
          "range": "Original normal range",
          "description": "Original description"
        }
      ]
    }
  ]
}`;

let newCode = code.replace(regex, newText);
fs.writeFileSync('server.ts', newCode);
console.log('Fixed server.ts');
