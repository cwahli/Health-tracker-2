import { describe, it, expect } from 'vitest';
import { parseBatchBugs, cleanBugLine } from './bugBatchParser';

describe('bugBatchParser', () => {
  it('cleans bullet and number prefixes correctly', () => {
    expect(cleanBugLine('- Some bug')).toBe('Some bug');
    expect(cleanBugLine('• Another bug')).toBe('Another bug');
    expect(cleanBugLine('1. Numbered bug')).toBe('Numbered bug');
    expect(cleanBugLine('[ ] Checkbox bug')).toBe('Checkbox bug');
    expect(cleanBugLine('Bug 1: Title')).toBe('Title');
    expect(cleanBugLine('Issue #4: Something broken')).toBe('Something broken');
  });

  it('parses multiline text into individual bugs', () => {
    const multiline = `
- Calcium undercounted on milk
- 2 Croissants parsed as 6 multipack
- Sodium unit mismatch
    `;
    const result = parseBatchBugs(multiline);
    expect(result).toEqual([
      'Calcium undercounted on milk',
      '2 Croissants parsed as 6 multipack',
      'Sodium unit mismatch',
    ]);
  });

  it('parses inline bullet and numbered lists', () => {
    const inlineNumbered = '1. First bug description 2. Second bug description 3. Third bug description';
    const result = parseBatchBugs(inlineNumbered);
    expect(result.length).toBe(3);
    expect(result[0]).toBe('First bug description');
    expect(result[1]).toBe('Second bug description');
    expect(result[2]).toBe('Third bug description');
  });

  it('parses the exact user screenshot text containing multiple topic:description bugs', () => {
    const screenshotText = `Micronutrient null handling: Differentiate between unmeasured micronutrients and true zero-values to avoid undercounting overall daily micronutrient totals Cheddar cheese profile: Correct the database profile for cheddar cheese (FDC 173411) from an inaccurate high-fat butter profile to standard cheese macros to prevent massive calorie overestimation. Totals synchronization: Ensure post-analysis rule adjustments (such as the wrap's sodium reduction) automatically propagate to the final meal totals. Vision Scout JSON truncation: Increase output token limits or streamline schema responses to eliminate JSON truncation errors during multi-item image parsing. Quantity and naming clarity: Update item labeling logic to explicitly reflect detected counts (e.g., "2x Butter Croissants") rather than defaulting to singular names. Added sugar estimation: Implement heuristics to estimate added sugars in bakery goods and processed condiments instead of defaulting them to 0g`;

    const result = parseBatchBugs(screenshotText);
    expect(result.length).toBe(6);
    expect(result[0]).toContain('Micronutrient null handling: Differentiate between unmeasured');
    expect(result[1]).toContain('Cheddar cheese profile: Correct the database profile');
    expect(result[2]).toContain('Totals synchronization: Ensure post-analysis');
    expect(result[3]).toContain('Vision Scout JSON truncation: Increase output');
    expect(result[4]).toContain('Quantity and naming clarity: Update item labeling');
    expect(result[5]).toContain('Added sugar estimation: Implement heuristics');
  });

  it('handles markdown checklists and whitespace cleanly', () => {
    const markdownChecklist = `
* [ ] Bug A: First issue
* [x] Bug B: Second issue
- [ ] Bug C: Third issue
`;
    const result = parseBatchBugs(markdownChecklist);
    expect(result.length).toBe(3);
    expect(result[0]).toBe('Bug A: First issue');
    expect(result[1]).toBe('Bug B: Second issue');
    expect(result[2]).toBe('Bug C: Third issue');
  });

  it('deduplicates identical lines and ignores empty lines', () => {
    const raw = `
Item one
Item two

Item one
Item three
`;
    const result = parseBatchBugs(raw);
    expect(result).toEqual(['Item one', 'Item two', 'Item three']);
  });
});

