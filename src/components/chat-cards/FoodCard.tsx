import { formatMessageContent } from '../../utils/formatUtils';
import { NutritionLabelTable, checkHasNutritionLabels } from "./NutritionLabelTable";
import { MealPortionController } from './MealPortionController';
import { trackApiCall } from '../../utils/apiTracker';
import { PhysicalFormBadge } from '../PhysicalFormBadge';
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PositionedTooltip } from '../ui/PositionedTooltip';
import { AgentCardProps } from './types';
import { Plus, Check, ChevronDown, ChevronUp, Sparkles, Search, X, Trash2, Eye, Camera, Copy, Flag, Download, Loader2 } from 'lucide-react';
import { UniversalModal } from '../UniversalModal';
import { flagIssueToServer, guessChainKey, ISSUE_TYPE_LABELS, IssueType } from '../../utils/issueBacklog';
import { getAgentRequestLogs } from '../../utils/agentLogsTracker';
import { ComprehensiveNutrientsTable } from './ComprehensiveNutrientsTable';
import { JobStore } from '../../jobs/JobStore';
import { toPendingFoodLog } from '../../mealBuild/adapters';
import { namesReferToSameFood } from '../../../server_scout_reconcile';
import { extractMostRecentImageDate, getCurrentDateInTimezone } from '../../utils/dateUtils';
import { normalizeMealImageUrl } from '../../utils/foodImageSources';
import { scaleMealPortion, scaleSingleDishPortion } from '../../utils/portionUtils';
function foodCardName(item: any): string {
  return item?.canonicalDbName || item?.name || item?.originalName || item?.keyword || '';
}
function scoutCardName(s: any): string {
  return s?.originalName || s?.keyword || s?.name || '';
}
/** Scout index matches the exact visual detected slot for the dish */
function scoutIndexAgrees(item: any, s: any): boolean {
  if (s?.scoutIndex === undefined || item?.scoutIndex === undefined || s?.scoutIndex === null || item?.scoutIndex === null) return false;
  return Number(s.scoutIndex) === Number(item.scoutIndex);
}
function parseLabelCalories(raw: any): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) return raw;
  if (typeof raw === 'object') {
    const v = raw.calories ?? raw.energy ?? raw.kcal ?? raw['Energy (kcal)'];
    return parseLabelCalories(v);
  }
  const s = String(raw).replace(/,/g, '').trim();
  const kcalMatch = s.match(/(-?\d+(?:\.\d+)?)\s*kcal/i);
  if (kcalMatch) {
    const n = parseFloat(kcalMatch[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const kjMatch = s.match(/(-?\d+(?:\.\d+)?)\s*kj/i);
  if (kjMatch) {
    const kj = parseFloat(kjMatch[1]);
    if (Number.isFinite(kj) && kj > 0) {
      return Math.round((kj / 4.184) * 10) / 10;
    }
  }
  const m = s.match(/(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
const safeTruncate = (str: any, maxLen: number = 100): string => {
  if (!str) return '';
  const s = String(str);
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen) + '...';
};
function getCleanAnomalyFlags(item: any): string[] {
  if (!item || !Array.isArray(item.anomalyFlags)) return [];
  return item.anomalyFlags.filter((f: string) => 
    typeof f === 'string' &&
    !f.includes('Converted printed salt') &&
    !f.includes('Formula: 1g salt') &&
    !f.toLowerCase().includes('converted printed salt')
  );
}
function isItemUnclearOrLowConfidence(item: any): boolean {
  if (!item) return false;
  const conf = (item.itemConfidence || '').toLowerCase();
  const isHigh = conf === 'high' || conf.includes('high');
  if (isHigh) return false; // If scout says it's high confidence, trust it and don't flag as unclear
  const isLowOrMed = conf === 'low' || conf === 'medium' || conf.includes('low') || conf.includes('medium');
  const cleanFlags = getCleanAnomalyFlags(item);
  return isLowOrMed || cleanFlags.length > 0;
}

const InfoTooltipBadge: React.FC<{ title?: string }> = ({ title }) => {
  if (!title) return null;

  const decodedTitle = title.replace(/&quot;/g, '"');
  const parts = decodedTitle.split(/\s*;;;\s*|\s*;;\s*/);

  const content = parts.length > 1 ? (
    <div className="space-y-1 font-sans">
      {parts.map((part, idx) => {
        const trimmed = part.trim();
        const lower = trimmed.toLowerCase();
        if (lower.startsWith('classification:')) {
          return (
            <div key={idx} className="font-mono font-bold text-[10px] text-cyan-300 border-b border-slate-700/80 pb-1 tracking-wider">
              {trimmed}
            </div>
          );
        }
        if (lower.startsWith('matched keywords:')) {
          const kwVal = trimmed.substring(trimmed.indexOf(':') + 1).trim();
          return (
            <div key={idx} className="text-[10px] text-slate-300">
              <span className="font-bold text-slate-400 uppercase tracking-wider">Matched Keywords: </span>
              <span className="font-mono text-emerald-300">{kwVal}</span>
            </div>
          );
        }
        if (idx === 1 || trimmed.startsWith('"') || trimmed.startsWith("'")) {
          const rawName = trimmed.replace(/^["']|["']$/g, '');
          return (
            <div key={idx} className="font-semibold text-indigo-300 text-[11px]">
              "{rawName}"
            </div>
          );
        }
        return (
          <div key={idx} className="pt-0.5 border-t border-slate-700/60 text-[9px] font-mono text-slate-400">
            {trimmed}
          </div>
        );
      })}
    </div>
  ) : (
    <div className="text-[11px] leading-relaxed">{decodedTitle}</div>
  );

  return (
    <span className="inline-block ml-1">
      <PositionedTooltip
        trigger={
          <div
            className="inline-flex items-center justify-center w-3.5 h-3.5 text-[9px] font-bold text-indigo-600 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-900/80 hover:bg-indigo-200 dark:hover:bg-indigo-800 rounded-full cursor-pointer transition-all select-none border border-indigo-300/50 dark:border-indigo-700/50 focus:outline-none"
            aria-label="Info explanation"
          >
            ℹ️
          </div>
        }
        content={content}
        contentClassName="bg-slate-900/95 dark:bg-slate-800/95 text-white border-slate-700/80"
      />
    </span>
  );
};

function build31NutrientsMarkdownClient(nutrients: Record<string, any>): string {
  if (!nutrients || typeof nutrients !== 'object') return '';

  const coreList = [
    { key: 'calories', label: 'Calories', unit: 'kcal' },
    { key: 'protein', label: 'Protein', unit: 'g' },
    { key: 'carbohydrates', label: 'Carbohydrates', unit: 'g' },
    { key: 'totalFat', label: 'Total Fat', unit: 'g' },
    { key: 'saturatedFat', label: 'Saturated Fat', unit: 'g' },
    { key: 'transFat', label: 'Trans Fat', unit: 'g' },
    { key: 'sugar', label: 'Total Sugar', unit: 'g' },
    { key: 'addedSugar', label: 'Added Sugar', unit: 'g' },
    { key: 'sodium', label: 'Sodium', unit: 'mg' },
    { key: 'potassium', label: 'Potassium', unit: 'mg' },
    { key: 'totalFibre', label: 'Total Fibre', unit: 'g' },
    { key: 'solubleFibre', label: 'Soluble Fibre', unit: 'g' },
  ];

  const additionalList = [
    { key: 'unsaturatedFat', label: 'Unsaturated Fat', unit: 'g' },
    { key: 'omega3', label: 'Omega-3', unit: 'g' },
    { key: 'salt', label: 'Salt', unit: 'g' },
    { key: 'magnesium', label: 'Magnesium', unit: 'mg' },
    { key: 'calcium', label: 'Calcium', unit: 'mg' },
    { key: 'iron', label: 'Iron', unit: 'mg' },
    { key: 'zinc', label: 'Zinc', unit: 'mg' },
    { key: 'selenium', label: 'Selenium', unit: 'mcg' },
    { key: 'iodine', label: 'Iodine', unit: 'mcg' },
    { key: 'phosphorus', label: 'Phosphorus', unit: 'mg' },
    { key: 'vitaminD', label: 'Vitamin D', unit: 'IU' },
    { key: 'vitaminB12', label: 'Vitamin B12', unit: 'mcg' },
    { key: 'folate', label: 'Folate (B9)', unit: 'mcg' },
    { key: 'vitaminC', label: 'Vitamin C', unit: 'mg' },
    { key: 'vitaminE', label: 'Vitamin E', unit: 'mg' },
    { key: 'vitaminK', label: 'Vitamin K', unit: 'mcg' },
    { key: 'vitaminA', label: 'Vitamin A', unit: 'mcg' },
    { key: 'vitaminB6', label: 'Vitamin B6', unit: 'mg' },
    { key: 'thiamine', label: 'Thiamine (B1)', unit: 'mg' },
    { key: 'riboflavin', label: 'Riboflavin (B2)', unit: 'mg' },
    { key: 'niacin', label: 'Niacin (B3)', unit: 'mg' },
  ];

  const fmt = (v: any, unit: string, key?: string, isAdditionalTrace?: boolean) => {
    if (key === 'salt' && (v === undefined || v === null || isNaN(Number(v)))) {
      if (nutrients && nutrients.sodium !== undefined && nutrients.sodium !== null && !isNaN(Number(nutrients.sodium))) {
        const saltGrams = (Number(nutrients.sodium) * 2.54) / 1000;
        const roundedSalt = Math.round(saltGrams * 100) / 100;
        return roundedSalt === 0 && saltGrams > 0 ? '<0.01 g' : `${roundedSalt} g`;
      }
    }
    if (v === undefined || v === null || isNaN(Number(v))) return '--';
    const num = Math.round(Number(v) * 100) / 100;
    // The 20 "additional" trace nutrients (selenium, riboflavin, niacin, B6, B12,
    // phosphorus, etc.) are currently only ever populated from sources that supply a real
    // measured value — nothing in the pipeline computes a genuine, non-zero 0 for these.
    // So an exact 0 here means "not measured," not "confirmed zero," and showing a bare
    // "0" would misleadingly imply the food has none of that nutrient. Core nutrients
    // (calories, protein, etc.) are unaffected — they're always populated.
    if (isAdditionalTrace && num === 0) return 'N/A';
    return unit ? `${num} ${unit}` : `${num}`;
  };

  const coreRows = coreList.map(item => `| ${item.label} | ${fmt(nutrients[item.key], item.unit, item.key)} |`);
  const addRows = additionalList.map(item => `| ${item.label} | ${fmt(nutrients[item.key], item.unit, item.key, true)} |`);

  return [
    "\n### 📋 Comprehensive Nutrient Values (31 Nutrients)\n",
    "#### Core Nutrients (11)",
    "| Nutrient | Value |",
    "|---|---|",
    ...coreRows,
    "\n#### Additional Nutrients (20)",
    "| Nutrient | Value |",
    "|---|---|",
    ...addRows
  ].join("\n");
}

export const ScratchpadMarkdownViewer: React.FC<{ content: any; className?: string; showCopyButton?: boolean; nutrients?: Record<string, any>; msg?: any; pendingFoodLog?: any }> = ({ content, className = '', showCopyButton = false, nutrients, msg, pendingFoodLog }) => {
  const [isCopied, setIsCopied] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const strContent = typeof content === 'string' ? content : (content && typeof content === 'object' ? (content.text || content.message || JSON.stringify(content)) : String(content || ''));
  if (!strContent || !strContent.trim()) return null;
  const cleanContent = strContent.replace(/\\\|/g, '•');

  // Strip duplicate 31-nutrient table from screen rendering if legacy/stream text has it
  const displayContent = cleanContent.includes('### 📋 Comprehensive Nutrient Values')
    ? cleanContent.split('### 📋 Comprehensive Nutrient Values')[0].trim()
    : cleanContent;

  const buildFullMarkdownText = () => {
    let fullTextToCopy = cleanContent.trim();
    if (!fullTextToCopy.includes('Comprehensive Nutrient Values') && nutrients) {
      const nutMd = build31NutrientsMarkdownClient(nutrients);
      if (nutMd) {
        fullTextToCopy = fullTextToCopy + '\n\n' + nutMd.trim();
      }
    }

    if (!fullTextToCopy.includes('### 🧾 Nutrition calculation') && (fullTextToCopy.startsWith('|') || fullTextToCopy.includes('Item / Ingredient'))) {
      fullTextToCopy = `### 🧾 Nutrition calculation\n\n${fullTextToCopy}`;
    }

    const footnotes: string[] = [];
    const infoLinkPattern = /\[ℹ️\]\(#info "([^"]*)"\)/g;
    let footnoteIndex = 0;
    const textForClipboard = fullTextToCopy.replace(infoLinkPattern, (_match, tooltipText) => {
      footnoteIndex += 1;
      footnotes.push(`[${footnoteIndex}] ${tooltipText}`);
      return `(ℹ️ see note ${footnoteIndex})`;
    });
    const finalText = footnotes.length > 0
      ? `${textForClipboard}\n\nNotes (what each calculation step means):\n${footnotes.join('\n')}`
      : textForClipboard;

    return finalText;
  };

  const handleCopyTable = () => {
    const finalText = buildFullMarkdownText();
    navigator.clipboard.writeText(finalText).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    }).catch(() => {
      setIsCopied(false);
    });
  };

  const handleDownloadTableAndLogs = async () => {
    setIsDownloading(true);
    try {
      const tableMarkdown = buildFullMarkdownText();

      // Helper to safely stringify logs (whether string, array of objects, or array of strings)
      const extractLogString = (val: any): string => {
        if (!val) return '';
        if (typeof val === 'string') return val.trim();
        if (Array.isArray(val)) {
          return val.map((l: any) => typeof l === 'string' ? l : (l.message ? (l.timestamp ? `[${l.timestamp}] ${l.message}` : l.message) : JSON.stringify(l))).join('\n').trim();
        }
        return '';
      };

      // Gather full log history without cropping
      let fullLogsText = '';
      const foodLog = pendingFoodLog || msg?.data?.pendingFoodLog || msg?.pendingFoodLog;
      const candidateJobId = msg?.data?.jobId || foodLog?.jobId || (msg?.id?.startsWith('msg_assistant_job_') ? msg.id.replace('msg_assistant_job_', 'job_') : '') || (msg?.id?.startsWith('msg_assistant_') && !msg.id.includes('fail') && !msg.id.includes('clarify') && !/^\d+$/.test(msg.id.replace('msg_assistant_', '')) ? msg.id.replace('msg_assistant_', '') : '');
      const job = candidateJobId ? JobStore.getJob(candidateJobId) : null;
      const targetReqId = msg?.data?.requestId || job?.requestId || candidateJobId || foodLog?.id || '';

      // 1. Check inline logs on msg object, foodLog object, or JobStore first
      fullLogsText =
        extractLogString(msg?.data?.agentResult?.backendLogs) ||
        extractLogString(msg?.data?.agentResult?.globalLiveLogs) ||
        extractLogString(msg?.data?.backendLogs) ||
        extractLogString(msg?.agentResult?.backendLogs) ||
        extractLogString(foodLog?.backendLogs) ||
        extractLogString(foodLog?.rawLogs) ||
        extractLogString(foodLog?.globalLiveLogs) ||
        extractLogString(msg?.data?.debugLogs) ||
        extractLogString(job?.result?.backendLogs) ||
        extractLogString((job as any)?.clean_result?.backendLogs) ||
        extractLogString(job?.liveThoughts?.backendLogs) ||
        extractLogString(job?.liveThoughts?.globalLiveLogs) ||
        extractLogString((job as any)?.accumulatedLogs);

      // 2. If logs are an R2 reference, fetch the full content
      if (fullLogsText && (fullLogsText.startsWith('[Logs stored in R2') || fullLogsText.includes('.r2.dev/logs/'))) {
        const urlMatch = fullLogsText.match(/(https?:\/\/[^\s\]"]+\.r2\.dev\/logs\/[^\s\]"]+)/i) ||
                         fullLogsText.match(/\[Logs stored in R2:\s*(https?:\/\/[^\s\]]+)\]/i);
        if (urlMatch) {
          const r2Url = urlMatch[1] || urlMatch[0];
          try {
            let r2Res = await fetch(`/api/r2/log-proxy?url=${encodeURIComponent(r2Url)}`);
            if (!r2Res.ok) {
              r2Res = await fetch(r2Url);
            }
            if (r2Res.ok) {
              const fetchedText = await r2Res.text();
              if (fetchedText && fetchedText.trim() && !fetchedText.startsWith('[Logs stored in R2')) {
                fullLogsText = fetchedText.trim();
              }
            }
          } catch (e) {
            console.warn('[FoodCard] Failed fetching R2 logs for download:', e);
          }
        }
      }

      // 3. Try server endpoints using the specific job/request ID (NOT generic sessionId)
      if (!fullLogsText.trim() && targetReqId) {
        try {
          // Check server-job endpoint first
          const url1 = `/api/gemini/debug-logs?sessionId=${encodeURIComponent(`server-job-${targetReqId}`)}`;
          let res = await fetch(url1, { headers: { 'X-Session-ID': targetReqId } });
          if (!res.ok) {
            const url2 = `/api/gemini/debug-logs?sessionId=${encodeURIComponent(targetReqId)}`;
            res = await fetch(url2, { headers: { 'X-Session-ID': targetReqId } });
          }
          if (res.ok) {
            const data = await res.json();
            if (Array.isArray(data.logs) && data.logs.length > 0) {
              fullLogsText = data.logs.map((l: any) => {
                if (typeof l === 'string') return l;
                if (l.message) return l.timestamp ? `[${l.timestamp}] ${l.message}` : l.message;
                return JSON.stringify(l);
              }).join('\n').trim();
            }
          }
        } catch {
          /* ignore server fetch errors and fall back to local logs */
        }
      }

      // 4. Fallback to localStorage request logs tracker ONLY if matching specific job/request/msg ID
      if (!fullLogsText.trim() && (targetReqId || msg?.id || foodLog?.id)) {
        try {
          const savedLogs = getAgentRequestLogs();
          if (savedLogs && savedLogs.length > 0) {
            const matched = savedLogs.find(r =>
              (targetReqId && r.id === targetReqId) ||
              (targetReqId && r.id === `server-job-${targetReqId}`) ||
              (candidateJobId && r.id === candidateJobId) ||
              (msg?.id && r.id === msg.id) ||
              (foodLog?.id && r.id === foodLog.id)
            );
            if (matched && Array.isArray(matched.logs) && matched.logs.length > 0) {
              fullLogsText = matched.logs.map(l => typeof l === 'string' ? l : (l.timestamp ? `[${l.timestamp}] ${l.message}` : (l.message || JSON.stringify(l)))).join('\n').trim();
            }
          }
        } catch (e) {
          /* ignore */
        }
      }

      // Combine table markdown and full log history
      const combinedOutput = fullLogsText.trim()
        ? `${tableMarkdown}\n\n\n${fullLogsText.trim()}\n`
        : tableMarkdown;

      // Calculate filename parts: e.g. "17:43 - chicken wrap 10s - 2i.md"
      let timeStr = '12:00';
      const msgTime = foodLog?.date || msg?.timestamp;
      if (msgTime) {
        const d = new Date(msgTime);
        if (!isNaN(d.getTime())) {
          timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }
      }
      if ((timeStr === '12:00' || !msgTime) && fullLogsText) {
        const timeMatch = fullLogsText.match(/\[(\d{1,2}:\d{2})(?::\d{2})?\]/) || fullLogsText.match(/\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/);
        if (timeMatch) {
          timeStr = timeMatch[1];
        } else {
          const d = new Date();
          timeStr = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        }
      }

      const rawDishName = foodLog?.name || (foodLog?.itemsBreakdown?.[0]?.canonicalDbName || foodLog?.itemsBreakdown?.[0]?.originalName || foodLog?.itemsBreakdown?.[0]?.keyword) || 'nutrition calculation';
      let cleanDish = rawDishName
        .toLowerCase()
        .replace(/^mcdonald'?s\s*/i, '')
        .replace(/[^a-z0-9\s-]/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!cleanDish) cleanDish = 'nutrition calculation';

      // Duration estimation in seconds
      let durationSec = 10;
      if (fullLogsText) {
        const lines = fullLogsText.split('\n');
        let startMs = 0;
        let endMs = 0;
        for (const line of lines) {
          const isoMatch = line.match(/\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\]/);
          if (isoMatch) {
            const t = new Date(isoMatch[1]).getTime();
            if (!isNaN(t)) {
              if (!startMs) startMs = t;
              endMs = t;
            }
          }
        }
        if (startMs && endMs && endMs > startMs) {
          durationSec = Math.max(1, Math.round((endMs - startMs) / 1000));
        }
      }

      // Image count
      let imageCount = 0;
      if (Array.isArray(foodLog?.imageUrls)) imageCount = foodLog.imageUrls.length;
      else if (Array.isArray(foodLog?.images)) imageCount = foodLog.images.length;
      else if (Array.isArray(msg?.data?.scoutItems)) imageCount = 1;

      if (imageCount === 0 && fullLogsText) {
        const imgMatch = fullLogsText.match(/Received (\d+) image\(s\)/i);
        if (imgMatch) imageCount = parseInt(imgMatch[1], 10);
      }

      const filename = `${timeStr} - ${cleanDish} ${durationSec}s - ${imageCount}i.md`;

      // Trigger download
      const blob = new Blob([combinedOutput], { type: 'text/markdown;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download failed:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className={`relative text-xs text-theme-text-secondary leading-relaxed bg-indigo-50/5 dark:bg-indigo-950/10 rounded-lg p-2 border border-indigo-200/10 dark:border-indigo-800/10 overflow-x-auto max-w-full ${className}`}>
      {showCopyButton && (
        <div className="absolute top-1.5 right-1.5 z-10 flex items-center gap-1">
          <button
            type="button"
            onClick={handleCopyTable}
            className="inline-flex items-center justify-center p-1.5 text-[10px] font-medium rounded-md border border-indigo-200/40 dark:border-indigo-800/40 bg-white/80 dark:bg-slate-900/80 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors cursor-pointer"
            aria-label="Copy table for sharing"
            title={isCopied ? "Copied!" : "Copy table"}
          >
            {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={handleDownloadTableAndLogs}
            disabled={isDownloading}
            className="inline-flex items-center justify-center p-1.5 text-[10px] font-medium rounded-md border border-indigo-200/40 dark:border-indigo-800/40 bg-white/80 dark:bg-slate-900/80 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors cursor-pointer disabled:opacity-50"
            aria-label="Download table and log history"
            title="Download .md file with table and log history"
          >
            {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}
      <Markdown 
        remarkPlugins={[remarkGfm]}
        components={{
          h3: ({ children }) => (
            <h3 className="text-[12px] font-bold text-indigo-500 dark:text-indigo-400 my-1 flex items-center gap-1 font-sans">
              {children}
            </h3>
          ),
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-xl border border-indigo-200/40 dark:border-indigo-800/40 bg-white dark:bg-slate-900 shadow-sm font-sans">
              <table className="w-full text-[11px] text-left border-collapse min-w-[500px]">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-indigo-50/90 dark:bg-indigo-950/80 border-b border-indigo-200/60 dark:border-indigo-800/60 text-indigo-900 dark:text-indigo-200 font-bold text-[10px] uppercase tracking-wider">
              {children}
            </thead>
          ),
          th: ({ children }) => (
            <th className="px-2.5 py-1.5 border-r border-indigo-200/40 dark:border-indigo-800/40 last:border-r-0 whitespace-nowrap">
              {children}
            </th>
          ),
          tr: ({ children }) => (
            <tr className="border-b border-slate-100 dark:border-slate-800/60 last:border-b-0 hover:bg-indigo-50/30 dark:hover:bg-indigo-950/20 transition-colors">
              {children}
            </tr>
          ),
          td: ({ children }) => (
            <td className="px-2.5 py-1.5 text-[11px] text-slate-800 dark:text-slate-200 border-r border-slate-100 dark:border-slate-800/40 last:border-r-0 leading-snug">
              {children}
            </td>
          ),
          p: ({ children }) => (
            <p className="my-1 font-sans text-[11px] leading-relaxed whitespace-pre-wrap">
              {children}
            </p>
          ),
          a: ({ href, title, children }) => {
            if (href === '#info' || href?.startsWith('#')) {
              return <InfoTooltipBadge title={title || (typeof children === 'string' ? children : '')} />;
            }
            return (
              <>
                {children}
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="View source on USDA FoodData Central"
                  className="inline-flex items-center ml-1 text-indigo-500 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-200 transition-colors align-middle"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                </a>
              </>
            );
          }
        }}
      >
        {displayContent}
      </Markdown>
    </div>
  );
};
import ImageSlider from '../ImageSlider';
import { NutrientPieChart } from '../NutrientPieChart';

import { nutrientDefinitions, getNutrientColor, MASTER_NUTRIENT_COLORS } from '../../utils/nutrition';
export { getNutrientColor, MASTER_NUTRIENT_COLORS };
import { PRIMARY_NUTRIENTS, cleanNutrientVal, formatNutrientDisplayValue } from '../../utils/nutrients';
import { FoodLog } from '../../types';
import { resolveFoodImage } from '../../utils/imageResolver';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import { ZoomableImage } from '../ZoomableImage';
import { FoodScoutItemPreview, OnlineFoodImage } from './FoodScoutItemPreview';
import { translations } from '../../utils/translations';

const FALLBACK_NUTRIENT_COLOR_PALETTE = [
  'rgb(236, 72, 153)',  // pink
  'rgb(20, 184, 166)',  // teal
  'rgb(244, 63, 94)',   // rose
  'rgb(132, 204, 22)',  // lime
  'rgb(99, 102, 241)',  // indigo
  'rgb(217, 119, 6)',   // amber
  'rgb(14, 165, 233)',  // sky
  'rgb(192, 38, 211)',  // fuchsia
  'rgb(101, 163, 13)',  // olive green
  'rgb(190, 24, 93)',   // deep pink
  'rgb(2, 132, 199)',   // cyan-blue
  'rgb(161, 98, 7)',    // brown-amber
];

// Re-exported from ../../utils/nutrition

const StepItem = ({ 
  label, 
  status, 
  children 
}: { 
  label: string; 
  status: 'completed' | 'active' | 'pending'; 
  children?: React.ReactNode;
}) => {
  return (
    <div className="flex flex-col gap-1.5 pl-1">
      <div className="flex items-center gap-2.5">
        <div className="flex items-center justify-center w-4 h-4 rounded-full flex-shrink-0">
          {status === 'completed' && (
            <div className="w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-950/45 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Check className="w-2.5 h-2.5 stroke-[3]" />
            </div>
          )}
          {status === 'active' && (
            <div className="w-4 h-4 rounded-full bg-indigo-100 dark:bg-indigo-950/45 flex items-center justify-center text-indigo-600 dark:text-indigo-400 relative">
              <span className="absolute inset-0 rounded-full bg-indigo-400/30 animate-ping" />
              <div className="w-2 h-2 rounded-full bg-indigo-600 dark:bg-indigo-400" />
            </div>
          )}
          {status === 'pending' && (
            <div className="w-3.5 h-3.5 rounded-full border border-slate-300 dark:border-slate-700 bg-transparent" />
          )}
        </div>
        <span className={`text-[11px] font-sans font-medium transition-colors ${
          status === 'completed' 
            ? 'text-theme-text-secondary' 
            : status === 'active' 
              ? 'text-indigo-600 dark:text-indigo-400 font-semibold' 
              : 'text-slate-400 dark:text-slate-600'
        }`}>
          {label}
        </span>
      </div>
      {children && (
        <div className="pl-6 border-l border-theme-border ml-2 mt-0.5 pb-2 last:border-none">
          {children}
        </div>
      )}
    </div>
  );
};

const LiveBackendStreamViewer = ({ logs }: { logs: string }) => {
  const [activeTab, setActiveTab] = React.useState<string>('all');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = React.useState(0);
  const [copied, setCopied] = React.useState(false);
  const matchRefs = React.useRef<(HTMLSpanElement | null)[]>([]);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const isFirstStreamRef = React.useRef(true);
  const [fetchedR2Logs, setFetchedR2Logs] = React.useState<string | null>(null);
  const [isFetchingR2, setIsFetchingR2] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (!logs) return;
    const urlMatch = logs.match(/(https?:\/\/[^\s\]"]+\.r2\.dev\/logs\/[^\s\]"]+)/i) || logs.match(/\[Logs stored in R2:\s*(https?:\/\/[^\s\]]+)\]/i);
    if (urlMatch) {
      const url = urlMatch[1] || urlMatch[0];
      if (url && !fetchedR2Logs && !isFetchingR2) {
        setIsFetchingR2(true);
        fetch(url)
          .then(res => {
            if (!res.ok) throw new Error(`R2 direct fetch HTTP ${res.status}`);
            return res.text();
          })
          .then(text => {
            if (text && text.trim().length > 0) {
              setFetchedR2Logs(text);
            }
          })
          .catch(async (err) => {
            console.warn('[LiveBackendStreamViewer] Direct R2 fetch failed, trying proxy:', err);
            try {
              const proxyRes = await fetch(`/api/r2/log-proxy?url=${encodeURIComponent(url)}`);
              if (proxyRes.ok) {
                const proxyText = await proxyRes.text();
                if (proxyText && proxyText.trim().length > 0) {
                  setFetchedR2Logs(proxyText);
                }
              }
            } catch (proxyErr) {
              console.warn('[LiveBackendStreamViewer] Proxy R2 log fetch failed:', proxyErr);
            }
          })
          .finally(() => setIsFetchingR2(false));
      }
    }
  }, [logs, fetchedR2Logs, isFetchingR2]);

  const effectiveLogs = fetchedR2Logs || logs || '';

  React.useEffect(() => {
    // Scroll internal log container to bottom without scrolling browser viewport
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
    // Set browser viewport scroll to top (below header) when stream starts
    if (effectiveLogs && isFirstStreamRef.current) {
      isFirstStreamRef.current = false;
      const mainContainer = document.getElementById('main-scroll-container');
      if (mainContainer) {
        mainContainer.scrollTo({ top: 0, behavior: 'smooth' });
      } else {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }, [effectiveLogs]);

  const ERROR_PATTERN = /error|exception|failed to/i;
  const WARNING_PATTERN = /warn|quota exceeded|429|timed out|retry/i;
  // Tag chars now include spaces, hyphens, and colons — real backend tags like
  // "Vision Scout", "UnifiedLLM-Prompt", and "Database Search" have these and
  // were previously never matching at all, so they never got tabbed.
  const TAG_PATTERN = /^\[([A-Za-z0-9_ \-:]+)\](?:\[(\d+)\])?\s?(.*)$/;

  const lines = React.useMemo(() => (effectiveLogs || '').split('\n'), [effectiveLogs]);

  // Parse the [logType][timestamp] tag embedded by the client SSE parser.
  // A single logical log entry (e.g. a full system instruction) can span many
  // physical lines — only the first physical line carries the tag. Carry the
  // last-seen tag forward onto untagged continuation lines so the rest of that
  // entry is still attributed to the right tab instead of only showing in "All".
  const parsedLines = React.useMemo(() => {
    let currentLogType: string | undefined;
    let currentTimestamp: number | undefined;
    return lines.map((line) => {
      const match = line.match(TAG_PATTERN);
      if (match) {
        currentLogType = match[1];
        currentTimestamp = match[2] ? parseInt(match[2], 10) : undefined;
        return { logType: currentLogType, timestamp: currentTimestamp, display: match[3] || '' };
      }
      return { logType: currentLogType, timestamp: currentTimestamp, display: line };
    });
  }, [lines]);

  // Classify a raw logType into one of the three agent buckets used for tabs.
  // Substring-based so it recognizes both Stream 2's curated tags
  // (scout_instruction, db_search, dietitian_answer, ...) and Stream 1's own
  // raw tags (Vision Scout, Database Search, RouteAgent Chat, Nutrient,
  // First-Principles Injection, and any future "UnifiedLLM-Prompt:scout" /
  // "...:dietitian" style tags) without keeping two lists in sync.
  const classifyLogType = (logType?: string): 'scout' | 'db' | 'resolver' | 'dietitian' | 'other' => {
    if (!logType) return 'other';
    const t = logType.toLowerCase();
    if (t.includes('scout') || t.includes('vision')) return 'scout';
    if (t.includes('db_') || t.includes('database') || t.includes('usda') || t.includes('openfoodfacts')) return 'db';
    if (t.includes('resolver') || t.includes('food_resolver')) return 'resolver';
    if (t.includes('dietitian') || t.includes('routeagent') || t.includes('nutrient') || t.includes('first-principles') || t.includes('first_principles')) return 'dietitian';
    return 'other';
  };

  const dynamicTabs = React.useMemo(() => {
    const tabs = [{ id: 'all', label: 'All' }];
    const hasScout = parsedLines.some((l) => classifyLogType(l.logType) === 'scout');
    const hasDb = parsedLines.some((l) => classifyLogType(l.logType) === 'db');
    const hasResolver = parsedLines.some((l) => classifyLogType(l.logType) === 'resolver');
    const hasDietitian = parsedLines.some((l) => classifyLogType(l.logType) === 'dietitian');
    const hasErrors = parsedLines.some((l) => ERROR_PATTERN.test(l.display));
    const hasWarnings = parsedLines.some((l) => WARNING_PATTERN.test(l.display));

    if (hasScout) tabs.push({ id: 'scout', label: 'Vision Scout' });
    if (hasDb) tabs.push({ id: 'db', label: 'DB Search' });
    if (hasResolver) tabs.push({ id: 'resolver', label: 'Food Resolver' });
    if (hasDietitian) tabs.push({ id: 'dietitian', label: 'Dietitian' });
    if (hasErrors) tabs.push({ id: 'errors', label: 'Errors' });
    if (hasWarnings) tabs.push({ id: 'warnings', label: 'Warnings' });
    return tabs;
  }, [parsedLines]);

  // Tab filtering — matches on the classified agent bucket so every line
  // belonging to a stage is captured, not just ones containing a keyword.
  const tabFilteredDisplayLines = React.useMemo(() => {
    const filtered = parsedLines.filter((l) => {
      if (activeTab === 'all') return true;
      if (activeTab === 'scout') return classifyLogType(l.logType) === 'scout';
      if (activeTab === 'db') return classifyLogType(l.logType) === 'db';
      if (activeTab === 'dietitian') return classifyLogType(l.logType) === 'dietitian';
      if (activeTab === 'errors') return ERROR_PATTERN.test(l.display);
      if (activeTab === 'warnings') return WARNING_PATTERN.test(l.display);
      return true;
    });
    return filtered.map((l) => l.display);
  }, [parsedLines, activeTab]);

  // Total elapsed time across the visible stream (earliest to latest timestamp).
  const elapsedLabel = React.useMemo(() => {
    const timestamps = parsedLines.map((l) => l.timestamp).filter((t): t is number => typeof t === 'number');
    if (timestamps.length < 2) return null;
    const elapsedMs = Math.max(...timestamps) - Math.min(...timestamps);
    return `${(elapsedMs / 1000).toFixed(1)}s`;
  }, [parsedLines]);

  // Keyword search matching line indices
  const matchingLineIndices = React.useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase().trim();
    const indices: number[] = [];
    tabFilteredDisplayLines.forEach((line, idx) => {
      if (line.toLowerCase().includes(q)) {
        indices.push(idx);
      }
    });
    return indices;
  }, [tabFilteredDisplayLines, searchQuery]);

  React.useEffect(() => {
    if (matchingLineIndices.length > 0 && matchRefs.current[currentMatchIndex]) {
      matchRefs.current[currentMatchIndex]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentMatchIndex, matchingLineIndices]);

  React.useEffect(() => {
    setCurrentMatchIndex(0);
  }, [searchQuery, activeTab]);

  const handleNextMatch = () => {
    if (matchingLineIndices.length === 0) return;
    setCurrentMatchIndex((prev) => (prev + 1) % matchingLineIndices.length);
  };

  const handlePrevMatch = () => {
    if (matchingLineIndices.length === 0) return;
    setCurrentMatchIndex((prev) => (prev - 1 + matchingLineIndices.length) % matchingLineIndices.length);
  };

  const handleCopy = () => {
    const textToCopy = tabFilteredDisplayLines.join('\n');
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    try {
      const textToDownload = tabFilteredDisplayLines.join('\n');
      const blob = new Blob([textToDownload], { type: 'text/plain;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const tabName = activeTab === 'all' ? 'all' : activeTab;
      const timeStr = new Date().toISOString().slice(11, 19).replace(/:/g, '-');
      a.download = `logs-${tabName}-${timeStr}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download logs failed:', err);
    }
  };

  const renderHighlightedLine = (line: string, lineIndex: number) => {
    if (!searchQuery.trim() || !line.toLowerCase().includes(searchQuery.toLowerCase().trim())) {
      return <span>{line}</span>;
    }

    const q = searchQuery.trim();
    const parts = line.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    const isCurrentMatch = matchingLineIndices[currentMatchIndex] === lineIndex;

    return (
      <span
        ref={(el) => {
          if (matchingLineIndices.includes(lineIndex)) {
            const matchPos = matchingLineIndices.indexOf(lineIndex);
            matchRefs.current[matchPos] = el;
          }
        }}
      >
        {parts.map((part, i) =>
          part.toLowerCase() === q.toLowerCase() ? (
            <mark
              key={i}
              className={`px-0.5 rounded font-bold ${
                isCurrentMatch ? 'bg-amber-400 text-slate-950 ring-2 ring-amber-300' : 'bg-yellow-500/40 text-yellow-200'
              }`}
            >
              {part}
            </mark>
          ) : (
            part
          )
        )}
      </span>
    );
  };

  return (
    <div className="p-2.5 bg-slate-950 text-white font-mono text-[10px] rounded-xl border border-slate-700 shadow-inner flex flex-col gap-2">
      {/* Toolbar Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-800 text-[10px]">
        {/* Dynamic Agent Tabs */}
        <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800 flex-wrap">
          {dynamicTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-2 py-0.5 rounded-md text-[9px] font-semibold transition-colors cursor-pointer ${
                activeTab === tab.id
                  ? 'bg-slate-700/60 text-white border border-slate-500'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
          {elapsedLabel && (
            <span className="ml-1 px-2 py-0.5 text-[9px] text-slate-400 font-mono whitespace-nowrap">
              Total: {elapsedLabel}
            </span>
          )}
        </div>

        {/* Search Controls + Navigation + Copy */}
        <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
          <div className="relative flex items-center">
            <input
              type="text"
              placeholder="Search logs..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (e.shiftKey) handlePrevMatch(); else handleNextMatch();
                }
              }}
              className="bg-slate-900 border border-slate-800 text-slate-200 px-2 py-0.5 rounded-md text-[9px] focus:outline-none focus:border-slate-500/50 w-28 sm:w-36"
            />
            {searchQuery.trim() && (
              <span className="text-[8px] text-slate-400 ml-1 whitespace-nowrap font-mono">
                {matchingLineIndices.length > 0
                  ? `${currentMatchIndex + 1}/${matchingLineIndices.length}`
                  : '0/0'}
              </span>
            )}
          </div>

          {searchQuery.trim() && matchingLineIndices.length > 0 && (
            <div className="flex items-center gap-0.5 bg-slate-900 rounded border border-slate-800">
              <button
                type="button"
                onClick={handlePrevMatch}
                className="px-1.5 py-0.5 text-slate-300 hover:text-white text-[9px] cursor-pointer"
                title="Previous match"
              >
                ▲
              </button>
              <button
                type="button"
                onClick={handleNextMatch}
                className="px-1.5 py-0.5 text-slate-300 hover:text-white text-[9px] cursor-pointer"
                title="Next match"
              >
                ▼
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-[9px] border border-slate-700 transition-colors cursor-pointer"
          >
            {copied ? 'Copied!' : 'Copy'}
          </button>

          <button
            type="button"
            onClick={handleDownload}
            className="flex items-center gap-1 px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-md text-[9px] border border-slate-700 transition-colors cursor-pointer"
            title="Download logs"
          >
            <Download className="w-2.5 h-2.5 text-slate-300" />
            Download
          </button>
        </div>
      </div>

      {/* Log Output Body */}
      <div ref={scrollContainerRef} className="max-h-60 overflow-y-auto whitespace-pre-wrap leading-relaxed flex flex-col gap-0.5">
        {tabFilteredDisplayLines.length > 0 ? (
          tabFilteredDisplayLines.map((line, idx) => (
            <div key={idx}>{renderHighlightedLine(line, idx)}</div>
          ))
        ) : (
          <span className="text-slate-600 italic">No matching logs found.</span>
        )}
      </div>
    </div>
  );
};

export const AgentThoughtBox = ({
  language = "en", 
  scoutScratchpad, 
  dietitianScratchpad, 
  isLive, 
  placeholderStep, 
  hasImage,
  scoutInstruction,
  scoutAnswer,
  dbSearchLog,
  dietitianInstruction,
  dietitianAnswer,
  activeStage,
  stageStatus,
  backendLogs,
  globalLiveLogs,
  warnings
}: { 
  scoutScratchpad?: string, 
  dietitianScratchpad?: string, 
  isLive?: boolean, 
  placeholderStep?: string, 
  hasImage?: boolean,
  scoutInstruction?: string,
  scoutAnswer?: string,
  dbSearchLog?: string,
  dietitianInstruction?: string,
  dietitianAnswer?: string,
  activeStage?: string,
  stageStatus?: string;
  language?: string;
  backendLogs?: string;
  globalLiveLogs?: string;
  warnings?: string[];
}) => {
  const t = translations[language || "en"] || translations.en;
  const [isExpanded, setIsExpanded] = React.useState(!!isLive);

  React.useEffect(() => {
    setIsExpanded(!!isLive);
  }, [isLive]);

  const hasScratchpad = !!scoutScratchpad || !!dietitianScratchpad || !!activeStage || !!backendLogs || !!globalLiveLogs;
  if (!hasScratchpad && !placeholderStep && !isLive && (!warnings || warnings.length === 0)) return null;

  const isImageAnalysis = hasImage ?? (!!scoutScratchpad || (placeholderStep && placeholderStep.toLowerCase().includes("photo")));

  // Derive step states
  let step1Status: 'completed' | 'active' | 'pending' = 'pending';
  let step2Status: 'completed' | 'active' | 'pending' = 'pending';
  let step3Status: 'completed' | 'active' | 'pending' = 'pending';
  let step4Status: 'completed' | 'active' | 'pending' = 'pending';

  if (!isLive) {
    step1Status = 'completed';
    step2Status = 'completed';
    step3Status = 'completed';
    step4Status = 'completed';
  } else {
    const currentStage = activeStage || (dietitianScratchpad ? 'dietitian' : (dbSearchLog && dbSearchLog.includes('[Database Search]')) ? 'db_search' : 'scout');
    if (isImageAnalysis) {
      if (currentStage === 'scout') {
        step1Status = stageStatus === 'completed' ? 'completed' : 'active';
        step2Status = 'pending';
        step3Status = 'pending';
        step4Status = 'pending';
      } else if (currentStage === 'db_search') {
        step1Status = 'completed'; // 🟢 Step 1 Completed
        step2Status = 'active';    // 🔵 Step 2 Active
        step3Status = 'pending';
        step4Status = 'pending';
      } else if (currentStage === 'dietitian') {
        step1Status = 'completed';
        step2Status = 'completed';
        step3Status = 'completed';
        step4Status = 'active';
      }
    } else {
      if (currentStage === 'db_search') {
        step1Status = 'completed';
        step2Status = 'active';
        step3Status = 'pending';
        step4Status = 'pending';
      } else if (currentStage === 'dietitian') {
        step1Status = 'completed';
        step2Status = 'completed';
        step3Status = 'completed';
        step4Status = 'active';
      }
    }
  }

  return (
    <div className="px-1 py-2 my-2 min-w-[250px] bg-slate-50/50 dark:bg-slate-900/30 rounded-2xl p-3 border border-slate-150 dark:border-slate-800/40 font-sans transition-all">
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-xs text-theme-neutral flex items-center justify-between font-medium hover:text-indigo-600 transition-colors w-full focus:outline-none cursor-pointer"
        >
          <span className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500 animate-pulse" />
            <span className="font-semibold text-slate-800 dark:text-slate-200">{t.agentsThought}</span>
          </span>
          {isExpanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
        </button>
        {isExpanded && (
          <div className="flex flex-col gap-3 mt-2.5 pt-2 border-t border-slate-200/50 dark:border-slate-800/50 text-left">
            {warnings && warnings.length > 0 && (
              <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-xs font-bold text-yellow-800 mb-1">⚠️ Nutrient Warnings</p>
                <ul className="list-disc pl-4 text-xs text-yellow-700">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            )}
            {/* STREAM 1: RAW UNFILTERED LIVE STREAM — same LiveBackendStreamViewer component as Stream 2, fed globalLiveLogs instead of backendLogs */}
            {globalLiveLogs && (
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-bold text-green-500/80 uppercase tracking-wider px-0.5">⚡ Unfiltered Live Stream</span>
                <LiveBackendStreamViewer logs={globalLiveLogs} />
              </div>
            )}
            {/* STREAM 2: LIVE BACKEND STREAM VIEWER WITH TOOLBAR, TABS & COPY.
                Only shown when Stream 1's unfiltered view isn't available (e.g.
                its SSE connection failed to establish) — otherwise it's a
                strictly worse duplicate of what's already shown above. */}
            {!hasScratchpad && isLive ? (
              <div className="flex items-center gap-2 text-xs text-slate-400 dark:text-slate-500 py-1">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
                <span>Starting analysis...</span>
              </div>
            ) : backendLogs && !globalLiveLogs ? (
              <LiveBackendStreamViewer logs={backendLogs} />
            ) : isImageAnalysis ? (
              <>
                {/* Render live streaming progress chunks cleanly without generic titles */}
                {scoutInstruction && (
                  <div className="flex flex-col gap-1 mt-1 mb-2">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{t.visionScoutInstruction}</span>
                    <ScratchpadMarkdownViewer content={scoutInstruction} />
                  </div>
                )}
                {scoutScratchpad && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{t.visionScoutScratchpad}</span>
                    <ScratchpadMarkdownViewer content={scoutScratchpad} />
                  </div>
                )}
                {scoutAnswer && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{t.visionScoutResult}</span>
                    <ScratchpadMarkdownViewer content={scoutAnswer} />
                  </div>
                )}
                
                {dbSearchLog && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">{t.databaseLog}</span>
                    <ScratchpadMarkdownViewer content={dbSearchLog} />
                  </div>
                )}
                
                {dietitianInstruction && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">{t.dietitianInstruction}</span>
                    <ScratchpadMarkdownViewer content={dietitianInstruction} />
                  </div>
                )}
                
                {dietitianScratchpad && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">{t.dietitianScratchpad}</span>
                    <ScratchpadMarkdownViewer content={dietitianScratchpad} />
                  </div>
                )}
                {dietitianAnswer && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">{t.dietitianResult}</span>
                    <ScratchpadMarkdownViewer content={dietitianAnswer} />
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Render live streaming progress chunks cleanly without generic titles */}
                {dietitianInstruction && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">{t.dietitianInstruction}</span>
                    <ScratchpadMarkdownViewer content={dietitianInstruction} />
                  </div>
                )}
                {dietitianScratchpad && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">{t.dietitianScratchpad}</span>
                    <ScratchpadMarkdownViewer content={dietitianScratchpad} />
                  </div>
                )}
                {dietitianAnswer && (
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-bold text-indigo-400 uppercase tracking-wider">{t.dietitianResult}</span>
                    <ScratchpadMarkdownViewer content={dietitianAnswer} />
                  </div>
                )}
              </>
            )}

          </div>
        )}
      </div>
    </div>
  );
};

interface CroppedFoodImageProps {
  language?: string;
  src: string;
  boundingBox: [number, number, number, number]; // [ymin, xmin, ymax, xmax] from 0 to 1000
  alt: string;
  className?: string;
  onTap?: () => void;
  imageUrls?: string[];
  sourceImageIndex?: number | null;
}

export const isValidBoundingBox = (bb: any): bb is [number, number, number, number] => {
  if (!Array.isArray(bb) || bb.length !== 4) return false;
  const [ymin, xmin, ymax, xmax] = bb;
  return (ymax - ymin > 10) && (xmax - xmin > 10);
};

export const CroppedFoodImage: React.FC<CroppedFoodImageProps> = ({ 
  language, src, 
  boundingBox, 
  alt, 
  className, 
  onTap,
  imageUrls,
  sourceImageIndex
}) => {
  const t = translations[language || "en"] || translations.en;
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [error, setError] = React.useState<boolean>(false);

  const baseImageSrc = React.useMemo(() => {
    let raw = src;
    if (imageUrls && imageUrls.length > 0 && typeof sourceImageIndex === 'number' && sourceImageIndex >= 0 && sourceImageIndex < imageUrls.length) {
      raw = imageUrls[sourceImageIndex];
    }
    return normalizeMealImageUrl(raw) || raw;
  }, [src, imageUrls, sourceImageIndex]);

  React.useEffect(() => {
    if (!baseImageSrc || !isValidBoundingBox(boundingBox)) {
      setError(true);
      return;
    }
    
    setError(false);
    const img = new Image();
    if (baseImageSrc.startsWith('http')) { img.crossOrigin = 'anonymous'; }
    
    img.onload = () => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        
        const [ymin, xmin, ymax, xmax] = boundingBox;
            
        // Coordinates are normalized 0-1000
        const rawX = (xmin / 1000) * img.naturalWidth;
        const rawY = (ymin / 1000) * img.naturalHeight;
        const rawW = ((xmax - xmin) / 1000) * img.naturalWidth;
        const rawH = ((ymax - ymin) / 1000) * img.naturalHeight;

        if (rawW <= 0 || rawH <= 0) {
          setError(true);
          return;
        }

        // Calculate center of the bounding box and a square crop size with 20% padding
        const centerX = rawX + rawW / 2;
        const centerY = rawY + rawH / 2;
        let side = Math.max(rawW, rawH) * 1.25;

        // Cap side so that image boundaries math doesn't result in negative minimum bounds
        side = Math.min(side, img.naturalWidth, img.naturalHeight);

        // Calculate centered square bounds within image boundaries
        let srcX = centerX - side / 2;
        let srcY = centerY - side / 2;
        srcX = Math.max(0, Math.min(img.naturalWidth - side, srcX));
        srcY = Math.max(0, Math.min(img.naturalHeight - side, srcY));
        const srcW = Math.min(side, img.naturalWidth - srcX);
        const srcH = Math.min(side, img.naturalHeight - srcY);

        canvas.width = srcW;
        canvas.height = srcH;
        ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
      } catch (err) {
        console.error('Error drawing image:', err);
        setError(true);
      }
    };
    img.onerror = () => {
      setError(true);
    };
    img.src = baseImageSrc;
  }, [baseImageSrc, boundingBox]);

  if (error) {
    if (!isValidBoundingBox(boundingBox)) {
      return (
        <img 
          src={baseImageSrc} 
          alt={alt} 
          className={className}
          referrerPolicy="no-referrer"
          onClick={onTap}
          onError={(e) => {
            const t = e.target as HTMLImageElement;
            const fallback = getFoodImageUrl(alt || 'food');
            if (t.src !== fallback) t.src = fallback;
          }}
        />
      );
    }
    const [ymin, xmin, ymax, xmax] = boundingBox;
    const top = ymin / 10;
    const left = xmin / 10;
    const height = Math.max((ymax - ymin) / 10, 1);
    const width = Math.max((xmax - xmin) / 10, 1);
    const scaleX = 100 / width;
    const scaleY = 100 / height;
    
    return (
      <div className={`overflow-hidden relative ${className || ''}`} onClick={onTap} title={alt}>
        <img 
          src={baseImageSrc} 
          alt={alt}
          referrerPolicy="no-referrer"
          className="absolute max-w-none"
          style={{
            top: `-${top * scaleY}%`,
            left: `-${left * scaleX}%`,
            width: `${100 * scaleX}%`,
            height: `${100 * scaleY}%`,
            objectFit: 'fill'
          }}
        />
      </div>
    );
  }

  return (
    <canvas 
      ref={canvasRef}
      className={className}
      onClick={onTap}
      title={alt}
    />
  );
};

export const getFoodImageUrl = (foodName: string, suppliedUrl?: string) => {
  const normalized = normalizeMealImageUrl(suppliedUrl);
  if (normalized) return normalized;
  if (suppliedUrl && (suppliedUrl.startsWith('http') || suppliedUrl.startsWith('data:image/') || suppliedUrl.startsWith('blob:') || suppliedUrl.startsWith('/'))) {
    return suppliedUrl;
  }
  
  const name = foodName.toLowerCase();
  
  // Specific category: Pepper, Spices, Seasonings, Herbs
  if (name.includes('pepper') || name.includes('spice') || name.includes('chili') || name.includes('salt') || name.includes('seasoning') || name.includes('powder') || name.includes('herb') || name.includes('curry')) {
    return "https://images.unsplash.com/photo-1506368249639-73a05d6f6488?w=400&auto=format&fit=crop&q=60";
  }

  // High-quality handpicked Unsplash food images for common categories
  if (name.includes('cheese') || name.includes('cheddar') || name.includes('mozzarella') || name.includes('dairy')) {
    return "https://images.unsplash.com/photo-1486299267070-83823f5448dd?w=400&auto=format&fit=crop&q=60";
  }
  if (name.includes('pasta') || name.includes('macaroni') || name.includes('spaghetti')) {
    return "https://images.unsplash.com/photo-1563379091339-03b21ab4a4f8?w=400&auto=format&fit=crop&q=60";
  }
  if (name.includes('beef') || name.includes('steak') || name.includes('chuck') || name.includes('meat') || name.includes('hot pot')) {
    return "https://images.unsplash.com/photo-1544025162-d76694265947?w=400&auto=format&fit=crop&q=60";
  }
  if (name.includes('spinach') || name.includes('salad') || name.includes('greens') || name.includes('raw vegetable') || name.includes('vegetable')) {
    return "https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=400&auto=format&fit=crop&q=60";
  }
  if (name.includes('mushroom') || name.includes('fungi') || name.includes('enoki')) {
    return "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=400&auto=format&fit=crop&q=60";
  }
  if (name.includes('chicken') || name.includes('poultry') || name.includes('turkey')) {
    return "https://images.unsplash.com/photo-1604503468506-a8da13d82791?w=400&auto=format&fit=crop&q=60";
  }
  if (name.includes('salmon') || name.includes('fish') || name.includes('tuna') || name.includes('seafood')) {
    return "https://images.unsplash.com/photo-1467003909585-2f8a72700288?w=400&auto=format&fit=crop&q=60";
  }
  if (name.includes('rice') || name.includes('grain') || name.includes('noodle') || name.includes('sushi') || name.includes('dumpling')) {
    return "https://images.unsplash.com/photo-1512058564366-18510be2db19?w=400&auto=format&fit=crop&q=60";
  }
  if (name.includes('egg')) {
    return "https://images.unsplash.com/photo-1506084868230-bb9d95c24759?w=400&auto=format&fit=crop&q=60";
  }
  if (name.includes('avocado')) {
    return "https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?w=400&auto=format&fit=crop&q=60";
  }
  if (name.includes('bread') || name.includes('toast') || name.includes('sourdough')) {
    return "https://images.unsplash.com/photo-1549931319-a545dcf3bc73?w=400&auto=format&fit=crop&q=60";
  }
  if (name.includes('apple') || name.includes('fruit') || name.includes('berry') || name.includes('banana')) {
    return "https://images.unsplash.com/photo-1519985176271-adb1088fa94c?w=400&auto=format&fit=crop&q=60";
  }
  
  // Dynamic Host/User Timezone & Locale based fallback
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone.toLowerCase();
    
    // East Asia, Southeast Asia, South Asia, Europe etc. fallback
    if (tz.includes('tokyo') || tz.includes('seoul') || tz.includes('shanghai') || tz.includes('singapore') || tz.includes('taipei') || tz.includes('bangkok') || tz.includes('jakarta') || tz.includes('manila') || tz.includes('hanoi') || tz.includes('asia') || tz.includes('japan') || tz.includes('korea')) {
      return "https://images.unsplash.com/photo-1511910849309-0d5f2c18a29e?w=400&auto=format&fit=crop&q=60"; // Asian noodle & soup healthy bowl
    }
    if (tz.includes('kolkata') || tz.includes('asia/calcutta') || tz.includes('delhi') || tz.includes('bombay') || tz.includes('india') || tz.includes('chennai') || tz.includes('bengaluru')) {
      return "https://images.unsplash.com/photo-1585938338392-50a59970d8ee?w=400&auto=format&fit=crop&q=60"; // Indian curry plate
    }
    if (tz.includes('europe') || tz.includes('london') || tz.includes('paris') || tz.includes('berlin') || tz.includes('rome') || tz.includes('madrid') || tz.includes('amsterdam') || tz.includes('brussels')) {
      return "https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=400&auto=format&fit=crop&q=60"; // Mediterranean European dining
    }
  } catch (e) {
    // Ignore error
  }

  // Universal healthy food generic fallback
  const keyword = name.split(' ')[0] || 'food';
  return `https://loremflickr.com/400/400/food,${encodeURIComponent(keyword)}`;
};

interface GroupItemsContainerProps {
  children: React.ReactNode;
  groupKey: string;
  isExpanded: boolean;
  onToggle: () => void;
}

const GroupItemsContainer: React.FC<GroupItemsContainerProps> = ({ children, groupKey, isExpanded, onToggle }) => {
  const t = translations.en;
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [shouldShowButton, setShouldShowButton] = React.useState(false);

  React.useEffect(() => {
    const el = contentRef.current;
    if (!el) return;

    const checkHeight = () => {
      setShouldShowButton(el.scrollHeight > 800);
    };

    checkHeight();
    
    const observer = new ResizeObserver(checkHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);

  return (
    <div className="relative w-full">
      <div 
        ref={contentRef}
        className="w-full overflow-hidden transition-all duration-300"
        style={{ maxHeight: isExpanded ? 'none' : '800px' }}
      >
        {children}
      </div>
      
      {shouldShowButton && (
        <div className={`w-full flex justify-center pt-4 ${!isExpanded ? 'absolute bottom-0 left-0 right-0 bg-gradient-to-t from-white dark:from-slate-900 via-white/95 dark:via-slate-900/95 to-transparent pt-16 pb-2 z-10' : 'pb-2'}`}>
          <button
            type="button"
            onClick={onToggle}
            className="px-4 py-1.5 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-700 dark:text-slate-200 hover:bg-indigo-600 hover:text-white dark:hover:bg-indigo-600 transition-all flex items-center gap-1.5 shadow-sm hover:shadow cursor-pointer border border-slate-200/60 dark:border-slate-700/50"
          >
            {isExpanded ? (
              <>
                <span>{t.viewLess}</span>
                <ChevronUp className="w-3.5 h-3.5" />
              </>
            ) : (
              <>
                <span>{t.viewMore}</span>
                <ChevronDown className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};


const getCookingMethodChip = (method: string, hideIcon: boolean = false) => {
  const normalized = (method || '').toLowerCase().trim();
  if (!normalized || normalized === 'unknown') return null;

  let emoji = '🍳';
  let classes = 'bg-slate-50 text-slate-700 border-slate-200/50 dark:bg-slate-850/40 dark:text-slate-300 dark:border-slate-700/50';

  if (normalized.includes('deep_fried') || normalized.includes('deepfried') || normalized.includes('deep fried')) {
    emoji = '🍟';
    classes = 'bg-red-50 text-red-700 border-red-200/50 dark:bg-red-950/30 dark:text-red-300 dark:border-red-900/40';
  } else if (normalized.includes('pan_fried') || normalized.includes('panfried') || normalized.includes('pan fried') || normalized.includes('stir_fried') || normalized.includes('stirfried') || normalized.includes('stir fried') || normalized.includes('fry') || normalized.includes('fried')) {
    emoji = '🍳';
    classes = 'bg-amber-50 text-amber-700 border-amber-200/50 dark:bg-amber-950/30 dark:text-amber-300 dark:border-amber-900/40';
  } else if (normalized.includes('roast') || normalized.includes('grill') || normalized.includes('bake') || normalized.includes('burnt') || normalized.includes('char')) {
    emoji = '🔥';
    classes = 'bg-orange-50 text-orange-700 border-orange-200/50 dark:bg-orange-950/30 dark:text-orange-300 dark:border-orange-900/40';
  } else if (normalized.includes('boil') || normalized.includes('steam') || normalized.includes('soup')) {
    emoji = '💧';
    classes = 'bg-sky-50 text-sky-700 border-sky-200/50 dark:bg-sky-950/30 dark:text-sky-300 dark:border-sky-900/40';
  } else if (normalized.includes('raw') || normalized.includes('fresh')) {
    emoji = '🌿';
    classes = 'bg-emerald-50 text-emerald-700 border-emerald-200/50 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-900/40';
  }

  return (
    <div className="mt-1">
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold capitalize border ${classes}`}>
        {!hideIcon && <span>{emoji}</span>}
        <span>{normalized.replace(/_/g, ' ')}</span>
      </span>
    </div>
  );
};


export const FoodCard: React.FC<AgentCardProps & {
  isSelectingMode?: boolean;
  setIsSelectingMode?: (val: boolean) => void;
  onEnterSelectingMode?: () => void;
  selectedItemKeys?: string[];
  setSelectedItemKeys?: (val: string[] | ((prev: string[]) => string[])) => void;
  actionRef?: React.MutableRefObject<any>;
}> = (props) => {
  const {
    msg, messages, report, foodLogs, t, formatNutrientValue,
    onLogFood, setLoggedMessageIds, loggedMessageIds, profile, handleSend,
    setInputText, fileInputRef
  } = props;

  const isLoggingRef = React.useRef(false);

  if (msg.isLive) {
    return null;
  }

  const comparisonData = msg.data?.comparison || msg.data?.agentResult?.comparison || msg.agentResult?.comparison;
  const mode = msg.data?.mode || msg.data?.agentResult?.mode || msg.agentResult?.mode;

  const [expandedTables, setExpandedTables] = React.useState<Record<string, boolean>>({});
  const [expandedScouts, setExpandedScouts] = React.useState<Record<string, boolean>>({});
  const [fullScreenImg, setFullScreenImg] = React.useState<{ src: string, boundingBox?: number[], foodName?: string, navItems?: { src: string, boundingBox?: number[], foodName?: string }[], navIndex?: number } | null>(null);

  const [searchModes, setSearchModes] = React.useState<Record<string, boolean>>({});
  const [searchedItemIndices, setSearchedItemIndices] = React.useState<Record<string, number>>({});
  const [searchResults, setSearchResults] = React.useState<Record<string, Array<{title: string, imageUrl: string, pageUrl: string}>>>({});
  const [searchLoading, setSearchLoading] = React.useState<Record<string, boolean>>({});
  const [brokenSearchImages, setBrokenSearchImages] = React.useState<Record<string, true>>({});
  const [searchPreview, setSearchPreview] = React.useState<{ groupKey: string, index: number } | null>(null);

  const [groupExpanded, setGroupExpanded] = React.useState<Record<string, boolean>>({});
  const [showTranslations, setShowTranslations] = React.useState<Record<string, boolean>>({});
  const [warningsDismissed, setWarningsDismissed] = React.useState(false);
  const [reviewsOpen, setReviewsOpen] = React.useState<boolean>(true);

  const [confirmedScoutIndices, setConfirmedScoutIndices] = React.useState<Set<number>>(new Set());
  const [openLabelIdx, setOpenLabelIdx] = React.useState<number | null>(null);

  const activeScoutItems = React.useMemo(() => {
    let items = [];
    if (msg.data?.scoutItems && msg.data.scoutItems.length > 0) items = msg.data.scoutItems;
    else if (msg.data?.pendingFoodLog?.scoutItems && Array.isArray(msg.data.pendingFoodLog.scoutItems) && msg.data.pendingFoodLog.scoutItems.length > 0) items = msg.data.pendingFoodLog.scoutItems;
    else if (msg.data?.agentResult?.scoutData?.items && Array.isArray(msg.data.agentResult.scoutData.items)) items = msg.data.agentResult.scoutData.items;
    else if (msg.data?.scoutData?.items && Array.isArray(msg.data.scoutData.items)) items = msg.data.scoutData.items;
    else if (msg.data?.agentResult?.scoutItems && Array.isArray(msg.data.agentResult.scoutItems)) items = msg.data.agentResult.scoutItems;
    
    if (confirmedScoutIndices.size > 0) {
      return items.map((item: any, i: number) => {
        if (confirmedScoutIndices.has(i) || confirmedScoutIndices.has(item.scoutIndex)) {
          return {
            ...item,
            itemConfidence: 'High',
            _preservedAnomalyFlags: item.anomalyFlags,
            anomalyFlags: []
          };
        }
        return item;
      });
    }
    
    return items;
  }, [msg.data, confirmedScoutIndices]);

  // Version counter to trigger re-renders when portion scaling updates in-place log data
  const [portionLogVersion, setPortionLogVersion] = React.useState<number>(0);

const resolveHistoricalImgSrc = (item: any, messageImages: string[], foodLogs: any[], imgIdxOverride?: number) => {
  const isExplicit = item.source === 'catalog_tag' || item.source === 'previous_meal';
  
  if (foodLogs && foodLogs.length > 0) {
    if (item.dbId) {
      const matched = foodLogs.find((f: any) => 
        f.id === item.dbId || 
        ((f.itemsBreakdown || []).length === 1 && (f.itemsBreakdown || [])[0].dbId === item.dbId)
      );
      if (matched && (matched.imageUrl || matched.imageUrls?.[0])) return resolveFoodImage(matched.imageUrl || matched.imageUrls?.[0], foodLogs) || '';
    }
    const nameToMatch = (item.originalName || item.keyword || item.name || '').toLowerCase();
    if (nameToMatch) {
      const matchedByName = foodLogs.find((f: any) => 
        (f.name || '').toLowerCase() === nameToMatch || 
        ((f.itemsBreakdown || []).length === 1 && (f.itemsBreakdown || [])[0].canonicalDbName?.toLowerCase() === nameToMatch)
      );
      if (matchedByName && (matchedByName.imageUrl || matchedByName.imageUrls?.[0])) {
        return resolveFoodImage(matchedByName.imageUrl || matchedByName.imageUrls?.[0], foodLogs) || '';
      }
    }
  }

  if (isExplicit) return getFoodImageUrl(item.keyword || item.originalName || item.name);

  if (typeof imgIdxOverride === 'number' && imgIdxOverride >= 0 && imgIdxOverride < messageImages.length) {
    return messageImages.length > 0 ? messageImages[imgIdxOverride] : getFoodImageUrl(item.keyword || item.originalName || item.name);
  }

  const rawIdx = typeof item.sourceImageIndex === 'number' ? item.sourceImageIndex : 0;
  const imgIdx = (messageImages.length > 0 && rawIdx >= 0 && rawIdx < messageImages.length) ? rawIdx : 0;
  return (messageImages.length > 0) ? messageImages[imgIdx] : getFoodImageUrl(item.keyword || item.originalName || item.name);
};

  const displayedScoutItems = React.useMemo(() => {
    const itemsBreakdown = msg.data?.pendingFoodLog?.itemsBreakdown || msg.data?.data?.itemsBreakdown || msg.data?.itemsBreakdown || msg.data?.agentResult?.data?.itemsBreakdown;
    if (!itemsBreakdown || itemsBreakdown.length === 0) {
      return activeScoutItems;
    }
    
    const usedScoutIndices = new Set();
    // Map each item in itemsBreakdown to a scout item format
    return itemsBreakdown.map((item: any, i: number) => {
      // Find the best matching scout item in activeScoutItems to preserve bounding box and image index
      let matchingScout = (activeScoutItems || []).find((s: any) => scoutIndexAgrees(item, s));
      if (!matchingScout) {
        matchingScout = (activeScoutItems || []).find((s: any) => {
          if (s.scoutIndex !== undefined && usedScoutIndices.has(s.scoutIndex)) return false;
          const sKey = (s.keyword || s.originalName || "").toLowerCase().trim();
          const sName = (s.originalName || s.keyword || "").toLowerCase().trim();
          const itemName = (item.canonicalDbName || item.name || "").toLowerCase().trim();
          if (itemName.includes(sKey) || sKey.includes(itemName) || itemName.includes(sName) || sName.includes(itemName) || (itemName.split(/\s+/)[0] && itemName.split(/\s+/)[0] === sKey.split(/\s+/)[0])) return true;
          const itemTokens = itemName.split(/[^a-z0-9]+/).filter((t: string) => t.length >= 3);
          const sTokens = `${sKey} ${sName}`.split(/[^a-z0-9]+/).filter((t: string) => t.length >= 3);
          return itemTokens.some((t: string) => sTokens.includes(t));
        });
      }
      if (!matchingScout && itemsBreakdown.length === (activeScoutItems || []).length) {
        const candidate = (activeScoutItems || [])[i];
        if (candidate && !usedScoutIndices.has(candidate.scoutIndex)) {
          matchingScout = candidate;
        }
      }
      
      if (matchingScout && matchingScout.scoutIndex !== undefined) {
        usedScoutIndices.add(matchingScout.scoutIndex);
      }
      
      const updatedName = item.canonicalDbName || item.name || item.originalLocalName;

      return {
        scoutIndex: matchingScout ? matchingScout.scoutIndex : (item.scoutIndex !== undefined ? item.scoutIndex : i),
        keyword: updatedName || matchingScout?.keyword || "item",
        originalName: updatedName || matchingScout?.originalName || "item",
        chainName: matchingScout?.chainName || item.chainName || item.brand || matchingScout?.brand || null,
        brand: matchingScout?.brand || item.brand || item.chainName || matchingScout?.chainName || null,
        scoutOriginalName: matchingScout?.originalName || null,
        labelProductName: matchingScout?.labelProductName || item.labelProductName || null,
        estimatedWeightGrams: item.weightGrams || item.estimatedWeightGrams || matchingScout?.estimatedWeightGrams,
        weightGrams: item.weightGrams || item.estimatedWeightGrams,
        portionRatio: item.portionRatio || matchingScout?.portionRatio || 1.0,
        portionDescription: item.portionDescription || matchingScout?.portionDescription,
        packGrams: item.packGrams || matchingScout?.packGrams,
        boundingBox2D: item.boundingBox2D || (matchingScout ? matchingScout.boundingBox2D : null),
        sourceImageIndex: typeof item.sourceImageIndex === 'number' ? item.sourceImageIndex : (matchingScout ? matchingScout.sourceImageIndex : null),
        itemConfidence: matchingScout ? matchingScout.itemConfidence : "High (>90%)",
        anomalyFlags: matchingScout ? matchingScout.anomalyFlags : [],
        cookingMethod: item.cookingMethod || (matchingScout ? matchingScout.cookingMethod : null),
        rawNutritionLabel: matchingScout?.rawNutritionLabel || item.rawNutritionLabel,
        ingredientsList: matchingScout?.ingredientsList || item.ingredientsList,
        visualIngredients: matchingScout?.visualIngredients || item.visualIngredients,
        nutritionFacts: item.nutritionFacts || item.nutrients || matchingScout?.nutritionFacts,
        nutrients: item.nutrients || item.nutritionFacts || matchingScout?.nutrients,
        syntheticBase100g: item.syntheticBase100g || matchingScout?.syntheticBase100g || null,
        baseNutrients100g: item.baseNutrients100g || matchingScout?.baseNutrients100g || null,
        isDishEstimate: Boolean(item.isDishEstimate || matchingScout?.isDishEstimate || item.dbSource === 'estimated'),
        source: matchingScout?.source || item.source,
        dbSource: item.dbSource || ((item.componentsDetailList?.length || item.components?.length) ? 'composite' : matchingScout?.dbSource) || null,
        dbId: item.dbId || matchingScout?.dbId || null,
        isRealTruth: item.dbSource !== 'composite' && (item.isRealTruth || item.dbSource === 'brand_official' || item.dbSource === 'label' || item.dbSource === 'label_partial'),
        labelNutrientsPerServing: item.labelNutrientsPerServing || item.syntheticBase100g || item.primaryBase100g || item.nutrients || matchingScout?.labelNutrientsPerServing || null,
        primaryBase100g: item.primaryBase100g || item.syntheticBase100g || item.labelNutrientsPerServing || null,
        primaryBaseMatchName: item.primaryBaseMatchName || item.canonicalDbName || null,
        componentsDetailList: (Array.isArray(item.componentsDetailList) && item.componentsDetailList.length > 0) ? item.componentsDetailList : ((Array.isArray(item.components) && item.components.length > 0) ? item.components : (item.componentsDetail || matchingScout?.componentsDetailList || matchingScout?.components || [])),
        components: (Array.isArray(item.components) && item.components.length > 0) ? item.components : ((Array.isArray(item.componentsDetailList) && item.componentsDetailList.length > 0) ? item.componentsDetailList : (item.componentsDetail || matchingScout?.components || matchingScout?.componentsDetailList || null)),
        compositeSiblings: item.compositeSiblings || matchingScout?.compositeSiblings || item.componentsDetailList || matchingScout?.componentsDetailList || null,
        nutrientSourceMap: item.nutrientSourceMap || matchingScout?.nutrientSourceMap || null
      };
    });
  }, [activeScoutItems, msg.data, portionLogVersion]);

  const isAlreadyLogged = React.useMemo(() => {
    if (!msg.data?.pendingFoodLog) return false;
    if ((loggedMessageIds || []).includes(msg.id)) return true;
    return false;
  }, [msg.id, msg.data?.pendingFoodLog, loggedMessageIds]);

  // Selection hooks for Card-Wide Multi-Select
  const [_isSelectingMode, _setIsSelectingMode] = React.useState<boolean>(false);
  const [_selectedItemKeys, _setSelectedItemKeys] = React.useState<string[]>([]); // stores "groupIdx-itemIdx"
  
  // Wrapper variables prioritizing synchronized props from LogChat, falling back to local state
  const isSelectingMode = props.isSelectingMode !== undefined ? props.isSelectingMode : _isSelectingMode;
  const setIsSelectingMode = props.setIsSelectingMode !== undefined ? props.setIsSelectingMode : _setIsSelectingMode;
  const selectedItemKeys = props.selectedItemKeys !== undefined ? props.selectedItemKeys : _selectedItemKeys;
  const setSelectedItemKeys = props.setSelectedItemKeys !== undefined ? props.setSelectedItemKeys : _setSelectedItemKeys;

  const [selectorError, setSelectorError] = React.useState<string>("");
  const [searchErrors, setSearchErrors] = React.useState<Record<string, string>>({});
  

  const [previewState, setPreviewState] = React.useState<{ groupIdx: number, itemIdx: number, resolvedImgSrc?: string, overrideSrc?: string } | null>(null);
  const [scoutPreviewIdx, setScoutPreviewIdx] = React.useState<number | null>(null);
  const [externalPreviewImg, setExternalPreviewImg] = React.useState<{ url: string; title: string } | null>(null);

  // Portion Scaling State
  const [portionScale, setPortionScale] = React.useState<number>(msg.data?.pendingFoodLog?.portionRatio || 1.0);
  const [portionAccepted, setPortionAccepted] = React.useState<boolean>(Boolean(msg.data?.pendingFoodLog?.portionAccepted));

  const handleScalePortion = (ratio: number) => {
    setPortionScale(ratio);
    setPortionAccepted(true);
    setPortionLogVersion((v) => v + 1);
    const currentLog = msg.data?.pendingFoodLog || msg.pendingFoodLog;
    if (!currentLog) return;
    const updatedLog = scaleMealPortion(currentLog, ratio);
    const logId = currentLog.id || (msg as any).loggedFoodId;
    if (logId) {
      updatedLog.id = logId;
    }
    if (msg.data) {
      msg.data.pendingFoodLog = updatedLog;
      if (updatedLog.scoutItems) msg.data.scoutItems = updatedLog.scoutItems;
      if (updatedLog.receiptTable) msg.data.receiptTable = updatedLog.receiptTable;
      if (updatedLog.message) msg.data.message = updatedLog.message;
      if (msg.data.agentResult) {
        if (updatedLog.message) msg.data.agentResult.message = updatedLog.message;
        if (updatedLog.receiptTable) msg.data.agentResult.receiptTable = updatedLog.receiptTable;
        if (updatedLog.scoutItems) msg.data.agentResult.scoutItems = updatedLog.scoutItems;
      }
      msg.data = { ...msg.data };
    }
    msg.pendingFoodLog = updatedLog;

    if ((isAlreadyLogged || (loggedMessageIds && loggedMessageIds.includes(msg.id))) && onLogFood) {
      onLogFood(updatedLog as any);
    }
  };

  const handleScaleSingleDish = (dishIdx: number, ratio: number) => {
    setPortionAccepted(true);
    setPortionLogVersion((v) => v + 1);
    const currentLog = msg.data?.pendingFoodLog || msg.pendingFoodLog;
    if (!currentLog) return;
    const updatedLog = scaleSingleDishPortion(currentLog, dishIdx, ratio);
    const logId = currentLog.id || (msg as any).loggedFoodId;
    if (logId) {
      updatedLog.id = logId;
    }
    if (msg.data) {
      msg.data.pendingFoodLog = updatedLog;
      if (updatedLog.scoutItems) msg.data.scoutItems = updatedLog.scoutItems;
      if (updatedLog.receiptTable) msg.data.receiptTable = updatedLog.receiptTable;
      if (updatedLog.message) msg.data.message = updatedLog.message;
      if (msg.data.agentResult) {
        if (updatedLog.message) msg.data.agentResult.message = updatedLog.message;
        if (updatedLog.receiptTable) msg.data.agentResult.receiptTable = updatedLog.receiptTable;
        if (updatedLog.scoutItems) msg.data.agentResult.scoutItems = updatedLog.scoutItems;
      }
      msg.data = { ...msg.data };
    }
    msg.pendingFoodLog = updatedLog;
    if (updatedLog.portionRatio) {
      setPortionScale(updatedLog.portionRatio);
    }

    if ((isAlreadyLogged || (loggedMessageIds && loggedMessageIds.includes(msg.id))) && onLogFood) {
      onLogFood(updatedLog as any);
    }
  };

  // Card-wide parent image search state hooks
  const [onlineImageUrls, setOnlineImageUrls] = React.useState<Record<string, string>>({});
  const [showMenuImages, setShowMenuImages] = React.useState<Record<string, boolean>>({});
  const [fetchingGroupImages, setFetchingGroupImages] = React.useState<Record<string, boolean>>({});

  const handleFoodSearch = async (groupIdx: number, itemIdx: number, query: string) => {
    const groupKey = `${msg.id}-${groupIdx}`;
    const itemKey = `${msg.id}-${groupIdx}-${itemIdx}`;
    
    setSearchedItemIndices(prev => ({ ...prev, [itemKey]: itemIdx }));
    setSearchModes(prev => {
      const next = { ...prev };
      Object.keys(next).forEach(k => {
        if (k.startsWith(`${groupKey}-`) && k !== itemKey) {
          next[k] = false;
        }
      });
      next[itemKey] = true;
      return next;
    });
    
    if (searchResults[itemKey] && searchResults[itemKey].length > 0) {
      return;
    }

    setSearchLoading(prev => ({ ...prev, [itemKey]: true }));
    setSearchErrors(prev => ({ ...prev, [itemKey]: "" }));
    try {
      trackApiCall('brave', `Brave Image Search (Manual) - ${query}`);
      const response = await fetch("/api/gemini/food-image-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, mode: "complete" }),
      });
      const data = await response.json();
      if (data.images && data.images.length > 0) {
        setSearchResults(prev => ({ ...prev, [itemKey]: data.images.slice(0, 5) }));
      } else {
        setSearchResults(prev => ({ ...prev, [itemKey]: [] }));
        setSearchErrors(prev => ({ ...prev, [itemKey]: data.error || "No images returned." }));
      }
    } catch (e: any) {
      console.error("Search error:", e);
      setSearchResults(prev => ({ ...prev, [itemKey]: [] }));
      setSearchErrors(prev => ({ ...prev, [itemKey]: e.message || "Failed to load Google Search API." }));
    } finally {
      setSearchLoading(prev => ({ ...prev, [itemKey]: false }));
    }
  };

  const effectiveFoodLog = React.useMemo(() => {
    const isValid = (l: any) => {
      if (!l || typeof l !== 'object' || Array.isArray(l)) return false;
      return !!(
        l.name ||
        l.title ||
        (Array.isArray(l.itemsBreakdown) && l.itemsBreakdown.length > 0) ||
        (Array.isArray(l.items) && l.items.length > 0) ||
        (Array.isArray(l.scoutItems) && l.scoutItems.length > 0) ||
        (l.nutrients && typeof l.nutrients === 'object' && Object.keys(l.nutrients).length > 0)
      );
    };

    let log = msg.data?.pendingFoodLog || msg.pendingFoodLog;
    if (isValid(log)) return log;

    const raw = msg.data?.agentResult || msg.agentResult || msg.data?.clean_result || msg.data || {};
    if (isValid(raw.pendingFoodLog)) return raw.pendingFoodLog;
    if (isValid(raw.foodData)) return raw.foodData;
    if (isValid(raw.data)) return raw.data;

    if (raw.mealBuild) {
      const mbLog = toPendingFoodLog(raw.mealBuild);
      if (isValid(mbLog)) return mbLog;
    }
    if (msg.data?.mealBuild) {
      const mbLog = toPendingFoodLog(msg.data.mealBuild);
      if (isValid(mbLog)) return mbLog;
    }
    if ((msg as any).mealBuild) {
      const mbLog = toPendingFoodLog((msg as any).mealBuild);
      if (isValid(mbLog)) return mbLog;
    }

    const jobId = msg.data?.jobId || (msg as any).jobId;
    if (jobId) {
      const j = JobStore.getJob(jobId);
      if (j) {
        const jResult = j.result?.clean_result || j.result || {};
        if (isValid(jResult.pendingFoodLog)) return jResult.pendingFoodLog;
        if (jResult.mealBuild) {
          const mbLog = toPendingFoodLog(jResult.mealBuild);
          if (isValid(mbLog)) return mbLog;
        }
        if (j.mealBuild) {
          const mbLog = toPendingFoodLog(j.mealBuild);
          if (isValid(mbLog)) return mbLog;
        }
      }
    }

    // If portion clarification is currently pending user selection, do not synthesize a premature pendingFoodLog
    if (msg.data?.portionClarify || msg.data?.needsPortionClarify || (msg as any).portionClarify || (msg as any).needsPortionClarify) {
      return null;
    }

    const items = msg.data?.scoutItems || raw.scoutItems || raw.itemsBreakdown || raw.items || [];
    if (items.length > 0 || raw.name || raw.title) {
      return {
        itemsBreakdown: items,
        items: items,
        nutrients: raw.nutrients || {},
        name: raw.name || raw.title || 'Meal',
        title: raw.name || raw.title || 'Meal',
        benefits: raw.benefits || [],
        risks: raw.risks || [],
        recommendation: raw.recommendation || '',
        verdict: raw.verdict || '',
        message: raw.message || raw.text || msg.content || '',
        imageUrls: raw.imageUrls || (msg.imageUrl ? [msg.imageUrl] : []),
        photoUrl: raw.photoUrl || msg.imageUrl,
        receiptTable: raw.receiptTable,
        weightGrams: raw.weightGrams,
        quantity: raw.quantity
      };
    }

    return null;
  }, [msg, portionLogVersion]);

  if (effectiveFoodLog) {
    if (!msg.data) msg.data = {};
    if (!msg.data.pendingFoodLog) msg.data.pendingFoodLog = effectiveFoodLog;
    if (!msg.pendingFoodLog) msg.pendingFoodLog = effectiveFoodLog;
  }

  const isFoodAgentType = !msg.agentType || msg.agentType === 'food' || msg.agentType === 'food_log' || msg.agentType === 'food_analyze' || msg.agentType === 'food_compare' || msg.agentType === 'front_desk' || msg.agentType === 'new_log' || msg.agentType === 'modify' || msg.agentType === 'review' || msg.agentType === 'medical';
  const hasFoodPayload = !!(effectiveFoodLog || msg.data?.scoutItems?.length || msg.data?.comparison || msg.data?.agentResult?.mealBuild || msg.agentResult?.scoutItems?.length);

  if (!isFoodAgentType && !hasFoodPayload) return null;

  const userUploadedImages = React.useMemo(() => {
    if (!messages) return [];
    const urls: string[] = [];
    messages.forEach(m => {
      if (m.imageUrls && m.imageUrls.length > 0) {
        urls.push(...m.imageUrls);
      } else if (m.imageUrl) {
        urls.push(m.imageUrl);
      }
    });
    return urls.map(url => resolveFoodImage(url, foodLogs) || url);
  }, [messages, foodLogs]);

  const messageImages = React.useMemo(() => {
    // 1. If the current assistant message itself has imageUrls or imageUrl
    const localUrls = msg.imageUrls && msg.imageUrls.length > 0
      ? msg.imageUrls
      : (msg.imageUrl ? [msg.imageUrl] : []);
    
    if (localUrls.length > 0) {
      return localUrls.map(url => resolveFoodImage(url, foodLogs) || url);
    }

    // 2. If the pending food log in msg has imageUrls
    if (msg.data?.pendingFoodLog?.imageUrls && msg.data.pendingFoodLog.imageUrls.length > 0) {
      return msg.data.pendingFoodLog.imageUrls.map((url: string) => resolveFoodImage(url, foodLogs) || url);
    }
    if (msg.pendingFoodLog?.imageUrls && msg.pendingFoodLog.imageUrls.length > 0) {
      return msg.pendingFoodLog.imageUrls.map((url: string) => resolveFoodImage(url, foodLogs) || url);
    }
    if (msg.data?.foodLog?.imageUrls && msg.data.foodLog.imageUrls.length > 0) {
      return msg.data.foodLog.imageUrls.map((url: string) => resolveFoodImage(url, foodLogs) || url);
    }
    if (msg.data?.data?.imageUrls && msg.data.data.imageUrls.length > 0) {
      return msg.data.data.imageUrls.map((url: string) => resolveFoodImage(url, foodLogs) || url);
    }

    // 3. Search backwards through messages in this conversation to find the source images for this meal thread
    if (messages) {
      const currentIdx = messages.indexOf(msg);
      const startIdx = currentIdx > 0 ? currentIdx - 1 : messages.length - 1;
      for (let i = startIdx; i >= 0; i--) {
        const m = messages[i];
        if (m.imageUrls && m.imageUrls.length > 0) {
          return m.imageUrls.map(url => resolveFoodImage(url, foodLogs) || url);
        }
        if (m.imageUrl) {
          return [resolveFoodImage(m.imageUrl, foodLogs) || m.imageUrl];
        }
        if (m.data?.pendingFoodLog?.imageUrls && m.data.pendingFoodLog.imageUrls.length > 0) {
          return m.data.pendingFoodLog.imageUrls.map((url: string) => resolveFoodImage(url, foodLogs) || url);
        }
        if (m.pendingFoodLog?.imageUrls && m.pendingFoodLog.imageUrls.length > 0) {
          return m.pendingFoodLog.imageUrls.map((url: string) => resolveFoodImage(url, foodLogs) || url);
        }
        if (m.data?.foodLog?.imageUrls && m.data.foodLog.imageUrls.length > 0) {
          return m.data.foodLog.imageUrls.map((url: string) => resolveFoodImage(url, foodLogs) || url);
        }
      }
    }

    return [];
  }, [msg, messages, foodLogs]);

  const resolvedMessageImages = React.useMemo(() => {
    return messageImages;
  }, [messageImages]);

  const resolvedScoutItems = React.useMemo(() => {
    if (activeScoutItems && activeScoutItems.length > 0) return activeScoutItems;
    if (msg.data?.scoutItems && msg.data.scoutItems.length > 0) return msg.data.scoutItems;
    if (msg.data?.pendingFoodLog?.scoutItems && Array.isArray(msg.data.pendingFoodLog.scoutItems) && msg.data.pendingFoodLog.scoutItems.length > 0) return msg.data.pendingFoodLog.scoutItems;
    if (msg.pendingFoodLog?.scoutItems && Array.isArray(msg.pendingFoodLog.scoutItems) && msg.pendingFoodLog.scoutItems.length > 0) return msg.pendingFoodLog.scoutItems;
    if (msg.data?.agentResult?.scoutItems && Array.isArray(msg.data.agentResult.scoutItems) && msg.data.agentResult.scoutItems.length > 0) return msg.data.agentResult.scoutItems;
    if (messages) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.data?.scoutItems && m.data.scoutItems.length > 0) return m.data.scoutItems;
        if (m.data?.pendingFoodLog?.scoutItems && m.data.pendingFoodLog.scoutItems.length > 0) return m.data.pendingFoodLog.scoutItems;
        if (m.pendingFoodLog?.scoutItems && m.pendingFoodLog.scoutItems.length > 0) return m.pendingFoodLog.scoutItems;
        if (m.data?.agentResult?.scoutItems && m.data.agentResult.scoutItems.length > 0) return m.data.agentResult.scoutItems;
      }
    }
    return [];
  }, [activeScoutItems, msg, messages]);

  const getNutrientFromTable = (comparisonTable: any, nutrientNameQuery: string, foodIdx: number): string | null => {
    if (!comparisonTable || !comparisonTable.rows) return null;
    const row = comparisonTable.rows.find((r: any) => 
      r.nutrient && r.nutrient.toLowerCase().includes(nutrientNameQuery.toLowerCase())
    );
    if (!row || !row.values || row.values.length <= foodIdx) return null;
    return row.values[foodIdx];
  };

  const PROFILE_TOP_NUTRIENTS = React.useMemo(() => {
    const list = profile?.topNutrientsToMonitor || ['calories', 'saturatedFat', 'sodium'];
    return list.map(n => n.toLowerCase().replace(/\s+/g, ''));
  }, [profile?.topNutrientsToMonitor]);

  const displayGroups = React.useMemo(() => {
    if (!comparisonData?.groups) return [];
    
    const rawGroups = [...comparisonData.groups];
    
    // Sort logic helper
    const getSuitabilityScore = (suitability: string): number => {
      const s = suitability.toLowerCase();
      const isNegatedPositive = /not\s+(recommended|safe|good|best|low|least|safest|perfect)/i.test(s);
      const isNegativeLeast = /least\s+(suitable|recommended|safe|good|healthy|beneficial|ideal)/i.test(s);
      
      if (s.includes('bad') || s.includes('avoid') || s.includes('high risk') || s.includes('severe') || s.includes('red') || s.includes('strongly discouraged') || s.includes('extremely harmful') || isNegatedPositive || s.includes('worst')) return 0;
      if (s.includes('best') || s.includes('safest') || s.includes('recommended') || s.includes('perfect')) return 3;
      if (s.includes('good') || s.includes('safe') || s.includes('low risk') || s.includes('limit')) return 2;
      if (s.includes('moderate') || s.includes('medium') || s.includes('caution') || s.includes('amber')) return 1;
      return 0;
    };
    
    // The backend LLM is strictly instructed to return groups in tiered order (Tier 1, Tier 2, Tier 3).
    // Do NOT resort them here, as string-based scoring is fragile.
    
    // Enrich each group's items with boundingBox2D and sourceImageIndex from scoutItems
    const groups = rawGroups.map((g: any) => {
      const items = (g.items || []).map((item: any) => {
        const matchingScout = (resolvedScoutItems || []).find((s: any) => {
          if (scoutIndexAgrees(item, s)) return true;
          return namesReferToSameFood(item.name, s.keyword || s.originalName);
        }) || (resolvedScoutItems || []).find((s: any) => {
          return namesReferToSameFood(g.groupName, s.keyword || s.originalName);
        });

        return {
          ...item,
          boundingBox2D: item.boundingBox2D || (matchingScout ? matchingScout.boundingBox2D : null),
          sourceImageIndex: typeof item.sourceImageIndex === 'number' ? item.sourceImageIndex : (matchingScout && typeof matchingScout.sourceImageIndex === 'number' ? matchingScout.sourceImageIndex : 0),
          confidenceRating: item.confidenceRating,
          confidenceComment: item.confidenceComment
        };
      });

      // If group has no items, create a default item so it can be previewed
      const finalItems = items.length > 0 ? items : [
        {
          name: g.groupName,
          boundingBox2D: null,
          sourceImageIndex: 0
        }
      ].map(item => {
        const matchingScout = (resolvedScoutItems || []).find((s: any) => {
          const gName = (g.groupName || "").toLowerCase();
          const sKw = (s.keyword || "").toLowerCase();
          const sOrig = (s.originalName || "").toLowerCase();
          return (
            (gName && sKw && (gName.includes(sKw) || sKw.includes(gName))) ||
            (gName && sOrig && (gName.includes(sOrig) || sOrig.includes(gName))) ||
            (gName.split(' ')[0] === sKw.split(' ')[0])
          );
        });
        return {
          ...item,
          boundingBox2D: matchingScout ? matchingScout.boundingBox2D : null,
          sourceImageIndex: matchingScout && typeof matchingScout.sourceImageIndex === 'number' ? matchingScout.sourceImageIndex : 0
        };
      });

      return {
        ...g,
        items: finalItems
      };
    });

    return groups;
  }, [comparisonData, resolvedScoutItems, profile?.topNutrientsToMonitor]);

  // Function to parallel-fetch all text menu images in complete mode
  const fetchGroupMenuImages = async (groupIdx: number) => {
    const group = displayGroups[groupIdx];
    if (!group || !group.items) return;
    
    const groupKey = `${msg.id}-${groupIdx}`;
    setFetchingGroupImages(prev => ({ ...prev, [groupKey]: true }));
    setShowMenuImages(prev => ({ ...prev, [groupKey]: true }));
    
    const promises = group.items.map(async (item: any, itemIdx: number) => {
      const itemKey = `${msg.id}-${groupIdx}-${itemIdx}`;
      if (onlineImageUrls[itemKey]) return;
      
      try {
        const res = await fetch("/api/gemini/food-image-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: item.name, mode: "complete" })
        });
        const data = await res.json();
        if (data.images && data.images.length > 0) {
          setOnlineImageUrls(prev => ({
            ...prev,
            [itemKey]: data.images[0].imageUrl
          }));
        }
      } catch (err) {
        console.warn("Failed to fetch menu image for", item.name, err);
      }
    });
    
    await Promise.all(promises);
    setFetchingGroupImages(prev => ({ ...prev, [groupKey]: false }));
  };

  // Register parent Action handlers
  React.useEffect(() => {
    if (props.actionRef && props.isSelectingMode) {
      props.actionRef.current = {
        triggerImageSearch: (keys: string[]) => {
          setSelectorError("");
          keys.forEach(key => {
            const [gIdx, iIdx] = key.split('-').map(Number);
            const name = displayGroups[gIdx]?.items?.[iIdx]?.name;
            if (name) {
              handleFoodSearch(gIdx, iIdx, name);
            }
          });
        },

        triggerFetchMenuImages: async (keys: string[]) => {
          setSelectorError("");
          const promises = keys.map(async (key) => {
            const [gIdx, iIdx] = key.split('-').map(Number);
            const group = displayGroups[gIdx];
            if (!group || !group.items) return;
            const item = group.items[iIdx];
            if (!item) return;

            const itemKey = `${msg.id}-${gIdx}-${iIdx}`;
            const groupKey = `${msg.id}-${gIdx}`;

            setFetchingGroupImages(prev => ({ ...prev, [itemKey]: true }));
            setShowMenuImages(prev => ({ ...prev, [itemKey]: true }));

            try {
              trackApiCall('brave', `Brave Image Search (Targeted Menu Lookup) - ${item.name}`);
              const res = await fetch("/api/gemini/food-image-search", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: item.name, mode: "complete" })
              });
              const data = await res.json();
              if (data.images && data.images.length > 0) {
                setOnlineImageUrls(prev => ({
                  ...prev,
                  [itemKey]: data.images[0].imageUrl
                }));
              }
            } catch (err) {
              console.warn("Failed to fetch targeted menu image for", item.name, err);
            } finally {
              setFetchingGroupImages(prev => ({ ...prev, [itemKey]: false }));
            }
          });
          await Promise.all(promises);
        },

        triggerCompareFood: (keys: string[]) => {
          setSelectorError("");
          const selectedNames = keys.map(key => {
            const [gIdx, iIdx] = key.split('-').map(Number);
            return displayGroups[gIdx]?.items?.[iIdx]?.name;
          });
          if (handleSend) {
            handleSend({
              text: `Compare these specific menu items: ${selectedNames.join(', ')}. Rank them best-to-worst based on my health targets.`,
              compareOnly: true,
              compareItems: selectedNames,
              sourceMsgId: msg.id
            });
          }
        }
      };
    }
  }, [props.actionRef, props.isSelectingMode, displayGroups, handleSend, msg.id]);

  return (
    <>
      {(mode === 'evaluation' && comparisonData && comparisonData.groups && comparisonData.groups.length > 0) && (
                    <div className="space-y-3 animation-fade-in w-full max-w-full min-w-0 overflow-hidden bg-transparent">
                      {msg.data.correctionOf && (
                         <div className="flex justify-center pb-2">
                           <button 
                             onClick={() => {
                               // Assuming the bubble has an ID like 'chat-message-' + msg.id, 
                               // but scrolling to the container is safer
                               window.scrollTo({ top: 0, behavior: 'smooth' });
                             }}
                             className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-all flex items-center gap-1.5"
                           >
                             <ChevronUp className="w-3 h-3" />
                             Scroll to top
                           </button>
                         </div>
                      )}
                      <div className="flex items-center justify-between border-b border-theme-border/50 pb-2 gap-2">
                        <h4 className="font-bold text-theme-text text-sm break-words flex flex-wrap items-center gap-1.5 w-full">
                          <span className="shrink-0">{t.comparisonLabel || 'Comparison'}</span> <span className="text-indigo-600 dark:text-indigo-400 font-bold break-words">
                            {(() => {
                              const val = comparisonData?.comparisonTitle || comparisonData?.keyNutrientConcern || 'Nutrients of Concern';
                              return typeof val === 'string' ? val.replace(/^key\s*:\s*/i, '') : val;
                            })()}
                          </span>
                        </h4>
                      </div>

                      {/* Shared Scout Items Row for Comparison Mode */}
                      {activeScoutItems.length > 0 && (
                        <div className="bg-slate-50/50 dark:bg-slate-900/30 rounded-xl p-3 border border-theme-border/60 mb-2">
                           <div className="flex items-center justify-between mb-2">
                             <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                               <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                               Identified Ingredients
                             </div>
                           </div>
                           <div className={
                             activeScoutItems.length > 4 
                               ? "flex overflow-x-auto gap-3 pt-2 pb-2 w-full font-sans scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800" 
                               : "flex flex-wrap items-start justify-start gap-3 pt-2 pb-2 w-full font-sans"
                           }>
                             {activeScoutItems.map((item: any, i: number) => {
                               const allSameIdx = activeScoutItems.every((s: any) => typeof s.sourceImageIndex !== 'number' || s.sourceImageIndex === (activeScoutItems[0]?.sourceImageIndex || 0));
                               const allSameBox = activeScoutItems.every((s: any) => JSON.stringify(s.boundingBox2D || null) === JSON.stringify(activeScoutItems[0]?.boundingBox2D || null));
                               const rawIdx = typeof item.sourceImageIndex === 'number' ? item.sourceImageIndex : 0;
                               const imgIdx = (messageImages.length > 1 && allSameIdx && allSameBox && i < messageImages.length)
                                 ? i
                                 : (rawIdx >= 0 && rawIdx < messageImages.length ? rawIdx : 0);
                               const resolvedImgSrc = resolveHistoricalImgSrc(item, messageImages, foodLogs || [], imgIdx);
                               const itemWidthClass = activeScoutItems.length > 4
                                 ? 'w-[90px] sm:w-[105px] shrink-0'
                                 : activeScoutItems.length === 1 
                                   ? 'w-[130px] sm:w-[150px] shrink-0' 
                                   : 'w-full max-w-[160px]';
                               return (
                                 <div key={i} className={`flex flex-col items-center gap-1 shrink-0 relative group ${itemWidthClass}`}>
                                   <div className="relative w-full">
                                     <div 
                                       className={`w-full aspect-square rounded-xl overflow-hidden cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-sm ${
                                         (item.itemConfidence?.toLowerCase().includes('low') || item.itemConfidence?.toLowerCase().includes('medium')) 
                                           ? 'bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-400 dark:border-amber-500 shadow-amber-500/20'
                                           : 'bg-slate-100 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700/50'
                                       }`}
                                       onClick={() => setScoutPreviewIdx(i)}
                                     >
                                       {isValidBoundingBox(item.boundingBox2D) ? (
                                         <CroppedFoodImage 
                                           src={resolvedImgSrc} 
                                           boundingBox={item.boundingBox2D} 
                                           alt={item.keyword} 
                                           className="w-full h-full object-cover"
                                           imageUrls={messageImages}
                                           sourceImageIndex={imgIdx}
                                         />
                                       ) : (
                                         <img 
                                           src={resolvedImgSrc} 
                                           alt={item.keyword} 
                                           className="w-full h-full object-cover"
                                           onError={(e) => { const t = e.target as HTMLImageElement; if (!t.src.includes('unsplash.com')) t.src = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100&q=80&auto=format'; }}
                                         />
                                       )}
                                     </div>
                                     {(item.itemConfidence?.toLowerCase().includes('low') || item.itemConfidence?.toLowerCase().includes('medium')) && (
                                       <div 
                                         onClick={(e) => {
                                           e.stopPropagation();
                                           setReviewsOpen(true);
                                         }}
                                         className="absolute -top-1.5 -right-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-sm z-10 cursor-pointer hover:scale-110 transition-transform"
                                         title="Show low confidence identification panel"
                                       >
                                         <span className="text-[10px] font-bold">!</span>
                                       </div>
                                     )}
                                   </div>
                                   <span className="text-[10px] text-center font-medium leading-tight break-words line-clamp-2 w-full font-sans text-slate-700 dark:text-slate-300">
                                     {showTranslations.scout ? (item.keyword || item.originalName) : (item.originalName || item.keyword)}
                                   </span>
                                   {item.anomalyFlags && item.anomalyFlags.length > 0 && (
                                     <span className="text-[8px] text-center leading-tight text-amber-600 dark:text-amber-500 w-full font-sans line-clamp-2">
                                       {item.anomalyFlags.join(', ')}
                                     </span>
                                   )}
                                 </div>
                               );
                             })}
                           </div>

                           {/* Uncertain Items Helper Button */}
                           {reviewsOpen && activeScoutItems.some(isItemUnclearOrLowConfidence) && (
                             <div className="mt-2 flex flex-col gap-1.5 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/50 rounded-lg p-2 font-sans relative">
                               <button 
                                 onClick={() => setReviewsOpen(false)}
                                 className="absolute top-1.5 right-1.5 text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 p-0.5 rounded-full hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors"
                                 title="Close panel"
                               >
                                 <X className="w-3.5 h-3.5" />
                               </button>
                               <div className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400 pr-6">
                                 <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                 <div className="flex flex-col">
                                   <span className="text-[11px] font-bold leading-tight">{t.lowConfidence}</span>
                                   <span className="text-[10px] font-medium leading-tight">
                                     {activeScoutItems
                                        .filter((i: any) => isItemUnclearOrLowConfidence(i))
                                        .map((i: any) => i.originalName || i.keyword || i.name)
                                        .join(', ')}
                                   </span>
                                 </div>
                               </div>
                               <div className="flex gap-2">
                                 <button 
                                   onClick={() => { document.getElementById('food-chat-input')?.focus(); }} 
                                   className="flex-1 text-[10px] font-bold bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 py-1.5 px-3 rounded-md shadow-sm hover:bg-amber-50 dark:hover:bg-amber-900/40 active:scale-95 transition-all text-center"
                                 >
                                   Edit Item
                                 </button>
                                 <button 
                                   onClick={() => { 
                                      const idx = activeScoutItems[0]?.scoutIndex ?? 0;
                                      setConfirmedScoutIndices(prev => new Set([...prev, idx]));
                                   }} 
                                   className="flex-1 text-[10px] font-bold bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 py-1.5 px-3 rounded-md shadow-sm hover:bg-amber-50 dark:hover:bg-amber-900/40 active:scale-95 transition-all text-center"
                                 >
                                   This is correct
                                 </button>
                               </div>
                             </div>
                           )}
                        </div>
                      )}

                      {((msg.content && msg.content !== 'null') || (msg.data?.agentResult?.message && msg.data?.agentResult?.message !== 'null')) && (
                        (() => {
                           const topMsg = msg.content !== 'null' ? msg.content : msg.data?.agentResult?.message;
                           const isDuplicate = displayGroups.length === 1 && (displayGroups[0].message === topMsg || displayGroups[0].recommendation === topMsg);
                           if (isDuplicate) return null;
                           return (
                             <div className="text-[11.5px] text-theme-neutral font-sans leading-relaxed text-left pb-3 whitespace-pre-line break-words">
                               {formatMessageContent(topMsg, msg)}
                             </div>
                           );
                        })()
                      )}

                      {/* Foods Comparison Cards - Horizontally Scrollable (200px wide, borderless, separated by vertical dividers with 10px spacing) */}
                      <div className="flex gap-0 mt-2 overflow-x-auto pb-3 scrollbar-thin scrollbar-thumb-slate-300 dark:scrollbar-thumb-slate-700 snap-x snap-mandatory w-full overscroll-x-contain">
                        {displayGroups.map((group: any, idx: number) => {
                          const lowerSuit = String(group.suitability || '').toLowerCase();
                          const v = group.verdict;
                          const lblLower = (v?.label || group.suitability || '').toLowerCase();
                          const lvl = (v?.level || '').toLowerCase();
                          const colorCls = (lvl === 'alert' || lblLower.includes('bad') || lblLower.includes('high') || lblLower.includes('excess') || lblLower.includes('worst') || lblLower.includes('harmful'))
                            ? 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-800/50 dark:text-rose-300'
                            : (lvl === 'warning' || lblLower.includes('moderate') || lblLower.includes('caution') || lblLower.includes('amber'))
                            ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-800/50 dark:text-amber-300'
                            : (lvl === 'good' || lblLower.includes('healthy') || lblLower.includes('balanced') || lblLower.includes('safe') || lblLower.includes('best') || lblLower.includes('good'))
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800/50 dark:text-emerald-300'
                            : 'bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-800/50 dark:text-indigo-300';

                          return (
                            <React.Fragment key={idx}>
                              {idx > 0 && (
                                <div className="w-[1px] bg-slate-200 dark:bg-slate-800 self-stretch my-2 shrink-0 mx-[10px]" />
                              )}
                              <div className="w-[80%] sm:w-[320px] shrink-0 snap-align-start flex flex-col relative space-y-3">
                                
                                <div className="flex flex-col gap-1.5">
                                  {!(displayGroups.length === 1 && activeScoutItems.length === 1 && (group.groupName === activeScoutItems[0].keyword || group.groupName === activeScoutItems[0].originalName)) && (
                                    <h4 className="font-bold text-slate-800 dark:text-slate-100 text-[15px] leading-snug">
                                      {group.groupName}
                                    </h4>
                                  )}
                                  <div className="flex items-center justify-between gap-1.5 flex-wrap">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      {(v?.label || group.suitability) && (
                                        <div className={`${colorCls} uppercase tracking-wider text-[10px] font-bold px-2 py-0.5 rounded-md inline-block w-fit`}>
                                          {(v?.label || group.suitability).toUpperCase()}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                                 {/* Group Hero Image: Use first associated item crop/image, otherwise fallback to online search */}
                                <div className="w-full h-32 rounded-xl overflow-hidden bg-slate-100 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 shadow-sm relative shrink-0">
                                  {(() => {
                                    const firstItem = group.items?.[0];
                                    
                                    const resolvedMessageImages = messageImages;

                                    if (firstItem) {
                                      // Find matching scout item: prefer exact scoutIndex match over name heuristics
                                      const matchingScout = (resolvedScoutItems || []).find((s: any) => {
                                        if (scoutIndexAgrees(firstItem, s)) return true;
                                        return namesReferToSameFood(firstItem.name, s.keyword || s.originalName);
                                      });
                                      const imgIdx = typeof firstItem.sourceImageIndex === 'number' 
                                        ? firstItem.sourceImageIndex 
                                        : (matchingScout && typeof matchingScout.sourceImageIndex === 'number' ? matchingScout.sourceImageIndex : 0);
                                      const resolvedImgSrc = (resolvedMessageImages.length > 0)
                                        ? resolvedMessageImages[imgIdx >= 0 && imgIdx < resolvedMessageImages.length ? imgIdx : 0]
                                        : getFoodImageUrl(firstItem.name, '');
                                      const bb = firstItem.boundingBox2D || (matchingScout ? matchingScout.boundingBox2D : null);

                                      if (isValidBoundingBox(bb)) {
                                        const activeScoutIdx = activeScoutItems.findIndex((s: any) => s.keyword === (matchingScout?.keyword || firstItem.name));
                                        return (
                                          <CroppedFoodImage 
                                            src={resolvedImgSrc} 
                                            boundingBox={bb} 
                                            alt={firstItem.name} 
                                            className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform"
                                            imageUrls={resolvedMessageImages}
                                            sourceImageIndex={imgIdx}
                                            onTap={() => {
                                              if (activeScoutIdx !== -1) {
                                                setScoutPreviewIdx(activeScoutIdx);
                                              } else {
                                                setPreviewState({ groupIdx: idx, itemIdx: 0, resolvedImgSrc });
                                              }
                                            }}
                                          />
                                        );
                                      } else {
                                        return (
                                          <img 
                                            src={resolvedImgSrc} 
                                            alt={firstItem.name} 
                                            className="w-full h-full object-cover cursor-pointer hover:scale-105 transition-transform"
                                            onClick={() => {
                                              setPreviewState({ groupIdx: idx, itemIdx: 0, resolvedImgSrc });
                                            }}
                                            onError={(e) => { const t = e.target as HTMLImageElement; const fallback = getFoodImageUrl(firstItem?.name || firstItem?.keyword || 'food'); if (t.src !== fallback) t.src = fallback; }}
                                          />
                                        );
                                      }
                                    }
                                    
                                    // Fallback to stock online image if no visual is available
                                    return (
                                      <OnlineFoodImage 
                                        foodName={(group.items?.[0]?.name?.replace(/^\[.*?\]\s*/, '')) || group.groupName || "food"} 
                                        fallbackSrc={getFoodImageUrl(group.items?.[0]?.name?.replace(/^\[.*?\]\s*/, '') || "food")} 
                                        className="w-full h-full object-cover"
                                        searchMode="light"
                                      />
                                    );
                                  })()}
                                </div>
                                
                                                                 {/* Top Nutrients for Mode D */}
                                {group.averageNutrients && Object.keys(group.averageNutrients).length > 0 && (
                                  <div className="py-2 border-t border-theme-border mt-2">
                                    <div className="flex flex-wrap gap-2 justify-start pb-2">
                                      {(() => {
                                        const defaultTargets: { [key: string]: number } = { calories: 2000, saturatedFat: 15, sodium: 1200, addedSugar: 30, totalFat: 65, protein: 50, carbohydrates: 250, totalFibre: 30 };
                                        const nutrientColors: { [key: string]: string } = { calories: 'rgb(249, 115, 22)', saturatedFat: 'rgb(234, 179, 8)', sodium: 'rgb(34, 197, 94)', addedSugar: 'rgb(239, 68, 68)', totalFat: 'rgb(168, 85, 247)', protein: 'rgb(59, 130, 246)', carbohydrates: 'rgb(6, 182, 212)', totalFibre: 'rgb(16, 185, 129)' };
                                        const nutrientLabels: { [key: string]: string } = { calories: 'Calories', saturatedFat: 'Sat Fat', sodium: 'Sodium', addedSugar: 'Added Sugar', totalFat: 'Total Fat', protein: 'Protein', carbohydrates: 'Carbs', totalFibre: 'Fiber' };
                                        const nutrientUnits: { [key: string]: string } = { calories: 'kcal', saturatedFat: 'g', sodium: 'mg', addedSugar: 'g', totalFat: 'g', protein: 'g', carbohydrates: 'g', totalFibre: 'g' };
                                        const formatNutrientValue = (v: number, u: string) => {
                                          if (v === null || v === undefined || isNaN(v)) return `—${u}`;
                                          const cleanV = cleanNutrientVal(v);
                                          const abs = Math.abs(cleanV);
                                          if (abs >= 1000) return `${(cleanV / 1000).toFixed(2)}k${u}`;
                                          if (abs >= 100) return `${Math.round(cleanV)}${u}`;
                                          if (abs >= 10) return `${cleanV.toFixed(1)}${u}`;
                                          return `${cleanV.toFixed(2)}${u}`;
                                        };
                                        
                                        // Respect report topNutrientTargets or profile topNutrientsToMonitor
                                        const rawReportTargets = (report as any)?.topNutrientTargets || (report as any)?.nutrientTargets;
                                        const reportKeys = Array.isArray(rawReportTargets) && rawReportTargets.length > 0
                                          ? rawReportTargets.map((item: any) => typeof item === 'string' ? item : (item?.nutrientKey || item?.key || '')).filter(Boolean)
                                          : null;
                                        const activeKeys = reportKeys || profile?.topNutrientsToMonitor || ['calories', 'saturatedFat', 'sodium'];
                                        const keysToRender = activeKeys.filter(k => {
                                          if (!group.averageNutrients) return false;
                                          if (group.averageNutrients[k] !== undefined && group.averageNutrients[k] !== null) return true;
                                          const lower = String(k).toLowerCase().replace(/[^a-z0-9]/g, '');
                                          return Object.keys(group.averageNutrients).some(gk => gk.toLowerCase().replace(/[^a-z0-9]/g, '') === lower);
                                        });

                                        const sortedKeysToRender = [...keysToRender].sort((a, b) => {
                                          const parseT = (k: string) => {
                                            const rVal = (report as any)?.dailyNutrientTargets?.[k as any];
                                            if (rVal) {
                                              const m = String(rVal).replace(/,/g, '').match(/\d+(\.\d+)?/);
                                              if (m) return parseFloat(m[0]);
                                            }
                                            return profile?.targets?.[k as any] ?? defaultTargets[k] ?? 1000;
                                          };
                                          const targetA = parseT(a);
                                          const targetB = parseT(b);
                                          const valA = Number(group.averageNutrients?.[a]) || 0;
                                          const valB = Number(group.averageNutrients?.[b]) || 0;
                                          const pctA = targetA > 0 ? (valA / targetA) : 0;
                                          const pctB = targetB > 0 ? (valB / targetB) : 0;
                                          return pctB - pctA;
                                        });

                                        return sortedKeysToRender.map(key => {
                                          let val = group.averageNutrients[key];
                                          let parsedVal = typeof val === 'string' ? parseFloat(val.replace(/[^\d.]/g, '')) : val;
                                          if (isNaN(parsedVal)) return null;
                                          
                                          // Fallback for past messages where agent might have output 0 because of localized keys (e.g. Lemak Jenuh)
                                          if (parsedVal === 0 && group.scoutItemIndices && group.scoutItemIndices.length === 1) {
                                            const scoutItem = activeScoutItems[group.scoutItemIndices[0]];
                                            if (scoutItem && scoutItem.rawNutritionLabel) {
                                              const rawK = Object.keys(scoutItem.rawNutritionLabel).find(k => 
                                                k.toLowerCase().includes(key.toLowerCase()) || 
                                                (key === 'addedSugar' && (k.toLowerCase().includes('sugar') || k.toLowerCase().includes('gula'))) ||
                                                (key === 'totalFibre' && (k.toLowerCase().includes('fiber') || k.toLowerCase().includes('fibre') || k.toLowerCase().includes('serat'))) ||
                                                (key === 'saturatedFat' && (k.toLowerCase().includes('sat') || k.toLowerCase().includes('jenuh'))) ||
                                                (key === 'sodium' && (k.toLowerCase().includes('garam') || k.toLowerCase().includes('natrium')))
                                              );
                                              if (rawK) {
                                                const isCalKey = rawK.toLowerCase().includes('calories') || rawK.toLowerCase().includes('energy');
                                                let extractedVal = null;
                                                if (isCalKey) {
                                                  extractedVal = parseLabelCalories(scoutItem.rawNutritionLabel[rawK]);
                                                } else {
                                                  const match = String(scoutItem.rawNutritionLabel[rawK]).match(/[\d.]+/);
                                                  if (match) extractedVal = parseFloat(match[0]);
                                                }
                                                if (extractedVal !== null) {
                                                  let multiplier = 1;
                                                  const estimatedWeight = scoutItem.estimatedWeightGrams || 100;
                                                  if (scoutItem.rawNutritionLabel.servingSize || scoutItem.rawNutritionLabel.takaranSaji) {
                                                    const ssMatch = String(scoutItem.rawNutritionLabel.servingSize || scoutItem.rawNutritionLabel.takaranSaji).match(/[\d.]+/);
                                                    if (ssMatch) multiplier = estimatedWeight / parseFloat(ssMatch[0]);
                                                    else multiplier = estimatedWeight / 100;
                                                  } else {
                                                    multiplier = estimatedWeight / 100;
                                                  }
                                                  parsedVal = extractedVal * multiplier;
                                                }
                                              }
                                            }
                                          }
                                          
                                          // group.averageNutrients already holds the group's real/average total
                                          // nutrient values (not a per-100g figure) — no weight-based scaling here.
                                          const totalVal = parsedVal;
                                          if (isNaN(totalVal) || totalVal <= 0 || Number(totalVal.toFixed(2)) <= 0) return null;
                                          
                                          const color = getNutrientColor(key);
                                          const label = nutrientLabels[key] || (key.replace(/([A-Z])/g, ' $1').trim());
                                          const unit = nutrientUnits[key] || 'g';

                                          return (
                                            <div key={key} className="flex items-center gap-1.5">
                                              <NutrientPieChart
                                                allowance={profile?.targets?.[key as any] ?? defaultTargets[key]}
                                                alreadyConsumed={0}
                                                mealValue={totalVal}
                                                nutrientKey={key as any}
                                                size="sm"
                                              />
                                              <span className={key === 'calories' ? "text-[11px] font-extrabold" : "text-[11px] font-bold"} style={{ color }}>
                                                {key === 'calories' ? '' : `${label}: `}{formatNutrientValue(totalVal, unit)}
                                              </span>
                                            </div>
                                          );
                                        });
                                      })()}
                                    </div>
                                  </div>
                                )}

                                {(() => {
                                  let groupScoutItems = (group.scoutItemIndices && group.scoutItemIndices.length > 0)
                                    ? group.scoutItemIndices.map((i: number) => displayedScoutItems.find((d: any) => d.scoutIndex === i) || displayedScoutItems[i] || activeScoutItems[i]).filter(Boolean)
                                    : [];
                                  
                                  if (groupScoutItems.length === 0 && group.items && group.items.length > 0) {
                                    groupScoutItems = displayedScoutItems.filter((s: any) => {
                                      return group.items.some((gi: any) => 
                                        gi.name === s.keyword || 
                                        gi.name === s.originalName ||
                                        (gi.name && s.keyword && gi.name.toLowerCase().includes(s.keyword.toLowerCase()))
                                      );
                                    });
                                  }
                                    
                                  if (groupScoutItems.length > 0) {
                                    return <NutritionLabelTable defaultOpen={false} activeScoutItems={groupScoutItems} isSaved={isAlreadyLogged} onConfirmItem={(idx) => setConfirmedScoutIndices(prev => new Set(prev).add(idx))} />;
                                  }

                                  return null;
                                })()}
                                
                                {/* Recommendation */}
                                <div className="space-y-1.5 pt-1">
                                  {(group.message || group.recommendation) && (
                                    <p className="text-[13px] text-theme-neutral leading-snug">
                                      {group.message || group.recommendation}
                                    </p>
                                  )}
                                </div>
                                                         {/* Items in this bucket */}
                                 {(group.items && group.items.length > 1) && (
                                   <div className="pt-2 border-t border-theme-border/50">
                                     {(() => {
                                       const scoutType = (msg.data?.scoutContentType || '').toLowerCase();
                                     const isMenuOrPoster = scoutType === 'text' || scoutType === 'menu_or_poster';
                                     const isVisualOrPosted = scoutType === 'visual_or_posted';
                                     
                                     const resolvedMessageImages = messageImages;
                                     // 1. Precompute groupPreviewItems
                                     const groupPreviewItems = (group.items || []).map((item: any) => {
                                       const matchingScout = (resolvedScoutItems || []).find((s: any) => {
                                         if (scoutIndexAgrees(item, s)) return true;
                                         return namesReferToSameFood(item.name, s.keyword || s.originalName);
                                       });
                                       const imgIdx = typeof item.sourceImageIndex === 'number' 
                                         ? item.sourceImageIndex 
                                         : (matchingScout && typeof matchingScout.sourceImageIndex === 'number' ? matchingScout.sourceImageIndex : 0);
                                       const resolvedImgSrc = (resolvedMessageImages.length > 0)
                                         ? resolvedMessageImages[imgIdx >= 0 && imgIdx < resolvedMessageImages.length ? imgIdx : 0]
                                         : getFoodImageUrl(item.name, '');
                                       const bb = previewState?.overrideSrc ? null : (item.boundingBox2D || (matchingScout ? matchingScout.boundingBox2D : null));
                                       return { src: resolvedImgSrc, boundingBox: bb, foodName: item.name, imgIdx };
                                     });
                                     // 2. Compute indices of text-only items (force for menu contentType or aspect ratio > 2.2 or height < 20, unless visual_or_posted)
                                     const textOnlyIndices = (group.items || []).map((item: any, itemIdx: number) => {
                                       const bb = groupPreviewItems[itemIdx]?.boundingBox;
                                       const height = bb ? Math.abs(bb[2] - bb[0]) : 0;
                                       const width = bb ? Math.abs(bb[3] - bb[1]) : 0;
                                       const aspect = height > 0 ? width / height : 0;
                                       const isTextOnly = !isVisualOrPosted && (isMenuOrPoster || !bb || bb.length < 4 || aspect > 2.2 || height < 20);
                                       return isTextOnly ? itemIdx : -1;
                                     }).filter(index => index !== -1);
                                      const hasTextOnlyItems = textOnlyIndices.length > 0;
                                      const hasDishesImages = !isMenuOrPoster && groupPreviewItems.some(i => i.boundingBox && i.boundingBox.length === 4);
                                      const groupKey = `${msg.id}-${idx}`;
                                      const hasAnyMenuImage = (group.items || []).some((_, i) => {
                                        const k = `${msg.id}-${idx}-${i}`;
                                        return showMenuImages[k] || !!onlineImageUrls[k];
                                      });
                                      const isGridExpanded = hasDishesImages || showMenuImages[groupKey] || hasAnyMenuImage || isVisualOrPosted;
                                      const isSearchActive = !!searchModes[groupKey];
                                     const resultsForGroup = searchResults[groupKey] || [];
                                     const isLoadingForGroup = !!searchLoading[groupKey];
                                     const searchedItemIdx = searchedItemIndices[groupKey];
                                     const hasTranslations = (group.items || []).some(
                                       (item: any) => item.originalName && item.originalName.trim().length > 0 && item.originalName.toLowerCase() !== (item.keyword || item.name || "").toLowerCase()
                                     );
                                     return (
                                       <>
                                         {/* Label area with Search selector trigger next to it */}
                                         <div className="text-[10.5px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between w-full font-sans">
                                           <span>{isSelectingMode ? "Choose food to compare" : "Foods in this group"} ({group.items?.length || 0})</span>
                                           <div className="flex items-center gap-1.5">

                                             {hasTranslations && (
                                               <button
                                                 type="button"
                                                 onClick={() => setShowTranslations(prev => ({ ...prev, [groupKey]: !prev[groupKey] }))}
                                                 className={`p-1 hover:bg-slate-100 dark:hover:bg-slate-850 rounded-md transition-all cursor-pointer ${
                                                   showTranslations[groupKey] ? 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40' : 'text-slate-400'
                                                 }`}
                                                 title="Toggle Language"
                                               >
                                                 <span className="text-[10px] font-bold leading-none block px-0.5 py-[1px]">{showTranslations[groupKey] ? "English" : "Local"}</span>
                                               </button>
                                             )}

                                              <button
                                                type="button"
                                               onClick={() => {
                                                 if (!isSelectingMode && props.onEnterSelectingMode) props.onEnterSelectingMode();
                                                 setIsSelectingMode(!isSelectingMode);
                                                 setSelectedItemKeys([]);
                                                 setSelectorError("");
                                                 // Deactivate standard single-search CSE if running
                                                 setSearchModes(prev => {
                                                   const next = { ...prev };
                                                   Object.keys(next).forEach(k => {
                                                     if (k.startsWith(`${groupKey}-`)) next[k] = false;
                                                   });
                                                   return next;
                                                 });
                                               }}
                                               className={`p-1 hover:bg-slate-100 dark:hover:bg-slate-850 rounded-md transition-all cursor-pointer ${
                                                 isSelectingMode ? 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40' : 'text-slate-400'
                                               }`}
                                               title={isSelectingMode ? "Exit selection mode" : "Multi-select items for search or comparison"}
                                             >
                                               {isSelectingMode ? <X className="w-3.5 h-3.5 stroke-[2.5px]" /> : <Search className="w-3.5 h-3.5 stroke-[2.5px]" />}
                                             </button>
                                           </div>
                                         </div>
                                         {/* Collapsible container using the GroupItemsContainer */}
                                         <GroupItemsContainer
                                           groupKey={groupKey}
                                           isExpanded={!!groupExpanded[groupKey]}
                                           onToggle={() => setGroupExpanded(prev => ({ ...prev, [groupKey]: !prev[groupKey] }))}
                                         >
                                           {/* Search results moved to group level to take full width */}
                                            <div className="w-full flex flex-col gap-4">
                                              {(() => {
                                                const categorizedItems = (group.items || []).reduce((acc: any, item: any, itemIdx: number) => {
                                                  let category = "Uncategorized";
                                                  let rawName = item.name || "";
                                                  const match = rawName.match(/^\[(.*?)\]\s*(.*)$/);
                                                  if (match) {
                                                    category = match[1];
                                                  }
                                                  if (!acc[category]) acc[category] = [];
                                                  acc[category].push({ item, itemIdx });
                                                  return acc;
                                                }, {} as Record<string, {item: any, itemIdx: number}[]>);

                                                return Object.entries(categorizedItems).map(([category, itemsArr]: [string, {item: any, itemIdx: number}[]], catIdx) => (
                                                  <div key={catIdx} className="w-full flex flex-col gap-2">
                                                    {category !== "Uncategorized" && (
                                                      <div className="text-[11px] font-bold text-slate-500 uppercase tracking-wide border-b border-theme-border/50 pb-1 mt-1">
                                                        {category}
                                                      </div>
                                                    )}
                                                    <div className={isGridExpanded ? "grid grid-cols-3 sm:grid-cols-4 gap-3 w-full" : "grid grid-cols-2 gap-2 w-full"}>
                                                      {itemsArr.map(({item, itemIdx}) => {
                                                        const { src: resolvedImgSrc, boundingBox: bb, imgIdx } = groupPreviewItems[itemIdx];
                                                        const isTextOnly = textOnlyIndices.includes(itemIdx);
                                                        const itemKey = `${idx}-${itemIdx}`;
                                                        const fullItemKey = `${msg.id}-${idx}-${itemIdx}`;
                                                        const isSelected = selectedItemKeys.includes(itemKey);
                                                        let itemDisplayName = showTranslations[groupKey] ? (item.keyword || item.name) : (item.originalName || item.name);
                                                        itemDisplayName = itemDisplayName.replace(/^\[.*?\]\s*/, '');

                                                        const itemKeyForCache = `${msg.id}-${idx}-${itemIdx}`;
                                                        const shouldShowAsPreview = !isTextOnly || showMenuImages[groupKey] || showMenuImages[itemKeyForCache] || !!onlineImageUrls[itemKeyForCache] || isVisualOrPosted;
                                                        const finalSrc = onlineImageUrls[itemKeyForCache] || resolvedImgSrc;

                                                        const hasBeenSearched = !!onlineImageUrls[itemKeyForCache] || (searchResults[fullItemKey] && searchResults[fullItemKey].length > 0);

                                                        const chipOnClick = (fetchedUrl?: string) => {
                                                          if (isSelectingMode) {
                                                            setSelectedItemKeys(prev => 
                                                              prev.includes(itemKey) 
                                                                ? prev.filter(k => k !== itemKey) 
                                                                : [...prev, itemKey]
                                                            );
                                                          } else {
                                                            if (searchResults[fullItemKey] && searchResults[fullItemKey].length > 0) {
                                                              setSearchModes(prev => ({...prev, [fullItemKey]: !prev[fullItemKey]}));
                                                            } else {
                                                              setPreviewState({ groupIdx: idx, itemIdx: itemIdx, resolvedImgSrc, overrideSrc: fetchedUrl && typeof fetchedUrl === 'string' ? fetchedUrl : undefined });
                                                            }
                                                          }
                                                        };

                                                        const itemClinicalThreat = (() => {
                                                          if (!group.itemClinicalThreats) return undefined;
                                                          const matchingScoutIdx = activeScoutItems.findIndex((s: any) => 
                                                            (item.name || "").toLowerCase().includes((s.keyword || "").toLowerCase()) || 
                                                            (s.keyword || "").toLowerCase().includes((item.name || "").toLowerCase()) ||
                                                            (item.name || "").toLowerCase().split(' ')[0] === (s.keyword || "").toLowerCase().split(' ')[0]
                                                          );
                                                          if (matchingScoutIdx !== -1 && group.itemClinicalThreats[matchingScoutIdx] !== undefined) {
                                                            return group.itemClinicalThreats[matchingScoutIdx];
                                                          }
                                                          if (group.itemClinicalThreats[itemIdx] !== undefined) {
                                                            return group.itemClinicalThreats[itemIdx];
                                                          }
                                                          if (group.itemClinicalThreats[item.name] !== undefined) {
                                                            return group.itemClinicalThreats[item.name];
                                                          }
                                                          if (group.itemClinicalThreats[itemDisplayName] !== undefined) {
                                                            return group.itemClinicalThreats[itemDisplayName];
                                                          }
                                                          if (matchingScoutIdx !== -1 && group.itemClinicalThreats[String(matchingScoutIdx)] !== undefined) {
                                                            return group.itemClinicalThreats[String(matchingScoutIdx)];
                                                          }
                                                          if (group.itemClinicalThreats[String(itemIdx)] !== undefined) {
                                                            return group.itemClinicalThreats[String(itemIdx)];
                                                          }
                                                          return undefined;
                                                        })();

                                                        const threatBadge = (() => {
                                                          if (!itemClinicalThreat) return null;
                                                          const t = String(itemClinicalThreat).toLowerCase();
                                                          let bg = "bg-rose-50 dark:bg-rose-950/25 border border-rose-200/30";
                                                          let text = "text-rose-700 dark:text-rose-400";
                                                          let icon = "⚠️";
                                                          if (t.includes('safe') || t.includes('no threat') || t.includes('healthy') || t.includes('none')) {
                                                            bg = "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/30";
                                                            text = "text-emerald-700 dark:text-emerald-400";
                                                            icon = "✓";
                                                          } else if (t.includes('caution') || t.includes('moderate') || t.includes('medium')) {
                                                            bg = "bg-amber-50 dark:bg-amber-950/20 border border-amber-200/30";
                                                            text = "text-amber-700 dark:text-amber-400";
                                                            icon = "⚠️";
                                                          }
                                                          return { bg, text, icon };
                                                        })();

                                                        const chipContent = !shouldShowAsPreview ? (
                                                          <div 
                                                            className={`flex flex-col justify-center p-2 rounded-xl border cursor-pointer shadow-sm transition-all duration-200 text-left min-h-[48px] px-3 w-full ${
                                                              isSelected 
                                                                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 ring-2 ring-indigo-500/50 shadow-md font-bold scale-[1.02]' 
                                                                : isSelectingMode 
                                                                  ? 'border-theme-border bg-slate-50/20 dark:bg-slate-900/10 hover:border-indigo-400 hover:bg-indigo-50/20 hover:scale-[1.01]' 
                                                                  : 'border-slate-200/60 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/40 hover:border-indigo-500/50 hover:bg-indigo-500/5 dark:hover:bg-indigo-500/10 hover:shadow'
                                                            }`}
                                                            onClick={() => chipOnClick()}
                                                          >
                                                            <div className="flex flex-col gap-1 w-full">
                                                              <span className={`text-[10.5px] lowercase font-semibold leading-tight break-words text-left ${isSelected ? 'text-indigo-700 dark:text-indigo-300 font-bold' : 'text-theme-neutral'}`}>
                                                                {itemDisplayName}
                                                                {(item.confidenceRating === 'Low' || item.confidenceRating === 'Medium') && (
                                                                  <span className="block text-[9px] font-medium text-amber-600 dark:text-amber-400 mt-1 italic">
                                                                    Low confidence: Please provide new picture or description.
                                                                  </span>
                                                                )}
                                                              </span>
                                                              {itemClinicalThreat && threatBadge && (
                                                                <div className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold inline-block w-fit max-w-full truncate ${threatBadge.bg} ${threatBadge.text}`} title={itemClinicalThreat}>
                                                                  {threatBadge.icon} {itemClinicalThreat}
                                                                </div>
                                                              )}
                                                            </div>
                                                          </div>
                                                        ) : (
                                                          <FoodScoutItemPreview
                                                            name={itemDisplayName}
                                                            src={finalSrc}
                                                            boundingBox={bb}
                                                            imgIdx={imgIdx}
                                                            messageImages={resolvedMessageImages}
                                                            isActive={isSelected}
                                                            isSearchMode={isSelectingMode}
                                                            searchMode="complete"
                                                            onClick={() => chipOnClick(onlineImageUrls[itemKeyForCache])}
                                                            prefetchedSrc={onlineImageUrls[itemKeyForCache]}
                                                            clinicalThreat={itemClinicalThreat}
                                                          />
                                                        );

                                                        const isActiveItem = searchModes[fullItemKey];
                                                        const itemResults = searchResults[fullItemKey] || [];
                                                        const itemLoading = !!searchLoading[fullItemKey];

                                                        return (
                                                          <React.Fragment key={itemIdx}>
                                                            <div className={`relative flex flex-col gap-2 w-full ${hasBeenSearched && isGridExpanded ? 'col-span-2' : 'col-span-1'}`}>
                                                                {chipContent}
                                                                {!!searchResults[fullItemKey] && (
                                                                    <button 
                                                                      onClick={(e) => { e.stopPropagation(); setPreviewState({ groupIdx: idx, itemIdx: itemIdx, resolvedImgSrc }); }}
                                                                      className="absolute -top-1.5 -right-1.5 p-1 bg-slate-900/80 text-white rounded-full transition-colors z-10 shadow-sm"
                                                                      title="View original photo"
                                                                    >
                                                                      <Eye className="w-3 h-3" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                            
                                                            {isActiveItem && (
                                                              <div className="col-span-full w-full basis-full mt-3 mb-5 border border-indigo-100 dark:border-indigo-900/40 rounded-xl p-3 bg-white/50 dark:bg-slate-900/50 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300 font-sans">
                                                                {itemLoading ? (
                                                                  <div className="text-[10px] text-indigo-500 animate-pulse text-center py-2">{t.searchingImages}</div>
                                                                ) : itemResults.length > 0 ? (
                                                                  <div className="flex flex-col">
                                                                    <div className="flex justify-between items-center mb-2 px-1">
                                                                      <div className="text-[10px] font-medium text-slate-500">{t.imageResults}</div>
                                                                      <button 
                                                                        onClick={(e) => { e.stopPropagation(); setSearchResults(prev => ({...prev, [fullItemKey]: []})); setSearchModes(prev => ({...prev, [fullItemKey]: false})); }}
                                                                        className="p-1 bg-slate-100 dark:bg-slate-800 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-50 transition-colors"
                                                                      >
                                                                        <Trash2 className="w-3.5 h-3.5" />
                                                                      </button>
                                                                    </div>
                                                                    <div className="grid grid-cols-2 gap-2">
                                                                      {itemResults.map((res: any, sIdx: number) => {
                                                                        if (brokenSearchImages[`${fullItemKey}-${sIdx}`]) return null;
                                                                        return (
                                                                          <div 
                                                                            key={sIdx} 
                                                                            className="w-full rounded-md overflow-hidden border border-theme-border cursor-pointer hover:opacity-90 hover:ring-1 hover:ring-indigo-400 transition-all bg-black/5 flex flex-col"
                                                                            onClick={() => setSearchPreview({ groupKey: fullItemKey, index: sIdx })}
                                                                          >
                                                                            <div className="h-24 sm:h-32 w-full flex-shrink-0">
                                                                              <img 
                                                                                src={res.imageUrl} 
                                                                                alt={res.title} 
                                                                                className="w-full h-full object-cover" 
                                                                                onError={() => setBrokenSearchImages(prev => ({ ...prev, [`${fullItemKey}-${sIdx}`]: true }))}
                                                                              />
                                                                            </div>
                                                                            <div className="p-1 bg-slate-50 dark:bg-slate-900 text-[9px] truncate text-slate-500 text-center flex-grow flex items-center justify-center">{res.title}</div>
                                                                          </div>
                                                                        );
                                                                      })}
                                                                    </div>
                                                                  </div>
                                                                ) : (
                                                                  <div className="flex flex-col items-center justify-center py-4 gap-2 text-center text-theme-text-secondary">
                                                                    <Search className="w-5 h-5 text-slate-300 dark:text-slate-600" />
                                                                    <span className="text-[11px] font-semibold text-theme-text-secondary">{t.noImagesFound}</span>
                                                                    <span className="text-[9.5px] text-slate-400 max-w-[200px]">
                                                                      No web images could be retrieved for "{itemDisplayName}".
                                                                    </span>
                                                                  </div>
                                                                )}
                                                              </div>
                                                            )}
                                                          </React.Fragment>
                                                        );
                                                      })}
                                                    </div>
                                                  </div>
                                                ));
                                              })()}
                                            </div>

                                            <div className="pb-8" />
                                         </GroupItemsContainer>
                                       </>
                                     );
                                   })()}
                                 </div>
                                )}

                                {onLogFood && (
                                  <div className="pt-3 border-t border-theme-border/40 flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (isLoggingRef.current) return;
                                        isLoggingRef.current = true;
                                        const foodToLog = {
                                          name: group.groupName || 'Comparison Option',
                                          title: group.groupName || 'Comparison Option',
                                          items: group.items || [],
                                          itemsBreakdown: group.items || [],
                                          nutrients: group.averageNutrients || {},
                                          message: group.message || group.recommendation || '',
                                          healthImpact: group.recommendation || group.message || '',
                                          verdict: group.verdict || (v?.label ? { label: v.label, level: v.level } : undefined),
                                          source: 'food_compare',
                                          imageUrls: messageImages || [],
                                          date: new Date().toISOString(),
                                        };
                                        const logResult = onLogFood(foodToLog as any);
                                        setLoggedMessageIds?.(prev => [...prev, `${msg.id}-opt-${idx}`]);
                                        Promise.resolve(logResult).finally(() => {
                                          isLoggingRef.current = false;
                                        });
                                      }}
                                      disabled={isAlreadyLogged || (loggedMessageIds && loggedMessageIds.includes(`${msg.id}-opt-${idx}`))}
                                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer ${
                                        (isAlreadyLogged || (loggedMessageIds && loggedMessageIds.includes(`${msg.id}-opt-${idx}`)))
                                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                                          : 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-95'
                                      }`}
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                      <span>
                                        {(isAlreadyLogged || (loggedMessageIds && loggedMessageIds.includes(`${msg.id}-opt-${idx}`)))
                                          ? t.savedToLog || 'Logged'
                                          : 'Log Option'}
                                      </span>
                                    </button>
                                  </div>
                                )}

                              </div>
                            </React.Fragment>

                          );
                        })}
                      </div>
                    </div>
                  )}

      {/* Single-zoom modal overlays with navigation chevrons and floating titles */}
      {(() => {
        if (!previewState) return null;
        const group = displayGroups[previewState.groupIdx];
        if (!group) return null;
        const item = group.items?.[previewState.itemIdx];
        if (!item) return null;
        const resolvedMessageImages = messageImages;
        // Resolve its image source and bounding box: prefer exact scoutIndex match over name heuristics
        const matchingScout = (resolvedScoutItems || []).find((s: any) => {
          if (scoutIndexAgrees(item, s)) return true;
          return namesReferToSameFood(item.name, s.keyword || s.originalName);
        });
        const imgIdx = typeof item.sourceImageIndex === 'number' 
          ? item.sourceImageIndex 
          : (matchingScout && typeof matchingScout.sourceImageIndex === 'number' ? matchingScout.sourceImageIndex : 0);
        const itemKeyForCache = `${msg.id}-${previewState.groupIdx}-${previewState.itemIdx}`;
        let resolvedImgSrc = onlineImageUrls[itemKeyForCache] || ((resolvedMessageImages.length > 0)
          ? resolvedMessageImages[imgIdx >= 0 && imgIdx < resolvedMessageImages.length ? imgIdx : 0]
          : getFoodImageUrl(item.name, ''));
        
        if (previewState.resolvedImgSrc && previewState.itemIdx === 0) {
          resolvedImgSrc = previewState.resolvedImgSrc;
        }
        if (previewState.overrideSrc) {
          resolvedImgSrc = previewState.overrideSrc;
        }
        const hasLookedUpImage = !!(onlineImageUrls[itemKeyForCache] || previewState.overrideSrc);
        const bb = hasLookedUpImage ? null : (item.boundingBox2D || (matchingScout ? matchingScout.boundingBox2D : null));
        const groupKey = `${msg.id}-${previewState.groupIdx}`;
        const itemDisplayName = showTranslations[groupKey] ? (item.keyword || item.name) : (item.originalName || item.name);
        return (
          <ZoomableImage 
            src={resolvedImgSrc} 
            boundingBox={bb}
            onClose={() => setPreviewState(null)}
            foodName={itemDisplayName}
            hasNext={previewState.itemIdx < group.items.length - 1}
            hasPrev={previewState.itemIdx > 0}
            onNext={() => setPreviewState(prev => prev ? { ...prev, itemIdx: prev.itemIdx + 1, resolvedImgSrc: undefined, overrideSrc: undefined } : null)}
            onPrev={() => setPreviewState(prev => prev ? { ...prev, itemIdx: prev.itemIdx - 1, resolvedImgSrc: undefined, overrideSrc: undefined } : null)}
          />
        );
      })()}
      {(() => {
        if (scoutPreviewIdx === null) return null;
        
        const scoutList = (displayedScoutItems && displayedScoutItems.length > 0) ? displayedScoutItems : activeScoutItems;
        const item = scoutList[scoutPreviewIdx];
        if (!item) return null;
        const imgIdx = typeof item.sourceImageIndex === 'number' ? item.sourceImageIndex : 0;
        const resolvedImgSrc = resolveHistoricalImgSrc(item, messageImages, foodLogs || [], imgIdx);
        const bb = item.boundingBox2D || item.boundingBox || null;
        return (
          <ZoomableImage 
            src={resolvedImgSrc} 
            boundingBox={bb}
            onClose={() => setScoutPreviewIdx(null)}
            foodName={showTranslations.scout ? (item.keyword || item.originalName || item.name) : (item.originalName || item.keyword || item.name)}
            hasNext={scoutPreviewIdx < scoutList.length - 1}
            hasPrev={scoutPreviewIdx > 0}
            onNext={() => setScoutPreviewIdx(prev => prev !== null ? prev + 1 : null)}
            onPrev={() => setScoutPreviewIdx(prev => prev !== null ? prev - 1 : null)}
          />
        );
      })()}
      {externalPreviewImg && (
        <ZoomableImage 
          src={externalPreviewImg.url} 
          boundingBox={undefined}
          onClose={() => setExternalPreviewImg(null)}
          foodName={externalPreviewImg.title}
        />
      )}
      {searchPreview && (() => {
        const results = searchResults[searchPreview.groupKey] || [];
        const validResults = results.map((res, i) => ({ ...res, index: i })).filter((_, i) => !brokenSearchImages[`${searchPreview.groupKey}-${i}`]);
        if (validResults.length === 0) return null;
        const currentValidIdx = validResults.findIndex(r => r.index === searchPreview.index);
        if (currentValidIdx === -1) return null;
        
        return (
          <ZoomableImage
            src={validResults[currentValidIdx].imageUrl}
            onClose={() => setSearchPreview(null)}
            foodName={validResults[currentValidIdx].title}
            sourceUrl={validResults[currentValidIdx].pageUrl}
            hasNext={currentValidIdx < validResults.length - 1}
            hasPrev={currentValidIdx > 0}
            onNext={() => setSearchPreview({ groupKey: searchPreview.groupKey, index: validResults[currentValidIdx + 1].index })}
            onPrev={() => setSearchPreview({ groupKey: searchPreview.groupKey, index: validResults[currentValidIdx - 1].index })}
          />
        );
      })()}

      {/* Case F: Food Origin & Details experiential encyclopedia card renderer */}


                  {msg.data?.pendingFoodLog && !(mode === 'evaluation' && comparisonData && comparisonData.groups && comparisonData.groups.length > 0) && (
                    <div className="bg-transparent border-0 rounded-none p-0 shadow-none space-y-3 animation-fade-in w-full max-w-full min-w-0 overflow-hidden font-sans">
                      {/* Flag incorrect / missing-link backlog entry */}
                      <FoodResultFlagButton
                        pendingFoodLog={msg.data.pendingFoodLog}
                        msg={msg}
                        profile={profile}
                      />
                      {(() => {
                        const sentence = (msg.data?.pendingFoodLog.dietitianUpdateSentence || '').trim();
                        const mainMsg = (msg.content || msg.data?.agentResult?.message || '').trim();
                        if (!sentence) return null;
                        // Deduplicate: if the update sentence is identical or already fully contained in the main message, skip the duplicate bubble
                        if (mainMsg && (mainMsg === sentence || mainMsg.includes(sentence) || sentence.includes(mainMsg))) {
                          return null;
                        }
                        return (
                          <div className="bg-indigo-50/70 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/50 rounded-xl p-3 text-left font-sans text-xs text-indigo-800 dark:text-indigo-300 mb-2 flex items-start gap-2">
                            <span className="text-sm">💬</span>
                            <div className="flex-1">
                              <span className="font-bold text-indigo-900 dark:text-indigo-200 block mb-0.5">{t.dietitianUpdate}</span>
                              <span className="leading-relaxed whitespace-pre-line">{sentence}</span>
                            </div>
                          </div>
                        );
                      })()}
                      {msg.data.correctionOf && (
                         <div className="flex justify-center pb-2">
                           <button 
                             onClick={() => {
                               window.scrollTo({ top: 0, behavior: 'smooth' });
                             }}
                             className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-3 py-1.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-all flex items-center gap-1.5"
                           >
                             <ChevronUp className="w-3 h-3" />
                             Scroll to top
                           </button>
                         </div>
                      )}
                      {(() => {
                        const displayImgs = (msg.data?.pendingFoodLog?.imageUrls && msg.data.pendingFoodLog.imageUrls.length > 0)
                          ? msg.data.pendingFoodLog.imageUrls
                          : messageImages;
                        if (!displayImgs || displayImgs.length === 0) return null;
                        return (
                          <div className="overflow-hidden border-y sm:border border-slate-100 dark:border-slate-700/50 shadow-sm mb-3 w-[calc(100%+2rem)] -mx-4 sm:mx-0 sm:w-full sm:rounded-2xl">
                            <ImageSlider images={displayImgs} altText={msg.data?.pendingFoodLog?.name || "Pending meal"} />
                          </div>
                        );
                      })()}
                      


                      {(() => {
                        const scoutType = (msg.data?.scoutContentType || '').toLowerCase();
                        const isMenuOrPoster = scoutType === 'text' || scoutType === 'menu_or_poster';
                        const isVisualOrPosted = scoutType === 'visual_or_posted';
                        const displayAsMenu = isMenuOrPoster && !isVisualOrPosted;

                        if (displayedScoutItems.length === 0) return null;
                        return (
                          <div className="mb-6 text-left">
                            <div className="flex items-center justify-between mb-3 border-b border-theme-border/50 pb-2 font-sans">
                              <div className="flex items-center gap-2">
                                <span className="text-[10.5px] font-bold text-indigo-500 dark:text-indigo-400">
                                  🔍 Meal composition
                                </span>
                                {displayedScoutItems.some((i: any) => i.originalName && i.originalName.toLowerCase() !== (i.keyword || "").toLowerCase()) && (
                                 <button
                                   type="button"
                                   onClick={() => setShowTranslations(prev => ({ ...prev, scout: !prev.scout }))}
                                   className={`p-0.5 hover:bg-slate-100 dark:hover:bg-slate-850 rounded-md transition-all cursor-pointer ${
                                     showTranslations.scout ? 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40' : 'text-slate-400'
                                   }`}
                                   title="Toggle Language"
                                 >
                                   <span className="text-[9px] font-bold leading-none block px-0.5 py-[1px]">{showTranslations.scout ? "English" : "Local"}</span>
                                 </button>
                                )}
                              </div>
                             {msg.data?.pendingFoodLog?.scoutConfidenceRating && !msg.data.pendingFoodLog.scoutConfidenceRating.toLowerCase().includes('high') && (
                               <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                               msg.data.pendingFoodLog.scoutConfidenceRating.toLowerCase().includes('low') 
                                   ? 'bg-rose-50 text-rose-600 border border-rose-200/50 dark:bg-rose-950/20 dark:text-rose-400'
                                   : 'bg-amber-50 text-amber-600 border border-amber-200/50 dark:bg-amber-950/20 dark:text-amber-400'
                               }`}>
                                 Confidence: {msg.data.pendingFoodLog.scoutConfidenceRating}
                               </span>
                             )}
                           </div>
                             <div className={
                               displayAsMenu 
                                 ? "flex overflow-x-auto flex-nowrap sm:flex-wrap sm:overflow-visible gap-2 pt-1 pb-1 font-sans scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800" 
                                 : "flex overflow-x-auto flex-nowrap sm:flex-wrap sm:overflow-visible items-start justify-start gap-3 pt-2 pb-3 w-full font-sans scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800"
                             }>
                               {displayedScoutItems.map((item: any, i: number) => {
                                 if (displayAsMenu) {
                                   return (
                                     <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-50 dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 text-theme-neutral">
                                       <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                                       <span className="text-[10px] font-bold">
                                         {showTranslations.scout ? (item.keyword || item.originalName) : (item.originalName || item.keyword)}
                                         {item.visualIngredients && item.visualIngredients.length > 0 && (
                                           <span className="font-normal text-indigo-600 dark:text-indigo-400 ml-1">
                                             ({safeTruncate(item.visualIngredients.join(', '), 100)})
                                           </span>
                                         )}
                                       </span>
                                     </div>
                                   );
                                 }
                                 const allSameIdx = displayedScoutItems.every((s: any) => typeof s.sourceImageIndex !== 'number' || s.sourceImageIndex === (displayedScoutItems[0]?.sourceImageIndex || 0));
                                 const allSameBox = displayedScoutItems.every((s: any) => JSON.stringify(s.boundingBox2D || null) === JSON.stringify(displayedScoutItems[0]?.boundingBox2D || null));
                                 const rawIdx = typeof item.sourceImageIndex === 'number' ? item.sourceImageIndex : 0;
                                 const imgIdx = (messageImages.length > 1 && allSameIdx && allSameBox && i < messageImages.length)
                                   ? i
                                   : (rawIdx >= 0 && rawIdx < messageImages.length ? rawIdx : 0);
                                 const resolvedImgSrc = resolveHistoricalImgSrc(item, messageImages, foodLogs || [], imgIdx);
                                 const isSlider = !displayAsMenu && displayedScoutItems.length > 4;
                                 const itemWidthClass = isSlider 
                                   ? 'w-[90px] sm:w-[105px] snap-start' 
                                   : displayedScoutItems.length === 1 
                                     ? 'w-[130px] sm:w-[150px]' 
                                     : 'w-full max-w-[160px]';
                                 return (
                                   <div key={i} className={`flex flex-col items-center gap-1 shrink-0 relative group ${itemWidthClass}`}>
                                     <div className="relative w-full">
                                       <div 
                                         className={`w-full aspect-square rounded-xl overflow-hidden cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-sm ${
                                           (item.itemConfidence?.toLowerCase().includes('low') || item.itemConfidence?.toLowerCase().includes('medium')) 
                                             ? 'bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-400 dark:border-amber-500 shadow-amber-500/20'
                                             : 'bg-slate-100 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700/50'
                                         }`}
                                         onClick={() => setScoutPreviewIdx(i)}
                                       >
                                         {isValidBoundingBox(item.boundingBox2D) ? (
                                           <CroppedFoodImage 
                                             src={resolvedImgSrc} 
                                             boundingBox={item.boundingBox2D} 
                                             alt={item.keyword} 
                                             className="w-full h-full object-cover"
                                             imageUrls={messageImages}
                                             sourceImageIndex={imgIdx}
                                           />
                                         ) : (
                                           <img 
                                             src={resolvedImgSrc} 
                                             alt={item.keyword} 
                                             className="w-full h-full object-cover"
                                             onError={(e) => {
                                               const t = e.target as HTMLImageElement;
                                               if (!t.src.includes('unsplash.com')) t.src = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100&q=80&auto=format';
                                             }}
                                           />
                                         )}
                                       </div>
                                       {/* Warning Icon for Low/Medium Confidence - Moved OUTSIDE the overflow-hidden div */}
                                       {(item.itemConfidence?.toLowerCase().includes('low') || item.itemConfidence?.toLowerCase().includes('medium')) && (
                                         <div 
                                           onClick={(e) => {
                                             e.stopPropagation();
                                             setReviewsOpen(true);
                                           }}
                                           className="absolute -top-1.5 -right-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-full w-4 h-4 flex items-center justify-center shadow-sm z-10 cursor-pointer hover:scale-110 transition-transform"
                                           title="Show low confidence identification panel"
                                         >
                                           <span className="text-[10px] font-bold">!</span>
                                         </div>
                                       )}
                                     </div>
                                     <span 
                                       onClick={() => {
                                         setOpenLabelIdx(prev => prev === i ? null : i);
                                       }}
                                       className="text-[10px] text-center font-semibold leading-tight text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer break-words line-clamp-2 w-full font-sans inline-flex items-center justify-center gap-0.5 mt-1"
                                     >
                                       <span>{showTranslations.scout ? (item.keyword || item.originalName) : (item.originalName || item.keyword)}</span>
                                       <svg
                                         className={`inline-block w-3 h-3 transition-transform shrink-0 text-slate-400 ${openLabelIdx === i ? 'rotate-180' : ''}`}
                                         fill="none"
                                         viewBox="0 0 24 24"
                                         stroke="currentColor"
                                       >
                                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                       </svg>
                                     </span>

                                     {/* Confidence badge below the name — full detail now lives in Items in Review */}
                                     {(item.itemConfidence?.toLowerCase().includes('low') || item.itemConfidence?.toLowerCase().includes('medium')) && (
                                       <span className="text-[8px] text-center leading-tight text-amber-600 dark:text-amber-500 w-full font-sans">
                                         Confidence: {(item.itemConfidence || '').split('(')[0].trim()}
                                       </span>
                                     )}
                                   </div>
                                 );
                               })}
                             </div>

                             {/* Portion controller now managed inside tabbed item views */}

                             {openLabelIdx !== null && displayedScoutItems[openLabelIdx] && (
                                <div className="mt-2 w-full">
                                  <NutritionLabelTable
                                    defaultOpen={true}
                                    hideOwnToggle={true}
                                    activeScoutItems={[displayedScoutItems[openLabelIdx]]}
                                    isSaved={isAlreadyLogged}
                                    onConfirmItem={(idx) => setConfirmedScoutIndices(prev => new Set(prev).add(idx))}
                                    onScalePortion={(ratio) => handleScaleSingleDish(openLabelIdx, ratio)}
                                    currentPortionRatio={displayedScoutItems[openLabelIdx]?.portionRatio || 1.0}
                                  />
                                </div>
                             )}
                             
                             {/* Uncertain Items Helper Button */}
                             {reviewsOpen && !isAlreadyLogged && displayedScoutItems.some(isItemUnclearOrLowConfidence) && (
                               <div className="mt-2 flex flex-col gap-1.5 bg-amber-50/50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/50 rounded-lg p-2 font-sans relative">
                                 <button 
                                   onClick={() => setReviewsOpen(false)}
                                   className="absolute top-1.5 right-1.5 text-amber-500 hover:text-amber-700 dark:hover:text-amber-300 p-0.5 rounded-full hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors"
                                   title="Close panel"
                                 >
                                   <X className="w-3.5 h-3.5" />
                                 </button>
                                 <div className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400 pr-6">
                                   <svg className="w-3.5 h-3.5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                                   <div className="flex flex-col gap-0.5">
                                     <span className="text-[11px] font-bold leading-tight">{t.lowConfidence}</span>
                                     {displayedScoutItems
                                        .filter((i: any) => isItemUnclearOrLowConfidence(i))
                                        .map((i: any, reviewIdx: number) => (
                                          <span key={reviewIdx} className="text-[10px] font-medium leading-tight">
                                            {(i.originalName || i.keyword || i.name)}{getCleanAnomalyFlags(i).length > 0 ? ` - ${getCleanAnomalyFlags(i).join(', ')}` : ''}
                                          </span>
                                        ))}
                                   </div>
                                 </div>
                                 <div className="flex gap-2">
                                   <button 
                                     onClick={() => {
                                       const flaggedItem = displayedScoutItems.find(isItemUnclearOrLowConfidence);
                                       const targetName = flaggedItem?.originalName || flaggedItem?.keyword || flaggedItem?.name || 'this item';
                                       if (setInputText) setInputText(`Correct ${targetName} to `);
                                       setTimeout(() => document.getElementById('food-chat-input')?.focus(), 50);
                                     }} 
                                     className="flex-1 text-[10px] font-bold bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 py-1.5 px-3 rounded-md shadow-sm hover:bg-amber-50 dark:hover:bg-amber-900/40 active:scale-95 transition-all text-center"
                                   >
                                     Edit Item
                                   </button>
                                   <button 
                                     onClick={() => { 
                                       const flaggedIndices = displayedScoutItems
                                         .map((i: any, idx: number) => ({ i, idx }))
                                         .filter(({ i }: any) => isItemUnclearOrLowConfidence(i))
                                         .map(({ i, idx }: any) => i.scoutIndex ?? idx);
                                       setConfirmedScoutIndices(prev => new Set([...prev, ...flaggedIndices]));
                                     }} 
                                     className="flex-1 text-[10px] font-bold bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 py-1.5 px-3 rounded-md shadow-sm hover:bg-amber-50 dark:hover:bg-amber-900/40 active:scale-95 transition-all text-center"
                                   >
                                     This is correct
                                   </button>
                                 </div>
                               </div>
                             )}
                          </div>
                        );
                      })()}

                      <div className="flex flex-col items-start border-b border-theme-border/50 pb-3 gap-2 text-left w-full">
                        <div className="flex items-center justify-between w-full">
                          <h4 className="font-bold text-theme-text text-sm font-display leading-tight">
                            {(() => {
                              if (msg.data?.portionClarify || msg.data?.needsPortionClarify) {
                                return msg.data?.pendingFoodLog.name?.includes('?') ? 'Meal Analysis' : (msg.data?.pendingFoodLog.name || 'Meal Analysis');
                              }
                              const itemsBreakdown = msg.data?.pendingFoodLog?.itemsBreakdown || msg.data?.agentResult?.itemsBreakdown;
                              if (Array.isArray(itemsBreakdown) && itemsBreakdown.length > 1) {
                                const currentName = msg.data?.pendingFoodLog?.name || '';
                                if (currentName && (currentName.includes('&') || currentName.toLowerCase().includes(' and '))) {
                                  return currentName;
                                }
                                const names = itemsBreakdown.map((it: any) => it.name || it.scoutOriginalName || it.keyword).filter(Boolean);
                                if (names.length > 1) {
                                  const uniqueNames: string[] = [];
                                  names.forEach((n: string) => {
                                    const clean = n.trim();
                                    if (clean && !uniqueNames.some(u => u.toLowerCase().includes(clean.toLowerCase()) || clean.toLowerCase().includes(u.toLowerCase()))) {
                                      uniqueNames.push(clean);
                                    }
                                  });
                                  if (uniqueNames.length > 1) {
                                    return uniqueNames.join(' & ');
                                  }
                                }
                              }
                              return msg.data?.pendingFoodLog?.name || 'Meal Analysis';
                            })()}
                          </h4>
                        </div>
                        {(() => {
                          const isPortionClarifying = !!(msg.data?.portionClarify || msg.data?.needsPortionClarify || (msg as any).portionClarify || (msg as any).needsPortionClarify);
                          if (isPortionClarifying) return null;
                          const desc = msg.data?.pendingFoodLog?.message || msg.data?.agentResult?.message || msg.data?.pendingFoodLog?.description || msg.data?.agentResult?.description || (msg.data?.pendingFoodLog?.healthImpact && !msg.data.pendingFoodLog.healthImpact.includes("Contributes to daily macro") ? msg.data.pendingFoodLog.healthImpact : null);
                          if (!desc) return null;
                          return (
                            <div className="text-[12px] text-slate-900 dark:text-slate-100 font-sans leading-relaxed my-1 text-left w-full font-medium">
                              {desc}
                            </div>
                          );
                        })()}
                        {(() => {
                          const wGrams = msg.data?.pendingFoodLog?.weightGrams;
                          const hasWeight = wGrams != null && !isNaN(Number(wGrams)) && Number(wGrams) > 0;
                          const rawQty = msg.data?.pendingFoodLog?.quantity;
                          const hasQty = !!rawQty && String(rawQty).trim() !== '' && String(rawQty).trim() !== 'undefined' && String(rawQty).trim() !== 'null';
                          const dt = msg.data?.pendingFoodLog?.date;
                          if (!hasWeight && !hasQty && !dt) return null;
                          return (
                            <div className="flex flex-wrap items-center gap-2">
                              {(hasWeight || hasQty) && (
                                <span className="text-[11px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 px-2.5 py-0.5 rounded-full font-bold font-sans">
                                  {hasWeight ? `${wGrams}g` : ''}
                                  {hasQty ? (hasWeight ? ` (${rawQty})` : `${rawQty}`) : ''}
                                </span>
                              )}
                              {dt && <span className="font-mono text-[10px] text-slate-400">{dt}</span>}
                            </div>
                          );
                        })()}
                      </div>

                      {(() => {
                        if (msg.data?.portionClarify || msg.data?.needsPortionClarify) return null;
                        const desc = msg.data?.pendingFoodLog?.message || msg.data?.agentResult?.message || msg.data?.pendingFoodLog?.description || msg.data?.agentResult?.description || (msg.data?.pendingFoodLog?.healthImpact && !msg.data.pendingFoodLog.healthImpact.includes("Contributes to daily macro") ? msg.data.pendingFoodLog.healthImpact : null);
                        const rawMsgContent = msg.content !== 'null' ? msg.content : msg.data?.agentResult?.message;
                        if (!rawMsgContent || rawMsgContent === 'null') return null;
                        if (desc && (rawMsgContent.trim() === desc.trim() || rawMsgContent.includes(desc.trim()))) return null;
                        return (
                          <div className="text-[11.5px] text-theme-neutral font-sans leading-relaxed text-left py-2 border-b border-theme-border/50 whitespace-pre-line break-words w-full">
                            {formatMessageContent(rawMsgContent, msg)}
                          </div>
                        );
                      })()}

                      {/* Verdict Tag rendered below the message */}
                      {(() => {
                        const v = msg.data?.agentResult?.verdict || msg.data?.pendingFoodLog?.verdict;
                        if (!v?.label) return null;
                        const lblLower = (v.label || '').toLowerCase();
                        const lvl = (v.level || '').toLowerCase();
                        const colorCls = (lvl === 'alert' || lblLower.includes('bad') || lblLower.includes('high') || lblLower.includes('excess'))
                          ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300'
                          : (lvl === 'warning' || lblLower.includes('moderate') || lblLower.includes('caution'))
                          ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300'
                          : (lvl === 'good' || lblLower.includes('healthy') || lblLower.includes('balanced'))
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300';
                        return (
                          <div className="py-2 border-b border-theme-border/50 flex items-center gap-2 flex-wrap text-left w-full">
                            <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 font-sans">Verdict:</span>
                            <span className={`text-[11px] font-bold px-3 py-0.5 rounded-full border inline-block ${colorCls} font-sans`}>
                              {v.label}
                            </span>
                          </div>
                        );
                      })()}

                      <div className="text-[11.5px] space-y-2 text-slate-800 dark:text-slate-100 font-medium text-left font-sans leading-relaxed">
                        {msg.data?.pendingFoodLog.cookingMethod && (
                          <p className="text-slate-800 dark:text-slate-200 italic font-semibold">🔥 Preparation: {msg.data?.pendingFoodLog.cookingMethod}</p>
                        )}
                        {msg.data?.pendingFoodLog.scoutConfidenceComment && (
                          <div className="text-[11.5px] text-slate-800 dark:text-slate-200 italic bg-slate-100 dark:bg-slate-800/80 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
                            ℹ️ {msg.data.pendingFoodLog.scoutConfidenceComment}
                          </div>
                        )}
                      </div>
                      {msg.data?.pendingFoodLog?.receiptTable && (
                        <div className="mt-3 pt-3 border-t border-theme-border/50 overflow-hidden w-full max-w-full">
                           <ScratchpadMarkdownViewer content={msg.data.pendingFoodLog.receiptTable} nutrients={msg.data.pendingFoodLog.nutrients} className="!bg-transparent !p-0 !border-0" showCopyButton={true} msg={msg} pendingFoodLog={msg.data.pendingFoodLog} />
                        </div>
                      )}



                      {/* Collapsible Detailed Components and Nutrient values lists */}
                      {msg.data?.pendingFoodLog && (
                        <div className="pt-2 border-t border-slate-150 dark:border-slate-800/60 font-sans">
                          <button
                            type="button"
                            onClick={() => setExpandedTables(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                            className="w-full flex items-center justify-between text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors py-1.5 cursor-pointer font-sans"
                          >
                            <span className="flex items-center gap-1.5">
                              📊 Components & Nutrient Details
                            </span>
                            {expandedTables[msg.id] ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                          
                          {expandedTables[msg.id] && (
                            <div className="mt-3 space-y-4 shadow-inner bg-slate-50/50 dark:bg-slate-900/30 p-3 rounded-2xl border border-theme-border/50 animation-fade-in text-left">
                              {/* A. Components breakdown table */}
                              {msg.data?.pendingFoodLog.itemsBreakdown && msg.data?.pendingFoodLog.itemsBreakdown.length > 0 && (
                                <div className="border border-theme-border/80 rounded-xl overflow-hidden bg-theme-bg-card shadow-sm">
                                  <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/60 border-b border-theme-border flex items-center justify-between">
                                    <span className="text-[10px] font-bold text-theme-text-secondary uppercase tracking-wider font-sans">
                                      📊 Component Contribution
                                    </span>
                                    {displayedScoutItems.some((i: any) => i.originalName && i.originalName.toLowerCase() !== (i.keyword || "").toLowerCase()) && (
                                      <button
                                        type="button"
                                        onClick={() => setShowTranslations(prev => ({ ...prev, scout: !prev.scout }))}
                                        className={`p-0.5 hover:bg-slate-100 dark:hover:bg-slate-850 rounded-md transition-all cursor-pointer ${
                                          showTranslations.scout ? 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40' : 'text-slate-400'
                                        }`}
                                        title="Toggle Language"
                                      >
                                        <span className="text-[9px] font-bold leading-none block px-1 py-0.5">{showTranslations.scout ? "English" : "Local"}</span>
                                      </button>
                                    )}
                                  </div>
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-left border-collapse text-[11px]">
                                      <thead>
                                        <tr className="border-b border-theme-border bg-slate-50 dark:bg-slate-800/30 text-theme-text-secondary font-bold">
                                          <th className="p-2">{t.itemName}</th>
                                          <th className="p-2 text-right">{t.weightLabel}</th>
                                          <th className="p-2 text-right">{t.caloriesLabel}</th>
                                          <th className="p-2 text-right">{t.satFatLabel}</th>
                                          <th className="p-2 text-right">{t.sodiumLabel}</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {msg.data?.pendingFoodLog.itemsBreakdown.map((item: any, itemIdx: number) => {
                                          const displayName = (() => {
                                            const isEnglish = showTranslations.scout;
                                            if (isEnglish) {
                                              return item.canonicalDbName || item.name || "Unknown Item";
                                            }
                                            // Local mode
                                            if (item.originalLocalName) return item.originalLocalName;
                                            // Fallback: search displayedScoutItems client-side
                                            const itemNameLower = (item.canonicalDbName || item.name || "").toLowerCase();
                                            const match = displayedScoutItems.find((s: any) => {
                                              const keywordLower = (s.keyword || "").toLowerCase();
                                              const originalLower = (s.originalName || "").toLowerCase();
                                              return (
                                                itemNameLower === keywordLower ||
                                                itemNameLower === originalLower ||
                                                itemNameLower.includes(keywordLower) ||
                                                itemNameLower.includes(originalLower) ||
                                                keywordLower.includes(itemNameLower) ||
                                                originalLower.includes(itemNameLower)
                                              );
                                            });
                                            if (match) return match.originalName || match.keyword;
                                            return item.canonicalDbName || item.name || "Unknown Item";
                                          })();

                                          return (
                                            <tr 
                                              key={itemIdx} 
                                              className="border-b last:border-b-0 border-slate-100 dark:border-slate-850 text-slate-750 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-850/20"
                                            >
                                              <td className="p-2 font-semibold text-xs leading-normal whitespace-normal break-words max-w-[180px]">
                                                <div>{displayName}</div>
                                                <div className="mt-1 flex flex-wrap items-center gap-1">
                                                  <PhysicalFormBadge item={item} />
                                                  {(item.isEdited || item.wasModified || item.modified) && (
                                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-300 border border-amber-200/50 dark:border-amber-800/50">
                                                      ✏️ Modified
                                                    </span>
                                                  )}
                                                  {item.calorieDelta !== undefined && item.calorieDelta !== 0 && (
                                                    <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                                                      item.calorieDelta < 0
                                                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-300 border-emerald-200/50 dark:border-emerald-800/50'
                                                        : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-300 border-rose-200/50 dark:border-rose-800/50'
                                                    }`}>
                                                      {item.calorieDelta > 0 ? `+${item.calorieDelta} kcal` : `${item.calorieDelta} kcal`}
                                                    </span>
                                                  )}
                                                  {item.weightDelta !== undefined && item.weightDelta !== 0 && (
                                                    <span className="text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-300 border border-blue-200/50 dark:border-blue-800/50">
                                                      {item.weightDelta > 0 ? `+${item.weightDelta}g` : `${item.weightDelta}g`}
                                                    </span>
                                                  )}
                                                  {(item.chainName || item.brand) && (item.dbSource === 'brand_official' || String(item.dbId || '').includes('brand_menu_') || String(item.fdcId || '').includes('brand_menu_')) && (
                                                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-300 border border-indigo-200/50 dark:border-indigo-800/50">
                                                      {item.chainName || item.brand}
                                                    </span>
                                                  )}
                                                  {item.dbSource && (
                                                    <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200/50 dark:border-slate-700/50">
                                                      {item.dbSource === 'usda' ? 'USDA' : item.dbSource === 'off' ? 'OpenFoodFacts' : item.dbSource === 'brand_official' || item.dbSource === 'label' ? 'Official Brand' : item.dbSource === 'canonical' ? 'Canonical' : item.dbSource}
                                                    </span>
                                                  )}
                                                  {item.cookingMethod && getCookingMethodChip(item.cookingMethod)}
                                                </div>
                                              </td>
                                              <td className="p-2 text-right font-mono text-slate-500">
                                                 <div className="flex flex-col items-end">
                                                   <span className="font-semibold">{formatNutrientValue(item.weightGrams, 'g')}</span>
                                                   {item.packGrams ? (
                                                     <span className="text-[9px] font-sans text-indigo-500 dark:text-indigo-400 font-semibold">
                                                       {item.portionDescription || `${Math.round(((item.weightGrams || 0) / item.packGrams) * 100)}% of ${item.packGrams}g`}
                                                     </span>
                                                   ) : (
                                                     (item.portionRatio !== undefined && item.portionRatio !== 1) ? (
                                                       <span className="text-[9px] font-sans text-indigo-500 dark:text-indigo-400 font-semibold">
                                                         {item.portionDescription || `${item.portionRatio}x`}
                                                       </span>
                                                     ) : null
                                                   )}
                                                 </div>
                                              </td>
                                              <td className="p-2 text-right font-mono text-orange-600 dark:text-orange-400 font-semibold">
                                                {formatNutrientValue(item.calories, 'kcal')}
                                              </td>
                                              <td className="p-2 text-right font-mono text-amber-500 font-semibold">
                                                {formatNutrientValue(item.saturatedFat, 'g')}
                                              </td>
                                              <td className="p-2 text-right font-mono text-slate-600 dark:text-slate-400 font-semibold">
                                                <div className="flex items-center justify-end gap-1">
                                                  <span>{formatNutrientValue(item.sodium, 'mg')}</span>
                                                  {(item.saltConversionNote || (item.rawNutritionLabel?.salt && (item.rawNutritionLabel?.sodium || item.nutritionFacts?.sodium))) && (
                                                    <div className="inline-flex items-center">
                                                      <PositionedTooltip
                                                        trigger={
                                                          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-blue-500 hover:text-blue-600 cursor-help shrink-0">
                                                            <circle cx="12" cy="12" r="10"></circle>
                                                            <line x1="12" y1="16" x2="12" y2="12"></line>
                                                            <line x1="12" y1="8" x2="12.01" y2="8"></line>
                                                          </svg>
                                                        }
                                                        content={item.saltConversionNote || `Converted printed salt (${item.rawNutritionLabel?.salt}) to sodium. Formula: 1g salt = 400mg sodium.`}
                                                        contentClassName="bg-slate-800 text-white text-[10px] font-sans"
                                                      />
                                                    </div>
                                                  )}
                                                </div>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              )}

                              
                              
                              {/* B. Full 31-nutrient table */}
                              <ComprehensiveNutrientsTable 
                                nutrients={msg.data?.pendingFoodLog?.nutrients || {}} 
                                language={profile?.language || "en"} 
                                lockedNutrientKeys={msg.data?.pendingFoodLog?.lockedNutrientKeys} 
                                basisType={msg.data?.pendingFoodLog?.basis_type}
                                servingGrams={msg.data?.pendingFoodLog?.serving_grams}
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Log Action Button — hidden when portion clarification is pending user confirmation */}
                      {!(msg.data?.portionClarify || msg.data?.needsPortionClarify || (msg as any).portionClarify || (msg as any).needsPortionClarify) && (
                        isAlreadyLogged ? (
                          <div className="w-full py-2 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 animation-fade-in font-sans">
                            <Check className="w-4 h-4" />
                            Saved to History
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              if (isLoggingRef.current) return;
                              const logTarget = msg.data?.pendingFoodLog || msg.pendingFoodLog || effectiveFoodLog;
                              if (logTarget && onLogFood) {
                                isLoggingRef.current = true;
                                const mostRecentImageDate = extractMostRecentImageDate(
                                  (logTarget as any).imageDates || msg.data?.imageDates || msg.data?.agentResult?.imageDates
                                );
                                const foodToLog = {
                                  ...logTarget,
                                  id: logTarget.id || (msg.data?.pendingFoodLog as any)?.id || (msg as any).loggedFoodId,
                                  date: logTarget.date || mostRecentImageDate || (profile?.timezone ? getCurrentDateInTimezone(profile.timezone) : new Date().toISOString().split('T')[0]),
                                  scoutItems: logTarget.scoutItems || (logTarget.itemsBreakdown && logTarget.itemsBreakdown.length > 0 ? logTarget.itemsBreakdown : msg.data?.scoutItems) || [],
                                  itemsBreakdown: logTarget.itemsBreakdown || logTarget.scoutItems || msg.data?.scoutItems || [],
                                  portionRatio: logTarget.portionRatio || portionScale || 1.0,
                                  portionAccepted: true,
                                  imageUrl: logTarget.imageUrl || (messageImages.length > 0 ? messageImages[0] : undefined),
                                  imageUrls: (logTarget.imageUrls && logTarget.imageUrls.length > 0)
                                    ? logTarget.imageUrls
                                    : (messageImages.length > 0 ? messageImages : undefined),
                                  verdict: logTarget.verdict || msg.data?.agentResult?.verdict || msg.data?.verdict,
                                  message: logTarget.message || msg.data?.agentResult?.message || msg.data?.message || logTarget.description || msg.data?.agentResult?.description || msg.data?.description,
                                  healthImpact: logTarget.healthImpact || msg.data?.agentResult?.healthImpact || msg.data?.healthImpact || msg.data?.agentResult?.data?.healthImpact,
                                  composition: logTarget.composition || msg.data?.agentResult?.composition || msg.data?.composition,
                                  chatTranscript: (messages || []).map((m: any) => ({
                                    role: m.role,
                                    content: m.content || '',
                                    timestamp: m.timestamp
                                  })),
                                };
                                const logResult = onLogFood(foodToLog as FoodLog);
                                setLoggedMessageIds?.(prev => [...prev, msg.id]);
                                Promise.resolve(logResult).then((res: any) => {
                                  const savedId = res?.id || foodToLog.id;
                                  if (savedId) {
                                    if (msg.data) {
                                      if (!msg.data.pendingFoodLog) msg.data.pendingFoodLog = { ...foodToLog };
                                      msg.data.pendingFoodLog.id = savedId;
                                    }
                                    if (msg.pendingFoodLog) msg.pendingFoodLog.id = savedId;
                                    (msg as any).loggedFoodId = savedId;
                                  }
                                }).finally(() => {
                                  isLoggingRef.current = false;
                                });
                              }
                            }}
                            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer font-sans"
                          >
                            <Plus className="w-4 h-4" />
                            {t.logThisFood}
                          </button>
                        )
                      )}
                    </div>
                  )}

      {/* Standalone Response / Discussion / Clinical Advice Card when no Pending Food Log or Comparison exists */}
      {(() => {
        const hasPendingLog = !!msg.data?.pendingFoodLog;
        const hasComparison = !!(mode === 'evaluation' && comparisonData && comparisonData.groups && comparisonData.groups.length > 0);
        if (hasPendingLog || hasComparison) return null;

        // Suppress standalone fallback text when portion clarification is active (prevents duplicate prompt text)
        if (msg.data?.portionClarify || msg.data?.needsPortionClarify || (msg as any).portionClarify || (msg as any).needsPortionClarify) {
          return null;
        }

        const rawText = msg.content || msg.data?.agentResult?.message || msg.data?.agentResult?.text || msg.data?.agentResult?.dietitianAnswer || msg.data?.agentResult?.scoutAnswer || (msg as any).text || (msg as any).message;
        let formattedText = '';
        if (rawText) {
          formattedText = formatMessageContent(rawText, msg);
          if (!formattedText && typeof rawText === 'string' && !rawText.trim().startsWith('{') && !rawText.includes('_internalReasoning') && !rawText.includes('"label"')) {
            formattedText = rawText;
          }
        }

        const fallbackText = formattedText || '';

        if (!fallbackText && activeScoutItems.length === 0) return null;

        return (
          <div className="bg-white dark:bg-slate-800 border border-theme-border rounded-2xl p-4 shadow-md space-y-3 animation-fade-in w-full max-w-full min-w-0 overflow-hidden font-sans text-left mt-3">
            {/* Show Scout identified items if photos were uploaded */}
            {displayedScoutItems.length > 0 && (
              <div className="mb-3 border-b border-theme-border/50 pb-3 font-sans text-left">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10.5px] font-bold text-indigo-500 dark:text-indigo-400">
                    🔍 Meal composition ({displayedScoutItems.length} items identified)
                  </span>
                </div>
                <div className="flex overflow-x-auto flex-nowrap sm:flex-wrap items-start justify-start gap-3 pt-2 pb-3 w-full font-sans scrollbar-thin scrollbar-thumb-slate-200 dark:scrollbar-thumb-slate-800">
                  {displayedScoutItems.map((item: any, i: number) => {
                    const rawIdx = typeof item.sourceImageIndex === 'number' ? item.sourceImageIndex : 0;
                    const imgIdx = (messageImages.length > 0 && rawIdx >= 0 && rawIdx < messageImages.length) ? rawIdx : 0;
                    const resolvedImgSrc = resolveHistoricalImgSrc(item, messageImages, foodLogs || [], imgIdx);
                    return (
                      <div key={i} className="flex flex-col items-center gap-1 shrink-0 relative group w-[110px] sm:w-[130px]">
                        <div 
                          className="w-full aspect-square rounded-xl overflow-hidden cursor-pointer hover:scale-105 active:scale-95 transition-all shadow-sm bg-slate-100 dark:bg-slate-800 border border-slate-200/50 dark:border-slate-700/50"
                          onClick={() => setScoutPreviewIdx(i)}
                        >
                          {isValidBoundingBox(item.boundingBox2D) ? (
                            <CroppedFoodImage 
                              src={resolvedImgSrc} 
                              boundingBox={item.boundingBox2D} 
                              alt={item.keyword} 
                              className="w-full h-full object-cover"
                              imageUrls={messageImages}
                              sourceImageIndex={imgIdx}
                            />
                          ) : (
                            <img 
                              src={resolvedImgSrc} 
                              alt={item.keyword} 
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                const t = e.target as HTMLImageElement;
                                const fallback = getFoodImageUrl(item.keyword || item.originalName || 'food');
                                if (t.src !== fallback) t.src = fallback;
                              }}
                            />
                          )}
                        </div>
                        <span 
                          onClick={() => setOpenLabelIdx(prev => prev === i ? null : i)}
                          className="text-[10px] text-center font-semibold leading-tight text-slate-700 dark:text-slate-200 hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer break-words line-clamp-2 w-full font-sans inline-flex items-center justify-center gap-0.5 mt-1"
                        >
                          <span>{showTranslations.scout ? (item.keyword || item.originalName) : (item.originalName || item.keyword)}</span>
                          <svg
                            className={`inline-block w-3 h-3 transition-transform shrink-0 text-slate-400 ${openLabelIdx === i ? 'rotate-180' : ''}`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Portion controller now managed inside tabbed item views */}

                {openLabelIdx !== null && displayedScoutItems[openLabelIdx] && (
                  <div className="mt-2 w-full">
                    <NutritionLabelTable
                      defaultOpen={true}
                      hideOwnToggle={true}
                      activeScoutItems={[displayedScoutItems[openLabelIdx]]}
                      isSaved={isAlreadyLogged}
                      onConfirmItem={(idx) => setConfirmedScoutIndices(prev => new Set(prev).add(idx))}
                      onScalePortion={(ratio) => handleScaleSingleDish(openLabelIdx, ratio)}
                      currentPortionRatio={displayedScoutItems[openLabelIdx]?.portionRatio || 1.0}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Dietitian Update / Response */}
            {fallbackText && (
              <div className="text-[12px] text-slate-800 dark:text-slate-100 font-sans leading-relaxed whitespace-pre-line break-words space-y-2">
                {fallbackText}
              </div>
            )}
          </div>
        );
      })()}
    </>
  );
};

/** Compact flag control for food analysis results → Supabase issue_backlog */
function FoodResultFlagButton({
  pendingFoodLog,
  msg,
  profile,
}: {
  pendingFoodLog: any;
  msg: any;
  profile?: any;
}) {
  const [open, setOpen] = React.useState(false);
  const [issueType, setIssueType] = React.useState<IssueType>('incorrect_answer');
  const [note, setNote] = React.useState('');
  const [url, setUrl] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState<string | null>(null);
  const [flaggedId, setFlaggedId] = React.useState<string | null>(null);

  const dishQuery =
    pendingFoodLog?.name ||
    (pendingFoodLog?.itemsBreakdown || [])
      .map((i: any) => i.originalName || i.name || i.keyword)
      .filter(Boolean)
      .join(', ');
  const chainKey =
    guessChainKey(dishQuery) ||
    guessChainKey(JSON.stringify(pendingFoodLog?.itemsBreakdown || []).slice(0, 500));

  const buildPayload = async () => {
    let debugLogText = '';
    let debugLogLines: any[] = [];
    try {
      const sessionId =
        (typeof window !== 'undefined' &&
          (window as any).__healthSessionId) ||
        sessionStorage.getItem('health_session_id') ||
        '';
      const res = await fetch('/api/gemini/debug-logs', {
        headers: sessionId ? { 'X-Session-ID': sessionId } : {},
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.logs)) {
          debugLogLines = data.logs;
          debugLogText = data.logs
            .map((l: any) => `[${l.timestamp || ''}] ${l.message || l}`)
            .join('\n');
        }
      }
    } catch {
      /* ignore */
    }

    // Strip large image data from pending food for storage
    const answer = JSON.parse(JSON.stringify(pendingFoodLog || {}));
    if (Array.isArray(answer.imageUrls)) {
      answer.imageUrls = { count: answer.imageUrls.length, omitted: true };
    }
    delete answer.imageBase64;
    delete answer.images;

    // --- Structured nutrient calculation (for debugging) ---
    const items = Array.isArray(answer.itemsBreakdown) ? answer.itemsBreakdown : [];
    const nutrientCalculation = {
      grandTotal: answer.nutrients || null,
      receiptTableMarkdown: answer.receiptTable || null,
      items: items.map((it: any, idx: number) => ({
        index: idx,
        scoutIndex: it.scoutIndex ?? idx,
        name: it.originalLocalName || it.canonicalDbName || it.name,
        weightGrams: it.weightGrams,
        dbSource: it.dbSource,
        dbId: it.dbId,
        matchReasonInfo: it.matchReasonInfo || null,
        primaryBaseMatchName: it.primaryBaseMatchName || null,
        primaryBase100g: it.primaryBase100g || null,
        primaryBaseWeightG: it.primaryBaseWeightG || null,
        labelNutrientsPerServing: it.labelNutrientsPerServing || null,
        cookingAdded: it.cookingAdded || null,
        saucesDetailList: it.saucesDetailList || null,
        components: it.components || it.visualIngredients || null,
        itemTotals: {
          calories: it.calories,
          protein: it.protein,
          totalFat: it.totalFat,
          saturatedFat: it.saturatedFat,
          carbohydrates: it.carbohydrates,
          sodium: it.sodium,
          sugar: it.sugar,
          addedSugar: it.addedSugar,
          totalFibre: it.totalFibre,
          potassium: it.potassium,
          transFat: it.transFat,
        },
      })),
    };

    // --- Parse pipeline errors/warnings from debug logs ---
    const pipelineErrors: Array<{ level: string; kind: string; message: string; timestamp?: string }> = [];
    const pipelineWarnings: Array<{ level: string; kind: string; message: string; timestamp?: string }> = [];
    for (const l of debugLogLines) {
      const message = String(l?.message ?? l ?? '');
      const timestamp = l?.timestamp;
      const lower = message.toLowerCase();
      const entry = { level: 'info', kind: 'log', message: message.slice(0, 2000), timestamp };
      if (
        lower.includes('fatal') ||
        lower.includes('aborterror') ||
        lower.includes('operation was aborted') ||
        lower.includes('timed out') ||
        lower.includes('timeout') ||
        lower.includes('exception') ||
        lower.includes(' failed') ||
        lower.includes('error:')
      ) {
        pipelineErrors.push({
          ...entry,
          level: 'error',
          kind: lower.includes('abort') || lower.includes('timeout')
            ? 'llm_timeout'
            : lower.includes('blocked')
              ? 'provider_blocked'
              : 'error',
        });
      } else if (
        lower.includes('blocked') ||
        lower.includes('captcha') ||
        lower.includes('discarded unusable') ||
        lower.includes('atwater') ||
        lower.includes('rescaling') ||
        lower.includes('deviation') ||
        lower.includes('warn')
      ) {
        pipelineWarnings.push({
          ...entry,
          level: 'warning',
          kind: lower.includes('atwater')
            ? 'atwater_rescale'
            : lower.includes('captcha') || lower.includes('blocked')
              ? 'search_blocked'
              : lower.includes('discarded')
                ? 'web_hit_discarded'
                : lower.includes('direct injection')
                  ? 'web_direct_injection'
                  : 'warning',
        });
      } else if (lower.includes('web search direct injection') || lower.includes('first-principles injection')) {
        pipelineWarnings.push({ ...entry, level: 'info', kind: 'nutrient_injection' });
      }
    }

    return {
      context: 'food_analyze',
      query: {
        message: msg?.content || '',
        mode: msg?.mode || msg?.data?.mode,
        dishQuery,
        chainKey,
      },
      answer,
      nutrientCalculation,
      pipelineErrors,
      pipelineWarnings,
      messageMeta: {
        id: msg?.id,
        role: msg?.role,
        agentType: msg?.agentType,
      },
      debugLogText,
      debugLogLines,
      profileCountry: profile?.country || profile?.countryCode || 'GB',
    };
  };

  const submit = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const payload = await buildPayload();
      const sessionId =
        sessionStorage.getItem('health_session_id') ||
        (window as any).__healthSessionId;
      const result = await flagIssueToServer(
        {
          issue_type: issueType,
          country_code: profile?.country || profile?.countryCode || 'GB',
          chain_key: chainKey,
          dish_query: dishQuery,
          context: 'food_analyze',
          source_url: url || undefined,
          user_note: note || undefined,
          firebase_uid: profile?.uid,
          payload,
          register_source_url: url || undefined,
          register_display_name: chainKey,
        },
        sessionId
      );
      if (result.success) {
        if (result.id) setFlaggedId(result.id);
        setStatus('Saved to fix backlog (to_fix).');
        setTimeout(() => setOpen(false), 1500);
      } else setStatus(result.error || 'Failed');
    } catch (e: any) {
      setStatus(e?.message || 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex items-center justify-end gap-2">
        {flaggedId ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border border-emerald-400/80 text-emerald-800 dark:text-emerald-200 bg-emerald-50 dark:bg-emerald-950/40">
            <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            Flagged ({flaggedId.slice(0, 8)})
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-1 rounded-full border border-amber-400/80 text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 hover:bg-amber-100"
        >
          <Flag className="w-3 h-3" />
          {flaggedId ? 'Flag another' : 'Flag issue'}
        </button>
      </div>
      <UniversalModal
        isOpen={open}
        onClose={() => setOpen(false)}
        title="Flag food analysis issue"
        onFlagSuccess={(id) => setFlaggedId(id)}
        flagContext={{
          context: 'food_analyze',
          chainKey,
          dishQuery,
          countryCode: profile?.country || profile?.countryCode || 'GB',
          firebaseUid: profile?.uid,
          getPayload: buildPayload,
          defaultIssueType: issueType,
        }}
      >
        {null}
      </UniversalModal>
    </>
  );
}
