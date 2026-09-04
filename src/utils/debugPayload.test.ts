import { describe, it, expect } from 'vitest';
import {
  stripHeavyImages,
  buildDebugMarkdownReport,
  coldDebugR2Key,
  COLD_DEBUG_LOG,
} from './debugPayload';

describe('debugPayload', () => {
  it('strips base64 images and keeps https urls', () => {
    const heavy = 'data:image/jpeg;base64,' + 'A'.repeat(9000);
    const out = stripHeavyImages({
      photoUrl: heavy,
      keep: 'https://cdn.example.com/photos/x.jpg',
      nested: { imageUrl: heavy },
    });
    expect(String(out.photoUrl)).toMatch(/image omitted/);
    expect(out.keep).toContain('https://');
    expect(String(out.nested.imageUrl)).toMatch(/image omitted/);
  });

  it('builds markdown report with macros and logs, no base64', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_1',
      status: 'succeeded',
      message: 'Looks like a solid meal.',
      backendLogs: '[Vision Scout] ok\n[Budget] mode=A',
      pendingFoodLog: {
        name: 'Co-op beef + yogurt',
        weightGrams: 315,
        nutrients: { calories: 461, protein: 42 },
        itemsBreakdown: [{ originalName: 'Beef topside', weightGrams: 100, nutrients: { calories: 148 } }],
        receiptTable: [{ item: 'Beef', source: 'LABEL', notes: 'printed' }],
      },
      scoutItems: [{ originalName: 'Beef', estimatedWeightGrams: 100 }],
    });
    expect(md).toMatch(/# Health Tracker — (End-to-End Diagnostic|Analysis) Report/);
    expect(md).toContain('job_1');
    expect(md).toContain('Co-op beef + yogurt');
    expect(md).toMatch(/Gate & Trial-Balance Evaluation/);
    expect(md).toMatch(/Calories/);
    expect(md).toContain('[Vision Scout] ok');
    expect(md).toMatch(/Backend (Execution )?Logs/i);
    expect(md).not.toMatch(/data:image/);
  });

  it('cold key is user-scoped', () => {
    expect(coldDebugR2Key('job_abc', 'user_1')).toBe('debug/user_1/job_abc.json');
    expect(COLD_DEBUG_LOG).toContain('ColdDebug');
  });

  it('renders vision scout internal reasoning, bounding boxes, and sticker labels', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_scout_test',
      status: 'succeeded',
      message: 'Scout test',
      scoutInternalReasoning: 'Observed 3 raw grocery ingredients with price stickers: Cumi, Ikan, and Telur.',
      diningEnvironment: 'grocery_raw_items',
      scoutContentType: 'raw_grocery',
      scoutItems: [
        {
          originalName: 'Cumi Bangka',
          estimatedWeightGrams: 200,
          boundingBox2D: [120, 50, 450, 480],
          sourceImageIndex: 0,
          cookingMethod: 'raw',
          packageLabelText: 'CUMI BANGKA - Berat 0.200',
          components: [
            {
              name: 'Cumi Bangka',
              weightGrams: 200,
              packageLabelText: 'CUMI BANGKA - Berat 0.200',
              sourceImageIndex: 0,
              protein: 32,
              carbohydrates: 0,
              totalFat: 2.8,
              sodium: 88,
            },
          ],
        },
      ],
      rawScout: {
        _internalReasoning: 'Observed 3 raw grocery ingredients',
        dishes: [{ name: 'Cumi Bangka', estimatedWeightGrams: 200 }],
      },
    });

    expect(md).toContain('Vision Scout Results (1 item(s) detected)');
    expect(md).toContain('Scout Internal Reasoning:');
    expect(md).toContain('Observed 3 raw grocery ingredients with price stickers');
    expect(md).toContain('grocery_raw_items');
    expect(md).toContain('[120,50,450,480]');
    expect(md).toContain('CUMI BANGKA - Berat 0.200');
    expect(md).toContain('Itemized Constituent Ingredients & Stickers');
    expect(md).toContain('Raw Scout Structured JSON');
  });

  it('gate failures are the Errors section — not a "no errors found" grep', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_gate',
      status: 'succeeded',
      message: 'Looks fine.',
      backendLogs: '[Vision Scout] ok',
      pendingFoodLog: {
        name: 'Pan-Seared Tempeh Bowl',
        nutrients: { calories: 0, protein: 22, carbohydrates: 5, totalFat: 8 },
        itemsBreakdown: [{
          originalName: 'Pan-Seared Tempeh',
          weightGrams: 150,
          calories: 0,
          protein: 22,
          carbohydrates: 5,
          totalFat: 8,
        }],
      },
    });
    expect(md).toMatch(/ZERO_KCAL_WITH_MACROS/);
    expect(md).toMatch(/GATE: FAIL/);
    expect(md).not.toMatch(/No errors found/i);
    expect(md).not.toMatch(/No errors or warnings found in the backend logs/i);
  });

  it('does not paste the same system instruction twice', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_dup',
      backendLogs: [
        'Dispatched System Instruction',
        'YOU ARE THE DIETITIAN UNIQUE_TOKEN_XYZ',
        '[Budget] Finalized ledger',
        'Dispatched System Instruction',
        'YOU ARE THE DIETITIAN UNIQUE_TOKEN_XYZ',
      ].join('\n'),
    });
    const matches = md.match(/UNIQUE_TOKEN_XYZ/g) || [];
    expect(matches.length).toBe(1);
  });

  it('shows scout schema once per dispatch and keeps a second distinct dispatch', () => {
    const scoutSchema = '"responseSchema": { "type": "OBJECT", "properties": { "items": {} } } SCOUT_SCHEMA_TOKEN';
    const dietitianInstr = 'YOU ARE THE DIETITIAN DIETITIAN_DISPATCH_TOKEN';
    const md = buildDebugMarkdownReport({
      jobId: 'job_f85',
      backendLogs: [
        'Dispatched System Instruction',
        scoutSchema,
        '[Vision Scout] ok',
        'Dispatched System Instruction',
        scoutSchema,
        '[Budget] Finalized ledger 1',
        'Dispatched System Instruction',
        dietitianInstr,
        '[Budget] Finalized ledger 2',
      ].join('\n'),
    });
    expect((md.match(/SCOUT_SCHEMA_TOKEN/g) || []).length).toBe(1);
    expect(md).toContain('DIETITIAN_DISPATCH_TOKEN');
    expect((md.match(/Finalized ledger/g) || []).length).toBe(2);
  });

  it('shows each agent reply once and keeps a second distinct reply', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_replies',
      backendLogs: [
        'Response received (12 chars). Raw output:',
        '{"ok":true,"token":"SCOUT_REPLY_TOKEN"}',
        '[Vision Scout] ok',
        'Response received (12 chars). Raw output:',
        '{"ok":true,"token":"SCOUT_REPLY_TOKEN"}',
        '[Budget] ledger',
        'Response received (20 chars). Raw output:',
        '{"ok":true,"token":"DIETITIAN_REPLY_TOKEN"}',
      ].join('\n'),
    });
    expect(md).toMatch(/Agent Replies/);
    expect((md.match(/SCOUT_REPLY_TOKEN/g) || []).length).toBe(1);
    expect(md).toContain('DIETITIAN_REPLY_TOKEN');
  });

  it('renders Contract Table first immediately after report header', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_order_test',
      status: 'succeeded',
      backendLogs: '[Budget] Finalized ledger: 520 kcal',
      pendingFoodLog: { nutrients: { calories: 520 } },
    });

    const contractIndex = md.indexOf('## ⚖️ Contract Evaluation');
    const matrixIndex = md.indexOf('## 🔗 Data Pipelines & Infrastructure Connectivity Matrix');

    expect(contractIndex).toBeGreaterThan(0);
    expect(matrixIndex).toBeGreaterThan(0);
    expect(contractIndex).toBeLessThan(matrixIndex);
  });

  it('renders Modal Snapshot (Dialog Inventory) when present in input', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_modal_test',
      status: 'succeeded',
      dialogInventory: {
        open: true,
        title: 'Nasi Goreng',
        on_card: { kcal: 550, protein: 25, carbs: 70, fat: 18 },
        visible: ['View Analysis', 'Download Debug'],
        hidden: ['Retry', 'Attempt 1 of 3'],
        composer: { photo: 1, send: 1 },
        expand: false,
      },
    });

    expect(md).toContain('## 🪟 Modal Snapshot (Dialog Inventory)');
    expect(md).toContain('- **open:** true');
    expect(md).toContain('- **title:** "Nasi Goreng"');
    expect(md).toContain('"kcal":550');
    expect(md).toContain('[View Analysis, Download Debug]');
    expect(md).toContain('[Retry, Attempt 1 of 3]');
  });
});

