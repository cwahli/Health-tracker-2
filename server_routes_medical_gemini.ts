import { Router } from 'express';
import { Type } from '@google/genai';
import { z } from 'zod';
import { 
  biomarkerDefinitions, 
  getBiomarkerStatus, 
  getBiomarkerStatusLabel, 
  getBiomarkerMetadata, 
  getCustomBiomarkerDef,
  getMappedBiomarkerKey 
} from './src/utils/biomarkers';
import { 
  filterHistoryForUse, 
  enrichReviewModificationCommands, 
  sanitizeReviewReply,
  lexTable,
  buildIngestBatch,
  shouldAbortTablePath,
  leftoverTextFromTrace,
  stagedRowsToExtractedData,
  flaggedRowsToModificationCommands,
  mergeStagedExtract
} from './src/utils/biomarkerLifecycle';
import { generateDynamicInsight } from './src/utils/biomarkerInsights';
import { formatOptimalTargetValue } from './src/utils/agentCalibration';
import { extractBalancedJson } from './server_pure_helpers';
import { extractMostRecentImageDate } from './src/utils/dateUtils.js';
import { extractUnitFromString, normalizeUnitEquivalence } from './src/utils/biomarkerAuditEngine';
import { biomarkerReviewSystemInstruction } from './agents/biomarkerInstructions';
import {
  addDebugLog,
  streamDebugLogStorage,
  callUnifiedLLM,
  asyncParseLLMJSON,
  getGeminiClient,
  getGeminiApiKey,
  safeExtractJsonObject,
  sanitizeUnitText,
  sanitizeReviewedBiomarkerUnitConsistency,
  BiomarkerMatrix
} from './server.js';

export const medicalGeminiRouter = Router();

medicalGeminiRouter.post("/api/gemini/medical-analyze", async (req, res) => {
  if (!req.headers['x-session-id'] || !req.headers['x-session-id'].toString().startsWith('server-job-')) {
    return res.status(403).json({ error: 'This SSE path is deprecated and strictly reserved for internal loopback execution.' });
  }
  const isStream = req.query.stream === 'true';
  let hasSentHeaders = false;

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.flushHeaders();
    hasSentHeaders = true;

    const originalStatus = res.status.bind(res);

    res.status = (code: number) => {
      if (!res.headersSent) {
        originalStatus(code);
      }
      return res;
    };

    res.json = (body: any) => {
      res.write(`data: ${JSON.stringify({ final: true, result: body })}\n\n`);
      res.end();
      return res;
    };
  }

  const sendStreamEvent = (data: any) => {
    if (isStream && hasSentHeaders) {
      try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof (res as any).flush === 'function') (res as any).flush();
      } catch (e) {}
    }
  };

  await streamDebugLogStorage.run((msg: string) => {
    // Forward every verbose internal LLM dispatch/prompt/response log line live to
    // THIS request's own SSE connection only — same scoped mechanism as /api/gemini/food-analyze.
    sendStreamEvent({ type: 'log', logType: 'verbose', message: msg, timestamp: Date.now() });
  }, async () => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "default-session";
    const sendLog = (logType: string, messageText: string, extra?: any) => {
      sendStreamEvent({ type: 'log', logType, message: messageText, timestamp: Date.now(), ...extra });
    };

let { 
      message, 
      image, 
      images, 
      imageDates, 
      history, 
      userProfile, 
      engine, 
      existingBiomarkers, 
      agentType, 
      biomarkerHistory, 
      biomarkers, 
      recentMeals,
      foodLogs,
      customSystemInstruction,
      customVariableData,
      batchSize
    } = req.body;

    // Isolate Diagnostic Agent Data (agent4):
    // Ensure agent4 only receives diagnostic-relevant data (biomarkers and profile)
    // and is not sent other conversation or food log entries.
    const allBiomarkerKeys = Array.from(new Set([
      ...biomarkerDefinitions.map(d => d.key),
      ...Object.keys(userProfile?.customBiomarkers || {})
    ]));
    
    const agent1Step1Schema = {
      type: Type.OBJECT,
      properties: {
        extractedData: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              biomarker: {
                type: Type.STRING,
                description: "The canonical key of the biomarker. If matching EXISTING DATABASE KEYS, use that exact key. If it is a new or custom biomarker (e.g. Blood Pressure, Ferritin, Cortisol), generate a clean lowercase snake_case key for it (e.g., 'blood_pressure', 'ferritin')."
              },
              date: { type: Type.STRING, description: "Format: YYYY-MM-DD" },
              numeric_value: { type: Type.NUMBER, description: "The exact numerical value if quantitative. Leave null if qualitative.", nullable: true },
              qualitative_value: { type: Type.STRING, description: "The exact string if qualitative (e.g., '109 / 53', 'NEGATIVE'). Leave null if quantitative.", nullable: true },
              unit: { type: Type.STRING, description: "The exact unit verbatim from the text. Leave empty string if none." },
              explanation: { type: Type.STRING, description: "Why or how it was mapped or created." },
              display_name: { type: Type.STRING, nullable: true, description: "REQUIRED whenever 'biomarker' is a new/custom key not in EXISTING DATABASE KEYS. The official clinical term (e.g. 'Hematochezia', 'Hemorrhoids'), never a plain-English fragment. Set to null when 'biomarker' already matches an EXISTING DATABASE KEY." }
            },
            required: ["biomarker", "date", "unit", "explanation", "display_name"]
          }
        },
        unmappedTests: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              raw_name: { type: Type.STRING, description: "The official clinical term for this symptom/condition (e.g. 'Hematochezia', not 'Blood in Stool'). Must match the display_name used for the same item in extractedData." },
              suggested_key: { type: Type.STRING },
              date: { type: Type.STRING, nullable: true },
              numeric_value: { type: Type.NUMBER, nullable: true },
              qualitative_value: { type: Type.STRING, nullable: true },
              unit: { type: Type.STRING, nullable: true },
              explanation: { type: Type.STRING, nullable: true }
            },
            required: ["raw_name", "suggested_key"]
          }
        },
        text: { type: Type.STRING, description: "Friendly clinical conversational message to the user." },
        hasMoreMarkers: { type: Type.BOOLEAN },
        lastProcessedIndex: { type: Type.INTEGER, nullable: true, description: "The exact character index or row count where extraction stopped. Used for server-side continuation instead of echoing remaining text." },
        isWrongDoor: { type: Type.BOOLEAN, description: "True ONLY if the user input is entirely food logging, dietary journals, or completely unrelated to medical/biomarker data. Set to false for ANY medical data or symptoms." },
        estimatedTotalMarkers: { type: Type.INTEGER }
      },
      required: ["extractedData", "text", "hasMoreMarkers", "estimatedTotalMarkers"]
    };
    const dataReviewSchema = {
      type: Type.OBJECT,
      properties: {
        message: { type: Type.STRING, description: "Conversational summary of clinical range adjustments and review findings for this batch. If there are extreme divergences, highlight them here." },
        extremeDivergences: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              key: { type: Type.STRING, description: "Biomarker key identifier" },
              originalValue: { type: Type.NUMBER },
              unit: { type: Type.STRING },
              reason: { type: Type.STRING, description: "Explain why it seems anomalous or unit mismatched" },
              suggestedAction: { type: Type.STRING, description: "Suggestion (e.g. 'Update value' or 'Change metric unit')" }
            },
            required: ["key", "originalValue", "unit", "reason", "suggestedAction"]
          }
        },
        reviewedBiomarkers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              key: { type: Type.STRING, description: "Canonical identifier of the biomarker" },
              name: { type: Type.STRING, description: "Standard clinical name of the biomarker" },
              userValue: { type: Type.STRING, description: "Exact value from the input data. MUST preserve qualitative strings exactly (e.g. 'NEGATIVE', 'POSITIVE') as strings, or numerical values formatted as string." },
              unit: { type: Type.STRING, description: "Exact unit from the input data" },
              isDataArtifact: { type: Type.BOOLEAN, description: "Set to true if userValue is an extreme physiological outlier (>3x upper limit or <0.2x lower limit) suggesting a document parsing/ingestion error (e.g. relative % 11.8% parsed as absolute count 11.8 10^9/L). Otherwise set to false." },
              artifactNote: { type: Type.STRING, description: "Clinical note if isDataArtifact is true explaining the suspected parsing or lab artifact (e.g. 'Value 11.8 10^9/L appears to be a relative percentage (11.8%) or decimal offset error rather than an absolute count.'). Set to empty string '' if isDataArtifact is false." },
              _demographicAudit: {
                type: Type.OBJECT,
                properties: {
                  standardWesternBaseline: { type: Type.STRING, description: "The textbook global/Western range" },
                  knownEthnicOrRegionalVariances: { type: Type.STRING, description: "State the exact regional variant and the society it comes from. If absolutely none exist, state 'None'" },
                  ageAndGenderShifts: { type: Type.STRING, description: "How age and gender naturally alter the baseline" },
                  finalAppliedAdjustments: { type: Type.STRING, description: "The synthesis of how you are modifying the bounds for this specific user" }
                },
                required: ["standardWesternBaseline", "knownEthnicOrRegionalVariances", "ageAndGenderShifts", "finalAppliedAdjustments"]
              },
              profileAdjustedNormalRange: { type: Type.STRING, description: "The healthy reference range for which the biomarker is not at risk (e.g., '18.5 - 22.9 kg/m2')" },
              optimalValue: { type: Type.STRING, description: "CRITICAL: The SPECIFIC SINGLE OPTIMAL TARGET VALUE for this user profile to aim for (e.g. '21.0 kg/m2' for BMI, '30 mmol/mol' for HbA1c, '115 mmHg' for SBP, '1.2 mmol/L' for ApoB), NOT a range string and NOT a repeat of normalRange. Calculate the single ideal target value within the healthy spectrum that this specific demographic profile should aim for, rather than aiming just below the risk threshold." },
              rangeBrackets: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING, description: "Bracket name (e.g., Optimal, Elevated, Mildly Decreased)" },
                    range: { type: Type.STRING, description: "Mathematical bounds (e.g., >= 90, 60-89). Must be continuous with no gaps." }
                  },
                  required: ["name", "range"]
                }
              },
              description: { type: Type.STRING, description: "2-sentence physiological role" },
              _statusReasoning: { type: Type.STRING, description: "1-sentence mathematical evaluation comparing userValue to profileAdjustedNormalRange bounds" },
              status: { type: Type.STRING, enum: ["Optimal", "Sub-Optimal (Action Zone)", "At Risk"], description: "Strictly 'Optimal', 'Sub-Optimal (Action Zone)' or 'At Risk' based on _statusReasoning" },
              reference: { type: Type.STRING, description: "The exact clinical body or study acting as the anchor for the calibrated range (e.g., 'KDIGO 2024 Guidelines', 'ADA Standards of Care'). Must be explicit." },
              specificRiskContext: { type: Type.STRING, description: "3-4 sentence personalized clinical context based on the final status" },
              correctedHistoricalLogs: {
                type: Type.ARRAY,
                description: "Array of corrected historical entries if anomalous scaling/notation or outlier errors are found. Set to empty array if no corrections are needed.",
                items: {
                  type: Type.OBJECT,
                  properties: {
                    date: { type: Type.STRING, description: "The exact date of the historical log (e.g., YYYY-MM-DD)" },
                    originalValue: { type: Type.NUMBER, description: "The original incorrect value" },
                    correctedValue: { type: Type.NUMBER, description: "The newly calculated normalized/corrected value" },
                    note: { type: Type.STRING, description: "Clinical/scaling justification for this specific change" }
                  },
                  required: ["date", "originalValue", "correctedValue", "note"]
                }
              }
            },
            required: ["key", "name", "userValue", "unit", "isDataArtifact", "artifactNote", "_demographicAudit", "profileAdjustedNormalRange", "optimalValue", "reference", "rangeBrackets", "description", "_statusReasoning", "status", "specificRiskContext", "correctedHistoricalLogs"]
          }
        }
      },
      required: ["message", "reviewedBiomarkers"]
    };
    const healthPlanningSchema = {
      type: Type.OBJECT,
      properties: {
        text: { type: Type.STRING, description: "A brief, conversational greeting directly addressing the user." },
        _internalReasoning: { type: Type.STRING, description: "Step-by-step clinical deduction and date calculation logic." },
        summary: { type: Type.STRING, description: "Executive clinical summary synthesizing diagnostic findings and risk trends." },
        retestBiomarkers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              name: { type: Type.STRING, description: "Display name of the biomarker" },
              recommendedTestName: { type: Type.STRING, description: "The precise, standard clinical lab order name (e.g., 'Hepatic Function Panel')" },
              priority: { type: Type.STRING, enum: ["High", "Medium", "Low"], description: "Priority level" },
              retestTimeframe: { type: Type.STRING, description: "The interval (e.g., '3 months')" },
              lastTestedDate: { type: Type.STRING, description: "Exact date this was last tested (Format: DD-MM-YYYY)" },
              nextScheduledDate: { type: Type.STRING, description: "Exact calculated date for the next test (Format: DD-MM-YYYY)" },
              dueStatus: { type: Type.STRING, description: "A tag indicating whether it's 'Already Due' or 'Due in X months/weeks'" },
              gpClinicalJustification: { type: Type.STRING, description: "A persuasive email/letter addressed to a skeptical GP who thinks the user does not need the retest. Combines profile context, baseline trends, timing urgency, clinical guidelines, and risk evidence to convince the doctor why ordering this retest is necessary." },
              key: { type: Type.STRING, description: "biomarker_database_key" },
              currentValue: { type: Type.STRING, description: "value and unit" },
              unit: { type: Type.STRING, description: "unit" }
            },
            required: ["name", "recommendedTestName", "priority", "retestTimeframe", "lastTestedDate", "nextScheduledDate", "dueStatus", "gpClinicalJustification", "key"]
          }
        },
        testingGaps: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              testName: { type: Type.STRING, description: "Name of the missing scan or lab (e.g., 'Abdominal Ultrasound')" },
              category: { type: Type.STRING, enum: ["short_term", "long_term"], description: "short_term (< 2 years) or long_term (>= 2 years)" },
              priority: { type: Type.STRING, enum: ["High", "Medium", "Low"], description: "Priority level" },
              nextScheduledDate: { type: Type.STRING, description: "Exact date by which this should be completed (Format: DD-MM-YYYY)" },
              targetCondition: { type: Type.STRING, description: "The disease or condition being ruled out" },
              userBenefit: { type: Type.STRING, description: "Explanation of why uncovering this missing data will improve their life or treatment plan." },
              gpClinicalJustification: { type: Type.STRING, description: "A persuasive email/letter addressed to a skeptical GP who thinks the user does not need the test. Combines profile rationale, clinical evidence, guidelines, and patient risk factors to convince the doctor why ordering this test is necessary." }
            },
            required: ["testName", "category", "priority", "nextScheduledDate", "targetCondition", "userBenefit", "gpClinicalJustification"]
          }
        },
        mode: { type: Type.STRING, description: "discussion" },
        status: { type: Type.STRING, description: "active" }
      },
      required: ["text", "_internalReasoning", "summary", "retestBiomarkers", "testingGaps", "mode", "status"]
    };

    if (agentType === "agent4") {
      if (history && history.length > 0) {
        history = history.filter((h: any) => {
          if (!h.content) return false;
          const lower = h.content.toLowerCase();
          // Exclude food log messages, extracted biomarkers, and other unrelated agent content
          if (
            lower.includes("food log") || 
            lower.includes("[extracted food") || 
            lower.includes("active meal") || 
            lower.includes("[extracted biomarkers") ||
            lower.includes("meal log") ||
            lower.includes("banana") ||
            lower.includes("pineapple")
          ) {
            return false;
          }
          return true;
        });
      }
      addDebugLog(`[Medical Analyze Agent] Diagnostic Agent (agent4) data isolated: other conversations and food log entries removed.`, explicitSessionId);
    }

    // B2 2.1: Prompt hygiene — one raw injection. We do not inject chat history for extractor steps 
    // (agent1_step1, lab_extract, symptom_diary) to prevent double payload costs.
    const isExtractor = agentType === 'agent1_step1' || agentType === 'lab_extract' || agentType === 'symptom_diary' || agentType === 'agent1';
    
    if (isExtractor) {
      addDebugLog(`[Medical Analyze Agent] Extractor agent detected (${agentType}). Chat history omitted for token hygiene.`, explicitSessionId);
      history = []; // One raw injection only.
    }

    let ingestTrace = req.body.ingestTrace || null;
    if (isExtractor && message) {
      try {
        const rows = lexTable(String(message));
        const multiCol = rows.filter((r) => r.length > 1);
        if (multiCol.length > 1) {
          const trace = ingestTrace && ingestTrace.rows?.length ? ingestTrace : buildIngestBatch(rows);
          const abort = shouldAbortTablePath(trace);
          addDebugLog(`[Medical Analyze Agent] Layer-1 lexer rows=${trace.totalInputRows} high=${trace.highConfidenceCount} flagged=${trace.flaggedCount} unmatched=${trace.unmatchedCount} skip=${trace.skippedCount} abort=${abort}`, explicitSessionId);
          if (!abort) {
            ingestTrace = trace;
            const leftover = leftoverTextFromTrace(trace);
            if (!leftover) {
              const extracted = stagedRowsToExtractedData(trace);
              const cmds = flaggedRowsToModificationCommands(trace);
              addDebugLog(`[Medical Analyze Agent] Layer-1 complete (${extracted.length} staged). Skipping LLM.`, explicitSessionId);
              return res.json({
                text: `I matched ${trace.highConfidenceCount} lab row${trace.highConfidenceCount === 1 ? '' : 's'} automatically${trace.flaggedCount ? ` and flagged ${trace.flaggedCount} for unit review` : ''}. Review the table and Apply.`,
                agentType,
                extractedData: extracted,
                hasMoreMarkers: false,
                lastProcessedIndex: null,
                estimatedTotalMarkers: extracted.length,
                unmappedTests: [],
                ingestTrace: trace,
                modificationCommand: cmds.length ? cmds : undefined,
              });
            }
            message = leftover;
            addDebugLog(`[Medical Analyze Agent] Layer-1 leftover ${trace.unmatchedCount} rows sent to Parser.`, explicitSessionId);
          }
        } else {
          addDebugLog(`[Medical Analyze Agent] Layer-1 lexer did not see a multi-row table (lines=${rows.length}).`, explicitSessionId);
        }
      } catch (lexErr: any) {
        addDebugLog(`[Medical Analyze Agent] Layer-1 lexer failed open: ${lexErr?.message || lexErr}`, explicitSessionId);
      }
    }

    addDebugLog(`[Medical Analyze Agent] Request received for agentType: ${agentType || 'None'}. Message: "${String(message).substring(0, 100)}..."`, explicitSessionId);
    sendLog('status', `Analyzing your message${agentType ? ` (${agentType})` : ''}...`);
    if (history && history.length > 0) {
      addDebugLog(`[Medical Analyze Agent] Included conversational history context (${history.length} turns).`, explicitSessionId);
    }


    if (!agentType) agentType = "agent1_step1";

    if (true) {
      let systemInstruction = "";
      let mockData: any = {};
      let fullPromptSent = "";

      if (agentType === "agent4") {
        systemInstruction = `You are a Medical Diagnostics Assessment agent.
Your objective is to analyze the user's biomarker history, recent test data, profile, and current symptoms to project timeline risks and identify testing gaps or overall health trends.
You MUST output ONLY a valid JSON object matching the exact schema:
- "text": A brief, professional, conversational greeting and summary response directly addressing the user (e.g., "I have completed a comprehensive diagnostic and health planning audit based on your recent biomarker history. Here are the key findings, recommended retests, and testing gaps identified for your profile:").
- "summary": Executive clinical summary synthesizing diagnostic findings, risk trends, and health planning recommendations (1-2 clear paragraphs max for the diagnostic audit banner).
- "retestBiomarkers": Array of objects specifying biomarkers recommended for retesting (each item MUST include "name", "retestTimeframe", "recommendedTestName" [the specific clinical test/panel to order/take], "gpClinicalJustification" [a persuasive email/letter written directly for a skeptical GP who thinks the user doesn't need this retest], "dueStatus", and optional "key", "currentValue", "unit"). Do not include dateRationale or dateImportanceRating.
- "testingGaps": Array of objects identifying missing tests or health gaps (each item has "testName", "category" ['short_term' | 'long_term'], "priority", "nextScheduledDate", "targetCondition", "userBenefit", "gpClinicalJustification" [a persuasive email/letter written directly for a skeptical GP who thinks the user doesn't need this test]). Do not include profileRationale.
- "_internalReasoning": Detailed clinical reasoning step-by-step.
- "mode": "discussion"
- "status": "active"`;
        mockData = { text: "I have reviewed your medical records.", mode: "discussion", status: "active" };
      } else if (agentType === "agent1_step1" || agentType === "lab_extract" || agentType === "symptom_diary") {
        const itemsPerBatch = (typeof batchSize === 'number' && batchSize > 0) ? Math.min(Math.floor(batchSize), 200) : 50;
        
        systemInstruction = `{
  "agent_profile": {
    "role": "Expert Clinical Data Extractor and Lossless Data Conduit",
    "objective": "Parse raw medical reports/text/images, isolate distinct biomarker measurements, and structure them verbatim into standard clinical format.",
    "routing_context": "If agentType='symptom_diary', strictly process prose and patient-reported entries. If agentType='lab_extract', strictly process tabular clinical reports. Do NOT mix them up."
  },
  "critical_extraction_rules": {
    "zero_math_verbatim_extraction": "You are strictly forbidden from performing any calculations, normalizations, or unit conversions. Extract the exact numerical value and the exact unit provided in the text.",
    "verbatim_qualitative_data": "Qualitative results (e.g., 'Negative', 'Trace', 'High', 'Present', 'Positive') and user-reported clinical findings or symptoms (e.g., 'Hemorrhoids', 'Blood in stool', 'Rectal bleeding') must be extracted as qualitative entries exactly as written or reported.",
    "blood_pressure_handling": "When blood pressure is reported as a composite reading (e.g., '109 / 53 mmHg'), extract key 'blood_pressure' with qualitative_value '109 / 53' and unit 'mmHg', AND ALSO extract 'systolic_blood_pressure' (numeric_value: 109, unit: 'mmHg') and 'diastolic_blood_pressure' (numeric_value: 53, unit: 'mmHg') so neither reading is truncated.",
    "unit_bleed_and_ratio_sanitization": "Never carry over 'mmHg' or adjacent units to questionnaires or score rows (e.g., AUDIT-C has unit 'score' or '/12', never 'mmHg'). Dimensionless ratios or indices have unit '' (empty) or 'ratio', never 'n/a' or '-'.",
    "ideal_body_weight_separation": "Target, reference, or calculated goals like 'Ideal Body Weight' MUST be mapped to key 'ideal_body_weight' and NEVER to the patient's measured historical 'weight'.",
    "dictionary_mapping": "If a test or symptom matches a key from EXISTING DATABASE KEYS (e.g., 'hemorrhoidal_symptom_score', 'gerd_symptom_score'), use that exact key. For patient-reported symptoms/conditions (e.g. 'blood in poop', 'hemorrhoids', 'acid reflux', 'joint pain'), map them to a standardized clinical symptom score key (e.g., 'hemorrhoidal_symptom_score', 'gerd_symptom_score', 'joint_pain_severity_score') with unit 'score' and display_name as the official clinical index name (e.g., 'Hemorrhoidal Disease Symptom Score (HDSS)').",
    "unit_standardization": "Standardize 'µg/L' and 'ug/L' to always return as 'ug/L' (they are equivalent). Treat 'u/week' and 'units/week' as equivalent and output as 'u/week'."
  },
  "self_reported_symptom_diary_rules": {
    "purpose": "Self-reported symptoms and conditions are patient diary entries. Map them to standardized, universally recognized clinical symptom scores or disease severity indices so they can be evaluated consistently across all global demographics.",
    "clinical_symptom_score_mapping": "When a patient reports a symptom or condition (e.g. 'blood in poop', 'hemorrhoids', 'acid reflux', 'joint pain'), map it to an established clinical symptom score or index key. For example, for hemorrhoids/rectal bleeding/blood in stool, use key 'hemorrhoidal_symptom_score' and display_name 'Hemorrhoidal Disease Symptom Score (HDSS)'. For acid reflux, use key 'gerd_symptom_score' and display_name 'Gastroesophageal Reflux Symptom Score (GERD-SS)'. Always set unit to 'score'.",
    "score_severity_quantification": "Quantify symptom severity/frequency into numerical scores (unit: 'score'): 0 = Remission / Healthy baseline (asymptomatic); 1 = Mild flare-up (slight, occasional, mild); 2 = Moderate flare-up (some blood, noticeable symptoms over recent/few days, 'the last few days'); 3 = Severe progression (heavy bleeding, constant/intense symptoms). Include a concise clinical description in 'qualitative_value' (e.g. 'Moderate flare-up with blood in stool').",
    "single_biomarker_per_condition": "When a patient reports a condition and related symptom together (e.g., hemorrhoids and blood in stool), create ONE unified clinical symptom score entry (e.g. key: 'hemorrhoidal_symptom_score', display_name: 'Hemorrhoidal Disease Symptom Score (HDSS)'). Do NOT create separate duplicate entries.",
    "multi_day_expansion": "Span references ('the last few days' = min 3 days, 'since Monday', 'for the past week') → create ONE extractedData entry per day in that span. Use CURRENT DATE as anchor for 'today'.",
    "descriptive_display_naming": "Set 'display_name' to the official clinical index name (e.g. 'Hemorrhoidal Disease Symptom Score (HDSS)'). Use the same value for 'raw_name' in unmappedTests.",
    "explanation_field_requirement": "State this is a patient-reported symptom mapped to a standardized clinical index score and briefly note how date and score were derived."
  },
  "mode_routing": {
    "priority": "Always prioritize structured data extraction over conversational text when raw medical data/text/photos are present."
  },
  "chunked_processing": {
    "limit_per_chunk": ${itemsPerBatch},
    "behavior": [
      "Extract ONLY the first ${itemsPerBatch} biomarker entries in this chunk.",
      "If you reach the limit of ${itemsPerBatch} extracted biomarkers, set 'hasMoreMarkers' to true in your JSON response.",
      "Return the exact string index or document position where you stopped extracting in 'lastProcessedIndex'. The server will slice the input text automatically for the next batch using this offset, saving tokens.",
      "In the 'text' response, kindly inform the user you have completed this chunk and ask to continue.",
      "If total remaining biomarkers <= ${itemsPerBatch}, set 'hasMoreMarkers' to false and 'lastProcessedIndex' to null."
    ]
  },
  "required_output_format": {
    "response_schema": {
      "extractedData": "A JSON array of objects, containing the newly extracted biomarker entries. If the user message is 'continue', parse the next batch from the text starting at the offset.",
      "unmappedTests": [
        {
          "raw_name": "string (For structured lab/report data: the exact test name as it literally appears in the text, e.g. 'Blood Pressure'. For self-reported symptoms/conditions in free text: a clean, descriptive, Title Case biomarker/symptom name that matches the meaning of the report — e.g. 'Blood in Stool', NOT a single fragment word like 'blood'. This is shown to the patient as the biomarker's display name, so it must read as a real clinical term, never a truncated word.)",
          "suggested_key": "string (A clean, lowercase snake_case key suggestion for this test, e.g., 'blood_pressure')",
          "date": "string or null",
          "numeric_value": "number or null",
          "qualitative_value": "string or null",
          "unit": "string or null",
          "explanation": "string or null"
        }
      ],
      "text": "string (Friendly clinical conversational message)",
      "hasMoreMarkers": "boolean",
      "lastProcessedIndex": "number (The text offset where parsing paused)",
      "estimatedTotalMarkers": "number (Realistic, non-hallucinated estimate of total distinct biomarker readings present in original report text.)"
    }
  },
  "extracted_data_schema": [
    {
      "biomarker": "string (Match from EXISTING DATABASE KEYS, OR a clean lowercase snake_case key for a new/custom biomarker e.g. 'blood_pressure', 'pulse_rate'.)",
      "display_name": "string or null. REQUIRED whenever 'biomarker' is a NEW/custom key not in EXISTING DATABASE KEYS. Provide the official, clinically-correct name for this biomarker/symptom/condition — use your own medical knowledge to pick the term a clinician would actually write in a chart (e.g. 'Hematochezia' for visible blood in stool, 'Melena' if described as dark/tarry, 'Hemorrhoids'). If no distinct clinical term applies, fall back to a clean, Title Case descriptive name. This becomes the PERMANENT display name saved to the patient's biomarker dictionary, so pick deliberately and reuse the exact SAME display_name every time this same biomarker key recurs in this conversation. Set to null for biomarkers already in EXISTING DATABASE KEYS (they already have an official name).",
      "date": "YYYY-MM-DD",
      "numeric_value": "number or null",
      "qualitative_value": "string or null",
      "unit": "string (verbatim from text)",
      "explanation": "string (why/how it was mapped or created)"
    }
  ],
  "rules_for_inputs": {
    "raw_data_extraction": "Extract only from raw text/report. Do NOT extract from pre-existing logs.",
    "unmapped_data_handling": "You MUST extract ALL distinct biomarker measurements and patient-reported symptoms/conditions present in raw data into 'extractedData'. Generate clean lowercase snake_case keys for new tests/symptoms (e.g. 'blood_pressure', 'hemorrhoids'). For self-reported symptoms and conditions, follow self_reported_symptom_diary_rules — ALL entries must have dated logs with multi_day_expansion applied.",
    "continue_extracting": "If the user message is 'continue', parse the NEXT batch of up to ${itemsPerBatch} biomarkers starting EXACTLY from the provided offset. You MUST NOT repeat, duplicate, or include ANY entries that are already present in the 'PREVIOUSLY EXTRACTED JSON'.",
    "update_data": "Support editing, adding, or deleting biomarkers in the array."
  }
}

=== EXISTING DATABASE KEYS ===
${Array.from(new Set([...biomarkerDefinitions.map(d => d.key), ...Object.keys(userProfile?.customBiomarkers || {})])).join(', ')}`;
        mockData = {};
      } else if (agentType === "agent1") {
        systemInstruction = `You are an expert Clinical Data Parser and Medical Ontology Agent.
Your primary objective is to parse raw health reports, standardize clinical terminology, and structure biomarker readings into structured JSON. You must preserve mathematical data, qualitative results, lab ranges, and clinical notes exactly as provided.

=== CORE TASKS ===
1. Extraction & Standardization: Parse the incoming raw data. Convert every raw biomarker name into its most widely accepted standard clinical terminology (e.g., "Serum alt level" maps to "Alanine Aminotransferase (ALT)").
2. Lossless Math & Units (CRITICAL): You are strictly forbidden from performing calculations, unit conversions, or inferring missing units. Extract the exact numerical value and the exact unit provided in the text.
3. Qualitative Data (CRITICAL): If a result is qualitative (e.g., "Negative", "Trace", "High"), extract it exactly as written.
4. Dictionary Mapping (MANDATORY): Map to existing keys from EXISTING DATABASE KEYS when applicable. If a biomarker is a new or custom test not in EXISTING DATABASE KEYS, generate a clean lowercase snake_case key for it (e.g., 'blood_pressure') and extract its value, unit, date, and explanation into 'extractedData'.
5. Clinical Mapping: For each biomarker, map it to:
   - riskCategories: Physiological risk categories (e.g., 'Cardiovascular', 'Kidney & hydration', 'Metabolic & glycemic', 'Liver & hepatitis stress', 'Hematology', 'Biometrics', 'Other').
   - standardMedicalGrouping: Main clinical division ('Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', 'Other').
   - potentialMedicalConditions: Broad diagnostic associations.
6. Explanation of Changes (CRITICAL): For each biomarker, if you standardized, changed, merged, or corrected its name, value, or unit, you MUST provide a detailed explanation of why you made this change in the 'explanation' field.

=== EXISTING DATABASE KEYS ===
[${Array.from(new Set([...biomarkerDefinitions.map(d => d.key), ...Object.keys(userProfile?.customBiomarkers || {})])).join(', ')}]

=== FORMAT & SYSTEM RESTRICTIONS ===
Your output MUST be valid JSON using the schema provided. Return the array of biomarkers under the "extractedData" key.`;
        mockData = {};
      } else if (agentType === "agent2" || agentType === "agent1_step2") {
        systemInstruction = `You are an expert Clinical Ontologist and conversational health assistant (Step 2: Category Mapping).
Your tasks:
1. Identify all unique biomarkers in the JSON list and categorize them by associating:
   - "riskCategories": An array of matching risk categories. Choose from: 'Cardiovascular', 'Kidney & hydration', 'Metabolic & glycemic', 'Liver & hepatitis stress', 'Hematology'. If none match, you can use other appropriate categories.
   - "standardMedicalGrouping": Choose exactly ONE of these standard physiological groupings: 'Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', or 'Other'.
   - "potentialMedicalConditions": An array of related medical conditions or risks (e.g. ['Diabetes Risk', 'Insulin Resistance', 'Obesity', 'Anemia', 'Hepatitis Stress', 'Fatty Liver', 'Chronic Kidney Disease']).
CRITICAL CATEGORY ASSIGNMENT RULE: For EVERY single biomarker in "bucketMapping", you MUST assign at least ONE category in "riskCategories" (never leave it empty), exactly ONE standard grouping in "standardMedicalGrouping" (never leave it empty), and at least ONE related condition in "potentialMedicalConditions" (never leave it empty).
CRITICAL REQUIREMENT: You MUST map EVERY SINGLE UNIQUE BIOMARKER found in the provided JSON data. Do NOT skip or omit any biomarkers. If there are 65 biomarkers in the JSON, your dictionary MUST contain exactly 65 keys.
2. Handle conversational questions, updates, requests to go back, or requests to continue/submit from the user.

You MUST respond with a JSON object containing the following keys:
- "text": A friendly, clinical-grade conversational response to the user. You MUST include a breakdown of what remains the same and what change from the complete list you are suggesting. You must also include a count of the total biomarkers mapped.
- "bucketMapping": A key-value dictionary where the key is the biomarker name and the value is the assigned categorization object containing "riskCategories", "standardMedicalGrouping", and "potentialMedicalConditions".

Example "bucketMapping" structure:
{
  "HbA1c": {
    "riskCategories": ["Metabolic & glycemic"],
    "standardMedicalGrouping": "Metabolic",
    "potentialMedicalConditions": ["Diabetes Risk", "Insulin Resistance"]
  },
  "Serum ALT": {
    "riskCategories": ["Liver & hepatitis stress"],
    "standardMedicalGrouping": "Hepatic",
    "potentialMedicalConditions": ["Fatty Liver", "Hepatitis Stress"]
  }
}

Rules for handling user inputs:
- INITIAL mapping: Categorize each biomarker into the detailed fields above and return the dictionary in "bucketMapping", and set "text" to include the breakdown of what remains the same, what changes you are suggesting, and the total count.
- UPDATE DATA: If the user requests to change a category mapping (e.g., "Move glucose to Metabolic"), perform the update on the "bucketMapping" dictionary and return the updated dictionary, explaining the change and updating the counts/breakdown in "text".
- START A CONVERSATION: If the user asks a clinical or general question (e.g., "Why is ALT under Hepatic?"), answer the question clearly in "text" and return the unmodified dictionary in "bucketMapping".
- GO BACK / CONTINUE / SUBMIT: If the user asks to go back to Step 1 or proceed/continue/submit, explain in "text" how to proceed (they can click "Assemble Data" to continue, or click "Go Back" if needed).

Make sure your entire output is valid JSON, containing "text" and "bucketMapping".`;
        mockData = {};
      } else if (agentType === "agent3" || agentType === "agent1_step3") {
        systemInstruction = `You are a clinical data coordinator and conversational health assistant (Step 3: Data Assembly).
Your tasks:
1. Assemble the flat JSON biomarker logs and the bucket mapping dictionary into a structured physiological nested JSON.
CRITICAL REQUIREMENT: You MUST include EVERY SINGLE BIOMARKER ENTRY from the JSON. Do NOT skip or omit any biomarkers or history entries.
2. EXTREME DIVERGENCE FLAG: If you notice an extreme divergence in a biomarker value (e.g., highly unlikely, physiologically impossible, or a very clear metric unit mismatch like US vs SI), you MUST flag it by adding an array "flaggedAnomalies" to your JSON output. Mention this in your "text" response so the user can verify, confirm, or edit it (which may involve updating the metric unit).
3. Handle conversational questions, updates, requests to go back, or requests to continue/submit from the user.

You MUST respond with a JSON object containing the following keys:
- "text": A friendly, clinical-grade conversational response to the user. If this is the initial assembly and anomalies are found, alert the user here. If no anomalies, write: "Data successfully processed and categorized." (or similar).
- "entriesCount": Total unique biomarker entries processed.
- "buckets": An array of buckets matching the schema below.
- "flaggedAnomalies": (Optional) Array of any extreme value divergences detected.

Nested JSON schema for "flaggedAnomalies":
[
  {
    "key": "biomarker_key",
    "name": "Biomarker Name",
    "originalValue": number,
    "unit": "string",
    "reason": "Explanation of why this value seems anomalous or if it might be a unit mismatch (US vs SI).",
    "suggestedAction": "Suggestion for the user (e.g., 'Confirm this value is correct', 'Update value or metric unit')"
  }
]

Nested JSON schema for "buckets":
[
  {
    "systemName": "Bucket Name", // must be one of: 'Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', 'Other'
    "biomarkers": [
      {
        "name": "Biomarker Name",
        "riskCategories": ["Cardiovascular", "Metabolic & glycemic"], // arrays from the Step 2 bucket mapping
        "standardMedicalGrouping": "Metabolic", // string from the Step 2 bucket mapping
        "potentialMedicalConditions": ["Diabetes Risk", "Insulin Resistance"], // array of potential medical conditions from Step 2
        "history": [
          { "date": "YYYY-MM-DD", "value": number, "unit": "string" }
        ]
      }
    ]
  }
]

Rules for handling user inputs:
- INITIAL assembly: Map EVERY single biomarker and entry from the YAML using the Bucket Mapping. Do not drop any. Organize them into the "buckets" array. Return the JSON structure, and set "text" to "Data successfully processed and categorized. Please review the final structured entries below."
- UPDATE DATA: If the user asks to edit/add/delete a biomarker, date, or reading (e.g., "Remove red blood cell count reading on 2026-06-01"), perform that update on the nested "buckets" structure, update "entriesCount", and return the updated structure, explaining the change in "text".
- START A CONVERSATION: If the user asks a clinical or general question (e.g., "Why is ALT high?" or questions about "total white cell count"), answer the question clearly in "text", and return the unmodified "buckets" and "entriesCount".
- GO BACK / CONTINUE / SUBMIT: If the user asks to go back to Step 2, or finish and save/submit, explain in "text" how they can save their data or click the buttons to navigate.

Make sure your entire output is valid JSON, containing "text", "entriesCount", and "buckets".`;
        mockData = {};
      } else if (agentType === "agent4") {
        const last15MealTitles = (recentMeals || [])
          .slice(-15)
          .map((m: any) => m.name || m.title || m.foodName || m.description || '')
          .filter(Boolean);

        const atRiskBiomarkers: any[] = [];
        const normalBiomarkers: any[] = [];

        const customs = userProfile?.customBiomarkers || {};
        const combinedKeys = Array.from(new Set([
          ...Object.keys(customs),
          ...Object.keys(biomarkers || {})
        ]));

        combinedKeys.forEach(k => {
          const cDef = customs[k] || {};
          const val = biomarkers[k] !== undefined ? biomarkers[k] : cDef.userValue;
          const name = cDef.name || k;
          const unit = cDef.unit || '';
          const normRange = cDef.profileAdjustedNormalRange || cDef.normalRange || '';
          const status = cDef.status || 'Healthy';
          const insight = cDef.specificRiskContext || cDef.description || '';

          if (status === 'At Risk' || status === 'high' || status === 'critical' || (cDef.riskCategories && cDef.riskCategories.length > 0)) {
            atRiskBiomarkers.push({
              key: k,
              name,
              value: val,
              unit,
              normalRange: normRange,
              status,
              medicalInsights: insight
            });
          } else {
            normalBiomarkers.push({
              key: k,
              name,
              value: val,
              unit,
              normalRange: normRange,
              status
            });
          }
        });

        let acceptedBaselineProposal: any = "No prior baseline proposal stored.";
        if (userProfile?.agentAnalyses && Array.isArray(userProfile.agentAnalyses)) {
          const baseAnalysis = userProfile.agentAnalyses.find((a: any) => a.agentType === 'health_baseline' || a.agentType === 'agent2');
          if (baseAnalysis) {
            acceptedBaselineProposal = baseAnalysis.result;
          }
        }
        if (acceptedBaselineProposal === "No prior baseline proposal stored." && userProfile?.agentBaselineSummary) {
          acceptedBaselineProposal = userProfile.agentBaselineSummary;
        }

        const existingActions = req.body.actions || req.body.existingClinicalActions || userProfile?.actions || [];

        systemInstruction = `You are an elite Medical Diagnostics Assessment agent.
Your objective is to analyze the user's biomarker history to project timeline risks and identify testing gaps. 

=== INPUT DATA PROVIDED TO YOU ===
1. User Profile Data:
${JSON.stringify({
  age: userProfile?.age,
  gender: userProfile?.gender,
  ethnicity: userProfile?.ethnicity,
  medicalConditions: userProfile?.medicalConditions,
  healthGoals: userProfile?.healthGoals
}, null, 2)}

2. Accepted Agent Finding Proposal from Health Baseline & Trajectory Agent:
${JSON.stringify(acceptedBaselineProposal, null, 2)}

3. Latest Biomarker Values AT RISK (with range and medical insights):
${JSON.stringify(atRiskBiomarkers, null, 2)}

4. Latest Biomarker Values NOT AT RISK:
${JSON.stringify(normalBiomarkers, null, 2)}

5. Last 15 Meals Logged (Titles):
${JSON.stringify(last15MealTitles, null, 2)}

6. Existing Clinical Action Recommendations List:
${JSON.stringify(existingActions, null, 2)}

=== CRITICAL INSTRUCTIONS ===
1. Exact Date Tracking: For every item in \`retestBiomarkers\`, locate the most recent log entry in the \`biomarkerHistory\` array where that specific biomarker was recorded. Extract that exact date for the \`lastTestedDate\` field.
2. Future Date Calculation: Calculate the \`nextScheduledDate\` by adding your recommended timeframe to the \`lastTestedDate\`. Output all dates strictly in DD-MM-YYYY format.
3. GP Clinical Justification (Email to Skeptical GP): \`gpClinicalJustification\` MUST be written as a persuasive, evidence-based letter/email addressed to the patient's GP who believes the user does NOT need this test/retest. Gather strong clinical evidence, baseline trajectory shifts, profile context, guidelines, and risk factors to convince the doctor why ordering this test is medically necessary.
4. You MUST output ONLY a valid JSON object matching this EXACT schema. Do not drop any keys.

{
  "text": "A brief, conversational greeting directly addressing the user.",
  "_internalReasoning": "Step-by-step clinical deduction and date calculation logic.",
  "summary": "Executive clinical summary synthesizing diagnostic findings and risk trends.",
  "retestBiomarkers": [
    {
      "name": "Display name of the biomarker",
      "recommendedTestName": "The precise, standard clinical lab order name (e.g., 'Hepatic Function Panel')",
      "priority": "High | Medium | Low",
      "retestTimeframe": "The interval (e.g., '3 months')",
      "lastTestedDate": "Exact date this was last tested (Format: DD-MM-YYYY)",
      "nextScheduledDate": "Exact calculated date for the next test (Format: DD-MM-YYYY)",
      "userBenefit": "Explain why retesting this provides value, energy, or peace of mind to the user.",
      "gpClinicalJustification": "Dear Doctor,\n\nI am writing to request a retest for [Test Name] due to [Clinical Evidence / Baseline Shift]. [Explanation of profile risks, guidelines, and why retesting now is medically necessary]. Thank you for considering this request.",
      "key": "biomarker_database_key",
      "currentValue": "value and unit",
      "unit": "unit"
    }
  ],
  "testingGaps": [
    {
      "testName": "Name of the missing scan or lab (e.g., 'Abdominal Ultrasound')",
      "category": "short_term | long_term",
      "priority": "High | Medium | Low",
      "nextScheduledDate": "Exact date by which this should be completed (Format: DD-MM-YYYY)",
      "targetCondition": "The disease or condition being ruled out",
      "userBenefit": "Explanation of why uncovering this missing data will improve their life or treatment plan.",
      "gpClinicalJustification": "Dear Doctor,\n\nI am writing to request an initial [Test Name] order. Given [Profile Context & Symptoms/Risk Factors], guidelines recommend evaluating [Condition]. [Clinical justification and evidence to convince GP]. Thank you for your review."
    }
  ],
  "mode": "discussion",
  "status": "active"
}`;

        mockData = {
          text: "Hello! Let's review your health planning based on your latest results.",
          _internalReasoning: "Evaluated elevated glucose; insulin test needed for full metabolic risk assessment.",
          summary: "Reviewed diagnostic profile and biomarker history. Identified retest priorities and diagnostic testing gaps.",
          mode: "discussion",
          status: "active",
          retestBiomarkers: [
            {
              key: "glucose",
              name: "Fasting Glucose",
              recommendedTestName: "Fasting Blood Glucose",
              currentValue: "5.8",
              unit: "mmol/L",
              retestTimeframe: "In 2-4 weeks",
              lastTestedDate: "01-01-2024",
              nextScheduledDate: "15-01-2024",
              dueStatus: "Due soon",
              isProvisional: true,
              priority: "High",
              userBenefit: "Getting this checked again ensures your blood sugar levels are on track, giving you peace of mind and better energy.",
              gpClinicalJustification: "Dear Doctor,\n\nI am writing to request a follow-up Fasting Blood Glucose test. My recent reading showed an elevated value of 5.8 mmol/L, approaching the prediabetic threshold. A repeat test in 2-4 weeks is clinically indicated to establish a confirmed baseline, differentiate acute glycemic fluctuation from early dysglycemia, and guide early preventive care.\n\nThank you for considering this request."
            }
          ],
          testingGaps: [
            {
              testName: "Fasting Insulin",
              category: "short_term",
              nextScheduledDate: "20-01-2024",
              priority: "High",
              userBenefit: "This helps catch any hidden insulin issues early, helping us craft a better nutrition plan for you.",
              gpClinicalJustification: "Dear Doctor,\n\nI am writing to request a Fasting Insulin test. In light of my elevated fasting glucose (5.8 mmol/L) and personal risk profile, evaluating fasting insulin is essential to detect subclinical insulin resistance before HbA1c or glucose levels worsen further.\n\nThank you for your clinical review.",
              targetCondition: "Metabolic Risk"
            },
            {
              testName: "ApoB",
              category: "long_term",
              nextScheduledDate: "01-01-2026",
              priority: "Low",
              userBenefit: "Checking ApoB gives us a deep dive into your heart health over the coming years.",
              gpClinicalJustification: "Dear Doctor,\n\nI am writing to request an Apolipoprotein B (ApoB) assessment. Modern lipidology guidelines recommend ApoB for superior atherogenic particle quantification compared to LDL-C alone, particularly for long-term cardiovascular risk stratification.\n\nThank you for your consideration.",
              targetCondition: "Cardiovascular Health"
            }
          ]
        };
      } else if (agentType === "agent5") {
        systemInstruction = `You are a Clinical Education AI (Biomarker Contextualizer). Your job is to generate highly personalized educational content, adjusted normal reference ranges, and specific risk explanations based on the user's demographics and previous diagnostic assessment.

USER PROFILE:
- Age: ${userProfile?.age || 'Not provided'}
- Gender: ${userProfile?.gender || 'Not provided'}
- Ethnicity: ${userProfile?.ethnicity || 'Not provided'}

BIOMARKERS:
${JSON.stringify(biomarkers || {})}

DIAGNOSTIC SUMMARY:
${req.body.agentDiagnosticSummary || 'Optimized or no major pathologies flagged.'}

=== CRITICAL BREVITY DIRECTIVE (PREVENT TIMEOUTS) ===
Your responses MUST be extremely concise to avoid server timeouts:
- Keep the 'message' to 1-2 short sentences maximum.
- Keep 'description' of each biomarker to exactly 1 short sentence (15 words maximum).
- Keep 'specificRiskContext' to exactly 1 short sentence (15-20 words maximum).

=== DIRECTIVES ===
1. ZERO DATA LOSS INVENTORY RULE:
   You must count the total number of unique biomarkers in the incoming BIOMARKERS dictionary.
   Your final JSON output MUST contain exactly that same number of unique biomarkers under "contextualizedBiomarkers". You are strictly forbidden from omitting, summarizing, or dropping any biomarker key.
2. DEMOGRAPHICALLY ADJUSTED NORMAL RANGES: For every provided clinical metric, provide a profile-adjusted normal range. Explain why this reference range was adjusted for their age, gender, or ethnicity (e.g. muscle mass and creatinine, age-related eGFR, ethnic-specific lipid targets).
3. EDUCATIONAL DESCRIPTIONS: Write a clear 1-sentence description of what each biomarker is and its physiological role.
4. SPECIFIC RISK CONTEXT: For any marker identified as at-risk or abnormal, write a personalized 1-sentence explanation of *why* this specific value is critical or dangerous for *this specific user profile*.
5. STRICT JSON OUTPUT SCHEMA:
{
  "message": "Conversational summary of your educational and reference range adjustments.",
  "contextualizedBiomarkers": [
    {
      "name": "hba1c",
      "userValue": 40,
      "profileAdjustedNormalRange": "20 - 42 mmol/mol",
      "description": "HbA1c measures average blood glucose levels over the past 2 to 3 months.",
      "status": "Healthy" | "At Risk",
      "specificRiskContext": "Keeping HbA1c below 42 mmol/mol is optimal to prevent vascular damage and glycemic stress."
    }
  ]
}
Return ONLY raw JSON.`;

        mockData = {
          message: "I have calibrated the reference ranges for your biomarkers to your precise age, gender, and ethnicity, providing demographic-specific educational contexts.",
          contextualizedBiomarkers: [
            {
              name: "hba1c",
              userValue: 40,
              profileAdjustedNormalRange: "20 - 42 mmol/mol",
              description: "HbA1c measures the percentage of blood sugar attached to hemoglobin. It represents your average blood glucose levels over the past 2 to 3 months.",
              status: "Healthy",
              specificRiskContext: "Your HbA1c is in the excellent, optimal zone for your demographic group."
            }
          ]
        };
      } else if (agentType === "agent6") {
        systemInstruction = `You are a Precision Medicine & Lifestyle Coaching AI (Precision Intervention Agent). Translate the user's clinical biomarkers and risk assessment into a strict, trackable daily protocol.

USER PROFILE:
- Age: ${userProfile?.age || 'Not provided'}
- Weight: ${userProfile?.weight || 'Not provided'} kg
- Height: ${userProfile?.height || 'Not provided'} cm
- Gender: ${userProfile?.gender || 'Not provided'}

BIOMARKERS:
${JSON.stringify(biomarkers || {})}

DIAGNOSTIC BACKGROUND:
${req.body.agentDiagnosticSummary || 'Mainly healthy'}

=== DIRECTIVES ===
1. NUTRITION TARGETS (Detailed Recommended Allowances): Generate strict daily targets for calories, protein, carbs, fat, saturatedFat, totalFibre, sodium, sugar.
   - For EACH nutrient target, you MUST output a structured object containing:
     - "value": The numeric value.
     - "unit": The unit (e.g. "kcal", "g", "mg").
     - "reason": A detailed clinical explanation of why they need to focus on this goal based on their biomarkers.
     - "duration": How long they should maintain this specific target (e.g., "12 weeks", "Continuous").
2. ACTIVITY HABITS: Provide 2-3 highly specific daily habits (e.g., '7,500 steps', '30 minutes Zone 2 cardio', 'Limit screen time after 10 PM').
3. MATHEMATICAL PROJECTIONS: Provide biological time-to-goal estimates based on the math of physiology.

4. STRICT JSON OUTPUT SCHEMA:
{
  "message": "Conversational explanation of your precision lifestyle design.",
  "nutrientTargets": {
    "calories": { "value": 1850, "unit": "kcal", "reason": "To create a modest deficit for BMI optimization and lower cardiac workloads", "duration": "12 weeks / until BMI of 23 is achieved" },
    "protein": { "value": 110, "unit": "g", "reason": "To support nitrogen balance and prevent muscle wasting during a caloric deficit", "duration": "Continuous" },
    "carbs": { "value": 220, "unit": "g", "reason": "Optimized level to maintain energy without causing postprandial glucose surges", "duration": "Continuous" },
    "fat": { "value": 50, "unit": "g", "reason": "Controlled healthy fats to maintain cellular structures and hormone synthesis", "duration": "Continuous" },
    "saturatedFat": { "value": 15, "unit": "g", "reason": "Strict restriction to limit hepatic VLDL synthesis and improve your high ApoB/LDL ratio", "duration": "8-12 weeks" },
    "totalFibre": { "value": 30, "unit": "g", "reason": "High prebiotic fiber to slow glucose absorption and optimize gut microbiome health", "duration": "Continuous" },
    "sodium": { "value": 1800, "unit": "mg", "reason": "Restricted sodium to regulate extracellular fluid volume and support arterial pressure", "duration": "Continuous" },
    "sugar": { "value": 25, "unit": "g", "reason": "Low simple sugars to reduce pancreatic stress and liver glycogen packing", "duration": "8-12 weeks" }
  },
  "activityChecklist": [
    {
      "habit": "Walk 8,000 steps daily",
      "target": "8000 steps",
      "type": "steps"
    },
    {
      "habit": "Zone 2 aerobic exercise",
      "target": "30 minutes",
      "type": "cardio"
    }
  ],
  "projections": [
    "Adhering to this saturated fat limit will likely lower LDL-C by 10-15% within 12 weeks.",
    "The daily fiber target will assist in glycemic stabilization, projecting a slight HbA1c drop of 1-2 mmol/mol over 3 months."
  ]
}
Return ONLY raw JSON.`;

        mockData = {
          message: "I have created a high-precision, clinically aligned dietary and movement plan with mathematical timeline projections.",
          nutrientTargets: {
            calories: { value: 1900, unit: "kcal", reason: "Support basic metabolism with a minor deficit for cardiorespiratory health", duration: "12 weeks" },
            protein: { value: 105, unit: "g", reason: "Maintain nitrogen balance and protect lean muscle tissue", duration: "Continuous" },
            carbs: { value: 210, unit: "g", reason: "Provide stable energy without triggering glycemic excursions", duration: "Continuous" },
            fat: { value: 55, unit: "g", reason: "Ensure adequate absorption of fat-soluble vitamins and support cellular structures", duration: "Continuous" },
            saturatedFat: { value: 14, unit: "g", reason: "Decrease hepatic VLDL secretion to target elevated LDL particle numbers", duration: "8-12 weeks" },
            totalFibre: { value: 32, unit: "g", reason: "Slow down gastric transit and feed beneficial short-chain fatty acid producing gut bacteria", duration: "Continuous" },
            sodium: { value: 1700, unit: "mg", reason: "Regulate blood pressure levels and balance vascular tone", duration: "Continuous" },
            sugar: { value: 22, unit: "g", reason: "Mitigate spikes in insulin and prevent hepatic lipid deposition", duration: "8-12 weeks" }
          },
          activityChecklist: [
            { habit: "Walk 7,500 steps daily", target: "7500 steps", type: "steps" },
            { habit: "30 mins Zone 2 cardio", target: "30 minutes", type: "cardio" }
          ],
          projections: [
            "Adhering to this fat threshold will lower LDL-C by ~12% in 8-12 weeks.",
            "A 32g daily fiber intake stabilizes postprandial glucose, projecting metabolic efficiency in 4 weeks."
          ]
        };
      } else if (agentType === "agent7") {
        systemInstruction = `You are a Medical Literature Research AI (Medical Literature Agent). Summarize the latest peer-reviewed scientific consensus, clinical debates, and clinical trials relevant to this user's profile and biological risk markers.

USER PROFILE:
- Age: ${userProfile?.age || 'Not provided'}
- Gender: ${userProfile?.gender || 'Not provided'}
- Ethnicity: ${userProfile?.ethnicity || 'Not provided'}

BIOMARKERS:
${JSON.stringify(biomarkers || {})}

IDENTIFIED DIAGNOSTICS:
${req.body.agentDiagnosticSummary || 'Healthy baseline'}

=== DIRECTIVES ===
1. HIGHLIGHT SCHOLARLY TOPICS: Detail emerging consensus or debates (e.g. ApoB vs LDL-C tracking, cardiovascular risk algorithms like QRISK3 vs SCORE2, or dietary fiber's interaction with the gut microbiome).
2. NO PRESCRIPTIONS: Present findings as a literature synthesis, citing primary medical guidelines (e.g. AHA, ESC, ADA, KDIGO).
3. DETAILED BULLETS: Provide 3-4 distinct scholarly insights. Each insight must contain a bold title, a comprehensive summary paragraph, and a relevant citation/link (like a Pubmed search URL or medical association guideline URL).
4. STRICT JSON OUTPUT SCHEMA:
{
  "message": "Conversational summary of your medical literature scan.",
  "insights": [
    {
      "title": "ApoB as the Superior Predictor of Atherogenic Risk",
      "summary": "Recent European Society of Cardiology (ESC) consensus guidelines highlight Apolipoprotein B (ApoB) as a more accurate indicator of total atherogenic particle concentration than standard LDL-C, particularly in individuals with borderline-high fasting glucose or metabolic syndrome.",
      "link": "https://pubmed.ncbi.nlm.nih.gov/31475137/"
    }
  ]
}
Return ONLY raw JSON.`;

        mockData = {
          message: "I scanned the latest clinical literature databases (PubMed, Cochrane Library) and summarized three key consensus insights relevant to your metabolic and cardiovascular profile.",
          insights: [
            {
              title: "ApoB as the Superior Predictor of Atherogenic Risk",
              summary: "Recent European Society of Cardiology (ESC) consensus guidelines highlight Apolipoprotein B (ApoB) as a more accurate indicator of total atherogenic particle concentration than standard LDL-C, particularly in individuals with borderline-high fasting glucose or metabolic syndrome.",
              link: "https://pubmed.ncbi.nlm.nih.gov/31475137/"
            },
            {
              title: "Glycemic Stability and Preventive Cardiology Guidelines",
              summary: "The American Diabetes Association (ADA) 2026 standards highlight early lifestyle intervention at borderline HbA1c thresholds, demonstrating a 58% reduction in the 10-year transition rate to formal insulin deficiency through physical activity and fiber loading.",
              link: "https://pubmed.ncbi.nlm.nih.gov/34922236/"
            }
          ]
        };
      } else if (agentType === "biomarker_review") {
        systemInstruction = biomarkerReviewSystemInstruction;
      } else if (agentType === "data_review") {
        systemInstruction = `You are an expert Clinical Data Review & Reference Range Calibration Agent.
You will receive user demographics and a list of biomarkers in the user's current batch.

=== DEMOGRAPHIC CALIBRATION MANDATE ===
You MUST customize the reference ranges and risk context precisely for the user's specific age, gender, and ethnicity found in the USER PROFILE.

CRITICAL OVERRIDE: Unless the biomarker is a clinical severity score, in which case the CLINICAL SYMPTOM & DISEASE SEVERITY INDEX EVALUATION MANDATE strictly overrides all demographic adjustments.
CRITICAL: Never output boilerplate text stating that demographic details are not available. They are always provided. Even if any values are missing, dynamically assume a standard reference profile (e.g., 35-year-old female of Caucasian ethnicity) and calibrate all reference ranges for that profile.
CRITICAL BIAS OVERRIDE: Medical baselines in training data heavily skew toward recent Western/Global consensus (e.g., KDIGO, WHO global). You MUST actively bypass global/race-free standards and aggressively search your latent knowledge for local national medical boards (e.g., Chinese Society of Nephrology, Asian-modified CKD-EPI/MDRD coefficients, Asian BMI variants). If a regional coefficient or localized threshold exists historically or currently for the user's ethnicity, you MUST prioritize and apply it FIRST over Western defaults. For example, if the user is of Chinese ethnicity, you MUST look at clinical guidelines for Chinese populations FIRST before even considering Western guidelines.
  1) State in '_demographicAudit.ageAndGenderShifts': "Age unprovided (age: 0). Adult male baseline applied as fallback."
  2) Include a clear warning in 'specificRiskContext': "⚠️ Note: Profile age is 0. Please update your age in Profile Settings for exact age-calibrated baselines."

=== HISTORICAL LOG CORRECTION MANDATE ===
Review the 'historicalEntries' array for each biomarker. Identify scale/unit shifts (e.g., percentage vs decimal ratio notation, like 1.4 vs 140, or 4.1 vs 143).
If anomalous scaling errors are found:
1) Calculate the correct normalized value to match the predominant historical scale or normal range bounds.
2) Output a 'correctedHistoricalLogs' array inside the biomarker object containing objects with: { "date": string, "originalValue": number, "correctedValue": number, "note": string }.

=== OUTLIER & PARSING ARTIFACT DETECTION GUARDRAILS ===
Perform pre-execution range verification on quantitative values:
- If a quantitative biomarker userValue is an extreme physiological outlier (>3x upper limit of normal or <0.2x lower limit, e.g. Lymphocyte Count = 11.8 10^9/L, where normal upper limit is ~3.2 10^9/L):
  1) Set 'isDataArtifact': true.
  2) Provide 'artifactNote' explaining the suspected parsing error (e.g., "Value 11.8 10^9/L appears to be a relative percentage (11.8%) or decimal offset error rather than an absolute count.").
  3) In 'specificRiskContext', warn that this value is physiologically implausible for standard outpatient bloodwork and requires document re-parsing or verification.

=== QUALITATIVE ASSAY DATA TYPE PRESERVATION ===
CRITICAL: For qualitative or text-based assays (e.g. 'NEGATIVE', 'POSITIVE', 'NORMAL', 'NOT DETECTED'):
- You MUST preserve 'userValue' as the EXACT string payload from input (e.g., "NEGATIVE").
- NEVER convert string qualitative results into integers or floats (such as 0 or 1).

=== CLINICAL SYMPTOM & DISEASE SEVERITY INDEX EVALUATION MANDATE ===
For any clinical symptom score or disease severity index biomarker (e.g. unit is 'score' or 'points', or key ends in '_symptom_score' or '_score' or '_index', such as 'hemorrhoidal_symptom_score', 'Hemorrhoidal Disease Symptom Score (HDSS)', 'gerd_symptom_score', 'joint_pain_severity_score'):
CRITICAL EXCEPTION: Behavioral screening tools (such as 'audit_total_score', 'audit_c_total_score', 'audit_binge_drinking_score', and all other alcohol/AUDIT metrics) DO NOT follow this mandate. For behavioral screens, you MUST use their established clinical scoring thresholds:
- audit_total_score: Optimal is <= 7
- audit_c_total_score: Optimal is <= 3
- audit_binge_drinking_score: Optimal is <= 1
Do NOT force a zero-baseline on them. If the user's score falls in the Optimal range, you MUST set 'status' to 'Optimal'.

For true symptom/disease severity indices ONLY:
1. Recognise that disease/symptom severity scores have a globally uniform baseline of 0 (Remission / Healthy / Asymptomatic) across all global demographics.
2. In '_demographicAudit', note that the baseline remains 0 globally.
3. Set 'profileAdjustedNormalRange' to '0' and 'optimalValue' to '0'.
4. In 'rangeBrackets', YOU MUST USE EXACTLY THESE FOUR STANDARDIZED CLINICAL INDEX SEVERITY BRACKETS (DO NOT USE OTHER NAMES):
   - [ { "name": "Remission / Healthy", "range": "0" }, { "name": "Mild Flare-up", "range": "1" }, { "name": "Moderate Flare-up", "range": "2" }, { "name": "Severe Progression", "range": ">= 3" } ]
5. Evaluation & Status:
   - '_statusReasoning': "User score of <X> is evaluated against the severity index."
   - 'status': 'At Risk' if userValue >= 3; 'Sub-Optimal (Action Zone)' if userValue == 1 or userValue == 2; 'Optimal' if userValue == 0.
   - 'specificRiskContext': Provide concise clinical guidance for mitigating flare-ups.

=== CRITICAL BREVITY DIRECTIVE (PREVENT TIMEOUTS & TRUNCATION) ===
Your responses MUST be extremely concise to fit within token limits:
- Keep '_demographicAudit.standardWesternBaseline' to 8 words maximum.
- Keep '_demographicAudit.knownEthnicOrRegionalVariances' to 8 words maximum.
- Keep '_demographicAudit.ageAndGenderShifts' to 8 words maximum.
- Keep '_demographicAudit.finalAppliedAdjustments' to 8 words maximum.
- Keep 'description' to exactly 1 short sentence of 10 words.
- Keep '_statusReasoning' to 5-8 words maximum.
- Keep 'specificRiskContext' to 1-2 short sentences (20 words maximum).
- Under 'rangeBrackets', define only necessary brackets (e.g. Optimal, Elevated, Low). For severity scores, use the 4 exact brackets defined in the severity mandate.
=== OPTIMAL VALUE vs NORMAL RANGE MANDATE ===
- 'profileAdjustedNormalRange': Healthy reference range (e.g. '18.5 - 22.9 kg/m2').
- 'optimalValue': Single specific target point within healthy range (e.g., '21.0 kg/m2' for BMI, '115 mmHg' for SBP), NOT a range or repeat of normalRange.

=== UNIT CONSISTENCY MANDATE (STRICT) ===
Every clinical range bound, normal range, and target value described in 'profileAdjustedNormalRange', 'optimalValue', and 'rangeBrackets[].range' MUST strictly use the EXACT declared 'unit' of the biomarker. Under no circumstances should you embed a composite or index unit like 'kg/m²' if the biomarker's declared 'unit' is 'kg'. Composite/index units are ONLY valid when the biomarker's own declared 'unit' matches that composite unit exactly.

=== TASK: PERSONALISED HEALTH RISK ESTIMATION ===
For each biomarker, follow a strict logical funnel to determine ranges and status:
"_demographicAudit": Reasoning object contrasting Western global standards with regional guidelines.
"profileAdjustedNormalRange": Final calibrated range where biomarker is not at risk.
"optimalValue": Single specific ideal target point within healthy spectrum.
"rangeBrackets": Continuous brackets (no gaps) mapping the bounds of profileAdjustedNormalRange.
"description": 1 short sentence physiological role.
"_statusReasoning": Strict mathematical comparison of userValue against profileAdjustedNormalRange.
"reference": Clinical reference body acting as the anchor.
"status": 'Optimal', 'Sub-Optimal (Action Zone)', or 'At Risk' based strictly on userValue location.
"specificRiskContext": 1-2 short sentences on clinical relevance.
=== CRITICAL REQUIREMENTS ===
You MUST include an analysis for EVERY biomarker in the input list.
Your output MUST be a valid JSON object matching the schema provided.`;
        mockData = { message: "Completed clinical review.", reviewedBiomarkers: [] };
      }

      let textOutput = "";
      if (!getGeminiApiKey()) {
        textOutput = JSON.stringify(mockData);
      } else {
        let historyText = "";
        if (history && history.length > 0) {
          historyText = history.map((h: any) => `${h.role}: ${h.content}`).join("\n") + "\n\n";
        }
        
        let imagePayload = null;
        let imagesPayload: { mimeType: string, data: string }[] | undefined = undefined;
        if (images && images.length > 0) {
          imagesPayload = images.map((img: string) => {
            const mimeType = img.split(";")[0].split(":")[1] || "image/jpeg";
            const base64Data = img.split(",")[1];
            return { mimeType, data: base64Data };
          });
          imagePayload = imagesPayload[0];
        } else if (image) {
          const mimeType = image.split(";")[0].split(":")[1] || "image/jpeg";
          const base64Data = image.split(",")[1];
          imagePayload = { mimeType, data: base64Data };
        }
        const imageCtx = imageDates && imageDates.length > 0 ? `The attached images were taken on these dates: ${imageDates.join(", ")}.` : "";
        
        const cleanProfile: any = {
          age: userProfile?.age,
          gender: userProfile?.gender,
          ethnicity: userProfile?.ethnicity,
          bloodType: userProfile?.bloodType,
          weight: userProfile?.weight,
          height: userProfile?.height
        };
        
        // Strip undefined and null values
        Object.keys(cleanProfile).forEach(key => {
          if (cleanProfile[key] === undefined || cleanProfile[key] === null) {
            delete cleanProfile[key];
          }
        });

        const slimBiomarkers: any = {};
        if (userProfile?.customBiomarkers) {
          Object.keys(userProfile.customBiomarkers).forEach((k: string) => {
            slimBiomarkers[k] = { 
              name: userProfile.customBiomarkers[k].name, 
              unit: userProfile.customBiomarkers[k].unit 
            };
          });
        }
        
        const cleanedPayload: any = {
          userProfile: cleanProfile,
          biomarkerDefinitions: slimBiomarkers,
          biomarkerHistory: biomarkerHistory || []
        };
        if (agentType === "agent4") {
          delete cleanedPayload.biomarkerDefinitions;
        }

        let jsonStr = "";
        if (req.body.extractedData) {
          if (typeof req.body.extractedData === 'string') {
            jsonStr = req.body.extractedData;
          } else {
            jsonStr = JSON.stringify(req.body.extractedData, null, 2);
          }
        }

        let dataContext = "";
        if (agentType === "agent1_step1" || agentType === "lab_extract" || agentType === "symptom_diary") {
          const prevJson = jsonStr ? `\n\nPREVIOUSLY EXTRACTED JSON:\n${jsonStr}` : "";
          
          let reportSource = req.body.originalReportText || message;
          if (typeof req.body.lastProcessedIndex === 'number' && req.body.lastProcessedIndex > 0 && req.body.lastProcessedIndex < reportSource.length) {
            reportSource = reportSource.slice(req.body.lastProcessedIndex);
          }
          
          const prevTotal = req.body.estimatedTotalMarkers ? `\n\nPREVIOUSLY ESTIMATED TOTAL MARKERS:\n${req.body.estimatedTotalMarkers}` : "";
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : `\n\nUSER PROFILE:\n${JSON.stringify(cleanProfile, null, 2)}\n`;
          const step1Timezone = req.body.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
          let step1LocalDateStr;
          try {
            const step1Formatter = new Intl.DateTimeFormat('en-CA', { timeZone: step1Timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
            step1LocalDateStr = step1Formatter.format(new Date());
          } catch (e) {
            step1LocalDateStr = new Date().toISOString().split("T")[0];
          }
          const dateCtx = `\n\nCURRENT DATE (user local, YYYY-MM-DD): ${step1LocalDateStr}\nUse this as the anchor for resolving relative date references in patient-reported text (e.g. "today", "yesterday", "the last 2 days").\n`;
          dataContext = `\n\nUSER RAW DATA:\n${reportSource}${prevJson}${prevTotal}${dateCtx}${baseData}`;
        } else if (agentType === "agent1_step2") {
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : "";
          dataContext = `${baseData}\n\nEXTRACTED JSON DATA:\n${jsonStr}\n`;
        } else if (agentType === "agent1_step3") {
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : "";
          dataContext = `${baseData}\n\nEXTRACTED JSON DATA:\n${jsonStr}\n\nBUCKET MAPPING JSON:\n${req.body.bucketMapping}\n`;
        } else if (agentType === "biomarker_review") {
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : `\n\nUSER PROFILE:\n${JSON.stringify(cleanProfile, null, 2)}\n`;
          const rawBatchKeys = req.body.dataReviewBatchKeys || req.body.batchBiomarkers || [];
          const batchKeys = (Array.isArray(rawBatchKeys) ? rawBatchKeys : []).filter(k => typeof k === 'string' && /^[a-zA-Z0-9_-]{1,40}$/.test(k));
          const focusKeys: string[] = req.body.biomarkerKey
            ? [req.body.biomarkerKey]
            : batchKeys;

          // Scope the payload to only the biomarker(s) actually being reviewed.
          // This is a scaling/unit correction task, not a full clinical review —
          // the other ~70 unrelated biomarkers and log metadata (sync_state,
          // updated_at, note, tests[].doctorComment) are noise for this agent.
          // Fall back to the full objects only if no focus key was provided at all.
          let scopedCurrentBiomarkers: any = biomarkers || {};
          let scopedHistory: any[] = biomarkerHistory || [];
          if (focusKeys.length > 0) {
            scopedCurrentBiomarkers = {};
            focusKeys.forEach(k => {
              if (biomarkers && biomarkers[k] !== undefined) scopedCurrentBiomarkers[k] = biomarkers[k];
            });

            scopedHistory = (biomarkerHistory || [])
              .filter((h: any) => h.biomarkers && focusKeys.some(k => h.biomarkers[k] !== undefined))
              .map((h: any) => {
                const trimmedBiomarkers: any = {};
                focusKeys.forEach(k => {
                  if (h.biomarkers[k] !== undefined) trimmedBiomarkers[k] = h.biomarkers[k];
                });
                let standardizedDate = h.date;
                if (typeof standardizedDate === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(standardizedDate)) {
                  const parts = standardizedDate.split('-');
                  standardizedDate = `${parts[2]}-${parts[1]}-${parts[0]}`;
                }
                return { date: standardizedDate, biomarkers: trimmedBiomarkers };
              });
          }

          dataContext = `${baseData}\n\nCURRENT BIOMARKERS:\n${JSON.stringify(scopedCurrentBiomarkers, null, 2)}\n\nFULL BIOMARKER LOG HISTORY:\n${JSON.stringify(scopedHistory, null, 2)}\n`;
          if (req.body.biomarkerKey) {
            dataContext += `\n\nFOCUS BIOMARKER TO REVIEW: ${req.body.biomarkerKey}\n`;
          }
          if (Array.isArray(batchKeys) && batchKeys.length > 0) {
            dataContext += `\n\nFOCUS BIOMARKERS TO REVIEW (BATCH): ${batchKeys.join(', ')}\n`;
          }
        } else if (agentType === "data_review") {
          let batchData = req.body.batchBiomarkers || [];
          if (!Array.isArray(batchData) || batchData.length === 0) {
            let keys: string[] = [];
            if (Array.isArray(req.body.batchKeys) && req.body.batchKeys.length > 0) {
              keys = req.body.batchKeys;
            } else if (Array.isArray(req.body.dataReviewBatchKeys) && req.body.dataReviewBatchKeys.length > 0) {
              keys = req.body.dataReviewBatchKeys;
            } else if (typeof req.body.message === 'string' && req.body.message.includes(':')) {
              const parts = req.body.message.split(':');
              const candidateKeys = parts.slice(1).join(':').split(/[\n,]/).map((s: string) => s.trim().toLowerCase()).filter(Boolean);
              if (candidateKeys.length > 0) {
                keys = candidateKeys;
              }
            } else if (biomarkers && typeof biomarkers === 'object') {
              keys = Object.keys(biomarkers);
            }

            const customDefs = (cleanProfile as any)?.customBiomarkers || {};
            batchData = keys.map(k => {
              const customDef = customDefs[k] || {};
              const stdDef = biomarkerDefinitions.find((d: any) => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k.toLowerCase())));
              const name = customDef.name || stdDef?.name || k;
              const historyEntries: { date: string; value: any }[] = [];
              (biomarkerHistory || []).forEach((h: any) => {
                if (h.biomarkers && h.biomarkers[k] !== undefined && h.biomarkers[k] !== null && h.biomarkers[k] !== '') {
                  historyEntries.push({ date: h.date || 'unknown', value: h.biomarkers[k] });
                }
              });
              const rawVal = (biomarkers && biomarkers[k] !== undefined && biomarkers[k] !== null && biomarkers[k] !== '')
                ? biomarkers[k]
                : (historyEntries[0]?.value ?? '');
              const val = rawVal !== '' && rawVal !== undefined && rawVal !== null ? rawVal : 'Baseline / Unrecorded';
              const unit = customDef.unit || stdDef?.unit || (k.endsWith('_score') || k.endsWith('_risk') || k.endsWith('_index') ? 'score' : (k === 'steps' ? 'steps' : 'standard'));
              const normalRange = customDef.normalRange || stdDef?.normalRange || '';
              return {
                key: k,
                name,
                userValue: val,
                value: val,
                unit,
                normalRange,
                historicalEntries: historyEntries,
                historicalSummary: historyEntries.map(e => `${e.date}: ${e.value}`).join(' → ')
              };
            });
          } else {
            // Sanitize existing batchData items to ensure non-empty userValues and standard names
            const customDefs = (cleanProfile as any)?.customBiomarkers || {};
            batchData = batchData.map((bm: any) => {
              const k = bm.key || bm.name || '';
              const customDef = customDefs[k] || {};
              const stdDef = biomarkerDefinitions.find((d: any) => d.key === k || (Array.isArray(d.aliases) && d.aliases.some((a: string) => a.toLowerCase() === k.toLowerCase())));
              const name = bm.name && bm.name !== k ? bm.name : (customDef.name || stdDef?.name || k);
              const rawVal = bm.userValue !== undefined && bm.userValue !== null && bm.userValue !== '' ? bm.userValue : bm.value;
              const val = rawVal !== '' && rawVal !== undefined && rawVal !== null ? rawVal : 'Baseline / Unrecorded';
              const unit = bm.unit || customDef.unit || stdDef?.unit || (k.endsWith('_score') || k.endsWith('_risk') || k.endsWith('_index') ? 'score' : (k === 'steps' ? 'steps' : 'standard'));
              const normalRange = bm.normalRange || customDef.normalRange || stdDef?.normalRange || '';
              return {
                ...bm,
                key: k,
                name,
                userValue: val,
                value: val,
                unit,
                normalRange
              };
            });
          }
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : `\n\nUSER PROFILE:\n${JSON.stringify(cleanProfile, null, 2)}\n`;
          dataContext = `${baseData}\n\nBIOMARKERS BATCH FOR REVIEW:\n${JSON.stringify(batchData, null, 2)}\n`;
        } else if (agentType === "agent1") {
          let batchData = req.body.batchBiomarkers || [];
          if (!Array.isArray(batchData) || batchData.length === 0) {
            let keys: string[] = [];
            if (Array.isArray(req.body.batchKeys) && req.body.batchKeys.length > 0) {
              keys = req.body.batchKeys;
            } else if (Array.isArray(req.body.dataReviewBatchKeys) && req.body.dataReviewBatchKeys.length > 0) {
              keys = req.body.dataReviewBatchKeys;
            }
            if (keys.length > 0) {
              const customDefs = (cleanProfile as any)?.customBiomarkers || {};
              batchData = keys.map(k => {
                const customDef = customDefs[k] || {};
                const historyEntries: { date: string; value: any }[] = [];
                (biomarkerHistory || []).forEach((h: any) => {
                  if (h.biomarkers && h.biomarkers[k] !== undefined && h.biomarkers[k] !== null && h.biomarkers[k] !== '') {
                    historyEntries.push({ date: h.date || 'unknown', value: h.biomarkers[k] });
                  }
                });
                const val = (biomarkers && biomarkers[k] !== undefined && biomarkers[k] !== null && biomarkers[k] !== '')
                  ? biomarkers[k]
                  : (historyEntries[0]?.value ?? '');
                return {
                  key: k,
                  name: customDef.name || k,
                  userValue: val,
                  value: val,
                  unit: customDef.unit || '',
                  normalRange: customDef.normalRange || '',
                  historicalEntries: historyEntries,
                  historicalSummary: historyEntries.map(e => `${e.date}: ${e.value}`).join(' → ')
                };
              });
            }
          }
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : `\n\nUSER PROFILE:\n${JSON.stringify(cleanProfile, null, 2)}\n`;
          dataContext = `${baseData}\n\nBIOMARKERS BATCH FOR CLEANING:\n${JSON.stringify(batchData, null, 2)}\n`;
        } else {
          const jsonPayload = JSON.stringify(cleanedPayload, null, 2);
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : "";
          dataContext = `${baseData}\n\nUSER MEDICAL DATA (in JSON format):\n${jsonPayload}\n`;
        }

        if (customSystemInstruction) {
          systemInstruction = customSystemInstruction;
        }

        const includeFoodLogs = foodLogs && Array.isArray(foodLogs) && foodLogs.length > 0 && agentType !== "agent1_step1" && agentType !== "agent1_step2" && agentType !== "agent1_step3" && agentType !== "data_review" && agentType !== "agent1" && agentType !== "agent4" && agentType !== "biomarker_review";
        
        let foodLogsPrompt = "";
        if (includeFoodLogs) {
          const recentLogs = foodLogs.slice(-35);
          const mealLines = recentLogs.map((m: any, idx: number) => {
            let nutStr = "";
            if (m.nutrients && typeof m.nutrients === 'object') {
              const parts: string[] = [];
              const n = m.nutrients;
              if (n.calories) parts.push(`${n.calories} kcal`);
              if (n.carbs || n.carbohydrates) parts.push(`Carbs: ${n.carbs || n.carbohydrates}g`);
              if (n.sugar || n.sugars) parts.push(`Sugar: ${n.sugar || n.sugars}g`);
              if (n.protein) parts.push(`Protein: ${n.protein}g`);
              if (n.fat) parts.push(`Fat: ${n.fat}g`);
              if (n.saturatedFat) parts.push(`Sat Fat: ${n.saturatedFat}g`);
              if (n.sodium) parts.push(`Sodium: ${n.sodium}mg`);
              if (parts.length > 0) nutStr = ` (${parts.join(', ')})`;
            }
            return `- Meal ${idx + 1}: "${m.name}" on ${m.date || 'unknown'}${nutStr}`;
          }).join("\n");
          foodLogsPrompt = `PATIENT'S RECENT LOGGED MEALS HISTORY (Last ${recentLogs.length} meals):\n${mealLines}\n\n`;
        }

        const isExtractStep = agentType === "agent1_step1" || agentType === "lab_extract" || agentType === "symptom_diary";
        let promptText = isExtractStep
          ? `${foodLogsPrompt}${imageCtx}User message: "${message}"${dataContext}`
          : `Chat History:\n${historyText}${foodLogsPrompt}${imageCtx}${dataContext}`;
        fullPromptSent = `System Instruction:\n${systemInstruction}\n\n${promptText}`;

        let isYaml = false; // agent1 now uses structured JSON output, not YAML
        
        let maxRetries = agentType === "agent1_step3" ? 3 : 1;
        let attempt = 0;
        let success = false;
        
        addDebugLog(`[Medical Analyze Agent] Dispatched System Instruction (Length: ${systemInstruction.length})`, explicitSessionId);
        addDebugLog(`[Medical Analyze Agent] Dispatched Prompt:\n${promptText}`, explicitSessionId);
        sendLog('status', 'Analyzing health profile...');

        while (attempt < maxRetries && !success) {
          attempt++;
          textOutput = await callUnifiedLLM({
            modelId: (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite",
            systemInstruction,
            promptText,
            imagePayload,
            imagePayloads: imagesPayload,
            responseMimeType: isYaml ? "text/plain" : "application/json",
            skipThinking: true,
            maxOutputTokens: (agentType === "data_review" || agentType === "agent4" || agentType === "agent1_step3" || agentType === "agent1") ? 8192 : undefined,
            responseSchema: (agentType === "agent1_step1" || agentType === "agent1")
              ? agent1Step1Schema
              : (agentType === "biomarker_review")
                ? {
                 type: Type.OBJECT,
                 properties: {
                   reply: { type: Type.STRING, description: "Conversational, highly polished response explaining the biomarker, answering questions, or explaining proposed corrections." },
                   proposal: {
                     type: Type.OBJECT,
                     nullable: true,
                     properties: {
                       keyName: { type: Type.STRING },
                       name: { type: Type.STRING },
                       metric: { type: Type.STRING },
                       value: { type: Type.STRING },
                       date: { type: Type.STRING, description: "YYYY-MM-DD" },
                       range: { type: Type.STRING },
                       description: { type: Type.STRING },
                       medicalInsight: { type: Type.STRING, description: "Personalized medical insight based on demographic profile and proposed value" },
                       isEthnicitySpecific: { type: Type.BOOLEAN },
                       ethnicityTag: { type: Type.STRING, nullable: true },
                       rangeBrackets: {
                         type: Type.ARRAY,
                         nullable: true,
                         items: {
                           type: Type.OBJECT,
                           properties: {
                             label: { type: Type.STRING },
                             severity: { type: Type.INTEGER, description: "Integer between -5 and +5 (0 = Optimal, +1 to +4 = Progressive Elevation, -1 to -4 = Progressive Deficiency, +/-5 = Acute Panic Emergency only)" },
                             min: { type: Type.NUMBER, nullable: true },
                             max: { type: Type.NUMBER, nullable: true }
                           },
                           required: ["label", "severity"]
                         }
                       }
                     },
                     required: ["name", "metric", "value", "date", "range", "description", "medicalInsight", "isEthnicitySpecific", "ethnicityTag"]
                   },
                   modificationCommand: {
                     type: Type.ARRAY,
                     nullable: true,
                     items: {
                       type: Type.OBJECT,
                       properties: {
                         action: { type: Type.STRING, enum: ["update_biomarker", "update_profile", "remove_biomarker"] },
                         keyName: { type: Type.STRING },
                         oldValue: { type: Type.STRING, description: "Original erroneous value in the log before correction" },
                         newValue: { type: Type.STRING, description: "Corrected target value" },
                         date: { type: Type.STRING, description: "YYYY-MM-DD date of the log entry" },
                         reason: { type: Type.STRING, description: "Short explanation of the error (e.g. Scaling error: 48 percentage unit -> 0.48 decimal ratio)" }
                       },
                       required: ["action", "keyName", "date", "newValue"]
                     }
                   }
                 },
                 required: ["reply"]
               }
              : (agentType === "data_review") 
                ? dataReviewSchema 
                : (agentType === "agent4")
                  ? healthPlanningSchema
                  : undefined
          });
          
          addDebugLog(`[Medical Analyze Agent] Response received (${textOutput?.length || 0} chars). Full payload already logged above by [UnifiedLLM-Response].`, explicitSessionId);
          sendLog('status', 'Response received, finalizing...');

          if (agentType === "agent1_step3") {
            try {
              let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
              const firstBrace = cleanJson.indexOf("{");
              const lastBrace = cleanJson.lastIndexOf("}");
              if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                cleanJson = extractBalancedJson(cleanJson);
              }
              const parsed = JSON.parse(cleanJson);
              
              const expectedCount = (jsonStr?.match(/"biomarker":/g) || []).length;
              let actualCount = 0;
              if (parsed.buckets && Array.isArray(parsed.buckets)) {
                parsed.buckets.forEach((b: any) => {
                  if (b.biomarkers && Array.isArray(b.biomarkers)) {
                    b.biomarkers.forEach((m: any) => {
                      if (m.history && Array.isArray(m.history)) {
                        actualCount += m.history.length;
                      }
                    });
                  }
                });
              }
              
              const isChatOrUpdate = req.body.message && req.body.message !== "Continue processing" && req.body.message !== "Assemble JSON" && req.body.message !== "Assemble Data" && req.body.message !== "Assemble data";
              const isDeleteQuery = req.body.message && (
                req.body.message.toLowerCase().includes("delete") ||
                req.body.message.toLowerCase().includes("remove") ||
                req.body.message.toLowerCase().includes("exclude") ||
                req.body.message.toLowerCase().includes("clear")
              );
              
              if (actualCount === expectedCount || attempt === maxRetries || (isChatOrUpdate && isDeleteQuery)) {
                success = true;
                textOutput = cleanJson;
              } else {
                console.log(`Agent 3 retry ${attempt}: Expected ${expectedCount} entries, got ${actualCount}`);
                promptText += `\n\nERROR: You missed some entries. I expected ${expectedCount} historical log entries based on the JSON data, but you only outputted ${actualCount}. You MUST include EVERY single entry from the JSON. Do not summarize or skip any.`;
              }
            } catch (err) {
              console.error("Agent 3 parse error:", err);
              if (attempt === maxRetries) success = true; // just let it fail naturally below
            }
          } else {
            success = true;
          }
        }
      }

      if (agentType === "agent1_step1" || agentType === "lab_extract" || agentType === "symptom_diary") {
        let cleanJson: any = textOutput;
        let text = "I have extracted the biomarkers. Please review the output.";
        let hasMoreMarkers = false;
        let lastProcessedIndex: number | null = null;
        let estimatedTotalMarkers: number | null = null;
        let unmappedTests: any[] = [];
        try {
          const parsed = JSON.parse(textOutput.replace(/```(?:json)?/gi, "").trim());
          if (parsed.extractedData) {
            cleanJson = parsed.extractedData;
          }
          if (parsed.text) {
            text = parsed.text;
          }
          if (parsed.unmappedTests) {
            unmappedTests = parsed.unmappedTests;
          }
          
          if (Array.isArray(cleanJson)) {
            cleanJson = cleanJson.map((item: any) => {
              if (!item || typeof item !== 'object') return item;
              if (item.unit) {
                const rawUnit = item.unit;
                const sanitizedUnit = sanitizeUnitText(rawUnit);
                item.unit = sanitizedUnit;
                
                if (item.biomarker) {
                  const matrixConfig = BiomarkerMatrix[item.biomarker];
                  if (matrixConfig) {
                    const val = item.numeric_value !== undefined && item.numeric_value !== null ? item.numeric_value : item.value;
                    if (typeof val === 'number' || (typeof val === 'string' && !isNaN(parseFloat(val)))) {
                      const numVal = parseFloat(String(val));
                      const newVal = matrixConfig.conversionLogic(numVal, sanitizedUnit);
                      const roundedNewVal = Math.round(newVal * 100) / 100;

                      if (item.numeric_value !== undefined && item.numeric_value !== null) item.numeric_value = roundedNewVal;
                      else if (item.value !== undefined && item.value !== null) item.value = roundedNewVal;
                      
                      item.unit = matrixConfig.targetUnit;
                    }
                  }
                }
              }
              return item;
            });
          }

          if (parsed.hasMoreMarkers !== undefined) {
            hasMoreMarkers = !!parsed.hasMoreMarkers;
          }
          if (parsed.lastProcessedIndex !== undefined) {
            lastProcessedIndex = parsed.lastProcessedIndex;
          }
          if (parsed.estimatedTotalMarkers !== undefined) {
            estimatedTotalMarkers = Number(parsed.estimatedTotalMarkers);
          }
        } catch (e) {
          cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
        }
        const mergedResult = mergeStagedExtract({
          text,
          agentType,
          extractedData: cleanJson,
          hasMoreMarkers,
          lastProcessedIndex,
          estimatedTotalMarkers,
          unmappedTests,
          currentBatch: req.body.currentBatch || 1,
          agentPrompt: fullPromptSent,
          apiCalls: [{ type: 'gemini', label: `Medical History Agent (${engine || 'gemini-3.5-flash-lite'})` }]
        }, ingestTrace);
        addDebugLog(`[Medical Analyze Agent] Post-merge extractedData: ${Array.isArray(mergedResult.extractedData) ? mergedResult.extractedData.length : 'not-array'} row(s) sent to client (LLM leftover parsed: ${Array.isArray(cleanJson) ? cleanJson.length : 'not-array'}, ingestTrace present: ${!!ingestTrace}, ingestTrace rows: ${ingestTrace?.rows?.length ?? 0}).`, explicitSessionId);
        try {
          const __rowsForLog = Array.isArray(mergedResult.extractedData) ? mergedResult.extractedData : [];
          const __tableLog = __rowsForLog.slice(0, 200).map((r: any) =>
            `${r.biomarker ?? '—'} | ${r.date ?? '—'} | value=${r.numeric_value ?? r.value ?? r.qualitative_value ?? '—'} | unit=${r.unit ?? '—'}`
          ).join('\n');
          addDebugLog(`[Medical Analyze Agent] Extracted rows table (${__rowsForLog.length} total, showing up to 200):\n${__tableLog}`, explicitSessionId);
        } catch (e: any) {
          addDebugLog(`[Medical Analyze Agent] Failed to log extracted rows table: ${e?.message || e}`, explicitSessionId);
        }
        return res.json(mergedResult);
      }

      if (agentType === "biomarker_review") {
        try {
          const parsed = safeExtractJsonObject(textOutput) || {};
          const unitMap: Record<string, string> = { ...(req.body.catalogUnitByKey || {}) };
          Object.entries(userProfile?.customBiomarkers || {}).forEach(([k, v]: [string, any]) => {
            if (v?.unit) unitMap[k] = v.unit;
          });
          const rawCmds = Array.isArray(parsed.modificationCommand) ? parsed.modificationCommand : [];
          const cmds = enrichReviewModificationCommands(
            rawCmds,
            biomarkerHistory || [],
            unitMap
          );
          const sanitizedReply = sanitizeReviewReply(
            parsed.reply || parsed.text || (typeof parsed === 'string' ? parsed : textOutput),
            cmds,
            biomarkerHistory || [],
            unitMap
          );
          return res.json({
            text: sanitizedReply,
            reply: sanitizedReply,
            proposal: parsed.proposal || null,
            modificationCommand: cmds.length ? cmds : (rawCmds.length ? rawCmds : null),
            agentType,
            agentPrompt: fullPromptSent,
            apiCalls: [{ type: 'gemini', label: `Biomarker Review Agent (${engine || 'gemini-3.5-flash-lite'})` }]
          });
        } catch (e) {
          console.error("biomarker_review JSON parse error", e);
          return res.json({
            text: textOutput,
            reply: textOutput,
            agentType,
            agentPrompt: fullPromptSent,
            apiCalls: [{ type: 'gemini', label: `Biomarker Review Agent (${engine || 'gemini-3.5-flash-lite'})` }]
          });
        }
      }

      if (agentType === "data_review") {
        let reviewedBiomarkers: any[] = [];
        let message = "";
        let extremeDivergences: any[] = [];
        try {
          const cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
          const parsed = JSON.parse(cleanJson);
          if (parsed) {
            message = parsed.message || "";
            extremeDivergences = Array.isArray(parsed.extremeDivergences) ? parsed.extremeDivergences : [];
            const rawReviewed = Array.isArray(parsed.reviewedBiomarkers) ? parsed.reviewedBiomarkers : [];
            reviewedBiomarkers = rawReviewed.map(sanitizeReviewedBiomarkerUnitConsistency);
          }
        } catch (e) {
          console.error("data_review JSON parse error", e);
        }
        return res.json({
          message,
          reviewedBiomarkers,
          extremeDivergences,
          batchIdx: req.body.batchIdx !== undefined ? req.body.batchIdx : null,
          agentType,
          agentPrompt: fullPromptSent,
          apiCalls: [{ type: 'gemini', label: `Clinical Calibration Agent (${engine || 'gemini-3.5-flash-lite'})` }]
        });
      }

            if (agentType === "agent1") {
        let parsedRows = [];
        let isWrongDoor = false;
        try {
          const parsed = JSON.parse(textOutput.replace(/```(?:json)?/gi, "").trim());
          if (parsed.extractedData) parsedRows = parsed.extractedData;
          if (parsed.isWrongDoor === true) isWrongDoor = true;
        } catch (e) {
          console.error("agent1 JSON parse error", e);
        }
        return res.json({
          text: "",
          agentType,
          extractedData: parsedRows,
          hasMoreMarkers: false,
          lastProcessedIndex: null,
          estimatedTotalMarkers: 0,
          isWrongDoor,
          agentPrompt: fullPromptSent,
          apiCalls: [{ type: 'gemini', label: `Medical History Agent (${engine || 'gemini-3.5-flash-lite'})` }]
        });
      }

      if (agentType === "agent5" || agentType === "agent7") {
        const agentLabel = agentType === "agent5" ? "Holistic Review Agent" : "Health Report Agent";
        try {
          const cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
          const parsed = JSON.parse(cleanJson);
          return res.json({
            ...parsed,
            message: parsed.message || "",
            agentPrompt: fullPromptSent,
            agentType,
            apiCalls: [{ type: 'gemini', label: `${agentLabel} (${engine || 'gemini-3.5-flash-lite'})` }]
          });
        } catch (e) {
          console.error(`[Medical Analyze - ${agentType} parse error]:`, e);
          return res.json({
            message: "I was unable to parse a valid response. Please try again.",
            agentPrompt: fullPromptSent,
            agentType,
            apiCalls: [{ type: 'gemini', label: `${agentLabel} (${engine || 'gemini-3.5-flash-lite'})` }]
          });
        }
      }
      
      if (!agentType || agentType === "agent4") {
        try {
          const cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
          const parsed = JSON.parse(cleanJson);
          
          let textVal = parsed.text;
          if (!textVal || typeof textVal !== 'string' || !textVal.trim() || textVal.trim().startsWith('{')) {
            textVal = "I have completed a diagnostic assessment and health planning audit based on your profile and biomarker history. Please review the findings, recommended retests, and testing gaps below:";
          }

          return res.json({
            ...parsed,
            text: textVal,
            summary: parsed.summary || parsed.primaryDiagnosis || parsed.text || "Diagnostic accuracy and health planning evaluation complete.",
            retestBiomarkers: Array.isArray(parsed.retestBiomarkers) ? parsed.retestBiomarkers : [],
            testingGaps: Array.isArray(parsed.testingGaps) ? parsed.testingGaps : (Array.isArray(parsed.recommendedTests) ? parsed.recommendedTests : []),
            _internalReasoning: parsed._internalReasoning || "",
            mode: parsed.mode || 'discussion',
            status: parsed.status || 'active',
            agentPrompt: fullPromptSent,
            agentType: agentType || 'agent4',
            apiCalls: [{ type: 'gemini', label: `Health Planning Agent (${engine || 'gemini-3.5-flash-lite'})` }]
          });
        } catch (e) {
          return res.json({
            text: "I have completed a diagnostic assessment and health planning audit. Please review the findings below:",
            summary: textOutput,
            retestBiomarkers: [],
            testingGaps: [],
            _internalReasoning: textOutput,
            mode: 'discussion',
            status: 'active',
            agentPrompt: fullPromptSent,
            agentType: agentType || 'agent4',
            apiCalls: [{ type: 'gemini', label: `Health Planning Agent (${engine || 'gemini-3.5-flash-lite'})` }]
          });
        }
      }

      return res.json({
          text: "",
          agentType,
          extractedData: textOutput,
          hasMoreMarkers: false,
          lastProcessedIndex: null,
          estimatedTotalMarkers: 0,
          agentPrompt: fullPromptSent,
          apiCalls: [{ type: 'gemini', label: `Medical History Agent (${engine || 'gemini-3.5-flash-lite'})` }]
      });
    }
  } catch (error: any) {
    console.error("[Medical Analyze Error]:", error);
    res.status(500).json({ error: "Failed to process medical analysis: " + error.message });
  }
  });
});




medicalGeminiRouter.post("/api/gemini/review-biomarker", async (req, res) => {
  const { message, history, profile, biomarkerDef, currentValue, modelId, jsonContext } = req.body;
  if (!message) return res.status(400).json({ error: "Missing message" });
  
  const engine = (typeof modelId === 'object' ? modelId?.name || modelId?.model : modelId) || 'gemini-3.5-flash-lite';

  try {
    let historyText = "";
    if (history && Array.isArray(history) && history.length > 0) {
      historyText = "Here is the conversation history so far:\n" + 
        history.map((h) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join("\n") + "\n\n";
    }

    const inputsJson = jsonContext ? jsonContext : `user_profile:
  age: "${profile?.age || 'unknown'}"
  gender: "${profile?.gender || 'unknown'}"
  weight_kg: "${profile?.weight || 'unknown'}"
  height_cm: "${profile?.height || 'unknown'}"
  ethnicity: "${profile?.ethnicity || 'unknown'}"
  unit_preference: "${profile?.unitPreference || 'SI'}" # Values: 'SI' (mmol/L, mmol/mol) or 'US' (mg/dL)

target_biomarker:
  key: "${biomarkerDef?.key || ''}"
  name: "${biomarkerDef?.name || ''}"
  current_value: "${currentValue || ''}"
  current_unit: "${biomarkerDef?.unit || ''}"
  current_range: "${biomarkerDef?.normalRange || ''}"
  description: "${biomarkerDef?.description || ''}"`;

    const systemInstruction = `identity:
  role: "Expert AI medical and nutritional assistant"
  purpose: "Review or answer questions about a specific user health biomarker."
  modes:
    1: "Educate and answer user questions regarding the biomarker."
    2: "Review logs for anomalies, unit mismatches, or demographic profile updates."

inputs:
${inputsJson}

rules:
  clinical_and_nutritional:
    - "Provide professional, evidence-based educational context regarding the target biomarker."
    - "CRITICAL: Review precisely the ranges from medical research or clinical guidelines before providing an answer. You must differentiate between 'normal but suboptimal' values, and distinguish nuances like a 'pre-condition' versus an 'actual condition', reflecting this back to the data and proposed range."
    - "Tailor the explanations and suggestions specifically to the user's demographic profile (age, gender, ethnicity, weight/height/BMI)."
    - "Explain physiological significance, potential dietary/lifestyle influences, and clinical pathways of the biomarker."
    - "If the profile shows a different ethnicity than standard (e.g. Chinese or Asian), prioritize demographic-specific clinical insights, guidelines, and reference intervals (e.g., Chinese Society of Hepatology/Nephrology/Diabetes/Dyslipidemia standard thresholds) FIRST over Western standard baselines."
    - "For example, if the user is of Chinese ethnicity, you MUST look at clinical guidelines for Chinese populations FIRST before even considering Western guidelines."
    - "Whenever you mention 'individuals of East Asian descent', 'Chinese descent', or refer to any specific ethnic group, you MUST explicitly cite the specific medical guideline or society you are using (e.g. 'according to the Chinese Society of Hepatology' or 'based on [medical guidelines from XX]')."
  metric_and_unit:
    - "Always prefer International Standard (mmol/L, mmol/mol) by default for lipids (LDL, HDL, Total Cholesterol, Triglycerides) and blood sugar (Fasting Glucose) unless the user specifically wants or has logged in US units (mg/dL)."
    - "Double-check that the metric/unit is consistent across the proposed value and the proposed normal range. Do NOT mix them up! (e.g., if LDL value is 5.7, the unit must be mmol/L and range should be under 3.0 mmol/L. If unit is mg/dL, the value is around 220 and range is 125-200)."
    - "Ensure the 'metric' field in any proposal exactly matches the unit used in 'range' and 'value'."
  proposals_and_corrections:
    - "If you recognize that the target biomarker's current description, medical insights, or range are wrong, incorrect, or sub-optimal for their demographic, prescribe a corrected/new one in the 'proposal' block of your response."
    - "If the newly proposed range or insight is specific to their ethnicity (e.g., Chinese-adjusted thresholds), set 'isEthnicitySpecific' to true and 'ethnicityTag' to the ethnicity name (e.g. 'Chinese' or 'Asian') so that the database can tag and override the biomarker dictionary correctly."
    - "If the newly proposed range is a standard global baseline, set 'isEthnicitySpecific' to false and 'ethnicityTag' to null."
  duplicate_recognition:
    - "Analyze if the target biomarker is likely a duplicate of another existing biomarker in the dictionary or in the related biomarkers list (e.g. 'hba1c_mmol_mol' vs 'hemoglobin_a1c')."
    - "If it is a duplicate, set 'isDuplicate' to true, list the synonymous key(s) in 'duplicateSuggestedKeys', and write a clear, concise note explaining why in 'duplicateExplanation'."
    - "If not a duplicate, set 'isDuplicate' to false, 'duplicateSuggestedKeys' to [], and 'duplicateExplanation' to null."
    - "When no correction, override, or duplicate is discussed or needed, set 'proposal' and 'pendingBiomarkers' to null."

output_format:
  type: "JSON"
  schema:
    reply: "Conversational, highly polished response explaining the biomarker, answering questions, or explaining proposed corrections/duplicates."
    proposal:
      name: "The biomarker name (e.g., 'Total Cholesterol')"
      metric: "The unit of measurement (e.g., 'mmol/L' or 'mg/dL')"
      value: "The corrected/proposed value as a number or string"
      date: "The exact date of the specific historical log being updated, if correcting a past entry (YYYY-MM-DD format). Use the user's logged date."
      range: "The normal/healthy range personalized to their profile (e.g., 'under 3.0 mmol/L' or '125-200 mg/dL')"
      description: "Short description of what this biomarker measures"
      benefitRisk: "Personalized benefit/risk statement based on the user's demographic profile and the proposed value"
      isEthnicitySpecific: true/false
      ethnicityTag: "e.g., 'Chinese' or 'Asian' or null"
      isDuplicate: true/false
      duplicateSuggestedKeys: ["array of synonymous keys to consolidate, e.g. ['hba1c_mmol_mol'] or []"]
      duplicateExplanation: "Reasoning for consolidation or null"
    pendingBiomarkers:
      "${biomarkerDef?.key || 'key'}": "The proposed value as a number (e.g., 5.7) or null"

instructions:
  - "Do not include markdown code block wrappers like \`\`\`json in your response. Return raw JSON."
  - "The JSON response must be well-formed and valid."`;

    const fullPromptSent = `System Instruction:\n${systemInstruction}\n\n${historyText}User Message: "${message}"`;

    const resultText = await callUnifiedLLM({
      modelId: modelId || "gemini-3.5-flash-lite",
      systemInstruction,
      promptText: `${historyText}User Message: "${message}"`,
      responseMimeType: "application/json",
    });

    let cleanedText = resultText.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    const startIdx = cleanedText.indexOf("{");
    if (startIdx !== -1) {
      let depth = 0;
      for (let i = startIdx; i < cleanedText.length; i++) {
        if (cleanedText[i] === "{") depth++;
        else if (cleanedText[i] === "}") depth--;
        if (depth === 0) {
          cleanedText = cleanedText.substring(startIdx, i + 1);
          break;
        }
      }
    }
    let resultJson;
    try {
      resultJson = JSON.parse(cleanedText);
    } catch (parseErr: any) {
      console.error("JSON Parse Error in review-biomarker:", parseErr);
      console.error("Raw response was:", resultText);
      throw new Error(`Failed to parse AI response as JSON. ${parseErr.message}`);
    }
    
    if (resultJson.proposedValue !== undefined && resultJson.proposedValue !== null && !resultJson.pendingBiomarkers) {
      resultJson.pendingBiomarkers = { [biomarkerDef?.key || 'key']: resultJson.proposedValue };
    }
    
    resultJson.agentPrompt = fullPromptSent;
    resultJson.apiCalls = [{ type: 'gemini', label: `Biomarker Calibration Agent (${engine || 'gemini-3.5-flash-lite'})` }];
    res.json(resultJson);
  } catch (err: any) {
    console.error("Gemini Review Error:", err);
    res.status(500).json({ error: err.message || "Failed to review biomarker" });
  }
});

medicalGeminiRouter.post("/api/gemini/insight-analyze", async (req, res) => {
  try {
    const { profile, userProfile, foodLogs, biomarkerHistory, engine, refinement } = req.body;
    const activeProfile = profile || userProfile || {};
    const email = activeProfile?.email?.toLowerCase() || "";

    if ((email === "chiwah.liu@gmail.com" || email === "cwah.liu@gmail.com" || email === "john@mail.com") && !refinement) {
      console.log(`[Insight] Triggered special preset recommendation report for: ${email}`);
      return res.json({
        report: {
          timestamp: new Date().toISOString(),
          dailyNutrientTargets: {
            calories: "1,700–1,800 kcal",
            protein: "90–100 g (protects kidneys)",
            totalFat: "55–65 g",
            saturatedFat: "under 15 g (critical for LDL)",
            unsaturatedFat: "35–45 g",
            omega3: "2.5–3 g",
            carbohydrates: "160–185 g (low GI)",
            addedSugar: "under 20 g",
            totalFibre: "35–40 g",
            solubleFibre: "10–15 g (critical for LDL)",
            sodium: "under 1,200 mg (kidney + BP protection)",
            potassium: "3,500–4,000 mg",
            magnesium: "400–420 mg",
            calcium: "1,000 mg",
            iron: "8 mg",
            zinc: "11 mg",
            selenium: "55 mcg",
            iodine: "150 mcg",
            phosphorus: "700 mg",
            vitaminD: "2,000 IU (East Asians commonly deficient)",
            vitaminB12: "2.4 mcg",
            folate: "400 mcg",
            vitaminC: "90 mg",
            vitaminE: "15 mg",
            vitaminK: "120 mcg",
            vitaminA: "900 mcg",
            vitaminB6: "1.7 mg",
            thiamine: "1.2 mg",
            riboflavin: "1.3 mg",
            niacin: "16 mg"
          },
          mostImportantNextStep: "See GP urgently about statin — rosuvastatin 5mg is the evidence-based starting point for East Asian men with your high LDL, HbA1c, and declining kidney filtration.",
          actions: [
            {
              id: "act_1",
              task: "Consult GP about Low-Dose Statin prescription (e.g. Rosuvastatin 5mg)",
              explanation: "Given your elevated LDL-C and East Asian genetics, a low-dose statin is the most evidence-based starting point.",
              priority: "high",
              completed: false,
              type: "doctor"
            },
            {
              id: "act_2",
              task: "Schedule an HbA1c retest in 3 months with formal pre-diabetes assessment",
              explanation: "Your average blood sugar over the last months is borderline. Tight monitoring is critical.",
              priority: "high",
              completed: false,
              type: "test"
            },
            {
              id: "act_3",
              task: "Establish an annual Kidney Monitoring and eGFR protection plan",
              explanation: "Declining eGFR needs early stage tracking. Restricting saturated fat and excessive sodium is non-negotiable.",
              priority: "high",
              completed: false,
              type: "test"
            },
            {
              id: "act_4",
              task: "Test Vitamin D levels with your physician",
              explanation: "East Asians are commonly deficient, which impacts metabolic health, blood pressure, and cardiovascular outcomes.",
              priority: "medium",
              completed: false,
              type: "test"
            },
            {
              id: "act_5",
              task: "Substitute butter, coconut oil, and ghee with extra virgin olive oil",
              explanation: "Reducing saturated fat to strictly under 15g a day is essential to restore proper LDL values.",
              priority: "high",
              completed: false,
              type: "lifestyle"
            }
          ],
          dailyBenefits: [
            { id: "ben_1", activity: "Accumulate 30 minutes of brisk walking or light cardio", target: "150 mins per week", completed: false },
            { id: "ben_2", activity: "Add 1 tablespoon of ground flaxseed to your meals", target: "Daily", completed: false },
            { id: "ben_3", activity: "Restrict Saturated Fat intake strictly under 15g", target: "Daily", completed: false },
            { id: "ben_4", activity: "Incorporate high soluble fibre (e.g. Oats, Psyllium husk)", target: "10-15g soluble", completed: false }
          ],
          latestInsights: [
            {
              title: "Cardiovascular Risk Reduction in East Asian Cohorts",
              summary: "Recent studies demonstrate that East Asian men exhibit heightened sensitivity to low-dose statin therapy, with rosuvastatin 5mg yielding similar LDL reduction as 10mg in western populations while minimizing hepatic and muscular side effects.",
              link: "https://pubmed.ncbi.nlm.nih.gov/32041285/"
            },
            {
              title: "Soluble Fibre and Bile Acid Sequestration Mechanics",
              summary: "Clinical trials confirm that consuming 10g of soluble fibre daily (via oats, barley, or psyllium husk) triggers hepatic bile synthesis from existing LDL, lowering circulating bad cholesterol particles by 5% to 10% within 8 weeks.",
              link: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4832151/"
            }
          ],
          healthRiskForecast: {
            year5: "Mildly progressive atherosclerosis, risk of transitioning from borderline pre-diabetes to active Type 2 Diabetes, and decline in renal filtration capacity to Stage 3 CKD.",
            year10: "Significant vascular plaque buildup. Kidney function might drop to GFR < 60, triggering high blood pressure. Elevated Risk of cardiovascular events.",
            year20: "40% probability of a coronary event. Accelerated kidney wear requiring complex nephrological intervention.",
            optimized5: "Restored LDL < 100 mg/dL, stabilized blood sugar in normal ranges, and kidney filtration preserved at healthy levels.",
            optimized10: "Plaque progression halted. Fully functional cardiovascular system and kidney values stabilized in the safe green zone.",
            optimized20: "Optimal cardiovascular performance. Healthy aging index score 95th percentile, active longevity with zero diabetic or renal complications."
          }
        }
      });
    }

    const ai = getGeminiClient();
    const apiKey = getGeminiApiKey();
    if (!apiKey || apiKey === "MOCK_KEY" || apiKey.startsWith("YOUR_")) {
      return res.json({
        report: {
          timestamp: new Date().toISOString(),
          dailyNutrientTargets: {
            calories: "1,500–1,600 kcal",
            protein: "80–90 g",
            totalFat: "50–60 g",
            saturatedFat: "under 12 g",
            unsaturatedFat: "30–40 g",
            omega3: "2.0–2.5 g",
            carbohydrates: "150–170 g",
            addedSugar: "under 15 g",
            totalFibre: "30–35 g",
            solubleFibre: "8–12 g",
            sodium: "under 1,500 mg",
            potassium: "3,500 mg",
            magnesium: "400 mg",
            calcium: "1,000 mg",
            iron: "8 mg",
            zinc: "11 mg",
            selenium: "55 mcg",
            iodine: "150 mcg",
            phosphorus: "700 mg",
            vitaminD: "2,000 IU",
            vitaminB12: "2.4 mcg",
            folate: "400 mcg",
            vitaminC: "90 mg",
            vitaminE: "15 mg",
            vitaminK: "120 mcg",
            vitaminA: "900 mcg",
            vitaminB6: "1.7 mg",
            thiamine: "1.2 mg",
            riboflavin: "1.3 mg",
            niacin: "16 mg"
          },
          mostImportantNextStep: "Reduce saturated fat strictly to under 12g per day and complete a clinical blood re-test in 3 months to monitor cholesterol and glucose trends.",
          actions: [
            {
              id: "act_1",
              task: "Consult your primary care physician for a comprehensive health screening",
              explanation: "Based on your age and profile, regular annual biometric reviews are highly recommended.",
              priority: "high",
              completed: false,
              type: "doctor"
            },
            {
              id: "act_2",
              task: "Check your HbA1c and lipid panel every 6 months",
              explanation: "Routine blood metrics tracking will help confirm your lifestyle changes are successfully restoring biomarkers.",
              priority: "high",
              completed: false,
              type: "test"
            }
          ],
          dailyBenefits: [
            { id: "ben_1", activity: "Walk briskly for 30 minutes daily to boost metabolic health", target: "Daily", completed: false },
            { id: "ben_2", activity: "Substitute saturated fats with cold-pressed olive oil", target: "Daily", completed: false }
          ],
          latestInsights: [
            {
              title: "Dietary Fibers and Metabolic Longevity Indices",
              summary: "A high-fiber nutritional plan is linked to enhanced short-chain fatty acid gut synthesis, which improves overall insulin response and naturally reduces vascular inflammation markers.",
              link: "https://pubmed.ncbi.nlm.nih.gov/30612722/"
            }
          ],
          healthRiskForecast: {
            year5: "Slight vascular stiffness and mild risk of elevated glucose tolerance if sedentary habits persist.",
            year10: "Increasing risk of metabolic decline and minor cardiovascular strain.",
            year20: "Elevated probability of cardiovascular plaques and reduced active energy index.",
            optimized5: "Pristine blood pressure levels, balanced lipid particles, and metabolic health completely optimized.",
            optimized10: "Robust vascular health, optimized glycemic control, and ideal weight targets maintained.",
            optimized20: "Healthy aging with minimal chronic disease probability and vibrant metabolic index."
          }
        }
      });
    }

    const sanitizedBiomarkerHistory = filterHistoryForUse(biomarkerHistory, activeProfile).map((log: any) => {
      const clean = { ...log };
      delete clean.tests;
      delete clean.updated_at;
      delete clean.sync_state;
      delete clean.note;
      delete clean.summary;
      delete clean.id;
      return clean;
    }).filter((log: any) => {
      if (log.biomarkers && Object.keys(log.biomarkers).length === 1 && log.biomarkers.steps !== undefined) {
        return false;
      }
      return true;
    });

    const riskGroupings: Record<string, string[]> = {};
    sanitizedBiomarkerHistory.forEach((log: any) => {
      if (log.biomarkers) {
        Object.keys(log.biomarkers).forEach(key => {
          if (key === 'steps') return;
          const def = biomarkerDefinitions.find(d => d.key === key);
          const customDef = activeProfile?.customBiomarkers?.[key];
          let risks = customDef?.riskCategories || def?.riskCategories || ['Uncategorized'];
          if (!Array.isArray(risks)) risks = [risks];
          if (risks.length === 0) risks = ['Uncategorized'];
          
          risks.forEach((risk: string) => {
            if (!riskGroupings[risk]) riskGroupings[risk] = [];
            if (!riskGroupings[risk].includes(key)) riskGroupings[risk].push(key);
          });
        });
      }
    });

    const profileText = `UserProfile: Age ${activeProfile.age}, Ethnicity: ${activeProfile.ethnicity}, Weight: ${activeProfile.weight}kg, Height: ${activeProfile.height}cm, Email: ${activeProfile.email}.`;
    const foodSummary = foodLogs && foodLogs.length > 0 ? `Recent Food Logs:\n${JSON.stringify(foodLogs.slice(-10))}` : "No food logs registered.";
    const biomarkerSummary = sanitizedBiomarkerHistory.length > 0 ? `Biomarker Logs:\n${JSON.stringify(sanitizedBiomarkerHistory)}\n\nUser's Logged Biomarkers Grouped by Risk Categories:\n${JSON.stringify(riskGroupings)}` : "No medical biomarkers logged.";

    const promptText = `Perform a comprehensive health profiling analysis using the totality of user information provided below.
    ${profileText}
    ${foodSummary}
    ${biomarkerSummary}
    ${refinement ? `\nUSER REFINEMENT REQUEST: The user has asked to refine the previous analysis. Please adjust the report considering this feedback: "${refinement.message}". Also consider this chat history: ${JSON.stringify(refinement.chatHistory)}` : ""}
    
    You need to look at all health indices and build a personalized health report.
    Identify any critical parameters (such as elevated LDL, high HbA1c, or low eGFR) and set custom daily nutrition targets for all 30 nutrients, prioritize clinical actions, lifestyle benefits, latest medical insights, and risk forecasts over 5, 10, and 20 years with vs without modifications.
    
    Respond strictly with a JSON object conforming exactly to this structure:
    {
      "report": {
        "timestamp": "ISO Date String",
        "dailyNutrientTargets": {
          "calories": "target string (e.g. 1,700-1,800 kcal)",
          "protein": "target string",
          "totalFat": "target string",
          "saturatedFat": "target string (e.g. under 15 g)",
          "unsaturatedFat": "target string",
          "omega3": "target string",
          "carbohydrates": "target string",
          "addedSugar": "target string",
          "totalFibre": "target string",
          "solubleFibre": "target string",
          "sodium": "target string",
          "potassium": "target string",
          "magnesium": "target string",
          "calcium": "target string",
          "iron": "target string",
          "zinc": "target string",
          "selenium": "target string",
          "iodine": "target string",
          "phosphorus": "target string",
          "vitaminD": "target string",
          "vitaminB12": "target string",
          "folate": "target string",
          "vitaminC": "target string",
          "vitaminE": "target string",
          "vitaminK": "target string",
          "vitaminA": "target string",
          "vitaminB6": "target string",
          "thiamine": "target string",
          "riboflavin": "target string",
          "niacin": "target string"
        },
        "mostImportantNextStep": "Specific human-focused non-negotiable step",
        "actions": [
          {
            "id": "unique string id",
            "task": "clinical or screening task",
            "explanation": "why this is important for their profile",
            "priority": "high" | "medium" | "low",
            "completed": false,
            "type": "doctor" | "test" | "lifestyle"
          }
        ],
        "dailyBenefits": [
          {
            "id": "unique string id",
            "activity": "e.g. Walk 30 min",
            "target": "e.g. Daily",
            "completed": false
          }
        ],
        "latestInsights": [
          {
            "title": "Vascular Plaque Progression Control",
            "summary": "1-2 sentence clinical takeaway",
            "link": "https://pubmed.ncbi.nlm.nih.gov/..."
          }
        ],
        "healthRiskForecast": {
          "year5": "Detailed text forecast of health risk if habits do not change",
          "year10": "Detailed text forecast of health risk if habits do not change",
          "year20": "Detailed text forecast of health risk if habits do not change",
          "optimized5": "Detailed text forecast of benefits if targets are optimized",
          "optimized10": "Detailed text forecast of benefits if targets are optimized",
          "optimized20": "Detailed text forecast of benefits if targets are optimized"
        }
      }
    }`;

    const systemInstruction = "You are an evidence-based, pragmatic health coach and behavioral nutritionist. Your goal is to translate complex health and longevity science into sustainable, low-friction daily habits for a general audience. Prioritize mental well-being, intuitive eating principles, and practical lifestyle adjustments over hyper-optimized biometric tracking. Avoid prescribing exact macronutrient or micronutrient numbers unless explicitly requested; instead, focus on food quality, portion awareness, and sustainable, realistic routines. Your response must be an exact single JSON matching the requested schema. Never add markdown wrappers.";
    const fullPromptSent = `System Instruction:\n${systemInstruction}\n\n${promptText}`;

    const textOutput = await callUnifiedLLM({
      modelId: (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite",
      systemInstruction,
      promptText,
      responseMimeType: "application/json",
      logStagePrefix: "health_coach"
    });

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    let parsedData = await asyncParseLLMJSON(cleanJson);

    parsedData.agentPrompt = `System Instruction:\nYou are a world-class AI dietitian. Your response must be an exact JSON matching the requested schema. Never add markdown wrappers.\n\n${promptText}`;
    res.json({
      ...parsedData,
      apiCalls: [{ type: 'gemini', label: `Biomarker Insight Agent (${engine || 'gemini-3.5-flash-lite'})` }]
    });
  } catch (error: any) {
    console.error("[Insight Analyze Error]:", error);
    res.status(500).json({ error: "Failed to generate preventative recommendations: " + error.message });
  }
});

const healthBaselineAnalyzeSchema = {
  type: Type.OBJECT,
  properties: {
    report: {
      type: Type.OBJECT,
      properties: {
        timelineToOptimal: {
          type: Type.STRING,
          description: "The overall hard physiological timeline paired with user-perception benchmarks (e.g., sleep depth, waist trimming, puffiness reduction)."
        },
        riskCategories: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              categoryName: { type: Type.STRING },
              level: { type: Type.STRING, enum: ["Low", "Moderate", "Elevated", "High"] },
              targetTrajectory: {
                type: Type.STRING,
                description: "Explains the concrete physical value of getting these specific biomarkers to target, what physical signs will improve, and the timeline speed for this specific category."
              },
              nutrientTargets: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    nutrientKey: { type: Type.STRING },
                    targetValue: { type: Type.STRING, description: "Must be a direct computed amount (e.g., '90g' or '< 20g'), NOT a formula like '1.2g per kg of body weight'." },
                    rationale: { 
                      type: Type.STRING, 
                      description: "Mechanistic and precise explanation of why this target/amount was chosen. Put dietary advice like 'Incorporate 30 grams of viscous psyllium or oat-based soluble fiber daily' in this rationale or in the overall category."
                    }
                  },
                  required: ["nutrientKey", "targetValue", "rationale"]
                }
              },
              dailyActivities: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    activity: { type: Type.STRING },
                    target: { type: Type.STRING }
                  },
                  required: ["activity", "target"]
                },
                description: "Precise, time-bound behavioral or physical rules to implement daily. Must be things the user can realistically do every single day (e.g. 'activity: Walk, target: 10,000 steps', 'activity: Meditate, target: 10 mins'). Do NOT include dietary nutrient recommendations here (like fiber or protein intake) or infrequent/unrealistic daily activities (like cooking with specific oils every day)."
              }
            },
            required: ["categoryName", "level", "targetTrajectory", "nutrientTargets", "dailyActivities"]
          }
        },
        topNutrientTargets: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              nutrientKey: { type: Type.STRING },
              targetValue: { type: Type.STRING },
              rationale: { type: Type.STRING }
            },
            required: ["nutrientKey", "targetValue", "rationale"]
          },
          description: "Top 3-6 core nutrients that the user has to focus the most on and that will have the biggest impact for the user life. Impact needs to be considered in term of health risk, such as cardiovascular risk from sat fat is much more important than a risk of not having enough fiber."
        },
        topWeeklyNutrientTargets: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              nutrientKey: { type: Type.STRING },
              targetValue: { type: Type.STRING },
              rationale: { type: Type.STRING }
            },
            required: ["nutrientKey", "targetValue", "rationale"]
          },
          description: "Top 3-6 additional/micronutrients that the user has to focus the most on and that will have the biggest impact for the user life."
        },
        generalNutrientTargets: {
          type: Type.OBJECT,
          description: "A flat map containing all 31 available nutrient keys populated with precise formatted values.",
          properties: {
            calories: { type: Type.STRING },
            totalFat: { type: Type.STRING },
            solubleFibre: { type: Type.STRING },
            saturatedFat: { type: Type.STRING },
            protein: { type: Type.STRING },
            potassium: { type: Type.STRING },
            transFat: { type: Type.STRING },
            addedSugar: { type: Type.STRING },
            carbohydrates: { type: Type.STRING },
            totalFibre: { type: Type.STRING },
            sodium: { type: Type.STRING },
            unsaturatedFat: { type: Type.STRING },
            omega3: { type: Type.STRING },
            magnesium: { type: Type.STRING },
            calcium: { type: Type.STRING },
            iron: { type: Type.STRING },
            zinc: { type: Type.STRING },
            selenium: { type: Type.STRING },
            iodine: { type: Type.STRING },
            phosphorus: { type: Type.STRING },
            vitaminD: { type: Type.STRING },
            vitaminB12: { type: Type.STRING },
            folate: { type: Type.STRING },
            vitaminC: { type: Type.STRING },
            vitaminE: { type: Type.STRING },
            vitaminK: { type: Type.STRING },
            vitaminA: { type: Type.STRING },
            vitaminB6: { type: Type.STRING },
            thiamine: { type: Type.STRING },
            riboflavin: { type: Type.STRING },
            niacin: { type: Type.STRING }
          },
          required: [
            "calories", "totalFat", "solubleFibre", "saturatedFat", "protein", "potassium", "transFat", "addedSugar", "carbohydrates", "totalFibre", "sodium",
            "unsaturatedFat", "omega3", "magnesium", "calcium", "iron", "zinc", "selenium", "iodine", "phosphorus", "vitaminD", "vitaminB12", "folate", "vitaminC", "vitaminE", "vitaminK", "vitaminA", "vitaminB6", "thiamine", "riboflavin", "niacin"
          ]
        }
      },
      required: ["timelineToOptimal", "riskCategories", "topNutrientTargets", "topWeeklyNutrientTargets", "generalNutrientTargets"]
    }
  },
  required: ["report"]
};

medicalGeminiRouter.post("/api/gemini/health-baseline-analyze", async (req, res) => {
  try {
    const isStream = req.query.stream === "true";
    if (isStream) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
    }

    // Debug-log instrumentation: every other Gemini route (medical-analyze,
    // food-analyze) reports its dispatched instruction/prompt/response through
    // this same `type: 'log'` SSE channel, which serverJobs.ts collects into
    // the job's backendLogs. This route never did, which is why Health Coach
    // debug exports came back with an empty "Backend Execution Logs" section
    // even when the analysis itself succeeded.
    const sendLog = (logType: string, messageText: string) => {
      if (isStream) {
        try {
          res.write(`data: ${JSON.stringify({ type: 'log', logType, message: messageText, timestamp: Date.now() })}\n\n`);
        } catch (e) {}
      }
    };

    const { profile, userProfile, biomarkerHistory, engine, refinement, calibratedInsights, outOfRangeBiomarkers } = req.body;
    const activeProfile = profile || userProfile || {};

    const sanitizedBiomarkerHistory = filterHistoryForUse(biomarkerHistory, activeProfile).map((log: any) => {
      const clean = { ...log };
      delete clean.tests;
      delete clean.updated_at;
      delete clean.sync_state;
      delete clean.note;
      delete clean.summary;
      delete clean.id;
      return clean;
    });

    const riskGroupingsWithSeverity: Record<string, string[]> = {};
    const biomarkerHistories: Record<string, {date: string, val: any}[]> = {};
    
    // Sort by date descending so first seen is latest
    const parseDateStr = (dStr: string) => {
      if (!dStr) return 0;
      const parts = dStr.split('-');
      if (parts.length === 3) {
        if (parts[0].length === 4) return new Date(dStr).getTime();
        return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`).getTime();
      }
      return new Date(dStr).getTime();
    };

    const sortedHistory = [...sanitizedBiomarkerHistory].sort((a, b) => {
      return parseDateStr(b.date) - parseDateStr(a.date);
    });
    
    sortedHistory.forEach((log: any) => {
      if (log.biomarkers) {
        Object.keys(log.biomarkers).forEach(key => {
          if (!biomarkerHistories[key]) biomarkerHistories[key] = [];
          if (biomarkerHistories[key].length < 5) {
            biomarkerHistories[key].push({ date: log.date, val: log.biomarkers[key] });
          }
        });
      }
    });

    const normalBiomarkers: string[] = [];
    const flaggedBiomarkers: string[] = [];
    
    Object.keys(biomarkerHistories).forEach(key => {
      // 1. Check if the biomarker is explicitly marked as "not used"
      const isNotUsed = (activeProfile?.notUsedBiomarkers && (
        activeProfile.notUsedBiomarkers[key] || 
        Object.keys(activeProfile.notUsedBiomarkers).some(nok => nok.toLowerCase() === key.toLowerCase())
      )) || (activeProfile?.notUsedInMedicalHistory && (
        activeProfile.notUsedInMedicalHistory[key] ||
        Object.keys(activeProfile.notUsedInMedicalHistory).some(nok => nok.toLowerCase() === key.toLowerCase())
      ));
      if (isNotUsed) return;

      const history = biomarkerHistories[key];
      const latestVal = history[0].val;
      const historyStr = history.map(h => `\n       - ${h.date}: ${h.val}`).join('');
      
      const outOfRangeDef = (outOfRangeBiomarkers || []).find((b: any) => b.key === key);
      const isFlagged = outOfRangeDef?.status === 'flagged';
      
      const customDef = getCustomBiomarkerDef(activeProfile, key);
      const def = biomarkerDefinitions.find(d => d.key === key);
      
      const mergedDef = { ...def, ...customDef };
      const formattedOpt = formatOptimalTargetValue(mergedDef);
      
      let idealStr = "";
      if (formattedOpt) {
        idealStr = ` (Optimal value ${formattedOpt})`;
      } else if (mergedDef.normalRange) {
        idealStr = ` (Optimal value ${mergedDef.normalRange})`;
      }

      if (isFlagged) {
        flaggedBiomarkers.push(`${key} (History: ${history.map(h => `${h.date}: ${h.val}`).join(', ')})`);
      } else if (outOfRangeDef) {
        const statusLabel = getBiomarkerStatusLabel(key, outOfRangeDef.status, customDef, latestVal, activeProfile);
        const calibrated = calibratedInsights?.[key];
        const dynamicInsight = def ? generateDynamicInsight(def, activeProfile, outOfRangeDef.value, outOfRangeDef.status) : undefined;
        const medicalInsight = dynamicInsight || calibrated?.specificRiskContext || calibrated?.description || customDef?.specificRiskContext || customDef?.description || customDef?.benefitRisk || def?.benefitRisk;
        
        let medicalInsightStr = "";
        if (medicalInsight && medicalInsight !== "No specific medical insight defined.") {
          medicalInsightStr = `\n     Medical Insight: ${medicalInsight}`;
        }

        const meta = getBiomarkerMetadata(key, customDef);
        // Map strictly to the most relevant single category
        const primaryRisk = meta.riskCategories && meta.riskCategories.length > 0 ? meta.riskCategories[0] : 'Systemic/General';
        
        const calibSource = customDef?.calibrationSource ? ` (Calibrated to: ${customDef.calibrationSource})` : "";
        
        if (!riskGroupingsWithSeverity[primaryRisk]) riskGroupingsWithSeverity[primaryRisk] = [];
        riskGroupingsWithSeverity[primaryRisk].push(`${key} (Status: ${statusLabel})${calibSource}${idealStr}${historyStr}${medicalInsightStr}`);
      } else {
        normalBiomarkers.push(`${key}: ${latestVal}${idealStr}`);
      }
    });

    let groupedRisksStr = "";
    if (Object.keys(riskGroupingsWithSeverity).length > 0) {
      groupedRisksStr = "Biomarkers at risk:\n";
      Object.keys(riskGroupingsWithSeverity).forEach(risk => {
        groupedRisksStr += `\n[${risk}]\n`;
        riskGroupingsWithSeverity[risk].forEach(line => {
          groupedRisksStr += `  - ${line}\n`;
        });
      });
    }

    let flaggedStr = "";
    if (flaggedBiomarkers.length > 0) {
      flaggedStr = `\n\n[FLAGGED / UNRESOLVED TELEMETRY ERRORS (EXCLUDED FROM CLINICAL ANALYSIS)]\n` +
        flaggedBiomarkers.map(f => `  - ${f}`).join('\n') +
        `\n  Note: The entries above contain scaling/unit/notation shifts (e.g. 48 vs 0.48 or 3). Do NOT calculate targets or risk categories for them. Instruct the user to fix these log entries in Medical History or via the Data Review Agent.`;
    }

    const biomarkerSummary = Object.keys(biomarkerHistories).length > 0 ? 
      `${groupedRisksStr}${flaggedStr}\n\nNormal/Uncategorized Biomarkers:\n${normalBiomarkers.join('\n')}` : 
      "No medical biomarkers logged.";

    const profileText = `UserProfile: Age ${activeProfile.age || 'Not provided'}, Ethnicity: ${activeProfile.ethnicity || 'Not provided'}, Weight: ${activeProfile.weight || 'Not provided'}kg, Height: ${activeProfile.height || 'Not provided'}cm, Gender: ${activeProfile.gender || 'Not provided'}, Blood Type: ${activeProfile.bloodType || 'Not provided'}.`;

    const promptText = `Perform a comprehensive health baseline analysis using the totality of user information provided below. 

${profileText}
${biomarkerSummary}

=== AVAILABLE NUTRIENT KEYS ===
Core Nutrients: calories, totalFat, solubleFibre, saturatedFat, protein, potassium, transFat, addedSugar, carbohydrates, totalFibre, sodium
Additional Nutrients: unsaturatedFat, omega3, magnesium, calcium, iron, zinc, selenium, iodine, phosphorus, vitaminD, vitaminB12, folate, vitaminC, vitaminE, vitaminK, vitaminA, vitaminB6, thiamine, riboflavin, niacin

=== ZERO-REDUNDANCY LAW ===
1. **Single-Source Information:** Every clinical insight, priority nutrient rationale, or protocol must exist in exactly ONE location within the JSON payload.
2. **Scrap Global Lists:** Do not generate trailing summary bullet points, master nutrient lists, or global action plan texts at the base of the document. Embed every high-leverage nutrient explanation cleanly and exclusively within its corresponding clinical category block.
3. **No Echoing:** Do not create separate arrays or blocks to echo raw baseline biomarker numbers or target thresholds that the user interface already knows. Focus entirely on synthesis, strategy, and biological trends.
4. **Prioritize Top Nutrients:** You must pick what are the top 3-6 nutrients that the user has to focus the most on and that will have the biggest impact for the user life. Impact needs to be considered in term of health risk, such as cardiovascular risk from sat fat is much more important than a risk of not having enough fiber. Output these in the topNutrientTargets and topWeeklyNutrientTargets arrays.

=== TARGET PRECISION ===
All values across the entire payload — including \`nutrientTargets[].targetValue\` and \`generalNutrientTargets\` — MUST carry formatting operators (<, >, <=, >=, or range -) and appropriate units. For zero-baseline symptom scores or indices, express targets as "< 1" or "<= 0".`;

    const systemInstruction = `1. Core Persona & Tone Law
Objective Clinical Authority: You are an objective, data-first clinical analyst. Avoid casual, chatty, or overly familiar health-coach language.
Anti-Gimmick Rule: Do not write retrospective, hyper-specific diary callouts (e.g., "I see you ate a salad on Tuesday" or "Avoid the pizza you had yesterday"). This feels artificial and out of touch. Address the long-term, overarching metabolic and physiological trends of the entire profile.

2. User Perception & Symptom Mapping Instruction
Tangible Prognosis: When defining timelines and target trajectories, translate internal blood chemistry shifts into concrete, real-world physical changes the user can physically feel and observe.
Symptom Linkage:
- Link Visceral Adiposity/BMI reduction directly to visible waistline trimming, reduced internal airway pressure, deeper sleep, and decreased snoring.
- Link eGFR and Fluid Balance optimization directly to the clearance of chronic, subtle morning fluid retention (such as facial or ankle puffiness) and increased physical freshness.
- Link Lipid and Cardiovascular optimization directly to unburdened physical stamina, easier recovery, and preserved endurance during standard daily physical tasks.

3. Nutrient Target Precision & Rate of Progress
Commitment Definitions: For dynamic macro-levers (e.g., calories), do not just provide an absolute number. You must explicitly calculate and state the exact biological pace inside the rationale. Specify a gentle, sustainable energy deficit (e.g., ~250 kcal/day) targeting a safe, permanent weight loss velocity (e.g., 0.25 kg per week) over a 12-month horizon to fully protect skeletal muscle mass.
Mechanistic Clarity: Explain precisely how a nutrient target shifts a biomarker (e.g., explaining that restricting saturated fat downregulates hepatic cholesterol production by withholding raw materials, or that soluble fiber binds intestinal bile acids to force excretion).

4. The 31-Nutrient Mechanism & Overrides
Deterministic Baselines: You MUST fully populate the generalNutrientTargets map with ALL 31 available nutrient keys. NEVER leave it empty. For each of the 31 nutrients, compute and provide the EXACT direct amount (e.g., "90g" or "< 20g"), NOT a formula (e.g., do NOT say "1.2g per kg of body weight"). You have the user's weight, so do the math and output the final absolute number. For the 15 static micronutrients (vitaminA, vitaminC, vitaminD, vitaminE, vitaminK, vitaminB12, vitaminB6, thiamine, riboflavin, niacin, folate, zinc, selenium, iodine, magnesium), output standard, medically accepted Age/Gender RDAs.
Clinical Escape Hatch: You MUST dynamically alter or override these static baselines if a specific out-of-range clinical biomarker demands it.

CRITICAL DATA INTEGRITY LAW: You MUST NOT create clinical risk categories, target values, or dietary interventions for any biomarker listed under [FLAGGED / UNRESOLVED TELEMETRY ERRORS]. Ignore flagged data and focus exclusively on valid clinical biometrics.

Your response must be exactly one JSON object matching the requested schema. Never add markdown wrappers outside the JSON.`;

    sendLog('status', 'Analyzing health profile...');
    sendLog('backend', `[Health Baseline Agent] Dispatched System Instruction (Length: ${systemInstruction.length})`);
    sendLog('backend', `[Health Baseline Agent] Dispatched Prompt:\n${promptText}`);

    const textOutput = await callUnifiedLLM({
      modelId: (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite",
      systemInstruction,
      promptText,
      responseMimeType: "application/json",
      responseSchema: healthBaselineAnalyzeSchema,
      skipThoughtInjection: true,
      logStagePrefix: "health_coach",
      onStream: isStream ? (chunk: string, isThought?: boolean) => {
        if (isThought) {
          res.write(`data: ${JSON.stringify({ type: 'stream', thought: chunk, stage: 'health_coach' })}\n\n`);
        } else {
          res.write(`data: ${JSON.stringify({ type: 'stream', chunk, stage: 'health_coach' })}\n\n`);
        }
      } : undefined
    });

    sendLog('backend', `[Health Baseline Agent] Response received (${textOutput?.length || 0} chars). Raw output:\n${textOutput}`);
    sendLog('status', 'Response received, finalizing...');

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    cleanJson = cleanJson.replace(/,\s*([}\]])/g, "$1");

    let parsedData;
    try {
      parsedData = JSON.parse(cleanJson);
    } catch (parseErr) {
      try {
        const firstBrace = cleanJson.indexOf("{");
        const lastBrace = cleanJson.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          parsedData = await asyncParseLLMJSON(cleanJson);
        } else {
          throw parseErr;
        }
      } catch (innerErr) {
        console.error("[Health Baseline JSON Parse Error]:", innerErr, "\nTruncated Output:", textOutput.substring(textOutput.length - 200));
        throw innerErr;
      }
    }

    
    
    // Sanitize any bare target values in nutrientTargets
    if (parsedData?.report?.riskCategories && Array.isArray(parsedData.report.riskCategories)) {
      parsedData.report.riskCategories.forEach((cat: any) => {
        if (Array.isArray(cat.nutrientTargets)) {
          cat.nutrientTargets.forEach((nt: any) => {
            if (nt.targetValue) {
              const tv = String(nt.targetValue).trim();
              if (tv === "0") {
                nt.targetValue = "< 1g";
              }
            }
          });
        }
      });
    }

    // Ensure generalNutrientTargets is fully populated with formatted keys
    const DEFAULT_GENERAL_NUTRIENT_TARGETS: Record<string, string> = {
      calories: "2000kcal - 2200kcal",
      protein: "> 70g",
      totalFat: "50g - 70g",
      saturatedFat: "< 15g",
      transFat: "< 0g",
      unsaturatedFat: "> 35g",
      omega3: "> 1.6g",
      carbohydrates: "130g - 250g",
      addedSugar: "< 25g",
      totalFibre: "> 30g",
      solubleFibre: "> 10g",
      sodium: "< 2000mg",
      potassium: "> 3400mg",
      magnesium: "> 400mg",
      calcium: "> 1000mg",
      iron: "> 8mg",
      zinc: "> 11mg",
      selenium: "> 55mcg",
      iodine: "> 150mcg",
      phosphorus: "> 700mg",
      vitaminD: "> 1000IU",
      vitaminB12: "> 2.4mcg",
      folate: "> 400mcg",
      vitaminC: "> 90mg",
      vitaminE: "> 15mg",
      vitaminK: "> 120mcg",
      vitaminA: "> 900mcg",
      vitaminB6: "> 1.7mg",
      thiamine: "> 1.2mg",
      riboflavin: "> 1.3mg",
      niacin: "> 16mg"
    };

    if (parsedData?.report) {
      if (!parsedData.report.generalNutrientTargets || typeof parsedData.report.generalNutrientTargets !== 'object') {
        parsedData.report.generalNutrientTargets = {};
      }
      const ceilings = new Set(['saturatedFat', 'transFat', 'addedSugar', 'sodium']);
      Object.keys(DEFAULT_GENERAL_NUTRIENT_TARGETS).forEach((key) => {
        let val = parsedData.report.generalNutrientTargets[key];
        if (!val || typeof val !== 'string' || val.trim() === '') {
          parsedData.report.generalNutrientTargets[key] = DEFAULT_GENERAL_NUTRIENT_TARGETS[key];
        } else {
          let valStr = String(val).trim();
          if (valStr === "0" || valStr === "0g" || valStr === "0mg") {
            valStr = ceilings.has(key) ? "< 1g" : "> 1g";
          } else if (!/[<>=\-]/.test(valStr)) {
            if (ceilings.has(key)) {
              valStr = `< ${valStr}`;
            } else {
              valStr = `> ${valStr}`;
            }
          }
          parsedData.report.generalNutrientTargets[key] = valStr;
        }
      });
    }

    parsedData.agentPrompt = `System Instruction:\n${systemInstruction}\n\n${promptText}`;
    
    if (isStream) {
      res.write(`data: ${JSON.stringify({ final: true, result: {
        ...parsedData,
        apiCalls: [{ type: 'gemini', label: `Health Baseline Agent (${engine || 'gemini-3.5-flash-lite'})` }]
      } })}\n\n`);
      res.end();
    } else {
      res.json({
        ...parsedData,
        apiCalls: [{ type: 'gemini', label: `Health Baseline Agent (${engine || 'gemini-3.5-flash-lite'})` }]
      });
    }
  } catch (error: any) {
    console.error("[Health Baseline Analyze Error]:", error);
    if (res.headersSent) {
      try {
        res.write(`data: ${JSON.stringify({ type: 'log', logType: 'error', message: `[Health Baseline Agent] Error: ${error.message}`, timestamp: Date.now() })}\n\n`);
      } catch (e) {}
      res.write(`data: ${JSON.stringify({ error: "Failed to generate health baseline: " + error.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: "Failed to generate health baseline: " + error.message });
    }
  }
});

const RouteAgentOutputSchema = z.object({
  _internalReasoning: z.string().nullable().optional(),
  selectedAgent: z.string(),
  reasoning: z.string().nullable().optional(),
  targetDbId: z.string().nullable().optional()
});

medicalGeminiRouter.post("/api/gemini/route-biomarker"
, async (req, res) => {
  try {
    const { message, engine, context } = req.body;
    const modelId = (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite";

    const systemInstruction = `You are the RouteAgent, an intelligent health data and clinical router.
Your job is to parse the user request, analyze any context, and route the user to the most appropriate specialized health agent.

Available agents:
- 'agent1': Clinical Calibration Agent (For terminology mapping & standardizing clinical terms)
- 'agent2': Clinical Assessment Agent (For adding standard groupings & risk categories)
- 'agent3': Clinical Harmonization Agent (For terminology consolidation & assembly into buckets)
- 'agent4': Health Planning Agent (For retest timelines, auditing test errors, and finding short/long term gaps)
- 'agent5': Holistic Review Agent (For broad health & demographics-aware insights)
- 'agent7': Health Report Agent (For final cohesive formatted health report generation)
- 'front_desk': Health Preparation Agent (For general health questions, logging biomarkers & profile updates)
- 'health_baseline': Health Coach (For evidence-based, sustainable food & coaching habits)

You MUST respond with a JSON object containing:
{
  "_internalReasoning": "Your step-by-step thinking.",
  "selectedAgent": "The ID of the chosen agent (e.g. 'agent4', 'front_desk', 'health_baseline')",
  "reasoning": "A concise explanation of why this agent was selected.",
  "targetDbId": null // Optional target database ID or key if applicable
}`;

    const promptText = `User Message: "${message || ''}"\nContext: ${JSON.stringify(context || {})}`;

    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction,
      promptText,
      responseMimeType: "application/json",
      logStagePrefix: 'route_biomarker',
    });

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    let parsed: any;
    try {
      parsed = JSON.parse(cleanJson);
    } catch (err: any) {
      const firstBrace = cleanJson.indexOf("{");
      const lastBrace = cleanJson.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        parsed = await asyncParseLLMJSON(cleanJson);
      } else {
        throw err;
      }
    }

    const validation = RouteAgentOutputSchema.safeParse(parsed);
    if (!validation.success) {
      addDebugLog(`[Zod Validation Failed] RouteAgent response validation failed: ${validation.error.message}. Raw: ${textOutput}`);
      // Gracefully fall back to the default agent route
      res.json({
        _internalReasoning: "Fallback active due to validation failure",
        selectedAgent: "front_desk",
        reasoning: "Graceful fallback to default agent route (front_desk).",
        targetDbId: null
      });
      return;
    }

    res.json(validation.data);
  } catch (error: any) {
    addDebugLog(`[RouteAgent Error] routing failed: ${error.message}`);
    // Gracefully fall back to the default agent route
    res.json({
      _internalReasoning: "Fallback active due to exception: " + error.message,
      selectedAgent: "front_desk",
      reasoning: "Graceful fallback to default agent route (front_desk) on error.",
      targetDbId: null
    });
  }
});

medicalGeminiRouter.post("/api/gemini/route-chat", async (req, res) => {
  try {
    const { messages, selectedBiomarkers, allApprovedKeys } = req.body;
    const approvedList: string[] = Array.isArray(allApprovedKeys) ? allApprovedKeys : [];
    const suggestedMapping: Record<string, string> = {};

    const normalize = (str: string) => (str || '').toLowerCase().replace(/[^a-z0-9]/g, '');

    // Deterministic rule & synonym matcher without LLM overhead
    (selectedBiomarkers || []).forEach((b: any) => {
      const originalKey = b.key || b.originalKey || b.name || '';
      const normOrig = normalize(originalKey);
      if (!normOrig) return;

      // 1. Direct normalized match
      let matched = approvedList.find(k => normalize(k) === normOrig);

      // 2. Common clinical aliases
      if (!matched) {
        const aliasMap: Record<string, string[]> = {
          'hba1c': ['hemoglobina1c', 'glycatedhemoglobin', 'a1c'],
          'ldl': ['ldlcholesterol', 'lowdensitylipoprotein', 'ldlc'],
          'hdl': ['hdlcholesterol', 'highdensitylipoprotein', 'hdlc'],
          'fasting_glucose': ['fbs', 'fastingbloodsugar', 'glucosefasting', 'glucose'],
          'total_cholesterol': ['cholesteroltotal', 'totalchol', 'tchol'],
          'triglycerides': ['tg', 'trigs'],
          'alt': ['sgpt', 'alaninetransaminase', 'alanineaminotransferase'],
          'ast': ['sgot', 'aspartatetransaminase', 'aspartateaminotransferase'],
          'crp': ['hscrp', 'creactiveprotein', 'highsensitivitycrp'],
          'vitamin_d': ['25hydroxyvitamind', '25ohvitamind', 'vitamind3', 'vitd'],
          'tsh': ['thyroidstimulatinghormone', 'thyrotropin'],
          'creatinine': ['serumcreatinine', 'creat']
        };

        for (const [canonical, aliases] of Object.entries(aliasMap)) {
          if (normOrig === normalize(canonical) || aliases.some(a => normOrig === a || normOrig.includes(a))) {
            const canonicalApproved = approvedList.find(k => normalize(k) === normalize(canonical));
            if (canonicalApproved) {
              matched = canonicalApproved;
              break;
            }
          }
        }
      }

      // 3. Substring containment
      if (!matched) {
        matched = approvedList.find(k => {
          const normK = normalize(k);
          return normK.length > 3 && (normK.includes(normOrig) || normOrig.includes(normK));
        });
      }

      if (matched) {
        suggestedMapping[originalKey] = matched;
      }
    });

    const matchCount = Object.keys(suggestedMapping).length;
    const summaryText = matchCount > 0
      ? `Identified ${matchCount} standard database mapping${matchCount > 1 ? 's' : ''} based on clinical ontology rules.`
      : 'Reviewed unmapped biomarkers against master database keys.';

    res.json({
      text: summaryText,
      suggestedMapping
    });
  } catch (e: any) {
    console.error('[route-chat] Deterministic mapping error:', e);
    res.json({ text: "Mapping processed.", suggestedMapping: {} });
  }
});

medicalGeminiRouter.post("/api/gemini/standardize-units", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    const { selectedBiomarkers, engine, customSystemInstruction, unitPreference } = req.body;
    const modelId = (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite";
    addDebugLog(`[Standardize Units Agent] Request received to standardize ${selectedBiomarkers?.length} biomarkers using model: ${modelId} with user unit preference: ${unitPreference || 'SI'}.`, explicitSessionId);

    const targetUnitSystem = unitPreference === "US" ? "US Units (e.g., mg/dL, lbs, inches, standard US clinical ranges)" : "SI Units / International System (e.g., mmol/L, g/L, kg, cm, standard international clinical ranges)";

    let systemInstruction = `You are an automated Clinical Unit Standardization Agent. Your task is to standardize medical units for biomarkers.

=== USER PREFERENCE ===
The user's preferred unit system is: ${targetUnitSystem}.
You MUST standardize the unit for each biomarker to match this preferred system. For example, if the user preference is US Units, you should convert international units like mmol/L to mg/dL when appropriate (e.g., for Glucose or Cholesterol), and standardise weights to lbs, heights to inches. If the user preference is SI Units, you should convert US units to SI/International units. Ensure you provide the appropriate conversionFactor to convert from the biomarker's current unit to this standardized preferred unit.

=== SYSTEM CONSTRAINTS ===

First, think step-by-step in the '_internalReasoning' field of the JSON.

Second, output exactly one JSON object.

The JSON must contain ONLY the fields requested below.

Output exactly ONE object per input biomarker.

=== FIELD DEFINITIONS FOR JSON ===

mappedBiomarkers (array of objects):

originalKey (string): Exact match to input key.

standardizedUnit (string): The exact, pure abbreviation (e.g., "cm", "kg", "score", "mmol/L", "10^9/L").

conversionFactor (number): The numeric conversion multiplier for the unit definition. Use 1 if unchanged.

valueMultiplier (number): The numeric multiplier to apply to historical unstandardized outlier readings to convert them to the standardized unit scale. E.g.:
- Differential WBC percentage to 10^9/L: 0.1 (e.g. 55% neutrophils -> 5.5, 32% lymphocytes -> 3.2, 7% monocytes -> 0.7, 4% eosinophils -> 0.4).
- Raw cells/µL to 10^9/L: 0.001 (e.g. 100 cells/µL -> 0.10).
- Weight lbs to kg: 0.453592 (or kg to lbs: 2.20462).
- Glucose mg/dL to mmol/L: 0.0555.
- Cholesterol mg/dL to mmol/L: 0.02586 (or 1/38.67).
- Uric Acid mg/dL to µmol/L: 59.48.
- Vitamin D ng/mL to nmol/L: 2.496.
- Testosterone ng/dL to nmol/L: 0.0347.
- Missing decimal place / 10x scale shift: 10 or 0.1.
- No historical log correction needed / readings already standard: 1.

valueAdjustmentReason (string): Short explanation of the value conversion multiplier (e.g. "Scaled differential percentage to 10^9/L (*0.1)").

confidence (string): "high", "medium", or "low".

notes (string): Clinical reasoning.

=== EXAMPLES ===

Example 1: Converting a known unit and scaling outlier logs
Input:
key: "weight", name: "Body Weight", currentUnit: "lbs", sampleLogs: [2026-08-01: 165]
key: "basophil_count", name: "Basophil Count", currentUnit: "10^9/L", normalRange: "0.0 - 0.1", sampleLogs: [2026-08-16: 100]
key: "neutrophil_count", name: "Neutrophil Count", currentUnit: "10^9/L", normalRange: "2.0 - 6.3", sampleLogs: [2026-08-16: 55]

Output:
Weight is lbs. Standard is kg. Conversion 0.453592. Value multiplier 0.453592. Confidence high.
Basophil Count is standard 10^9/L. Log 100 was entered as cells/µL. Value multiplier 0.001. Confidence high.
Neutrophil Count is standard 10^9/L. Log 55 was entered as percentage differential 55%. Value multiplier 0.1. Confidence high.

{
"mappedBiomarkers": [
{
"originalKey": "weight",
"standardizedUnit": "kg",
"conversionFactor": 0.453592,
"valueMultiplier": 0.453592,
"valueAdjustmentReason": "Converted weight from lbs to kg (*0.453592).",
"confidence": "high",
"notes": "Converted from lbs to kg."
},
{
"originalKey": "basophil_count",
"standardizedUnit": "10^9/L",
"conversionFactor": 1,
"valueMultiplier": 0.001,
"valueAdjustmentReason": "Scaled raw cells/µL to 10^9/L (/1000).",
"confidence": "high",
"notes": "Standard SI unit is 10^9/L. Historical entry 100 cells/µL scaled to 0.10 10^9/L."
},
{
"originalKey": "neutrophil_count",
"standardizedUnit": "10^9/L",
"conversionFactor": 1,
"valueMultiplier": 0.1,
"valueAdjustmentReason": "Scaled differential percentage (55%) to 10^9/L (*0.1).",
"confidence": "high",
"notes": "Standard SI unit is 10^9/L. Historical entry 55% scaled to 5.5 10^9/L."
}
]
}

=== OUTPUT INSTRUCTIONS ===

First, write out your step-by-step reasoning in plain text.

Then, output your final mapped results in a raw, valid JSON block.

Ensure EVERY JSON field is correctly separated by a comma and that all strings are properly closed with quotation marks. Do not add markdown formatting blocks (such as \`\`\`json) around your response.`;

    if (customSystemInstruction) {
      systemInstruction += `\n\n=== CUSTOM INSTRUCTIONS ===\n${customSystemInstruction}`;
      addDebugLog(`[Standardize Units Agent] Using Custom Instructions:\n${customSystemInstruction}`, explicitSessionId);
    }
    
    let promptText = `Biomarkers to process:\n`;
    if (selectedBiomarkers && selectedBiomarkers.length > 0) {
      selectedBiomarkers.forEach((b: any) => {
        const samplesStr = Array.isArray(b.sampleLogs) && b.sampleLogs.length > 0
          ? `, sampleLogs: [${b.sampleLogs.map((l: any) => `${l.date}: ${l.value}`).join(', ')}]`
          : '';
        const rangeStr = b.normalRange ? `, normalRange: "${b.normalRange}"` : '';
        promptText += `- key: "${b.key}", name: "${b.name}", currentUnit: "${b.currentUnit || 'Unknown'}"${rangeStr}${samplesStr}\n`;
      });
    }

    const standardizeUnitsSchema = {
      type: Type.OBJECT,
      properties: {
        _internalReasoning: { type: Type.STRING, description: "Think step-by-step: analyze current units, inspect sample logs for scale/unit mismatches, determine standard metric units, compute valueMultiplier for outlier logs, perform conversions, check constraints." },
        mappedBiomarkers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              originalKey: { type: Type.STRING },
              standardizedUnit: { type: Type.STRING },
              conversionFactor: { type: Type.NUMBER },
              valueMultiplier: { type: Type.NUMBER, description: "Multiplier to convert legacy/outlier historical log readings to standard scale (e.g. 0.001 for cells/µL to 10^9/L, 1 if no conversion needed)." },
              valueAdjustmentReason: { type: Type.STRING, description: "Short clinical reason for valueMultiplier." },
              confidence: { type: Type.STRING },
              notes: { type: Type.STRING }
            }
          }
        }
      },
      required: ["_internalReasoning", "mappedBiomarkers"]
    };

    const makeStandardizationCall = async () => {
      let timeoutId: NodeJS.Timeout;
      const standardizationTimeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Clinical unit standardization timed out after 115s. Model under high demand — please try again.")), 115000);
      });
      try {
        const llmPromise = callUnifiedLLM({
          modelId,
          systemInstruction,
          promptText,
          responseMimeType: "application/json",
          responseSchema: standardizeUnitsSchema,
          skipThinking: true
        });
        
        // Prevent unhandled rejection if this promise settles after Promise.race finishes
        llmPromise.catch(() => {});
        
        const result = await Promise.race([
          llmPromise,
          standardizationTimeout
        ]);
        return result as string;
      } finally {
        clearTimeout(timeoutId!);
      }
    };

    let textOutput: string;
    try {
      textOutput = await makeStandardizationCall();
    } catch (firstErr: any) {
      const isAbort = firstErr.name === 'AbortError' || (firstErr.message && firstErr.message.toLowerCase().includes('abort'));
      const isQuota = firstErr.message && (firstErr.message.includes('429') || firstErr.message.includes('quota') || firstErr.message.toLowerCase().includes('resource_exhausted'));
      if (isAbort || isQuota) throw firstErr;
      addDebugLog(`[Standardize Units Agent] First attempt failed: ${firstErr.message}. Retrying once in 500ms...`, explicitSessionId);
      await new Promise(resolve => setTimeout(resolve, 500));
      textOutput = await makeStandardizationCall();
    }

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    addDebugLog(`[Standardize Units Agent] Agent output payload (raw):\n${cleanJson}`, explicitSessionId);
    
    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleanJson = jsonMatch[0];
    }
    
    addDebugLog(`[Standardize Units Agent] Agent output payload (cleaned):\n${cleanJson}`, explicitSessionId);
    res.json({ jsonResponse: cleanJson });
  } catch (error: any) {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    addDebugLog(`[Standardize Units Agent] Error: ${error.message}`, explicitSessionId);
    console.error("[Standardize Units Agent Error]:", error);
    res.status(500).json({ error: "Failed to standardize units: " + error.message });
  }
});

medicalGeminiRouter.post("/api/gemini/medical-categorise", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    const { selectedBiomarkers, engine, customSystemInstruction } = req.body;
    const modelId = (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite";
    addDebugLog(`[Medical Categorisation Agent] Request received to categorise ${selectedBiomarkers?.length} biomarkers using model: ${modelId}.`, explicitSessionId);

    let systemInstruction = `You are an automated Clinical Categorisation Agent. Your task is to accurately map medical biomarkers to their appropriate physiological groupings, risk categories, and potential medical conditions.

=== OBJECTIVE ===
For each provided biomarker, determine:
1. Standard Medical Grouping. Select the most appropriate clinical medical practice area. Choose from:
   - 'Metabolic'
   - 'Hepatic'
   - 'Renal'
   - 'Hematology'
   - 'Biometrics'
   - 'Cardiology'
   - 'Endocrinology'
   - 'Immunology'
   - 'Neurology & Cognitive'
   - 'Behavioral & Mental Health'
   - 'Toxicology & Addiction'
   - 'Screenings & Assessments'
   - 'Gastroenterology'
   - 'Musculoskeletal'
   - 'Pulmonology'
   - 'Wellness & Lifestyle'
   - 'Other'
   CRITICAL FOR SURVEYS, AUDIT SCORES, QUESTIONNAIRES & SCREENINGS: Assign 'Behavioral & Mental Health', 'Toxicology & Addiction', or 'Screenings & Assessments'. NEVER output blank or N/A.

2. Risk Categories. A JSON array of string tags. Choose ONLY from the 8 canonical categories: "Cardiovascular", "Metabolic", "Liver", "Kidney", "Hematology", "Immunological", "Endocrine", "Screenings & Wellness". Do NOT invent other category names.
   CRITICAL: You MUST assign AT LEAST ONE category to EVERY biomarker. Never return an empty array [].

3. Potential Medical Conditions. A JSON array of string tags representing associated clinical conditions, clinical states, symptoms, or indicators (e.g. for AUDIT alcohol scores: ["Alcohol Use Assessment", "Alcoholic Liver Disease Risk", "Substance Dependency Screening"]).
   CRITICAL: You MUST assign AT LEAST ONE potential medical condition to EVERY biomarker. Never return an empty array [].

=== CLINICAL REASONING FOR UNUSUAL OR BIOMETRIC MEASUREMENTS ===
You must think through the clinical reasoning of why specific measurements are taken at all and associate them with relevant medical conditions.
- For biometric markers like "steps": think about why physical activity is tracked and associate it with conditions/states such as "Sedentary State", "Physical Deconditioning", "Cardiovascular Inactivity", or "General Fitness".
- For AUDIT questionnaire scores: associate with "Alcohol Use Assessment", "Alcohol Dependency Risk", "Substance Dependency Screening", or "Hepatic Health Monitoring".
- For platelet markers like "platelet_distribution_width" (PDW) or general platelets: think through why they are measured (e.g. platelet size variability, bone marrow activity, clot formation) and associate them with relevant clinical conditions such as "acute infections", "chronic inflammatory disorders", "aplastic anemia", "nutritional deficiencies".
- Do not leave any fields blank or empty. Every biomarker must have at least one valid value for every single field.

CRITICAL: You MUST include all fields (standardMedicalGrouping, riskCategories, potentialMedicalConditions) for every biomarker in your JSON output.

=== SYSTEM CONSTRAINTS ===
Return a single flat JSON array of objects.
Do NOT use any Markdown blocks, wrapping backticks, or extra text. Output ONLY the raw JSON text.

Biomarkers to process:
${JSON.stringify(selectedBiomarkers, null, 2)}`;

    if (customSystemInstruction) {
      addDebugLog(`[Medical Categorisation Agent] Overriding system instruction with custom version (${customSystemInstruction.length} chars).`, explicitSessionId);
      systemInstruction = customSystemInstruction;
    }

    addDebugLog(`[Medical Categorisation Agent] Dispatched System Instruction (Length: ${systemInstruction.length})`, explicitSessionId);
    addDebugLog(`[Medical Categorisation Agent] Dispatched Model ID: ${modelId}`, explicitSessionId);

    const medicalCategoriseSchema = {
      type: Type.OBJECT,
      properties: {
        _internalReasoning: { type: Type.STRING, description: "Think step-by-step: analyze the biomarker, identify its primary physiological system, and determine risk levels based on clinical guidelines." },
        categorisedBiomarkers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              originalKey: { type: Type.STRING },
              standardMedicalGrouping: { type: Type.STRING },
              riskCategories: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              potentialMedicalConditions: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              }
            },
            required: ["originalKey", "standardMedicalGrouping", "riskCategories", "potentialMedicalConditions"]
          }
        }
      },
      required: ["_internalReasoning", "categorisedBiomarkers"]
    };

    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction,
      promptText: "Please output the categorisation in JSON format following the schema exactly.",
      responseMimeType: "application/json",
      responseSchema: medicalCategoriseSchema,
      skipThinking: true
    });

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    addDebugLog(`[Medical Categorisation Agent] Agent output payload:
${cleanJson}`, explicitSessionId);
    res.json({ jsonResponse: cleanJson });
  } catch (error: any) {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    addDebugLog(`[Medical Categorisation Agent] Error: ${error.message}`, explicitSessionId);
    console.error("[Medical Categorisation Agent Error]:", error);
    res.status(500).json({ error: "Failed to categorise biomarkers: " + error.message });
  }
});

medicalGeminiRouter.post("/api/gemini/calibrate-reference-ranges", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    const { selectedBiomarkers, engine, customSystemInstruction, unitPreference } = req.body;
    const modelId = (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite";
    const isUS = unitPreference === "US";
    addDebugLog(`[Reference Range Calibration Agent] Request received to calibrate ${selectedBiomarkers?.length} biomarkers using model: ${modelId} with unit preference: ${unitPreference || 'SI'}.`, explicitSessionId);

    const targetUnitSystem = isUS 
      ? "US Standard Units (Lipids in mg/dL, Proteins in g/dL, Bilirubin in mg/dL, Fasting Glucose in mg/dL, Uric Acid in mg/dL, CBC in k/µL or 10^3/µL, lbs for weight, inches/cm for height)" 
      : "SI / International Metric Units (Lipids in mmol/L, Proteins in g/L, Bilirubin in µmol/L, Fasting Glucose in mmol/L, Uric Acid in µmol/L, Electrolytes in mmol/L, CBC in 10^9/L, kg for weight, cm for height)";

    let systemInstruction = `You are an automated Clinical Reference Range Calibration Agent operating at the Biomarker Reference Dictionary level.
Your mission is to calibrate standard, evidence-based clinical population reference intervals, standardized units, optimal brackets, medical practice groupings, and risk classifications for medical laboratory biomarkers, biometric readings, clinical questionnaires, and symptom scores.

=== STRICT UNIT CONSISTENCY DIRECTIVE ===
You MUST maintain 100% internal unit consistency according to the requested locale: ${targetUnitSystem}.
- In SI Mode:
  * Lipids (Total, HDL, LDL, VLDL, Non-HDL, Triglycerides): ALWAYS mmol/L (Never mg/dL).
  * Proteins (Total Protein, Albumin, Globulin): ALWAYS g/L (e.g. Total protein: 60 - 83 g/L; Albumin: 35 - 50 g/L).
  * Bilirubin (Total Bilirubin, Direct Bilirubin): ALWAYS µmol/L (e.g. Total bilirubin: 3.4 - 20.5 µmol/L; Direct: 0.0 - 5.0 µmol/L).
  * Fasting Glucose: mmol/L. Uric Acid: µmol/L (or mmol/L).
  * Electrolytes & Minerals: mmol/L.
  * CBC Differential & Counts: 10^9/L.
- In US Mode:
  * Lipids, Glucose, Uric Acid, Bilirubin: mg/dL.
  * Proteins: g/dL (e.g. Total protein: 6.0 - 8.3 g/dL).

=== OBJECTIVE ===
For each provided biomarker, you MUST determine:
1. Standardized Unit: The accurate clinical unit according to the selected system. For questionnaires/scores use "score" or "points". For qualitative tests use "qualitative".
2. Normal Reference Range (Population Baseline):
   - minRange: Lower bound of normal (numeric float/integer, or null if single-sided upper bound, e.g. < 5.0 or qualitative).
   - maxRange: Upper bound of normal (numeric float/integer, or null if single-sided lower bound, e.g. > 1.0 or qualitative).
   - normalRange: Exact human-readable normal interval string (e.g., "10 - 40", "< 3.4", "Negative", "0 - 7", "135 - 145").
3. Optimal / Functional Range:
   - optimalMin: Numeric lower optimal threshold (or null).
   - optimalMax: Numeric upper optimal threshold (or null).
   - optimalRange: Human-readable optimal interval string (e.g., "15 - 30", "< 2.6", "0 - 3", or null if identical to normal range).
4. Clinical Classification:
   - standardMedicalGrouping: Clinical practice area ('Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', 'Cardiology', 'Endocrinology', 'Immunology', 'Neurology & Cognitive', 'Behavioral & Mental Health', 'Toxicology & Addiction', 'Screenings & Assessments', 'Gastroenterology', 'Musculoskeletal', 'Pulmonology', 'Wellness & Lifestyle', 'Other').
   - riskCategories: Array of clinical risk category tags chosen strictly from: "Cardiovascular", "Metabolic", "Liver", "Kidney", "Hematology", "Immunological", "Endocrine", "Screenings & Wellness".
   - potentialMedicalConditions: Array of associated conditions / clinical indications.
5. Clinical Reasoning & Guideline Reference:
   - notes: Clear, concise clinical reasoning citing standard reference authorities (e.g., WHO, KDIGO, ADA, AHA, standard clinical pathology reference manuals). Include sex-stratified ranges where applicable (e.g., uric acid, PSA, creatinine, hemoglobin).
   - confidence: "high", "medium", or "low".

=== SPECIAL GUIDELINES FOR SCORES, SURVEYS & ANTHROPOMETRICS ===
- For AUDIT alcohol scores (audit_total_score, audit_c_total_score, audit_binge_drinking_score, audit_guilt_remorse_score, audit_others_concerned_score, audit_memory_loss_score, audit_drinking_frequency, audit_typical_consumption):
  - Grouping: "Behavioral & Mental Health" or "Toxicology & Addiction", unit: "score" or "points".
  - Normal range: audit_total_score: "0 - 7", audit_c_total_score: "0 - 3". Subscores: "0" or "0 - 1" (minRange: 0, maxRange: 0 or 1).
  - In notes: Explicitly document the instrument scale domain (e.g. "Instrument Scale: 0 to 4 points; 0 = Normal / Symptom Absent").
- For symptom scores (gerd_symptom_score, joint_pain_severity_score, hemorrhoidal_symptom_score):
  - Normal range: "0" or "0 - 2", unit: "score". Notes must cite instrument scale.
- For biometric & anthropometric metrics:
  - steps: normalRange: "7000 - 12000", optimalRange: "8000 - 10000", unit: "steps/day".
  - height: Provide general population height range (e.g. "140 - 200 cm"), set optimalRange to null (height has no population optimal).
  - weight: Provide population adult range; optimalRange should cite "BMI 18.5 - 24.9 kg/m²".
- For qualitative tests (chlamydia_dna_detection, sars_cov_2_rna_detection, hiv_1_2_antibody_antigen, n_gonorrhoeae_nucl_acid_detn):
  - normalRange: "Negative", optimalRange: "Negative", unit: "qualitative".

=== SYSTEM CONSTRAINTS ===
Return a single flat JSON array of objects inside the "calibratedBiomarkers" key.
Output ONLY the raw JSON text.

Biomarkers to process:
${JSON.stringify(selectedBiomarkers, null, 2)}`;

    if (customSystemInstruction) {
      addDebugLog(`[Reference Range Calibration Agent] Overriding system instruction with custom version (${customSystemInstruction.length} chars).`, explicitSessionId);
      systemInstruction = customSystemInstruction;
    }

    addDebugLog(`[Reference Range Calibration Agent] Dispatched System Instruction (Length: ${systemInstruction.length})`, explicitSessionId);
    addDebugLog(`[Reference Range Calibration Agent] Dispatched Model ID: ${modelId}`, explicitSessionId);

    const rangeCalibrationSchema = {
      type: Type.OBJECT,
      properties: {
        _internalReasoning: { type: Type.STRING, description: "Think step-by-step: analyze the biomarker, identify international reference standards, determine normal and optimal reference brackets and units." },
        calibratedBiomarkers: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              originalKey: { type: Type.STRING },
              name: { type: Type.STRING },
              standardizedUnit: { type: Type.STRING },
              dataType: { type: Type.STRING, description: "'numeric' | 'qualitative' | 'score' | 'composite'" },
              minRange: { type: Type.NUMBER },
              maxRange: { type: Type.NUMBER },
              normalRange: { type: Type.STRING },
              optimalMin: { type: Type.NUMBER },
              optimalMax: { type: Type.NUMBER },
              optimalRange: { type: Type.STRING },
              instrumentScale: { type: Type.STRING, description: "Valid allowable input range for questionnaires, e.g. '0 - 45' for GERD-SS, '0 - 40' for AUDIT" },
              potentialDuplicateOf: { type: Type.STRING, description: "Canonical key ONLY if this biomarker is a non-standard abbreviation or duplicate of a DIFFERENT entity (e.g. 'lactate_dehydrogenase' for 'ldh'). Must be null or omitted if this is already the canonical biomarker itself." },
              duplicateFlagReason: { type: Type.STRING },
              allowedValues: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              standardMedicalGrouping: { type: Type.STRING },
              riskCategories: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              potentialMedicalConditions: {
                type: Type.ARRAY,
                items: { type: Type.STRING }
              },
              confidence: { type: Type.STRING },
              notes: { type: Type.STRING }
            },
            required: ["originalKey", "standardizedUnit", "normalRange", "standardMedicalGrouping", "riskCategories", "potentialMedicalConditions"]
          }
        }
      },
      required: ["_internalReasoning", "calibratedBiomarkers"]
    };

    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction,
      promptText: "Please output the reference range calibration in JSON format following the schema exactly.",
      responseMimeType: "application/json",
      responseSchema: rangeCalibrationSchema,
      skipThinking: true
    });

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();

    // TypeScript Middleware Post-Processing Sanitizer (Anti-patch & Structural Invariants)
    try {
      const parsed = JSON.parse(cleanJson);
      if (parsed && Array.isArray(parsed.calibratedBiomarkers)) {
        // Collect requested keys for mutual duplicate cross-referencing
        const requestedKeys = parsed.calibratedBiomarkers.map((b: any) => (b.originalKey || '').toLowerCase());

        parsed.calibratedBiomarkers = parsed.calibratedBiomarkers.map((item: any) => {
          const k = (item.originalKey || '').toLowerCase();
          let unit = (item.standardizedUnit || '').trim();

          // Unit casing and format normalizations
          if (unit.toLowerCase() === 'qualitative') unit = 'qualitative';
          if (unit === '(count)' || unit === 'count' || (k === 'steps' && !unit)) unit = 'steps/day';
          if (unit.toLowerCase() === 'mmhg') unit = 'mmHg';
          if (unit.toLowerCase() === 'ratio') unit = 'ratio';

          // Structural SI unit coherence enforcement
          if (!isUS) {
            if (k === 'total_protein' && (unit.toLowerCase() === 'g/dl' || item.minRange < 15)) {
              unit = 'g/L';
              item.minRange = 60.0;
              item.maxRange = 83.0;
              item.normalRange = '60 - 83';
              item.optimalMin = 65.0;
              item.optimalMax = 75.0;
              item.optimalRange = '65 - 75';
            } else if ((k === 'vldl_cholesterol' || k === 'vldl') && (unit.toLowerCase() === 'mg/dl' || item.maxRange > 5)) {
              unit = 'mmol/L';
              item.minRange = 0.1;
              item.maxRange = 0.78;
              item.normalRange = '0.10 - 0.78';
              item.optimalMin = 0.1;
              item.optimalMax = 0.5;
              item.optimalRange = '0.10 - 0.50';
            } else if ((k === 'total_bilirubin' || k === 'bilirubin') && (unit.toLowerCase() === 'mg/dl' || item.maxRange < 3)) {
              unit = 'µmol/L';
              item.minRange = 3.4;
              item.maxRange = 20.5;
              item.normalRange = '3.4 - 20.5';
              item.optimalMin = 5.0;
              item.optimalMax = 15.0;
              item.optimalRange = '5.0 - 15.0';
            } else if (k === 'direct_bilirubin' && (unit.toLowerCase() === 'mg/dl' || item.maxRange < 1)) {
              unit = 'µmol/L';
              item.minRange = 0.0;
              item.maxRange = 5.0;
              item.normalRange = '0.0 - 5.0';
              item.optimalMin = 0.0;
              item.optimalMax = 3.4;
              item.optimalRange = '0.0 - 3.4';
            } else if (k === 'uric_acid' && (unit.toLowerCase() === 'mg/dl' || (item.maxRange && item.maxRange < 15))) {
              unit = 'µmol/L';
              item.minRange = 142.0;
              item.maxRange = 416.0;
              item.normalRange = '142 - 416';
              item.optimalMin = 180.0;
              item.optimalMax = 350.0;
              item.optimalRange = '180 - 350';
            } else if (k === 'free_t4' && (unit.toLowerCase() === 'ng/dl' || (item.maxRange && item.maxRange < 5))) {
              unit = 'pmol/L';
              item.minRange = 12.0;
              item.maxRange = 22.0;
              item.normalRange = '12.0 - 22.0';
              item.optimalMin = 14.0;
              item.optimalMax = 19.0;
              item.optimalRange = '14.0 - 19.0';
            } else if (k === 'free_t3' && (unit.toLowerCase() === 'pg/ml' || (item.maxRange && item.maxRange < 2))) {
              unit = 'pmol/L';
              item.minRange = 3.5;
              item.maxRange = 6.5;
              item.normalRange = '3.5 - 6.5';
              item.optimalMin = 4.0;
              item.optimalMax = 5.5;
              item.optimalRange = '4.0 - 5.5';
            }
          }

          // Qualitative test normalization
          const isQualitative = unit === 'qualitative' || 
            k.includes('dna_detection') || 
            k.includes('rna_detection') || 
            k.includes('antibody_antigen') || 
            k.includes('nucl_acid_detn') ||
            (item.normalRange && item.normalRange.toLowerCase().includes('negative'));

          if (isQualitative) {
            unit = 'qualitative';
            item.dataType = 'qualitative';
            item.minRange = null;
            item.maxRange = null;
            item.optimalMin = null;
            item.optimalMax = null;
            item.normalRange = 'Negative';
            item.optimalRange = 'Negative';
            item.allowedValues = ['Negative', 'Positive', 'Equivocal'];
          }

          // Anthropometric guardrails
          if (k === 'height') {
            item.optimalRange = null;
            item.optimalMin = null;
            item.optimalMax = null;
          } else if (k === 'weight') {
            if (!item.optimalRange || !item.optimalRange.toLowerCase().includes('bmi')) {
              item.optimalRange = 'BMI 18.5 - 24.9 kg/m²';
            }
          }

          // Blood pressure composite handling
          if (k === 'blood_pressure') {
            item.dataType = 'composite';
            item.normalRange = '< 120 / < 80';
            item.optimalRange = '< 120 / < 80';
            item.minRange = null;
            item.maxRange = null;
            item.optimalMin = null;
            item.optimalMax = null;
          }

          // Questionnaire & Score scale guardrails (Separate allowable input range from normal target)
          if (k.startsWith('audit_') || k.endsWith('_score') || k.includes('symptom_score')) {
            item.dataType = 'score';
            if (unit !== 'score' && unit !== 'points') unit = 'score';

            if (k === 'gerd_symptom_score') {
              item.instrumentScale = '0 - 45';
              item.normalRange = '0 - 2';
              item.minRange = 0;
              item.maxRange = 2;
            } else if (k === 'hemorrhoidal_symptom_score') {
              item.instrumentScale = '0 - 20';
              item.normalRange = '0 - 2';
              item.minRange = 0;
              item.maxRange = 2;
            } else if (k === 'joint_pain_severity_score') {
              item.instrumentScale = '0 - 10';
              item.normalRange = '0 - 1';
              item.minRange = 0;
              item.maxRange = 1;
            } else if (k === 'audit_total_score') {
              item.instrumentScale = '0 - 40';
              item.normalRange = '0 - 7';
              item.minRange = 0;
              item.maxRange = 7;
              item.optimalRange = '0 - 3';
            } else if (k === 'audit_c_total_score') {
              item.instrumentScale = '0 - 12';
              item.normalRange = '0 - 3';
              item.minRange = 0;
              item.maxRange = 3;
              item.optimalRange = '0 - 1';
            } else if (k.startsWith('audit_')) {
              item.instrumentScale = '0 - 4';
              if (item.minRange === undefined || item.minRange === null) item.minRange = 0;
            }
          }

          // Clean false positive self-duplicates (e.g. bmi -> bmi, rbc -> rbc, fasting_glucose -> fasting_glucose)
          if (item.potentialDuplicateOf) {
            const dupKey = String(item.potentialDuplicateOf).trim().toLowerCase();
            const selfKey = k.trim().toLowerCase();
            const selfName = (item.name || '').trim().toLowerCase();
            if (dupKey === selfKey || dupKey === selfName || dupKey === '' || dupKey === 'null' || dupKey === 'none') {
              item.potentialDuplicateOf = null;
              item.duplicateFlagReason = null;
            }
          }

          // Duplicate Entity Identification & Flagging for Alias Groups
          if (k === 'ldh') {
            item.potentialDuplicateOf = 'lactate_dehydrogenase';
            item.duplicateFlagReason = 'Abbreviation / alias of lactate_dehydrogenase';
          } else if (k === 'vldl' && requestedKeys.includes('vldl_cholesterol')) {
            item.potentialDuplicateOf = 'vldl_cholesterol';
            item.duplicateFlagReason = 'Synonym of vldl_cholesterol';
          } else if (k === 'globulin' && requestedKeys.includes('serum_globulin')) {
            item.potentialDuplicateOf = 'serum_globulin';
            item.duplicateFlagReason = 'Synonym of serum_globulin';
          } else if (k === 'albumin' && requestedKeys.includes('serum_albumin')) {
            item.potentialDuplicateOf = 'serum_albumin';
            item.duplicateFlagReason = 'Synonym of serum_albumin';
          }

          return {
            ...item,
            standardizedUnit: unit
          };
        });
        cleanJson = JSON.stringify(parsed, null, 2);
      }
    } catch (sanitizerErr) {
      console.warn("[Reference Range Calibration Agent] Sanitizer pass warning:", sanitizerErr);
    }

    addDebugLog(`[Reference Range Calibration Agent] Agent output payload:\n${cleanJson}`, explicitSessionId);
    res.json({ jsonResponse: cleanJson });
  } catch (error: any) {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    addDebugLog(`[Reference Range Calibration Agent] Error: ${error.message}`, explicitSessionId);
    console.error("[Reference Range Calibration Agent Error]:", error);
    res.status(500).json({ error: "Failed to calibrate reference ranges: " + error.message });
  }
});

medicalGeminiRouter.post("/api/gemini/consolidate-names", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    const { inputText, selectedBiomarkers, existingKeys, engine, customSystemInstruction } = req.body;
    const modelId = (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite";
    const isStream = req.query.stream === 'true';
    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.flushHeaders();
    }
    addDebugLog(`[Name Consolidation Agent] Request received using model: ${modelId}. Text length: ${inputText?.length || 0}. Biomarkers count: ${selectedBiomarkers?.length || 0}`, explicitSessionId);

    if (inputText) {
      addDebugLog(`[Name Consolidation Agent] User Prompt:\n${inputText}`, explicitSessionId);
    }

    let systemInstruction = `You are an automated Name Consolidation Agent. Your task is to identify and group similar clinical biomarkers based on their names.

=== SYSTEM CONSTRAINTS ===

Do not perform any medical categorization or physiological classification.

You are provided with an EXISTING DICTIONARY of approved keys.

For each biomarker in the input batch:

Check if it is a synonym or alias of an EXISTING DICTIONARY key (matching based on name or similar terminology).

If a match is found:

Set "isExistingKey" to true.

Set "existingMasterKey" to the existing dictionary key.

Set "recommendedKey" to the existing dictionary key.

Add the candidate name to "aliases".

Add the candidate's original key to "keys".

If no match is found in the dictionary:

Set "isExistingKey" to false.

Set "existingMasterKey" to null.

Propose a new "recommendedKey" and "Name".

Add the candidate name to "aliases".

Add the candidate's original key to "keys".

=== FIELD DEFINITIONS ===

_internalReasoning (string): MUST BE THE FIRST FIELD. Think step-by-step here: compare the provided names against each other AND against the existing dictionary, and identify synonyms.

consolidatedGroups (array of objects): A list containing your merged biomarker groups. Each object must contain:

Name (string): The recommended clinical name.

recommendedKey (string): A unique key, formatted in snake_case.

aliases (array of strings): A list of candidate names that are synonyms.

keys (array of strings): A list of the original keys from the input batch that are mapped to this group.

rationale (string): Explanation of why these represent the same clinical biomarker.

isExistingKey (boolean): true if a match was found in the dictionary, otherwise false.

existingMasterKey (string or null): The exact key from the dictionary, or null if no match was found.

=== OUTPUT TEMPLATE ===
You must strictly return a raw, valid JSON object matching exactly this structure. Do not add markdown formatting blocks (such as \`\`\`json) around your response. Do not insert textual descriptions into the values.

{
"_internalReasoning": "",
"consolidatedGroups": [
{
"Name": "",
"recommendedKey": "",
"aliases": [],
"keys": [],
"rationale": "",
"isExistingKey": false,
"existingMasterKey": null
}
]
}`;

    if (customSystemInstruction) {
      addDebugLog(`[Name Consolidation Agent] Overriding system instruction with custom version (${customSystemInstruction.length} chars).`, explicitSessionId);
      systemInstruction = customSystemInstruction;
    }

    const dynamicPromptText = `Biomarkers to process (the selected batch — candidates for consolidation):\n${JSON.stringify(selectedBiomarkers, null, 2)}\n\nEXISTING DICTIONARY (already-approved keys — check every group against this list first; these are NOT candidates to be renamed, only possible merge targets):\n${JSON.stringify(existingKeys || [], null, 2)}\n\nUSER DATA / CONVERSATION TEXT:
\"\"\"${inputText || "Please identify the duplicates from the provided list and consolidate them."}\"\"\"

Please output a valid JSON object matching the requested schema.`;

    addDebugLog(`[Name Consolidation Agent] Dispatched Model ID: ${modelId}`, explicitSessionId);

    
    const consolidateNamesSchema = {
      type: Type.OBJECT,
      properties: {
        _internalReasoning: { type: Type.STRING, description: "Think step-by-step: compare the provided names against each other and against the existing dictionary, identify synonyms, determine the most universally recognized clinical name, and map aliases." },
        consolidatedGroups: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              Name: { type: Type.STRING },
              recommendedKey: { type: Type.STRING },
              aliases: { type: Type.ARRAY, items: { type: Type.STRING } },
              keys: { type: Type.ARRAY, items: { type: Type.STRING }, description: "The list of original keys from the input batch that map to this consolidated group." },
              rationale: { type: Type.STRING },
              isExistingKey: { type: Type.BOOLEAN, description: "true if this group matches an already-approved key from the existing dictionary" },
              existingMasterKey: { type: Type.STRING, description: "the exact matching key from the existing dictionary, copied verbatim, or omitted/empty if isExistingKey is false", nullable: true }
            },
            required: ["Name", "recommendedKey", "aliases", "keys", "rationale", "isExistingKey", "existingMasterKey"]
          }
        }
      },
      required: ["_internalReasoning", "consolidatedGroups"]
    };

    const makeConsolidationCall = async () => {
      let timeoutId: NodeJS.Timeout;
      const consolidationTimeout = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("Name consolidation timed out after 115s. Model under high demand — please try again.")), 115000);
      });
      try {
        const llmPromise = callUnifiedLLM({
          modelId,
          systemInstruction: systemInstruction,
          promptText: dynamicPromptText,
          responseMimeType: "application/json",
          responseSchema: consolidateNamesSchema,
          skipThinking: true,
          onStream: isStream ? (chunk: string, isThought?: boolean) => {
            if (isThought) {
              res.write(`data: ${JSON.stringify({ thought: chunk })}\n\n`);
            } else {
              res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
            }
          } : undefined
        });
        
        // Prevent unhandled rejection if this promise settles after Promise.race finishes
        llmPromise.catch(() => {});
        
        const result = await Promise.race([
          llmPromise,
          consolidationTimeout
        ]);
        return result as string;
      } finally {
        clearTimeout(timeoutId!);
      }
    };

    let textOutput: string;
    try {
      textOutput = await makeConsolidationCall();
    } catch (firstErr: any) {
      const isAbort = firstErr.name === 'AbortError' || (firstErr.message && firstErr.message.toLowerCase().includes('abort'));
      const isQuota = firstErr.message && (firstErr.message.includes('429') || firstErr.message.includes('quota') || firstErr.message.toLowerCase().includes('resource_exhausted'));
      if (isAbort || isQuota) throw firstErr;
      addDebugLog(`[Name Consolidation Agent] First attempt failed: ${firstErr.message}. Retrying once in 500ms...`, explicitSessionId);
      await new Promise(resolve => setTimeout(resolve, 500));
      textOutput = await makeConsolidationCall();
    }

    let cleanJson = textOutput.trim();
    addDebugLog(`[Name Consolidation Agent] Agent output payload:\n${cleanJson}`, explicitSessionId);
    
    if (cleanJson.includes("```")) {
      const match = cleanJson.match(/```(?:json)?([\s\S]*?)```/);
      if (match) {
        cleanJson = match[1].trim();
      } else {
        cleanJson = cleanJson.replace(/```(?:json)?/gi, "").trim();
      }
    }
    const firstBrace = cleanJson.indexOf('{');
    const lastBrace = cleanJson.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = extractBalancedJson(cleanJson);
    }

    const parsed = JSON.parse(cleanJson);
    
    if (parsed.explanation) {
      addDebugLog(`[Name Consolidation Agent] Agent Explanation:\n${parsed.explanation}`, explicitSessionId);
    }

    if (isStream) {
      res.write(`data: ${JSON.stringify({ final: true, result: parsed })}\n\n`);
      res.end();
    } else {
      res.json(parsed);
    }
  } catch (error: any) {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    addDebugLog(`[Name Consolidation Agent] Error: ${error.message}`, explicitSessionId);
    console.error("[Name Consolidation Agent Error]:", error);
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: "Failed to consolidate biomarker names: " + error.message })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ error: "Failed to consolidate biomarker names: " + error.message });
    }
  }
});

medicalGeminiRouter.post("/api/gemini/data-accuracy", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    const { inputText, currentState, images, currentLocalTime, engine, customSystemInstruction } = req.body;
    const modelId = (typeof engine === 'object' ? engine?.name || engine?.model : engine) || "gemini-3.5-flash-lite";
    addDebugLog(`[Data Accuracy Agent] Request received using model: ${modelId}. Text length: ${inputText?.length || 0}. Images count: ${images?.length || 0}`, explicitSessionId);
    if (inputText) {
      addDebugLog(`[Data Accuracy Agent] User Prompt Content:\n${inputText}`, explicitSessionId);
    }

    let imagesPayload: { mimeType: string, data: string }[] | undefined = undefined;
    if (images && images.length > 0) {
      imagesPayload = images.map((img: string) => {
        const mimeType = img.split(";")[0].split(":")[1] || "image/jpeg";
        const base64Data = img.split(",")[1];
        return { mimeType, data: base64Data };
      });
    }

    let systemInstruction = `You are the Data Accuracy Agent, a clinical data cleaning, quality check, and validation AI specialist. Your role is to get a list of biomarkers shared by the user (via text or uploaded file/images), match them against the user's existing biomarker dictionary and history, compare the critical fields, and return a precise difference analysis.

=== KEY TASKS ===
1. Extract biomarkers from the user's input. The input can contain:
   - Text written by the user.
   - Images of lab report sheets, documents, photos, or other reports.
   For each extracted biomarker, identify:
   - Name (e.g. Hemoglobin A1c, Cholesterol)
   - Unit (e.g. %, mg/dL, mmol/L)
   - Value (e.g. 5.8)
   - Date (e.g. 2026-07-01, or fallback to the current local time if unspecified: ${currentLocalTime || '2026-07-07'})
   - Comments/Notes (any clinical remarks, doctor comments, or brief interpretations associated with it)

2. Match the extracted biomarkers against the user's existing database (Current State provided below).
   Find the most appropriate matching key (e.g., "hba1c"). If no exact match exists in the current custom or built-in keys, propose a standard snake_case key based on medical conventions.

3. Compare the following 5 fields between the user's current data (from their dictionary and historical logs) and the shared data:
   - Biomarker Name (dictionary def name)
   - Unit (dictionary def unit)
   - Value (historical log value for that key on the matching date, or latest)
   - Date (historical log date for that key)
   - Comments (historical log note or specific test doctor comment)
   Match the date of the shared data with the historical logs to find the exact existing log. If no exact date match exists, compare against null or mark as a new log.

4. Determine if each field is "same" or "different":
   - Use comparison logic. If one is missing or empty on one side and present on the other, it is "different".
   - Set status to "same" if the content matches closely (case-insensitive, trimmed, numeric values with different decimal places like 5 and 5.0 are considered "same").
   - Set status to "different" if there is any difference.

5. IMPORTANT: Handling Multiple Entries for the Same Biomarker:
   - If the user's input contains multiple log entries for the SAME biomarker (e.g., tests taken on multiple different dates, or multiple values), you MUST create and return a SEPARATE object in the "comparisonResults" array for EACH distinct instance or date. Do not combine or skip them.

=== RESPONSE FORMAT ===
You MUST return a JSON object with this exact structure. Do NOT wrap it in markdown blocks. Return ONLY the raw valid JSON.

JSON Schema:
{
  "explanation": "A friendly scannable summary of the differences found.",
  "comparisonResults": [
    {
      "key": "biomarker_key",
      "matched": true,
      "name": { "current": "current_name", "shared": "shared_name", "status": "same|different" },
      "unit": { "current": "current_unit", "shared": "shared_unit", "status": "same|different" },
      "value": { "current": "current_value", "shared": "shared_value", "status": "same|different" },
      "date": { "current": "current_date", "shared": "shared_date", "status": "same|different" },
      "comments": { "current": "current_comments", "shared": "shared_comments", "status": "same|different" }
    }
  ]
}

=== USER'S CURRENT STATE ===
${JSON.stringify(currentState, null, 2)}
`;

    if (customSystemInstruction) {
      addDebugLog(`[Data Accuracy Agent] Overriding system instruction with custom version (${customSystemInstruction.length} chars).`, explicitSessionId);
      systemInstruction = customSystemInstruction;
    }

    addDebugLog(`[Data Accuracy Agent - Payload Sent] Model ID: ${modelId}
- User Prompt Content: ${inputText || "(no text content)"}
- Images Uploaded: ${images?.length || 0}
- Current State Reference Data Sent:
${JSON.stringify(currentState, null, 2)}`, explicitSessionId);

    const dynamicPromptText = `USER DATA / LAB REPORT INPUT TEXT:
"""
${inputText || "(no text content provided)"}
"""

Please extract the shared biomarkers and compare them with the user's current state. Return ONLY a valid JSON object matching the JSON schema. Ensure there are no markdown backticks.`;

    
    const dataAccuracySchema = {
      type: Type.OBJECT,
      properties: {
        _internalReasoning: { type: Type.STRING, description: "Think step-by-step: analyze the data points, verify physical biological limits, check against provided documents if any, and detect anomalies." },
        anomalies: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              biomarkerKey: { type: Type.STRING },
              flagType: { type: Type.STRING },
              description: { type: Type.STRING },
              severity: { type: Type.STRING },
              recommendedAction: { type: Type.STRING }
            }
          }
        },
        generalAccuracyScore: { type: Type.NUMBER },
        overallAssessment: { type: Type.STRING }
      },
      required: ["_internalReasoning", "anomalies", "generalAccuracyScore", "overallAssessment"]
    };

    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction: systemInstruction + "\n\nJSON STRUCTURED OUTPUT:\nYou must strictly return a JSON object. Do not add markdown wrappers. Think step-by-step in the '_internalReasoning' field first.",
      promptText: dynamicPromptText,
      imagePayloads: imagesPayload,
      responseMimeType: "application/json",
      responseSchema: dataAccuracySchema
    });

    let cleanJson = textOutput.trim();
    addDebugLog(`[Data Accuracy Agent - Response Received] Raw Output from Agent:\n${cleanJson}`, explicitSessionId);

    // Robust markdown removal & JSON extraction
    if (cleanJson.includes("```")) {
      const match = cleanJson.match(/```(?:json)?([\s\S]*?)```/);
      if (match) {
        cleanJson = match[1].trim();
      } else {
        cleanJson = cleanJson.replace(/```(?:json)?/gi, "").trim();
      }
    }

    const firstBrace = cleanJson.indexOf('{');
    const lastBrace = cleanJson.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleanJson = extractBalancedJson(cleanJson);
    }

    addDebugLog(`[Data Accuracy Agent - Response Received] Parsed and Cleaned JSON:\n${cleanJson}`, explicitSessionId);
    
    // Parse to verify valid JSON
    const parsed = JSON.parse(cleanJson);
    if (parsed.explanation) {
      addDebugLog(`[Data Accuracy Agent] Agent Explanation Response:\n${parsed.explanation}`, explicitSessionId);
    }
    res.json(parsed);
  } catch (error: any) {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    addDebugLog(`[Data Accuracy Agent] Error: ${error.message}`, explicitSessionId);
    console.error("[Data Accuracy Agent Error]:", error);
    res.status(500).json({ error: "Failed to compare and validate biomarkers: " + error.message });
  }
});
