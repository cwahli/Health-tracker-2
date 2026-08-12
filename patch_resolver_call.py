import re

with open('server.ts', 'r') as f:
    content = f.read()

import_statement = "import { executeFoodResolverCurator } from './server_food_resolver_curator.js';\n"
if "import { executeFoodResolverCurator }" not in content:
    content = import_statement + content

old_block = """        const resolvedGaps = await executeFoodResolverAgent(
          gapsForResolver,
          addDebugLog,
          callLLMFn,
          (logType, msg) => {
            sendStreamEvent({ type: 'log', logType, stage: 'food_resolver', message: msg, timestamp: Date.now() });
          }
        );"""

new_block = """        const resolvedGaps = await executeFoodResolverCurator(
          gapsForResolver,
          addDebugLog,
          callLLMFn
        );"""

if old_block in content:
    content = content.replace(old_block, new_block, 1)
    print("Successfully replaced executeFoodResolverAgent with executeFoodResolverCurator")
else:
    print("Could not find executeFoodResolverAgent block in server.ts")

with open('server.ts', 'w') as f:
    f.write(content)
