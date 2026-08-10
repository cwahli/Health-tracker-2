import { trackApiCall } from './apiTracker';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { collection, getDocs, getDoc, doc, writeBatch } from 'firebase/firestore';
import { db, auth, googleProvider } from '../firebase';
import { ZipWriter, BlobWriter, BlobReader, TextReader, ZipReader, TextWriter } from '@zip.js/zip.js';
import { sanitizeForFirestore } from './firestoreUtils';

// Cache Google Access Token in-memory for security compliance
let cachedGoogleToken: string | null = null;

/**
 * Prompts user via a popup to authorize Google Drive & Sheets and returns the OAuth Access Token.
 */
export const getGoogleAccessToken = async (forcePrompt = false): Promise<string> => {
  if (cachedGoogleToken && !forcePrompt) {
    return cachedGoogleToken;
  }

  // Request required scopes
  googleProvider.addScope('https://www.googleapis.com/auth/drive');
  googleProvider.addScope('https://www.googleapis.com/auth/spreadsheets');

  try {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to retrieve OAuth access token from Google sign-in.');
    }
    cachedGoogleToken = credential.accessToken;
    return cachedGoogleToken;
  } catch (err: any) {
    console.error('Google Auth Popup Error:', err);
    throw new Error(err.message || 'OAuth authentication failed.');
  }
};

/**
 * Checks if we currently have an access token stored.
 */
export const hasGoogleToken = (): boolean => {
  return !!cachedGoogleToken;
};

/**
 * Clears the cached access token (e.g., on sign out).
 */
export const clearGoogleToken = () => {
  cachedGoogleToken = null;
};

/**
 * Converts a base64 Data URL or fetches an external image URL to return a binary Blob.
 */
async function resolveAndGetImageBlob(imgStr: string): Promise<Blob | null> {
  if (!imgStr) return null;

  if (imgStr.startsWith('data:image/')) {
    try {
      const parts = imgStr.split(';base64,');
      if (parts.length < 2) return null;
      const contentType = parts[0].split(':')[1];
      const raw = window.atob(parts[1]);
      const rawLength = raw.length;
      const uInt8Array = new Uint8Array(rawLength);
      for (let i = 0; i < rawLength; ++i) {
        uInt8Array[i] = raw.charCodeAt(i);
      }
      return new Blob([uInt8Array], { type: contentType });
    } catch (err) {
      console.error('Base64 image conversion failed:', err);
      return null;
    }
  } else if (imgStr.startsWith('http')) {
    try {
      // Proxy or direct fetch (with fallback if CORS/network blocks it)
      const res = await fetch(imgStr);
      if (res.ok) return await res.blob();
    } catch (err) {
      console.warn('CORS or network prevented direct fetch of external image:', imgStr, err);
    }
  }
  return null;
}

/**
 * Generates a standard formatted CSV string of all structured metrics.
 */
export function generateUserCsvSpreadsheet(
  profile: any,
  foodLogs: any[],
  biomarkerHistory: any[],
  actions: any[]
): string {
  let csv = '';

  // 1. Profile Information
  csv += '=== PROFILE INFORMATION ===\n';
  csv += 'Nickname,Email,Age,Ethnicity,Weight,Height,Gender,Timezone,Language\n';
  csv += `"${profile?.nickname || ''}","${profile?.email || ''}","${profile?.age ?? ''}","${profile?.ethnicity || ''}","${profile?.weight ?? ''}","${profile?.height ?? ''}","${profile?.gender || ''}","${profile?.timezone || ''}","${profile?.language || ''}"\n\n`;

  // 2. Targets
  csv += '=== TARGETS ===\n';
  csv += 'Target Weight (kg),Daily Caloric Target (kcal),Daily Water Target (ml),Daily Sleep Target (hrs),Daily Steps Target\n';
  csv += `"${profile?.targetWeight ?? ''}","${profile?.dailyCaloricTarget ?? ''}","${profile?.dailyWaterTarget ?? ''}","${profile?.dailySleepTarget ?? ''}","${profile?.dailyStepsTarget ?? ''}"\n\n`;

  // 3. Clinical Actions
  csv += '=== CLINICAL ACTIONS ===\n';
  csv += 'ID,Title,Description,Status,Priority,Due Date,Notes\n';
  if (actions && actions.length > 0) {
    actions.forEach(act => {
      const title = (act.title || '').replace(/"/g, '""');
      const desc = (act.description || '').replace(/"/g, '""');
      const notes = (act.notes || '').replace(/"/g, '""');
      csv += `"${act.id || ''}","${title}","${desc}","${act.status || ''}","${act.priority || ''}","${act.dueDate || ''}","${notes}"\n`;
    });
  } else {
    csv += 'No clinical actions recorded\n';
  }
  csv += '\n';

  // 4. Biomarkers History
  csv += '=== BIOMARKER HISTORY ===\n';
  csv += 'Date,Biomarker,Value,Unit,Normal Range,Is At Risk,Notes\n';
  if (biomarkerHistory && biomarkerHistory.length > 0) {
    biomarkerHistory.forEach(log => {
      const date = log.date || '';
      const notes = (log.notes || '').replace(/"/g, '""');
      if (log.biomarkers) {
        Object.entries(log.biomarkers).forEach(([name, val]) => {
          csv += `"${date}","${name}","${val}","","","","${notes}"\n`;
        });
      }
    });
  } else {
    csv += 'No biomarker history recorded\n';
  }

  // 5. Food Logs
  csv += '\n=== FOOD LOGS ===\n';
  csv += 'ID,Date,Meal Name,Calories (kcal),Protein (g),Carbs (g),Fat (g),Notes\n';
  if (foodLogs && foodLogs.length > 0) {
    foodLogs.forEach(food => {
      const mealName = (food.name || '').replace(/"/g, '""');
      const notes = (food.notes || '').replace(/"/g, '""');
      csv += `"${food.id || ''}","${food.date || ''}","${mealName}","${food.calories ?? ''}","${food.protein ?? ''}","${food.carbs ?? ''}","${food.fat ?? ''}","${notes}"\n`;
    });
  } else {
    csv += 'No food logs recorded\n';
  }

  return csv;
}

/**
 * Searches Google Drive for the master backup sheet registry.
 */
export async function findBackupRegistrySheet(accessToken: string): Promise<string | null> {
  const q = encodeURIComponent("name = 'Health Cockpit Backup Registry' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false");
  try {
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&spaces=drive`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const result = await response.json();
    if (result.files && result.files.length > 0) {
      return result.files[0].id;
    }
  } catch (e) {
    console.error('findBackupRegistrySheet error:', e);
  }
  return null;
}

/**
 * Creates a new Google Sheets file and returns its ID.
 */
export async function createGoogleSheet(accessToken: string, title: string): Promise<string> {
  const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: { title },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to create Google Sheet: ${text}`);
  }

  const result = await response.json();
  return result.spreadsheetId;
}

/**
 * Retrieves the name of the first sheet inside a spreadsheet to avoid localization issues (e.g., Hoja1, Sheet1, Feuille1).
 */
export async function getFirstSheetName(accessToken: string, spreadsheetId: string): Promise<string> {
  try {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties.title`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return 'Sheet1';
    const result = await response.json();
    if (result.sheets && result.sheets.length > 0) {
      return result.sheets[0].properties.title || 'Sheet1';
    }
  } catch (e) {
    console.error('getFirstSheetName error:', e);
  }
  return 'Sheet1';
}

/**
 * Initializes the header columns of the master backup sheet registry.
 */
export async function initializeSheetHeaders(accessToken: string, spreadsheetId: string) {
  const sheetName = await getFirstSheetName(accessToken, spreadsheetId);
  const range = `${sheetName}!A1:H1`;
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [
          [
            'Backup Date',
            'Version',
            'File Name',
            'Google Drive File ID',
            'Comment',
            'Accounts Backed Up Count',
            'Total Pictures Count',
            'Total Biomarkers Count',
          ],
        ],
      }),
    }
  );
}

/**
 * Appends a row log entry to the Google Sheet.
 */
export async function appendBackupLogToSheet(accessToken: string, spreadsheetId: string, rowData: any[]) {
  const sheetName = await getFirstSheetName(accessToken, spreadsheetId);
  const range = `${sheetName}!A:H`;
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: [rowData],
      }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to log to Google Sheet: ${text}`);
  }
}

/**
 * Uploads any binary Blob to Google Drive.
 */
export async function uploadToGoogleDrive(accessToken: string, fileBlob: Blob, filename: string): Promise<string> {
  const metadata = {
    name: filename,
    mimeType: 'application/zip',
  };

  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', fileBlob);

  const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google Drive upload failed: ${text}`);
  }

  const result = await response.json();
  return result.id;
}

/**
 * Queries all system accounts and packs everything into an encrypted ZIP file, uploading it to Drive & Sheet.
 */
export async function runBackupWorkflow(
  accessToken: string,
  version: string,
  comment: string,
  password?: string
): Promise<{ fileId: string; filename: string; stats: any }> {
  trackApiCall('firebase_read', 'Firestore Read - Backup: Fetch all users (scans the entire database to aggregate accounts for backup creation)');
      const usersSnap = await getDocs(collection(db, 'users'));
  const allAccountsData: any[] = [];

  let totalImages = 0;
  let totalBiomarkers = 0;
  const accountsBackupDetails: { nickname: string; email: string; images: number; biomarkers: number }[] = [];

  // Fetch all user accounts and their subcollections
  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const profile = userDoc.data();
    
    // Ignore accounts without valid emails or fields
    if (!profile.email) continue;

    // Fetch consolidated logs
    let foodLogs: any[] = [];
    let biomarkerHistory: any[] = [];
    
    trackApiCall('firebase_read', `Firestore Read - Backup: Fetch consolidated logs (downloads historical food and biomarker logs for backup ZIP generation)`);
    const bucketsSnap = await getDocs(collection(db, 'users', uid, 'consolidated_logs'));
    bucketsSnap.docs.forEach(docSnap => {
      const data = docSnap.data();
      if (data && data.logs) {
        Object.values(data.logs).forEach((logInfo: any) => {
          if (logInfo.type === 'food') {
            foodLogs.push(logInfo.data);
          } else if (logInfo.type === 'biomarker') {
            biomarkerHistory.push(logInfo.data);
          }
        });
      }
    });

    // Also fetch legacy food logs and biomarker history in case they haven't migrated
    trackApiCall('firebase_read', `Firestore Read - Backup: Fetch legacy food logs`);
    const legacyFoodLogsSnap = await getDocs(collection(db, 'users', uid, 'foodLogs'));
    legacyFoodLogsSnap.docs.forEach(d => {
      const data = d.data();
      const existingIdx = foodLogs.findIndex(f => f.id === data.id);
      if (existingIdx === -1) {
        foodLogs.push(data);
      } else {
        // Merge legacy images if missing
        if (data.imageUrl && !foodLogs[existingIdx].imageUrl) foodLogs[existingIdx].imageUrl = data.imageUrl;
        if (data.imageUrls && !foodLogs[existingIdx].imageUrls) foodLogs[existingIdx].imageUrls = data.imageUrls;
      }
    });

    trackApiCall('firebase_read', `Firestore Read - Backup: Fetch legacy biomarker history`);
    const legacyBioSnap = await getDocs(collection(db, 'users', uid, 'biomarkerHistory'));
    legacyBioSnap.docs.forEach(d => {
      const data = d.data();
      if (!biomarkerHistory.some(b => b.id === data.id)) {
        biomarkerHistory.push(data);
      }
    });

    // Fetch images from foodImages collection
    trackApiCall('firebase_read', `Firestore Read - Backup: Fetch food images`);
    const foodImagesSnap = await getDocs(collection(db, 'users', uid, 'foodImages'));
    const imageMap: Record<string, any> = {};
    foodImagesSnap.docs.forEach(d => {
      imageMap[d.id] = d.data();
    });

    // Merge images into foodLogs
    foodLogs = foodLogs.map(f => {
      const imgData = imageMap[f.id];
      if (imgData) {
        return {
          ...f,
          imageUrl: imgData.imageUrl || f.imageUrl,
          imageUrls: imgData.imageUrls || f.imageUrls
        };
      }
      return f;
    });

    // Fetch actions, dailyBenefits, foodIdeas
    let actions: any[] = [];
    let dailyBenefits: any[] = [];
    let foodIdeas: any[] = [];
    try {
      trackApiCall('firebase_read', `Firestore Read - Backup: Fetch dashboard (downloads dashboard action lists, goals, and diet guidelines for backup ZIP generation)`);
      const dashboardDoc = await getDoc(doc(db, 'users', uid, 'metadata', 'dashboard'));
      if (dashboardDoc.exists()) {
        const dData = dashboardDoc.data();
        actions = dData.actions || [];
        dailyBenefits = dData.dailyBenefits || [];
        foodIdeas = dData.foodIdeas || [];
      }
    } catch (e) {
      console.warn('Dashboard fetch error:', e);
    }

    // Fetch latest report
    let report: any = null;
    try {
      trackApiCall('firebase_read', `Firestore Read - Backup: Fetch latest report (downloads latest PDF baseline recommendation report for backup ZIP generation)`);
      const reportDoc = await getDoc(doc(db, 'users', uid, 'reports', 'latest'));
      if (reportDoc.exists()) {
        report = reportDoc.data();
      }
    } catch (e) {
      console.warn('Report fetch error:', e);
    }

    // Fetch agent analyses
    let agentAnalyses: any[] = [];
    try {
      trackApiCall('firebase_read', `Firestore Read - Backup: Fetch agent analyses (downloads all AI medical reviews and daily log audits for backup ZIP generation)`);
      const analysesSnap = await getDocs(collection(db, 'users', uid, 'agentAnalyses'));
      agentAnalyses = analysesSnap.docs.map(d => d.data());
    } catch (e) {
      console.warn('Analyses fetch error:', e);
    }

    // Calculate details for stats
    let userImages = 0;
    foodLogs.forEach(f => {
      if (f.imageUrl && !f.imageUrl.startsWith('ref:')) userImages++;
      if (f.imageUrls && Array.isArray(f.imageUrls)) {
        f.imageUrls.forEach(img => {
          if (img && !img.startsWith('ref:')) userImages++;
        });
      }
    });

    let userBiomarkers = 0;
    biomarkerHistory.forEach(log => {
      if (log.biomarkers) {
        userBiomarkers += Object.keys(log.biomarkers).length;
      }
    });

    totalImages += userImages;
    totalBiomarkers += userBiomarkers;

    accountsBackupDetails.push({
      nickname: profile.nickname || 'Unknown',
      email: profile.email,
      images: userImages,
      biomarkers: userBiomarkers,
    });

    allAccountsData.push({
      uid,
      profile,
      foodLogs,
      biomarkerHistory,
      actions,
      dailyBenefits,
      foodIdeas,
      report,
      agentAnalyses,
    });
  }

  // Generate password-protected ZIP using @zip.js/zip.js
  const zipWriter = new ZipWriter(new BlobWriter('application/zip'));

  for (const account of allAccountsData) {
    const nickname = account.profile?.nickname || 'Unknown';
    const email = account.profile?.email || 'unknown@example.com';
    const cleanNickname = nickname.replace(/[\/\\?%*:|"<>\s]/g, '_');
    const cleanEmail = email.replace(/[\/\\?%*:|"<>\s]/g, '_');

    // 1. Write the raw JSON file for flawless precise restoration
    const jsonPath = `${cleanNickname}/${cleanEmail}/data_backup.json`;
    await zipWriter.add(jsonPath, new TextReader(JSON.stringify(account)), {
      password,
      zipCrypto: !!password,
    });

    // 2. Write the formatted human-readable CSV Spreadsheet file
    const csvContent = generateUserCsvSpreadsheet(
      account.profile,
      account.foodLogs,
      account.biomarkerHistory,
      account.actions
    );
    const csvPath = `${cleanNickname}/${cleanEmail}/data_spreadsheet.csv`;
    await zipWriter.add(csvPath, new TextReader(csvContent), {
      password,
      zipCrypto: !!password,
    });

    // 3. Convert food log images and pack them inside images/
    for (const food of account.foodLogs) {
      const imagesList: string[] = [];
      if (food.imageUrl) imagesList.push(food.imageUrl);
      if (food.imageUrls && Array.isArray(food.imageUrls)) {
        food.imageUrls.forEach((img: string) => {
          if (!imagesList.includes(img)) imagesList.push(img);
        });
      }

      const realImgs = imagesList.filter(img => img && !img.startsWith('ref:'));
      for (let idx = 0; idx < realImgs.length; idx++) {
        const imgStr = realImgs[idx];
        const blob = await resolveAndGetImageBlob(imgStr);
        if (blob) {
          const ext = blob.type.split('/')[1] || 'png';
          const imgPath = `${cleanNickname}/${cleanEmail}/images/${food.id}_${idx}.${ext}`;
          await zipWriter.add(imgPath, new BlobReader(blob), {
            password,
            zipCrypto: !!password,
          });
        }
      }
    }
  }

  // Finalize zip creation
  const zipBlob = await zipWriter.close();

  // Construct standard versioned date filename: [version]-[date] (e.g. V1-05-07-2026)
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const formattedDate = `${day}-${month}-${year}`;
  const filename = `${version}-${formattedDate}.zip`;

  // Upload ZIP file to Google Drive
  const driveFileId = await uploadToGoogleDrive(accessToken, zipBlob, filename);

  // Write to Google Sheets backup registry
  let sheetId = await findBackupRegistrySheet(accessToken);
  if (!sheetId) {
    sheetId = await createGoogleSheet(accessToken, 'Health Cockpit Backup Registry');
    await initializeSheetHeaders(accessToken, sheetId);
  }

  const rowData = [
    new Date().toLocaleString(),
    version,
    filename,
    driveFileId,
    comment,
    usersSnap.size,
    totalImages,
    totalBiomarkers,
  ];
  await appendBackupLogToSheet(accessToken, sheetId, rowData);

  return {
    fileId: driveFileId,
    filename,
    stats: {
      accountsCount: usersSnap.size,
      totalImages,
      totalBiomarkers,
      details: accountsBackupDetails,
    },
  };
}

/**
 * Lists all backup zip files from Google Drive.
 */
export async function listBackupsFromDrive(accessToken: string): Promise<any[]> {
  const q = encodeURIComponent("mimeType = 'application/zip' and trashed = false");
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&fields=files(id,name,createdTime)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error('Failed to retrieve backup files list from Google Drive.');
  }
  const result = await response.json();
  return result.files || [];
}

/**
 * Downloads a file's content from Google Drive as a binary Blob.
 */
export async function downloadFileFromDrive(accessToken: string, fileId: string): Promise<Blob> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error('Failed to download ZIP file from Google Drive.');
  }
  return await response.blob();
}

/**
 * Unzips and parses the chosen backup ZIP, extracting preview stats for each account.
 */
export async function previewBackupZip(
  fileBlob: Blob,
  password?: string
): Promise<any[]> {
  const zipReader = new ZipReader(new BlobReader(fileBlob));
  const entries = await zipReader.getEntries();
  const accountsMap = new Map<string, {
    nickname: string;
    email: string;
    imageCount: number;
    biomarkerCount: number;
    accountCount: number; // 1
    jsonData?: any;
  }>();

  try {
    for (const entry of entries) {
      const pathParts = entry.filename.split('/');
      if (pathParts.length < 2) continue;
      const nickname = pathParts[0];
      const email = pathParts[1];
      const accountKey = `${nickname}/${email}`;

      if (!accountsMap.has(accountKey)) {
        accountsMap.set(accountKey, { nickname, email, imageCount: 0, biomarkerCount: 0, accountCount: 1 });
      }
      const acc = accountsMap.get(accountKey)!;

      if (entry.filename.includes('/images/')) {
        acc.imageCount++;
      } else if (entry.filename.endsWith('data_backup.json')) {
        try {
          const jsonText = await (entry as any).getData!(new TextWriter(), { password });
          const jsonData = JSON.parse(jsonText);
          acc.jsonData = jsonData;
          // Count exact biomarkers
          acc.biomarkerCount = jsonData.biomarkerHistory?.reduce(
            (sum: number, log: any) => sum + (log.biomarkers ? Object.keys(log.biomarkers).length : 0),
            0
          ) || 0;
        } catch (err) {
          console.error('Decryption failed for backup entry:', err);
          throw new Error('Incorrect password or corrupted backup payload.');
        }
      }
    }
  } finally {
    await zipReader.close();
  }

  return Array.from(accountsMap.values());
}

/**
 * Restores a specific account or all accounts from a decrypted ZIP payload into Firestore.
 */
export async function restoreAccountToFirestore(uid: string, data: any) {
  const batch = writeBatch(db);

  // 1. Restore Profile Information
  if (data.profile) {
    const profileRef = doc(db, 'users', uid);
    const profileCopy = { ...data.profile };
    delete profileCopy.agentAnalyses; // Kept in separate subcollection
    batch.set(profileRef, sanitizeForFirestore(profileCopy), { merge: true });
  }

  // 2. Restore Food Logs
  if (data.foodLogs && Array.isArray(data.foodLogs)) {
    data.foodLogs.forEach((food: any) => {
      const foodRef = doc(db, 'users', uid, 'foodLogs', food.id);
      batch.set(foodRef, sanitizeForFirestore(food), { merge: true });
    });
  }

  // 3. Restore Biomarker History
  if (data.biomarkerHistory && Array.isArray(data.biomarkerHistory)) {
    data.biomarkerHistory.forEach((log: any) => {
      const logRef = doc(db, 'users', uid, 'biomarkerHistory', log.id);
      batch.set(logRef, sanitizeForFirestore(log), { merge: true });
    });
  }

  // 4. Restore Dashboard Metadata (clinical actions, daily benefits, food ideas)
  const dashboardRef = doc(db, 'users', uid, 'metadata', 'dashboard');
  batch.set(
    dashboardRef,
    sanitizeForFirestore({
      actions: data.actions || [],
      dailyBenefits: data.dailyBenefits || [],
      foodIdeas: data.foodIdeas || [],
    }),
    { merge: true }
  );

  // 5. Restore Latest Recommendation Report
  if (data.report) {
    const reportRef = doc(db, 'users', uid, 'reports', 'latest');
    batch.set(reportRef, sanitizeForFirestore(data.report), { merge: true });
  }

  // 6. Restore Agent Analyses subcollection
  if (data.agentAnalyses && Array.isArray(data.agentAnalyses)) {
    data.agentAnalyses.forEach((analysis: any) => {
      const analysisRef = doc(db, 'users', uid, 'agentAnalyses', analysis.id);
      batch.set(analysisRef, sanitizeForFirestore(analysis), { merge: true });
    });
  }

  await batch.commit();
}
