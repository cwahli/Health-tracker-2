import re

with open('server.ts', 'r') as f:
    content = f.read()

old_constraints_1 = """=== SYSTEM CONSTRAINTS ===

First, think step-by-step in plain text.

Second, output exactly one JSON object.

The JSON must contain ONLY the fields requested below. Do NOT include a _internalReasoning field inside the JSON.

=== OUTPUT INSTRUCTIONS ===

First, write out your step-by-step reasoning in plain text. Explain your clinical thoughts and support your reasoning before generating the JSON.

Then, output your final mapped results in a raw, valid JSON block."""

new_constraints_1 = """=== SYSTEM CONSTRAINTS ===

First, think step-by-step in the `_internalReasoning` field of the JSON.

Second, output exactly one JSON object.

The JSON must contain ONLY the fields requested below.

=== OUTPUT INSTRUCTIONS ===

First, write out your step-by-step reasoning inside the `_internalReasoning` JSON field. Explain your clinical thoughts and support your reasoning.

Then, output your final mapped results in a raw, valid JSON block."""

content = content.replace(old_constraints_1, new_constraints_1)

old_constraints_2 = """First, think step-by-step in plain text.

Second, output exactly one JSON object.

The JSON must contain ONLY the mappedBiomarkers array. No _internalReasoning inside the JSON."""

new_constraints_2 = """First, think step-by-step in the `_internalReasoning` field of the JSON.

Second, output exactly one JSON object.

The JSON must contain ONLY the fields requested below."""

content = content.replace(old_constraints_2, new_constraints_2)

with open('server.ts', 'w') as f:
    f.write(content)
print("Constraints patched.")
