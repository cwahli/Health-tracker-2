const jsdom = require("jsdom");
const { JSDOM } = jsdom;

JSDOM.fromURL("http://localhost:3000", {
  runScripts: "dangerously",
  resources: "usable",
  pretendToBeVisual: true
}).then(dom => {
  dom.window.addEventListener("error", (event) => {
    console.error("JSDOM Error:", event.error || event.message);
  });
  
  setTimeout(() => {
    console.log("JSDOM HTML:", dom.window.document.body.innerHTML.substring(0, 500));
    console.log("JSDOM Title:", dom.window.document.title);
    process.exit(0);
  }, 3000);
}).catch(err => {
  console.error("Failed to load:", err);
});
