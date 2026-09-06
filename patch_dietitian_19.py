import re

with open('server_food_analyze_run.ts', 'r') as f:
    content = f.read()

# Let's target the lines dynamically
lines = content.split('\n')
for i, line in enumerate(lines):
    if "const responseText = await callUnifiedLLM(" in line and "engine ||" in lines[i+1]:
        # This is the old signature format starting at line i
        lines[i] = "      const responseText = await callUnifiedLLM({"
        lines[i+1] = "        modelId: engine || 'gemini-3.5-flash-lite',"
        lines[i+3] = "        imagePayloads: imagePayloads || [],"
        lines[i+4] = "        responseMimeType: 'application/json',"
        lines[i+5] = "        maxOutputTokens: 8192,"
        lines[i+6] = "        temperature: 0.2,"
        lines[i+7] = "        logStagePrefix: 'dietitian',"
        lines[i+8] = "        onStream: (chunk: string, isThought?: boolean) => {"
        
        # Now find the closing paren for this call
        for j in range(i+8, i+30):
            if ");" in lines[j] and "}" in lines[j-1]:
                lines[j] = "      });"
                break
        break

with open('server_food_analyze_run.ts', 'w') as f:
    f.write('\n'.join(lines))
print("Patched successfully!")
