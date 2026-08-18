import fs from 'fs';

let path = 'src/components/BiomarkerAuditModal.tsx';
let code = fs.readFileSync(path, 'utf8');

code = code.replace(
  "profile: any;\n  biomarkerHistory: any[];\n",
  "profile: any;\n  biomarkerHistory: any[];\n  biomarkers?: { [key: string]: any };\n"
);

code = code.replace(
  "profile,\n  biomarkerHistory,\n",
  "profile,\n  biomarkerHistory,\n  biomarkers,\n"
);

code = code.replace(
  "(profile as any)?.currentBiomarkers || {}",
  "biomarkers || {}"
);

code = code.replace(
  "}, [profile?.customBiomarkers, biomarkerHistory]);",
  "}, [profile?.customBiomarkers, biomarkerHistory, biomarkers]);"
);

fs.writeFileSync(path, code);

path = 'src/App.tsx';
code = fs.readFileSync(path, 'utf8');
code = code.replace(
  "profile={profile}\n                biomarkerHistory={biomarkerHistory}",
  "profile={profile}\n                biomarkers={biomarkers}\n                biomarkerHistory={biomarkerHistory}"
);

fs.writeFileSync(path, code);
