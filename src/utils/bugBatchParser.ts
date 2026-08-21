/**
 * bugBatchParser.ts
 *
 * Utilities for splitting a single pasted block of text (multiline, bulleted,
 * numbered, or concatenated topic:description paragraphs) into individual bug items.
 */

export interface ParsedBugItem {
  text: string;
  title?: string;
  detail?: string;
}

/**
 * Strips leading bullet points, numbering, checkboxes, or markdown markers.
 */
export function cleanBugLine(raw: string): string {
  if (!raw) return '';
  return raw
    .trim()
    // Markdown / list bullets: - , * , • , – , — , + , ▪ , ▫
    .replace(/^[-*•–—+▪▫]\s+/, '')
    // Checkbox brackets: [ ], [x], [X], - [ ], etc.
    .replace(/^\[[ xX]?\]\s*/, '')
    // Numbering: 1., 1), (1), [1], 1:, #1, 1 -, Bug 1:, Issue 1:
    .replace(/^(?:(?:bug|issue|item)\s*#?\d+[:.-]?|\(?\d+\)[.:-]?|\[\d+\][:.-]?|\d+[.:\-])\s+/i, '')
    .trim();
}

/**
 * Splits a text string containing multiple bugs into an array of cleaned bug strings.
 */
export function parseBatchBugs(text: string): string[] {
  if (!text || typeof text !== 'string') return [];
  const rawTrimmed = text.trim();
  if (!rawTrimmed) return [];

  // 1. Check if the text contains multiple lines
  const lines = rawTrimmed
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  // If text already has multiple distinct lines
  if (lines.length > 1) {
    const results: string[] = [];
    for (const line of lines) {
      const cleaned = cleanBugLine(line);
      if (!cleaned) continue;

      // Check if this single line itself contains multiple "Header: Detail. Header2: Detail"
      const subItems = splitInlineTopicBugs(cleaned);
      if (subItems.length > 1) {
        results.push(...subItems);
      } else {
        results.push(cleaned);
      }
    }
    if (results.length > 0) {
      return dedupeAndFilter(results);
    }
  }

  // 2. If it's a single line or paragraph, check for inline bullet points or numbered separators
  // e.g. "1. Bug one 2. Bug two 3. Bug three" or "• Bug one • Bug two"
  const bulletSplit = splitInlineBullets(rawTrimmed);
  if (bulletSplit.length > 1) {
    return dedupeAndFilter(bulletSplit);
  }

  // 3. Check for inline topic patterns like: "Header: Desc. Header 2: Desc."
  const inlineTopics = splitInlineTopicBugs(rawTrimmed);
  if (inlineTopics.length > 1) {
    return dedupeAndFilter(inlineTopics);
  }

  // 4. Fallback to the single cleaned line
  const single = cleanBugLine(rawTrimmed);
  return single ? [single] : [];
}

/**
 * Splits inline bullets / numbered lists inside a single string without newlines.
 * e.g. "• Bug A • Bug B" or "1. Bug A 2. Bug B" or "[ ] Bug A [ ] Bug B"
 */
function splitInlineBullets(text: string): string[] {
  // Check for bullet separators like " • " or " - " or " ▪ "
  if (/\s+[•▪▫]\s+/.test(text)) {
    return text.split(/\s+[•▪▫]\s+/).map(cleanBugLine).filter(Boolean);
  }

  // Check for numbered separators like " 2. " or " 2) " or " [2] "
  const numberedPattern = /(?:\s+|^)(?:\d+[.)]|\(\d+\)|\[\d+\])\s+/g;
  const matches = Array.from(text.matchAll(numberedPattern));
  if (matches.length > 1) {
    const items: string[] = [];
    let lastIdx = 0;
    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      const matchIdx = m.index ?? 0;
      if (i > 0) {
        const chunk = text.slice(lastIdx, matchIdx).trim();
        if (chunk) items.push(cleanBugLine(chunk));
      }
      lastIdx = matchIdx + m[0].length;
    }
    const finalChunk = text.slice(lastIdx).trim();
    if (finalChunk) items.push(cleanBugLine(finalChunk));
    if (items.length > 1) return items;
  }

  return [];
}

/**
 * Splits concatenated single-paragraph bug lists that follow topic/title patterns:
 * e.g. "Micronutrient null handling: Differentiate... Cheddar cheese profile: Correct..."
 */
function splitInlineTopicBugs(text: string): string[] {
  // Match headers: starts at start of string or after a sentence end/whitespace,
  // followed by a capitalized phrase (2-60 chars) followed by a colon and space.
  // Example: "Cheddar cheese profile: " or "Totals synchronization: "
  const headerRegex = /(?:^|(?<=[.!?]|\b)\s+)([A-Z][A-Za-z0-9\s/_\-()]{2,55}:)\s+/g;
  const matches = Array.from(text.matchAll(headerRegex));

  if (matches.length <= 1) {
    return [text];
  }

  const items: string[] = [];
  for (let i = 0; i < matches.length; i++) {
    const curr = matches[i];
    const next = matches[i + 1];
    const startIdx = curr.index ?? 0;
    const endIdx = next ? (next.index ?? text.length) : text.length;
    const chunk = text.slice(startIdx, endIdx).trim();
    if (chunk) {
      items.push(cleanBugLine(chunk));
    }
  }

  return items.length > 0 ? items : [text];
}

/**
 * Removes duplicate strings and empty items while preserving order.
 */
function dedupeAndFilter(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const clean = item.trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }
  return result;
}
