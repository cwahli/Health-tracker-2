const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const targetStr = `  comparisonTableMarkdown: |
    # Must be valid, strict Markdown. The frontend UI will parse and render this as a visual component.
    | Nutrient | Food A (Weight) | Food B (Weight) | Target / Warning |
    | :--- | :--- | :--- | :--- |
    | ... | ... | ... | ... |`;

const insertStr = `  comparisonTableYaml:
    columns: ["Nutrient", "Food A", "Food B", "Target / Warning"]
    rows:
      - nutrient: "Calories"
        foodA: "value"
        foodB: "value"
        target: "value"
      - nutrient: "Top Nutrient 1"
        foodA: "value"
        foodB: "value"
        target: "value"
      - nutrient: "Top Nutrient 2"
        foodA: "value"
        foodB: "value"
        target: "value"
      - nutrient: "Top Nutrient 3"
        foodA: "value"
        foodB: "value"
        target: "value"`;

if (code.includes(targetStr)) {
  code = code.replace(targetStr, insertStr);
  fs.writeFileSync('server.ts', code);
  console.log("Fixed server.ts comparisonTableYaml");
} else {
  console.log("Could not find target string in server.ts");
}
