import 'dotenv/config';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

async function main() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID || '';
  const bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME || '';
  const keyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
  const secret = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';
  const pub = (process.env.CLOUDFLARE_R2_PUBLIC_URL || '').replace(/\/$/, '');
  if (!account || !bucket || !keyId || !secret) {
    console.error('R2 env incomplete');
    process.exit(1);
  }
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: keyId, secretAccessKey: secret },
  });
  const key = 'golden/_probe.txt';
  const body = `ok ${new Date().toISOString()}`;
  await client.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: Buffer.from(body), ContentType: 'text/plain' })
  );
  const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const text = await (got.Body as any).transformToString();
  const url = `${pub}/${key}`;
  let pubStatus = 'n/a';
  try {
    const r = await fetch(url);
    pubStatus = `${r.status} ${(await r.text()).slice(0, 48)}`;
  } catch (e: any) {
    pubStatus = e?.message || String(e);
  }
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  console.log('R2 put/get:', text === body ? 'WORKS' : 'MISMATCH');
  console.log('R2 public GET:', pubStatus);
  if (text !== body) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
