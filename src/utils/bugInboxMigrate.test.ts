import { describe, it, expect } from 'vitest';
import { planInboxMigration } from './bugInboxMigrate';

describe('planInboxMigration', () => {
  it('links a leftover D1 row onto the #n that already holds that job', () => {
    const plan = planInboxMigration(
      [{ id: 'd1-picnic', job_id: 'job_picnic', title: 'Picnic', status: 'open' }],
      [
        {
          id: 'tag-10',
          title: 'Picnic spread',
          work_item: { public_n: 10, current_evidence: { job_id: 'job_picnic' }, remaining: ['zeros'] },
        },
      ]
    );
    expect(plan[0].action).toBe('link_existing');
    expect(plan[0].tagId).toBe('tag-10');
  });

  it('does not mint a sibling #n for a promoted official golden', () => {
    const plan = planInboxMigration(
      [{ id: 'd1-prawn', job_id: 'job_prawn', title: 'Prawn doughnut', status: 'promoted' }],
      []
    );
    expect(plan[0].action).toBe('skip_promoted');
  });

  it('creates a foodcart card only when no job or title match exists', () => {
    const plan = planInboxMigration(
      [{ id: 'd1-new', job_id: 'job_label', title: 'User label yogurt', status: 'open' }],
      [{ id: 'tag-2', title: 'BMI reinit', work_item: { public_n: 2, remaining: ['bmi'] } }]
    );
    expect(plan[0].action).toBe('create_tag');
    expect(plan[0].remaining?.[0]).toMatch(/Inbox leftover/i);
  });

  it('treats already-linked tag_id as a no-op', () => {
    const plan = planInboxMigration(
      [{ id: 'd1-x', tag_id: 'tag-5', job_id: 'job_x', title: 'Wrap', status: 'open' }],
      [{ id: 'tag-5', title: 'Wrap', work_item: { public_n: 5 } }]
    );
    expect(plan[0].action).toBe('already_linked');
  });
});
