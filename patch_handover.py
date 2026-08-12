import re

with open('AI_HANDOVER.md', 'r') as f:
    content = f.read()

# I will just write a new state
if "M30" in content:
    content = re.sub(r'Phase 0.*?in progress', 'Phase 0, 1, 2, 3 (Curator, Ranking, Query Set, Basis Normalization) completed', content, flags=re.IGNORECASE)
else:
    content += "\n- M30 Epic (Food Curator): Phases 0, 1, 2, 3 completed. `HIT_UNIQUE` ranking, query sets, and LLM Curator implemented."

with open('AI_HANDOVER.md', 'w') as f:
    f.write(content)
