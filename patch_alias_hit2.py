import re

with open('server_food_catalog.ts', 'r') as f:
    content = f.read()

content = content.replace("          _logHit: addDebugLog ? addDebugLog(`[AliasHit] Found alias mapping for ${key} -> ${fi.food_id}`) : null,", "")

def replacer(match):
    return "if (addDebugLog) addDebugLog(`[AliasHit] Found alias mapping for ${key} -> ${fi.food_id}`);\n" + match.group(0)

content = re.sub(r'        return \{\n          food_id: fi.food_id,', replacer, content)

with open('server_food_catalog.ts', 'w') as f:
    f.write(content)
