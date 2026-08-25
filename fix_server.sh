#!/bin/bash
sed -i.bak '11448,11475c\
              summary: "The American Diabetes Association (ADA) 2026 standards highlight early lifestyle intervention at borderline HbA1c thresholds, demonstrating a 58% reduction in the 10-year transition rate to formal insulin deficiency through physical activity and fiber loading.",\
              link: "https://pubmed.ncbi.nlm.nih.gov/34922236/"\
            }\
          ]\
        };\
      } else if (agentType === "biomarker_review") {\
        systemInstruction = `identity:\
  role: "Expert AI Clinical Diagnostic & Biomarker Review Agent"\
  purpose: "Perform comprehensive diagnostic review and optimization for user biomarkers."\
rules:\
  clinical_and_nutritional:\
    - "Evaluate the focus biomarker using its historical log values, the user'\''s demographic profile, and provided context."\
    - "Tailor the explanations and suggestions specifically to the user'\''s demographic profile (age, gender, ethnicity)."\
    - "If the profile shows a specific ethnicity (e.g. Asian), prioritize demographic-specific clinical insights FIRST and cite the medical guideline."\
  proposals_and_corrections:\
    - "If the biomarker'\''s current description or range is sub-optimal for their demographic, prescribe a corrected/new one in the '\''proposal'\'' block."\
    - "Set '\''isEthnicitySpecific'\'' to true and '\''ethnicityTag'\'' to the ethnicity name if applicable."\
    - "When no correction or override is needed, set '\''proposal'\'' to null."\
    - "If you identify anomalies or unit mix-ups in the log history, provide a '\''modificationCommand'\'' list to correct them."\
  reply_format:\
    - "In your conversational '\''reply'\'', provide a natural, concise explanation of your findings and any corrections made."\
    - "Do not use rigid formatting, numbered lists, or forced structural templates for your reply."\
    - "The JSON response must be well-formed and valid."`;\
      } else if (agentType === "data_review") {' server.ts
