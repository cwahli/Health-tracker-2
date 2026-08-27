const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');

code = code.replace(
  `        } else if (agentType === "biomarker_review") {
          const baseData = customVariableData ? \`\\n\\n\${customVariableData}\\n\` : \`\\n\\nUSER PROFILE:\\n\${JSON.stringify(cleanProfile, null, 2)}\\n\`;
          const batchKeys = req.body.dataReviewBatchKeys || req.body.batchBiomarkers || [];
          const focusKeys: string[] = req.body.biomarkerKey
            ? [req.body.biomarkerKey]
            : (Array.isArray(batchKeys) ? batchKeys : []);`,
  `        } else if (agentType === "biomarker_review") {
          const baseData = customVariableData ? \`\\n\\n\${customVariableData}\\n\` : \`\\n\\nUSER PROFILE:\\n\${JSON.stringify(cleanProfile, null, 2)}\\n\`;
          const rawBatchKeys = req.body.dataReviewBatchKeys || req.body.batchBiomarkers || [];
          const batchKeys = (Array.isArray(rawBatchKeys) ? rawBatchKeys : []).filter(k => typeof k === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(k));
          const focusKeys: string[] = req.body.biomarkerKey
            ? [req.body.biomarkerKey]
            : batchKeys;`
);

code = code.replace(
  `                const trimmedBiomarkers: any = {};
                focusKeys.forEach(k => {
                  if (h.biomarkers[k] !== undefined) trimmedBiomarkers[k] = h.biomarkers[k];
                });
                return { date: h.date, biomarkers: trimmedBiomarkers };
              });
          }`,
  `                const trimmedBiomarkers: any = {};
                focusKeys.forEach(k => {
                  if (h.biomarkers[k] !== undefined) trimmedBiomarkers[k] = h.biomarkers[k];
                });
                let standardizedDate = h.date;
                if (typeof standardizedDate === 'string' && /^\\d{2}-\\d{2}-\\d{4}$/.test(standardizedDate)) {
                  const parts = standardizedDate.split('-');
                  standardizedDate = \`\${parts[2]}-\${parts[1]}-\${parts[0]}\`;
                }
                return { date: standardizedDate, biomarkers: trimmedBiomarkers };
              });
          }`
);

code = code.replace(
  `        let promptText = isExtractStep
          ? \`\${foodLogsPrompt}\${imageCtx}User message: "\${message}"\${dataContext}\`
          : \`Chat History:\\n\${historyText}\${foodLogsPrompt}\${imageCtx}\\nUser message: "\${message}"\${dataContext}\`;`,
  `        let promptText = isExtractStep
          ? \`\${foodLogsPrompt}\${imageCtx}User message: "\${message}"\${dataContext}\`
          : \`Chat History:\\n\${historyText}\${foodLogsPrompt}\${imageCtx}\${dataContext}\`;`
);

const oldClinical = `  clinical_and_nutritional:
    - "Provide professional, evidence-based educational context regarding the target biomarker."
    - "CRITICAL: Review precisely the ranges from medical research or clinical guidelines before providing an answer. You must differentiate between 'normal but suboptimal' values, and distinguish nuances like a 'pre-condition' versus an 'actual condition', reflecting this back to the data and proposed range."
    - "Tailor the explanations and suggestions specifically to the user's demographic profile (age, gender, ethnicity, weight/height/BMI)."
    - "Explain physiological significance, potential dietary/lifestyle influences, and clinical pathways of the biomarker."
    - "If the profile shows a different ethnicity than standard (e.g. Chinese or Asian), prioritize demographic-specific clinical insights, guidelines, and reference intervals (e.g., Chinese Society of Hepatology/Nephrology/Diabetes/Dyslipidemia standard thresholds) FIRST over Western standard baselines."
    - "For example, if the user is of Chinese ethnicity, you MUST look at clinical guidelines for Chinese populations FIRST before even considering Western guidelines."
    - "Whenever you mention 'individuals of East Asian descent', 'Chinese descent', or refer to any specific ethnic group, you MUST explicitly cite the specific medical guideline or society you are using (e.g. 'according to the Chinese Society of Hepatology' or 'based on [medical guidelines from XX]')."
  metric_and_unit:`;

const newClinical = `  clinical_and_nutritional:
    - "Provide professional, evidence-based educational context regarding the target biomarker."
    - "CRITICAL: Review precisely the ranges from medical research or clinical guidelines before providing an answer. You must explicitly name the medical organization or guideline (e.g., 'according to the AHA/ACC' or 'based on the Chinese Society of Cardiology') rather than using vague statements."
    - "You must differentiate between 'normal but suboptimal' values, and distinguish nuances like a 'pre-condition' versus an 'actual condition', reflecting this back to the data and proposed range."
    - "Tailor the explanations and suggestions specifically to the user's demographic profile (age, gender, ethnicity, weight/height/BMI)."
    - "Explain physiological significance, potential dietary/lifestyle influences, and clinical pathways of the biomarker."
    - "If the profile shows a different ethnicity than standard (e.g. Chinese or Asian), prioritize demographic-specific clinical insights, guidelines, and reference intervals FIRST over Western standard baselines."
    - "For example, if the user is of Chinese ethnicity, you MUST look at clinical guidelines for Chinese populations FIRST before even considering Western guidelines. You MUST explicitly cite the specific medical guideline or society you are using."
    - "CRITICAL: When generating 'rangeBrackets' inside a proposal, EVERY bracket object MUST include both 'min' and 'max' properties. For absolute bounds (like an unbounded upper limit), you MUST use null for the 'max' property explicitly, and null for 'min' for an unbounded lower limit."
  metric_and_unit:`;

code = code.replace(oldClinical, newClinical);

fs.writeFileSync('server.ts', code, 'utf8');
console.log('Fixed server.ts');
