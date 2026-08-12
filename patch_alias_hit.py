import re

with open('server_food_catalog.ts', 'r') as f:
    content = f.read()

content = content.replace("source: fi.status === 'active' ? 'alias_active' : 'supabase_candidate',", 
                          "source: fi.status === 'active' ? 'alias_active' : 'supabase_candidate',\n          _logHit: addDebugLog ? addDebugLog(`[AliasHit] Found alias mapping for ${key} -> ${fi.food_id}`) : null,")

with open('server_food_catalog.ts', 'w') as f:
    f.write(content)
