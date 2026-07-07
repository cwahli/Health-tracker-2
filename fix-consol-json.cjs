const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const regex = /\{  "explanation": "A friendly conversational summary answering the user's prompt or explaining the proposed groupings\.",  "yamlText": "The RAW YAML text containing the flat YAML array of objects representing the groups\. IMPORTANT: The yamlText field must contain a string formatted in valid YAML as shown below\."\}Expected YAML structure for the 'yamlText' field string:- groupName: "Group Title \(e\.g\. Serum Albumin\)"  recommendedClinicalName: "Recommended Clinical Name"  recommendedUniqueKey: "recommended_unique_key"  biomarkers:    - key: "original_biomarker_key"      name: "Original Biomarker Name"      medicalGrouping: "Original Medical Grouping"      unit: "Original Unit"      range: "Original normal range"      description: "Original description"/g;

const newText = `{
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

code = code.replace(regex, newText);
fs.writeFileSync('server.ts', code);
