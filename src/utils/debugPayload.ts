/**
 * B9 / B14 — Strip heavy images from debug payloads and build a human markdown report.
 * Pure helpers (browser + Node safe).
 */

/** Recursively strip base64 / huge data-URLs; keep short https photo URLs. */
export function stripHeavyImages(value: any): any {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) {
      return `[image omitted ${Math.round(value.length / 1024)}KB]`;
    }
    if (value.length > 8000 && /base64/i.test(value)) {
      return value.replace(/data:image\/[^;]+;base64,[a-zA-Z0-9+/=]+/ig, (match) => {
        return `[image omitted ${Math.round(match.length / 1024)}KB]`;
      });
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(stripHeavyImages);
  if (typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) {
      if (
        (k === 'imageUrl' ||
          k === 'imageUrls' ||
          k === 'photoUrl' ||
          k === 'images' ||
          k === 'selectedImages') &&
        (typeof v === 'string' ? v.startsWith('data:') || v.length > 8000 : true)
      ) {
        if (typeof v === 'string' && /^https?:\/\//i.test(v) && v.length < 500) {
          out[k] = v;
        } else if (Array.isArray(v)) {
          out[k] = v.map((x) =>
            typeof x === 'string' && /^https?:\/\//i.test(x) && x.length < 500
              ? x
              : typeof x === 'string'
                ? `[image omitted ${Math.round(x.length / 1024)}KB]`
                : stripHeavyImages(x)
          );
        } else if (typeof v === 'string') {
          out[k] = `[image omitted ${Math.round(v.length / 1024)}KB]`;
        } else {
          out[k] = stripHeavyImages(v);
        }
        continue;
      }
      out[k] = stripHeavyImages(v);
    }
    return out;
  }
  return value;
}

export const COLD_DEBUG_LOG = '[ColdDebug] R2 upload';

/** R2 object key for cold debug JSON (user-scoped). */
export function coldDebugR2Key(jobId: string, userId?: string | null): string {
  const uid = String(userId || 'anonymous')
    .replace(/[^a-zA-Z0-9_\-@.]/g, '_')
    .slice(0, 120);
  const jid = String(jobId || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
  return `debug/${uid}/${jid}.json`;
}

export type DebugReportInput = {
  jobId?: string;
  status?: string;
  message?: string;
  backendLogs?: string;
  pendingFoodLog?: any;
  scoutItems?: any[];
  scoutInternalReasoning?: string;
  rawScout?: any;
  scoutContentType?: string;
  diningEnvironment?: string;
  receiptTable?: any;
  error?: string;
  debugUrl?: string;
  photoUrl?: string;
  photoUrls?: string[];
  exportedAt?: string;
  mode?: string;
  agentType?: string;
  savable?: boolean;
  degradedStages?: string[];
  lastUserAction?: any;
  userActionBreadcrumbs?: any[];
  clientConsoleLogs?: string[];
  networkErrors?: string[];
  usdaSearchResults?: any[];
  brandSearchResults?: any[];
  comprehensiveNutrients?: Record<string, number>;
  stageLedger?: any[];
  historyLog?: any[];
  version?: number;
  ingestTrace?: any;
  /** Health Coach / medical analysis output (health-baseline-analyze route nests
   * its full structured result under this field — see serverJobs.ts persistSucceeded). */
  report?: any;
  /** Prior conversation turns (role + content) that came before the turn being
   * exported, so a reader can see what led up to this point ("previous steps"). */
  conversationHistory?: { role: string; content: string }[];
};

/**
 * B9b — Human-readable full report (scout, database search, calculation, receipt + backend logs).
 * Cleaned up without redundant duplicates. No base64 images.
 */
export function buildDebugMarkdownReport(input: DebugReportInput): string {
  const lines: string[] = [];
  const at = input.exportedAt || new Date().toISOString();
  lines.push(`# Health Tracker — End-to-End Diagnostic Report`);
  lines.push('');
  lines.push(`- **Exported:** ${at}`);
  if (input.jobId) lines.push(`- **Job ID:** \`${input.jobId}\``);
  if (input.status) lines.push(`- **Status:** ${input.status}`);
  if (input.mode) lines.push(`- **Mode:** ${input.mode}`);
  if (input.version !== undefined) lines.push(`- **Version:** ${input.version}`);
  if (input.savable !== undefined) lines.push(`- **Savable:** ${input.savable}`);
  if (input.degradedStages && input.degradedStages.length > 0) lines.push(`- **Degraded Stages:** ${input.degradedStages.join(', ')}`);
  if (Array.isArray(input.photoUrls) && input.photoUrls.length > 0) {
    input.photoUrls.forEach((p, idx) => {
      if (/^https?:\/\//i.test(String(p))) {
        lines.push(`- **Photo ${idx + 1}:** ${p}`);
      }
    });
  } else if (input.photoUrl && /^https?:\/\//i.test(String(input.photoUrl))) {
    const photoBase = input.photoUrl.replace(/_\d+\.jpg$/, '');
    const crumb = (input.userActionBreadcrumbs || []).find((c: any) => (c?.details?.imageCount && c.details.imageCount > 1) || (c?.details?.image_count && c.details.image_count > 1));
    const imgCount = crumb?.details?.imageCount || crumb?.details?.image_count || 1;
    if (imgCount > 1 && photoBase !== input.photoUrl) {
      for (let i = 0; i < imgCount; i++) {
        lines.push(`- **Photo ${i + 1}:** ${photoBase}_${i}.jpg`);
      }
    } else {
      lines.push(`- **Photo:** ${input.photoUrl}`);
    }
  }
  if (input.error) lines.push(`- **Error:** ${input.error}`);
  lines.push('');

  // Biomarker Ingest Trace (if medical job / ingest trace present)
  if (input.ingestTrace && typeof input.ingestTrace === 'object') {
    const trace = input.ingestTrace;
    lines.push(`## 🧬 Biomarker Ingest Trace (v${trace.version || 1})`);
    lines.push('');
    lines.push(`- **Source Kind:** ${trace.sourceKind || 'unknown'}`);
    lines.push(`- **Total Rows:** ${trace.totalInputRows ?? (trace.rows?.length || 0)}`);
    lines.push(`- **High Confidence:** ${trace.highConfidenceCount ?? 0} | **Flagged:** ${trace.flaggedCount ?? 0} | **Unmatched:** ${trace.unmatchedCount ?? 0} | **Skipped:** ${trace.skippedCount ?? 0}`);
    if (trace.handoff) {
      lines.push(`- **Handoff:** Dual Raw Injection: \`${trace.handoff.dualRawInjection ? 'true' : 'false'}\` | Sent to Parser: ${trace.handoff.sentToParserCount ?? 0} | Sent to Review: ${trace.handoff.sentToReviewCount ?? 0}`);
    }
    if (Array.isArray(trace.rows) && trace.rows.length > 0) {
      lines.push('');
      lines.push(`| # | Printed Name | Raw Value | Raw Unit | Canonical Key | Bucket | Class | Reason / Notes |`);
      lines.push(`|---|--------------|-----------|----------|---------------|--------|-------|----------------|`);
      for (const r of trace.rows.slice(0, 60)) {
        const idx = r.sourceRowIndex ?? '—';
        const name = String(r.printedName || '—').replace(/\|/g, '/');
        const val = r.rawValue != null ? String(r.rawValue).replace(/\|/g, '/') : '—';
        const unit = String(r.rawUnit || '—').replace(/\|/g, '/');
        const key = String(r.canonicalKey || '—').replace(/\|/g, '/');
        const bucket = String(r.bucket || '—').replace(/\|/g, '/');
        const cls = String(r.class || '—').replace(/\|/g, '/');
        const why = String(r.why || r.comment || '—').replace(/\|/g, '/');
        lines.push(`| ${idx} | ${name} | ${val} | ${unit} | ${key} | ${bucket} | ${cls} | ${why} |`);
      }
    }
    lines.push('');
  }

  // Health Coach / Analysis Report (health-baseline-analyze and similar routes
  // nest their full structured output under `report` — without this section the
  // debug export looked "empty" even though the backend generated real data.
  if (input.report != null) {
    lines.push(`## 🩺 Health Coach / Analysis Report`);
    lines.push('');
    if (typeof input.report === 'string') {
      if (input.report.trim()) {
        lines.push(input.report.slice(0, 20_000));
      } else {
        lines.push('_Report field present but empty._');
      }
    } else {
      lines.push('```json');
      try {
        lines.push(JSON.stringify(input.report, null, 2).slice(0, 20_000));
      } catch {
        lines.push('_Report field present but could not be serialized._');
      }
      lines.push('```');
    }
    lines.push('');
  }

  // Prior conversation turns, so "previous steps" leading up to this job are
  // visible instead of only the current turn in isolation.
  if (input.conversationHistory) {
    lines.push(`## 📜 Conversation History (Previous Steps)`);
    lines.push('');
    if (input.conversationHistory.length > 0) {
      for (const turn of input.conversationHistory) {
        const roleLabel = turn.role === 'user' ? '👤 User' : turn.role === 'assistant' ? '🤖 Assistant' : turn.role;
        const content = String(turn.content || '').slice(0, 1000);
        lines.push(`**${roleLabel}:** ${content}`);
        lines.push('');
      }
    } else {
      lines.push('_This was the first message in the conversation — no previous steps._');
      lines.push('');
    }
  }

  // 1. Last User Action
  lines.push(`## 👤 Last User Action`);
  lines.push('');
  if (input.lastUserAction) {
    if (typeof input.lastUserAction === 'object') {
      const act = input.lastUserAction;
      if (act.action) lines.push(`- **Action:** ${act.action}`);
      if (act.text || act.prompt) lines.push(`- **Prompt/Text:** "${act.text || act.prompt}"`);
      if (act.timestamp) lines.push(`- **Timestamp:** ${act.timestamp}`);
      if (act.details) lines.push(`- **Details:** ${JSON.stringify(act.details)}`);
    } else {
      lines.push(`- ${String(input.lastUserAction)}`);
    }
  } else {
    lines.push(`_No specific last user action recorded._`);
  }
  lines.push('');

  // 1b. User Action Breadcrumbs (Event Trail)
  lines.push(`## 🐾 User Action Breadcrumbs`);
  lines.push('');
  if (Array.isArray(input.userActionBreadcrumbs) && input.userActionBreadcrumbs.length > 0) {
    lines.push(`| Timestamp | Action | Target / Context | Details |`);
    lines.push(`|-----------|--------|------------------|---------|`);
    for (const b of input.userActionBreadcrumbs.slice(-50)) {
      const ts = b.timestamp ? b.timestamp.slice(11, 19) : '—';
      const act = String(b.action || 'event').replace(/\|/g, '/');
      const tgt = String(b.target || '—').replace(/\|/g, '/');
      const rawDet = typeof b.details === 'object' ? JSON.stringify(b.details) : (b.details != null ? String(b.details) : '—');
      const det = rawDet.replace(/\|/g, '/');
      lines.push(`| ${ts} | ${act} | ${tgt} | ${det} |`);
    }
  } else {
    lines.push(`_No user UI interaction breadcrumbs captured prior to submission._`);
  }
  lines.push('');

  // 2. Console & Network Diagnostics
  lines.push(`## 🌐 Console & Network Diagnostics`);
  lines.push('');
  if (Array.isArray(input.networkErrors) && input.networkErrors.length > 0) {
    lines.push(`### Network Request Warnings & Errors (${input.networkErrors.length})`);
    lines.push('```');
    input.networkErrors.slice(-20).forEach(n => lines.push(n));
    lines.push('```');
    lines.push('');
  } else {
    lines.push(`_No client network errors or latency warnings recorded._`);
    lines.push('');
  }

  if (Array.isArray(input.clientConsoleLogs) && input.clientConsoleLogs.length > 0) {
    lines.push(`### Client Console Logs (${input.clientConsoleLogs.length})`);
    lines.push('```');
    input.clientConsoleLogs.slice(-25).forEach(l => lines.push(l));
    lines.push('```');
    lines.push('');
  } else {
    lines.push(`_No client console warnings or errors recorded._`);
    lines.push('');
  }

  // 3. Vision Scout Phase
  if ((Array.isArray(input.scoutItems) && input.scoutItems.length > 0) || input.rawScout || input.scoutInternalReasoning) {
    const scoutCount = Array.isArray(input.scoutItems) ? input.scoutItems.length : (input.rawScout?.items?.length || 0);
    lines.push(`## 🔍 Vision Scout Results (${scoutCount} item(s) detected)`);
    lines.push('');

    // Extract scout internal reasoning if not provided directly
    let scoutReasoning = input.scoutInternalReasoning;
    if (!scoutReasoning && input.backendLogs) {
      const match = input.backendLogs.match(/\[Vision Scout Internal Reasoning\]\s*([^\n\r]+)/);
      if (match) {
        scoutReasoning = match[1].trim();
      } else {
        const jsonMatch = input.backendLogs.match(/"_internalReasoning":\s*"([^"\\]*(?:\\.[^"\\]*)*)"/);
        if (jsonMatch) {
          try {
            scoutReasoning = JSON.parse(`"${jsonMatch[1]}"`);
          } catch {
            scoutReasoning = jsonMatch[1];
          }
        }
      }
    }

    if (scoutReasoning) {
      lines.push(`> **Scout Internal Reasoning:** ${scoutReasoning}`);
      lines.push('');
    }

    const envDetails: string[] = [];
    if (input.diningEnvironment && input.diningEnvironment !== 'unknown') {
      envDetails.push(`**Dining Environment:** \`${input.diningEnvironment}\``);
    }
    if (input.scoutContentType) {
      envDetails.push(`**Content Type:** \`${input.scoutContentType}\``);
    }
    if (envDetails.length > 0) {
      lines.push(envDetails.join(' | '));
      lines.push('');
    }

    if (Array.isArray(input.scoutItems) && input.scoutItems.length > 0) {
      lines.push(`| # | Dish / Item | Weight | Bounding Box | Img | Method | Label / Sticker OCR | Constituent Ingredients |`);
      lines.push(`|---|-------------|--------|--------------|-----|--------|---------------------|-------------------------|`);
      for (let idx = 0; idx < Math.min(input.scoutItems.length, 30); idx++) {
        const it = input.scoutItems[idx];
        const num = `[${idx + 1}]`;
        const nm = String(it.originalName || it.keyword || it.name || 'item').replace(/\|/g, '/');
        const w = `${it.estimatedWeightGrams ?? it.weightGrams ?? '?'}${it.packGrams ? ` (Pack: ${it.packGrams}g)` : 'g'}`;
        const box = Array.isArray(it.boundingBox2D) ? `[${it.boundingBox2D.join(',')}]` : '—';
        const img = `#${it.sourceImageIndex ?? 0}`;
        const method = String(it.cookingMethod || '—').replace(/\|/g, '/');
        const label = it.packageLabelText
          ? String(it.packageLabelText).replace(/\|/g, '/')
          : (it.rawNutritionLabel ? JSON.stringify(it.rawNutritionLabel).slice(0, 35).replace(/\|/g, '/') : '—');
        
        let compSummary = '—';
        if (Array.isArray(it.components) && it.components.length > 0) {
          compSummary = it.components.map((c: any) => {
            const cn = c.name || c.searchQuery || 'ingredient';
            const cw = c.weightGrams ?? c.estimatedWeightGrams ?? '?';
            const clbl = c.packageLabelText ? ` ("${c.packageLabelText}")` : '';
            return `${cn} (${cw}g${clbl})`;
          }).join('; ').replace(/\|/g, '/');
        } else if (Array.isArray(it.visualIngredients) && it.visualIngredients.length > 0) {
          compSummary = it.visualIngredients.join(', ').replace(/\|/g, '/');
        }
        lines.push(`| ${num} | ${nm} | ${w} | ${box} | ${img} | ${method} | ${label} | ${compSummary} |`);
      }
      lines.push('');

      // Sub-table: Itemized Constituent Ingredients & Stickers breakdown
      const allComponents: any[] = [];
      input.scoutItems.forEach((it) => {
        if (Array.isArray(it.components) && it.components.length > 0) {
          it.components.forEach((c: any) => {
            allComponents.push({ dishName: it.originalName || it.name || it.keyword, ...c });
          });
        }
      });

      if (allComponents.length > 0) {
        lines.push(`### 🥗 Itemized Constituent Ingredients & Stickers (${allComponents.length})`);
        lines.push('');
        lines.push(`| Parent Dish | Component / Food | Weight | Img # | Sticker Text / Label | Macros (P / C / F / Na) |`);
        lines.push(`|-------------|------------------|--------|-------|----------------------|-------------------------|`);
        for (const c of allComponents.slice(0, 50)) {
          const pDish = String(c.dishName || '—').replace(/\|/g, '/');
          const cName = String(c.name || c.searchQuery || 'ingredient').replace(/\|/g, '/');
          const cw = `${c.weightGrams ?? c.estimatedWeightGrams ?? '?'}${c.packGrams ? ` (Pack: ${c.packGrams}g)` : 'g'}`;
          const imgIdx = `#${c.sourceImageIndex ?? 0}`;
          const sticker = c.packageLabelText ? `"${String(c.packageLabelText).replace(/\|/g, '/')}"` : (c.rawNutritionLabel ? 'Printed Label' : '—');
          const p = c.protein ?? c.nutrients?.protein ?? '?';
          const carbs = c.carbohydrates ?? c.carbs ?? c.nutrients?.carbohydrates ?? '?';
          const f = c.fat ?? c.totalFat ?? c.nutrients?.totalFat ?? '?';
          const na = c.sodium ?? c.nutrients?.sodium ?? '?';
          const nuts = `P: ${p}g, C: ${carbs}g, F: ${f}g, Na: ${na}mg`;
          lines.push(`| ${pDish} | ${cName} | ${cw} | ${imgIdx} | ${sticker} | ${nuts} |`);
        }
        lines.push('');
      }
    }

    if (input.rawScout) {
      lines.push(`### 📋 Raw Scout Structured JSON`);
      lines.push('```json');
      lines.push(JSON.stringify(input.rawScout, null, 2).slice(0, 25_000));
      lines.push('```');
      lines.push('');
    }
  }

  // 4. Database Search & Entity Resolution
  if ((Array.isArray(input.usdaSearchResults) && input.usdaSearchResults.length > 0) || (Array.isArray(input.brandSearchResults) && input.brandSearchResults.length > 0)) {
    lines.push(`## 📚 Database Search & Entity Resolution`);
    lines.push('');
    if (Array.isArray(input.brandSearchResults) && input.brandSearchResults.length > 0) {
      lines.push(`### Official Brand Menu Hits (${input.brandSearchResults.length})`);
      for (const b of input.brandSearchResults.slice(0, 10)) {
        lines.push(`- **${b.name || b.dish_name}** (${b.chainName || b.chain_key || 'Brand'}) — ${b.calories || '?'} kcal | P: ${b.protein ?? '?'}g, C: ${b.carbohydrates ?? '?'}g, F: ${b.fat ?? '?'}g | Source: \`${b.source || 'brand_official'}\``);
      }
      lines.push('');
    }
    if (Array.isArray(input.usdaSearchResults) && input.usdaSearchResults.length > 0) {
      lines.push(`### USDA / OpenFoodFacts Matches (${input.usdaSearchResults.length})`);
      for (const u of input.usdaSearchResults.slice(0, 10)) {
        lines.push(`- **${u.description || u.name}** (FDC/ID: \`${u.fdcId || u.id}\`) — ${u.calories || '?'} kcal | Source: ${u.dataType || u.source || 'USDA'}`);
      }
      lines.push('');
    }
  }

  // 5. Nutrition Calculation (Source of Truth)
  const food = input.pendingFoodLog;
  if (food && typeof food === 'object' && input.agentType !== 'biomarker_review' && input.mode !== 'biomarker_review') {
    lines.push(`## 📊 Nutrition Calculation & Breakdown`);
    lines.push('');
    lines.push(`- **Meal Name:** ${food.name || food.title || '—'}`);
    if (food.quantity) lines.push(`- **Quantity:** ${food.quantity}`);
    if (food.weightGrams != null) lines.push(`- **Total Meal Weight:** ${food.weightGrams}g`);

    // Nutrition Receipt Table
    const receipt = input.receiptTable || food.receiptTable;
    if (Array.isArray(receipt) && receipt.length > 0) {
      lines.push('');
      lines.push(`### 🧾 Itemized Nutrition Calculation Receipt`);
      lines.push('');
      lines.push(`| Item / Ingredient | Weight | Kcal | Protein | Sat Fat | Sodium | Source / Notes |`);
      lines.push(`|-------------------|-------:|-----:|--------:|-------:|-------:|----------------|`);
      for (const row of receipt.slice(0, 50)) {
        const item = String(row.item || row.name || row.food || '—').replace(/\|/g, '/');
        const weight = row.weight ? `${row.weight}g` : '—';
        const kcal = row.calories ?? row.kcal ?? '—';
        const protein = row.protein ? `${row.protein}g` : '—';
        const satFat = row.satFat || row.saturatedFat ? `${row.satFat || row.saturatedFat}g` : '—';
        const sodium = row.sodium ? `${row.sodium}mg` : '—';
        const src = String(row.source || row.truthSource || row.notes || '—').replace(/\|/g, '/').slice(0, 60);
        lines.push(`| ${item} | ${weight} | ${kcal} | ${protein} | ${satFat} | ${sodium} | ${src} |`);
      }
      lines.push('');
    } else if (Array.isArray(food.itemsBreakdown) && food.itemsBreakdown.length > 0) {
      lines.push('');
      lines.push(`### Component Items Breakdown`);
      lines.push('');
      lines.push(`| Component | Weight | Calories | Protein | Carbs | Fat | Brand / Truth Source |`);
      lines.push(`|-----------|-------:|---------:|--------:|------:|----:|---------------------|`);
      for (const it of food.itemsBreakdown.slice(0, 40)) {
        const nm = String(it.originalName || it.canonicalDbName || it.name || it.keyword || 'item').replace(/\|/g, '/');
        const w = it.weightGrams ?? it.estimatedWeightGrams ?? '—';
        const cal = it.nutrients?.calories ?? it.calories ?? '—';
        const p = it.nutrients?.protein ?? '—';
        const c = it.nutrients?.carbohydrates ?? '—';
        const f = it.nutrients?.totalFat ?? '—';
        const src = String(it.brandName || it.source || it.truthSource || '—').replace(/\|/g, '/');
        lines.push(`| ${nm} | ${w}g | ${cal} | ${p}g | ${c}g | ${f}g | ${src} |`);
      }
      lines.push('');
    }

    // Comprehensive 31 Nutrients Table
    const n = input.comprehensiveNutrients || food.nutrients || {};
    if (n && typeof n === 'object') {
      lines.push(`### 📋 Comprehensive Nutrient Values`);
      lines.push('');
      lines.push(`| Nutrient | Value |`);
      lines.push(`|----------|------:|`);
      const coreKeys: Array<[string, string]> = [
        ['Calories', 'calories'],
        ['Protein', 'protein'],
        ['Carbohydrates', 'carbohydrates'],
        ['Total Fat', 'totalFat'],
        ['Saturated Fat', 'saturatedFat'],
        ['Trans Fat', 'transFat'],
        ['Total Sugar', 'totalSugar'],
        ['Added Sugar', 'addedSugar'],
        ['Sodium', 'sodium'],
        ['Dietary Fiber', 'totalFibre'],
        ['Salt', 'salt']
      ];
      for (const [label, k] of coreKeys) {
        if (n[k] != null && n[k] !== '') {
          const unit = k === 'calories' ? ' kcal' : k === 'sodium' ? ' mg' : ' g';
          lines.push(`| **${label}** | **${n[k]}${unit}** |`);
        }
      }
      // Additional nutrients if present. Units per USDA FDC convention: macro minerals in
      // mg, fat-soluble vitamins and trace minerals mostly in mcg, B-vitamins in mg except
      // B12/folate in mcg.
      const extraKeys: Array<[string, string, string]> = [
        ['Cholesterol', 'cholesterol', 'mg'],
        ['Calcium', 'calcium', 'mg'],
        ['Iron', 'iron', 'mg'],
        ['Potassium', 'potassium', 'mg'],
        ['Vitamin A', 'vitaminA', 'mcg'],
        ['Vitamin C', 'vitaminC', 'mg'],
        ['Vitamin D', 'vitaminD', 'mcg'],
        ['Vitamin E', 'vitaminE', 'mg'],
        ['Vitamin K', 'vitaminK', 'mcg'],
        ['Thiamin (B1)', 'thiamin', 'mg'],
        ['Riboflavin (B2)', 'riboflavin', 'mg'],
        ['Niacin (B3)', 'niacin', 'mg'],
        ['Vitamin B6', 'vitaminB6', 'mg'],
        ['Vitamin B12', 'vitaminB12', 'mcg'],
        ['Folate', 'folate', 'mcg'],
        ['Phosphorus', 'phosphorus', 'mg'],
        ['Magnesium', 'magnesium', 'mg'],
        ['Zinc', 'zinc', 'mg'],
        ['Copper', 'copper', 'mg'],
        ['Selenium', 'selenium', 'mcg']
      ];
      for (const [label, k, unit] of extraKeys) {
        if (n[k] != null && n[k] !== '') {
          const val = Number(n[k]);
          const display = isNaN(val) ? 'N/A' : `${val} ${unit}`;
          lines.push(`| ${label} | ${display} |`);
        }
      }
      lines.push('');
    }
  }

  // 6. Agent Message / Verdict Narrative
  if (input.message) {
    lines.push(`## 💬 Dietitian & Agent Narrative`);
    lines.push('');
    lines.push(String(input.message).slice(0, 8000));
    lines.push('');
  }

  // 7. Stage Ledger & History Log
  if (Array.isArray(input.stageLedger) && input.stageLedger.length > 0) {
    lines.push(`## ⚙️ Pipeline Stage Ledger`);
    lines.push('');
    lines.push(`| Stage | Status | Attempt | Key Decisions | Errors |`);
    lines.push(`|-------|--------|---------|---------------|--------|`);
    for (const record of input.stageLedger) {
      const decisions = (record.decisions || []).map((d: any) => d.key).join(', ');
      const errors = (record.errors || []).map((e: any) => e.message).join(', ');
      lines.push(`| ${record.stage || '—'} | ${record.status || '—'} | ${record.attempt || '—'} | ${decisions || '—'} | ${errors || '—'} |`);
    }
    lines.push('');
  }

  if (Array.isArray(input.historyLog) && input.historyLog.length > 0) {
    lines.push(`## 📜 Execution History Log`);
    lines.push('');
    for (const entry of input.historyLog.slice(-100)) {
      const when = entry.at || entry.timestamp || '';
      const kind = entry.kind || entry.type || 'event';
      const msg = entry.message || '';
      const det = entry.detail || entry.details ? ` (${entry.detail || entry.details})` : '';
      lines.push(`- **${when}** [${kind}]: ${msg}${det}`);
    }
    lines.push('');
  }

  // 8. Backend Execution Logs (deduplicated)
  const logs = String(input.backendLogs || '').trim();

  // Extract "Agent Instructions & Prompts Dispatched" and "Errors & Warnings"
  // summaries directly from the raw backend log text, AND collapse those same
  // blocks (plus large raw-LLM-response dumps that duplicate an
  // already-parsed structured section like the Health Coach Report) out of
  // the raw dump below, so identical content isn't shown twice in one export.
  // This is deliberately text-based (not tied to a specific field a backend
  // route must populate) so it works uniformly across every agent's log
  // format without requiring per-route wiring.
  let dedupedLogs = logs;
  if (logs) {
    const logLines = logs.split('\n');
    const collapsedLineIndices = new Set<number>();

    const instructionBlocks: string[] = [];
    const instructionStartPattern = /(Dispatched System Instruction|Dispatched Prompt|System Instruction:|UnifiedLLM-Prompt|Instruction dispatched)/i;
    for (let i = 0; i < logLines.length; i++) {
      if (instructionStartPattern.test(logLines[i])) {
        const block: string[] = [logLines[i]];
        let j = i + 1;
        while (j < logLines.length && !/^\[[A-Za-z]/.test(logLines[j]) && block.join('\n').length < 4000) {
          block.push(logLines[j]);
          j++;
        }
        instructionBlocks.push(block.join('\n').trim());
        for (let k = i; k < j; k++) collapsedLineIndices.add(k);
      }
    }
    if (instructionBlocks.length > 0) {
      lines.push(`## 🧠 Agent Instructions & Prompts Dispatched`);
      lines.push('');
      lines.push(`_Extracted from backend logs — ${instructionBlocks.length} dispatch(es) found. Shown here only; collapsed below to avoid duplication._`);
      lines.push('');
      for (const block of instructionBlocks.slice(0, 10)) {
        lines.push('```');
        lines.push(block.slice(0, 4000));
        lines.push('```');
        lines.push('');
      }
    }

    // Raw LLM response dumps (e.g. "Response received (N chars). Raw output:
    // {...}") usually duplicate a structured section already shown above
    // (like the Health Coach / Analysis Report). Collapse them too, keeping
    // the one-line summary that announces them.
    const responseStartPattern = /Response received \(\d+ chars\)\.\s*Raw output:/i;
    for (let i = 0; i < logLines.length; i++) {
      if (responseStartPattern.test(logLines[i]) && !collapsedLineIndices.has(i)) {
        let j = i + 1;
        while (j < logLines.length && !/^\[[A-Za-z]/.test(logLines[j])) {
          collapsedLineIndices.add(j);
          j++;
        }
      }
    }

    const errorLines = logLines.filter((l) => /^\[error\]/i.test(l.trim()) || /\bError:\s/i.test(l));
    lines.push(`## ⚠️ Errors & Warnings`);
    lines.push('');
    if (errorLines.length > 0) {
      for (const el of errorLines.slice(0, 40)) {
        lines.push(`- ${el.trim().slice(0, 500)}`);
      }
    } else {
      lines.push('_No errors or warnings found in the backend logs captured for this job._');
    }
    lines.push('');

    if (collapsedLineIndices.size > 0) {
      const displayLines: string[] = [];
      let lastWasMarker = false;
      for (let i = 0; i < logLines.length; i++) {
        if (collapsedLineIndices.has(i)) {
          if (!lastWasMarker) {
            displayLines.push('  [... full content omitted here — see the extracted section above to avoid showing it twice ...]');
            lastWasMarker = true;
          }
          continue;
        }
        lastWasMarker = false;
        displayLines.push(logLines[i]);
      }
      dedupedLogs = displayLines.join('\n');
    }
  }

  lines.push(`## 🖥️ Backend Execution Logs`);
  lines.push('');
  if (dedupedLogs) {
    lines.push('```');
    lines.push(dedupedLogs.slice(0, 180_000));
    lines.push('```');
  } else {
    lines.push('_No backend logs recorded in this export._');
  }
  lines.push('');
  lines.push(`---`);
  lines.push(`_Generated by Health Tracker debug export. Images are omitted to prevent bloat._`);
  lines.push('');
  return lines.join('\n');
}

/** Build report input from a job shell + message bubble. */
export function debugReportFromJobMsg(job: any, msg: any): DebugReportInput {
  const result = job?.result || msg?.data || {};
  const food =
    result.pendingFoodLog ||
    result.data ||
    msg?.pendingFoodLog ||
    msg?.data?.pendingFoodLog;
  const logs =
    result.backendLogs ||
    msg?.data?.agentResult?.backendLogs ||
    msg?.data?.agentResult?.globalLiveLogs ||
    job?.liveThoughts?.backendLogs ||
    '';
  return {
    jobId: job?.id || msg?.id,
    status: job?.status,
    mode: result.mode || job?.inputSnapshot?.mode,
    agentType: msg?.agentType || job?.inputSnapshot?.agentType,
    message: result.message || result.text || msg?.content,
    backendLogs: typeof logs === 'string' ? logs : String(logs || ''),
    pendingFoodLog: food,
    scoutItems: result.scoutItems || msg?.data?.scoutItems,
    scoutInternalReasoning:
      result.scoutInternalReasoning ||
      result.scoutReasoning ||
      food?.scoutInternalReasoning ||
      msg?.data?.scoutInternalReasoning ||
      msg?.data?.agentResult?.scoutInternalReasoning,
    rawScout: result.rawScout || result.scoutResult || msg?.data?.rawScout || food?.rawScout,
    scoutContentType: result.scoutContentType || result.visionScoutContentType || msg?.data?.scoutContentType,
    diningEnvironment: result.diningEnvironment || food?.diningEnvironment || msg?.data?.diningEnvironment,
    receiptTable: food?.receiptTable || result.receiptTable,
    error: job?.error?.message || result.error,
    debugUrl: result.debugUrl || msg?.data?.debugUrl || job?.debugUrl,
    photoUrl: result.photoUrl || job?.photoUrl || msg?.data?.photoUrl,
    exportedAt: new Date().toISOString(),
    degradedStages: result.degradedStages,
    lastUserAction: result.lastUserAction || msg?.data?.lastUserAction,
    userActionBreadcrumbs: result.userActionBreadcrumbs || msg?.data?.userActionBreadcrumbs || job?.inputSnapshot?.userActionBreadcrumbs,
    clientConsoleLogs: result.clientConsoleLogs || msg?.data?.clientConsoleLogs,
    networkErrors: result.networkErrors || msg?.data?.networkErrors,
    usdaSearchResults: result.usdaSearchResults,
    brandSearchResults: result.brandSearchResults,
    comprehensiveNutrients: result.comprehensiveNutrients || food?.nutrients,
    stageLedger: result.stageLedger,
    historyLog: result.historyLog,
    ingestTrace: result.ingestTrace || msg?.data?.ingestTrace || msg?.data?.agentResult?.ingestTrace || job?.clean_result?.ingestTrace,
    report: result.report || msg?.data?.report || msg?.data?.agentResult?.report || job?.clean_result?.report
  };
}

/* export function stripHeavyImages export function coldDebugR2Key debug/${uid}/${jid}.json export function buildDebugMarkdownReport */
