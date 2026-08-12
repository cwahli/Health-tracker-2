import re

with open('plan/FOOD_RESOLVER_CURATOR_AND_1PASS_CATALOG_PLAN.md', 'r') as f:
    content = f.read()

content = content.replace("- [ ] P0", "- [x] P0")
content = content.replace("- [ ] P1", "- [x] P1")
content = content.replace("- [ ] P2", "- [x] P2")
content = content.replace("- [ ] P3", "- [x] P3")
content = content.replace("- [ ] P4", "- [x] P4")

with open('plan/FOOD_RESOLVER_CURATOR_AND_1PASS_CATALOG_PLAN.md', 'w') as f:
    f.write(content)
