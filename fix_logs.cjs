const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  'addDebugLog(`[Standardize Units Agent] Dispatched System Instruction:\\n${systemInstruction}`, explicitSessionId);',
  'addDebugLog(`[Standardize Units Agent] Dispatched System Instruction (Length: ${systemInstruction.length})`, explicitSessionId);'
);

code = code.replace(
  'addDebugLog(`[Medical Categorisation Agent] Dispatched System Instruction:\\n${systemInstruction}`, explicitSessionId);',
  'addDebugLog(`[Medical Categorisation Agent] Dispatched System Instruction (Length: ${systemInstruction.length})`, explicitSessionId);'
);

code = code.replace(
  'addDebugLog(`[Data Accuracy Agent - Payload Sent] Model ID: ${modelId}\\n- User Prompt Content: ${inputText || "(no text content)"}\\n- Images Uploaded: ${images?.length || 0}\\n- Full System Instruction:\\n${systemInstruction}`, explicitSessionId);',
  'addDebugLog(`[Data Accuracy Agent - Payload Sent] Model ID: ${modelId}\\n- User Prompt Content: ${inputText || "(no text content)"}\\n- Images Uploaded: ${images?.length || 0}\\n- System Instruction (Length: ${systemInstruction.length})`, explicitSessionId);'
);

// Any others?
// Just to be safe, I'll use regex to find and replace any full systemInstruction logging in addDebugLog
code = code.replace(/\\n\$\{systemInstruction\}/g, " (Length: ${systemInstruction.length})");

fs.writeFileSync('server.ts', code);
