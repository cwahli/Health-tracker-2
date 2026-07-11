import YAML from 'yaml';
try {
  YAML.parse("- {");
} catch (e) {
  console.log("Error1:", e.message);
}
try {
  YAML.parse("foo: [");
} catch (e) {
  console.log("Error2:", e.message);
}
