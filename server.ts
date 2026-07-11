import { getApps, initializeApp } from 'firebase-admin/app';
if (getApps().length === 0) {
  initializeApp();
}
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
const adminAuth = getAdminAuth();
import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI, Type } from "@google/genai";
import { getNutrientsForFood } from "./server_food_db";
import dotenv from "dotenv";
import YAML from "yaml";
import { AsyncLocalStorage } from "async_hooks";
import { biomarkerDefinitions } from "./src/utils/biomarkers";

// Simple and robust custom JS object-to-YAML stringifier
function jsToYaml(val: any, indent: number = 0): string {
  const spaces = " ".repeat(indent);
  if (val === null) return "null";
  if (val === undefined) return "null";
  if (typeof val === "string") {
    if (val.includes("\n")) {
      return "|\n" + val.split("\n").map(line => spaces + "  " + line).join("\n");
    }
    if (val.includes(":") || val.includes("#") || val.startsWith("-")) {
      return `"${val.replace(/"/g, '\\"')}"`;
    }
    return val;
  }
  if (typeof val === "number" || typeof val === "boolean") {
    return String(val);
  }
  if (Array.isArray(val)) {
    if (val.length === 0) return "[]";
    let out = "";
    for (const item of val) {
      if (typeof item === "object" && item !== null) {
        const inner = jsToYaml(item, indent + 2);
        const lines = inner.split("\n");
        out += `\n${spaces}- ${lines[0].trim()}`;
        if (lines.length > 1) {
          out += "\n" + lines.slice(1).join("\n");
        }
      } else {
        out += `\n${spaces}- ${jsToYaml(item, indent + 2)}`;
      }
    }
    return out;
  }
  if (typeof val === "object") {
    const keys = Object.keys(val);
    if (keys.length === 0) return "{}";
    let out = "";
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = val[k];
      const prefix = i === 0 && indent > 0 ? "" : spaces;
      if (typeof v === "object" && v !== null) {
        out += `${prefix}${k}:${Array.isArray(v) ? "" : "\n"}${jsToYaml(v, indent + (Array.isArray(v) ? 0 : 2))}\n`;
      } else {
        out += `${prefix}${k}: ${jsToYaml(v, indent + 2)}\n`;
      }
    }
    return out.trim();
  }
  return String(val);
}
import { Firestore } from "@google-cloud/firestore";

dotenv.config();
console.log("Maps Key status at server boot:", process.env.GOOGLE_MAPS_API_KEY ? "DEFINED" : "UNDEFINED");

// Initialize Firebase Firestore for server-side calculations using Google Cloud Firestore Node.js SDK (bypasses security rules)
let db: any = null;
try {
  const firebaseConfigPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(firebaseConfigPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, "utf-8"));
    db = new Firestore({
      projectId: firebaseConfig.projectId,
      databaseId: firebaseConfig.firestoreDatabaseId,
    });
    console.log("[Firebase] Backend Firestore (Admin Node.js SDK) successfully initialized.");
  } else {
    console.warn("[Firebase] No firebase-applet-config.json found at server boot.");
  }
} catch (err: any) {
  console.error("[Firebase] Error initializing Firestore on server:", err.message || err);
}

function extractBalancedJson(text: string): string {
  let cleaned = text.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const startIdx = cleaned.indexOf("{");
  if (startIdx !== -1) {
    let depth = 0;
    for (let i = startIdx; i < cleaned.length; i++) {
      if (cleaned[i] === "{") depth++;
      else if (cleaned[i] === "}") depth--;
      if (depth === 0) {
        return cleaned.substring(startIdx, i + 1);
      }
    }
  }
  return cleaned;
}
\nconst app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const SERVER_START_TIME = Date.now();

async function startServer() {
  // In-Memory & Local File Sync storage to act as the durable synced database
  const SYNC_DIR = path.join(process.cwd(), "data", "sync");
  if (!fs.existsSync(SYNC_DIR)) {
    fs.mkdirSync(SYNC_DIR, { recursive: true });
  }

  // Increase limit to allow base64 uploaded image payloads
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true, limit: "15mb" }));

  // Register session tracking middleware for isolated logging
  app.use((req, res, next) => {
    const sessionId = (req.headers["x-session-id"] as string) || (req.query.sessionId as string) || "global";
    logSessionStorage.run(sessionId, () => {
      next();
    });
  });

// Initialize Gemini SDK with telemetry header
const getGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("WARNING: GEMINI_API_KEY is not defined in the environment.");
  }
  return new GoogleGenAI({
    apiKey: apiKey || "MOCK_KEY",
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
};

const logSessionStorage = new AsyncLocalStorage<string>();

// Global Debug Logs array for LLM process tracking and diagnostics
interface DebugLog {
  timestamp: string;
  message: string;
}
let globalDebugLogs: DebugLog[] = [];
let sessionDebugLogs: { [sessionId: string]: DebugLog[] } = {};

function addDebugLog(msg: string, explicitSessionId?: string) {
  const timestamp = new Date().toLocaleTimeString('en-US', { hour12: false });
  
  // Truncate huge base64 data URLs globally to prevent massive bloating of diagnostic logs
  let sanitizedMsg = msg || "";
  if (typeof sanitizedMsg === 'string' && sanitizedMsg.includes("data:image/")) {
    sanitizedMsg = sanitizedMsg.replace(/(data:image\/[^;]+;base64,)[A-Za-z0-9+/=]{100,}/g, "$1... [truncated base64 image data]");
  }
  
  // Keep the container stdout clean by truncating huge multiline logs in console.log
  const singleLineLog = sanitizedMsg.replace(/\n/g, '\\n');
  if (singleLineLog.length > 300) {
    console.log(`[LLM DEBUG ${timestamp}]: ${singleLineLog.substring(0, 300)}... [Truncated ${singleLineLog.length - 300} chars. Full detailed payload is saved in session memory and visible via the Full-Screen Diagnostic Log Viewer UI]`);
  } else {
    console.log(`[LLM DEBUG ${timestamp}]: ${singleLineLog}`);
  }
  
  const sessionId = explicitSessionId || logSessionStorage.getStore() || "global";
  if (!sessionDebugLogs[sessionId]) {
    sessionDebugLogs[sessionId] = [];
  }
  sessionDebugLogs[sessionId].push({ timestamp, message: sanitizedMsg });
  if (sessionDebugLogs[sessionId].length > 1500) {
    sessionDebugLogs[sessionId].shift();
  }

  globalDebugLogs.push({ timestamp, message: sanitizedMsg });
  if (globalDebugLogs.length > 2000) {
    globalDebugLogs.shift();
  }
}

// Helper to retrieve the Google Maps Place ID from business name & location
async function fetchGoogleMapsPlaceId(businessName: string, latitude: string | number, longitude: string | number): Promise<string> {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    addDebugLog(`[get_google_maps_place_id] API Key is missing in process.env`);
    return "ERROR_API_FAILED";
  }
  
  // Use a strict AbortController timeout to prevent hangs
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);
  
  try {
    const latStr = String(latitude).trim();
    const lngStr = String(longitude).trim();
    const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(businessName)}&inputtype=textquery&locationbias=point:${latStr},${lngStr}&fields=place_id&key=${apiKey}`;
    
    addDebugLog(`[get_google_maps_place_id] Fetching place ID for "${businessName}" near (${latStr}, ${lngStr})`);
    
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);
    
    if (!res.ok) {
      addDebugLog(`[get_google_maps_place_id] Google Places API HTTP error: ${res.status}`);
      return "ERROR_API_FAILED";
    }
    const data = await res.json();
    if (data.status === "ZERO_RESULTS") {
      addDebugLog(`[get_google_maps_place_id] No results found (ZERO_RESULTS) for "${businessName}"`);
      return "NOT_FOUND";
    }
    if (data.candidates && data.candidates.length > 0) {
      const pId = data.candidates[0].place_id || "NOT_FOUND";
      addDebugLog(`[get_google_maps_place_id] Resolved successfully! Place ID: ${pId}`);
      return pId;
    }
    addDebugLog(`[get_google_maps_place_id] Status was ${data.status || 'unknown'}, candidates empty.`);
    return "NOT_FOUND";
  } catch (err: any) {
    clearTimeout(timeoutId);
    const isAbort = err.name === 'AbortError';
    const errorMsg = isAbort ? 'Request timed out after 2500ms' : (err.message || err);
    addDebugLog(`[get_google_maps_place_id] Error: ${errorMsg}`);
    return "ERROR_API_FAILED";
  }
}

function robustParseJson(cleanJson: string): any {
  let cleaned = cleanJson.replace(/\`\`\`(?:json)?/gi, "").replace(/\`\`\`/g, "").trim();
  
  // Array fallback
  if (cleaned.startsWith("[")) {
      let depth = 0;
      for (let i = 0; i < cleaned.length; i++) {
        if (cleaned[i] === "[") depth++;
        else if (cleaned[i] === "]") depth--;
        if (depth === 0) {
          return JSON.parse(cleaned.substring(0, i + 1));
        }
      }
  }
  
  return JSON.parse(extractBalancedJson(cleaned));
}
}

// Unified Multi-Provider LLM Router with automatic fallbacks & simulation modes
async function callUnifiedLLM({
  modelId,
  systemInstruction,
  promptText,
  imagePayload,
  imagePayloads,
  responseMimeType,
  googleSearch,
  enablePlaceIdTool
}: {
  modelId: string;
  systemInstruction: string;
  promptText: string;
  imagePayload?: { mimeType: string; data: string } | null;
  imagePayloads?: { mimeType: string; data: string }[] | null;
  responseMimeType?: "application/json" | "text/plain";
  googleSearch?: boolean;
  enablePlaceIdTool?: boolean;
}) {
  try {
    const isJson = responseMimeType === "application/json";
    const normalizedModelId = (modelId || "gemini-2.5-flash").toLowerCase();

  // 1. Anthropic Claude Models
  if (normalizedModelId.includes("claude-")) {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (anthropicKey) {
      console.log(`[UnifiedLLM] Calling official Anthropic API: ${normalizedModelId}`);
      try {
        const messages: any[] = [];
        const contentParts: any[] = [];
        if (imagePayloads && imagePayloads.length > 0) {
          for (const img of imagePayloads) {
            contentParts.push({
              type: "image",
              source: {
                type: "base64",
                media_type: img.mimeType,
                data: img.data
              }
            });
          }
        } else if (imagePayload) {
          contentParts.push({
            type: "image",
            source: {
              type: "base64",
              media_type: imagePayload.mimeType,
              data: imagePayload.data
            }
          });
        }
        contentParts.push({
          type: "text",
          text: promptText
        });
        messages.push({
          role: "user",
          content: contentParts
        });

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": anthropicKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            model: normalizedModelId,
            max_tokens: 4096,
            system: systemInstruction + (isJson ? " Respond strictly in valid JSON format." : ""),
            messages
          })
        });

        if (res.ok) {
          const body = (await res.json()) as any;
          return body.content?.[0]?.text || "{}";
        } else {
          const errMsg = await res.text();
          console.warn(`Anthropic API call returned non-200 status (${res.status}): ${errMsg}. Falling back to Gemini...`);
        }
      } catch (err) {
        console.warn(`Error connecting to Anthropic:`, err, `. Falling back to Gemini...`);
      }
    }
  }

  // 2. OpenAI GPT Models
  if (normalizedModelId.includes("gpt-")) {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (openaiKey) {
      console.log(`[UnifiedLLM] Calling official OpenAI API: ${normalizedModelId}`);
      try {
        const messages = [
          { role: "system", content: systemInstruction },
          { role: "user", content: [] as any }
        ];

        const userContent: any[] = [{ type: "text", text: promptText }];
        if (imagePayloads && imagePayloads.length > 0) {
          for (const img of imagePayloads) {
            userContent.push({
              type: "image_url",
              image_url: {
                url: `data:${img.mimeType};base64,${img.data}`
              }
            });
          }
        } else if (imagePayload) {
          userContent.push({
            type: "image_url",
            image_url: {
              url: `data:${imagePayload.mimeType};base64,${imagePayload.data}`
            }
          });
        }
        messages[1].content = userContent;

        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${openaiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: normalizedModelId,
            messages,
            response_format: isJson ? { type: "json_object" } : undefined
          })
        });

        if (res.ok) {
          const body = (await res.json()) as any;
          return body.choices?.[0]?.message?.content || "{}";
        } else {
          const errMsg = await res.text();
          console.warn(`OpenAI API call returned non-200 status (${res.status}): ${errMsg}. Falling back to Gemini...`);
        }
      } catch (err) {
        console.warn(`Error connecting to OpenAI:`, err, `. Falling back to Gemini...`);
      }
    }
  }

  // 3. DeepSeek Models
  if (normalizedModelId.includes("deepseek-")) {
    const deepseekKey = process.env.DEEPSEEK_API_KEY;
    if (deepseekKey) {
      console.log(`[UnifiedLLM] Calling official DeepSeek API: ${normalizedModelId}`);
      try {
        const messages = [
          { role: "system", content: systemInstruction },
          { role: "user", content: promptText }
        ];

        const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${deepseekKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            model: normalizedModelId === "deepseek-chat" ? "deepseek-chat" : "deepseek-reasoner",
            messages,
            response_format: isJson ? { type: "json_object" } : undefined
          })
        });

        if (res.ok) {
          const body = (await res.json()) as any;
          return body.choices?.[0]?.message?.content || "{}";
        } else {
          const errMsg = await res.text();
          console.warn(`DeepSeek API call returned non-200 status (${res.status}): ${errMsg}. Falling back to Gemini...`);
        }
      } catch (err) {
        console.warn(`Error connecting to DeepSeek:`, err, `. Falling back to Gemini...`);
      }
    }
  }

  // 4. Gemini SDK Default/Simulation Fallback
  console.log(`[UnifiedLLM] Routing/Falling back to Gemini model mapping from requested model: ${normalizedModelId}`);
  const ai = getGeminiClient();

  // Map choices to appropriate Google SDK model IDs
  let targetGeminiModel = "gemini-3.5-flash";
  if (normalizedModelId.includes("deep-research") || normalizedModelId.includes("pro")) {
    targetGeminiModel = "gemini-3.1-pro-preview";
  } else if (normalizedModelId.includes("3.1-flash-lite")) {
    targetGeminiModel = "gemini-3.1-flash-lite";
  } else if (normalizedModelId.includes("3.1-flash") || normalizedModelId.includes("3.5-flash")) {
    targetGeminiModel = "gemini-3.5-flash";
  } else if (normalizedModelId.includes("2.5-flash-lite")) {
    targetGeminiModel = "gemini-2.5-flash-lite";
  } else if (normalizedModelId.includes("2.5-flash")) {
    targetGeminiModel = "gemini-2.5-flash";
  } else if (normalizedModelId === "gemini-2.5") {
    targetGeminiModel = "gemini-2.5-pro";
  } else if (normalizedModelId.includes("3-flash") || normalizedModelId.includes("3.0-flash")) {
    targetGeminiModel = "gemini-3.0-flash";
  }

  const initialParts: any[] = [];
  if (imagePayloads && imagePayloads.length > 0) {
    for (const img of imagePayloads) {
      initialParts.push({
        inlineData: {
          mimeType: img.mimeType,
          data: img.data
        }
      });
    }
  } else if (imagePayload) {
    initialParts.push({
      inlineData: {
        mimeType: imagePayload.mimeType,
        data: imagePayload.data
      }
    });
  }

  // Prepend simulated header to instruction if simulating a third-party engine on Gemini
  let resolvedInstruction = systemInstruction;
  if (!normalizedModelId.includes("gemini")) {
    resolvedInstruction = `[System Simulation: Adopt the persona of model '${normalizedModelId}' for this request. Respond as accurately and characteristically as possible while strictly observing the requested JSON format constraints.]\n\n${systemInstruction}`;
  }

  initialParts.push({ text: promptText });

  const contents: any[] = [
    {
      role: "user",
      parts: initialParts
    }
  ];

  const configObj: any = {
    responseMimeType: isJson ? "application/json" : "text/plain",
    systemInstruction: resolvedInstruction,
    tools: []
  };
  
  if (googleSearch) {
    configObj.tools.push({ googleSearch: {} });
  }

  if (enablePlaceIdTool) {
    configObj.tools.push({
      functionDeclarations: [
        {
          name: "get_google_maps_place_id",
          description: "Retrieves the exact Google Maps Place ID when given a business name and coordinates.",
          parameters: {
            type: Type.OBJECT,
            properties: {
              business_name: { type: Type.STRING },
              latitude: { type: Type.STRING },
              longitude: { type: Type.STRING }
            },
            required: ["business_name", "latitude", "longitude"]
          }
        }
      ]
    });
  }

  if (googleSearch && enablePlaceIdTool) {
    configObj.toolConfig = { includeServerSideToolInvocations: true };
  }

  if (configObj.tools.length === 0) {
    delete configObj.tools;
  }

  let finalResponseText = "{}";
  addDebugLog(`[UnifiedLLM] Dispatching prompt to model: "${targetGeminiModel}". Contents turns: ${contents.length}.`);
  addDebugLog(`[UnifiedLLM-Prompt] System Instruction:\n${resolvedInstruction}`);
  addDebugLog(`[UnifiedLLM-Prompt] User Prompt:\n${promptText}`);
  try {
    let response = await ai.models.generateContent({
      model: targetGeminiModel,
      contents,
      config: configObj
    });
    
    // Handle function calls loop
    let callCount = 0;
    const maxCalls = 5;
    while (response.functionCalls && response.functionCalls.length > 0 && callCount < maxCalls) {
      callCount++;
      const calls = response.functionCalls;
      addDebugLog(`[UnifiedLLM] Received ${calls.length} tool call requests from Gemini (Turn ${callCount}/${maxCalls}).`);
      const modelParts: any[] = [];
      const userParts: any[] = [];

      for (const call of calls) {
        let functionResponseData = {};
        if (call.name === "get_google_maps_place_id") {
          try {
            const { business_name, latitude, longitude } = call.args as any;
            addDebugLog(`[UnifiedLLM] Call args: business_name="${business_name}", lat="${latitude}", lng="${longitude}"`);
            const pId = await fetchGoogleMapsPlaceId(business_name, latitude, longitude);
            if (pId === "ERROR_API_FAILED" || pId === "NOT_FOUND") {
              functionResponseData = { 
                place_id: "NOT_FOUND", 
                instruction: "STOP TOOL USE. The Google Maps API call failed or the key is missing. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
              };
            } else {
              functionResponseData = { place_id: pId };
            }
          } catch (e: any) {
            addDebugLog(`[UnifiedLLM] Exception executing tool call: ${e.message || e}`);
            functionResponseData = { 
              place_id: "NOT_FOUND", 
              instruction: "STOP TOOL USE. An exception occurred during tool execution. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
            };
          }
        } else {
          addDebugLog(`[UnifiedLLM] Warning: Unknown tool requested: "${call.name}"`);
        }
        
        modelParts.push({ functionCall: call });
        userParts.push({
          functionResponse: {
            name: call.name,
            response: functionResponseData
          }
        });
      }

      // Add the model's response (preserving thought_signature and candidates structure) to contents
      const modelContent = response.candidates?.[0]?.content;
      if (modelContent) {
        contents.push(modelContent);
      } else {
        contents.push({
          role: "model",
          parts: modelParts
        });
      }

      // Add our function responses to contents
      contents.push({
        role: "user",
        parts: userParts
      });

      addDebugLog(`[UnifiedLLM] Feeding responses back to Gemini and requesting next content turn...`);
      response = await ai.models.generateContent({
        model: targetGeminiModel,
        contents,
        config: configObj
      });
    }

    if ((response.functionCalls && response.functionCalls.length > 0) || !response.text) {
      addDebugLog(`[UnifiedLLM] Reached maximum tool calls or text is empty. Forcing model to produce final text...`);
      contents.push({
        role: "user",
        parts: [{ text: "Please provide your final JSON response now based on the information retrieved so far. Do not call any more tools." }]
      });
      const forceTextConfig = { ...configObj };
      delete forceTextConfig.tools;
      delete forceTextConfig.toolConfig;
      response = await ai.models.generateContent({
        model: targetGeminiModel,
        contents,
        config: forceTextConfig
      });
    }
    
    addDebugLog(`[UnifiedLLM] Successfully completed content generation. Response length: ${response.text?.length || 0} chars.`);
    addDebugLog(`[UnifiedLLM-Response] Complete response returned from agent:\n${response.text || "{}"}`);
    return response.text || "{}";
  } catch (err: any) {
    addDebugLog(`[UnifiedLLM] First generation attempt failed: ${err.message || err}. Stack: ${err.stack}`);
    if (googleSearch) {
      addDebugLog(`[UnifiedLLM] Retrying without Google Search Grounding...`);
      const fallbackConfig = { ...configObj };
      delete fallbackConfig.tools;
      if (enablePlaceIdTool) {
        // keep the custom tool
        fallbackConfig.tools = [{
          functionDeclarations: [
            {
              name: "get_google_maps_place_id",
              description: "Retrieves the exact Google Maps Place ID when given a business name and coordinates.",
              parameters: {
                type: Type.OBJECT,
                properties: {
                  business_name: { type: Type.STRING },
                  latitude: { type: Type.STRING },
                  longitude: { type: Type.STRING }
                },
                required: ["business_name", "latitude", "longitude"]
              }
            }
          ]
        }];
      }
      try {
        // Reset contents to initial state for fallback to avoid duplicated turns
        const fallbackContents = [contents[0]];
        addDebugLog(`[UnifiedLLM-Fallback] Dispatching prompt to model without search grounding...`);
        let response = await ai.models.generateContent({
          model: targetGeminiModel,
          contents: fallbackContents,
          config: fallbackConfig
        });
        
        // Handle function calls loop for fallback
        let callCountFallback = 0;
        const maxCallsFallback = 5;
        while (response.functionCalls && response.functionCalls.length > 0 && callCountFallback < maxCallsFallback) {
          callCountFallback++;
          const calls = response.functionCalls;
          addDebugLog(`[UnifiedLLM-Fallback] Received ${calls.length} tool call requests (Turn ${callCountFallback}/${maxCallsFallback}).`);
          const modelParts: any[] = [];
          const userParts: any[] = [];

          for (const call of calls) {
            let functionResponseData = {};
            if (call.name === "get_google_maps_place_id") {
              try {
                const { business_name, latitude, longitude } = call.args as any;
                addDebugLog(`[UnifiedLLM-Fallback] Call args: business_name="${business_name}", lat="${latitude}", lng="${longitude}"`);
                const pId = await fetchGoogleMapsPlaceId(business_name, latitude, longitude);
                if (pId === "ERROR_API_FAILED" || pId === "NOT_FOUND") {
                  functionResponseData = { 
                    place_id: "NOT_FOUND", 
                    instruction: "STOP TOOL USE. The Google Maps API call failed or the key is missing. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
                  };
                } else {
                  functionResponseData = { place_id: pId };
                }
              } catch (e: any) {
                addDebugLog(`[UnifiedLLM-Fallback] Exception executing tool call: ${e.message || e}`);
                functionResponseData = { 
                  place_id: "NOT_FOUND", 
                  instruction: "STOP TOOL USE. An exception occurred during tool execution. Immediately use standard coordinate URLs for all remaining items without calling this tool again." 
                };
              }
            }
            
            modelParts.push({ functionCall: call });
            userParts.push({
              functionResponse: {
                name: call.name,
                response: functionResponseData
              }
            });
          }

          const modelContent = response.candidates?.[0]?.content;
          if (modelContent) {
            fallbackContents.push(modelContent);
          } else {
            fallbackContents.push({ role: "model", parts: modelParts });
          }
          fallbackContents.push({ role: "user", parts: userParts });

          addDebugLog(`[UnifiedLLM-Fallback] Feeding responses back to Gemini...`);
          response = await ai.models.generateContent({
            model: targetGeminiModel,
            contents: fallbackContents,
            config: fallbackConfig
          });
        }

        if ((response.functionCalls && response.functionCalls.length > 0) || !response.text) {
          addDebugLog(`[UnifiedLLM-Fallback] Reached maximum tool calls or text is empty on fallback. Forcing final text...`);
          fallbackContents.push({
            role: "user",
            parts: [{ text: "Please provide your final JSON response now based on the information retrieved so far. Do not call any more tools." }]
          });
          const forceTextConfig = { ...fallbackConfig };
          delete forceTextConfig.tools;
          delete forceTextConfig.toolConfig;
          response = await ai.models.generateContent({
            model: targetGeminiModel,
            contents: fallbackContents,
            config: forceTextConfig
          });
        }
        
        addDebugLog(`[UnifiedLLM-Fallback] Successfully completed content generation on fallback. Response length: ${response.text?.length || 0} chars.`);
        addDebugLog(`[UnifiedLLM-Fallback-Response] Complete response returned from agent on fallback:\n${response.text || "{}"}`);
        return response.text || "{}";
      } catch (retryErr: any) {
        addDebugLog(`[UnifiedLLM-Fallback] Error on fallback retry: ${retryErr.message || retryErr}`);
        throw retryErr;
      }
    } else {
      addDebugLog(`[UnifiedLLM] No googleSearch fallback available. Attempting REST API fallback to bypass SDK bugs...`);
      try {
        const restPayload = {
          systemInstruction: { parts: [{ text: resolvedInstruction }] },
          contents: [
            { role: "user", parts: initialParts }
          ],
          generationConfig: {
            responseMimeType: isJson ? "application/json" : "text/plain"
          }
        } as any;
        
        if (enablePlaceIdTool) {
          restPayload.tools = [{
            functionDeclarations: [
              {
                name: "get_google_maps_place_id",
                description: "Retrieves the exact Google Maps Place ID when given a business name and coordinates.",
                parameters: {
                  type: "OBJECT",
                  properties: {
                    business_name: { type: "STRING" },
                    latitude: { type: "STRING" },
                    longitude: { type: "STRING" }
                  },
                  required: ["business_name", "latitude", "longitude"]
                }
              }
            ]
          }];
        }
        
        const restRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${targetGeminiModel}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(restPayload)
        });
        if (!restRes.ok) {
          let errMsg = `API request failed: ${restRes.status}`;
          try { const errData = await restRes.json(); errMsg = errData.error?.message || errMsg; } catch {}
          throw new Error(errMsg);
        }
        const data = await restRes.json();
        return data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
      } catch (restErr: any) {
        addDebugLog(`[UnifiedLLM] REST API fallback also failed: ${restErr.message}`);
        throw err; // Throw the original SDK error if REST fails
      }
    }
  }
  } catch (err: any) {
    if (modelId !== "gemini-2.5-flash-lite" && modelId !== "gemini-2.5-flash") {
      addDebugLog(`[UnifiedLLM-Recovery] Error during primary execution of model "${modelId}": ${err.message || err}. Retrying with highly stable fallback gemini-2.5-flash...`);
      return callUnifiedLLM({
        modelId: "gemini-2.5-flash",
        systemInstruction,
        promptText,
        imagePayload,
        imagePayloads,
        responseMimeType,
        googleSearch,
        enablePlaceIdTool
      });
    }
    throw err;
  }
}

// Endpoint to fetch real server start/uptime status for accurate publication timing
app.get("/api/status", (req, res) => {
  res.json({ startTime: SERVER_START_TIME });
});

// Sync endpoints
app.post("/api/sync/save", async (req, res) => {
  try {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
      return res.status(401).json({ error: 'Unauthorized: missing token' });
    }
    try {
      const decoded = await adminAuth.verifyIdToken(idToken);
      if (decoded.email?.toLowerCase() !== (req.body.email || '').toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden: email mismatch' });
      }
    } catch (e) {
      return res.status(401).json({ error: 'Unauthorized: invalid token' });
    }
    const { email, data } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required for syncing" });
    }
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9@.]/g, "_");
    const filePath = path.join(SYNC_DIR, `${safeEmail}.json`);
    
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
    console.log(`[Sync Save] Saved data for email: ${email}`);
    res.json({ success: true, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error("[Sync Save] Error:", error);
    res.status(500).json({ error: "Failed to sync save data to server database" });
  }
});

app.post("/api/sync/load", async (req, res) => {
  try {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) {
      return res.status(401).json({ error: 'Unauthorized: missing token' });
    }
    try {
      const decoded = await adminAuth.verifyIdToken(idToken);
      if (decoded.email?.toLowerCase() !== (req.body.email || '').toLowerCase()) {
        return res.status(403).json({ error: 'Forbidden: email mismatch' });
      }
    } catch (e) {
      return res.status(401).json({ error: 'Unauthorized: invalid token' });
    }
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required for syncing" });
    }
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9@.]/g, "_");
    const filePath = path.join(SYNC_DIR, `${safeEmail}.json`);
    
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      console.log(`[Sync Load] Loaded data for email: ${email}`);
      return res.json({ success: true, data: JSON.parse(content) });
    }
    
    console.log(`[Sync Load] No existing cloud record for email: ${email}`);
    res.json({ success: true, data: null });
  } catch (error) {
    console.error("[Sync Load] Error:", error);
    res.status(500).json({ error: "Failed to retrieve sync data from server database" });
  }
});

// Gemini Food Analyze Endpoint
app.post("/api/gemini/food-analyze", async (req, res) => {
  try {
    const { message, image, images, imageDates, history, userProfile, engine, biomarkersNeedingImprovement, remainingAllowance, userId, activeMeal, customSystemInstruction, customVariableData } = req.body;

    // 1. Intercept prompt & read current active state from Request Body (passed from client)
    if (activeMeal) {
      addDebugLog(`[Client State] Received active meal: ${activeMeal.name}`);
    } else {
      addDebugLog(`[Client State] No active meal received.`);
    }

    // Check if key is mock
    if (process.env.GEMINI_API_KEY === undefined) {
      // If the user's message is a modify request, let's execute modify command offline!
      const isModifyRequest = message.toLowerCase().includes("change") || message.toLowerCase().includes("modify") || message.toLowerCase().includes("update") || message.toLowerCase().includes("remove") || message.toLowerCase().includes("add") || message.toLowerCase().includes("gram");
      
      if (isModifyRequest && activeMeal) {
        // Let's create an offline mock command
        let mockCommand: any = null;
        if (message.toLowerCase().includes("steak")) {
          const match = message.match(/(\d+)\s*g/);
          const grams = match ? Number(match[1]) : 100;
          mockCommand = { action: "update_weight", itemName: "Beef Steak", newWeightGrams: grams };
        } else if (message.toLowerCase().includes("remove")) {
          mockCommand = { action: "remove_item", itemName: "Beef Steak" };
        } else {
          const match = message.match(/(\d+)\s*g/);
          const grams = match ? Number(match[1]) : 120;
          mockCommand = { action: "add_item", itemName: "Extra Topping", newWeightGrams: grams };
        }

        const originalTotalWeight = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0) || 1;
        
        if (mockCommand) {
          if (mockCommand.action === "update_weight") {
            const item = activeMeal.itemsBreakdown?.find((it: any) => it.name.toLowerCase().includes(mockCommand.itemName.toLowerCase()));
            if (item) {
              const oldWeight = Number(item.weightGrams) || 1;
              const R = mockCommand.newWeightGrams / oldWeight;
              item.weightGrams = mockCommand.newWeightGrams;
              item.calories = Number((item.calories * R).toFixed(1));
              item.saturatedFat = Number((item.saturatedFat * R).toFixed(2));
              item.sodium = Number((item.sodium * R).toFixed(1));
            }
          } else if (mockCommand.action === "remove_item") {
            const idx = activeMeal.itemsBreakdown?.findIndex((it: any) => it.name.toLowerCase().includes(mockCommand.itemName.toLowerCase()));
            if (idx !== -1) {
              activeMeal.itemsBreakdown.splice(idx, 1);
            }
          } else if (mockCommand.action === "add_item") {
            if (!activeMeal.itemsBreakdown) activeMeal.itemsBreakdown = [];
            activeMeal.itemsBreakdown.push({
              name: mockCommand.itemName,
              weightGrams: mockCommand.newWeightGrams,
              calories: mockCommand.newWeightGrams * 1.5,
              saturatedFat: mockCommand.newWeightGrams * 0.02,
              sodium: mockCommand.newWeightGrams * 0.5
            });
          }
        }

        const newTotalWeight = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0);
        const mealWeightRatio = newTotalWeight / originalTotalWeight;

        activeMeal.weightGrams = newTotalWeight;
        activeMeal.composition = (activeMeal.itemsBreakdown || []).map((it: any) => it.name).join(", ");
        
        const newCalories = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.calories) || 0), 0);
        const newSaturatedFat = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.saturatedFat) || 0), 0);
        const newSodium = (activeMeal.itemsBreakdown || []).reduce((acc: number, it: any) => acc + (Number(it.sodium) || 0), 0);

        activeMeal.nutrients.calories = Number(newCalories.toFixed(1));
        activeMeal.nutrients.saturatedFat = Number(newSaturatedFat.toFixed(2));
        activeMeal.nutrients.sodium = Number(newSodium.toFixed(1));

        for (const key of Object.keys(activeMeal.nutrients)) {
          if (key !== "calories" && key !== "saturatedFat" && key !== "sodium") {
            activeMeal.nutrients[key] = Number((activeMeal.nutrients[key] * mealWeightRatio).toFixed(2));
          }
        }

        // We removed offline mock write to user_meals to avoid permission issues

        return res.json({
          text: `[Simulated Offline Mod] Modifying active meal: **${activeMeal.name}** to new weights/items. Recalculated all 30 sub-nutrients mathematically offline to save tokens and ensure precision.`,
          data: activeMeal
        });
      }

      const isDiscussionRequest = message.toLowerCase().includes("why") || message.toLowerCase().includes("explain") || message.toLowerCase().includes("question");
      if (isDiscussionRequest) {
        return res.json({
          text: "This is a simulated conversational answer about your active meal ingredients, explaining that avocado and salmon are rich sources of dietary fibre and heart-healthy monounsaturated fatty acids.",
          data: null
        });
      }

      return res.json({
        error: "The food log agent is not available. Please enter the food details manually.",
        agentNotAvailable: true
      });
    }

    let imagePayloads = null;
    if (images && Array.isArray(images) && images.length > 0) {
      imagePayloads = images.map((imgStr: string) => {
        const mimeType = imgStr.split(";")[0].split(":")[1] || "image/jpeg";
        const base64Data = imgStr.split(",")[1];
        return { mimeType, data: base64Data };
      });
    } else if (image) {
      const mimeType = image.split(";")[0].split(":")[1] || "image/jpeg";
      const base64Data = image.split(",")[1];
      imagePayloads = [{ mimeType, data: base64Data }];
    }

    let userCtx = "";
    if (userProfile) {
      userCtx = `\nUSER DIETARY PROFILE & DEMOGRAPHICS:\n` +
        `- Age: ${userProfile.age || 'Unknown'} years old\n` +
        `- Gender: ${userProfile.gender || 'Unknown'}\n` +
        `- Weight: ${userProfile.weight || 'Unknown'} kg\n` +
        `- Height: ${userProfile.height || 'Unknown'} cm\n` +
        `- Ethnicity: ${userProfile.ethnicity || 'Unknown'}\n`;
    }

    const userTimezone = req.body.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    let localDateStr;
    try {
      const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: userTimezone, year: 'numeric', month: '2-digit', day: '2-digit' });
      localDateStr = formatter.format(new Date());
    } catch(e) {
      localDateStr = new Date().toISOString().split("T")[0];
    }
    const localTime = new Date().toLocaleTimeString();
    const timeCtx = `\nCURRENT TIME CONTEXT: ${localDateStr} ${localTime}\nCRITICAL INSTRUCTION: You MUST use "${localDateStr}" in the "date" field of "foodData" unless the user explicitly provides a different date in the chat.\n`;

    let imageCtx = "";
    if (imagePayloads && imagePayloads.length > 0) {
      imageCtx = `\n[Context: An image of the meal is uploaded and attached above. Rely heavily on visual cues in the picture for portion sizing, ingredients, and freshness.]\n`;
      if (imageDates && imageDates.length > 0) {
        const primaryImageDate = imageDates[0];
        imageCtx += `\n[CRITICAL DATE OVERRIDE: The uploaded image was taken on ${primaryImageDate}. You MUST use this exact date or its nearest YYYY-MM-DD representation as the "date" field in "foodData", completely overriding the CURRENT TIME CONTEXT, unless the user explicitly asks otherwise.]\n`;
      }
    }

    let historyContext = "";
    if (history && Array.isArray(history) && history.length > 0) {
      historyContext = "PAST DISCUSSIONS & MEALS CHAT HISTORY:\n" +
        history.slice(-10).map((h: any) => `${h.role.toUpperCase()}: ${h.content}`).join("\n") + "\n\n";
    }

    // 2. Prepend active state to Master System Instructions
    const biomarkersList = biomarkersNeedingImprovement && Array.isArray(biomarkersNeedingImprovement) && biomarkersNeedingImprovement.length > 0
      ? biomarkersNeedingImprovement.map((b: string) => `• ${b}`).join("\n")
      : "• None";

    const targetLimits = remainingAllowance
      ? `• Calories: ${remainingAllowance.calories} kcal remaining | Saturated Fat: ${remainingAllowance.saturatedFat}g remaining | Sodium: ${remainingAllowance.sodium}mg remaining`
      : "• Calories: 2000 kcal remaining | Saturated Fat: 20g remaining | Sodium: 2300mg remaining";

    // Clean activeMeal by replacing huge base64 strings before stringifying to save token costs and prevent logs bloating
    let sanitizedActiveMeal = null;
    if (activeMeal) {
      sanitizedActiveMeal = { ...activeMeal };
      if (sanitizedActiveMeal.imageUrl && sanitizedActiveMeal.imageUrl.startsWith("data:image/")) {
        sanitizedActiveMeal.imageUrl = "[base64_image_data_truncated]";
      }
      if (sanitizedActiveMeal.imageUrls && Array.isArray(sanitizedActiveMeal.imageUrls)) {
        sanitizedActiveMeal.imageUrls = sanitizedActiveMeal.imageUrls.map((url: string) => 
          url && url.startsWith("data:image/") ? "[base64_image_data_truncated]" : url
        );
      }
      if (sanitizedActiveMeal.chatTranscript) {
        delete sanitizedActiveMeal.chatTranscript;
      }
    }

    const mealStr = sanitizedActiveMeal ? JSON.stringify(sanitizedActiveMeal, null, 2) : "None";

    const systemInstruction = `CURRENT_ACTIVE_MEAL_STATE: ${mealStr}

You are an expert clinical dietitian and nutritional LLM analyzer operating within an automated personalized health ecosystem. Your response must be an exact single YAML object matching the requested structure. Never add markdown formatting wrappers like \`\`\`yaml unless instructed.

=== PATIENT CONTEXT PAYLOAD ===
CRITICAL PATIENT BIOMARKER WARNINGS & NUTRITIONAL DIRECTIVES:
${biomarkersList}
- If LDL-C/cholesterol is HIGH, any food high in saturated fat is EXTREMELY harmful. Rate as "bad" and warn in "risks".
- If Blood Pressure/Sodium is HIGH, any food high in sodium is EXTREMELY harmful. Rate as "bad".

TODAY'S REMAINING NUTRITIONAL TARGET LIMITS:
${targetLimits}

=== UNIVERSAL HEALTH DIRECTIVE (STRICT) ===
TRANS FAT AVOIDANCE: Trans fat (partially hydrogenated oils) is universally harmful and must be avoided regardless of the patient's specific biomarkers. Always aggressively flag any food likely to contain trans fats (e.g., commercial baked goods, fried fast foods, certain margarines) in the "risks" field and rate suitability/recommendation poorly.

=== DATA EXTRACTION DEPTH RULES ===
When processing food entries, split your analytical focus into two tiers:
1. CORE NUTRIENTS (Top 11: Calories, Protein, Carbohydrates, Total Fat, Saturated Fat, Trans Fat, Added Sugar, Sodium, Potassium, Total Fibre, Soluble Fibre): Execute deep reasoning. Analyze the meal description or image for hidden ingredients, preparation methods, and ingredient distribution density to ensure high contextual precision.
2. SYSTEMIC BASELINES (Other trace vitamins/minerals): Do not waste analytical compute. The backend will apply standard, generic nutritional database averages for these based on your "canonicalDbName" output.

=== MODE ROUTING DIRECTIVE ===
Operate in one of four distinct modes based on current user intent:

MODE A: NEW FOOD LOGGING (Triggered by a new food item description or image)
- Extract and map ingredients to standard, database-friendly food classifications in "canonicalDbName".
- Estimate total visual/described item portion weights in "weightGrams".
- Do NOT output nutrient values directly. The backend database will handle the calculations.
- Set "mode": "new_log". Provide the "foodData" block.

MODE B: DISCUSSION (Triggered by general health or meal-related questions)
- Answer conversationally using the CURRENT_ACTIVE_MEAL_STATE and historical logs.
- Set "mode": "discussion". Set structural data objects to null.

MODE C: MODIFICATION COMMAND (Triggered by requests to alter a logged meal state)
- Output functional instructions to modify ingredients or weights. Do not compute math yourself.
- Set "mode": "modify". Populate the "modificationCommand" array.

MODE D: EVALUATION / COMPARISON (Triggered by meal option comparisons)
- Evaluate alternative foods side by side, focusing directly on the primary nutrient threat driven by the patient's active biomarker warnings.
- Set "mode": "evaluation". Provide the complete "comparison" object.

YAML SCHEMA STRICT REQUIREMENT:
Respond ONLY with a structured YAML format matching this schema exactly. Values must be dynamically derived from the patient's specific profile conditions and injected directives.

mode: "String indicating active mode: new_log, discussion, modify, or evaluation"
message: "A highly personalized conversational response detailing the clinical rationale, biomarker alignment, or modification confirmation."
modificationCommand: null or list of:
  - action: "update_weight" | "remove_item" | "add_item"
    itemName: "Literal name of the item from the active state to change"
    newWeightGrams: number
foodData: null or:
  date: "YYYY-MM-DD (Dynamically set based on provided current time context)"
  name: "Literal food name"
  composition: "Brief operational summary of food ingredients"
  weightGrams: number
  quantity: "Visual descriptive serving size (e.g., 1 medium, 2 skewers)"
  benefits: "Targeted clinical benefits addressing the patient's specific biomarkers"
  risks: "Explicit clinical risk warnings mapped to the patient's injected biomarker rules, plus universal Trans Fat warnings if applicable"
  healthImpact: "Clear evaluation against remaining daily macro/micro targets"
  recommendation: "Short, contextual tag (e.g., 'Best today', 'Heart-healthy', 'Caution: High Sodium', 'Perfect for target')"
  itemsBreakdown:
    - canonicalDbName: "Standardized target food name for local DB query execution"
      weightGrams: number
comparison: null or:
  keyNutrientConcern: "The specific nutrient string causing primary clinical concern for this profile session"
  foods:
    - name: "Food option item name"
      weightGrams: number
      suitability: "Short, contextual tag (e.g., 'Safest option', 'Moderate risk', 'Avoid')"
      pros: "Targeted biomarker benefits"
      cons: "Targeted biomarker risks"
  comparisonTableYaml:
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
        target: "value"
`;

    const finalSystemInstruction = customSystemInstruction || systemInstruction;
    const promptText = customVariableData 
      ? `${customVariableData}\n\nCurrent User Input: "${message}"`
      : `${historyContext}Analyze this current food request.
${userCtx}
${timeCtx}
${imageCtx}
 
Current User Input: "${message}"`;

    const fullPromptSent = `System Instruction:\n${finalSystemInstruction}\n\n${promptText}`;
    addDebugLog(`[RouteAgent Chat] Sending request to Gemini...`);
    const textOutput = await callUnifiedLLM({
      modelId: engine || "gemini-2.5-flash",
      systemInstruction: finalSystemInstruction,
      promptText,
      imagePayloads,
      responseMimeType: "text/plain"
    });

    addDebugLog(`[RouteAgent Chat] Received response from Gemini. Length: ${textOutput.length} chars.`);
    let cleanYaml = textOutput.replace(/```(?:yaml|json)?/gi, "").trim();
    let rawParsed;
    try {
      rawParsed = YAML.parse(cleanYaml);
    } catch (parseErr: any) {
      addDebugLog(`[YAML Parse Error] Standard YAML parse failed: ${parseErr.message}. Trying JSON parser...`);
      try {
        rawParsed = JSON.parse(cleanYaml);
      } catch (jsonErr: any) {
        addDebugLog(`[JSON Parse Error] JSON parse also failed: ${jsonErr.message}.`);
        throw parseErr;
      }
    }

    const mode = rawParsed.mode || "new_log";

    // CASE B: discussion mode
    if (mode === "discussion") {
      addDebugLog(`[Mode Routing] DISCUSSION mode triggered (0 database operations).`);
      return res.json({
        mode: "discussion",
        text: rawParsed.message || "Here is the details on this meal composition.",
        data: null,
        agentPrompt: fullPromptSent
      });
    }

    // CASE D: evaluation mode
    if (mode === "evaluation") {
      addDebugLog(`[Mode Routing] EVALUATION mode triggered.`);
      return res.json({
        mode: "evaluation",
        text: rawParsed.message || "Here is the comparison between the options.",
        comparison: rawParsed.comparison || null,
        agentPrompt: fullPromptSent
      });
    }

    // CASE A: new food logging mode
    if (mode === "new_log") {
      const rawFoodData = rawParsed.foodData;
      if (!rawFoodData) {
        throw new Error("No foodData returned by LLM in new_log mode.");
      }

      const parsedData: any = {};
      const sanitizeString = (val: any, fallback: string) => {
        if (val === null || val === undefined || String(val).toLowerCase() === "undefined" || String(val).trim() === "") {
          return fallback;
        }
        return String(val);
      };

      parsedData.name = sanitizeString(rawFoodData.name, "Meal Log");
      parsedData.date = sanitizeString(rawFoodData.date, new Date().toISOString().split("T")[0]);
      parsedData.composition = sanitizeString(rawFoodData.composition, "Unspecified ingredients");
      
      const totalWeightGrams = Number(rawFoodData.weightGrams) || 150;
      parsedData.weightGrams = totalWeightGrams;
      parsedData.quantity = sanitizeString(rawFoodData.quantity, "1 serving");
      parsedData.benefits = sanitizeString(rawFoodData.benefits, "Provides foundational vitamins, minerals, and macronutrients.");
      parsedData.risks = sanitizeString(rawFoodData.risks, "No specific adverse biomarkers flagged for your profile.");
      parsedData.healthImpact = sanitizeString(rawFoodData.healthImpact, "Contributes to daily macro and micronutrient requirements.");
      parsedData.recommendation = sanitizeString(rawFoodData.recommendation, "neutral");

      const nutrientKeys = [
        "calories", "protein", "totalFat", "saturatedFat", "transFat", "unsaturatedFat", "omega3", 
        "carbohydrates", "addedSugar", "totalFibre", "solubleFibre", "sodium", "potassium", 
        "magnesium", "calcium", "iron", "zinc", "selenium", "iodine", "phosphorus", 
        "vitaminD", "vitaminB12", "folate", "vitaminC", "vitaminE", "vitaminK", 
        "vitaminA", "vitaminB6", "thiamine", "riboflavin", "niacin"
      ];

      // Initialize all nutrients to 0
      parsedData.nutrients = {};
      for (const key of nutrientKeys) {
        parsedData.nutrients[key] = 0;
      }

      // Map and construct itemsBreakdown using the high-precision standard foods database
      if (rawFoodData.itemsBreakdown && Array.isArray(rawFoodData.itemsBreakdown) && rawFoodData.itemsBreakdown.length > 0) {
        parsedData.itemsBreakdown = rawFoodData.itemsBreakdown.map((item: any) => {
          const canonicalName = sanitizeString(item.canonicalDbName || item.name, "Unspecified Item");
          const itemWeight = Number(item.weightGrams) || Math.round(totalWeightGrams / rawFoodData.itemsBreakdown.length);
          
          // Get the precise standard nutrients scaled for this item
          const itemNutrients = getNutrientsForFood(canonicalName, itemWeight);

          // Add to aggregated nutrients
          for (const key of nutrientKeys) {
            parsedData.nutrients[key] = parseFloat((parsedData.nutrients[key] + (itemNutrients[key as keyof typeof itemNutrients] || 0)).toFixed(2));
          }

          return {
            name: canonicalName,
            weightGrams: itemWeight,
            calories: itemNutrients.calories || 0,
            saturatedFat: itemNutrients.saturatedFat || 0,
            sodium: itemNutrients.sodium || 0
          };
        });
      } else {
        // Fallback: look up the whole food name in our high-precision database
        const itemNutrients = getNutrientsForFood(parsedData.name, totalWeightGrams);
        for (const key of nutrientKeys) {
          parsedData.nutrients[key] = itemNutrients[key as keyof typeof itemNutrients] || 0;
        }
        parsedData.itemsBreakdown = [
          {
            name: parsedData.name,
            weightGrams: totalWeightGrams,
            calories: itemNutrients.calories || 0,
            saturatedFat: itemNutrients.saturatedFat || 0,
            sodium: itemNutrients.sodium || 0
          }
        ];
      }

      return res.json({
        text: rawParsed.message || `I have analyzed the food: **${parsedData.name}** (${parsedData.quantity}).`,
        data: parsedData,
        agentPrompt: fullPromptSent
      });
    }

    // CASE C: modification commands mode
    if (mode === "modify") {
      addDebugLog(`[Mode Routing] MODIFY mode triggered.`);
      
      if (!activeMeal) {
        addDebugLog(`[Modify Math Error] No active meal exists in Firestore to modify.`);
        return res.json({
          text: rawParsed.message || "I couldn't modify the meal because there's no active meal currently logged. Please log a meal first!",
          data: null
        });
      }

      const commands = rawParsed.modificationCommand;
      if (!commands || !Array.isArray(commands) || commands.length === 0) {
        addDebugLog(`[Modify Math Error] Modification command array was empty or null.`);
        return res.json({
          text: rawParsed.message || "I received a modify request but no modification instructions were provided.",
          data: activeMeal
        });
      }

      const originalItems = activeMeal.itemsBreakdown || [];
      const originalTotalWeight = originalItems.reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0) || 1;

      const standardItems: {[key: string]: {calories: number, saturatedFat: number, sodium: number}} = {
        steak: { calories: 2.5, saturatedFat: 0.05, sodium: 1.8 },
        beef: { calories: 2.5, saturatedFat: 0.05, sodium: 1.8 },
        chicken: { calories: 1.65, saturatedFat: 0.01, sodium: 0.7 },
        breast: { calories: 1.65, saturatedFat: 0.01, sodium: 0.7 },
        pork: { calories: 2.4, saturatedFat: 0.03, sodium: 0.8 },
        fish: { calories: 1.5, saturatedFat: 0.01, sodium: 0.8 },
        salmon: { calories: 2.0, saturatedFat: 0.015, sodium: 0.5 },
        rice: { calories: 1.3, saturatedFat: 0.0, sodium: 0.01 },
        broccoli: { calories: 0.35, saturatedFat: 0.0, sodium: 0.3 },
        egg: { calories: 1.5, saturatedFat: 0.03, sodium: 1.4 },
        avocado: { calories: 1.6, saturatedFat: 0.02, sodium: 0.07 },
        bread: { calories: 2.6, saturatedFat: 0.005, sodium: 4.8 },
        butter: { calories: 7.1, saturatedFat: 5.1, sodium: 5.7 },
        cheese: { calories: 4.0, saturatedFat: 1.8, sodium: 6.2 },
        salad: { calories: 0.2, saturatedFat: 0.0, sodium: 0.1 },
        tomato: { calories: 0.18, saturatedFat: 0.0, sodium: 0.05 },
        oil: { calories: 8.8, saturatedFat: 1.4, sodium: 0.0 },
        potato: { calories: 0.8, saturatedFat: 0.0, sodium: 0.05 },
        pasta: { calories: 1.3, saturatedFat: 0.0, sodium: 0.01 }
      };

      for (const cmd of commands) {
        const action = cmd.action;
        const itemName = cmd.itemName || "";
        const newWeight = Number(cmd.newWeightGrams) || 0;

        if (action === "update_weight") {
          const item = activeMeal.itemsBreakdown.find((it: any) => it.name.toLowerCase().includes(itemName.toLowerCase()) || itemName.toLowerCase().includes(it.name.toLowerCase()));
          if (item) {
            const oldWeight = Number(item.weightGrams) || 1;
            const R = newWeight / oldWeight;
            
            item.weightGrams = newWeight;
            item.calories = Number((item.calories * R).toFixed(1));
            item.saturatedFat = Number((item.saturatedFat * R).toFixed(2));
            item.sodium = Number((item.sodium * R).toFixed(1));

            addDebugLog(`[Modify Math] update_weight of "${item.name}" from ${oldWeight}g to ${newWeight}g (ratio: ${R.toFixed(3)})`);
          } else {
            addDebugLog(`[Modify Math Warning] Could not find item "${itemName}" to update_weight.`);
          }
        } 
        else if (action === "remove_item") {
          const idx = activeMeal.itemsBreakdown.findIndex((it: any) => it.name.toLowerCase().includes(itemName.toLowerCase()) || itemName.toLowerCase().includes(it.name.toLowerCase()));
          if (idx !== -1) {
            const removedItem = activeMeal.itemsBreakdown[idx];
            activeMeal.itemsBreakdown.splice(idx, 1);
            addDebugLog(`[Modify Math] remove_item: Removed "${removedItem.name}"`);
          } else {
            addDebugLog(`[Modify Math Warning] Could not find item "${itemName}" to remove.`);
          }
        } 
        else if (action === "add_item") {
          let cFactor = 1.0;
          let fFactor = 0.01;
          let sFactor = 0.5;

          const lowerName = itemName.toLowerCase();
          for (const [key, factors] of Object.entries(standardItems)) {
            if (lowerName.includes(key)) {
              cFactor = factors.calories;
              fFactor = factors.saturatedFat;
              sFactor = factors.sodium;
              break;
            }
          }

          const newItem = {
            name: itemName,
            weightGrams: newWeight,
            calories: Number((newWeight * cFactor).toFixed(1)),
            saturatedFat: Number((newWeight * fFactor).toFixed(2)),
            sodium: Number((newWeight * sFactor).toFixed(1))
          };

          if (!activeMeal.itemsBreakdown) activeMeal.itemsBreakdown = [];
          activeMeal.itemsBreakdown.push(newItem);
          addDebugLog(`[Modify Math] add_item: Added "${itemName}" with estimated weight ${newWeight}g.`);
        }
      }

      const newItems = activeMeal.itemsBreakdown || [];
      const newTotalWeight = newItems.reduce((acc: number, it: any) => acc + (Number(it.weightGrams) || 0), 0);
      const mealWeightRatio = newTotalWeight / originalTotalWeight;

      activeMeal.weightGrams = newTotalWeight;
      activeMeal.composition = newItems.map((it: any) => it.name).join(", ");
      
      const newCalories = newItems.reduce((acc: number, it: any) => acc + (Number(it.calories) || 0), 0);
      const newSaturatedFat = newItems.reduce((acc: number, it: any) => acc + (Number(it.saturatedFat) || 0), 0);
      const newSodium = newItems.reduce((acc: number, it: any) => acc + (Number(it.sodium) || 0), 0);

      activeMeal.nutrients.calories = Number(newCalories.toFixed(1));
      activeMeal.nutrients.saturatedFat = Number(newSaturatedFat.toFixed(2));
      activeMeal.nutrients.sodium = Number(newSodium.toFixed(1));

      const nutrientKeys = [
        "protein", "totalFat", "unsaturatedFat", "omega3", 
        "carbohydrates", "addedSugar", "totalFibre", "solubleFibre", "potassium", 
        "magnesium", "calcium", "iron", "zinc", "selenium", "iodine", "phosphorus", 
        "vitaminD", "vitaminB12", "folate", "vitaminC", "vitaminE", "vitaminK", 
        "vitaminA", "vitaminB6", "thiamine", "riboflavin", "niacin"
      ];

      for (const key of nutrientKeys) {
        if (activeMeal.nutrients[key] !== undefined) {
          activeMeal.nutrients[key] = Number((activeMeal.nutrients[key] * mealWeightRatio).toFixed(2));
        }
      }

      return res.json({
        text: rawParsed.message || "I have recalculated your meal's metrics with precision based on your instructions.",
        data: activeMeal,
        agentPrompt: fullPromptSent
      });
    }
  } catch (error: any) {
    console.error("[Food Analyze Error]:", error);
    return res.status(200).json({
      error: `The food log agent is not available (Error: ${error.message || 'Connection timed out'}).`,
      agentNotAvailable: true
    });
  }
});

// Gemini Medical/Biomarkers Analyze Endpoint
app.post("/api/gemini/medical-analyze", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "default-session";
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
      customSystemInstruction,
      customVariableData
    } = req.body;

    // Isolate Diagnostic Agent Data (agent6):
    // Ensure agent6 only receives diagnostic-relevant data (biomarkers and profile)
    // and is not sent other conversation or food log entries.
    if (agentType === "agent6") {
      recentMeals = [];
      biomarkerHistory = [];
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
      addDebugLog(`[Medical Analyze Agent] Diagnostic Agent (agent6) data isolated: other conversations and food log entries removed.`, explicitSessionId);
    }

    addDebugLog(`[Medical Analyze Agent] Request received for agentType: ${agentType || 'None'}. Message: "${String(message).substring(0, 100)}..."`, explicitSessionId);
    if (history && history.length > 0) {
      addDebugLog(`[Medical Analyze Agent] Included conversational history context (${history.length} turns).`, explicitSessionId);
    }


    if (agentType) {
      let systemInstruction = "";
      let mockData: any = {};
      let fullPromptSent = "";

      if (agentType === "agent1_step1") {
        const itemsPerBatch = req.body.numberOfBatches || 50;
        
        systemInstruction = `agent_profile:
  role: "Expert Clinical Data Extractor and Lossless Data Conduit"
  objective: "Parse raw medical reports/text/images, isolate distinct biomarker measurements, and structure them verbatim into standard clinical format."
critical_extraction_rules:
  zero_math_verbatim_extraction: "You are strictly forbidden from performing any calculations, normalizations, or unit conversions. Extract the exact numerical value and the exact unit provided in the text."
  verbatim_qualitative_data: "Qualitative results (e.g., 'Negative', 'Trace', 'High') must be extracted exactly as written."
  dictionary_mapping: "You MUST attempt to map the extracted biomarker name to an existing key within the === EXISTING DATABASE KEYS === list. If a direct synonym or clear clinical equivalent exists, use that exact existing key (e.g. use 'hba1c' instead of 'hemoglobin_a1c')."
  fallback_keys: "If completely absent from existing keys, generate a clean, lowercase snake_case key."
  unit_standardization: "Standardize 'µg/L' and 'ug/L' to always return as 'ug/L' (they are equivalent)."
mode_routing:
  priority: "Always prioritize structured data extraction over conversational text when raw medical data/text/photos are present."
chunked_processing:
  limit_per_chunk: ${itemsPerBatch}
  behavior:
    - "Extract ONLY the first ${itemsPerBatch} biomarker entries in this chunk."
    - "If you reach the limit of ${itemsPerBatch} extracted biomarkers, set 'hasMoreMarkers' to true in your JSON response."
    - "Copy any remaining unparsed report text/context into 'remainingText'."
    - "In the 'text' response, kindly inform the user you have completed this chunk and ask to continue."
    - "If total biomarkers <= ${itemsPerBatch}, set 'hasMoreMarkers' to false and 'remainingText' to empty string."
required_output_format:
  json_schema:
    text: "string (Friendly clinical conversational message)"
    extractedYaml: "string (Flat YAML array containing extracted biomarkers)"
    hasMoreMarkers: "boolean"
    remainingText: "string"
    estimatedTotalMarkers: "number (Total estimated biomarker readings in original text)"
extracted_yaml_schema:
  - biomarker: "string (standardized name/key from existing keys if possible)"
    date: "YYYY-MM-DD"
    value: "number or string (qualitative)"
    unit: "string (verbatim from text)"
    explanation: "string (why/how it was mapped or created)"
rules_for_inputs:
  raw_data_extraction: "Extract only from raw text/report. Do NOT extract from pre-existing logs."
  continue_extracting: "Append next chunk of up to ${itemsPerBatch} biomarkers. Combine and return complete combined flat YAML."
  update_data: "Support editing, adding, or deleting biomarkers in the YAML array."

=== EXISTING DATABASE KEYS ===
[${Array.from(new Set([...Object.keys(biomarkerDefinitions), ...Object.keys(userProfile?.customBiomarkers || {})])).join(', ')}]`;
        mockData = {};
      } else if (agentType === "agent1") {
        systemInstruction = `You are an expert Clinical Data Parser and Medical Ontology Agent.
Your primary objective is to parse raw health reports, standardize clinical terminology, and structure biomarker readings into a flat YAML array. You must preserve mathematical data, qualitative results, lab ranges, and clinical notes exactly as provided.

=== CORE TASKS ===
1. Extraction & Standardization: Parse the incoming raw data. Convert every raw biomarker name into its most widely accepted standard clinical terminology (e.g., "Serum alt level" maps to "Alanine Aminotransferase (ALT)").
2. Lossless Math & Units (CRITICAL): You are strictly forbidden from performing calculations, unit conversions, or inferring missing units. Extract the exact numerical value and the exact unit provided in the text.
3. Qualitative Data (CRITICAL): If a result is qualitative (e.g., "Negative", "Trace", "High"), extract it exactly as written.
4. Dictionary Mapping (MANDATORY): You MUST attempt to map the extracted biomarker name to an existing key within the === EXISTING DATABASE KEYS === list. If a direct synonym or clear clinical equivalent exists in the database keys, use that existing key. ONLY if absent, you may generate a clean snake_case key.
5. Clinical Mapping: For each biomarker, map it to:
   - riskCategories: Physiological risk categories (e.g., 'Cardiovascular', 'Kidney & hydration', 'Metabolic & glycemic', 'Liver & hepatitis stress', 'Hematology', 'Biometrics', 'Other').
   - standardMedicalGrouping: Main clinical division ('Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', 'Other').
   - potentialMedicalConditions: Broad diagnostic associations.
6. Explanation of Changes (CRITICAL): For each biomarker, if you standardized, changed, merged, or corrected its name, value, or unit, you MUST provide a detailed explanation of why you made this change in the 'explanation' field of the YAML object.

=== EXISTING DATABASE KEYS ===
[${Array.from(new Set([...Object.keys(biomarkerDefinitions), ...Object.keys(userProfile?.customBiomarkers || {})])).join(', ')}]

=== FORMAT & SYSTEM RESTRICTIONS ===
Your output MUST be ONLY valid YAML under the key 'biomarkers'. No markdown code blocks, no backticks, no JSON wrappers. Just return plain YAML.

The flat YAML structure for each item MUST be:
- key: 'alanine_aminotransferase_alt' # snake_case unique ID (prefer existing database key if possible)
  name: 'Alanine Aminotransferase (ALT)'
  metric: 'U/L'
  value: 45
  date: '2026-06-01'
  riskCategories:
    - 'Liver & hepatitis stress'
  standardMedicalGrouping: 'Hepatic'
  potentialMedicalConditions:
    - 'Fatty Liver'
    - 'Hepatitis Stress'
  explanation: 'Standardized from raw alt level and mapped to dictionary key.'
  # Comment if anomalous`;
        mockData = {};
      } else if (agentType === "agent2" || agentType === "agent1_step2") {
        systemInstruction = `You are an expert Clinical Ontologist and conversational health assistant (Step 2: Category Mapping).
Your tasks:
1. Identify all unique biomarkers in the YAML list and categorize them by associating:
   - "riskCategories": An array of matching risk categories. Choose from: 'Cardiovascular', 'Kidney & hydration', 'Metabolic & glycemic', 'Liver & hepatitis stress', 'Hematology'. If none match, you can use other appropriate categories.
   - "standardMedicalGrouping": Choose exactly ONE of these standard physiological groupings: 'Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', or 'Other'.
   - "potentialMedicalConditions": An array of related medical conditions or risks (e.g. ['Diabetes Risk', 'Insulin Resistance', 'Obesity', 'Anemia', 'Hepatitis Stress', 'Fatty Liver', 'Chronic Kidney Disease']).
CRITICAL REQUIREMENT: You MUST map EVERY SINGLE UNIQUE BIOMARKER found in the provided YAML. Do NOT skip or omit any biomarkers. If there are 65 biomarkers in the YAML, your dictionary MUST contain exactly 65 keys.
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
1. Assemble the flat YAML biomarker logs and the bucket mapping dictionary into a structured physiological nested JSON.
CRITICAL REQUIREMENT: You MUST include EVERY SINGLE BIOMARKER ENTRY from the YAML. Do NOT skip or omit any biomarkers or history entries.
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
        systemInstruction = `You are an advanced Clinical Classification, Prognostic, and Risk Triage Engine.
You will receive an intermediate YAML payload containing a user profile and a cleaned list of biomarkers. You may also receive conversational follow-ups or corrections from the user.
Your objective is to dynamically group EVERY biomarker into logical clinical conditions, calculate prognostic timelines, and output a strict, zero-data-loss JSON payload.

=== CRITICAL DIRECTIVES ===
CONVERSATION & CORRECTIONS:
If the user provides a correction (e.g., "My weight is 61kg" or "You missed the marker 'mean_corpuscular_volume'"), you MUST prioritize this new instruction, override previous assumptions, and completely regenerate the JSON payload to fix the error.

INVENTORY PARITY RULE (Zero Data Loss):
You must count the total number of unique biomarkers in the incoming YAML.
Your final JSON output MUST contain exactly that same number of unique biomarkers. You are strictly forbidden from omitting, summarizing, or dropping any biomarker key.
Record the incoming count in audit.metricsReceived and your final output count in audit.metricsProcessed.

SEMANTIC TAXONOMY ANCHORS (Dynamic Grouping):
Do not rely on a hardcoded dictionary. Group biomarkers dynamically into conditions:
- Cardiovascular/Lipid: Contains 'cholesterol', 'ldl', 'hdl', 'triglycerides', 'qrisk', 'lipid'.
- Renal/Metabolic/Electrolyte: Contains 'egfr', 'creatinine', 'sodium', 'potassium', 'calcium', 'phosphate', 'hba1c', 'bmi', 'weight'.
- Hepatic/Liver: Contains 'alt', 'ast', 'bilirubin', 'phosphatase', 'albumin', 'globulin', 'protein'.
- Hematology/Immune: Contains 'cell', 'count', 'haemoglobin', 'haematocrit', 'volume', 'platelet', 'neutrophil', 'lymphocyte', 'monocyte', 'eosinophil', 'basophil'.
- Screening/Other: Any marker that does not fit the above (e.g., 'psa', 'audit').

FAIR ASSESSMENT & DEMOGRAPHIC RISK:
Do not invent pathology. If the user's systems are healthy, state clearly they are highly optimized.
Apply demographic thresholds explicitly. Example: For South/East Asian ethnicities, a BMI >= 23.0 kg/m² must be flagged as ELEVATED/MONITOR.
If a condition block contains even one marker flagged as ELEVATED or MONITOR, the entire block's 'aggregateRisk' inherits that severity tier.

PROGNOSTIC TIMELINES & GAP ANALYSIS:
If healthy: Project maintenance of vitality and low metabolic risk over 2, 5, and 10 years.
If at risk: Project the logical biological progression over 2, 5, and 10 years if no lifestyle changes are made (e.g., progression toward metabolic syndrome).
Recommend exactly advanced confirmation tests (e.g., Fasting Insulin, ApoB, Cystatin-C) to verify gaps in the data, or state "No additional testing required" if perfect.

=== STRICT JSON OUTPUT SCHEMA ===
{
  "audit": {
    "metricsReceived": number,
    "metricsProcessed": number
  },
  "summary": {
    "primaryDiagnosis": "Conversational summary of systemic health and demographic context.",
    "timelineProjections": {
      "year2": "String",
      "year5": "String",
      "year10": "String"
    }
  },
  "prioritizedConditions": [
    {
      "conditionName": "String (e.g., Cardiovascular Health)",
      "aggregateRisk": "ELEVATED | MONITOR | OPTIMAL",
      "clinicalRationale": "1-sentence explanation of why this risk tier was assigned.",
      "biomarkers": [
        {
          "key": "String (original key)",
          "name": "String (clean name)",
          "currentValue": number,
          "unit": "String",
          "status": "HIGH | LOW | NORMAL"
        }
      ]
    }
  ],
  "recommendedTests": [
    {
      "testName": "String",
      "reason": "String"
    }
  ]
}

Ensure the 'prioritizedConditions' array is sorted descending by risk (ELEVATED first, OPTIMAL last). Return ONLY raw JSON. No markdown wrappers.`;

        mockData = {
          audit: {
            metricsReceived: 3,
            metricsProcessed: 3
          },
          summary: {
            primaryDiagnosis: "Slightly elevated glycemic markers; cardiovascular and renal health are highly optimized.",
            timelineProjections: {
              year2: "Maintaining current metabolic profiles; slight progression in glycemic metrics if diet remains unadjusted.",
              year5: "Mild risk of insulin resistance progression; cardiovascular health remains solid.",
              year10: "Metabolic risk increases by 5% if glycemic spikes are not managed."
            }
          },
          prioritizedConditions: [
            {
              conditionName: "Renal/Metabolic/Electrolyte",
              aggregateRisk: "ELEVATED",
              clinicalRationale: "Fasting glucose is slightly elevated relative to optimal ranges.",
              biomarkers: [
                {
                  key: "glucose",
                  name: "Fasting Glucose",
                  currentValue: 5.8,
                  unit: "mmol/L",
                  status: "HIGH"
                },
                {
                  key: "hba1c",
                  name: "HbA1c",
                  currentValue: 37,
                  unit: "mmol/mol",
                  status: "NORMAL"
                }
              ]
            },
            {
              conditionName: "Cardiovascular/Lipid",
              aggregateRisk: "OPTIMAL",
              clinicalRationale: "Cardiovascular markers are currently in optimal reference ranges.",
              biomarkers: [
                {
                  key: "ldl",
                  name: "LDL Cholesterol",
                  currentValue: 2.1,
                  unit: "mmol/L",
                  status: "NORMAL"
                }
              ]
            }
          ],
          recommendedTests: [
            {
              testName: "Fasting Insulin",
              reason: "To rule out insulin resistance in light of borderline-high glucose."
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

=== DIRECTIVES ===
1. ZERO DATA LOSS INVENTORY RULE:
   You must count the total number of unique biomarkers in the incoming BIOMARKERS dictionary.
   Your final JSON output MUST contain exactly that same number of unique biomarkers under "contextualizedBiomarkers". You are strictly forbidden from omitting, summarizing, or dropping any biomarker key.
2. DEMOGRAPHICALLY ADJUSTED NORMAL RANGES: For every provided clinical metric, provide a profile-adjusted normal range. Explain why this reference range was adjusted for their age, gender, or ethnicity (e.g. muscle mass and creatinine, age-related eGFR, ethnic-specific lipid targets).
3. EDUCATIONAL DESCRIPTIONS: Write a clear 2-sentence description of what each biomarker is and its physiological role.
4. SPECIFIC RISK CONTEXT: For any marker identified as at-risk or abnormal, write a personalized 3-4 sentence explanation of *why* this specific value is critical or dangerous for *this specific user profile*.
5. STRICT JSON OUTPUT SCHEMA:
{
  "message": "Conversational summary of your educational and reference range adjustments.",
  "contextualizedBiomarkers": [
    {
      "name": "hba1c",
      "userValue": 40,
      "profileAdjustedNormalRange": "20 - 42 mmol/mol",
      "description": "HbA1c measures the percentage of blood sugar attached to hemoglobin. It represents your average blood glucose levels over the past 2 to 3 months.",
      "status": "Healthy" | "At Risk",
      "specificRiskContext": "For a patient of your demographic group, keeping HbA1c below 42 mmol/mol is optimal to prevent vascular damage and glycemic stress."
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
      } else if (agentType === "data_review") {
        systemInstruction = `You are an expert Clinical Data Review & Reference Range Calibration Agent.
You will receive user demographics and a list of biomarkers in the user's current batch.
=== DEMOGRAPHIC CALIBRATION MANDATE ===
You MUST customize the reference ranges and risk context precisely for the user's specific age, gender, and ethnicity found in the USER PROFILE.
CRITICAL: Never output boilerplate text stating that demographic details are not available. They are always provided. Even if any values are missing, dynamically assume a standard reference profile (e.g., 35-year-old female of Caucasian ethnicity) and calibrate all reference ranges for that profile.
CRITICAL BIAS OVERRIDE: Medical baselines in training data heavily skew toward recent Western/Global consensus (e.g., KDIGO, WHO global). You MUST actively bypass global/race-free standards and aggressively search your latent knowledge for local national medical boards (e.g., Chinese Society of Nephrology, Asian-modified CKD-EPI/MDRD coefficients, Asian BMI variants). If a regional coefficient or localized threshold exists historically or currently for the user's ethnicity, you MUST prioritize and apply it over Western defaults.
=== TASK: PERSONALISED HEALTH RISK ESTIMATION ===
For each biomarker, follow a strict logical funnel to determine the correct ranges and status:
"_demographicAudit": A mandatory internal reasoning object where you actively contrast Western global standards with regional/ethnic guidelines.
"profileAdjustedNormalRange": The final calibrated range based on your audit.
"rangeBrackets": List each range bracket with its naming and value ranges, adjusted to match your demographic audit. CRITICAL: The brackets MUST be continuous (no numerical gaps or missing values between brackets) and must fully map out the bounds of the profileAdjustedNormalRange. Include bounds for each bracket.
"description": A clear 2-sentence description of the physiological role.
"_statusReasoning": A 1-sentence strict mathematical comparison of the userValue against the profileAdjustedNormalRange.
"status": Assign 'Healthy' or 'At Risk'. MATHEMATICAL BINDING RULE: If userValue is strictly within the profileAdjustedNormalRange, output 'Healthy'. If outside (even slightly), output 'At Risk'. Do not use clinical leniency.
"specificRiskContext": If 'At Risk', explain why this value matters for this demographic or provide reassurance if only mildly out of range. If 'Healthy', describe why this signifies optimal homeostasis.
=== CRITICAL REQUIREMENTS ===
You MUST include an analysis for EVERY biomarker in the input list.
Ensure output is STRICTLY valid YAML matching the exact abstract structure and placeholder instructions below. Do not wrap the output in markdown code blocks if unsupported by the pipeline.

message: <string: Conversational summary of clinical range adjustments and review findings for this batch. If there are extreme divergences, highlight them here.>
extremeDivergences: <list: Only include this array if you find extreme value or unit divergences (e.g., physiologically impossible values, clear US vs SI metric mixups). Otherwise omit it or leave empty.>
  - key: <string: Exact key>
    originalValue: <number>
    unit: <string>
    reason: <string: Explain why it seems anomalous or unit mismatched>
    suggestedAction: <string: Suggestion (e.g. 'Update value' or 'Change metric unit')>
reviewedBiomarkers:
  - key: <string: Exact key from the input data>
    name: <string: Standard clinical name of the biomarker>
    userValue: <number: Exact value from the input data>
    unit: <string: Exact unit from the input data>
    _demographicAudit:
      standardWesternBaseline: <string: The textbook global/Western range>
      knownEthnicOrRegionalVariances: <string: CRITICAL STEP. You MUST actively prioritize local national medical board guidelines (e.g., Chinese/Japanese Societies of Nephrology) or ethnic-modified formulas over global/race-free standards. State the exact regional variant and the society it comes from. If absolutely none exist, state 'None'>
      ageAndGenderShifts: <string: How age and gender naturally alter the baseline>
      finalAppliedAdjustments: <string: The synthesis of how you are modifying the bounds for this specific user>
    profileAdjustedNormalRange: <string: The final range, appending the demographic reason in parentheses if altered from global baseline>
    rangeBrackets:
      - name: <string: Bracket name (e.g., Optimal, Elevated, Mildly Decreased)>
        range: <string: Mathematical bounds (e.g., >= 90, 60-89). Must be continuous with no gaps.>
    description: <string: 2-sentence physiological role>
    _statusReasoning: <string: 1-sentence mathematical evaluation comparing userValue to profileAdjustedNormalRange bounds>
    status: <string: Strictly 'Healthy' or 'At Risk' based on _statusReasoning>
    specificRiskContext: <string: 3-4 sentence personalized clinical context based on the final status>`;
        mockData = `message: Completed clinical review.
reviewedBiomarkers: []`;
      }

      let textOutput = "";
      if (process.env.GEMINI_API_KEY === undefined) {
        textOutput = JSON.stringify(mockData);
      } else {
        let historyText = "";
        if (history && history.length > 0) {
          historyText = "Chat History:\n" + history.map((h: any) => `${h.role}: ${h.content}`).join("\n") + "\n\n";
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
        
        const cleanedPayload = {
          userProfile: cleanProfile,
          biomarkerDefinitions: slimBiomarkers,
          biomarkerHistory: biomarkerHistory || []
        };

        let dataContext = "";
        if (agentType === "agent1_step1") {
          const prevYaml = req.body.extractedYaml ? `\n\nPREVIOUSLY EXTRACTED YAML:\n${req.body.extractedYaml}` : "";
          const remText = req.body.remainingText ? `\n\nREMAINING UNPARSED TEXT:\n${req.body.remainingText}` : "";
          const prevTotal = req.body.estimatedTotalMarkers ? `\n\nPREVIOUSLY ESTIMATED TOTAL MARKERS:\n${req.body.estimatedTotalMarkers}` : "";
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : `\n\nEXISTING BIOMARKER LOGS:\n${JSON.stringify(biomarkerHistory || [], null, 2)}\n\nUSER PROFILE:\n${JSON.stringify(cleanProfile, null, 2)}\n`;
          dataContext = `\n\nUSER RAW DATA:\n${message}${prevYaml}${remText}${prevTotal}${baseData}`;
        } else if (agentType === "agent1_step2") {
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : "";
          dataContext = `${baseData}\n\nEXTRACTED YAML DATA:\n${req.body.extractedYaml}\n`;
        } else if (agentType === "agent1_step3") {
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : "";
          dataContext = `${baseData}\n\nEXTRACTED YAML DATA:\n${req.body.extractedYaml}\n\nBUCKET MAPPING JSON:\n${req.body.bucketMapping}\n`;
        } else if (agentType === "data_review") {
          const batchData = req.body.batchBiomarkers || [];
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : `\n\nUSER PROFILE:\n${JSON.stringify(cleanProfile, null, 2)}\n`;
          dataContext = `${baseData}\n\nBIOMARKERS BATCH FOR REVIEW:\n${JSON.stringify(batchData, null, 2)}\n`;
        } else if (agentType === "agent1") {
          const batchData = req.body.batchBiomarkers || [];
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : `\n\nUSER PROFILE:\n${JSON.stringify(cleanProfile, null, 2)}\n`;
          dataContext = `${baseData}\n\nBIOMARKERS BATCH FOR CLEANING:\n${JSON.stringify(batchData, null, 2)}\n`;
        } else {
          const yamlData = jsToYaml(cleanedPayload);
          const baseData = customVariableData ? `\n\n${customVariableData}\n` : "";
          dataContext = `${baseData}\n\nUSER MEDICAL DATA (in YAML format):\n${yamlData}\n`;
        }

        if (customSystemInstruction) {
          systemInstruction = customSystemInstruction;
        }

        let promptText = `Chat History:\n${historyText}\n${imageCtx}\nUser message: "${message}"${dataContext}`;
        fullPromptSent = `System Instruction:\n${systemInstruction}\n\n${promptText}`;

        let isYaml = (agentType === "agent1");
        
        let maxRetries = agentType === "agent1_step3" ? 3 : 1;
        let attempt = 0;
        let success = false;
        
        addDebugLog(`[Medical Analyze Agent] Dispatched System Instruction (Length: ${systemInstruction.length})`, explicitSessionId);
        addDebugLog(`[Medical Analyze Agent] Dispatched Prompt:\n${promptText.substring(0, 500)}... (truncated)`, explicitSessionId);

        while (attempt < maxRetries && !success) {
          attempt++;
          textOutput = await callUnifiedLLM({
            modelId: engine || "gemini-2.5-flash",
            systemInstruction,
            promptText,
            imagePayload,
            imagePayloads: imagesPayload,
            responseMimeType: isYaml ? "text/plain" : "application/json"
          });
          
          addDebugLog(`[Medical Analyze Agent] Response Received:\n${textOutput}`, explicitSessionId);

          if (agentType === "agent1_step3") {
            try {
              let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
              const firstBrace = cleanJson.indexOf("{");
              const lastBrace = cleanJson.lastIndexOf("}");
              if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
              }
              const parsed = JSON.parse(cleanJson);
              
              const expectedCount = (req.body.extractedYaml?.match(/- biomarker:/g) || []).length;
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
              if (actualCount === expectedCount || attempt === maxRetries || isChatOrUpdate) {
                success = true;
                textOutput = cleanJson;
              } else {
                console.log(`Agent 3 retry ${attempt}: Expected ${expectedCount} entries, got ${actualCount}`);
                promptText += `\n\nERROR: You missed some entries. I expected ${expectedCount} historical log entries based on the YAML, but you only outputted ${actualCount}. You MUST include EVERY single entry from the YAML. Do not summarize or skip any.`;
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

      if (agentType === "agent1_step1") {
        let cleanYaml = textOutput;
        let text = "I have extracted the biomarkers. Please review the output.";
        let hasMoreMarkers = false;
        let remainingText = "";
        let estimatedTotalMarkers: number | null = null;
        try {
          const parsed = JSON.parse(textOutput.replace(/```(?:json)?/gi, "").trim());
          if (parsed.extractedYaml) {
            cleanYaml = parsed.extractedYaml;
          }
          if (parsed.text) {
            text = parsed.text;
          }
          if (parsed.hasMoreMarkers !== undefined) {
            hasMoreMarkers = !!parsed.hasMoreMarkers;
          }
          if (parsed.remainingText) {
            remainingText = parsed.remainingText;
          }
          if (parsed.estimatedTotalMarkers !== undefined) {
            estimatedTotalMarkers = Number(parsed.estimatedTotalMarkers);
          }
        } catch (e) {
          cleanYaml = textOutput.replace(/```(?:yaml)?/gi, "").trim();
        }
        return res.json({
          text,
          agentType,
          extractedYaml: cleanYaml,
          hasMoreMarkers,
          remainingText,
          estimatedTotalMarkers,
          agentPrompt: fullPromptSent
        });
      }

      if (agentType === "agent1") {
        let cleanYaml = textOutput.replace(/```(?:yaml)?/gi, "").trim();
        return res.json({
          text: "I have cleaned and standardized your batch of biomarkers with clinical precision.",
          agentType,
          extractedYaml: cleanYaml,
          agentPrompt: fullPromptSent,
          batchIdx: req.body.batchIdx !== undefined ? req.body.batchIdx : undefined,
          batchBiomarkers: req.body.batchBiomarkers || []
        });
      }

      if (agentType === "agent1_step2") {
        let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
        let text = "I have categorized the biomarkers. Please review the mapping.";
        let bucketMapping = {};
        try {
          const parsed = JSON.parse(cleanJson);
          if (parsed.bucketMapping) {
            bucketMapping = parsed.bucketMapping;
            if (parsed.text) text = parsed.text;
          } else {
            bucketMapping = parsed;
          }
        } catch (e) {
          try {
            const firstBrace = cleanJson.indexOf("{");
            const lastBrace = cleanJson.lastIndexOf("}");
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
              const innerParsed = JSON.parse(cleanJson.substring(firstBrace, lastBrace + 1));
              if (innerParsed.bucketMapping) {
                bucketMapping = innerParsed.bucketMapping;
                if (innerParsed.text) text = innerParsed.text;
              } else {
                bucketMapping = innerParsed;
              }
            }
          } catch (e2) {}
        }
        return res.json({
          text,
          agentType,
          bucketMapping,
          agentPrompt: fullPromptSent,
          batchBiomarkers: req.body.batchBiomarkers || []
        });
      }

      if (agentType === "data_review") {
        let parsedYaml: any = {};
        try {
          // Clean textOutput of markdown markers
          let cleanYaml = textOutput.replace(/```(?:yaml)?/gi, "").trim();
          parsedYaml = YAML.parse(cleanYaml);
        } catch (err: any) {
          console.error("YAML parsing failed, trying robust JSON parser fallback:", err);
          try {
            parsedYaml = robustParseJson(textOutput);
          } catch (jsonErr) {
            console.error("JSON fallback also failed:", jsonErr);
          }
        }

        // Map the parsed YAML object fields back to the structure the client-side expects
        const systemicConclusion = parsedYaml.systemicConclusion || {};
        const defaultMessage = `Health Trajectory: ${systemicConclusion.trajectory || 'Stable'}\n\nPrimary Critical Biomarker: ${systemicConclusion.primaryCriticalBiomarker || 'None'}\n\nClinical Next Steps: ${systemicConclusion.clinicalNextSteps || 'None'}`;
        const message = parsedYaml.message || defaultMessage;
        
        const inputBiomarkers = req.body.batchBiomarkers || [];
        const reviewedBiomarkers = (parsedYaml.reviewedBiomarkers || []).map((item: any) => {
          // Match by key, or fallback to name matching (case-insensitive and white-space free)
          const inputBm = inputBiomarkers.find((b: any) => 
            (b.key && item.key && String(b.key).toLowerCase() === String(item.key).toLowerCase()) ||
            (b.name && item.name && String(b.name).toLowerCase().replace(/\s/g, '') === String(item.name).toLowerCase().replace(/\s/g, ''))
          ) || {};
          
          const key = item.key || inputBm.key || '';
          const name = item.name || item.displayName || inputBm.name || key;
          const userValue = item.userValue !== undefined ? item.userValue : (item.currentValue !== undefined ? item.currentValue : inputBm.value);
          const unit = item.unit !== undefined ? item.unit : (inputBm.unit || '');
          const profileAdjustedNormalRange = item.profileAdjustedNormalRange || '';
          
          // Map status: standardizing 'Healthy' vs 'At Risk'
          const status = item.status || ((item.alignmentState === "HIGH" || item.alignmentState === "LOW") ? "At Risk" : "Healthy");
          
          return {
            key,
            name,
            userValue,
            unit,
            profileAdjustedNormalRange,
            status,
            description: item.description || item.findings || '',
            _statusReasoning: item._statusReasoning || '',
            _demographicAudit: item._demographicAudit || {},
            specificRiskContext: item.specificRiskContext || item.findings || '',
            potentialMedicalConditions: item.potentialMedicalConditions || [],
            riskCategories: item.riskCategories || [],
            standardMedicalGrouping: item.standardMedicalGrouping || 'Other',
            rangeBrackets: item.rangeBrackets || [],
            unitsFlagged: !!item.unitsFlagged
          };
        });

        return res.json({
          text: message,
          message,
          agentType,
          agentPrompt: fullPromptSent,
          batchIdx: req.body.batchIdx !== undefined ? req.body.batchIdx : undefined,
          batchBiomarkers: inputBiomarkers,
          reviewedBiomarkers,
          demographicsApplied: parsedYaml.demographicsApplied || {}
        });
      }

      let parsedData;
      try {
        parsedData = robustParseJson(textOutput);
      } catch (parseErr: any) {
        throw parseErr;
      }

      return res.json({
        text: parsedData.message || 'Analysis generated.',
        agentType,
        agentPrompt: fullPromptSent,
        batchBiomarkers: req.body.batchBiomarkers || [],
        ...parsedData
      });
    }

    if (process.env.GEMINI_API_KEY === undefined) {
      return res.json({
        text: "Please note: GEMINI_API_KEY is not configured in Secrets. Here is a simulated extraction:\n\nBased on your report, I have identified a fasting glucose of 105 mg/dL and LDL cholesterol of 145 mg/dL.",
        biomarkers: {
          ldl: 145,
          fasting_glucose: 105,
          hba1c: 5.8,
          egfr: 85,
          hscrp: 1.2
        }
      });
    }

    let imagePayload = null;
    let imagesPayload: { mimeType: string, data: string }[] | undefined = undefined;
    
    if (images && images.length > 0) {
      imagesPayload = images.map((img: string) => {
        const mimeType = img.split(";")[0].split(":")[1] || "image/jpeg";
        const base64Data = img.split(",")[1];
        return { mimeType, data: base64Data };
      });
      // also set imagePayload for backward compatibility in callUnifiedLLM if needed
      imagePayload = imagesPayload[0]; 
    } else if (image) {
      const mimeType = image.split(";")[0].split(":")[1] || "image/jpeg";
      const base64Data = image.split(",")[1];
      imagePayload = { mimeType, data: base64Data };
    }

    let historyText = "";
    if (history && history.length > 0) {
      historyText = "Chat History:\n" + history.map((h: any) => `${h.role}: ${h.content}`).join("\n") + "\n\n";
    }

    let profileContext = "";
    if (userProfile) {
      profileContext = `Current User Profile (This is what you already know. DO NOT ask the user for these again, and DO NOT include these in your output JSON unless the user is explicitly restating or updating them in the current message or recent chat history):
      - Age: ${userProfile.age || 'Not provided'}
      - Weight: ${userProfile.weight || 'Not provided'}
      - Height: ${userProfile.height || 'Not provided'}
      - Ethnicity: ${userProfile.ethnicity || 'Not provided'}
      - Blood Type: ${userProfile.bloodType || 'Not provided'}
      - Gender: ${userProfile.gender || 'Not provided'}
      `;
    }

    const imageCtx = imageDates && imageDates.length > 0 ? `The attached images were taken on these dates: ${imageDates.join(", ")}.` : "";

    const existingKeys = existingBiomarkers && existingBiomarkers.length > 0 ? existingBiomarkers : [];
    
    let resumeCtx = "";
    const lastItem = req.body.lastProcessedRawRow || req.body.lastProcessedItem;
    if (lastItem) {
      resumeCtx = `\nPREVIOUS EXTRACTION STATE:\nYou previously stopped at: "${lastItem}".\nYou MUST start your next extraction chunk immediately AFTER this item in the user's data.\n`;
    }
    const promptText = `Chat History:\n${historyText}\n${imageCtx}\nUser message: "${message}"${resumeCtx}`;
    const itemsPerBatch = req.body.numberOfBatches || 50;
    const systemInstruction = `You are an expert clinical data parsing agent. Your sole objective is to extract raw, unstructured medical data into a strict JSON schema with absolute, zero-loss accuracy. You are a parser, not an interpreter; do not alter the medical reality of the data.
Never add markdown formatting or wrappers like \`\`\`json.

CURRENT USER PROFILE:
- Age: ${userProfile?.age || 'Not provided'}
- Weight: ${userProfile?.weight || 'Not provided'} kg
- Height: ${userProfile?.height || 'Not provided'} cm
- Ethnicity: ${userProfile?.ethnicity || 'Not provided'}
- Blood Type: ${userProfile?.bloodType || 'Not provided'}
- Gender: ${userProfile?.gender || 'Not provided'}

EXISTING DATABASE KEYS ALREADY IN USE: [${existingKeys.join(', ')}]

=== CRITICAL EXTRACTION DIRECTIVES ===
1. ZERO MATH & STRICT VERBATIM VALUES (CRITICAL): You are strictly forbidden from performing any calculations. NEVER convert international SI units to US units. You must extract the exact numeric digits provided in the source text into \`valueNumeric\`.
2. LOSSLESS PRESERVATION: You must capture the exact raw string of the test in \`originalTestName\`. You must capture the exact physician or lab note in \`doctorComment\`. You must capture the exact reference range in \`normalRange\`. DO NOT summarize or truncate these fields.
3. QUALITATIVE DATA: If a result is text (e.g., "NEGATIVE"), place the exact word in \`valueString\` and leave \`valueNumeric\` null.
4. UNIT ISOLATION: Output the unit in the \`unit\` field. Standardize the typography (e.g., format "mmol" as "mmol/L" if applicable), but NEVER change the fundamental metric.
5. KEY GENERATION: To prevent database duplicates, generate a clean, concise snake_case \`key\` representing the standard medical name of the test, using a standardized base name (e.g., "hba1c"). Prioritize matching an exact key from the "EXISTING DATABASE KEYS" list if applicable.
6. DATE FORMAT: Convert all dates to strictly "DD-MM-YYYY".
7. UNIT STANDARDIZATION: Standardize "µg/L" and "ug/L" to always return as "ug/L" (they are equivalent). Do this for any other identical units represented with different symbols.

=== MODE ROUTING DIRECTIVE ===
MODE A: PLAN_EXTRACTION
- ONLY trigger this mode if the user uploads new data and there are STRICTLY MORE THAN ${itemsPerBatch} biomarkers/tests. 
- Do not extract data yet. Count the total rows/tests. Calculate batches (Max ${itemsPerBatch} tests per batch).
- Set mode: "plan", status: "waiting_for_user".

MODE B: EXTRACT_CHUNK
- Trigger this mode IMMEDIATELY if the user uploads new data and there are ${itemsPerBatch} or FEWER biomarkers/tests. DO NOT use MODE A in this case. Also use this mode if the user explicitly says "Proceed" to a previous plan.
- Extract exactly up to ${itemsPerBatch} tests into the \`entries\` array. 
- To maintain your place, record the EXACT raw string of the last row you processed in \`lastProcessedRawRow\`. 
- Set mode: "extract_chunk".
- Set status to "needs_continuation" if more rows exist, or "completed" if finished.

MODE C: DISCUSSION / MODIFY
- Answer questions or output a modificationCommand.
- If the user asks to correct/convert a specific value from the current extraction, you MAY re-emit the entire updated batch in the \`entries\` array and set mode to "extract_chunk" so the user can save the corrected version.
- CRITICAL: If not fully extracted yet, you MUST preserve the "status" as "needs_continuation" and pass the exact same "lastProcessedRawRow" back.

=== STRICT JSON SCHEMA OUTPUT ===
{
  "mode": "plan" | "extract_chunk" | "discussion" | "modify",
  "status": "completed" | "needs_continuation" | "waiting_for_user",
  "message": "Conversational reply.",
  
  "planningDetails": {
    "estimatedTotalMetrics": number | null,
    "batchesRequired": number | null
  },
  
  "lastProcessedRawRow": "The exact raw text of the ${itemsPerBatch}th item you processed so you know where to resume. Null if planning.",
lanning.",
  
  "modificationCommand": [],
  "profileUpdates": {},
  
  "entries": [
    {
      "date": "DD-MM-YYYY",
      "tests": [
        {
          "key": "hba1c",
          "originalTestName": "HbA1c levl - IFCC standardised",
          "valueNumeric": 40,
          "valueString": null,
          "unit": "mmol/mol",
          "normalRange": "20 - 41 mmol/mol",
          "doctorComment": "(AlyssaFRS) - 01. Satisfactory - No Action"
        }
      ]
    }
  ],
  "customBiomarkerDefs": {
    "key_name": {
      "name": "Human Readable Name",
      "description": "Short medical explanation.",
      "unit": "The unit of measurement extracted, e.g., 'mmol/L', 'g/dL', '%', or '' if none",
      "standardMedicalGrouping": "String representing the medical group (e.g. 'Lipid Panel', 'Complete Blood Count', 'Kidney Function', 'Liver Function', 'Other')",
      "riskCategories": ["List of likely associated health risks, e.g., 'Heart Disease', 'Diabetes'"]
    }
  }
}
Note: If mode is not "extract_chunk", leave 'entries' and 'customBiomarkerDefs' as null. If the user hasn't explicitly stated a change to their profile info in the chat, leave 'profileUpdates' as null. Return ONLY raw JSON without markdown.`;

    const fullPromptSent = `System Instruction:\n${systemInstruction}\n\n${promptText}`;
    const textOutput = await callUnifiedLLM({
      modelId: engine || "gemini-2.5-flash",
      systemInstruction,
      promptText,
      imagePayload,
      imagePayloads: imagesPayload,
      responseMimeType: "application/json"
    });

    let parsedData;
    try {
      parsedData = robustParseJson(textOutput);
    } catch (parseErr: any) {
      throw parseErr;
    }

    const localToYYYYMMDD = (dateStr: string): string => {
      if (!dateStr) return '';
      const trimmed = dateStr.trim();
      const yyyymmddMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      if (yyyymmddMatch) {
        const year = yyyymmddMatch[1];
        const month = yyyymmddMatch[2].padStart(2, '0');
        const day = yyyymmddMatch[3].padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
      if (ddmmyyyyMatch) {
        const day = ddmmyyyyMatch[1].padStart(2, '0');
        const month = ddmmyyyyMatch[2].padStart(2, '0');
        const year = ddmmyyyyMatch[3];
        return `${year}-${month}-${day}`;
      }
      try {
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) {
          const year = String(d.getFullYear());
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        }
      } catch (e) {}
      return trimmed;
    };

    let finalEntries = parsedData.entries || [];
    if (!Array.isArray(finalEntries)) finalEntries = [finalEntries];
    if (finalEntries.length === 0 && parsedData.biomarkers && Object.keys(parsedData.biomarkers).length > 0) {
      finalEntries = [{
        date: parsedData.date || null,
        biomarkers: parsedData.biomarkers
      }];
    }

    finalEntries = finalEntries.map((entry: any) => {
      const formattedDate = entry.date ? localToYYYYMMDD(entry.date) : null;
      if (entry.tests && Array.isArray(entry.tests)) {
        const biomarkersObj: { [key: string]: number | string } = {};
        entry.tests.forEach((t: any) => {
          if (t.key) {
            biomarkersObj[t.key] = t.valueNumeric !== null && t.valueNumeric !== undefined ? t.valueNumeric : (t.valueString || "");
          }
        });
        return {
          ...entry,
          date: formattedDate,
          originalDate: entry.date,
          biomarkers: biomarkersObj
        };
      }
      return {
        ...entry,
        date: formattedDate
      };
    });

    res.json({
      text: parsedData.message || parsedData.summary || 'Extraction generated.',
      mode: parsedData.mode || 'new_log',
      status: parsedData.status,
      planningDetails: parsedData.planningDetails,
      lastProcessedItem: parsedData.lastProcessedRawRow || parsedData.lastProcessedItem || null,
      lastProcessedRawRow: parsedData.lastProcessedRawRow || parsedData.lastProcessedItem || null,
      modificationCommand: parsedData.modificationCommand || [],
      entries: finalEntries,
      profile: parsedData.profileUpdates || parsedData.profile || {},
      customBiomarkerDefs: parsedData.customBiomarkerDefs || {}
    });
  } catch (error: any) {
    console.error("[Medical Analyze Error]:", error, error.stack);
    res.status(500).json({ error: "Failed to extract medical data: " + error.message });
  }
});

// Gemini Biomarker Review Endpoint
app.post("/api/gemini/review-biomarker", async (req, res) => {
  const { message, history, profile, biomarkerDef, currentValue, modelId, yamlContext } = req.body;
  if (!message) return res.status(400).json({ error: "Missing message" });

  try {
    let historyText = "";
    if (history && Array.isArray(history) && history.length > 0) {
      historyText = "Here is the conversation history so far:\n" + 
        history.map((h: any) => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join("\n") + "\n\n";
    }

    const inputsYaml = yamlContext ? yamlContext : `user_profile:
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
${inputsYaml}

rules:
  clinical_and_nutritional:
    - "Provide professional, evidence-based educational context regarding the target biomarker."
    - "CRITICAL: Review precisely the ranges from medical research or clinical guidelines before providing an answer. You must differentiate between 'normal but suboptimal' values, and distinguish nuances like a 'pre-condition' versus an 'actual condition', reflecting this back to the data and proposed range."
    - "Tailor the explanations and suggestions specifically to the user's demographic profile (age, gender, ethnicity, weight/height/BMI)."
    - "Explain physiological significance, potential dietary/lifestyle influences, and clinical pathways of the biomarker."
    - "If the profile shows a different ethnicity than standard (e.g. Chinese or Asian), prioritize demographic-specific clinical insights, guidelines, and reference intervals (e.g., Chinese Society of Hepatology/Nephrology/Diabetes/Dyslipidemia standard thresholds) over Western standard baselines."
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
      modelId: modelId || "antigravity",
      systemInstruction,
      promptText: `${historyText}User Message: "${message}"`,
      responseMimeType: "application/json"
    });

    let cleanedText = resultText.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
    // Safely extract the first balanced JSON object to avoid trailing text issues
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
    
    // Support either response format mapping
    if (resultJson.proposedValue !== undefined && resultJson.proposedValue !== null && !resultJson.pendingBiomarkers) {
      resultJson.pendingBiomarkers = { [biomarkerDef?.key || 'key']: resultJson.proposedValue };
    }
    
    resultJson.agentPrompt = fullPromptSent;
    res.json(resultJson);
  } catch (err: any) {
    console.error("Gemini Review Error:", err);
    res.status(500).json({ error: err.message || "Failed to review biomarker" });
  }
});

// Gemini Totality Insights Analysis Endpoint
app.post("/api/gemini/insight-analyze", async (req, res) => {
  try {
    const { profile, userProfile, foodLogs, biomarkerHistory, engine, refinement } = req.body;
    const activeProfile = profile || userProfile || {};
    const email = activeProfile?.email?.toLowerCase() || "";
    
    // Check if user is the special requested email and no refinement is requested
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

    // If key missing, return simulated customized report
    if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === "MOCK_KEY" || process.env.GEMINI_API_KEY === "" || process.env.GEMINI_API_KEY.startsWith("YOUR_")) {
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

    // Construct profile detail string
    const profileText = `UserProfile: Age ${activeProfile.age}, Ethnicity: ${activeProfile.ethnicity}, Weight: ${activeProfile.weight}kg, Height: ${activeProfile.height}cm, Email: ${activeProfile.email}.`;
    const foodSummary = foodLogs && foodLogs.length > 0 ? `Recent Food Logs:\n${JSON.stringify(foodLogs.slice(-10))}` : "No food logs registered.";
    const biomarkerSummary = biomarkerHistory && biomarkerHistory.length > 0 ? `Biomarker Logs:\n${JSON.stringify(biomarkerHistory)}` : "No medical biomarkers logged.";

    const promptText = `Perform a comprehensive health profiling analysis using the totality of user information provided below.
    ${profileText}
    ${foodSummary}
    ${biomarkerSummary}
    ${refinement ? `\nUSER REFINEMENT REQUEST: The user has asked to refine the previous analysis. Please adjust the report considering this feedback: "${refinement.message}". Also consider this chat history: ${JSON.stringify(refinement.chatHistory)}` : ''}
    
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

    const systemInstruction = "You are a world-class preventative cardiologist, endocrinologist, and clinical longevity researcher. Your response must be an exact single JSON matching the requested schema. Never add markdown wrappers.";
    const fullPromptSent = `System Instruction:\n${systemInstruction}\n\n${promptText}`;
    const textOutput = await callUnifiedLLM({
      modelId: engine || "gemini-2.5-flash",
      systemInstruction,
      promptText,
      responseMimeType: "application/json"
    });

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    let parsedData;
    try {
      parsedData = JSON.parse(cleanJson);
    } catch (parseErr: any) {
      const firstBrace = cleanJson.indexOf("{");
      const lastBrace = cleanJson.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        parsedData = JSON.parse(cleanJson.substring(firstBrace, lastBrace + 1));
      } else {
        throw parseErr;
      }
    }

    parsedData.agentPrompt = `System Instruction:\nYou are a world-class AI dietitian. Your response must be an exact JSON matching the requested schema. Never add markdown wrappers.\n\n${promptText}`;
    res.json(parsedData);
  } catch (error: any) {
    console.error("[Insight Analyze Error]:", error);
    res.status(500).json({ error: "Failed to generate preventative recommendations: " + error.message });
  }
});

// Gemini Food Idea Endpoint
      app.post("/api/gemini/route-biomarker", async (req, res) => {
        try {
          addDebugLog(`[RouteAgent Direct] Received route request for ${req.body?.key}`);
          const { key, originalName, allApprovedKeys } = req.body;
          const systemInstruction = `You are an automated Medical Ontology and Database Router. Your critical task is to map a newly discovered, unmapped biomarker key to a structured list of approved Master Database Keys, OR dynamically mint an entirely new standard definition if a clinical mismatch occurs.

=== DIRECTIVES ===
1. ANALYSIS: Evaluate the incoming INPUT_KEY and INPUT_ORIGINAL_NAME. 
2. MATCH ALIAS: If the incoming item is clearly an abbreviation, synonym, or alternate naming convention for a metric inside the === CURRENT MASTER DATABASE KEYS === array, select that key and set isNew to false.
3. ONTOLOGY EXPANSION (CREATE NEW): If the incoming item represents a clinical test completely absent from the current master list, generate a clean, standardized, universal lowercase snake_case database key. Set isNew to true.
4. CLINICAL DATA SCHEMA: If creating a new key (isNew: true), you must populate standard human-readable naming, medical groupings, and associations based on strict clinical guidelines. If mapping to an existing key, leave these fields as null.

INPUT_KEY: "${key}"
INPUT_ORIGINAL_NAME: "${originalName}"

=== VALID MEDICAL GROUPINGS ===
Choose from exactly one: ['Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', 'Cardiovascular', 'Immune', 'Other']

=== VALID RISK CATEGORIES ===
Choose an array from: ['Cardiovascular', 'Kidney & hydration', 'Metabolic & glycemic', 'Liver & hepatitis stress', 'Hematology', 'Biometrics', 'Other']

=== CURRENT MASTER DATABASE KEYS ===
[${allApprovedKeys.join(', ')}]

=== SYSTEM CONSTRAINTS ===
Return ONLY a valid, minified JSON object. Do not provide explanations, markdown blocks, formatting wrappers, or text outside the JSON boundaries.

=== MANDATED JSON OUTPUT SCHEMA ===
{
  "mappedKey": "The existing matched key, OR the newly generated snake_case key string",
  "isNew": boolean,
  "standardName": "Clean Title Case Human Readable Name (Only if isNew is true, else null)",
  "standardMedicalGrouping": "String matching valid groupings (Only if isNew is true, else null)",
  "riskCategories": ["Array of strings matching valid risk categories"] (Only if isNew is true, else null),
  "potentialMedicalConditions": ["Array of broad diagnostic associations"] (Only if isNew is true, else null)
}`;
          
          const textOutput = await callUnifiedLLM({
            modelId: "gemini-3.5-flash",
            systemInstruction,
            promptText: "Please map the biomarker.",
            responseMimeType: "application/json"
          });
          
          let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
          res.json(JSON.parse(cleanJson));
        } catch (e) {
          console.error(e);
          res.status(500).json({ error: "Failed to route biomarker" });
        }
      });

      app.post("/api/gemini/route-chat", async (req, res) => {
        try {
          const { messages, selectedBiomarkers, allApprovedKeys } = req.body;
          const systemInstruction = `You are the Medical Ontology Route Agent, an expert clinical data and database architect.
Your task is to chat with the user to help them map their newly extracted biomarkers (unmapped) to the existing Master Database Keys, or decide if they should be added as new standard keys.

=== MASTER DATABASE KEYS ===
[${allApprovedKeys.join(', ')}]

=== CHOSEN BIOMARKERS TO DISCUSS ===
${JSON.stringify(selectedBiomarkers, null, 2)}

=== YOUR OBJECTIVES ===
1. Be clinical, friendly, and expert. Explain synonyms clearly (e.g. why "HbA1c" matches "hba1c").
2. Guide the user in consolidating their biomarkers.
3. If you can suggest a mapping for any or all of the chosen biomarkers, include a 'suggestedMapping' object in your JSON output. The keys of this object should be the chosen biomarker keys/names, and the values should be the target master keys (existing or newly proposed clean snake_case keys).

=== RESPONSE FORMAT ===
You MUST return a JSON object with the following schema:
{
  "text": "Your conversational response here (supports markdown formatting). Explain your reasoning clearly.",
  "suggestedMapping": { "source_key": "target_key" } // (Optional) set this when you are recommending a specific mapping/consolidation.
}`;

          const lastMessage = messages[messages.length - 1];
          const historyText = messages.slice(0, messages.length - 1)
            .map((m: any) => `${m.role === 'user' ? 'User' : 'Model'}: ${m.content}`)
            .join('\n');

          const promptText = `Chat History:\n${historyText}\n\nUser's latest message: "${lastMessage.content}"`;

          const textOutput = await callUnifiedLLM({
            modelId: "gemini-2.5-flash",
            systemInstruction,
            promptText,
            responseMimeType: "application/json"
          });

          let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
          res.json(JSON.parse(cleanJson));
        } catch (e) {
          console.error(e);
          res.status(500).json({ error: "Failed to process route chat" });
        }
      });

app.post("/api/gemini/standardize-units", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    const { selectedBiomarkers, metricSystem, engine, customSystemInstruction } = req.body;
    const modelId = engine || "gemini-3.1-flash-lite";
    addDebugLog(`[Standardize Units Agent] Request received to standardize ${selectedBiomarkers?.length} biomarkers to ${metricSystem} using model: ${modelId}.`, explicitSessionId);

    let systemInstruction = `You are an automated Clinical Unit Standardization Agent. Your task is to standardize units of measurement for selected biomarkers.

=== OBJECTIVE ===
For each provided biomarker, determine the appropriate unit of measurement for the requested target metric system (${metricSystem.toUpperCase()}).
- SI (Metric System): Use mmol/L, g/L, pmol/L, mmol/24h, g/dL, U/L, etc.
- US (Customary System): Use mg/dL, g/dL, pg/mL, mg/24h, U/L, etc.

For each biomarker, return:
1. Standardized Name (Clean Title Case).
2. The appropriate unit for the chosen system (${metricSystem.toUpperCase()}).

=== SYSTEM CONSTRAINTS ===
You MUST work in YAML. Return a single flat YAML array of objects. Do NOT use any Markdown blocks, wrapping backticks (e.g., do NOT wrap in \`\`\`yaml or \`\`\`), or extra text. Output ONLY the raw YAML text.
Do NOT change the values or ranges, and do NOT provide explanations. Your ONLY role is to standardize the unit.

YAML Array Item Schema:
- key: "biomarker_key"
  name: "Biomarker Name"
  unit: "standardized_unit"

Biomarkers to process:
${JSON.stringify(selectedBiomarkers, null, 2)}`;

    if (customSystemInstruction) {
      addDebugLog(`[Standardize Units Agent] Overriding system instruction with custom version (${customSystemInstruction.length} chars).`, explicitSessionId);
      systemInstruction = customSystemInstruction;
    }

    addDebugLog(`[Standardize Units Agent] Dispatched System Instruction (Length: ${systemInstruction.length})`, explicitSessionId);
    addDebugLog(`[Standardize Units Agent] Dispatched Model ID: ${modelId}`, explicitSessionId);

    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction,
      promptText: "Please output the standardized units in YAML format according to the requested schema. Output ONLY raw YAML.",
      responseMimeType: "text/plain"
    });

    let cleanYaml = textOutput.replace(/```(?:yaml|json)?/gi, "").trim();
    addDebugLog(`[Standardize Units Agent] Agent output payload:\n${cleanYaml}`, explicitSessionId);
    res.json({ yamlText: cleanYaml });
  } catch (error: any) {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    addDebugLog(`[Standardize Units Agent] Error: ${error.message}`, explicitSessionId);
    console.error("[Standardize Units Agent Error]:", error);
    res.status(500).json({ error: "Failed to standardize units: " + error.message });
  }
});

app.post("/api/gemini/medical-categorise", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    const { selectedBiomarkers, engine, customSystemInstruction } = req.body;
    const modelId = engine || "gemini-3.1-flash-lite";
    addDebugLog(`[Medical Categorisation Agent] Request received to categorise ${selectedBiomarkers?.length} biomarkers using model: ${modelId}.`, explicitSessionId);

    let systemInstruction = `You are an automated Clinical Categorisation Agent. Your task is to accurately map medical biomarkers to their appropriate physiological groupings and risk categories.

=== OBJECTIVE ===
For each provided biomarker, determine:
1. Standard Medical Grouping. Allowed values ONLY: 'Metabolic', 'Hepatic', 'Renal', 'Hematology', 'Biometrics', 'Other'
2. Risk Categories. A JSON array of string tags representing associated risks. YOU MUST ONLY CHOOSE FROM THESE EXACT CATEGORIES: "Cardiovascular", "Kidney", "Metabolic", "Liver", "Hematology", "Wellness", "Screenings". Do NOT invent new ones. If none apply, you MUST return an empty array [].
3. Potential Medical Conditions. A JSON array of string tags (e.g. ["Fatty Liver", "Obesity"]) representing associated conditions. If none apply, you MUST return an empty array [].

CRITICAL: You MUST include all fields (riskCategories and potentialMedicalConditions) in your YAML output. If a biomarker has no risks or conditions, output an empty array []. Do not omit the fields.

=== SYSTEM CONSTRAINTS ===
You MUST work in YAML. Return a single flat YAML array of objects. Do NOT use any Markdown blocks, wrapping backticks, or extra text. Output ONLY the raw YAML text.

YAML Array Item Schema:
- key: "biomarker_key"
  name: "Biomarker Name"
  standardMedicalGrouping: "One of the allowed values"
  riskCategories: ["Tag1", "Tag2"]
  potentialMedicalConditions: ["Condition1", "Condition2"]

Biomarkers to process:
${JSON.stringify(selectedBiomarkers, null, 2)}`;

    if (customSystemInstruction) {
      addDebugLog(`[Medical Categorisation Agent] Overriding system instruction with custom version (${customSystemInstruction.length} chars).`, explicitSessionId);
      systemInstruction = customSystemInstruction;
    }

    addDebugLog(`[Medical Categorisation Agent] Dispatched System Instruction (Length: ${systemInstruction.length})`, explicitSessionId);
    addDebugLog(`[Medical Categorisation Agent] Dispatched Model ID: ${modelId}`, explicitSessionId);

    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction,
      promptText: "Please output the categorisation in YAML format according to the requested schema. Output ONLY raw YAML.",
      responseMimeType: "text/plain"
    });

    let cleanYaml = textOutput.replace(/```(?:yaml|json)?/gi, "").trim();
    addDebugLog(`[Medical Categorisation Agent] Agent output payload:\n${cleanYaml}`, explicitSessionId);
    res.json({ yamlText: cleanYaml });
  } catch (error: any) {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    addDebugLog(`[Medical Categorisation Agent] Error: ${error.message}`, explicitSessionId);
    console.error("[Medical Categorisation Agent Error]:", error);
    res.status(500).json({ error: "Failed to categorise biomarkers: " + error.message });
  }
});

app.post("/api/gemini/consolidate-names", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    const { inputText, selectedBiomarkers, engine, customSystemInstruction } = req.body;
    const modelId = engine || "gemini-3.1-flash-lite";
    addDebugLog(`[Name Consolidation Agent] Request received using model: ${modelId}. Text length: ${inputText?.length || 0}. Biomarkers count: ${selectedBiomarkers?.length || 0}`, explicitSessionId);

    if (inputText) {
      addDebugLog(`[Name Consolidation Agent] User Prompt:\n${inputText}`, explicitSessionId);
    }

    let systemInstruction = `You are an automated Name Consolidation Agent. Your task is to identify clinical biomarkers with similar, synonymous, or variant names from a selected list and group them together to make consolidation easy.

=== OBJECTIVE ===
Analyze the selected list of biomarkers and group them by clinical equivalence (e.g. "Serum Albumin", "Albumin, Serum", "Albumin g/L" are all the same clinical biomarker and should be grouped together).
For each matched group, determine:
1. A standard recommended clinical name (e.g. "Serum Albumin").
2. A recommended unique key using snake_case (e.g. "serum_albumin").
3. A list of all matching source biomarkers that belong to this group.

=== SYSTEM CONSTRAINTS ===
- You MUST return a JSON object with this exact structure. Do NOT wrap it in markdown blocks. Return ONLY the raw valid JSON.
- DO NOT perform, input, or output any form of medical categorization, standard medical grouping, or physiological classification. This is entirely handled programmatically by the website, and you must not attempt to modify or determine medical groupings.

JSON Schema:
{
  "explanation": "A friendly conversational summary answering the user's prompt or explaining the proposed groupings.",
  "groups": [
    {
      "groupName": "Group Title (e.g. Serum Albumin)",
      "recommendedClinicalName": "Recommended Clinical Name",
      "recommendedUniqueKey": "recommended_unique_key",
      "biomarkers": [
        {
          "key": "original_biomarker_key",
          "name": "Original Biomarker Name",
          "unit": "Original Unit",
          "range": "Original normal range",
          "description": "Original description"
        }
      ]
    }
  ]
}

Biomarkers to process:
${JSON.stringify(selectedBiomarkers, null, 2)}`;

    if (customSystemInstruction) {
      addDebugLog(`[Name Consolidation Agent] Overriding system instruction with custom version (${customSystemInstruction.length} chars).`, explicitSessionId);
      systemInstruction = customSystemInstruction;
    }

    const dynamicPromptText = `USER DATA / CONVERSATION TEXT:
\"\"\"${inputText || "Please identify the duplicates from the provided list and consolidate them."}\"\"\"

Please output a valid JSON object matching the requested schema.`;

    addDebugLog(`[Name Consolidation Agent] Dispatched Model ID: ${modelId}`, explicitSessionId);

    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction,
      promptText: dynamicPromptText,
      responseMimeType: "application/json"
    });

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
      cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
    }

    const parsed = JSON.parse(cleanJson);
    
    if (parsed.explanation) {
      addDebugLog(`[Name Consolidation Agent] Agent Explanation:\n${parsed.explanation}`, explicitSessionId);
    }

    res.json(parsed);
  } catch (error: any) {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    addDebugLog(`[Name Consolidation Agent] Error: ${error.message}`, explicitSessionId);
    console.error("[Name Consolidation Agent Error]:", error);
    res.status(500).json({ error: "Failed to consolidate biomarker names: " + error.message });
  }
});

app.post("/api/gemini/data-accuracy", async (req, res) => {
  try {
    const explicitSessionId = (req.headers["x-session-id"] as string) || "global";
    const { inputText, currentState, images, currentLocalTime, engine, customSystemInstruction } = req.body;
    const modelId = engine || "gemini-3.1-flash-lite";
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

    const textOutput = await callUnifiedLLM({
      modelId,
      systemInstruction,
      promptText: dynamicPromptText,
      imagePayloads: imagesPayload,
      responseMimeType: "application/json"
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
      cleanJson = cleanJson.substring(firstBrace, lastBrace + 1);
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

app.post("/api/gemini/daily-recommendation-chat", async (req, res) => {
  addDebugLog('[DailyRecommendation] Starting daily recommendation chat process.');
  try {
    const { message, userProfile, engine, history, foodLogs, biomarkers, report, actions, steps, location, thisMonthTrends } = req.body;
    
    const systemInstruction = `You are a personalized AI Health Coach. 
Your goal is to look at the user's data (biomarkers, food logs, goals, daily steps, etc.) and provide an actionable, friendly, and clinical daily recommendation or answer their questions.

### User Data Context
Profile: ${JSON.stringify(userProfile)}
Report/Nutrient Targets: ${JSON.stringify(report?.dailyNutrientTargets || {})}
Biomarkers: ${JSON.stringify(biomarkers || {})}
Clinical Actions: ${JSON.stringify(actions || {})}
Recent Food Logs (titles & dates): ${JSON.stringify((foodLogs || []).slice(-15).map((f) => ({name: f.name, date: f.date})))}
Today's Steps: ${steps || 'Unknown'}
Location: ${JSON.stringify(location || 'Unknown')}
This Month Trends (Daily Nutrient Intakes and Steps): ${JSON.stringify(thisMonthTrends || {})}

### Guidelines
1. Be encouraging, precise, friendly, and clinically sound.
2. If this is the start of the chat (e.g. user says "What's up today?"), analyze their performance trends for top nutrients (calories, protein, saturated fat, sodium, carbs, total fat) this month and their daily steps. Tell them what they have achieved so far and give 1-2 highly practical, personalized recommendations for today based on their goals and biomarkers.
3. If the user asks a question, answer it professionally and warmly, drawing on their real dietary trends and health logs.
4. Use markdown formatting (bolding, lists, headers) to make the coach recommendation beautifully readable.
5. Do NOT output JSON. Output pure markdown text.`;

    let historyText = "";
    if (history && Array.isArray(history)) {
      historyText = history.map((m) => `${m.role === 'user' ? 'User' : 'Model'}: ${m.content}`).join('\n');
    }
    
    const promptText = `Chat History:\n${historyText}\n\nUser's latest message: "${message}"`;
    
    const textOutput = await callUnifiedLLM({
      modelId: engine,
      systemInstruction,
      promptText,
      responseMimeType: "text/plain"
    });
    
    res.json({ text: textOutput.trim() });
  } catch (error) {
    console.error("[Daily Recommendation Error]:", error);
    res.status(500).json({ error: "Failed to generate recommendation: " + error.message });
  }
});

app.post("/api/gemini/food-idea", async (req, res) => {
  addDebugLog(`[FoodIdea] Starting food-idea suggestion process.`);
  try {
    const { message, userProfile, location, recentMeals, engine, budget, currency, maxDistance, clientNearbyPlaces, outOfRangeBiomarkers, biomarkersNeedingImprovement, customSystemInstruction, customVariableData } = req.body;
    addDebugLog(`[FoodIdea] Request parameters - engine: "${engine || 'default'}", maxDistance: ${maxDistance || 3}km, budget: "${budget} ${currency}". Query: "${message}"`);

    if (process.env.GEMINI_API_KEY === undefined) {
      addDebugLog(`[FoodIdea] Warning: GEMINI_API_KEY is not defined in Secrets.`);
      return res.json({
        text: "Please note: GEMINI_API_KEY is not configured in the Secrets manager.",
        ideas: [
          {
            id: 'mock-1',
            name: "Grilled Chicken Salad",
            placeName: "Sweetgreen",
            address: "10 Downing St, London, UK",
            locationLink: "https://www.google.com/maps/search/?api=1&query=Sweetgreen+10+Downing+St+London+UK",
            benefitExplanation: "High protein and fiber, good for your profile.",
            tags: ["High Protein", "Low Carb"],
            distanceKm: 1.2,
            estimatedBudget: "£4.50",
            dishImageUrl: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80"
          }
        ]
      });
    }

    const budgetValue = budget || "100000";
    const currencyValue = currency || "IDR";
    const maxDistanceValue = maxDistance || 3;

    // Perform reverse-geocoding of coordinates to find exact human-readable address for highly accurate localized searches!
    let resolvedAddressText = "";
    let nearbyPlacesText = "";
    if (location && location.lat && location.lng) {
      const geoController = new AbortController();
      const geoTimeoutId = setTimeout(() => geoController.abort(), 3000);
      try {
        addDebugLog(`[ReverseGeocode] Reverse geocoding lat/lng: ${location.lat}, ${location.lng} via Nominatim...`);
        const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${location.lat}&lon=${location.lng}`, {
          headers: { 
            'User-Agent': 'HealthBiomarkerApplet/1.0 (Cwah.Liu@gmail.com)',
            'Accept-Language': 'en, id'
          },
          signal: geoController.signal
        });
        clearTimeout(geoTimeoutId);
        if (geoRes.ok) {
          const geoData = await geoRes.json();
          if (geoData && geoData.display_name) {
            resolvedAddressText = geoData.display_name;
            addDebugLog(`[ReverseGeocode] Resolved coordinates successfully to: "${resolvedAddressText}"`);
          }
        } else {
          addDebugLog(`[ReverseGeocode] HTTP error status: ${geoRes.status}`);
        }
      } catch (geoErr: any) {
        clearTimeout(geoTimeoutId);
        const isAbort = geoErr.name === 'AbortError';
        addDebugLog(`[ReverseGeocode] Failed or timed out (timed out: ${isAbort}). Continuing with coordinate context only.`);
      }

      // Use client-side overpass results if provided, otherwise try server-side
      if (clientNearbyPlaces && clientNearbyPlaces.length > 0) {
        const slicedClientPlaces = clientNearbyPlaces.slice(0, 6);
        addDebugLog(`[Overpass] Slicing ${clientNearbyPlaces.length} client-provided nearby places to ${slicedClientPlaces.length} items to bypass rate-limits.`);
        nearbyPlacesText = "CRITICAL DIRECTIVE: Here is a list of REAL nearby restaurants with their exact coordinates retrieved from OpenStreetMap just now. YOU MUST ONLY PICK RESTAURANTS FROM THIS LIST! DO NOT HALLUCINATE OR GUESS PLACES. Pick the 3-5 most appropriate places from this list for the user's diet:\n\n";
        slicedClientPlaces.forEach((el: any) => {
          nearbyPlacesText += `- Name: "${el.name}" (Lat: ${el.lat}, Lng: ${el.lng})\n`;
          if (el.address) nearbyPlacesText += `  Address: ${el.address}\n`;
          if (el.opening_hours) nearbyPlacesText += `  Hours: ${el.opening_hours}\n`;
        });
        nearbyPlacesText += "\nFor the 'placeName', 'lat', and 'lng' fields in your JSON response, use EXACTLY the names and coordinates from the list above. DO NOT guess coordinates!";
      } else {
        const overpassController = new AbortController();
        const overpassTimeoutId = setTimeout(() => overpassController.abort(), 4000);
        try {
          addDebugLog(`[Overpass] Querying OpenStreetMap Overpass API for restaurants within ${maxDistanceValue} km...`);
          const radius = Math.min(maxDistanceValue * 1000, 5000); // meters
          const overpassQuery = `[out:json];(node["amenity"~"restaurant|cafe|fast_food|food_court"](around:${radius},${location.lat},${location.lng}););out 30;`;
          
          const overpassRes = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: 'data=' + encodeURIComponent(overpassQuery),
            signal: overpassController.signal
          });
          clearTimeout(overpassTimeoutId);
          
          if (overpassRes.ok) {
            const overpassData = await overpassRes.json();
            if (overpassData && overpassData.elements && overpassData.elements.length > 0) {
              const namedElements = overpassData.elements.filter((el: any) => el.tags && el.tags.name);
              const slicedElements = namedElements.slice(0, 6);
              addDebugLog(`[Overpass] Slicing ${namedElements.length} server-found nearby places to ${slicedElements.length} items to bypass rate-limits.`);
              nearbyPlacesText = "CRITICAL DIRECTIVE: Here is a list of REAL nearby restaurants with their exact coordinates retrieved from OpenStreetMap just now. YOU MUST ONLY PICK RESTAURANTS FROM THIS LIST! DO NOT HALLUCINATE OR GUESS PLACES. Pick the 3-5 most appropriate places from this list for the user's diet:\n\n";
              slicedElements.forEach((el: any) => {
                nearbyPlacesText += `- Name: "${el.tags.name}" (Lat: ${el.lat}, Lng: ${el.lon})\n`;
                if (el.tags['addr:street']) {
                  nearbyPlacesText += `  Address: ${el.tags['addr:street']} ${el.tags['addr:housenumber'] || ''}\n`;
                }
                if (el.tags['opening_hours']) {
                  nearbyPlacesText += `  Hours: ${el.tags['opening_hours']}\n`;
                }
              });
              nearbyPlacesText += "\nFor the 'placeName', 'lat', and 'lng' fields in your JSON response, use EXACTLY the names and coordinates from the list above. DO NOT guess coordinates!";
              addDebugLog(`[Overpass] Resolved successfully! Formatted ${slicedElements.length} real nearby restaurants.`);
            } else {
              addDebugLog(`[Overpass] No real places found nearby from OpenStreetMap.`);
            }
          } else {
            addDebugLog(`[Overpass] HTTP error status: ${overpassRes.status}`);
          }
        } catch (err: any) {
          clearTimeout(overpassTimeoutId);
          const isAbort = err.name === 'AbortError';
          addDebugLog(`[Overpass] Failed or timed out (timed out: ${isAbort}). Continuing without nearby restaurant list.`);
        }
      }
    }

    const userCtx = userProfile ? `User Profile: Age ${userProfile.age}, Ethnicity: ${userProfile.ethnicity}, Weight: ${userProfile.weight}kg, Height: ${userProfile.height}cm.` : "User profile is unknown.";
    const userTimezone = userProfile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const userLocalTime = new Date().toLocaleString('en-US', { timeZone: userTimezone });
    
    const locCtx = location ? `User Location: Latitude ${location.lat}, Longitude ${location.lng}.\nUser Local Time: ${userLocalTime}` : `User Local Time: ${userLocalTime}`;
    const addressCtx = resolvedAddressText ? `User Human-Readable Address / Neighborhood: "${resolvedAddressText}"` : "Human-readable address is not resolved.";
    const nearbyCtx = nearbyPlacesText ? `\n\n${nearbyPlacesText}\n\n` : "";
    const mealsCtx = recentMeals && recentMeals.length > 0 ? `Recent Meals: ${recentMeals.join(', ')}.` : "No recent meals recorded.";
    const budgetCtx = `Max Budget Limit: ${budgetValue} ${currencyValue}. Suggested meals/dishes MUST fit within this price!`;
    const distanceCtx = `Max Distance Limit: ${maxDistanceValue} km. All suggested venues must be within ${maxDistanceValue} km of the user's current location!`;

    const biomarkersList = (biomarkersNeedingImprovement && Array.isArray(biomarkersNeedingImprovement) && biomarkersNeedingImprovement.length > 0)
      ? biomarkersNeedingImprovement.map((b: string) => `• ${b}`).join("\n")
      : (outOfRangeBiomarkers && outOfRangeBiomarkers.length > 0)
      ? outOfRangeBiomarkers.map((b: any) => `• ${b.name} is ${String(b.status).toUpperCase()} (${b.value} ${b.unit}, normal range: ${b.normalRange})`).join("\n")
      : "• None";

    let promptText = "";
    if (customVariableData) {
      promptText = `${customVariableData}\n\nCurrent User Input: "${message}"`;
    } else {
      promptText = `You are a personalized AI Dietitian.
${userCtx}
${locCtx}
${addressCtx}
${mealsCtx}
${budgetCtx}
${distanceCtx}
${nearbyCtx}

CRITICAL PATIENT BIOMARKER WARNINGS:
${biomarkersList}

Current User Input: "${message}"

CRITICAL SYSTEM REQUIREMENTS FOR VERACITY & LOGICAL ACCURACY:
1. VENUE SELECTION FROM PROVIDED LIST: You MUST ONLY select restaurants from the provided list of nearby REAL restaurants if it is provided. Do NOT invent or search for other restaurants. Use EXACTLY the lat and lng coordinates from the list. Do not modify the coordinates.
2. STRICT GEOGRAPHIC RADIUS ENFORCEMENT: If you must suggest a venue not on the list, it MUST be located within exactly ${maxDistanceValue} km of the user's location. Do not hallucinate coordinates.
3. SEARCH GROUNDING CONTEXT: Use Google Search Grounding ONLY to verify the selected restaurant's hours, reviews, or social media pages. Do not use it to find random new restaurants far away.
4. MAPS LINK PRECISION & ERROR HANDLING RULE: When you have a restaurant, call the \`get_google_maps_place_id\` tool EXACTLY ONCE per restaurant using the restaurant name and coordinates.
   - If the tool returns a valid place_id, construct the "locationLink" URL exactly like this: \`https://www.google.com/maps/search/?api=1&query={URL_ENCODED_NAME}&query_place_id={PLACE_ID}\`.
   - If the tool returns "NOT_FOUND", "ERROR_API_FAILED", or includes a "STOP TOOL USE" instruction, DO NOT call the tool again under any circumstances. Immediately construct the "locationLink" URL using the street address/name: \`https://www.google.com/maps/search/?api=1&query={URL_ENCODED_NAME}+{URL_ENCODED_STREET_NAME}\` or coordinate-based query if street name is unavailable. Do NOT retry or call the tool for other items if you hit a failure.
5. STRICT OPENING HOURS ENFORCEMENT: The user's current local time is ${userLocalTime}. You MUST capture the exact opening and closing time and add it to the result for the recommended place in the 'openingHours' field. You MUST use Google Search Grounding to actively search for the opening hours of the specific restaurant you recommend. Never use '--' unless you genuinely cannot find it online. You should only recommend places that are STILL OPEN 1 HOUR from the current local time!
6. REFERENCE LINK: For the 'menuLink' field, you MUST provide a direct, high-quality, real web link to the restaurant's actual official website, Instagram/Facebook page, TripAdvisor page, Yelp page, or specific Google Maps business page. DO NOT use generic Google Search query pages (like 'google.com/search?q=...') or generic placeholders, as this is unacceptable. Use Google Search Grounding to locate their actual website or profile!
7. ZERO-FIND FALLBACK & STRICT RADIUS: If no verified physical restaurants are found within the exact ${maxDistanceValue} km radius of the user's coordinates, YOU MUST NOT SUGGEST ANY PLACES. In this case, you MUST only suggest generic healthy dishes to cook at home (do not include placeName, address, lat, lng, locationLink, menuLink, or distanceKm). Clearly explain in your text response that no verified venues were found within ${maxDistanceValue} km, and suggest increasing the search radius. NEVER hallucinate places far away or fake coordinates.

Include a short conversational response (text), and a list of between 3 and 5 distinct, diverse structured food ideas (ideas) that meet the constraints. Under no circumstances should you return only 1 idea.
Each idea should have:
- name: string (A general, common healthy food category they serve, e.g. "Grilled Chicken Salad" or "Sushi". DO NOT hallucinate exact menu items unless verified.)
- placeName: string (Optional. The verified, real-world restaurant name. Omit if suggesting a home-cooked meal.)
- address: string (Optional. The verified, exact physical street address.)
- lat: number (Optional. The latitude of the suggested place. Omit if no place is found within the radius.)
- lng: number (Optional. The longitude of the suggested place. Omit if no place is found within the radius.)
- locationLink: string (Optional. Google Maps Search URL)
- menuLink: string (Optional. A URL to ANY relevant webpage about the restaurant, such as Google Maps, Yelp, Instagram, or their website. DO NOT use recipe search links!)
- distanceKm: number (Optional. The straight-line physical distance in km. This MUST be strictly <= ${maxDistanceValue} km! Omit if home-cooked.)
- estimatedBudget: string (The estimated price of this suggested dish, formatted nicely with the currency symbol, e.g., "Rp 45,000" or "£3.50". This MUST be within the maximum budget of ${budgetValue} ${currencyValue}!)
- dishImageUrl: string (A valid, beautiful, and relevant Unsplash food image URL showing this specific type of dish, e.g., "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80" for a salad, or a suitable search query image URL from Unsplash.)
- benefitExplanation: string (Why this is good for the user's profile)
- tags: array of strings (e.g. ["High Protein", "Low Carb"])
- openingHours: string (The opening hours of the restaurant. E.g., "10:00 AM - 10:00 PM". Search for it actively!)

Respond with a structured JSON format matching this schema exactly:
{
  "text": "Your conversational response here",
  "ideas": [
    {
      "name": "Food Name",
      "placeName": "Restaurant or Place Name",
      "address": "123 Main St, City, State",
      "lat": -6.2088,
      "lng": 106.8456,
      "locationLink": "https://www.google.com/maps/search/?api=1&query=HokBen&query_place_id=ChIJKZ1Uh-P1aS4R61b3Rsx8mSU",
      "menuLink": "https://www.hokben.co.id/",
      "distanceKm": 1.2,
      "estimatedBudget": "Rp 45,000",
      "dishImageUrl": "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&w=600&q=80",
      "benefitExplanation": "Why this is good...",
      "tags": ["tag1", "tag2"],
      "openingHours": "10:00 AM - 10:00 PM"
    }
  ]
}`;
    }

    const sysInstruction = customSystemInstruction || "You are a world-class AI dietitian. Your response must be an exact JSON matching the requested schema. Never add markdown wrappers.";

    const textOutput = await callUnifiedLLM({
      modelId: engine || "gemini-2.5-flash",
      systemInstruction: sysInstruction,
      promptText,
      responseMimeType: "application/json",
      googleSearch: true,
      enablePlaceIdTool: !!process.env.GOOGLE_MAPS_API_KEY
    });

    let cleanJson = textOutput.replace(/```(?:json)?/gi, "").trim();
    let parsedData;
    try {
      parsedData = JSON.parse(cleanJson);
    } catch (parseErr: any) {
      const firstBrace = cleanJson.indexOf("{");
      const lastBrace = cleanJson.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        parsedData = JSON.parse(cleanJson.substring(firstBrace, lastBrace + 1));
      } else {
        throw parseErr;
      }
    }

    if (parsedData.ideas && Array.isArray(parsedData.ideas)) {
      parsedData.ideas = parsedData.ideas.map((idea: any) => ({
        ...idea,
        id: 'idea_' + Date.now() + Math.random().toString(36).substr(2, 9)
      }));
    }

    parsedData.agentPrompt = `System Instruction:\nYou are a world-class AI dietitian. Your response must be an exact JSON matching the requested schema. Never add markdown wrappers.\n\n${promptText}`;
    res.json(parsedData);
  } catch (error: any) {
    addDebugLog(`[FoodIdea] Error occurred: ${error.message || error}`);
    console.error("[Food Idea Analyze Error]:", error);
    const isQuotaError = error.message?.includes("429") || error.message?.includes("quota") || error.message?.includes("RESOURCE_EXHAUSTED");
    
    const errorMsg = isQuotaError
      ? "Unable to provide recommendations: Gemini API quota or rate limit reached. Please verify your API key or try again in a few minutes."
      : "Unable to provide recommendations: The agent connection has timed out or the request could not be processed. Please try again.";

    res.json({
      text: errorMsg,
      ideas: []
    });
  }
});

// Endpoint to fetch real-time agent thinking process logs
app.get("/api/gemini/debug-logs", (req, res) => {
  const sessionId = (req.headers["x-session-id"] as string) || (req.query.sessionId as string) || "global";
  let logs = globalDebugLogs;
  if (sessionId !== "global" && sessionDebugLogs[sessionId]) {
    logs = sessionDebugLogs[sessionId];
  }
  res.json({ logs });
});

// Endpoint to clear the backend agent process logs
app.post("/api/gemini/clear-debug-logs", (req, res) => {
  const sessionId = (req.headers["x-session-id"] as string) || (req.query.sessionId as string) || "global";
  if (sessionId !== "global") {
    sessionDebugLogs[sessionId] = [];
  } else {
    globalDebugLogs = [];
  }
  addDebugLog(`[System] Debug logs cleared by user request.`, sessionId !== "global" ? sessionId : undefined);
  res.json({ status: "cleared", logs: [] });
});

// Endpoint to compile logs and send to admin
app.post("/api/gemini/send-logs", (req, res) => {
  try {
    const sessionId = (req.headers["x-session-id"] as string) || (req.query.sessionId as string) || "global";
    const { logsText } = req.body;
    
    // Create admin logs directory if not exists
    const logsDir = path.join(process.cwd(), "data", "admin_logs");
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    const timestampStr = new Date().toISOString().replace(/[:.]/g, "-");
    const filePath = path.join(logsDir, `admin_logs_${sessionId}_${timestampStr}.txt`);
    
    const formattedContent = `ADMIN LOGS EXPORT\nTarget Admin: cwah.liu@gmail.com\nTimestamp: ${new Date().toLocaleString()}\nSession ID: ${sessionId}\n\n=========================================\n\n${logsText || "No logs provided."}`;
    
    fs.writeFileSync(filePath, formattedContent, "utf8");
    
    // Also append to a single rolling admin_logs_all.txt for convenience
    const rollingFilePath = path.join(logsDir, "admin_logs_all.txt");
    fs.appendFileSync(rollingFilePath, `\n\n=== EXPORTED AT ${new Date().toISOString()} (Session: ${sessionId}) ===\n${logsText}\n`, "utf8");
    
    addDebugLog(`[AdminExport] Emailed and compiled entire log history to cwah.liu@gmail.com. Saved locally to ${filePath}`);
    
    res.json({ 
      status: "success", 
      message: "Debug logs compiled and sent to cwah.liu@gmail.com. They have also been saved to the server persistent volume.",
      filePath
    });
  } catch (err: any) {
    console.error("Error exporting logs:", err);
    res.status(500).json({ error: "Failed to export debug logs to admin." });
  }
});

// Google Health / Google Fit OAuth Endpoints
app.get('/api/health-connect/url', (req, res) => {
  // Use the host header directly for the redirect URI
  const host = req.get('host');
  const protocol = host?.includes('localhost') ? 'http' : 'https';
  const redirectUri = `${protocol}://${host}/health-connect/callback`;
  
  const params = new URLSearchParams({
    client_id: process.env.GHealth_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/fitness.activity.read',
    access_type: 'offline',
    prompt: 'consent'
  });
  res.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, redirectUri });
});

app.get(['/health-connect/callback', '/health-connect/callback/'], async (req, res) => {
  const { code } = req.query;
  const host = req.get('host');
  const protocol = host?.includes('localhost') ? 'http' : 'https';
  const redirectUri = `${protocol}://${host}/health-connect/callback`;

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        code: code as string,
        client_id: process.env.GHealth_CLIENT_ID || '',
        client_secret: process.env.GHealth_CLIENT_SECRET || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok) {
      throw new Error(JSON.stringify(tokenData));
    }

    res.send(`
      <html>
        <body>
          <script>
            try {
              localStorage.setItem('ghealth_tokens', JSON.stringify(${JSON.stringify(tokenData)}));
              localStorage.setItem('ghealth_auth_status', 'SUCCESS');
            } catch (e) {
              console.error("Failed to write to localStorage:", e);
            }

            if (window.opener) {
              try {
                window.opener.postMessage({ type: 'GHEALTH_AUTH_SUCCESS', tokens: ${JSON.stringify(tokenData)} }, '*');
              } catch (e) {
                console.error("Failed to postMessage:", e);
              }
              window.close();
            } else {
              setTimeout(() => {
                window.close();
              }, 1500);
            }
          </script>
          <div style="font-family: sans-serif; text-align: center; padding-top: 40px; color: #333;">
            <h3 style="color: #4f46e5; margin-bottom: 8px;">Connection Successful!</h3>
            <p style="margin: 4px 0; font-size: 14px;">Your Google Health account has been connected.</p>
            <p style="font-size: 12px; color: #666; margin-top: 12px;">This window will close automatically.</p>
          </div>
        </body>
      </html>
    `);
  } catch (err: any) {
    console.error("GHealth OAuth error:", err);
    res.status(500).send(`Error exchanging code for tokens: ${err.message}`);
  }
});

app.post('/api/health-connect/refresh', async (req, res) => {
  const { refresh_token } = req.body;
  if (!refresh_token) {
    return res.status(400).json({ error: 'Missing refresh_token' });
  }

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: process.env.GHealth_CLIENT_ID || '',
        client_secret: process.env.GHealth_CLIENT_SECRET || '',
        refresh_token: refresh_token,
        grant_type: 'refresh_token'
      })
    });

    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401 || response.status === 400) {
         return res.status(response.status).json(data);
      }
      throw new Error(JSON.stringify(data));
    }
    
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/health-connect/diagnostics', async (req, res) => {
  const { access_token } = req.body;
  if (!access_token) return res.status(401).json({ error: 'Missing access_token' });

  try {
    const tokenInfoRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${access_token}`);
    const tokenInfo = await tokenInfoRes.json();

    const dsRes = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataSources', {
      headers: { 'Authorization': `Bearer ${access_token}` }
    });
    const dsData = await dsRes.json();

    res.json({
      tokenInfo: tokenInfo,
      dataSourcesCount: dsData.dataSource ? dsData.dataSource.length : 0,
      dataSources: dsData.dataSource ? dsData.dataSource.map((d: any) => d.dataStreamId) : dsData
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/health-connect/steps', async (req, res) => {
  const { access_token, startTimeMillis, endTimeMillis } = req.body;
  
  if (!access_token) {
    return res.status(401).json({ error: 'Missing access_token' });
  }

  try {
    const now = new Date();
    const endTime = endTimeMillis || now.getTime();
    
    // startTimeMillis is provided as the local start of today (midnight).
    const startTime = startTimeMillis || (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime());

    // Align queryStartTime to exactly 7 days before today's midnight to ensure 24h buckets align with midnight.
    const queryStartTime = startTime - 7 * 24 * 60 * 60 * 1000;

    console.log(`[GoogleFit] Querying from ${new Date(queryStartTime).toISOString()} to ${new Date(endTime).toISOString()} with primary datasource estimated_steps...`);

    // 1. Primary: Aggregate using the estimated_steps datasource as requested by the user.
    let response = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${access_token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        aggregateBy: [{
          dataTypeName: 'com.google.step_count.delta',
          dataSourceId: 'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps'
        }],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis: queryStartTime,
        endTimeMillis: endTime
      })
    });

    let data = await response.json();
    
    // If the specific estimated_steps fails, try general com.google.step_count.delta as fallback
    if (!response.ok) {
      console.warn("Primary estimated_steps aggregation failed, trying general com.google.step_count.delta...");
      response = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          aggregateBy: [{
            dataTypeName: 'com.google.step_count.delta'
          }],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis: queryStartTime,
          endTimeMillis: endTime
        })
      });
      data = await response.json();
    }

    if (!response.ok) {
      console.warn("General delta also failed, trying com.google.step_count.cumulative...");
      response = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          aggregateBy: [{
            dataTypeName: 'com.google.step_count.cumulative'
          }],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis: queryStartTime,
          endTimeMillis: endTime
        })
      });
      data = await response.json();
    }

    if (!response.ok) {
      const errMessage = JSON.stringify(data);
      if (response.status === 401 || response.status === 400 || errMessage.includes('invalid_token') || errMessage.includes('401')) {
        return res.status(401).json({ error: errMessage });
      }
      throw new Error(errMessage);
    }

    // Parse the steps day-by-day (each bucket represents 1 day)
    let todaySteps = 0;
    let totalSevenDaySteps = 0;
    let lastActiveDaySteps = 0;
    let lastActiveDayTimestamp = "";
    let activeDaysCount = 0;
    let history: { date: string, value: number }[] = [];

    if (data.bucket && data.bucket.length > 0) {
      data.bucket.forEach((b: any) => {
        let bucketSteps = 0;
        if (b.dataset && b.dataset[0] && b.dataset[0].point && b.dataset[0].point.length > 0) {
          b.dataset[0].point.forEach((p: any) => {
            if (p.value && p.value[0]) {
              if (p.value[0].intVal !== undefined) {
                bucketSteps += p.value[0].intVal;
              } else if (p.value[0].fpVal !== undefined) {
                bucketSteps += Math.round(p.value[0].fpVal);
              }
            }
          });
        }

        totalSevenDaySteps += bucketSteps;
        if (bucketSteps > 0) {
          lastActiveDaySteps = bucketSteps;
          activeDaysCount++;
          if (b.startTimeMillis) {
            lastActiveDayTimestamp = new Date(parseInt(b.startTimeMillis, 10)).toLocaleDateString();
          }
        }
        
        if (b.startTimeMillis) {
          const dateStr = new Date(parseInt(b.startTimeMillis, 10)).toISOString().split('T')[0];
          history.push({ date: dateStr, value: bucketSteps });
        }

        // Check if this bucket corresponds to today's range
        const bucketStart = parseInt(b.startTimeMillis || "0", 10);
        const bucketEnd = parseInt(b.endTimeMillis || "0", 10);
        
        // If this bucket is today's bucket
        if (bucketStart >= startTime) {
          todaySteps += bucketSteps;
        }
      });
    }

    // Robust raw dataset query fallbacks (direct point read instead of aggregate query)
    // Helps with third-party sync apps or devices logging directly to Fit without bucket aggregate syncing.
    if (todaySteps === 0 && totalSevenDaySteps === 0) {
      console.log("[GoogleFit] Aggregate returned 0 steps. Activating dynamic direct dataset query fallbacks...");
      
      let bestSum = 0;
      let bestDataSaved = null;
      let bestSourceName = "";

      try {
        const dsRes = await fetch('https://www.googleapis.com/fitness/v1/users/me/dataSources', {
          headers: { 'Authorization': `Bearer ${access_token}` }
        });
        if (dsRes.ok) {
          const dsData = await dsRes.json();
          if (dsData.dataSource && dsData.dataSource.length > 0) {
            const stepSources = dsData.dataSource.filter((d: any) => 
              d.dataType && d.dataType.name && d.dataType.name.includes("step_count")
            );

            for (const source of stepSources) {
              try {
                let currentSum = 0;
                let currentTodaySum = 0;
                const sourceId = encodeURIComponent(source.dataStreamId);
                const rawRes = await fetch(
                  `https://www.googleapis.com/fitness/v1/users/me/dataSources/${sourceId}/datasets/${queryStartTime * 1000000}-${endTime * 1000000}`,
                  { headers: { 'Authorization': `Bearer ${access_token}` } }
                );
                
                if (rawRes.ok) {
                  const rawData = await rawRes.json();
                  if (rawData.point && rawData.point.length > 0) {
                    if (source.dataType.name === "com.google.step_count.cumulative") {
                      // For cumulative, we sum positive differences between consecutive points
                      let lastVal = -1;
                      rawData.point.forEach((p: any) => {
                        if (p.value && p.value[0]) {
                          let val = p.value[0].intVal !== undefined ? p.value[0].intVal : (p.value[0].fpVal !== undefined ? Math.round(p.value[0].fpVal) : 0);
                          let delta = 0;
                          if (lastVal !== -1) {
                            if (val >= lastVal) {
                              delta = val - lastVal;
                            } else {
                              // Counter reset
                              delta = val;
                            }
                          }
                          currentSum += delta;
                          
                          // Check if point is from today
                          const pEndMillis = p.endTimeNanos ? Number(p.endTimeNanos) / 1000000 : 0;
                          if (pEndMillis >= startTime) {
                            currentTodaySum += delta;
                          }

                          lastVal = val;
                        }
                      });
                    } else {
                      // For delta, we just sum them up
                      rawData.point.forEach((p: any) => {
                        if (p.value && p.value[0]) {
                          let val = p.value[0].intVal !== undefined ? p.value[0].intVal : (p.value[0].fpVal !== undefined ? Math.round(p.value[0].fpVal) : 0);
                          currentSum += val;
                          
                          const pEndMillis = p.endTimeNanos ? Number(p.endTimeNanos) / 1000000 : 0;
                          if (pEndMillis >= startTime) {
                            currentTodaySum += val;
                          }
                        }
                      });
                    }
                    
                    if (currentSum > bestSum) {
                      bestSum = currentSum;
                      todaySteps = currentTodaySum;
                      bestDataSaved = rawData;
                      bestSourceName = source.dataStreamId;
                    }
                  }
                }
              } catch (e) {
                console.warn(`[GoogleFit] Raw query failed for ${source.dataStreamId}`, e);
              }
            }
          }
        }
      } catch (e) {
        console.warn("[GoogleFit] Failed to fetch data sources for fallback:", e);
      }

      // Use the best available source
      if (bestSum > 0) {
        totalSevenDaySteps = bestSum;
        data = { source: `dynamic_raw_${bestSourceName}`, totalPoints: bestDataSaved?.point?.length, ...bestDataSaved };
        console.log(`[GoogleFit] Successfully retrieved ${bestSum} raw steps via fallback from ${bestSourceName}! Today steps: ${todaySteps}`);
      }
    }

    const sevenDayAverage = activeDaysCount > 0 ? Math.round(totalSevenDaySteps / activeDaysCount) : Math.round(totalSevenDaySteps / 7);

    res.json({ 
      steps: todaySteps, 
      sevenDayTotal: totalSevenDaySteps,
      sevenDayAverage,
      lastActiveDaySteps: lastActiveDaySteps || todaySteps,
      lastActiveDayTimestamp: lastActiveDayTimestamp || new Date().toLocaleDateString(),
      history,
      raw: data 
    });
  } catch (err: any) {
    console.error("GHealth Steps error:", err);
    res.status(500).json({ error: "Failed to fetch steps: " + err.message });
  }
});

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Health Cockpit App] Full-Stack server running on port ${PORT}`);
  });
}

startServer();
