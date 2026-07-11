const fs = require('fs');
let code = fs.readFileSync('src/components/LogChat.tsx', 'utf8');

const target = `bodyData.existingBiomarkers = biomarkers ? Object.keys(biomarkers) : [];`;
const replace = `bodyData.existingBiomarkers = Array.from(new Set([...(biomarkers ? Object.keys(biomarkers) : []), ...Object.keys(profile?.customBiomarkers || {})]));`;

if(code.includes(target)) {
  code = code.split(target).join(replace);
  console.log("Updated bodyData.existingBiomarkers");
} else {
  console.log("Could not find bodyData.existingBiomarkers");
}

fs.writeFileSync('src/components/LogChat.tsx', code);
