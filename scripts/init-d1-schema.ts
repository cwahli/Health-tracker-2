import 'dotenv/config';
import { ensureD1Schema } from '../server_d1_schema.js';
import { d1Query } from '../server_d1.js';

async function main() {
  console.log('--- Initializing Cloudflare D1 Database Schema ---');
  const result = await ensureD1Schema();
  if (!result.success) {
    console.error('Failed to initialize D1 schema:', result.error);
    process.exit(1);
  }

  // Verify created tables
  const tables = await d1Query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name ASC;");
  console.log('Tables in D1 database:');
  for (const row of tables.results) {
    console.log(`  - ${row.name}`);
  }
  console.log('--- Done ---');
}

main().catch(err => {
  console.error('Initialization error:', err);
  process.exit(1);
});
