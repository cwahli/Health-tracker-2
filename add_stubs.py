import re

with open('server.ts', 'r') as f:
    content = f.read()

stubs = """
app.post("/api/gemini/review-biomarker", async (req, res) => {
  res.json({ text: "Not implemented in V2" });
});

app.post("/api/gemini/insight-analyze", async (req, res) => {
  res.json({ text: "Not implemented in V2" });
});

app.post("/api/gemini/route-biomarker", async (req, res) => {
  res.json({ text: "Not implemented in V2" });
});

app.post("/api/gemini/route-chat", async (req, res) => {
  res.json({ text: "Not implemented in V2" });
});
"""

# add it before Standardize Units
content = content.replace('app.post("/api/gemini/standardize-units"', stubs + '\napp.post("/api/gemini/standardize-units"')

with open('server.ts', 'w') as f:
    f.write(content)
