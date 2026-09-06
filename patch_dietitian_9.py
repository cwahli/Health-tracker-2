import re

with open('server_food_analyze_run.ts', 'r') as f:
    content = f.read()

target = r"""      const responseText = await callUnifiedLLM\(
        engine \|\| 'gemini-3\.5-flash-lite',
        systemInstruction,
        promptText,
        imagePayloads \|\| \[\],
        'application\/json',
        8192,
        0\.2,
        'dietitian',
        \(chunk: string, isThought\?: boolean\) => \{
          if \(isStream && hasSentHeaders\) \{
             try \{
               res\.write\(`data: \$\{JSON\.stringify\(\{ type: 'stream', chunk, stage: 'dietitian' \}\)\}`\);
               if \(typeof \(res as any\)\.flush === 'function'\) \(res as any\)\.flush\(\);
             \} catch\(e\) \{\}
          \}
        \}
      \);"""

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

if re.search(target, content, flags=re.MULTILINE):
    content = re.sub(target, replace, content, count=1, flags=re.MULTILINE)
    with open('server_food_analyze_run.ts', 'w') as f:
        f.write(content)
    print("Patched successfully!")
else:
    print("Target block not found!")
