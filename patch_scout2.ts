import fs from 'fs';
let code = fs.readFileSync('server_vision_scout.ts', 'utf8');

code = code.replace(
  /if \(isStandaloneCondimentPacket\(newItem\)\) \{/,
  'if (newItem.isStandaloneCondimentPacket === true || (newItem.isStandaloneCondimentPacket !== false && isStandaloneCondimentPacket(newItem))) {'
);

fs.writeFileSync('server_vision_scout.ts', code);
console.log("Patched volumetric condition.");
