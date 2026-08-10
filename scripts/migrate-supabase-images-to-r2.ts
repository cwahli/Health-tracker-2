import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// 1. Environment Configurations
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'd17eecca64f82625d29dc38b14f46c14';
const CLOUDFLARE_R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
const CLOUDFLARE_R2_PUBLIC_URL = (process.env.CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev').replace(/\/$/, '');
const CLOUDFLARE_R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
const CLOUDFLARE_R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';

console.log('=== Migration Env Diagnostic ===');
console.log('SUPABASE_URL:', SUPABASE_URL ? 'Present' : 'Missing');
console.log('SUPABASE_SERVICE_ROLE_KEY:', SUPABASE_SERVICE_ROLE_KEY ? 'Present' : 'Missing');
console.log('CLOUDFLARE_ACCOUNT_ID:', CLOUDFLARE_ACCOUNT_ID);
console.log('CLOUDFLARE_R2_BUCKET_NAME:', CLOUDFLARE_R2_BUCKET_NAME);
console.log('CLOUDFLARE_R2_PUBLIC_URL:', CLOUDFLARE_R2_PUBLIC_URL);
console.log('CLOUDFLARE_R2_ACCESS_KEY_ID:', CLOUDFLARE_R2_ACCESS_KEY_ID ? 'Present' : 'Missing');
console.log('CLOUDFLARE_R2_SECRET_ACCESS_KEY:', CLOUDFLARE_R2_SECRET_ACCESS_KEY ? 'Present' : 'Missing');
console.log('================================');

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Error: Supabase credentials are required.');
  process.exit(1);
}

// 2. Initialize Clients
const cleanSupabaseUrl = SUPABASE_URL.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const supabaseAdmin = createClient(cleanSupabaseUrl, SUPABASE_SERVICE_ROLE_KEY);

let s3Client: S3Client | null = null;
if (CLOUDFLARE_R2_ACCESS_KEY_ID && CLOUDFLARE_R2_SECRET_ACCESS_KEY) {
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: CLOUDFLARE_R2_ACCESS_KEY_ID,
      secretAccessKey: CLOUDFLARE_R2_SECRET_ACCESS_KEY,
    },
  });
} else {
  console.warn('Warning: Cloudflare R2 credentials are missing or incomplete. S3Client cannot be initialized.');
}

async function uploadBase64ToR2(id: string, base64Data: string, index: number = 0): Promise<string> {
  const safeId = String(id || 'unknown').replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
  const suffix = index > 0 ? `_${index}` : '';
  const objectKey = `photos/${safeId}${suffix}.jpg`;
  const publicUrl = `${CLOUDFLARE_R2_PUBLIC_URL}/${objectKey}`;

  if (!s3Client) {
    console.warn(`[R2 Upload] No S3Client available for row ${id}, index ${index}. Skipping upload.`);
    return publicUrl;
  }

  try {
    let body: Buffer;
    let contentType = 'image/jpeg';

    if (base64Data.startsWith('data:')) {
      const match = base64Data.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (match) {
        contentType = match[1];
        body = Buffer.from(match[2], 'base64');
      } else {
        body = Buffer.from(base64Data);
      }
    } else {
      body = Buffer.from(base64Data, 'base64');
    }

    const command = new PutObjectCommand({
      Bucket: CLOUDFLARE_R2_BUCKET_NAME,
      Key: objectKey,
      Body: body,
      ContentType: contentType,
    });

    await s3Client.send(command);
    console.log(`[R2 Upload] Successfully uploaded photo for row ${id}, key: ${objectKey}`);
    return publicUrl;
  } catch (err) {
    console.error(`[R2 Upload] Failed uploading photo for row ${id}:`, err);
    throw err;
  }
}

async function runMigration() {
  console.log('\n--- Starting Supabase to Cloudflare R2 Image Migration ---');

  // Fetch all food logs that have potentially heavy image_urls
  const { data: foodLogs, error } = await supabaseAdmin
    .from('food_logs')
    .select('id, name, image_urls, firebase_uid, date');

  if (error) {
    console.error('Error fetching food logs from Supabase:', error.message);
    process.exit(1);
  }

  if (!foodLogs || foodLogs.length === 0) {
    console.log('No food logs found to inspect.');
    process.exit(0);
  }

  console.log(`Successfully fetched ${foodLogs.length} food logs.`);
  let migratedCount = 0;
  let rowsUpdatedCount = 0;
  let skippedCount = 0;

  for (const log of foodLogs) {
    const urls = log.image_urls;
    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      skippedCount++;
      continue;
    }

    let hasBase64 = false;
    const newUrls: string[] = [];

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      if (typeof url === 'string' && url.startsWith('data:image/')) {
        hasBase64 = true;
        try {
          const r2Url = await uploadBase64ToR2(log.id, url, i);
          newUrls.push(r2Url);
          migratedCount++;
        } catch (uploadErr) {
          console.error(`Skipping update for this image due to upload failure.`);
          newUrls.push(url); // keep original so we don't lose it if R2 fails
        }
      } else {
        newUrls.push(url);
      }
    }

    if (hasBase64) {
      console.log(`Updating food log row ID: ${log.id} (${log.name || 'Unnamed'}) in Supabase with clean R2 links...`);
      const { error: updateErr } = await supabaseAdmin
        .from('food_logs')
        .update({ image_urls: newUrls })
        .eq('id', log.id);

      if (updateErr) {
        console.error(`Failed to update food log ${log.id} in Supabase:`, updateErr.message);
      } else {
        rowsUpdatedCount++;
        console.log(`Row ID ${log.id} updated successfully!`);
      }
    } else {
      skippedCount++;
    }
  }

  console.log('\n=== Migration Completed ===');
  console.log(`Total inspect rows: ${foodLogs.length}`);
  console.log(`Skipped rows (already using URLs or empty): ${skippedCount}`);
  console.log(`Migrated individual images: ${migratedCount}`);
  console.log(`Updated database rows in Supabase: ${rowsUpdatedCount}`);
  console.log('===========================\n');
}

runMigration().catch((err) => {
  console.error('Unexpected migration error:', err);
  process.exit(1);
});
