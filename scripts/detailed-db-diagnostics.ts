import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: Supabase credentials are required.');
  process.exit(1);
}

const cleanSupabaseUrl = SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const supabaseAdmin = createClient(cleanSupabaseUrl, SUPABASE_SERVICE_ROLE_KEY);

function getObjectSize(obj: any): number {
  return Buffer.byteLength(JSON.stringify(obj || {}), 'utf8');
}

function getColumnSizes(row: any): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const key of Object.keys(row)) {
    const val = row[key];
    if (val === null || val === undefined) {
      sizes[key] = 0;
    } else if (typeof val === 'string') {
      sizes[key] = Buffer.byteLength(val, 'utf8');
    } else {
      sizes[key] = Buffer.byteLength(JSON.stringify(val), 'utf8');
    }
  }
  return sizes;
}

async function analyzeTable(tableName: string, idField: string, labelField?: string) {
  console.log(`\n==================================================`);
  console.log(`Analyzing Table: ${tableName}`);
  console.log(`==================================================`);

  const { data: rows, error } = await supabaseAdmin
    .from(tableName)
    .select('*');

  if (error) {
    console.error(`Error fetching from ${tableName}:`, error.message);
    return;
  }

  if (!rows || rows.length === 0) {
    console.log(`No rows found in ${tableName}.`);
    return;
  }

  console.log(`Total active rows: ${rows.length}`);

  // Calculate size stats
  const analyzedRows = rows.map(row => {
    const totalSize = getObjectSize(row);
    const colSizes = getColumnSizes(row);
    return {
      id: row[idField],
      label: labelField ? row[labelField] : '',
      totalSize,
      colSizes,
      raw: row
    };
  });

  // Total active data size
  const totalActiveBytes = analyzedRows.reduce((sum, r) => sum + r.totalSize, 0);
  console.log(`Total Active Data Size: ${(totalActiveBytes / 1024).toFixed(2)} KB (~${(totalActiveBytes / (1024 * 1024)).toFixed(2)} MB)`);

  // Sort by size descending
  analyzedRows.sort((a, b) => b.totalSize - a.totalSize);

  console.log(`\nTop 5 Largest Rows in '${tableName}':`);
  const top5 = analyzedRows.slice(0, 5);
  top5.forEach((item, index) => {
    console.log(`\n  ${index + 1}. Row ID: ${item.id} ${item.label ? `(${item.label})` : ''}`);
    console.log(`     Total Row Size: ${(item.totalSize / 1024).toFixed(2)} KB (${item.totalSize.toLocaleString()} bytes)`);
    
    // Sort columns by size
    const sortedCols = Object.entries(item.colSizes)
      .filter(([_, size]) => size > 0)
      .sort((a, b) => b[1] - a[1]);

    console.log(`     Column Breakdown:`);
    sortedCols.slice(0, 5).forEach(([col, size]) => {
      console.log(`       - ${col}: ${(size / 1024).toFixed(2)} KB (${size.toLocaleString()} bytes)`);
    });
  });
}

async function main() {
  await analyzeTable('food_logs', 'id', 'name');
  await analyzeTable('agent_jobs', 'id', 'job_type');
  await analyzeTable('issue_backlog', 'id', 'title');
}

main().catch(err => {
  console.error('Error during diagnostics:', err);
});
