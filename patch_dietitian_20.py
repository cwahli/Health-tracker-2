import re

with open('server_food_analyze_run.ts', 'r') as f:
    content = f.read()

# Fix the duplicate line and missing promptText
lines = content.split('\n')
for i, line in enumerate(lines):
    if "const responseText = await callUnifiedLLM({" in line:
        # Re-write the whole block cleanly
        lines[i+1] = "        modelId: engine || 'gemini-3.5-flash-lite',"
        lines[i+2] = "        systemInstruction,"
        lines[i+3] = "        promptText,"
        lines[i+4] = "        imagePayloads: imagePayloads || [],"
        lines[i+5] = "        responseMimeType: 'application/json',"
        lines[i+6] = "        maxOutputTokens: 8192,"
        lines[i+7] = "        temperature: 0.2,"
        lines[i+8] = "        logStagePrefix: 'dietitian',"
        lines[i+9] = "        onStream: (chunk: string, isThought?: boolean) => {"
        # Clear out any duplicate (chunk: string... lines until the if statement
        for j in range(i+10, i+15):
            if "(chunk: string, isThought?: boolean) => {" in lines[j]:
                lines[j] = ""
        break

with open('server_food_analyze_run.ts', 'w') as f:
    f.write('\n'.join(lines))
print("Patched successfully!")
