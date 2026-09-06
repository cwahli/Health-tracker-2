import { describe, it, expect } from 'vitest';
import {
  stripHeavyImages,
  buildDebugMarkdownReport,
  debugReportFromJobMsg,
  coldDebugR2Key,
  COLD_DEBUG_LOG,
} from './debugPayload';
import { buildCanonicalRunTree } from './debugRunTree';

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

  it('leaves non-image strings and numbers untouched', () => {
    const input = {
      message: 'plain text',
      count: 42,
      nested: { label: 'hello', value: 0 },
    };
    expect(stripHeavyImages(input)).toEqual(input);
  });

  it('recurses into arrays, omits base64 photoUrl, and keeps https photoUrl', () => {
    const base64 = 'data:image/png;base64,' + 'B'.repeat(9000);
    const out = stripHeavyImages({
      items: [
        { photoUrl: base64 },
        { photoUrl: 'https://cdn.example.com/photos/ok.jpg' },
      ],
    });

    expect(String(out.items[0].photoUrl)).toMatch(/image omitted/);
    expect(out.items[1].photoUrl).toContain('https://');
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

  it('coldDebugR2Key returns a stable unknown jobId key for empty jobId', () => {
    expect(coldDebugR2Key('', 'user_1')).toBe('debug/user_1/unknown.json');
    expect(coldDebugR2Key('')).toBe('debug/anonymous/unknown.json');
  });

  it('coldDebugR2Key sanitizes weird characters in jobId/userId to underscore-safe path segments', () => {
    const key = coldDebugR2Key('job/../weird?id', 'user/../weird@email');
    expect(key).toBe('debug/user_.._weird@email/job____weird_id.json');
  });

  it('markdown dispatch heading matches canonical tree.dispatches length after enrichment', () => {
    const input = {
      jobId: 'job_dispatch_parity',
      status: 'succeeded',
      message: 'Parity check',
      dispatches: [
        { id: 't1/scout', agent: 'scout' },
        { id: 't2/scout', agent: 'scout' },
        { id: 't3/scout', agent: 'scout' },
      ],
    };

    const tree = buildCanonicalRunTree(input);
    const md = buildDebugMarkdownReport(input);
    const heading = md.match(/## 📡 Agent Dispatches \((\d+)\)/);

    expect(heading).not.toBeNull();
    expect(Number(heading![1])).toBe(tree.dispatches.length);
    expect(tree.dispatches.length).toBe(3);
  });

  it('renders exactly one per-dispatch heading for each of 3 prior dispatches', () => {
    const input = {
      jobId: 'job_dispatch_heading_parity',
      status: 'succeeded',
      message: 'Heading parity',
      dispatches: [
        { id: 't1/scout', agent: 'scout' },
        { id: 't2/scout', agent: 'scout' },
        { id: 't3/scout', agent: 'scout' },
      ],
    };

    const tree = buildCanonicalRunTree(input);
    const md = buildDebugMarkdownReport(input);
    const headings = md.match(/^### Dispatch /gm) || [];

    expect(tree.dispatches.length).toBe(3);
    expect(headings.length).toBe(tree.dispatches.length);
  });

  it('locks cold debug JSON path triple parity for three dispatches', () => {
    const input = {
      jobId: 'job_cold_debug_triple_parity',
      status: 'succeeded',
      message: 'Triple parity',
      dispatches: [
        { id: 't1/scout', agent: 'scout' },
        { id: 't2/scout', agent: 'scout' },
        { id: 't3/scout', agent: 'scout' },
      ],
    };

    const tree = buildCanonicalRunTree(input);
    const md = buildDebugMarkdownReport(input);
    const heading = md.match(/## 📡 Agent Dispatches \((\d+)\)/);
    const dispatchHeadings = md.match(/^### Dispatch /gm) || [];

    expect(heading).not.toBeNull();
    expect(Number(heading![1])).toBe(3);
    expect(dispatchHeadings.length).toBe(3);
    expect(tree.dispatches.length).toBe(3);
  });

  it('uses tree.dispatches.length for heading when empty prior dispatches and logs invent scout only', () => {
    const input = {
      jobId: 'job_empty_dispatches_invented_scout',
      status: 'succeeded',
      message: 'Invented scout parity',
      dispatches: [],
      backendLogs: '[Vision Scout] ok\n[UnifiedLLM-Prompt:scout] System Instruction:\nYou are scout.',
    };

    const tree = buildCanonicalRunTree(input);
    const md = buildDebugMarkdownReport(input);
    const heading = md.match(/## 📡 Agent Dispatches \((\d+)\)/);
    const dispatchHeadings = md.match(/^### Dispatch /gm) || [];

    expect(tree.dispatches.length).toBe(1);
    expect(heading).not.toBeNull();
    expect(Number(heading![1])).toBe(tree.dispatches.length);
    expect(dispatchHeadings.length).toBe(tree.dispatches.length);
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
    expect(md).toContain('Raw Emission (Verbatim Output)');
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

  it('carries rawScout and dialogInventory from job result into the report input', () => {
    const rawScout = { dishes: [{ dishName: 'Steak', foods: [{ foodName: 'Steak' }] }], _internalReasoning: 'saw steak' };
    const input = debugReportFromJobMsg(
      { id: 'job_raw', result: { rawScout, dialogInventory: { open: false } } },
      {}
    );
    expect(input.rawScout).toEqual(rawScout);
    expect(input.dialogInventory).toEqual({ open: false });
  });

  it('renders complete Scout received payload (System Instruction, User Prompt, Received) and emitted Raw Emission in markdown', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_scout_full_audit',
      status: 'succeeded',
      agentInstructions: {
        scout: {
          systemInstruction: 'You are the Vision Scout. Output strict JSON with schema dishes[].',
          userPrompt: 'Analyze the provided meal image. Ingest all visible foods.',
        },
      },
      rawScout: {
        _internalReasoning: 'Observed grilled salmon with asparagus.',
        dishes: [
          {
            dishName: 'Grilled Salmon',
            estimatedWeightGrams: 180,
            foods: [{ foodName: 'Salmon Fillet', weightGrams: 180 }],
          },
        ],
      },
      photoUrls: ['https://example.com/photo1.jpg'],
      message: 'Logged from dinner',
    });

    expect(md).toContain('### Dispatch t1/scout');
    expect(md).toContain('- **System Instruction:**');
    expect(md).toContain('You are the Vision Scout. Output strict JSON with schema dishes[].');
    expect(md).toContain('- **User Prompt:**');
    expect(md).toContain('Analyze the provided meal image. Ingest all visible foods.');
    expect(md).toContain('- **Received:**');
    expect(md).toContain('"photoCount":1');
    expect(md).toContain('https://example.com/photo1.jpg');
    expect(md).toContain('- **Raw Emission (Verbatim Output):**');
    expect(md).toContain('Grilled Salmon');
    expect(md).toContain('Observed grilled salmon with asparagus.');
  });

  it('does not invent food scout dispatches for receptionist pack', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_receptionist_no_scout',
      status: 'succeeded',
      pack: 'receptionist',
      agentType: 'front_desk',
      message: 'Please schedule my lab review.',
      backendLogs: '[Vision Scout] should not create food dispatch\n[UnifiedLLM-Prompt:scout] System Instruction:\nfood scout',
    });

    expect(md).toContain('### Dispatch fd/front_desk');
    expect(md).not.toMatch(/### Dispatch t\d+\/scout/);
    expect(md).not.toContain('### Dispatch t1/resolver');
  });

  it('uses a medical dispatch heading for medical pack instead of scout', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_medical_pack_dispatch',
      status: 'succeeded',
      pack: 'medical',
      agentType: 'medical',
      message: 'Review my lab panel.',
      dispatches: [{ id: 't1/medical', agent: 'medical' }],
      backendLogs: '[UnifiedLLM-Prompt:scout] System Instruction:\nfood scout',
    });

    const dispatchHeadings = md.match(/^### Dispatch .*$/gm) || [];
    expect(dispatchHeadings.some((h) => /medical/i.test(h))).toBe(true);
    expect(dispatchHeadings.every((h) => !/scout/i.test(h))).toBe(true);
  });

  it('maps minimal job-like input into markdown DebugReportInput fields', () => {
    const input = debugReportFromJobMsg({ id: 'job_minimal', status: 'succeeded' }, {});
    expect(input.jobId).toBeTruthy();
    expect(input.jobId).toBe('job_minimal');
    expect(input.status).toBe('succeeded');
  });

  it('renders identity/jobId heading with zero dispatches and empty food without crashing', () => {
    const md = buildDebugMarkdownReport({
      jobId: 'job_zero_dispatch_empty_food',
      status: 'succeeded',
      dispatches: [],
      pendingFoodLog: {},
    });

    expect(md).toContain('# Health Tracker —');
    expect(md).toContain('**Job ID:** `job_zero_dispatch_empty_food`');
    expect(md).not.toContain('## 📡 Agent Dispatches');
  });

  it('includes Contract table section heading when canonical run tree produces contract evals', () => {
    const input = {
      jobId: 'job_contract_evals_heading',
      status: 'succeeded',
      backendLogs: '[Budget] Finalized ledger: 520 kcal',
      pendingFoodLog: {
        name: 'Chicken Rice',
        nutrients: { calories: 520 },
      },
    };

    const tree = buildCanonicalRunTree(input);
    const md = buildDebugMarkdownReport(input);

    expect(tree.contract.length).toBeGreaterThan(0);
    expect(md).toContain('## ⚖️ Contract Evaluation');
  });
});

