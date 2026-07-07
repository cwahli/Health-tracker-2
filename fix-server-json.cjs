const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const regex = /JSON Schema:[\s\S]*?Biomarkers to process:\$\{JSON\.stringify\(selectedBiomarkers, null, 2\)\}\`\;/m;

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
}

Biomarkers to process:
\${JSON.stringify(selectedBiomarkers, null, 2)}\`;`;

if (code.match(regex)) {
  code = code.replace(regex, newText);
  fs.writeFileSync('server.ts', code);
  console.log('Fixed server.ts');
} else {
  console.log('Regex did not match');
}
