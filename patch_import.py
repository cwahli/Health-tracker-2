with open('server.ts', 'r') as f:
    content = f.read()

import_statement = "import { buildFoodSearchQuerySet } from './server_query_set';\n"
if "import { buildFoodSearchQuerySet }" not in content:
    content = import_statement + content

with open('server.ts', 'w') as f:
    f.write(content)
