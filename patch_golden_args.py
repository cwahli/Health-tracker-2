import re

with open('server_m30_golden.test.ts', 'r') as f:
    content = f.read()

content = content.replace("buildFoodSearchQuerySet(scoutItems, false, (msg) => {});", "buildFoodSearchQuerySet(scoutItems);")

with open('server_m30_golden.test.ts', 'w') as f:
    f.write(content)
