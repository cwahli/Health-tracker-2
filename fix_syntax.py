import re

with open('server.ts', 'r') as f:
    content = f.read()

content = content.replace("First, think step-by-step in the `_internalReasoning` field of the JSON.", "First, think step-by-step in the '_internalReasoning' field of the JSON.")
content = content.replace("First, write out your step-by-step reasoning inside the `_internalReasoning` JSON field.", "First, write out your step-by-step reasoning inside the '_internalReasoning' JSON field.")

with open('server.ts', 'w') as f:
    f.write(content)
print("Syntax fixed")
