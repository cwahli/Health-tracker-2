import fs from "fs";
import { biomarkerDefinitions } from "../src/utils/biomarkers.js";

const panel = biomarkerDefinitions.slice(0, 50).map((d, i) => {
  let value = 10;
  let printedRange = d.normalRange;
  
  const m = d.normalRange.match(/([\d\.]+)\s*-\s*([\d\.]+)/);
  if (m) {
    value = (parseFloat(m[1]) + parseFloat(m[2])) / 2;
  } else {
    const ml = d.normalRange.match(/<\s*([\d\.]+)/);
    if (ml) {
      value = parseFloat(ml[1]) * 0.8;
    } else {
      const mg = d.normalRange.match(/>\s*([\d\.]+)/);
      if (mg) {
         value = parseFloat(mg[1]) * 1.2;
      } else if (d.key === "triglycerides") {
         value = 1.0;
      }
    }
  }
  
  // Hardcode a few if they are still 10 and 10 is crazy
  if (d.key === "hscrp") value = 1.0;
  if (d.key === "weight") value = 75;
  if (d.key === "ideal_body_weight") value = 70;
  if (d.key === "hemorrhoidal_symptom_score") value = 0;
  if (d.key === "gerd_symptom_score") value = 0;
  if (d.key === "joint_pain_severity_score") value = 0;
  
  return {
    id: `r${(i + 1).toString().padStart(2, "0")}`,
    printed: d.name,
    value: parseFloat(value.toFixed(2)),
    unit: d.unit,
    date: "2026-06-05",
    printedRange: printedRange
  };
});

const c5 = {
  id: "C5",
  date: "2026-06-05",
  batchSize: 20,
  history: {},
  message: "Here are my comprehensive panel results.",
  rows: panel
};

fs.writeFileSync("prototype/biomarkers/fixtures/cases/C5.json", JSON.stringify(c5, null, 2));

const expected = {
  id: "C5",
  date: "2026-06-05",
  expectRowCount: panel.length,
  expectKnown: panel.length,
  expectUnknown: 0,
  rows: panel.map(r => ({
    printed: r.printed,
    value: r.value,
    unit: r.unit,
    key: biomarkerDefinitions.find(d => d.name === r.printed)?.key,
    match: "key",
    writeTarget: "observation"
  }))
};

fs.writeFileSync("prototype/biomarkers/fixtures/cases/C5.expected.json", JSON.stringify(expected, null, 2));
