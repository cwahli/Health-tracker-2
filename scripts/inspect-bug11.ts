import { supabaseAdmin } from '../supabaseAdmin.js';

async function main() {
  const { data: tags, error: tErr } = await supabaseAdmin.from('issue_tags').select('*');
  if (tErr) console.error('Tags err:', tErr);
  console.log('Total tags in DB:', tags?.length);

  if (tags) {
    for (const t of tags) {
      console.log(`Tag public_id=${t.public_id} id=${t.id} title="${t.title}" status=${t.status}`);
    }
    const b11 = tags.find(t => t.public_id === 11 || t.public_id === '11' || String(t.title).includes('Croissant') || String(t.title).includes('Fruit') || String(t.id).includes('11'));
    if (b11) {
      console.log('\n====================================');
      console.log('--- BUG 11 TAG DETAILS ---');
      console.log('====================================');
      console.log(JSON.stringify(b11, null, 2));

      // Fetch links
      const { data: links } = await supabaseAdmin.from('issue_tag_links').select('*').eq('tag_id', b11.id);
      console.log('\n--- LINKS ---', links);

      // Fetch backlog reports
      if (links && links.length > 0) {
        const issueIds = links.map(l => l.issue_id);
        const { data: reports } = await supabaseAdmin.from('issue_backlog').select('*').in('id', issueIds);
        console.log('\n--- BACKLOG REPORTS ---');
        if (reports) {
          for (const r of reports) {
            console.log(`Report ID: ${r.id}, Created At: ${r.created_at}`);
            console.log(`User note: ${r.user_note}`);
            console.log(`Payload keys: ${Object.keys(r.payload || {})}`);
            console.log('Payload summary:', JSON.stringify(r.payload?.summary || r.payload?.meal || r.payload, null, 2));
          }
        }
      }
    } else {
      console.log('Bug 11 tag not found in tags list');
    }
  }
}

main().catch(console.error);
