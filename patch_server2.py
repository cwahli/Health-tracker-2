import re

with open('server.ts', 'r') as f:
    content = f.read()

# Fix useless assignment
old_assignment = "if (rawParsed._internalReasoning && !rawParsed._internalReasoning) { rawParsed._internalReasoning = rawParsed._internalReasoning; }"
content = content.replace(old_assignment, "")

with open('server.ts', 'w') as f:
    f.write(content)
print("Assignment patched.")
