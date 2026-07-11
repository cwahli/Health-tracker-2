const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

const clinicalBlock = `  clinical_and_nutritional:
    - "Provide professional, evidence-based educational context regarding the target biomarker."
    - "Tailor the explanations and suggestions specifically to the user's demographic profile (age, gender, ethnicity, weight/height/BMI)."
    - "If the profile shows a different ethnicity than standard (e.g. Chinese or Asian), prioritize demographic-specific clinical insights, guidelines, and reference intervals (e.g., Chinese Society of Hepatology/Nephrology/Diabetes/Dyslipidemia standard thresholds) over Western standard baselines."
    - "Whenever you mention 'individuals of East Asian descent', 'Chinese descent', or refer to any specific ethnic group, you MUST explicitly cite the specific medical guideline or society you are using (e.g. 'according to the Chinese Society of Hepatology' or 'based on [medical guidelines from XX]')."
    - "CRITICAL: Review precisely the ranges from medical research or clinical guidelines before providing an answer. You must differentiate between 'normal but suboptimal' values, and distinguish nuances like a 'pre-condition' versus an 'actual condition', reflecting this back to the data and proposed range."
    - "Explain physiological significance, potential dietary/lifestyle influences, and clinical pathways of the biomarker."`;

const clinicalRepl = `  clinical_and_nutritional:
    - "Provide professional, evidence-based educational context regarding the target biomarker."
    - "CRITICAL: Review precisely the ranges from medical research or clinical guidelines before providing an answer. You must differentiate between 'normal but suboptimal' values, and distinguish nuances like a 'pre-condition' versus an 'actual condition', reflecting this back to the data and proposed range."
    - "Tailor the explanations and suggestions specifically to the user's demographic profile (age, gender, ethnicity, weight/height/BMI)."
    - "Explain physiological significance, potential dietary/lifestyle influences, and clinical pathways of the biomarker."
    - "If the profile shows a different ethnicity than standard (e.g. Chinese or Asian), prioritize demographic-specific clinical insights, guidelines, and reference intervals (e.g., Chinese Society of Hepatology/Nephrology/Diabetes/Dyslipidemia standard thresholds) over Western standard baselines."
    - "Whenever you mention 'individuals of East Asian descent', 'Chinese descent', or refer to any specific ethnic group, you MUST explicitly cite the specific medical guideline or society you are using (e.g. 'according to the Chinese Society of Hepatology' or 'based on [medical guidelines from XX]')."`;

code = code.replace(clinicalBlock, clinicalRepl);
fs.writeFileSync('server.ts', code);
