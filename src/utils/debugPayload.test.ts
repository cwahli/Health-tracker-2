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
    expect(md).toMatch(/Calories/);
    expect(md).toContain('[Vision Scout] ok');
    expect(md).toMatch(/Backend (Execution )?Logs/i);
    expect(md).not.toMatch(/data:image/);
  });

  it('cold key is user-scoped', () => {
    expect(coldDebugR2Key('job_abc', 'user_1')).toBe('debug/user_1/job_abc.json');
    expect(COLD_DEBUG_LOG).toContain('ColdDebug');
  });
});
