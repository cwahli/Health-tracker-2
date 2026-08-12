import re
with open('server.ts', 'r') as f:
    content = f.read()

content = content.replace("let dataTypes = 'Foundation,SR Legacy';", "let dataTypes = 'Foundation,SR Legacy,Survey (FNDDS)';")
content = content.replace("dataTypes = 'Foundation,SR Legacy,Branded';", "dataTypes = 'Foundation,SR Legacy,Survey (FNDDS),Branded';")
content = content.replace("dataTypes = 'Foundation,SR Legacy'; // Override and lock to generics", "dataTypes = 'Foundation,SR Legacy,Survey (FNDDS)'; // Override and lock to generics")
content = content.replace("dataTypes: string = 'Foundation,SR Legacy,Branded'", "dataTypes: string = 'Foundation,SR Legacy,Survey (FNDDS),Branded'")
content = content.replace("searchUSDA(query, 3, 'Foundation,SR Legacy')", "searchUSDA(query, 3, 'Foundation,SR Legacy,Survey (FNDDS)')")

with open('server.ts', 'w') as f:
    f.write(content)
