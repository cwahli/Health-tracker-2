import re

with open('plan/FOOD_RESOLVER_CURATOR_AND_1PASS_CATALOG_PLAN.md', 'r') as f:
    content = f.read()

content = content.replace("- [ ] P5", "- [x] P5")

with open('plan/FOOD_RESOLVER_CURATOR_AND_1PASS_CATALOG_PLAN.md', 'w') as f:
    f.write(content)
