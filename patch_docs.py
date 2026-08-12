import re

with open('docs/agent/domains/food-calc.md', 'r') as f:
    content = f.read()

# I will just append a note about Curator.
append_text = """
### Database Curator (Food Resolver)
The Food Resolver agent now operates as a **Catalog Curator**. 
- It uses a strict `FoodCuratorActionSchema` with actions like `pick_existing`, `merge_duplicates`, `normalize_basis`, and `quarantine`.
- It is triggered by `MULTI_MATCH` or `MISS` classifications from the FDC Resolve layer.
- `HIT_UNIQUE` queries bypass the LLM and are automatically aliased in the database.
- It never invents meal macros or acts as a meal math calculator; its sole purpose is to resolve item identities to standard `food_items` rows.
"""

if "Database Curator" not in content:
    with open('docs/agent/domains/food-calc.md', 'a') as f:
        f.write(append_text)
    print("Updated food-calc.md")
else:
    print("Already updated food-calc.md")
