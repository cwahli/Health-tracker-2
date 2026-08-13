import 'dotenv/config';
import { d1Query, isD1Configured } from '../server_d1.js';

function mask(v?: string) {
  if (!v) return 'MISSING';
  return `set (${v.length} chars, …${v.slice(-4)})`;
}

async function main() {
  console.log('D1 configured:', isD1Configured());
  console.log('CLOUDFLARE_ACCOUNT_ID:', mask(process.env.CLOUDFLARE_ACCOUNT_ID));
  console.log('CLOUDFLARE_D1_DATABASE_ID:', mask(process.env.CLOUDFLARE_D1_DATABASE_ID));
  console.log('CLOUDFLARE_API_TOKEN:', mask(process.env.CLOUDFLARE_API_TOKEN));
  console.log('R2 bucket:', process.env.CLOUDFLARE_R2_BUCKET_NAME || 'MISSING');
  console.log('R2 public URL:', process.env.CLOUDFLARE_R2_PUBLIC_URL || 'MISSING');
  console.log('R2 access key:', process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ? 'set' : 'MISSING');

  const schema = await d1Query<{ name: string }>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='golden_cases'`
  );
  if (!schema.success) {
    console.error('D1 query failed:', schema.error);
    process.exit(1);
  }
  if (!schema.results.length) {
    console.error('D1 reachable, but table golden_cases is missing.');
    process.exit(1);
  }
  console.log('Table golden_cases: present');

  const probe = await d1Query<{ n: number }>(`SELECT COUNT(*) AS n FROM golden_cases`);
  if (!probe.success) {
    console.error('COUNT failed:', probe.error);
    process.exit(1);
  }
  console.log('Existing rows:', probe.results[0]?.n ?? 0);

  const ins = await d1Query<{ id: string }>(
    `INSERT INTO golden_cases (title, status, r2_prefix) VALUES (?, 'open', ?) RETURNING id`,
    ['__probe__', 'golden/probe']
  );
  if (!ins.success || !ins.results[0]?.id) {
    console.error('INSERT failed:', ins.error);
    process.exit(1);
  }
  const id = ins.results[0].id;
  console.log('INSERT ok, id=', id);

  const got = await d1Query(`SELECT id, title, status FROM golden_cases WHERE id = ?`, [id]);
  console.log('SELECT ok:', got.results[0]);

  const del = await d1Query(`DELETE FROM golden_cases WHERE id = ?`, [id]);
  if (!del.success) {
    console.error('DELETE cleanup failed:', del.error);
    process.exit(1);
  }
  console.log('DELETE cleanup ok');
  console.log('D1 golden_cases: WORKS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
