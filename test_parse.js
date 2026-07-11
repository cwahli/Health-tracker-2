const str = \`{
  "a": 1
}
\`\`\`;
console.log(str.substring(str.indexOf('{'), str.lastIndexOf('}') + 1));
try {
  JSON.parse(str.substring(str.indexOf('{'), str.lastIndexOf('}') + 1));
  console.log("Success");
} catch (e) {
  console.error(e.message);
}
