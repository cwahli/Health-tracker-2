import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { uploadBacklogPayloadToR2 } from '../serverIssueBacklog.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: Supabase credentials are required in .env');
  process.exit(1);
}

const cleanSupabaseUrl = SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const supabaseAdmin = createClient(cleanSupabaseUrl, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  console.log('=== Migrating Bloated issue_backlog Payloads to R2 ===\n');

  const { data: rows, error } = await supabaseAdmin
    .from('issue_backlog')
    .select('id, payload, created_at, dish_query, user_note');

  if (error) {
    console.error('Failed to fetch issue_backlog rows:', error.message);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log('No rows found in issue_backlog.');
    return;
  }

  console.log(`Found ${rows.length} rows. Inspecting payloads for bloat...\n`);

  let migratedCount = 0;
  let skippedCount = 0;

  for (const row of rows) {
    const payload = row.payload || {};
    const rawSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');

    const isHeavy =
      rawSize > 2048 ||
      payload.dom != null ||
      payload.a11y != null ||
      payload.network != null ||
      payload.debug_payload != null ||
      payload.debug_job != null ||
      payload.domain_pack != null;

    if (!isHeavy && payload.is_r2) {
      console.log(`- Row ${row.id}: Already thin (${(rawSize / 1024).toFixed(2)} KB). Skipping.`);
      skippedCount++;
      continue;
    }

    console.log(`- Row ${row.id}: Heavy payload detected (${(rawSize / 1024).toFixed(2)} KB). Uploading to R2...`);

    // Upload full original payload to R2
    const publicUrl = await uploadBacklogPayloadToR2(row.id, payload);
    if (!publicUrl) {
      console.warn(`  ⚠️ Failed to upload payload to R2 for row ${row.id}, skipping DB update.`);
      continue;
    }

    // Build thin replacement payload
    const thinPayload = {
      bug_snapshot: payload.bug_snapshot ?? true,
      is_r2: true,
      r2_url: publicUrl,
      r2_prefix: payload.r2_prefix || null,
      r2_manifest_key: payload.r2_manifest_key || null,
      reportId: payload.reportId || null,
      tagId: payload.tagId || null,
      category: payload.category || 'foodcart',
      env: payload.env || null,
      shot_count: payload.shot_count ?? payload.r2_shots?.length ?? 0,
      r2_shots: payload.r2_shots || [],
      r2_files: payload.r2_files || [],
      serverMeta: payload.serverMeta || null,
      migrated_to_r2_at: new Date().toISOString(),
    };

    const { error: updateErr } = await supabaseAdmin
      .from('issue_backlog')
      .update({ payload: thinPayload })
      .eq('id', row.id);

    if (updateErr) {
      console.error(`  ❌ Failed to update row in Supabase:`, updateErr.message);
    } else {
      const newSize = Buffer.byteLength(JSON.stringify(thinPayload), 'utf8');
      console.log(`  ✅ Successfully thinned row ${row.id}: ${(rawSize / 1024).toFixed(2)} KB -> ${(newSize / 1024).toFixed(2)} KB`);
      migratedCount++;
    }
  }

  console.log(`\nMigration complete! Migrated: ${migratedCount}, Skipped: ${skippedCount}`);
}

main().catch((err) => {
  console.error('Fatal error during migration:', err);
  process.exit(1);
});
