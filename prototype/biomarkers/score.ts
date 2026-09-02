import { isCatalogKey, isOptimalLabel } from "./backoffice.ts";
import type { ClassifiedRow, ExpectedFile, FillRow, ProfileFixture } from "./schema.ts";

function sentenceCount(text: string): number {
  const t = text
    .replace(/\d+\.\d+/g, "0")
    .replace(/mL\/min\/1\.73m2/gi, "u")
    .trim();
  const parts = t.split(/(?<=[.!?])\s+(?=[A-Z])/).filter((s) => s.replace(/[.!?]/g, "").trim().length > 0);
  return Math.max(parts.length, t ? 1 : 0);
}

function citesProfile(insight: string, profile?: ProfileFixture): boolean {
  if (!profile) return true;
  const t = insight.toLowerCase();
  const bits = [String(profile.age || ""), (profile.gender || "").toLowerCase(), (profile.ethnicity || "").toLowerCase()].filter(
    (b) => b.length > 1
  );
  return bits.some((b) => t.includes(b));
}

export interface ScoreFail {
  id: string;
  printed: string;
  check: string;
  detail: string;
}

export function scoreBiomarkersCase(opts: {
  classified: ClassifiedRow[];
  filled: FillRow[];
  expected: ExpectedFile;
  turns: number;
  remaining: string[];
  requireInsight?: boolean;
  profile?: ProfileFixture;
}): { pass: boolean; fails: ScoreFail[]; known: number; unknown: number; turns: number } {
  const fails: ScoreFail[] = [];
  const byPrinted = new Map(opts.filled.map((r) => [r.printed.toLowerCase(), r]));
  const classByPrinted = new Map(opts.classified.map((r) => [r.printed.toLowerCase(), r]));

  if (opts.remaining.length) {
    fails.push({
      id: "remaining",
      printed: "",
      check: "remaining_drained",
      detail: `leftover ids: ${opts.remaining.join(", ")}`,
    });
  }

  if (opts.expected.expectRowCount !== -1 && opts.filled.length !== opts.expected.expectRowCount) {
    fails.push({
      id: "count",
      printed: "",
      check: "row_count",
      detail: `filled ${opts.filled.length} expected ${opts.expected.expectRowCount}`,
    });
  }

  for (const exp of opts.expected.rows) {
    const got = byPrinted.get(exp.printed.toLowerCase());
    const cls = classByPrinted.get(exp.printed.toLowerCase());
    if (!got) {
      fails.push({
        id: cls?.id || "?",
        printed: exp.printed,
        check: "missing_row",
        detail: "not in agent output after continuation",
      });
      continue;
    }
    if (got.value !== exp.value) {
      fails.push({ id: got.id, printed: exp.printed, check: "value", detail: `${got.value} != ${exp.value}` });
    }
    if (got.writeTarget !== exp.writeTarget) {
      fails.push({
        id: got.id,
        printed: exp.printed,
        check: "writeTarget",
        detail: `${got.writeTarget} != ${exp.writeTarget}`,
      });
    }
    if (exp.writeTarget === "observation") {
      if (got.key !== exp.key) {
        fails.push({ id: got.id, printed: exp.printed, check: "key", detail: `${got.key} != ${exp.key}` });
      }
      if (got.match === "none") {
        fails.push({ id: got.id, printed: exp.printed, check: "match", detail: "hit marked none" });
      }
      if (got.newCatalogDraft) {
        fails.push({ id: got.id, printed: exp.printed, check: "no_draft_on_hit", detail: "pending draft on catalog hit" });
      }
      const cls = classByPrinted.get(exp.printed.toLowerCase());
      const status = cls?.template.currentEvaluationStatus || "";
      if (exp.expectStatus && status && status !== exp.expectStatus) {
        fails.push({
          id: got.id,
          printed: exp.printed,
          check: "status_label",
          detail: `computed "${status}" != expected "${exp.expectStatus}"`,
        });
      }
      if (status && /critical/i.test(status) && cls?.template.key !== "bmi") {
        fails.push({
          id: got.id,
          printed: exp.printed,
          check: "status_not_critical",
          detail: `status is "${status}"`,
        });
      }
      if (opts.requireInsight && cls) {
        const insight = (got.medicalInsight || cls.template.medicalInsight || "").trim();
        if (!insight) {
          fails.push({ id: got.id, printed: exp.printed, check: "medicalInsight", detail: "hit missing personalised insight" });
        } else {
          if (/critical/i.test(insight)) {
            fails.push({
              id: got.id,
              printed: exp.printed,
              check: "insight_no_critical",
              detail: "insight used Critical on a chronic marker",
            });
          }
          const nSent = sentenceCount(insight);
          if (nSent > 3) {
            fails.push({
              id: got.id,
              printed: exp.printed,
              check: "insight_length",
              detail: `insight has ${nSent} sentences; want ≤3`,
            });
          }
          const prev = cls.template.historicalLogs
            .filter((h) => !(h.date === cls.date && h.value === cls.value))
            .sort((a, b) => a.date.localeCompare(b.date))
            .pop();
          if (!cls.template.existingInsight && prev && prev.value !== cls.value && !insight.includes(String(prev.value))) {
            fails.push({
              id: got.id,
              printed: exp.printed,
              check: "insight_cites_trend",
              detail: `did not mention previous value ${prev.value}`,
            });
          }
          if (cls.template.key === "hba1c") {
            if (/above the standard reference range\s*\(\s*20\s*-\s*41/i.test(insight)) {
              fails.push({
                id: got.id,
                printed: exp.printed,
                check: "hba1c_range_lie",
                detail: "40 is inside 20-41; Elevated comes from brackets >=39",
              });
            }
            const overlay = cls.template.customRangeOverlay || "";
            if (!overlay || !/(39|42)/.test(overlay) || !/(elevated|borderline|optimal|normal)/i.test(overlay)) {
              fails.push({
                id: got.id,
                printed: exp.printed,
                check: "hba1c_custom_range_full",
                detail: `customRangeOverlay must be full bracketed range; got "${overlay}"`,
              });
            }
            const opt = String(cls.template.optimalValue || "");
            if (/\d+\s*-\s*\d+/.test(opt)) {
              fails.push({
                id: got.id,
                printed: exp.printed,
                check: "hba1c_optimal_single",
                detail: `optimalValue should be 1 value, not a range; got "${opt}"`,
              });
            }
          }
          if (cls.template.key === "egfr") {
            const opt = String(cls.template.optimalValue || "");
            if (/^60\b/i.test(opt) || opt === "60 mL/min/1.73m2") {
              fails.push({
                id: got.id,
                printed: exp.printed,
                check: "egfr_optimal_corrected",
                detail: `optimalValue must be corrected from naive 60; got "${opt}"`,
              });
            }
            if (!cls.template.editReason) {
              fails.push({
                id: got.id,
                printed: exp.printed,
                check: "egfr_edit_reason",
                detail: "missing editReason explaining correction of naive normal eGFR",
              });
            }
          }
          if (cls.template.key === "creatinine") {
            const usLog = cls.template.historicalLogs.find((l) => l.date === "2024-10-15");
            if (usLog && usLog.unit && !/umol\/L/i.test(usLog.unit)) {
              fails.push({
                id: got.id,
                printed: exp.printed,
                check: "creatinine_unit_conversion",
                detail: `10/15/2024 log unit should be converted to SI umol/L; got "${usLog.unit}" with value ${usLog.value}`,
              });
            }
          }
          if (cls.template.key === "total_protein") {
            const corr = cls.template.dictionaryCorrection;
            if (!corr || !/normalrange/i.test(corr.field) || !/60\s*-\s*80/i.test(corr.correctedValue)) {
              fails.push({
                id: got.id,
                printed: exp.printed,
                check: "total_protein_dictionary_correction",
                detail: `expected dictionaryCorrection for normalRange with corrected value 60 - 80 g/L; got ${JSON.stringify(corr)}`,
              });
            }
          }
        }
      }
      if (got.key && !isCatalogKey(got.key)) {
        fails.push({ id: got.id, printed: exp.printed, check: "catalog_key", detail: `not in biomarkerDefinitions: ${got.key}` });
      }
    } else {
      if (got.match !== "none") {
        fails.push({ id: got.id, printed: exp.printed, check: "match", detail: `unknown marked ${got.match}` });
      }
      if (got.key && isCatalogKey(got.key)) {
        fails.push({
          id: got.id,
          printed: exp.printed,
          check: "unknown_not_existing_key",
          detail: `bound to catalog key ${got.key}`,
        });
      }
      if (!got.newCatalogDraft) {
        fails.push({ id: got.id, printed: exp.printed, check: "newCatalogDraft", detail: "missing draft" });
      }
      if (opts.requireInsight) {
        const insight = (got.medicalInsight || cls?.template.medicalInsight || "").trim();
        if (!insight) {
          fails.push({ id: got.id, printed: exp.printed, check: "medicalInsight", detail: "miss missing personalised insight" });
        }
      }
    }
  }

  const known = opts.classified.filter((r) => r.writeTarget === "observation").length;
  const unknown = opts.classified.filter((r) => r.writeTarget === "pending").length;
  return { pass: fails.length === 0, fails, known, unknown, turns: opts.turns };
}

export const scoreC2 = scoreBiomarkersCase;
