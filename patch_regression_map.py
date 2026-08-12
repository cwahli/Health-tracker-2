import re

with open('docs/agent/DOMAIN_REGRESSION_MAP.md', 'r') as f:
    content = f.read()

food_calc_update = """
**M30 Curator Invariants:**
- QuerySet components-only for multi-component.
- Curator is not a meal calorie inventor (only curates catalog).
- Brand/OCR hard lock still wins.
- Mode A/D/Edit same finalize logic.
"""

content = content.replace("---\n\n## Biomarkers", food_calc_update + "\n---\n\n## Biomarkers")

with open('docs/agent/DOMAIN_REGRESSION_MAP.md', 'w') as f:
    f.write(content)
