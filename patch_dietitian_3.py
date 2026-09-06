import re

with open('server_food_analyze_run.ts', 'r') as f:
    content = f.read()

content = content.replace("const timeCtx = buildTimeContext({ userTimezone: userProfile?.timezone, systemCurrentDate });", "const systemCurrentDate = new Date().toISOString().split('T')[0];\n      const timeCtx = buildTimeContext({ userTimezone: userProfile?.timezone, systemCurrentDate });")

search = """      const responseText = await callUnifiedLLM(
        engine || 'gemini-3.5-flash-lite',
        systemInstruction,
        promptText,
        imagePayloads || [],
        'application/json',
        8192,
        0.2,
        'dietitian',
        (chunk: string, isThought?: boolean) => {
          if (isStream && hasSentHeaders) {
             try {
               res.write(`data: ${JSON.stringify({ type: 'stream', chunk, stage: 'dietitian' })}\\n\\n`);
               if (typeof (res as any).flush === 'function') (res as any).flush();
             } catch(e) {}
          }
        }
      );"""

replace = """      const responseText = await callUnifiedLLM({
        modelId: engine || 'gemini-3.5-flash-lite',
        systemInstruction,
        promptText,
        imagePayloads: imagePayloads || [],
        responseMimeType: 'application/json',
        maxOutputTokens: 8192,
        temperature: 0.2,
        logStagePrefix: 'dietitian',
        onStream: (chunk: string, isThought?: boolean) => {
          if (isStream && hasSentHeaders) {
             try {
               res.write(`data: ${JSON.stringify({ type: 'stream', chunk, stage: 'dietitian' })}\\n\\n`);
               if (typeof (res as any).flush === 'function') (res as any).flush();
             } catch(e) {}
          }
        }
      });"""

content = content.replace(search, replace)
with open('server_food_analyze_run.ts', 'w') as f:
    f.write(content)
print("Patched successfully!")
