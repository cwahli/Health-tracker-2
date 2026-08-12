import re

with open('server.ts', 'r') as f:
    content = f.read()

# Remove executeFoodResolverAgent
pattern = re.compile(r'export async function executeFoodResolverAgent.*?^}', re.DOTALL | re.MULTILINE)
if pattern.search(content):
    content = pattern.sub('', content)
    print("Removed executeFoodResolverAgent")

# Remove imports
content = content.replace("foodResolverSystemInstruction, ", "")
content = content.replace("buildFoodResolverPrompt }", "}")

with open('server.ts', 'w') as f:
    f.write(content)
