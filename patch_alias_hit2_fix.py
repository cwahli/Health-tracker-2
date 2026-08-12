import re

with open('server_food_catalog.ts', 'r') as f:
    content = f.read()

# I will pass an optional addDebugLog to getFoodItem? No, getFoodItem does not take it. I will just console.log it instead.
content = content.replace("if (addDebugLog) addDebugLog(`[AliasHit] Found alias mapping for ${key} -> ${fi.food_id}`);", 
                          "console.log(`[AliasHit] Found alias mapping for ${key} -> ${fi.food_id}`);")

with open('server_food_catalog.ts', 'w') as f:
    f.write(content)
