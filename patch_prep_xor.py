import re

with open('server_prep_policy.ts', 'r') as f:
    content = f.read()

content = content.replace("visualSheen?: number;", "visualSheen?: number;\n  hasFatBearingComponent?: boolean;\n  addDebugLog?: (msg: string) => void;")

prep_xor_logic = """
  if (input.hasFatBearingComponent && !isUserExplicit) {
    if (input.addDebugLog) input.addDebugLog('[PrepXOR] Suppressing prep addition because dish has fat-bearing components');
    return { ...zeroPrep, reason: 'prep_xor_fat_bearing' };
  }
"""

content = content.replace("if (composite && !isUserExplicit) {", prep_xor_logic + "  if (composite && !isUserExplicit) {")

with open('server_prep_policy.ts', 'w') as f:
    f.write(content)
