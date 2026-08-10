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

async function runCheck() {
  console.log('=== Supabase Image & Row Size Diagnostic ===');
  
  // Fetch all rows
  const { data: foodLogs, error } = await supabaseAdmin
    .from('food_logs')
    .select('id, name, image_urls, firebase_uid, date');

  if (error) {
    console.error('Error fetching food logs:', error.message);
    process.exit(1);
  }

  if (!foodLogs || foodLogs.length === 0) {
    console.log('No food logs found in Supabase.');
    process.exit(0);
  }

  console.log(`Total rows fetched: ${foodLogs.length}`);

  let totalSizeChars = 0;
  let maxRowSizeChars = 0;
  let maxRowId = '';
  let maxRowName = '';
  
  let maxImageSizeChars = 0;
  let maxImageUrl = '';
  let maxImageRowId = '';

  let base64Count = 0;
  let r2Count = 0;
  let otherUrlCount = 0;

  for (const log of foodLogs) {
    // Estimate entire row JSON size in characters
    const rowJson = JSON.stringify(log);
    const rowSize = rowJson.length;
    totalSizeChars += rowSize;

    if (rowSize > maxRowSizeChars) {
      maxRowSizeChars = rowSize;
      maxRowId = log.id;
      maxRowName = log.name || 'Unnamed';
    }

    const urls = log.image_urls;
    if (urls && Array.isArray(urls)) {
      for (const url of urls) {
        if (typeof url !== 'string') continue;

        const urlSize = url.length;
        if (urlSize > maxImageSizeChars) {
          maxImageSizeChars = urlSize;
          maxImageUrl = url;
          maxImageRowId = log.id;
        }

        if (url.startsWith('data:image/')) {
          base64Count++;
        } else if (url.includes('pub-d17eecca64f82625d29dc38b14f46c14.r2.dev') || url.includes('.r2.dev')) {
          r2Count++;
        } else {
          otherUrlCount++;
        }
      }
    }
  }

  const avgRowSizeChars = Math.round(totalSizeChars / foodLogs.length);

  console.log('\n--- Size Statistics ---');
  console.log(`Average Row Size: ${avgRowSizeChars.toLocaleString()} chars (~${Math.round(avgRowSizeChars / 1024)} KB)`);
  console.log(`Largest Row ID: ${maxRowId}`);
  console.log(`Largest Row Name: "${maxRowName}"`);
  console.log(`Largest Row Size: ${maxRowSizeChars.toLocaleString()} chars (~${Math.round(maxRowSizeChars / 1024)} KB)`);
  
  console.log('\n--- Image URL Type Distribution ---');
  console.log(`Remaining Base64 images: ${base64Count}`);
  console.log(`Cloudflare R2 images:     ${r2Count}`);
  console.log(`Other public URL images:  ${otherUrlCount}`);

  console.log('\n--- Largest Single Image URL ---');
  console.log(`Log ID with largest image: ${maxImageRowId}`);
  console.log(`Largest image URL size:    ${maxImageSizeChars.toLocaleString()} chars`);
  console.log(`URL prefix:                ${maxImageUrl ? maxImageUrl.slice(0, 100) + '...' : 'None'}`);

  if (base64Count === 0) {
    console.log('\n✅ Verification Perfect: All base64 images have been successfully moved to R2!');
  } else {
    console.log(`\n⚠️ Warning: ${base64Count} base64 images still remain in Supabase. Please run the migration script again.`);
  }
  console.log('============================================\n');
}

runCheck().catch(err => {
  console.error('Diagnostic failed:', err);
  process.exit(1);
});
