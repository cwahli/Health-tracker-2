import 'dotenv/config';
import { initializeApp } from 'firebase/app';
import { initializeFirestore, doc, getDoc, updateDoc } from 'firebase/firestore';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import fs from 'fs';
import path from 'path';
import { supabaseAdmin } from '../supabaseAdmin.js';

// 1. Load Firebase and R2 Configurations
const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
let firebaseConfig: any = {};
if (fs.existsSync(configPath)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err: any) {
    console.error('Error parsing firebase-applet-config.json:', err.message);
  }
}

const CLOUDFLARE_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || 'd17eecca64f82625d29dc38b14f46c14';
const CLOUDFLARE_R2_BUCKET_NAME = process.env.CLOUDFLARE_R2_BUCKET_NAME || 'health-tracker-photos';
const CLOUDFLARE_R2_PUBLIC_URL = (process.env.CLOUDFLARE_R2_PUBLIC_URL || 'https://pub-d17eecca64f82625d29dc38b14f46c14.r2.dev').replace(/\/$/, '');
const CLOUDFLARE_R2_ACCESS_KEY_ID = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '';
const CLOUDFLARE_R2_SECRET_ACCESS_KEY = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '';

console.log('=== Firestore Migration Env Diagnostic ===');
console.log('Firebase Project ID:', firebaseConfig?.projectId || 'Missing');
console.log('Firestore Database ID:', firebaseConfig?.firestoreDatabaseId || '(default)');
console.log('CLOUDFLARE_ACCOUNT_ID:', CLOUDFLARE_ACCOUNT_ID);
console.log('CLOUDFLARE_R2_BUCKET_NAME:', CLOUDFLARE_R2_BUCKET_NAME);
console.log('CLOUDFLARE_R2_PUBLIC_URL:', CLOUDFLARE_R2_PUBLIC_URL);
console.log('CLOUDFLARE_R2_ACCESS_KEY_ID:', CLOUDFLARE_R2_ACCESS_KEY_ID ? 'Present' : 'Missing');
console.log('CLOUDFLARE_R2_SECRET_ACCESS_KEY:', CLOUDFLARE_R2_SECRET_ACCESS_KEY ? 'Present' : 'Missing');
console.log('==========================================');

// 2. Initialize Clients
const app = initializeApp(firebaseConfig);

// Support custom database instances if provided
const db = firebaseConfig?.firestoreDatabaseId
  ? initializeFirestore(app, {}, firebaseConfig.firestoreDatabaseId)
  : initializeFirestore(app, {});

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
    console.warn(`[R2 Upload] No S3Client available for ID ${id}, index ${index}. Skipping upload.`);
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
    console.log(`[R2 Upload] Successfully uploaded photo for ID ${id}, key: ${objectKey}`);
    return publicUrl;
  } catch (err) {
    console.error(`[R2 Upload] Failed uploading photo for ID ${id}:`, err);
    throw err;
  }
}

async function runMigration() {
  console.log('\n--- Starting Firestore to Cloudflare R2 Image Migration ---');

  // Load existing food logs from Supabase for matching
  console.log('[Firestore Migrate] Fetching food logs from Supabase to match existing images...');
  const { data: foodLogs, error: supabaseErr } = await supabaseAdmin
    .from('food_logs')
    .select('id, image_urls, firebase_uid');

  if (supabaseErr) {
    console.error('Error: Failed to fetch food logs from Supabase:', supabaseErr.message);
    process.exit(1);
  }

  if (!foodLogs || foodLogs.length === 0) {
    console.log('No food logs found in Supabase.');
    process.exit(0);
  }

  console.log(`[Firestore Migrate] Loaded ${foodLogs.length} food logs from Supabase.`);
  let migratedCount = 0;
  let matchedCount = 0;
  let docsUpdatedCount = 0;
  let skippedCount = 0;

  for (const log of foodLogs) {
    const docId = log.id;
    const userId = log.firebase_uid || 'unknown_user';

    if (!log.firebase_uid) {
      console.log(`[Firestore Migrate] Skipping log ${docId} because it has no firebase_uid.`);
      skippedCount++;
      continue;
    }

    // Reference the specific document in Firestore
    const docRef = doc(db, 'users', userId, 'foodImages', docId);
    let docSnap;
    try {
      docSnap = await getDoc(docRef);
    } catch (docErr: any) {
      console.warn(`[Firestore Migrate] Failed to fetch Firestore doc users/${userId}/foodImages/${docId}:`, docErr.message || docErr);
      continue;
    }

    if (!docSnap.exists()) {
      skippedCount++;
      continue;
    }

    const data = docSnap.data() || {};
    let hasChanges = false;
    let updatedImageUrl = data.imageUrl || null;
    let updatedImageUrls = Array.isArray(data.imageUrls) ? [...data.imageUrls] : [];

    // Filter out base64 strings from Supabase URLs to see if we have migrated URLs in Supabase
    const cleanSupabaseUrls = log.image_urls && Array.isArray(log.image_urls)
      ? log.image_urls.filter((url: string) => typeof url === 'string' && !url.startsWith('data:'))
      : [];

    if (cleanSupabaseUrls.length > 0) {
      // Match up with Supabase R2 URLs
      const isImageUrlAligned = updatedImageUrl === cleanSupabaseUrls[0];
      const isImageUrlsAligned = JSON.stringify(updatedImageUrls) === JSON.stringify(cleanSupabaseUrls);

      if (!isImageUrlAligned || !isImageUrlsAligned) {
        console.log(`[Firestore Migrate] Match found in Supabase for doc ${docId}! Aligning Firestore with Supabase R2 URLs directly...`);
        updatedImageUrl = cleanSupabaseUrls[0];
        updatedImageUrls = cleanSupabaseUrls;
        hasChanges = true;
        matchedCount++;
      }
    } else {
      // No clean URLs in Supabase - upload base64 from Firestore to R2
      if (typeof data.imageUrl === 'string' && data.imageUrl.startsWith('data:image/')) {
        hasChanges = true;
        try {
          console.log(`[Firestore Migrate] Uploading imageUrl for doc ${docId} (User ${userId})...`);
          const r2Url = await uploadBase64ToR2(docId, data.imageUrl, 0);
          updatedImageUrl = r2Url;
          migratedCount++;
        } catch (uploadErr) {
          console.error(`Skipping update for single imageUrl in doc ${docId} due to upload failure.`);
        }
      }

      if (Array.isArray(data.imageUrls)) {
        for (let i = 0; i < data.imageUrls.length; i++) {
          const url = data.imageUrls[i];
          if (typeof url === 'string' && url.startsWith('data:image/')) {
            hasChanges = true;
            try {
              console.log(`[Firestore Migrate] Uploading imageUrls[${i}] for doc ${docId} (User ${userId})...`);
              const r2Url = await uploadBase64ToR2(docId, url, i);
              updatedImageUrls[i] = r2Url;
              migratedCount++;
            } catch (uploadErr) {
              console.error(`Skipping update for imageUrls[${i}] in doc ${docId} due to upload failure.`);
            }
          }
        }
      }
    }

    // 3. Update Firestore Document
    if (hasChanges) {
      console.log(`Updating doc ID: ${docId} (User: ${userId}) in Firestore with clean R2 links...`);
      try {
        await updateDoc(docRef, {
          imageUrl: updatedImageUrl,
          imageUrls: updatedImageUrls
        });
        docsUpdatedCount++;
        console.log(`Firestore doc ID ${docId} updated successfully!`);
      } catch (updateErr: any) {
        console.error(`Failed to update Firestore document ${docId}:`, updateErr.message || updateErr);
      }
    } else {
      skippedCount++;
    }
  }

  console.log('\n=== Firestore Migration Completed ===');
  console.log(`Total inspected documents: ${foodLogs.length}`);
  console.log(`Skipped documents (already using URLs or empty): ${skippedCount}`);
  console.log(`Matched and aligned from Supabase: ${matchedCount}`);
  console.log(`Migrated individual images to R2: ${migratedCount}`);
  console.log(`Updated database documents in Firestore: ${docsUpdatedCount}`);
  console.log('=====================================\n');
}

runMigration().catch((err) => {
  console.error('Unexpected migration error:', err);
  process.exit(1);
});
