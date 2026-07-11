const fs = require('fs');
let serverCode = fs.readFileSync('server.ts', 'utf8');
serverCode = serverCode.replace(`import * as admin from 'firebase-admin';
if (!admin.apps.length) {
  admin.initializeApp();
}`, `import { getApps, initializeApp } from 'firebase-admin/app';
if (getApps().length === 0) {
  initializeApp();
}`);
fs.writeFileSync('server.ts', serverCode);

let tsconfig = fs.readFileSync('tsconfig.json', 'utf8');
tsconfig = tsconfig.replace(`"allowJs": true,`, `"allowJs": false,`);
fs.writeFileSync('tsconfig.json', tsconfig);

let bmdModal = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');
bmdModal = bmdModal.replace(`def?.category?.toLowerCase() === tagLower;`, `(def as any)?.category?.toLowerCase() === tagLower;`);
bmdModal = bmdModal.replace(`def?.category?.toLowerCase().includes(q);`, `(def as any)?.category?.toLowerCase().includes(q);`);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', bmdModal);

let rbmModal = fs.readFileSync('src/components/ReviewBiomarkerModal.tsx', 'utf8');
rbmModal = rbmModal.replace(`category: def.category || 'other',`, `category: (def as any).category || 'other',`);
fs.writeFileSync('src/components/ReviewBiomarkerModal.tsx', rbmModal);

