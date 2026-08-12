import re

with open('server_m30_golden.test.ts', 'r') as f:
    content = f.read()

content = content.replace("foodName:", "originalName:")

with open('server_m30_golden.test.ts', 'w') as f:
    f.write(content)
