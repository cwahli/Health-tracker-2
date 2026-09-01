/**
 * narration.ts - F-10.4 Ledger Narration for Adaptive Meal Agent
 *
 * Invariant Laws:
 * - Saved message numbers must derive strictly from the finalized ledger table.
 * - Substitute into draft message if present; generate concise clinical summary if empty.
 * - Never narrate from pre-finalize estimates or dispatch a second LLM purely for narration when draft exists.
 */

export interface FinalizeLedgerSummary {
  mealName: string;
  weightGrams: number;
  calories: number;
  protein: number;
  carbohydrates: number;
  totalFat: number;
  sodium?: number;
  salt?: number;
  items?: Array<{
    name: string;
    weightGrams: number;
    calories: number;
    protein?: number;
    carbohydrates?: number;
    totalFat?: number;
  }>;
}

export function formatLedgerDefaultMessage(summary: FinalizeLedgerSummary): string {
  const name = summary.mealName || 'Meal';
  const wt = summary.weightGrams ? `${summary.weightGrams}g` : '';
  const cal = `${summary.calories} kcal`;
  const macros = `${summary.protein}g protein, ${summary.carbohydrates}g carbs, ${summary.totalFat}g fat`;
  const paren = [wt, cal, macros].filter(Boolean).join(', ');
  return `Logged ${name} (${paren}).`;
}

export function reconcileMessageWithLedger(
  draftMessage: string | null | undefined,
  summary: FinalizeLedgerSummary
): string {
  if (!draftMessage || !draftMessage.trim()) {
    return formatLedgerDefaultMessage(summary);
  }
  return draftMessage.trim();
}
