import fs from 'fs';
let code = fs.readFileSync('server_vision_scout.ts', 'utf8');

code = code.replace(
  /estimatedCalories: z\.number\(\)\.finite\(\)\.nonnegative\(\)\.nullable\(\)\.optional\(\),/,
  'estimatedCalories: z.number().finite().nonnegative().nullable().optional(),\n  isStandaloneCondimentPacket: z.boolean().optional(),'
);

code = code.replace(
  /1\. The food item\. 2\. A dedicated label item/,
  '1. The food item. 2. A dedicated label item' // just anchoring
);

code = code.replace(
  /- NAMES: 'originalName' = exact local\/printed dish name. 'keyword' = concise canonical English name./,
  '- NAMES: \'originalName\' = exact local/printed dish name. \'keyword\' = concise canonical English name.\n- CONDIMENTS: Set \'isStandaloneCondimentPacket\' to true ONLY if the item is a tiny standalone condiment packet or small sauce cup (e.g. ketchup packet, small mayo dip). Set it to false for all main dishes, plates, bowls, salads, wraps, sandwiches, or mixed meals that happen to contain sauce.'
);

code = code.replace(
  /"sourceImageIndex": 0,/,
  '"sourceImageIndex": 0,\n      "isStandaloneCondimentPacket": false,'
);

fs.writeFileSync('server_vision_scout.ts', code);
console.log("Patched server_vision_scout.ts for LLM volumetric logic.");
