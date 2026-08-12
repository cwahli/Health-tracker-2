import re

with open('server_prep_policy.test.ts', 'r') as f:
    content = f.read()

new_tests = """
  it('suppresses prep oil with [PrepXOR] if dish has fat-bearing components', () => {
    let logged = false;
    const res = decidePrepAddition({
      weightGrams: 200,
      cookingMethod: 'grilled',
      hasFatBearingComponent: true,
      addDebugLog: (msg) => {
        if (msg.includes('[PrepXOR]')) logged = true;
      }
    });
    expect(res.addedCalories).toBe(0);
    expect(res.reason).toBe('prep_xor_fat_bearing');
    expect(logged).toBe(true);
  });
});
"""

content = content.replace("});\n", new_tests)

with open('server_prep_policy.test.ts', 'w') as f:
    f.write(content)
