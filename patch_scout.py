with open('server_vision_scout.ts', 'r') as f:
    content = f.read()

old_block = "STEP 3: COMPONENT DECOMPOSITION & LABELS"
new_block = """STEP 3: COMPONENT DECOMPOSITION, CLINICAL QUERIES & LABELS
- CLINICAL ENGLISH & USDA QUERY INVERSION: For all components and generic items, format the 'keyword' and 'searchQuery' in strict, clinical USDA-style inversion syntax: "Noun, descriptor, preparation" (e.g., "Egg, whole, cooked, hard-boiled", "Lettuce, iceberg, raw", "Chicken, breast, grilled"). Use pure clinical English.
- PREPARATION FAT & OILS: For any deep-fried, pan-fried, or heavily glazed items, explicitly extract the cooking oil or butter as a separate component (e.g., "Oil, vegetable, canola", "Butter, salted"). Assign it a realistic mass percentage.
- MASS PERCENTAGE OVER VOLUME: When estimating component ratios, strongly prefer estimating 'massPercentage' (weight) over pure 'volumePercentage'.
- BRAND SEPARATION: Keep brand names in 'originalName' or 'chainName'. Do not mash brand names into the 'keyword' or 'searchQuery' for generic components unless it's a specific branded component (e.g., "Sainsbury oat")."""

if old_block in content:
    content = content.replace(old_block, new_block)
    print("Successfully patched scoutSystemInstruction")
else:
    print("Failed to find old block in scoutSystemInstruction")

with open('server_vision_scout.ts', 'w') as f:
    f.write(content)
