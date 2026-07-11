const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

// Undo the regex replacements for non-logging
code = code.replace(
  "resolvedInstruction = `[System Simulation: Adopt the persona of model '${normalizedModelId}' for this request. Respond as accurately and characteristically as possible while strictly observing the requested JSON format constraints.]\\n (Length: ${systemInstruction.length})`;",
  "resolvedInstruction = `[System Simulation: Adopt the persona of model '${normalizedModelId}' for this request. Respond as accurately and characteristically as possible while strictly observing the requested JSON format constraints.]\\n\\n${systemInstruction}`;"
);

code = code.replace(
  "fullPromptSent = `System Instruction: (Length: ${systemInstruction.length})\\n\\n${promptText}`;",
  "fullPromptSent = `System Instruction:\\n${systemInstruction}\\n\\n${promptText}`;"
);

code = code.replace(
  "fullPromptSent = `System Instruction: (Length: ${systemInstruction.length})\\n\\n${promptText}`;",
  "fullPromptSent = `System Instruction:\\n${systemInstruction}\\n\\n${promptText}`;"
);

code = code.replace(
  "fullPromptSent = `System Instruction: (Length: ${systemInstruction.length})\\n\\n${promptText}`;",
  "fullPromptSent = `System Instruction:\\n${systemInstruction}\\n\\n${promptText}`;"
);

code = code.replace(
  'fullPromptSent = `System Instruction: (Length: ${systemInstruction.length})\\n\\n${historyText}User Message: "${message}"`;',
  'fullPromptSent = `System Instruction:\\n${systemInstruction}\\n\\n${historyText}User Message: "${message}"`;'
);

fs.writeFileSync('server.ts', code);
