import re
with open('server_food_resolver_curator.ts', 'r') as f:
    content = f.read()

old_error_log = "addDebugLog(`[CuratorAction] Failed to execute curator: ${error}`);"
new_error_log = "addDebugLog(`[CuratorAction] Failed to execute curator: ${error instanceof Error ? error.message : JSON.stringify(error)}`);"
content = content.replace(old_error_log, new_error_log)

with open('server_food_resolver_curator.ts', 'w') as f:
    f.write(content)
print("Curator error log fixed")
