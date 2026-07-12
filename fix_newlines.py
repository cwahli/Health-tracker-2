import re

with open('server.ts', 'r') as f:
    content = f.read()

content = content.replace(
    'systemInstruction: systemInstruction + "\n\nJSON STRUCTURED OUTPUT:\nYou must strictly return a JSON object. Do not add markdown wrappers. Think step-by-step in the \'scratchpad\' field first.",',
    'systemInstruction: systemInstruction + "\\n\\nJSON STRUCTURED OUTPUT:\\nYou must strictly return a JSON object. Do not add markdown wrappers. Think step-by-step in the \'scratchpad\' field first.",'
)

with open('server.ts', 'w') as f:
    f.write(content)
