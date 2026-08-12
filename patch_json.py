import re

with open('server_food_resolver_curator.ts', 'r') as f:
    content = f.read()

content = content.replace("jsonResult = FoodCuratorActionSchema.parse(parsed);", "jsonResult = FoodCuratorActionSchema.parse(JSON.parse(parsed));")

with open('server_food_resolver_curator.ts', 'w') as f:
    f.write(content)
