const fs = require('fs');
const content = fs.readFileSync('scripts/assert-budgets.mjs', 'utf8');

const anchor = `if (failed) {`;

const addition = `// Track F: F-7 Scout System Instruction budget check (L12 net-zero prompt ceiling: max 70 lines)
const scoutSrc = read('server_vision_scout.ts');
const sysInstMatch = scoutSrc.match(/export const scoutSystemInstruction = \`([\\s\\S]*?)\`;/);
ok(sysInstMatch !== null, 'F7:scout_instruction_exists', 'scoutSystemInstruction missing in server_vision_scout.ts');
if (sysInstMatch) {
  const promptLines = sysInstMatch[1].split('\\n').length;
  ok(promptLines <= 70, 'PROMPT_BUDGET:scout_prompt', \`scoutSystemInstruction has \${promptLines} lines; ceiling 70\`);
}

`;

fs.writeFileSync('scripts/assert-budgets.mjs', content.replace(anchor, addition + anchor));
