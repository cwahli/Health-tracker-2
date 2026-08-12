import re

with open('AI_HANDOVER.md', 'r') as f:
    content = f.read()

content = re.sub(r'- M30 Epic \(Food Curator\): Phases 0, 1, 2, 3 completed.*', '- M30 Epic (Food Curator): Phases 0, 1, 2, 3, 4, 5 fully completed (M30 COMPLETE)', content)

with open('AI_HANDOVER.md', 'w') as f:
    f.write(content)
