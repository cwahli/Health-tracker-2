const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

const targetStr = `};
const QUOTA_STORAGE_KEY`;

const insertStr = `};

const MAX_SNAPSHOTS = 5;

const getSnapshotKey = (email?: string | null) => {
  const norm = (email || auth.currentUser?.email || 'guest').toLowerCase().trim();
  return \`health_cockpit_snapshots_\${norm}\`;
};

/** Save a named snapshot of all current data to localStorage. */
const saveLocalSnapshot = (
  label: string,
  email: string | null | undefined,
  bundle: {
    profile: any;
    foodLogs: any[];
    biomarkers: Record<string, any>;
    biomarkerHistory: any[];
    actions?: any[];
    dailyBenefits?: any[];
    report?: any;
  }
) => {
  try {
    const key = getSnapshotKey(email);
    const existing: any[] = (() => {
      try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
    })();

    // Strip base64 images from food logs to keep snapshot small
    const lightFoodLogs = (bundle.foodLogs || []).map((f: any) => {
      if (!f.imageUrl || !f.imageUrl.startsWith('data:image/')) return f;
      return { ...f, imageUrl: '[image_removed_for_snapshot]' };
    });

    const snapshot = {
      id: \`snap_\${Date.now()}\`,
      timestamp: new Date().toISOString(),
      label,
      data: {
        profile: bundle.profile,
        foodLogs: lightFoodLogs,
        biomarkers: bundle.biomarkers,
        biomarkerHistory: bundle.biomarkerHistory,
        actions: bundle.actions || [],
        dailyBenefits: bundle.dailyBenefits || [],
        report: bundle.report || null
      }
    };

    const updated = [snapshot, ...existing].slice(0, MAX_SNAPSHOTS);
    localStorage.setItem(key, JSON.stringify(updated));
    return true;
  } catch (e) {
    console.warn('[Snapshot] Could not save snapshot:', e);
    return false;
  }
};

/** Load all snapshots for the current user. */
const loadLocalSnapshots = (email?: string | null): any[] => {
  try {
    return JSON.parse(localStorage.getItem(getSnapshotKey(email)) || '[]');
  } catch { return []; }
};

/** Delete a specific snapshot by id. */
const deleteLocalSnapshot = (email: string | null | undefined, id: string) => {
  try {
    const key = getSnapshotKey(email);
    const existing = loadLocalSnapshots(email);
    localStorage.setItem(key, JSON.stringify(existing.filter((s: any) => s.id !== id)));
  } catch (e) {}
};
const QUOTA_STORAGE_KEY`;

code = code.replace(targetStr, insertStr);
fs.writeFileSync('src/App.tsx', code);
