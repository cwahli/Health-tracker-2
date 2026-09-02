import { Router } from 'express';
import { getGeminiClient } from './server.js';
import { runBiomarkerPipeline } from './src/server/biomarkers/pipeline.js';

export const medicalGeminiRouter = Router();

medicalGeminiRouter.post("/api/gemini/medical-analyze", async (req, res) => {
  const isStream = req.query.stream === 'true';
  let hasSentHeaders = false;

  if (isStream) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
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

  try {
    let { 
      message, 
      images, 
      history, 
      userProfile, 
    } = req.body;

    const ai = getGeminiClient();
    
    // In production, the old format had single `image` base64 string or `images` array.
    let base64Images: string[] = [];
    if (images && Array.isArray(images)) {
        base64Images = images;
    } else if (req.body.image) {
        base64Images = [req.body.image];
    }

    const onProgress = (msg: string) => {
       sendStreamEvent({ type: 'log', logType: 'status', message: msg, timestamp: Date.now() });
    };

    onProgress("Starting Medical Analyze Pipeline...");
    
    // Clean up history to match Record<string, LogPoint[]> expected by backoffice
    const formattedHistory: Record<string, any[]> = {};
    if (history && Array.isArray(history)) {
       // but wait, `history` in the old backend actually came from `biomarkerHistory` or `history` (messages).
       // In LogChat.tsx, it sends `biomarkerHistory`.
    }
    const biomarkerHistory = req.body.biomarkerHistory || [];
    for (const h of biomarkerHistory) {
         if (h.biomarkers) {
             Object.keys(h.biomarkers).forEach(k => {
                  if (!formattedHistory[k]) formattedHistory[k] = [];
                  formattedHistory[k].push({
                      date: h.date,
                      value: h.biomarkers[k]
                  });
             });
         }
    }

    const finalRows = await runBiomarkerPipeline(
       ai,
       message || "",
       base64Images,
       formattedHistory,
       userProfile || { age: 43, gender: 'male', ethnicity: 'Unknown', unitPreference: 'SI' },
       onProgress
    );

    sendStreamEvent({ type: 'log', logType: 'status', message: "Pipeline complete", timestamp: Date.now() });
    
    const result = {
        filledRows: finalRows, text: `Processed ${finalRows.length} biomarker(s).`
    };

    if (isStream) {
      sendStreamEvent({ final: true, result });
      res.end();
    } else {
      res.json(result);
    }
  } catch (error: any) {
    console.error("Pipeline error:", error);
    if (isStream && hasSentHeaders) {
       sendStreamEvent({ error: error.message });
       res.end();
    } else {
       res.status(500).json({ error: error.message });
    }
  }
});
