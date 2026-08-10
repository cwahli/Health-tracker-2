import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from './supabaseAdmin.js';

let ensurePromise: Promise<{ ok: boolean; method: string; error?: string }> | null = null;

/** Idempotent: create food catalog tables if missing. Safe to call often. */
export async function ensureFoodCatalogSchema(): Promise<{ ok: boolean; method: string; error?: string }> {
  if (ensurePromise) return ensurePromise;
  ensurePromise = (async () => {
    // 1) Fast path: table already visible to PostgREST
    try {
      const { error } = await supabaseAdmin.from('food_items').select('food_id').limit(1);
      if (!error) {
        console.log('[CatalogSchema] food_items already available');
        return { ok: true, method: 'already_exists' };
      }
      const msg = String(error.message || error);
      if (!/schema cache|does not exist|Could not find the table/i.test(msg)) {
        // Other errors (auth, network) — do not pretend schema is fine
        return { ok: false, method: 'probe_failed', error: msg };
      }
    } catch (e: any) {
      // continue to DDL attempt
    }

    const sqlPath = path.join(process.cwd(), 'supabase/migrations/20260805_food_catalog_schema.sql');
    let sql = '';
    try {
      sql = fs.readFileSync(sqlPath, 'utf8');
    } catch (e: any) {
      const err = `Cannot read migration file ${sqlPath}: ${e?.message || e}`;
      console.error('[CatalogSchema]', err);
      return { ok: false, method: 'no_migration_file', error: err };
    }

    // 2) Prefer direct Postgres (service) if URL available — only way to DDL from Node without pre-created RPC
    const dbUrl =
      process.env.DATABASE_URL ||
      process.env.SUPABASE_DB_URL ||
      process.env.POSTGRES_URL ||
      process.env.SUPABASE_DATABASE_URL ||
      '';

    if (dbUrl) {
      try {
        // Use pg if installed; if not, document adding "pg" dependency
        const pg = await import('pg');
        const client = new pg.default.Client({
          connectionString: dbUrl,
          ssl: dbUrl.includes('localhost') ? undefined : { rejectUnauthorized: false },
        });
        await client.connect();
        try {
          await client.query(sql);
          // Reload PostgREST schema cache (Supabase)
          try {
            await client.query(`NOTIFY pgrst, 'reload schema'`);
          } catch (_) { /* optional */ }
        } finally {
          await client.end();
        }
        console.log('[CatalogSchema] Applied 20260805_food_catalog_schema.sql via DATABASE_URL');
        // Re-probe
        const { error: e2 } = await supabaseAdmin.from('food_items').select('food_id').limit(1);
        if (e2) {
          return { ok: false, method: 'ddl_ok_probe_fail', error: e2.message };
        }
        return { ok: true, method: 'database_url_ddl' };
      } catch (e: any) {
        console.error('[CatalogSchema] DDL via DATABASE_URL failed:', e?.message || e);
        return { ok: false, method: 'database_url_failed', error: String(e?.message || e) };
      }
    }

    // 3) No DB URL: cannot CREATE TABLE through supabase-js REST alone
    const help =
      'food_items/dish_cache missing. Set DATABASE_URL (or SUPABASE_DB_URL) to the Postgres connection string and restart, ' +
      'OR run supabase/migrations/20260805_food_catalog_schema.sql once in Supabase SQL Editor. ' +
      'Then self-heal upserts will populate the catalog gradually.';
    console.error('[CatalogSchema]', help);
    return { ok: false, method: 'needs_manual_or_db_url', error: help };
  })();
  return ensurePromise;
}

/** Reset memo after failed ensure so next request can retry (e.g. after user runs SQL). */
export function resetFoodCatalogSchemaEnsure() {
  ensurePromise = null;
}
