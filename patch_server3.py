import re

with open('server.ts', 'r') as f:
    content = f.read()

content = content.replace("if (parsed._internalReasoning && !parsed._internalReasoning) { parsed._internalReasoning = parsed._internalReasoning; }", "")
content = content.replace("if (parsedData._internalReasoning && !parsedData._internalReasoning) { parsedData._internalReasoning = parsedData._internalReasoning; }", "")

with open('server.ts', 'w') as f:
    f.write(content)
print("Other assignments patched.")
