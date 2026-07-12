import React, { useState, useEffect, useRef } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { UserProfile, FoodLog, BiomarkerLog, HealthAction, DailyBenefit, RecommendationReport, DbInteraction, QuotaData, FoodIdea } from './types';
import Header from './components/Header';
import BottomNav from './components/BottomNav';
import AuthScreen from './components/AuthScreen';
import HomeTab from './components/HomeTab';
import InsightsTab from './components/InsightsTab';
import FoodHistoryTab from './components/FoodHistoryTab';
import MedicalHistoryTab from './components/MedicalHistoryTab';
import TrendsTab from './components/TrendsTab';
import ConflictResolutionModal from './components/ConflictResolutionModal';
import LogChat from './components/LogChat';
import { translations } from './utils/translations';
import { AVAILABLE_LLMS } from './utils/llm';
import { getLocalFallbackReport } from './utils/fallbackReport';
import { Plus, HeartHandshake, RefreshCw, Sparkles, Stethoscope, Utensils, Loader, CloudLightning, AlertTriangle } from 'lucide-react';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc, getDocFromServer, getDocsFromServer, onSnapshot, getDocsFromCache, writeBatch } from 'firebase/firestore';
import { sanitizeForFirestore } from './utils/firestoreUtils';
import { getCurrentDateInTimezone, toYYYYMMDD, normalizeBiomarkerHistory } from './utils/dateUtils';
import { biomarkerDefinitions, isAsianEthnicity, hasBmiPendingAlert, getProfileFingerprint } from './utils/biomarkers';
import { standardizeUnit, CONVERSION_FACTORS } from './utils/unitConversion';
import { get, set } from 'idb-keyval';
import { parse } from 'yaml';
import { runCleanupMigration } from './utils/migrationTask';
import { syncLogsWithTimeBuckets, fetchAllConsolidatedLogs } from "./utils/syncUtils";
import { compressImage } from "./utils/imageCompressor";
const getStorageKey = (email?: string | null) => {
  const norm = (email || auth.currentUser?.email || 'guest').toLowerCase().trim();
  return `health_cockpit_app_data_${norm}`;
};

const MAX_SNAPSHOTS = 5;

const getSnapshotKey = (email?: string | null) => {
  const norm = (email || auth.currentUser?.email || 'guest').toLowerCase().trim();
  return `health_cockpit_snapshots_${norm}`;
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
      id: `snap_${Date.now()}`,
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
const QUOTA_STORAGE_KEY = 'health_cockpit_quota_data';
const getQuotaKey = () => {
  return new Date().toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
};
const getDynamicStyles = (profile: any) => {
  if (!profile) return '';
  const p = profile.themePalette || {};
  const fontSize = profile.fontSize || 'normal';
  const fontFamily = profile.fontFamily || 'Inter';
  const fontMono = profile.fontMono || 'JetBrains Mono';
  
  let fontSizeCss = '';
  if (fontSize === 'tiny') {
    fontSizeCss = `
      :root, html { font-size: 12px !important; }
    `;
  } else if (fontSize === 'small') {
    fontSizeCss = `
      :root, html { font-size: 14px !important; }
    `;
  } else if (fontSize === 'normal') {
    fontSizeCss = `
      :root, html { font-size: 16px !important; }
    `;
  } else if (fontSize === 'large') {
    fontSizeCss = `
      :root, html { font-size: 18px !important; }
    `;
  } else if (fontSize === 'xl') {
    fontSizeCss = `
      :root, html { font-size: 20px !important; }
    `;
  } else if (fontSize === 'xxl') {
    fontSizeCss = `
      :root, html { font-size: 24px !important; }
    `;
  }
  const sizeMap = {
    tiny: '12px',
    small: '14px',
    normal: '16px',
    large: '18px',
    xl: '20px',
    xxl: '24px',
    '3xl': '30px',
    '4xl': '36px',
    '5xl': '48px',
    '6xl': '60px'
  };
  const titleSize = profile.fontSizeTitle ? sizeMap[profile.fontSizeTitle as keyof typeof sizeMap] : '';
  const subtitleSize = profile.fontSizeSubtitle ? sizeMap[profile.fontSizeSubtitle as keyof typeof sizeMap] : '';
  const descSize = profile.fontSizeDescription ? sizeMap[profile.fontSizeDescription as keyof typeof sizeMap] : '';
  const smallSize = profile.fontSizeBodySmall ? sizeMap[profile.fontSizeBodySmall as keyof typeof sizeMap] : '';
  const subtitleSmallSize = profile.fontSizeSubtitleSmall ? sizeMap[profile.fontSizeSubtitleSmall as keyof typeof sizeMap] : '14px';
  const keyMetricSize = profile.fontSizeKeyMetric ? sizeMap[profile.fontSizeKeyMetric as keyof typeof sizeMap] : '36px';
  const xsSize = profile.fontSizeXS ? sizeMap[profile.fontSizeXS as keyof typeof sizeMap] : '10px';
  const bodySize = profile.fontSizeBody ? sizeMap[profile.fontSizeBody as keyof typeof sizeMap] : '16px';
  fontSizeCss += `
    .font-size-title { font-size: ${titleSize || '24px'} !important; }
    .font-size-subtitle { font-size: ${subtitleSize || '18px'} !important; }
    .font-size-subtitle-small { font-size: ${subtitleSmallSize} !important; }
    .font-size-body { font-size: ${bodySize} !important; }
    .font-size-body-small { font-size: ${smallSize || '12px'} !important; }
    .font-size-key-metric { font-size: ${keyMetricSize} !important; }
    .font-size-xs { font-size: ${xsSize} !important; }
  `;
  if (titleSize || subtitleSize || descSize || smallSize) {
    fontSizeCss += `
      ${titleSize ? `h1, h2, h3, .font-display, .text-xl, .text-2xl, .text-3xl, .text-4xl, .text-5xl { font-size: ${titleSize} !important; line-height: 1.3 !important; }` : ''}
      ${subtitleSize ? `h4, h5, .subtitle-text, .text-lg { font-size: ${subtitleSize} !important; line-height: 1.4 !important; }` : ''}
      ${descSize ? `p, .desc-text, .text-base, .text-md { font-size: ${descSize} !important; line-height: 1.5 !important; }` : ''}
      ${smallSize ? `small, .text-sm, .text-xs, .text-[11px], .text-[10px], .text-[9px], .body-small { font-size: ${smallSize} !important; line-height: 1.5 !important; }` : ''}
    `;
  }
  let fontCss = `
    :root {
      --font-sans: "${fontFamily}", ui-sans-serif, system-ui, sans-serif !important;
      --font-display: "${fontFamily}", sans-serif !important;
      --font-mono: "${fontMono}", ui-monospace, monospace !important;
    }
    body {
      font-family: var(--font-sans) !important;
    }
  `;
  let colorCss = '';
  colorCss += `
    :root {
  `;
  if (p.button) {
    colorCss += `
      --color-indigo-500: ${p.button} !important;
      --color-indigo-600: ${p.button} !important;
      --color-indigo-700: ${p.button}dd !important;
      --color-indigo-50: ${p.button}12 !important;
      --color-indigo-950: ${p.button}25 !important;
    `;
  }
  if (p.background) {
    colorCss += `
      --color-slate-50: ${p.background} !important;
      --color-slate-950: ${p.background} !important;
    `;
  }
  if (p.bgApp) {
    colorCss += `
      --color-slate-50: ${p.bgApp} !important;
      --color-slate-950: ${p.bgApp} !important;
    `;
  }
  if (p.bgCard) {
    colorCss += `
      --color-white: ${p.bgCard} !important;
      --color-slate-900: ${p.bgCard} !important;
    `;
  }
  if (p.border) {
    colorCss += `
      --color-slate-100: ${p.border}88 !important;
      --color-slate-200: ${p.border} !important;
      --color-slate-300: ${p.border} !important;
      --color-slate-800: ${p.border} !important;
    `;
  }
  if (p.warning) {
    colorCss += `
      --color-rose-500: ${p.warning} !important;
      --color-rose-600: ${p.warning} !important;
      --color-rose-800: ${p.warning} !important;
      --color-rose-50: ${p.warning}12 !important;
      --color-rose-100: ${p.warning}22 !important;
    `;
  }
  if (p.caution) {
    colorCss += `
      --color-amber-500: ${p.caution} !important;
      --color-amber-600: ${p.caution} !important;
      --color-amber-50: ${p.caution}12 !important;
    `;
  }
  if (p.success) {
    colorCss += `
      --color-emerald-500: ${p.success} !important;
      --color-emerald-600: ${p.success} !important;
      --color-emerald-50: ${p.success}12 !important;
    `;
  }
  if (p.text) {
    colorCss += `
      --color-slate-900: ${p.text} !important;
      --color-slate-950: ${p.text} !important;
      --color-slate-800: ${p.text} !important;
    `;
  }
  if (p.textSecondary) {
    colorCss += `
      --color-slate-500: ${p.textSecondary} !important;
      --color-slate-600: ${p.textSecondary} !important;
      --color-slate-400: ${p.textSecondary}aa !important;
    `;
  }
  if (p.neutralSetting) {
    colorCss += `
      --color-slate-700: ${p.neutralSetting} !important;
      --color-slate-300: ${p.neutralSetting}dd !important;
    `;
  }
  colorCss += `
    }
  `;
  return `
    ${fontSizeCss}
    ${fontCss}
    ${colorCss}
  `;
};
function cleanData<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  return JSON.parse(JSON.stringify(obj, (key, value) => {
    return value === undefined ? null : value;
  }));
}
function isDeepEqual(obj1: any, obj2: any): boolean {
  if (obj1 === obj2) return true;
  if (typeof obj1 !== 'object' || obj1 === null || typeof obj2 !== 'object' || obj2 === null) {
    return false;
  }
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);
  
  // Filter out undefined and null values to avoid breaking equality checks on missing or null properties
  const activeKeys1 = keys1.filter(k => obj1[k] !== undefined && obj1[k] !== null);
  const activeKeys2 = keys2.filter(k => obj2[k] !== undefined && obj2[k] !== null);

  if (activeKeys1.length !== activeKeys2.length) return false;
  for (const key of activeKeys1) {
    if (!activeKeys2.includes(key)) return false;
    if (!isDeepEqual(obj1[key], obj2[key])) return false;
  }
  return true;
}
const safeSaveToLocalStorage = async (key: string, bundle: any) => {
  try {
    const existing = await get(key) || {};
    const mergedBundle = {
      ...bundle,
      lastSyncedAt: bundle.lastSyncedAt !== undefined ? bundle.lastSyncedAt : existing.lastSyncedAt
    };
    await set(key, mergedBundle);
  } catch (e) {
    console.error("Failed to save to IndexedDB:", e);
  }
};
export default function App() {
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [showSnapshotPanel, setShowSnapshotPanel] = useState(false);
  const [lastSnapshotLabel, setLastSnapshotLabel] = useState<string | null>(null);
  // One-time prompt reset to clean up stale localStorage for data_review
  useEffect(() => {
    if (typeof window !== 'undefined' && localStorage.getItem('migration_july06_prompts_cleaned_v2') !== 'true') {
      localStorage.removeItem('custom_system_instruction_data_review');
      localStorage.removeItem('custom_variable_data_data_review');
      localStorage.setItem('migration_july06_prompts_cleaned_v2', 'true');
      console.log("Stale custom prompts for data_review successfully cleared.");
    }
  }, []);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const hasRunImageCompression = useRef(false);
  const [dismissedBmiAlerts, setDismissedBmiAlerts] = useState<{[key: string]: boolean}>(() => {
    try {
      const saved = localStorage.getItem('dismissedBmiAlerts');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });
  const handleDismissBmiAlert = () => {
    if (!profile) return;
    const fingerprint = getProfileFingerprint(profile);
    const updated = { ...dismissedBmiAlerts, [fingerprint]: true };
    setDismissedBmiAlerts(updated);
    localStorage.setItem('dismissedBmiAlerts', JSON.stringify(updated));
  };
  const [activeTab, setActiveTab] = useState<'home' | 'insights' | 'food' | 'medical' | 'trends'>('home');

  useEffect(() => {
    const handleSwitchTab = (e: Event) => {
      const customEvent = e as CustomEvent;
      if (customEvent.detail?.tab) {
        setActiveTab(customEvent.detail.tab);
      }
    };
    window.addEventListener('switch-tab', handleSwitchTab);
    return () => window.removeEventListener('switch-tab', handleSwitchTab);
  }, []);
  const [initiallyExpandedFoodId, setInitiallyExpandedFoodId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<'synced' | 'syncing' | 'local' | 'conflict'>('local');
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);
  const [conflictData, setConflictData] = useState<{
    localProfile: UserProfile;
    cloudProfile: UserProfile;
    localFoods: FoodLog[];
    cloudFoods: FoodLog[];
    localBioHistory: BiomarkerLog[];
    cloudBioHistory: BiomarkerLog[];
    localActions: HealthAction[];
    cloudActions: HealthAction[];
    localBenefits: DailyBenefit[];
    cloudBenefits: DailyBenefit[];
    cloudReport: RecommendationReport | null;
    localReport: RecommendationReport | null;
  } | null>(null);
  const [isFirestoreQuotaExceeded, setIsFirestoreQuotaExceeded] = useState<boolean>(() => {
    const exceeded = localStorage.getItem('firestore_quota_exceeded') === 'true';
    if (exceeded) {
      const saved = localStorage.getItem(QUOTA_STORAGE_KEY);
      const currentKey = getQuotaKey();
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed.date !== currentKey) {
            localStorage.removeItem('firestore_quota_exceeded');
            return false;
          }
        } catch (e) {}
      }
    }
    return exceeded;
  });
  const handleFirestoreError = (err: any) => {
    if (!err) return;
    const msg = String(err.message || err.code || err || '').toLowerCase();
    if (
      msg.includes('resource-exhausted') || 
      msg.includes('quota') || 
      msg.includes('limit exceeded') ||
      err.code === 'resource-exhausted'
    ) {
      setIsFirestoreQuotaExceeded(true);
      localStorage.setItem('firestore_quota_exceeded', 'true');
      setSyncState('local');
    }
  };
  const [hideSensitive, setHideSensitive] = useState<boolean>(false);
  // DB Transaction tracker state for spinning loader click analytics
  const [dbInteractions, setDbInteractions] = useState<DbInteraction[]>(() => {
    try {
      const saved = localStorage.getItem('dbInteractions_history');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map((op: any) => ({
          ...op,
          status: op.status === 'pending' ? 'error' : op.status,
          errorMessage: op.status === 'pending' ? 'Interrupted by page reload' : op.errorMessage
        }));
      }
    } catch (e) {}
    return [];
  });
  
  useEffect(() => {
    localStorage.setItem('dbInteractions_history', JSON.stringify(dbInteractions));
  }, [dbInteractions]);

  useEffect(() => {
    if (profile?.email) {
      setSnapshots(loadLocalSnapshots(profile.email));
    }
  }, [profile?.email]);

  const handleRestoreSnapshot = async (snapshot: any) => {
    if (!snapshot?.data) return;
    const { profile: snapProfile, foodLogs: snapFoods, biomarkers: snapBiomarkers,
            biomarkerHistory: snapBioHistory, actions: snapActions,
            dailyBenefits: snapBenefits, report: snapReport } = snapshot.data;

    if (snapProfile) setProfile(snapProfile);
    if (snapFoods) setFoodLogs(snapFoods);
    if (snapBiomarkers) setBiomarkers(snapBiomarkers);
    if (snapBioHistory) setBiomarkerHistory(snapBioHistory);
    if (snapActions) setActions(snapActions);
    if (snapBenefits) setDailyBenefits(snapBenefits);
    if (snapReport) setReport(snapReport);

    const restoredBundle = {
      profile: snapProfile,
      foodLogs: snapFoods,
      biomarkers: snapBiomarkers,
      biomarkerHistory: snapBioHistory,
      actions: snapActions || [],
      dailyBenefits: snapBenefits || [],
      foodIdeas: foodIdeas,
      report: snapReport
    };
    safeSaveToLocalStorage(
      getStorageKey(snapProfile?.email || profile?.email),
      restoredBundle
    );

    setShowSnapshotPanel(false);
    alert(`✅ Restored to: "${snapshot.label}"\n\nYour data has been reverted to this point. Click the Sync button to upload if you wish.`);
  };

  // Daily Quota Tracking (resets at midnight PT)
  const [quota, setQuota] = useState<QuotaData>(() => {
    const saved = localStorage.getItem(QUOTA_STORAGE_KEY);
    const currentKey = getQuotaKey();
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.date === currentKey) return parsed;
      } catch (e) {}
    }
    return { date: currentKey, reads: 0, writes: 0, deletes: 0 };
  });
  useEffect(() => {
    localStorage.setItem(QUOTA_STORAGE_KEY, JSON.stringify(quota));
  }, [quota]);
  const updateQuota = (type: 'upload' | 'download' | 'delete' | 'sync', docCount: number = 1) => {
    if (type === 'sync' || docCount === 0) return;
    setQuota(prev => {
      const newQuota = { ...prev };
      const currentKey = getQuotaKey();
      if (currentKey !== newQuota.date) {
        newQuota.date = currentKey;
        newQuota.reads = 0;
        newQuota.writes = 0;
        newQuota.deletes = 0;
      }
      if (type === 'upload') newQuota.writes += docCount;
      if (type === 'download') newQuota.reads += docCount;
      if (type === 'delete') newQuota.deletes += docCount;
      return newQuota;
    });
  };
  const logInteraction = (type: 'upload' | 'download' | 'delete' | 'sync', path: string, data: any, docCount: number = 1) => {
    const sizeBytes = data ? (typeof data === 'string' ? data.length : JSON.stringify(data).length) : 0;
    const newOp: DbInteraction = {
      id: `db_op_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      timestamp: new Date().toLocaleTimeString(),
      type,
      path,
      sizeBytes,
      status: 'pending',
      startTimeMs: Date.now(),
      docCount
    };
    setDbInteractions(prev => [newOp, ...prev].slice(0, 100));
    return newOp.id;
  };
  const completeInteraction = (id: string, success: boolean, sizeBytes?: number, errorMsg?: string, finalDocCount?: number) => {
    setDbInteractions(prev => {
      const op = prev.find(item => item.id === id);
      if (op && success && op.status === 'pending') {
        const docsCount = finalDocCount !== undefined ? finalDocCount : (op.docCount || 1);
        setTimeout(() => updateQuota(op.type, docsCount), 0);
      }
      return prev.map(item => {
        if (item.id === id) {
          return {
            ...item,
            status: success ? 'completed' : 'failed',
            sizeBytes: sizeBytes !== undefined ? sizeBytes : item.sizeBytes,
            docCount: finalDocCount !== undefined ? finalDocCount : item.docCount,
            errorMessage: errorMsg
          };
        }
        return item;
      });
    });
  };
  const withTimeout = <T,>(promise: Promise<T> | T, timeoutMs: number, label: string): Promise<T | void> => {
    let timeoutId: any;
    return Promise.race([
      Promise.resolve(promise).then(res => {
        clearTimeout(timeoutId);
        return res;
      }).catch(err => {
        clearTimeout(timeoutId);
        throw err;
      }),
      new Promise<void>((resolve) => {
        timeoutId = setTimeout(() => {
          console.warn(`[Firestore Sync Timeout] ${label} took more than ${timeoutMs}ms. Continuing in background/offline cache.`);
          setSyncState('local');
          resolve();
        }, timeoutMs);
      })
    ]);
  };
  // Core logs and targets states
  const [foodLogs, setFoodLogs] = useState<FoodLog[]>([]);
  const [biomarkers, setBiomarkers] = useState<{ [key: string]: number | string }>({});
  const [biomarkerHistoryRaw, setBiomarkerHistoryRaw] = useState<BiomarkerLog[]>([]);
  const setBiomarkerHistory = (val: BiomarkerLog[] | ((prev: BiomarkerLog[]) => BiomarkerLog[])) => {
    if (typeof val === 'function') {
      setBiomarkerHistoryRaw(prev => normalizeBiomarkerHistory(val(prev)));
    } else {
      setBiomarkerHistoryRaw(normalizeBiomarkerHistory(val));
    }
  };
  const biomarkerHistory = biomarkerHistoryRaw;
  const [actions, setActions] = useState<HealthAction[]>([]);
  const [dailyBenefits, setDailyBenefits] = useState<DailyBenefit[]>([]);
  const [foodIdeas, setFoodIdeas] = useState<FoodIdea[]>([]);
  const [report, setReport] = useState<RecommendationReport | null>(null);
  const [draftReport, setDraftReport] = useState<RecommendationReport | null>(null);
  // Chat window visibility modals
  const [isFoodChatOpen, setIsFoodChatOpen] = useState(false);
  const [isManualFoodLogOpen, setIsManualFoodLogOpen] = useState(false);
  const [manualFoodLogError, setManualFoodLogError] = useState<string | null>(null);
  const [isMedicalChatOpen, setIsMedicalChatOpen] = useState(false);
  const [activeAgentType, setActiveAgentType] = useState<'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'agent6' | 'agent7' | 'data_review' | null>(null);
  const [activeDataReviewBatchIdx, setActiveDataReviewBatchIdx] = useState<number | string | null>(null);
  const [activeDataReviewBatchKeys, setActiveDataReviewBatchKeys] = useState<string[]>([]);
  const [calibratingBatchIdx, setCalibratingBatchIdx] = useState<number | null>(null);
  const [calibratingAgentType, setCalibratingAgentType] = useState<string | null>(null);
  const [batchSize, setBatchSize] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('biomarker_batch_size');
      return saved ? parseInt(saved, 10) || 20 : 20;
    } catch (e) {
      return 20;
    }
  });
  const [prefillMessage, setPrefillMessage] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isEditingFoodLog, setIsEditingFoodLog] = useState(false);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  // Sync state with HTML5 History API to support browser back button navigation without quitting
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (event.state) {
        const { tab, isFoodOpen, isMedicalOpen } = event.state;
        if (tab) setActiveTab(tab);
        setIsFoodChatOpen(!!isFoodOpen);
        setIsMedicalChatOpen(!!isMedicalOpen);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);
  useEffect(() => {
    try {
      localStorage.removeItem('custom_system_instruction_agent1');
    } catch (e) {}
  }, []);

  // Synchronize batch approvals from cloud profile back to local storage
  useEffect(() => {
    if (profile) {
      if (profile.approved_agent1_batches) {
        try {
          localStorage.setItem('approved_agent1_batches', JSON.stringify(profile.approved_agent1_batches));
        } catch (e) {}
      }
      if (profile.approved_data_review_batches) {
        try {
          localStorage.setItem('approved_data_review_batches', JSON.stringify(profile.approved_data_review_batches));
        } catch (e) {}
      }
    }
  }, [profile]);

  // Synchronize Google steps count to the actual daily biomarker logs when updated
  useEffect(() => {
    const handleGoogleStepsUpdated = async () => {
      const emailSuffix = profile?.email ? `_${profile.email.toLowerCase().trim()}` : '_guest';
      const stepsStr = localStorage.getItem(`googleSteps${emailSuffix}`);
      if (!stepsStr) return;
      const stepsVal = parseInt(stepsStr, 10);
      if (isNaN(stepsVal) || stepsVal <= 0) return;

      const todayStr = getCurrentDateInTimezone(profile?.timezone || 'UTC');

      // Check if we already logged this steps count for today
      const alreadyLogged = biomarkerHistory.some(log => log.date === todayStr && log.biomarkers['steps'] === stepsVal);
      if (alreadyLogged) return;

      let updatedHistory = [...biomarkerHistory];
      const todayLogIndex = updatedHistory.findIndex(log => log.date === todayStr);

      if (todayLogIndex >= 0) {
        const log = { ...updatedHistory[todayLogIndex] };
        log.biomarkers = {
          ...log.biomarkers,
          steps: stepsVal
        };
        if (!log.note || !log.note.includes('Google Fit')) {
          log.note = log.note ? `${log.note} | Auto-synced from Google Fit` : 'Auto-synced from Google Fit';
        }
        log.sync_state = 'update';
        log.updated_at = Date.now();
        updatedHistory[todayLogIndex] = log;
      } else {
        const newLog: BiomarkerLog = {
          id: `log_${Date.now()}`,
          date: todayStr,
          biomarkers: { steps: stepsVal },
          note: 'Auto-synced from Google Fit',
          summary: `Synced ${stepsVal} steps from Google Fit`,
          sync_state: 'new',
          updated_at: Date.now()
        };
        updatedHistory.unshift(newLog);
      }

      const recomputedBiomarkers: { [key: string]: number | string } = {};
      [...updatedHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });

      setBiomarkerHistory(updatedHistory);
      setBiomarkers(recomputedBiomarkers);
      if (profile) {
        await saveAndSync(profile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'googleSteps', isAutoLog: true });
      }
    };

    window.addEventListener('googleStepsUpdated', handleGoogleStepsUpdated);
    return () => window.removeEventListener('googleStepsUpdated', handleGoogleStepsUpdated);
  }, [profile, biomarkerHistory, foodLogs, actions, dailyBenefits, report]);
  useEffect(() => {
    const currentState = window.history.state;
    const isDifferent = !currentState ||
      currentState.tab !== activeTab ||
      currentState.isFoodOpen !== isFoodChatOpen ||
      currentState.isMedicalOpen !== isMedicalChatOpen;
    if (isDifferent) {
      window.history.pushState({
        tab: activeTab,
        isFoodOpen: isFoodChatOpen,
        isMedicalOpen: isMedicalChatOpen
      }, '');
    }
  }, [activeTab, isFoodChatOpen, isMedicalChatOpen]);
  // Initialize from Firebase Auth and Firestore on mount
  // Check of changes in profile and other info on the database (and pull latest changes)
  const checkForDbChanges = async (forceUserId?: string, forcePull?: boolean, forceReplaceLocal?: boolean) => {
    const uid = forceUserId || auth.currentUser?.uid;
    console.log("Checking DB changes for UID:", uid);
    if (!uid) {
      setSyncState('local');
      return;
    }
    // Load local storage first so we don't wipe it on page load
    const parsedLocal = await get(getStorageKey(auth.currentUser?.email)) || {};
    // Snapshot of current local state (from storage or memory) for safe merge
    const currentEmail = auth.currentUser?.email?.toLowerCase().trim() || 'guest';
    const profileEmail = profile?.email?.toLowerCase().trim();
    const isSameUser = profileEmail === currentEmail;

    let localProfile = isSameUser ? (profile || parsedLocal.profile) : parsedLocal.profile;
    let localFoods = isSameUser ? (foodLogs.length > 0 ? [...foodLogs] : (parsedLocal.foodLogs || [])) : (parsedLocal.foodLogs || []);
    let localBioHistory = isSameUser ? (biomarkerHistory.length > 0 ? [...biomarkerHistory] : (parsedLocal.biomarkerHistory || [])) : (parsedLocal.biomarkerHistory || []);
    let localActions = isSameUser ? (actions.length > 0 ? [...actions] : (parsedLocal.actions || [])) : (parsedLocal.actions || []);
    let localBenefits = isSameUser ? (dailyBenefits.length > 0 ? [...dailyBenefits] : (parsedLocal.dailyBenefits || [])) : (parsedLocal.dailyBenefits || []);
    let localReport = isSameUser ? (report || parsedLocal.report) : parsedLocal.report;

    if (forceReplaceLocal) {
      if (localProfile) localProfile.lastUpdatedAt = 0;
      localFoods = [];
      localBioHistory = [];
      localActions = [];
      localBenefits = [];
    }
    // Immediately populate state from local storage so the UI is responsive
    if (parsedLocal && (!profile || !isSameUser)) {
      if (parsedLocal.profile) setProfile(parsedLocal.profile);
      // We omit setFoodLogs here since foodLogs is natively managed by onSnapshot and localStorage stores it as empty []
      if (parsedLocal.biomarkers) setBiomarkers(parsedLocal.biomarkers);
      if (parsedLocal.biomarkerHistory) setBiomarkerHistory(parsedLocal.biomarkerHistory);
      if (parsedLocal.actions) setActions(parsedLocal.actions);
      if (parsedLocal.dailyBenefits) setDailyBenefits(parsedLocal.dailyBenefits);
      if (parsedLocal.report) setReport(parsedLocal.report);
    }
    const abortWithLocalFallback = () => {
      if (parsedLocal) {
        if (parsedLocal.foodLogs) setFoodLogs(parsedLocal.foodLogs);
        if (parsedLocal.profile) setProfile(parsedLocal.profile);
        if (parsedLocal.biomarkers) setBiomarkers(parsedLocal.biomarkers);
        if (parsedLocal.biomarkerHistory) setBiomarkerHistory(parsedLocal.biomarkerHistory);
        if (parsedLocal.actions) setActions(parsedLocal.actions);
        if (parsedLocal.dailyBenefits) setDailyBenefits(parsedLocal.dailyBenefits);
        if (parsedLocal.report) setReport(parsedLocal.report);
      }
      setSyncState('local');
    };

    if (isFirestoreQuotaExceeded || localStorage.getItem('firestore_quota_exceeded') === 'true') {
      abortWithLocalFallback();
      return;
    }
    setSyncState('syncing');
    const syncRootId = logInteraction('sync', `users/${uid} (Full Check${forceReplaceLocal ? ' - Force Pull' : ''})`, null);
    let tProfileId = '';
    let tFoodsId = '';
    let tBioId = '';
    let tActsId = '';
    let tBensId = '';
    let tRepId = '';
    let hasUnsynced = false;
    try {
      const userDocRef = doc(db, 'users', uid);
      let userDoc;
      tProfileId = logInteraction('download', `users/${uid} (Profile)`, null);
      try {
        const docResult = await withTimeout(getDocFromServer(userDocRef), 15000, 'getDocFromServer (Profile)');
        if (docResult) {
          userDoc = docResult;
        } else {
          throw new Error("getDocFromServer timed out");
        }
        completeInteraction(tProfileId, true, userDoc.exists() ? JSON.stringify(userDoc.data()).length : 0);
      } catch (err) {
        console.warn("getDocFromServer failed or timed out, falling back to local/cached getDoc:", err);
        handleFirestoreError(err);
        if (localStorage.getItem('firestore_quota_exceeded') === 'true') {
          abortWithLocalFallback();
          return;
        }
        const docResult = await withTimeout(getDoc(userDocRef), 15000, 'getDoc (Profile)').catch(gErr => {
          handleFirestoreError(gErr);
          return null;
        });
        if (localStorage.getItem('firestore_quota_exceeded') === 'true') {
          abortWithLocalFallback();
          return;
        }
        if (docResult) {
          userDoc = docResult;
        } else {
          userDoc = { exists: () => false, data: () => undefined } as any;
        }
        completeInteraction(tProfileId, true, userDoc.exists() ? JSON.stringify(userDoc.data()).length : 0);
      }
      if (userDoc.exists()) {
        const cloudProfile = userDoc.data() as UserProfile;
        
        const cloudTime = cloudProfile.lastUpdatedAt || 0;
        const localTime = localProfile?.lastUpdatedAt || 0;
        let mergedProfile: UserProfile;
        let foods: FoodLog[] = [];
        let bioHistory: BiomarkerLog[] = [];
        let acts: HealthAction[] = [];
        let bens: DailyBenefit[] = [];
        let cloudReport: RecommendationReport | null = null;
        let mergedFoods: FoodLog[] = [];
        let mergedBioHistory: BiomarkerLog[] = [];
        let mergedActions: HealthAction[] = [];
        let mergedBenefits: DailyBenefit[] = [];

        // Pre-compute deleted sets for robust merging
        const deletedFoods = new Set<string>([
          ...(cloudProfile?.deletedFoodLogIds || []),
          ...(localProfile?.deletedFoodLogIds || [])
        ]);
        const deletedBioLogs = new Set<string>([
          ...(cloudProfile?.deletedBiomarkerLogIds || []),
          ...(localProfile?.deletedBiomarkerLogIds || [])
        ]);
        const deletedCustomKeys = new Set<string>([
          ...(cloudProfile?.deletedCustomBiomarkerKeys || []),
          ...(localProfile?.deletedCustomBiomarkerKeys || [])
        ]);

        // Pre-compute merged custom biomarkers
        const mergedCustomBiomarkers = {
          ...(cloudProfile?.customBiomarkers || {}),
          ...(localProfile?.customBiomarkers || {})
        };
        deletedCustomKeys.forEach(k => {
          delete mergedCustomBiomarkers[k];
        });

        // Optimization: if local data is in exact sync with cloud, we skip fetching subcollections
        // However, if the user explicitly clicks "Sync" (forcePull is true), we MUST perform a full bidirectional merge.
        const canSkipFetch = !forcePull && !forceReplaceLocal && !!(
          localProfile &&
          localProfile.lastUpdatedAt &&
          cloudProfile.lastUpdatedAt &&
          localProfile.lastUpdatedAt === cloudProfile.lastUpdatedAt &&
          parsedLocal.foodLogs &&
          parsedLocal.biomarkerHistory
        );
        hasUnsynced = false;

        const sanitizeAndCleanLogs = (logsList: BiomarkerLog[]): BiomarkerLog[] => {
          return logsList.map(log => {
            if (!log.biomarkers) return log;
            const cleanedBiomarkers = { ...log.biomarkers };
            let logChanged = false;
            Object.keys(cleanedBiomarkers).forEach(k => {
              const val = cleanedBiomarkers[k];
              const isDeleted = deletedCustomKeys.has(k);
              const isEmpty = val === undefined || val === null || val === '' || Number.isNaN(val) || (typeof val === 'string' && val.trim() === '');
              if (isDeleted || isEmpty) {
                delete cleanedBiomarkers[k];
                logChanged = true;
              }
            });
            if (logChanged) {
              if (Object.keys(cleanedBiomarkers).length === 0 && !log.note) {
                deletedBioLogs.add(log.id);
              }
              return { ...log, biomarkers: cleanedBiomarkers };
            }
            return log;
          });
        };

        if (canSkipFetch) {
          console.log("[Sync] Local data is fully up-to-date or newer. Skipping subcollection downloads.");
          mergedProfile = {
            ...(localTime >= cloudTime ? cloudProfile : localProfile),
            ...(localTime >= cloudTime ? localProfile : cloudProfile),
            customBiomarkers: mergedCustomBiomarkers,
            deletedFoodLogIds: Array.from(deletedFoods),
            deletedBiomarkerLogIds: Array.from(deletedBioLogs),
            deletedCustomBiomarkerKeys: Array.from(deletedCustomKeys),
          } as UserProfile;

          if (localProfile?.agentAnalyses) {
            mergedProfile.agentAnalyses = localProfile.agentAnalyses;
          }
          foods = localFoods;
          const sanitizedLocal = sanitizeAndCleanLogs(localBioHistory).filter(b => !deletedBioLogs.has(b.id));
          bioHistory = sanitizedLocal;
          acts = localActions;
          bens = localBenefits;
          cloudReport = localReport;
          mergedFoods = localFoods;
          mergedBioHistory = sanitizedLocal;
          mergedActions = localActions;
          mergedBenefits = localBenefits;
          hasUnsynced = localTime > cloudTime;
        } else {
          if (forcePull) {
            console.log("[Sync] Force pull (Manual Sync) active. Pushing local unsynced logs first.");
            await syncLogsWithTimeBuckets(db, uid, localFoods, localBioHistory, (sf, sb) => {
              localFoods = sf;
              localBioHistory = sb;
            });
          }
          tFoodsId = logInteraction('download', `users/${uid}/foodLogs`, null);
          tBioId = logInteraction('download', `users/${uid}/biomarkerHistory`, null);
          tActsId = logInteraction('download', `users/${uid}/actions`, null);
          tBensId = logInteraction('download', `users/${uid}/dailyBenefits`, null);
          tRepId = logInteraction('download', `users/${uid}/reports/latest`, null);
          // Migrate to Time-Bucketing sync architecture
          let v2Foods: FoodLog[] = [];
          let v2Logs: BiomarkerLog[] = [];
          // By using getDocs and getDoc (not FromServer), Firestore can utilize its local cache if configured,
          // and won't throw if offline, gracefully degrading to cached data.
          try {
            if (localStorage.getItem('firestore_quota_exceeded') === 'true') {
              abortWithLocalFallback();
              return;
            }
            try {
              const { serverFoods, serverBiomarkers } = await fetchAllConsolidatedLogs(db, uid);
              v2Foods = serverFoods;
              v2Logs = serverBiomarkers;
              
              // We must still load images
              if (v2Foods.length > 0) {
                const imagesSnap = await getDocs(collection(db, 'users', uid, 'foodImages'));
                const shouldCompress = !hasRunImageCompression.current;
                if (shouldCompress) hasRunImageCompression.current = true;
                const imageMap: Record<string, any> = {};
                const updatesToPush: { id: string; imageUrl?: string; imageUrls?: string[] }[] = [];

                for (const d of imagesSnap.docs) {
                  const data = d.data();
                  let imageUrl = data.imageUrl;
                  let imageUrls = data.imageUrls || [];
                  let needsUpdate = false;

                  if (shouldCompress && imageUrl && imageUrl.startsWith('data:image/') && imageUrl.length > 25000) {
                    try {
                      imageUrl = await compressImage(imageUrl, 400, 400, 0.5);
                      needsUpdate = true;
                    } catch (e) {
                      console.warn("Auto-recompression failed for imageUrl:", d.id, e);
                    }
                  }

                  if (imageUrls && imageUrls.length > 0) {
                    const newUrls = [];
                    for (const url of imageUrls) {
                      if (shouldCompress && url && url.startsWith('data:image/') && url.length > 25000) {
                        try {
                          const compressed = await compressImage(url, 400, 400, 0.5);
                          newUrls.push(compressed);
                          needsUpdate = true;
                        } catch (e) {
                          newUrls.push(url);
                          console.warn("Auto-recompression failed for imageUrl inside list:", d.id, e);
                        }
                      } else {
                        newUrls.push(url);
                      }
                    }
                    imageUrls = newUrls;
                  }

                  if (needsUpdate) {
                    updatesToPush.push({ id: d.id, imageUrl, imageUrls });
                  }

                  imageMap[d.id] = { imageUrl, imageUrls };
                }

                if (updatesToPush.length > 0) {
                  console.log(`[Auto-Recompress] Re-compressed ${updatesToPush.length} legacy large images on-the-fly. Syncing back to database...`);
                  updatesToPush.forEach(up => {
                    setDoc(doc(db, 'users', uid, 'foodImages', up.id), sanitizeForFirestore({
                      imageUrl: up.imageUrl || null,
                      imageUrls: up.imageUrls || []
                    })).catch(err => console.error("Auto-sync back error:", err));
                  });
                }

                v2Foods = v2Foods.map(f => ({ ...f, ...imageMap[f.id] }));
              }
            } catch (err) {
              console.error("Failed to fetch consolidated logs", err);
            }
            
            if (v2Foods.length === 0) {
              console.log("Fetching foodLogs...");
              const foodLogsSnap = await withTimeout(getDocs(collection(db, 'users', uid, 'foodLogs')), 15000, 'getDocs (foodLogs)');
              if (foodLogsSnap) {
                const subcolFoods = foodLogsSnap.docs.map(d => d.data() as FoodLog);
                const mergedMap = new Map<string, FoodLog>();
                v2Foods.forEach(f => mergedMap.set(f.id, f));
                subcolFoods.forEach(f => {
                  const existing = mergedMap.get(f.id);
                  if (existing) {
                    const existingTime = existing.updated_at || 0;
                    const legacyTime = f.updated_at || 0;
                    if (legacyTime >= existingTime) {
                      mergedMap.set(f.id, { ...existing, ...f });
                    }
                  } else {
                    mergedMap.set(f.id, f);
                  }
                });
                foods = Array.from(mergedMap.values());
                completeInteraction(tFoodsId, true, foodLogsSnap.docs.reduce((acc, d) => acc + JSON.stringify(d.data()).length, 0), undefined, foodLogsSnap.size);
              } else if (v2Foods.length === 0) {
                throw new Error("getDocs (foodLogs) timed out");
              } else {
                foods = v2Foods;
                completeInteraction(tFoodsId, true, 0, undefined, 0);
              }
            } else {
              foods = v2Foods;
              completeInteraction(tFoodsId, true, 0, undefined, 0);
            }
          } catch (foodErr: any) {
            console.warn("Failed to fetch foodLogs:", foodErr);
            handleFirestoreError(foodErr);
            if (localStorage.getItem('firestore_quota_exceeded') === 'true') {
              abortWithLocalFallback();
              return;
            }
            try {
              const cacheSnap = await getDocs(collection(db, 'users', uid, 'foodLogs'));
              foods = cacheSnap.docs.map(d => d.data() as FoodLog);
            } catch (e) {
              foods = localFoods; // Fallback to local
            }
            completeInteraction(tFoodsId, false, 0, foodErr.message || String(foodErr));
          }
          // 1. Fetch biomarker history robustly
          try {
            if (localStorage.getItem('firestore_quota_exceeded') === 'true') {
              abortWithLocalFallback();
              return;
            }
            // v2Logs is already populated from fetchAllConsolidatedLogs
            
            // If v2Logs is empty, fetch the subcollection to ensure we don't miss anything
            if (v2Logs.length === 0) {
              const bioHistorySnap = await withTimeout(getDocs(collection(db, 'users', uid, 'biomarkerHistory')), 15000, 'getDocs (biomarkerHistory)');
              if (bioHistorySnap) {
                const subcolLogs = bioHistorySnap.docs.map(d => d.data() as BiomarkerLog);
                
                // Merge v2Logs and subcolLogs
                const mergedMap = new Map<string, BiomarkerLog>();
                v2Logs.forEach(l => mergedMap.set(l.id, l));
                subcolLogs.forEach(l => {
                  const existing = mergedMap.get(l.id);
                  if (existing) {
                    const existingTime = existing.updated_at || 0;
                    const legacyTime = l.updated_at || 0;
                    if (legacyTime >= existingTime) {
                      mergedMap.set(l.id, { ...existing, ...l, biomarkers: { ...existing.biomarkers, ...l.biomarkers } });
                    }
                  } else {
                    mergedMap.set(l.id, l);
                  }
                });
                bioHistory = Array.from(mergedMap.values());
                
                completeInteraction(tBioId, true, bioHistorySnap.docs.reduce((acc, d) => acc + JSON.stringify(d.data()).length, 0), undefined, bioHistorySnap.size);
              } else if (v2Logs.length === 0) {
                throw new Error("getDocs (biomarkerHistory) timed out");
              } else {
                bioHistory = v2Logs;
                completeInteraction(tBioId, true, 0, undefined, 0);
              }
            } else {
              bioHistory = v2Logs;
              completeInteraction(tBioId, true, 0, undefined, 0);
            }
          } catch (bioErr: any) {
            console.warn("Failed to fetch biomarkerHistory:", bioErr);
            handleFirestoreError(bioErr);
            if (localStorage.getItem('firestore_quota_exceeded') === 'true') {
              abortWithLocalFallback();
              return;
            }
            try {
              const cacheSnap = await getDocs(collection(db, 'users', uid, 'biomarkerHistory'));
              bioHistory = cacheSnap.docs.map(d => d.data() as BiomarkerLog);
            } catch (e) {
              bioHistory = localBioHistory; // Fallback to local
            }
            completeInteraction(tBioId, false, 0, bioErr.message || String(bioErr));
          }
          // 2. Fetch dashboard metadata robustly
          try {
            if (localStorage.getItem('firestore_quota_exceeded') === 'true') {
              abortWithLocalFallback();
              return;
            }
            const dashboardDoc = await getDoc(doc(db, 'users', uid, 'metadata', 'dashboard'));
            if (dashboardDoc.exists()) {
              const data = dashboardDoc.data();
              acts = (data.actions || []) as HealthAction[];
              bens = (data.dailyBenefits || []) as DailyBenefit[];
              setFoodIdeas((data.foodIdeas || []) as FoodIdea[]);
            } else {
              acts = localActions;
              bens = localBenefits;
            }
            completeInteraction(tActsId, true, JSON.stringify(acts).length);
            completeInteraction(tBensId, true, JSON.stringify(bens).length);
          } catch (dashErr: any) {
            console.warn("Failed to fetch dashboard metadata:", dashErr);
            handleFirestoreError(dashErr);
            if (localStorage.getItem('firestore_quota_exceeded') === 'true') {
              abortWithLocalFallback();
              return;
            }
            acts = localActions;
            bens = localBenefits;
            completeInteraction(tActsId, false, 0, dashErr.message || String(dashErr));
            completeInteraction(tBensId, false, 0, dashErr.message || String(dashErr));
          }
          // 3. Fetch reports robustly
          try {
            if (localStorage.getItem('firestore_quota_exceeded') === 'true') {
              abortWithLocalFallback();
              return;
            }
            const latestReportDoc = await getDoc(doc(db, 'users', uid, 'reports', 'latest'));
            cloudReport = latestReportDoc.exists() ? (latestReportDoc.data() as RecommendationReport) : null;
            completeInteraction(tRepId, true, latestReportDoc.exists() ? JSON.stringify(latestReportDoc.data()).length : 0);
          } catch (repErr: any) {
            console.warn("Failed to fetch reports:", repErr);
            handleFirestoreError(repErr);
            if (localStorage.getItem('firestore_quota_exceeded') === 'true') {
              abortWithLocalFallback();
              return;
            }
            cloudReport = localReport;
            completeInteraction(tRepId, false, 0, repErr.message || String(repErr));
          }
          // 4. Fetch agentAnalyses
          try {
            if (localStorage.getItem('firestore_quota_exceeded') === 'true') {
              abortWithLocalFallback();
              return;
            }
            const analysesSnap = await getDocs(collection(db, 'users', uid, 'agentAnalyses'));
            const analyses = analysesSnap.docs.map(d => d.data());
            if (analyses.length > 0) {
              cloudProfile.agentAnalyses = analyses as any;
            } else if (localProfile?.agentAnalyses) {
              cloudProfile.agentAnalyses = localProfile.agentAnalyses;
            }
          } catch (err) {
            console.warn("Failed to fetch agentAnalyses:", err);
            handleFirestoreError(err);
            if (localStorage.getItem('firestore_quota_exceeded') === 'true') {
              abortWithLocalFallback();
              return;
            }
            if (localProfile?.agentAnalyses) {
              cloudProfile.agentAnalyses = localProfile.agentAnalyses;
            }
          }

          // Sanitize both cloud and local histories
          const sanitizedBioHistory = sanitizeAndCleanLogs(bioHistory);
          const sanitizedLocalBioHistory = sanitizeAndCleanLogs(localBioHistory);

          // Filter out deleted items from cloud and local lists
          const filteredFoods = foods.filter(f => !deletedFoods.has(f.id));
          const filteredLocalFoods = localFoods.filter(f => !deletedFoods.has(f.id));

          const filteredBioHistory = sanitizedBioHistory.filter(b => !deletedBioLogs.has(b.id));
          const filteredLocalBioHistory = sanitizedLocalBioHistory.filter(b => !deletedBioLogs.has(b.id));

          // Conflict Detection
          const lastSyncedAt = parsedLocal.lastSyncedAt || 0;

          const hasNewLocalFoods = filteredLocalFoods.some(lf => !filteredFoods.some(cf => cf.id === lf.id));
          const hasNewLocalBioHistory = filteredLocalBioHistory.some(lh => !filteredBioHistory.some(ch => ch.id === lh.id));
          const hasNewLocalActions = localActions.some(la => !acts.some(ca => ca.id === la.id));
          const hasNewLocalBenefits = localBenefits.some(lb => !bens.some(cb => cb.id === lb.id));

          const hasModifiedLocalFoods = filteredLocalFoods.some(lf => {
            const cf = filteredFoods.find(c => c.id === lf.id);
            return cf && JSON.stringify(lf) !== JSON.stringify(cf);
          });
          const hasModifiedLocalBioHistory = filteredLocalBioHistory.some(lh => {
            const ch = filteredBioHistory.find(c => c.id === lh.id);
            return ch && JSON.stringify(lh) !== JSON.stringify(ch);
          });

          const localProfileHasEdits = !!(localProfile?.lastUpdatedAt && (!lastSyncedAt || localProfile.lastUpdatedAt > lastSyncedAt + 2000));
          const localHasEdits = localProfileHasEdits || hasNewLocalFoods || hasNewLocalBioHistory || hasNewLocalActions || hasNewLocalBenefits || hasModifiedLocalFoods || hasModifiedLocalBioHistory;

          const hasNewCloudFoods = filteredFoods.some(cf => !filteredLocalFoods.some(lf => lf.id === cf.id));
          const hasNewCloudBioHistory = filteredBioHistory.some(ch => !filteredLocalBioHistory.some(lh => lh.id === ch.id));
          const hasNewCloudActions = acts.some(ca => !localActions.some(la => la.id === ca.id));
          const hasNewCloudBenefits = bens.some(cb => !localBenefits.some(lb => lb.id === cb.id));

          const hasModifiedCloudFoods = filteredFoods.some(cf => {
            const lf = filteredLocalFoods.find(l => l.id === cf.id);
            return lf && JSON.stringify(cf) !== JSON.stringify(lf);
          });
          const hasModifiedCloudBioHistory = filteredBioHistory.some(ch => {
            const lh = filteredLocalBioHistory.find(l => l.id === ch.id);
            return lh && JSON.stringify(ch) !== JSON.stringify(lh);
          });

          const cloudProfileHasEdits = !!(cloudProfile?.lastUpdatedAt && (!lastSyncedAt || cloudProfile.lastUpdatedAt > lastSyncedAt + 2000));
          const cloudHasEdits = cloudProfileHasEdits || hasNewCloudFoods || hasNewCloudBioHistory || hasNewCloudActions || hasNewCloudBenefits || hasModifiedCloudFoods || hasModifiedCloudBioHistory;

          const hasDifferentFoods = localFoods.length !== foods.length || !localFoods.every(lf => foods.some(cf => cf.id === lf.id));
          const hasDifferentBioHistory = localBioHistory.length !== bioHistory.length || !localBioHistory.every(lh => bioHistory.some(ch => ch.id === lh.id));
          const hasDifferentActions = localActions.length !== acts.length || !localActions.every(la => acts.some(ca => ca.id === la.id));
          const hasDifferentBenefits = localBenefits.length !== bens.length || !localBenefits.every(lb => bens.some(cb => cb.id === lb.id));

          // Show the conflict panel if BOTH cloud and local have independent edits that might conflict
          // AND there's an actual difference in the data lengths.
          // Otherwise, we rely on the bidirectional merge below.
          const isConflict = false; // localHasEdits && cloudHasEdits && (hasDifferentFoods || hasDifferentBioHistory || hasDifferentActions || hasDifferentBenefits);

          if (isConflict) {
            console.log("[Sync] Sync conflict detected. Pausing automatic sync to let user choose.");
            setConflictData({
              localProfile: localProfile || { email: currentEmail } as UserProfile,
              cloudProfile,
              localFoods,
              cloudFoods: foods,
              localBioHistory,
              cloudBioHistory: bioHistory,
              localActions,
              cloudActions: acts,
              localBenefits,
              cloudBenefits: bens,
              cloudReport,
              localReport
            });
            setSyncState('conflict');
            completeInteraction(syncRootId, true, 0);
            return;
          }

          // Merge logic
          if (!localHasEdits) {
            console.log("[Sync] Local device has no new edits since last sync. Taking cloud data as truth.");
            mergedProfile = {
              ...cloudProfile,
              customBiomarkers: mergedCustomBiomarkers,
              deletedFoodLogIds: Array.from(deletedFoods),
              deletedBiomarkerLogIds: Array.from(deletedBioLogs),
              deletedCustomBiomarkerKeys: Array.from(deletedCustomKeys)
            } as UserProfile;
            
            // Union merge: start from server, add any local item not on server and not deleted
            // (do NOT just use filteredFoods — that drops local items the server doesn't have yet)
            const foodUnionMap = new Map(filteredFoods.map(f => [f.id, f]));
            filteredLocalFoods.forEach(localItem => {
              if (!foodUnionMap.has(localItem.id)) {
                foodUnionMap.set(localItem.id, localItem);
              }
            });
            mergedFoods = Array.from(foodUnionMap.values());

            const bioUnionMap = new Map(filteredBioHistory.map(b => [b.id, b]));
            filteredLocalBioHistory.forEach(localItem => {
              if (!bioUnionMap.has(localItem.id)) {
                bioUnionMap.set(localItem.id, localItem);
              }
            });
            mergedBioHistory = Array.from(bioUnionMap.values());

            mergedActions = [...acts];
            mergedBenefits = [...bens];
            
          } else {
            console.log("[Sync] Local device has edits. Merging bidirectionally.");
            const isLocalProfileNewer = localTime >= cloudTime;
            if (isLocalProfileNewer) {
              mergedProfile = {
                ...cloudProfile,
                ...localProfile,
                customBiomarkers: mergedCustomBiomarkers,
                deletedFoodLogIds: Array.from(deletedFoods),
                deletedBiomarkerLogIds: Array.from(deletedBioLogs),
                deletedCustomBiomarkerKeys: Array.from(deletedCustomKeys)
              } as UserProfile;
            } else {
              mergedProfile = {
                ...localProfile,
                ...cloudProfile,
                customBiomarkers: mergedCustomBiomarkers,
                deletedFoodLogIds: Array.from(deletedFoods),
                deletedBiomarkerLogIds: Array.from(deletedBioLogs),
                deletedCustomBiomarkerKeys: Array.from(deletedCustomKeys)
              } as UserProfile;
            }

            // Bidirectional merge for food logs: server is the source of truth for synced items,
            // local unsynced items are preserved and will be pushed in the next step.
            const localUnsyncedFoods = filteredLocalFoods.filter(f => f.sync_state && f.sync_state !== 'synced');
            // Start from all server items (covers items added on other devices)
            mergedFoods = [...filteredFoods];
            // Add or update with local unsynced items (not yet pushed to server)
            localUnsyncedFoods.forEach(localItem => {
              const existingIdx = mergedFoods.findIndex(m => m.id === localItem.id);
              if (existingIdx >= 0) {
                // Keep whichever is newer
                if ((localItem.updated_at || 0) >= (mergedFoods[existingIdx].updated_at || 0)) {
                  mergedFoods[existingIdx] = {
                    ...mergedFoods[existingIdx],
                    ...localItem,
                    imageUrl: localItem.imageUrl || mergedFoods[existingIdx].imageUrl,
                    imageUrls: (localItem.imageUrls && localItem.imageUrls.length > 0) ? localItem.imageUrls : mergedFoods[existingIdx].imageUrls,
                  };
                }
              } else {
                // Local item not on server yet — keep it
                mergedFoods.push(localItem);
              }
            });

            // Fallback safety net: preserve local synced items if they are missing from server (and not deleted)
            filteredLocalFoods.forEach(localItem => {
              const onServer = mergedFoods.some(m => m.id === localItem.id);
              if (!onServer) {
                console.log(`[Sync] Preserving local food log ${localItem.id} not found on server to prevent loss.`);
                mergedFoods.push(localItem);
              }
            });

            // Bidirectional merge for biomarker history: server is the source of truth for synced items,
            // local unsynced items are preserved and will be pushed in the next step.
            const localUnsyncedBioHistory = filteredLocalBioHistory.filter(b => b.sync_state && b.sync_state !== 'synced');
            // Start from all server items (covers items added on other devices)
            mergedBioHistory = [...filteredBioHistory];
            // Add or update with local unsynced items (not yet pushed to server)
            localUnsyncedBioHistory.forEach(localItem => {
              const existingIdx = mergedBioHistory.findIndex(m => m.id === localItem.id);
              if (existingIdx >= 0) {
                // Keep whichever is newer
                if ((localItem.updated_at || 0) >= (mergedBioHistory[existingIdx].updated_at || 0)) {
                  mergedBioHistory[existingIdx] = {
                    ...mergedBioHistory[existingIdx],
                    ...localItem,
                    biomarkers: { ...mergedBioHistory[existingIdx].biomarkers, ...localItem.biomarkers }
                  };
                }
              } else {
                // Local item not on server yet — keep it
                mergedBioHistory.push(localItem);
              }
            });

            // Fallback safety net: preserve local synced items if they are missing from server (and not deleted)
            filteredLocalBioHistory.forEach(localItem => {
              const onServer = mergedBioHistory.some(m => m.id === localItem.id);
              if (!onServer) {
                console.log(`[Sync] Preserving local biomarker log ${localItem.id} not found on server to prevent loss.`);
                mergedBioHistory.push(localItem);
              }
            });

            mergedActions = [...acts];
            localActions.forEach(localAct => {
              const existingCloudIndex = mergedActions.findIndex(a => a.id === localAct.id);
              if (existingCloudIndex === -1) {
                mergedActions.push(localAct);
              } else {
                if (localTime >= cloudTime) {
                  mergedActions[existingCloudIndex] = { ...mergedActions[existingCloudIndex], ...localAct };
                }
              }
            });

            mergedBenefits = [...bens];
            localBenefits.forEach(localBen => {
              const existingCloudIndex = mergedBenefits.findIndex(b => b.id === localBen.id);
              if (existingCloudIndex === -1) {
                mergedBenefits.push(localBen);
              } else {
                if (localTime >= cloudTime) {
                  mergedBenefits[existingCloudIndex] = { ...mergedBenefits[existingCloudIndex], ...localBen };
                }
              }
            });
          }

          // Determine if we need to write changes back to the cloud by deep-comparing merged vs cloud records
          const hasLocalAdditions = 
            mergedFoods.some(f => {
              const cf = filteredFoods.find(c => c.id === f.id);
              return !cf || !isDeepEqual(cleanData(f), cleanData(cf));
            }) ||
            mergedBioHistory.some(b => {
              const cb = filteredBioHistory.find(c => c.id === b.id);
              return !cb || !isDeepEqual(cleanData(b), cleanData(cb));
            }) ||
            mergedActions.some(a => !acts.some(ca => ca.id === a.id)) ||
            mergedBenefits.some(b => !bens.some(cb => cb.id === b.id));

          hasUnsynced = hasLocalAdditions || localTime > cloudTime;
        }
        
        // Save merged profile to Firestore (profile doc only, not food logs)
        if (forcePull && hasUnsynced) {
          const tempBiomarkers: { [key: string]: number | string } = {};
          [...mergedBioHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
            Object.entries(log.biomarkers).forEach(([k, v]) => {
              tempBiomarkers[k] = v as string | number;
            });
          });
          await saveAndSync(mergedProfile, mergedFoods, tempBiomarkers, mergedBioHistory, mergedActions, mergedBenefits, cloudReport || localReport, { type: 'profile' });
        }

        setProfile(mergedProfile);
        setFoodLogs(mergedFoods);
        setBiomarkerHistory(mergedBioHistory);
        setActions(mergedActions);
        setDailyBenefits(mergedBenefits);
        setReport(cloudReport);
        // Recompute active biomarkers (sorted ascending so that newer logs overwrite older values)
        const computedBiomarkers: { [key: string]: number | string } = {};
        [...mergedBioHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
          Object.entries(log.biomarkers).forEach(([k, v]) => {
            computedBiomarkers[k] = v as string | number;
          });
        });
        setBiomarkers(computedBiomarkers);
        // Write bundle back to local storage
        const bundle = {
          profile: mergedProfile,
          foodLogs: mergedFoods,
          biomarkers: computedBiomarkers,
          biomarkerHistory: mergedBioHistory,
          actions: mergedActions,
          dailyBenefits: mergedBenefits,
          report: cloudReport,
          lastSyncedAt: Date.now()
        };
        safeSaveToLocalStorage(getStorageKey(mergedProfile?.email || profile?.email || auth.currentUser?.email), bundle);
        // Add a small delay for delightful visual feedback
        await new Promise(resolve => setTimeout(resolve, 800));
        setSyncState((hasUnsynced && !forcePull) ? 'local' : 'synced');
        completeInteraction(syncRootId, true, 0);
      } else if (localProfile && Object.keys(localProfile).length > 0) {
        // Cloud doc is empty, but we have local data! Cloud save probably failed earlier.
        // Let's assume local is the source of truth and restore it.
        setProfile(localProfile);
        setFoodLogs(localFoods);
        setBiomarkerHistory(localBioHistory);
        setActions(localActions);
        setDailyBenefits(localBenefits);
        setReport(localReport);
        
        // Recompute active biomarkers (sorted ascending so that newer logs overwrite older values)
        const computedBiomarkers: { [key: string]: number | string } = {};
        [...localBioHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach((log: BiomarkerLog) => {
          Object.entries(log.biomarkers).forEach(([k, v]) => {
            computedBiomarkers[k] = v as string | number;
          });
        });
        setBiomarkers(computedBiomarkers);
        const bundle = {
          profile: localProfile,
          foodLogs: localFoods,
          biomarkers: computedBiomarkers,
          biomarkerHistory: localBioHistory,
          actions: localActions,
          dailyBenefits: localBenefits,
          report: localReport
        };
        safeSaveToLocalStorage(getStorageKey(localProfile?.email || profile?.email || auth.currentUser?.email), bundle);
        // Try syncing profile to cloud in background
        const tNewProfileId = logInteraction('upload', `users/${uid} (Restore Profile)`, localProfile);
        const localProfileForCloud = { ...localProfile };
        delete localProfileForCloud.agentAnalyses;
        setDoc(userDocRef, cleanData(localProfileForCloud), { merge: true })
          .then(() => completeInteraction(tNewProfileId, true, JSON.stringify(localProfile).length))
          .catch(err => { completeInteraction(tNewProfileId, false, 0, err.message); console.error(err); });
        await new Promise(resolve => setTimeout(resolve, 800));
        setSyncState('synced');
        completeInteraction(syncRootId, true, 0);
      } else {
        // Brand new sign up - create profile in Firestore
        const isDemoUser = auth.currentUser?.email?.toLowerCase() === 'john@mail.com';
        
        const newProfile: UserProfile = {
          nickname: isDemoUser ? 'John Doe' : '',
          photoUrl: auth.currentUser?.photoURL || (isDemoUser ? 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120' : ''),
          email: auth.currentUser?.email || '',
          age: isDemoUser ? 35 : '' as any,
          ethnicity: isDemoUser ? 'Caucasian' : 'Unknown',
          weight: isDemoUser ? 75 : '' as any,
          height: isDemoUser ? 178 : '' as any,
          gender: isDemoUser ? 'Male' : 'Unknown',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          language: 'en'
        };
        const tNewProfileId = logInteraction('upload', `users/${uid} (Create Profile)`, newProfile);
        setDoc(userDocRef, cleanData(newProfile), { merge: true })
          .then(() => completeInteraction(tNewProfileId, true, JSON.stringify(newProfile).length))
          .catch(err => { completeInteraction(tNewProfileId, false, 0, err.message); console.error(err); });
        
        setProfile(newProfile);
        let initialActions: HealthAction[] = [];
        let initialBenefits: DailyBenefit[] = [];
        if (isDemoUser) {
          initialActions = [
            {
              id: 'init_act_1',
              task: 'Schedule primary physician physical consultation',
              explanation: 'Consult your doctor before initiating heavy nutrient restrictions or supplement additions.',
              priority: 'high',
              completed: false,
              type: 'doctor'
            },
            {
              id: 'init_act_2',
              task: 'Complete basic fasting blood panel tests',
              explanation: 'Obtain ApoB, LDL-C, fasting glucose, and HbA1c values for precise target generation.',
              priority: 'high',
              completed: false,
              type: 'test'
            }
          ];
          initialBenefits = [
            { id: 'init_ben_1', activity: 'Walk briskly for 30 minutes', target: 'Daily', completed: false },
            { id: 'init_ben_2', activity: 'Add high-fiber foods to your breakfast', target: 'Daily', completed: false }
          ];
          // Write to Firestore dashboard document to prevent multiple writes
          const tDashId = logInteraction('upload', `users/${uid}/metadata/dashboard`, null);
          setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), {
            actions: initialActions.map(cleanData),
            dailyBenefits: initialBenefits.map(cleanData)
          }, { merge: true })
            .then(() => completeInteraction(tDashId, true, JSON.stringify({ actions: initialActions, dailyBenefits: initialBenefits }).length))
            .catch(err => { completeInteraction(tDashId, false, 0, err.message); console.error(err); });
        }
        setFoodLogs([]);
        setBiomarkers({});
        setBiomarkerHistory([]);
        setActions(initialActions);
        setDailyBenefits(initialBenefits);
        setReport(null);
        // Local storage cache
        const bundle = {
          profile: newProfile,
          foodLogs: [],
          biomarkers: {},
          biomarkerHistory: [],
          actions: initialActions,
          dailyBenefits: initialBenefits,
          report: null
        };
        safeSaveToLocalStorage(getStorageKey(newProfile?.email || profile?.email || auth.currentUser?.email), bundle);
        // Add a small delay for delightful visual feedback
        await new Promise(resolve => setTimeout(resolve, 800));
        setSyncState('synced');
        completeInteraction(syncRootId, true, 0);
        setActiveTab('medical');
      }
    } catch (err: any) {
      console.error("Error checking or syncing database changes:", err);
      handleFirestoreError(err);
      setSyncState('local');
      completeInteraction(syncRootId, false, 0, err.message || 'Database error');
      if (tProfileId) completeInteraction(tProfileId, false, 0, err.message);
      if (tFoodsId) completeInteraction(tFoodsId, false, 0, err.message);
      if (tBioId) completeInteraction(tBioId, false, 0, err.message);
      if (tActsId) completeInteraction(tActsId, false, 0, err.message);
      if (tBensId) completeInteraction(tBensId, false, 0, err.message);
      if (tRepId) completeInteraction(tRepId, false, 0, err.message);
      
      // Fallback to local storage if DB fails
      if (parsedLocal) {
        if (parsedLocal.profile) setProfile(parsedLocal.profile);
        if (parsedLocal.foodLogs) setFoodLogs(parsedLocal.foodLogs);
        if (parsedLocal.biomarkers) setBiomarkers(parsedLocal.biomarkers);
        if (parsedLocal.biomarkerHistory) setBiomarkerHistory(parsedLocal.biomarkerHistory);
        if (parsedLocal.actions) setActions(parsedLocal.actions);
        if (parsedLocal.dailyBenefits) setDailyBenefits(parsedLocal.dailyBenefits);
        if (parsedLocal.report) setReport(parsedLocal.report);
      }
    }
  };
  // Initialize from Firebase Auth and Firestore on mount
  useEffect(() => {
    let unsubs: (() => void)[] = [];
    
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user && user.email) { runCleanupMigration(user.email).catch(console.error); }
      unsubs.forEach(u => u());
      unsubs = [];
      
      try {
        // Immediately reset and blank out current user's React states
        // to prevent any "glimpse" of previous account data during transition.
        setProfile(null);
        setFoodLogs([]);
        setBiomarkers({});
        setBiomarkerHistory([]);
        setActions([]);
        setDailyBenefits([]);
        setReport(null);

        if (user) {
          const newEmail = user.email?.toLowerCase().trim() || '';
          const storageKey = getStorageKey(newEmail);
          
          const parsedLocal = await get(storageKey);
          
          let loadedProfile: UserProfile | null = null;
          let loadedFoods: FoodLog[] = [];
          let loadedBiomarkers = {};
          let loadedHistory: BiomarkerLog[] = [];
          let loadedActions: HealthAction[] = [];
          let loadedBenefits: DailyBenefit[] = [];
          let loadedReport: RecommendationReport | null = null;

          if (parsedLocal) {
            loadedProfile = parsedLocal.profile || null;
            loadedFoods = parsedLocal.foodLogs || [];
            loadedBiomarkers = parsedLocal.biomarkers || {};
            loadedHistory = parsedLocal.biomarkerHistory || [];
            loadedActions = parsedLocal.actions || [];
            loadedBenefits = parsedLocal.dailyBenefits || [];
            loadedReport = parsedLocal.report || null;
          }

          if (!loadedProfile) {
            loadedProfile = {
              nickname: user.displayName || '',
              photoUrl: user.photoURL || '',
              email: user.email || '',
              age: '' as any,
              ethnicity: 'Unknown',
              weight: '' as any,
              height: '' as any,
              gender: 'Unknown',
              timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
              language: 'en'
            };
          } else {
            loadedProfile.email = user.email || '';
          }

          // Save the loaded state to local storage immediately
          const bundle = {
            profile: loadedProfile,
            foodLogs: loadedFoods,
            biomarkers: loadedBiomarkers,
            biomarkerHistory: loadedHistory,
            actions: loadedActions,
            dailyBenefits: loadedBenefits,
            foodIdeas,
            report: loadedReport
          };
          await set(storageKey, bundle);

          // Update React states
          setProfile(loadedProfile);
          setFoodLogs(loadedFoods);
          setBiomarkers(loadedBiomarkers);
          setBiomarkerHistory(loadedHistory);
          setActions(loadedActions);
          setDailyBenefits(loadedBenefits);
          setReport(loadedReport);
          
          // Load only from local cache on initial load/session load to prevent automatic Firebase calls.
          // Firestore checks will happen ONLY when the user manually clicks "Sync Now" in the header.
          setSyncState('local');
        } else {
          // Not signed in, fall back to guest storage if available
          const storageKey = getStorageKey('guest');
          const parsedLocal = await get(storageKey);
          if (parsedLocal) {
            try {
              if (parsedLocal.profile) setProfile(parsedLocal.profile);
              if (parsedLocal.foodLogs) setFoodLogs(parsedLocal.foodLogs);
              if (parsedLocal.biomarkers) setBiomarkers(parsedLocal.biomarkers);
              if (parsedLocal.biomarkerHistory) setBiomarkerHistory(parsedLocal.biomarkerHistory);
              if (parsedLocal.actions) setActions(parsedLocal.actions);
              if (parsedLocal.dailyBenefits) setDailyBenefits(parsedLocal.dailyBenefits);
              if (parsedLocal.report) setReport(parsedLocal.report);
            } catch (e) {
              console.error("Failed to restore cached local storage:", e);
            }
          } else {
            setProfile(null);
            setFoodLogs([]);
            setBiomarkers({});
            setBiomarkerHistory([]);
            setActions([]);
            setDailyBenefits([]);
            setReport(null);
          }
          setSyncState('local');
        }
      } catch (err) {
        console.error("Auth session restore failed:", err);
      } finally {
        setIsAuthChecking(false);
      }
    });
    return () => unsubscribe();
  }, []);
  // Keep localStorage updated with React states so that hasLocal and canSkipFetch work flawlessly!
  useEffect(() => {
    if (!profile) return;
    const bundle = {
      profile,
      foodLogs,
      biomarkers,
      biomarkerHistory,
      actions,
      dailyBenefits,
      foodIdeas,
      report
    };
    safeSaveToLocalStorage(getStorageKey(profile?.email), bundle);
  }, [profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, foodIdeas, report]);
  // Automatically log BMI on initial load if profile has height/weight but BMI is missing from history or biomarkers
  useEffect(() => {
    if (isAuthChecking || syncState === 'syncing' || syncState === 'conflict') return;
    if (profile && profile.weight && profile.height && !profile.bmiAutoLogged) {
      const hasBmiInHistory = biomarkerHistory.some(h => h.biomarkers && h.biomarkers.bmi !== undefined);
      const hasBmiInBiomarkers = biomarkers.bmi !== undefined;
      if (!hasBmiInHistory || !hasBmiInBiomarkers) {
        const heightInMeters = Number(profile.height) / 100;
        const bmiScore = Number(profile.weight) / (heightInMeters * heightInMeters);
        if (Number.isNaN(bmiScore) || !isFinite(bmiScore)) return;
        const roundedBmi = parseFloat(bmiScore.toFixed(1));
        const recordDate = getCurrentDateInTimezone(profile.timezone);
        const logId = `med_log_bmi_init_${Date.now()}`;
        
        const updatedProfile: UserProfile = {
          ...profile,
          bmiAutoLogged: true
        };
        setProfile(updatedProfile);
        
        setBiomarkers(prev => {
          if (prev.bmi === roundedBmi) return prev;
          return { ...prev, bmi: roundedBmi };
        });
        setBiomarkerHistory(prev => {
          const updatedHistory = [...prev];
          const existingLogIndex = updatedHistory.findIndex(h => h.date === recordDate);
          
          let targetIdToSave = logId;
          if (existingLogIndex >= 0) {
            targetIdToSave = updatedHistory[existingLogIndex].id;
            if (updatedHistory[existingLogIndex].biomarkers?.bmi === roundedBmi) {
              return prev; // no change
            }
            updatedHistory[existingLogIndex] = {
              ...updatedHistory[existingLogIndex],
              biomarkers: {
                ...updatedHistory[existingLogIndex].biomarkers,
                bmi: roundedBmi
              }
            };
          } else {
            updatedHistory.push({
              id: logId,
              date: recordDate,
              biomarkers: {
                bmi: roundedBmi
              },
              note: `Auto-logged default BMI: ${profile.weight} kg, ${profile.height} cm.`
            });
          }
          updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
          // Trigger saveAndSync in background (safely flagged as an auto log)
          setTimeout(() => {
            const updatedBiomarkers = { ...biomarkers, bmi: roundedBmi };
            saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { 
              type: 'biomarkerLog', 
              targetId: targetIdToSave,
              isAutoLog: true 
            });
          }, 0);
          return updatedHistory;
        });
      }
    }
  }, [isAuthChecking, syncState, profile?.weight, profile?.height, profile?.bmiAutoLogged, biomarkerHistory.length, biomarkers.bmi]);
  // Auto-restore missing food images from chat history
  useEffect(() => {
    if (foodLogs.length === 0) return;
    try {
      const rawChat = sessionStorage.getItem('chat_messages_food');
      if (rawChat) {
        const messages = JSON.parse(rawChat);
        let updated = false;
        let updateCount = 0;
        const newFoodLogs = foodLogs.map(log => {
          if (!log.imageUrl && (!log.imageUrls || log.imageUrls.length === 0)) {
            const msg = messages.find((m: any) => m.pendingFoodLog?.id === log.id);
            if (msg && msg.pendingFoodLog && (msg.pendingFoodLog.imageUrl || msg.pendingFoodLog.imageUrls)) {
              updated = true;
              updateCount++;
              return {
                ...log,
                imageUrl: msg.pendingFoodLog.imageUrl || msg.pendingFoodLog.imageUrls?.[0],
                imageUrls: msg.pendingFoodLog.imageUrls || (msg.pendingFoodLog.imageUrl ? [msg.pendingFoodLog.imageUrl] : [])
              };
            }
          }
          return log;
        });
        if (updated && auth.currentUser) {
          const uid = auth.currentUser.uid;
          console.log(`Restoring ${updateCount} lost images from chat history via batched transaction`);
          setFoodLogs(newFoodLogs);
          
// Deferred to manual sync
        }
      }
    } catch (e) {
      console.warn("Failed to auto-restore images:", e);
    }
  }, [foodLogs.length]);
  // Save changes to local storage and sync to Server cloud database
  const saveAndSync = async (
    currProfile: UserProfile | null,
    currFoods: FoodLog[],
    currBiomarkers: { [key: string]: number | string },
    currBioHistory: BiomarkerLog[],
    currActions: HealthAction[],
    currBenefits: DailyBenefit[],
    currReport: RecommendationReport | null,
    specificUpdate?: {
      type: 'profile' | 'foodLog' | 'biomarkerLog' | 'biomarkerLogsBatch' | 'actions' | 'dailyBenefits' | 'foodIdeas' | 'report' | 'deleteFood' | 'deleteBiomarker' | 'multi' | 'fullPush' | 'analysis' | 'deleteAnalysis' | 'googleSteps';
      targetId?: string;
      targetIds?: string[];
      deletedIds?: string[];
      isAutoLog?: boolean;
    },
    currFoodIdeas: FoodIdea[] = foodIdeas
  ) => {
    const now = Date.now();
    const isAutoLog = !!(specificUpdate?.isAutoLog || 
      (specificUpdate?.type === 'biomarkerLog' && String(specificUpdate.targetId).startsWith('med_log_bmi_init_')) ||
      specificUpdate?.type === 'googleSteps');

    let updatedProfile = currProfile;
    if (currProfile) {
      updatedProfile = {
        ...currProfile,
        approved_agent1_batches: (() => {
          try {
            const saved = localStorage.getItem('approved_agent1_batches');
            return saved ? JSON.parse(saved) : null;
          } catch (e) { return null; }
        })(),
        approved_data_review_batches: (() => {
          try {
            const saved = localStorage.getItem('approved_data_review_batches');
            return saved ? JSON.parse(saved) : null;
          } catch (e) { return null; }
        })(),
        lastUpdatedAt: isAutoLog ? (currProfile.lastUpdatedAt || now) : now
      };
      // Keep local state in sync immediately with the timestamped profile
      setProfile(updatedProfile);
    }
    
    // Ensure all other React states are updated to match what is being synced
    setFoodLogs(currFoods);
    setBiomarkers(currBiomarkers);
    setBiomarkerHistory(currBioHistory);
    setActions(currActions);
    setDailyBenefits(currBenefits);
    setReport(currReport);

    // Save to Local Storage first (Local Save before Upload)
    const bundle = {
      profile: updatedProfile,
      foodLogs: currFoods,
      biomarkers: currBiomarkers,
      biomarkerHistory: currBioHistory,
      actions: currActions,
      dailyBenefits: currBenefits,
      foodIdeas: currFoodIdeas,
      report: currReport
    };
    safeSaveToLocalStorage(getStorageKey(updatedProfile?.email || profile?.email || auth.currentUser?.email), bundle);



    const profileForCloud = updatedProfile ? { ...updatedProfile } : null;
    if (profileForCloud && profileForCloud.agentAnalyses) {
      delete profileForCloud.agentAnalyses;
    }

    if (!updatedProfile || !auth.currentUser) {
      setSyncState('local');
      return;
    }
    if (isFirestoreQuotaExceeded) {
      setSyncState('local');
      return;
    }
    
    // We allow user-triggered specific updates to write to the cloud even if the sync state was 'local' (offline),
    // which helps the app automatically sync and transition back to 'synced' state on any user action.
    // We only block background/automatic updates or if the database quota is explicitly exceeded.
    const isUserTriggered = specificUpdate && 
      specificUpdate.type !== 'googleSteps' && 
      !specificUpdate.isAutoLog &&
      !(specificUpdate.type === 'biomarkerLog' && String(specificUpdate.targetId).startsWith('med_log_bmi_init_'));

    if (syncState === 'local' && specificUpdate?.type !== 'fullPush' && !isUserTriggered) {
      return;
    }
    
    // To minimize database writes and protect against quota exhaustion, 
    // we prevent automatic system updates (such as BMI auto-logging or Google Steps sync)
    // from writing to the cloud in the background. They are kept as local/unsynced state.
    if (isAutoLog) {
      setSyncState('local');
      return;
    }

    setSyncState('syncing');
    const uid = auth.currentUser.uid;
    const syncRootId = logInteraction('sync', `users/${uid} (${specificUpdate ? specificUpdate.type : 'Save changes'})`, null);
    try {
      if (specificUpdate && specificUpdate.type !== 'fullPush') {
        // ALWAYS touch profile timestamp and push deleted IDs tracking so other devices pull correctly
        setDoc(doc(db, 'users', uid), {
          lastUpdatedAt: now,
          deletedFoodLogIds: updatedProfile?.deletedFoodLogIds || [],
          deletedBiomarkerLogIds: updatedProfile?.deletedBiomarkerLogIds || [],
          deletedCustomBiomarkerKeys: updatedProfile?.deletedCustomBiomarkerKeys || []
        }, { merge: true }).catch(err => {
          console.warn("Failed to touch lastUpdatedAt timestamp in cloud:", err);
        });
        if (specificUpdate.type === 'analysis' && specificUpdate.targetId) {
          const analysis = updatedProfile?.agentAnalyses?.find(a => a.id === specificUpdate.targetId);
          if (analysis) {
            const itemTrackId = logInteraction('upload', `users/${uid}/agentAnalyses/${analysis.id}`, analysis);
            await withTimeout(
              setDoc(doc(db, 'users', uid, 'agentAnalyses', analysis.id), cleanData(analysis))
                .then(() => completeInteraction(itemTrackId, true, JSON.stringify(analysis).length))
                .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); handleFirestoreError(err); console.error(err); }),
              2000,
              'Analysis write'
            );
          }
        } else if (specificUpdate.type === 'deleteAnalysis' && specificUpdate.targetId) {
          const delTrackId = logInteraction('delete', `users/${uid}/agentAnalyses/${specificUpdate.targetId}`, null);
          await withTimeout(
            deleteDoc(doc(db, 'users', uid, 'agentAnalyses', specificUpdate.targetId))
              .then(() => completeInteraction(delTrackId, true, 0))
              .catch(err => { completeInteraction(delTrackId, false, 0, err.message); handleFirestoreError(err); console.error(err); }),
            2000,
            'Delete analysis'
          );
        } else if (specificUpdate.type === 'profile') {
          const pId = logInteraction('upload', `users/${uid} (Profile)`, updatedProfile);
          await withTimeout(
            setDoc(doc(db, 'users', uid), cleanData(profileForCloud))
              .then(() => completeInteraction(pId, true, JSON.stringify(updatedProfile).length))
              .catch(err => { completeInteraction(pId, false, 0, err.message); handleFirestoreError(err); console.error(err); }),
            2000,
            'Profile write'
          );
        } else if (specificUpdate.type === 'foodLog' && specificUpdate.targetId) {
          await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, (sf, sb) => {
            setFoodLogs(sf);
            setBiomarkerHistory(sb);
          });
          const f = currFoods.find(item => item.id === specificUpdate.targetId);
          if (f && (f.imageUrl || (f.imageUrls && f.imageUrls.length > 0))) {
            await setDoc(doc(db, 'users', uid, 'foodImages', f.id), {
              imageUrl: f.imageUrl || null,
              imageUrls: f.imageUrls || []
            }).catch(err => console.error(err));
          }
        } else if (specificUpdate.type === 'biomarkerLog' && specificUpdate.targetId) {
          await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, (sf, sb) => {
            setFoodLogs(sf); setBiomarkerHistory(sb);
          });
        } else if (specificUpdate.type === 'biomarkerLogsBatch' && (specificUpdate.targetIds || specificUpdate.deletedIds)) {
          await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, (sf, sb) => {
            setFoodLogs(sf); setBiomarkerHistory(sb);
          });
          const profilePromise = setDoc(doc(db, 'users', uid), cleanData(profileForCloud)).catch(err => handleFirestoreError(err));
          await withTimeout(profilePromise, 3000, 'biomarkerLogsBatch');
        } else if (specificUpdate.type === 'actions') {
          const itemTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (Actions)`, null);
          await withTimeout(
            setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), { actions: currActions.map(cleanData) }, { merge: true })
              .then(() => completeInteraction(itemTrackId, true, JSON.stringify(currActions).length))
              .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); handleFirestoreError(err); console.error(err); }),
            2000,
            'Actions write'
          );
        } else if (specificUpdate.type === 'dailyBenefits') {
          const itemTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (Benefits)`, null);
          await withTimeout(
            setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), { dailyBenefits: currBenefits.map(cleanData) }, { merge: true })
              .then(() => completeInteraction(itemTrackId, true, JSON.stringify(currBenefits).length))
              .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); handleFirestoreError(err); console.error(err); }),
            2000,
            'DailyBenefits write'
          );
        } else if (specificUpdate.type === 'foodIdeas') {
          const itemTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (FoodIdeas)`, null);
          await withTimeout(
            setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), { foodIdeas: currFoodIdeas.map(cleanData) }, { merge: true })
              .then(() => completeInteraction(itemTrackId, true, JSON.stringify(currFoodIdeas).length))
              .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); handleFirestoreError(err); console.error(err); }),
            2000,
            'FoodIdeas write'
          );
        } else if (specificUpdate.type === 'report' && currReport) {
          const itemTrackId = logInteraction('upload', `users/${uid}/reports/latest`, currReport);
          await withTimeout(
            setDoc(doc(db, 'users', uid, 'reports', 'latest'), cleanData(currReport))
              .then(() => completeInteraction(itemTrackId, true, JSON.stringify(currReport).length))
              .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); handleFirestoreError(err); console.error(err); }),
            2000,
            'Report write'
          );
          
          const dashTrackId = logInteraction('upload', `users/${uid}/metadata/dashboard (Report Update)`, null);
          await withTimeout(
            setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), {
              actions: currActions.map(cleanData),
              dailyBenefits: currBenefits.map(cleanData)
            }).catch(console.error),
            2000,
            'Dashboard report sync'
          );
        } else if (specificUpdate.type === 'deleteFood' && specificUpdate.targetId) {
          await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, (sf, sb) => {
            setFoodLogs(sf); setBiomarkerHistory(sb);
          });
          deleteDoc(doc(db, 'users', uid, 'foodLogs', specificUpdate.targetId)).catch(() => {});
        } else if (specificUpdate.type === 'deleteBiomarker' && specificUpdate.targetId) {
          await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, (sf, sb) => {
            setFoodLogs(sf); setBiomarkerHistory(sb);
          });
          deleteDoc(doc(db, 'users', uid, 'biomarkerHistory', specificUpdate.targetId)).catch(() => {});
        }
      } else if (specificUpdate && specificUpdate.type === 'fullPush') {
        const pId = logInteraction('upload', `users/${uid} (Profile)`, currProfile);
        const profilePromise = setDoc(doc(db, 'users', uid), cleanData(profileForCloud))
          .then(() => completeInteraction(pId, true, JSON.stringify(currProfile).length))
          .catch(err => { completeInteraction(pId, false, 0, err.message); handleFirestoreError(err); });
        
        // Retrieve optional cloud lists passed to prevent redundant uploads
        const cloudFoods = (specificUpdate as any).cloudFoods || [];
        const cloudBioHistory = (specificUpdate as any).cloudBioHistory || [];

        // V2 bulk sync
        await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, (sf, sb) => {
          setFoodLogs(sf); setBiomarkerHistory(sb);
        });

        // Run promises in small sequential batches of 5 to avoid exhausting the Firestore write stream
        const chunkPromises = async (tasks: (() => Promise<any>)[], chunkSize: number) => {
          for (let i = 0; i < tasks.length; i += chunkSize) {
            const chunk = tasks.slice(i, i + chunkSize);
            await Promise.all(chunk.map(task => task()));
          }
        };

        const foodImageTasks = currFoods
          .filter(f => f.sync_state !== 'synced' && (f.imageUrl || (f.imageUrls && f.imageUrls.length > 0)))
          .map(f => {
            const cloudF = cloudFoods.find((cf: any) => cf.id === f.id);
            if (!cloudF || cloudF.imageUrl !== f.imageUrl || JSON.stringify(cloudF.imageUrls) !== JSON.stringify(f.imageUrls)) {
              return () => setDoc(doc(db, 'users', uid, 'foodImages', f.id), {
                imageUrl: f.imageUrl || null,
                imageUrls: f.imageUrls || []
              }).catch(err => console.error("Food image sync error:", err));
            }
            return null;
          })
          .filter((t): t is () => Promise<void> => t !== null);

        const foodImagePromise = chunkPromises(foodImageTasks, 5);

        const dashboardPromise = setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), {
          actions: currActions.map(cleanData),
          dailyBenefits: currBenefits.map(cleanData),
          foodIdeas: currFoodIdeas.map(cleanData)
        }, { merge: true }).catch(err => { handleFirestoreError(err); console.error(err); });
        let reportPromise = Promise.resolve();
        if (currReport) {
          const itemTrackId = logInteraction('upload', `users/${uid}/reports/latest`, currReport);
          reportPromise = setDoc(doc(db, 'users', uid, 'reports', 'latest'), cleanData(currReport))
            .then(() => completeInteraction(itemTrackId, true, JSON.stringify(currReport).length))
            .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); handleFirestoreError(err); });
        }
        await withTimeout(
          Promise.all([
            profilePromise,
            dashboardPromise,
            reportPromise,
            foodImagePromise
          ]),
          3000,
          'FullPush sync'
        ).catch(err => console.warn('Background sync warning:', err));
      } else {
        // Multi-document sync (default when no specific update provided)
        const pId = logInteraction('upload', `users/${uid} (Profile)`, currProfile);
        const profilePromise = setDoc(doc(db, 'users', uid), cleanData(profileForCloud))
          .then(() => completeInteraction(pId, true, JSON.stringify(currProfile).length))
          .catch(err => { completeInteraction(pId, false, 0, err.message); handleFirestoreError(err); });
          
        const dashboardPromise = setDoc(doc(db, 'users', uid, 'metadata', 'dashboard'), {
          actions: currActions.map(cleanData),
          dailyBenefits: currBenefits.map(cleanData),
          foodIdeas: currFoodIdeas.map(cleanData)
        }, { merge: true }).catch(err => { handleFirestoreError(err); console.error(err); });
        let reportPromise = Promise.resolve();
        if (currReport) {
          const itemTrackId = logInteraction('upload', `users/${uid}/reports/latest`, currReport);
          reportPromise = setDoc(doc(db, 'users', uid, 'reports', 'latest'), cleanData(currReport))
            .then(() => completeInteraction(itemTrackId, true, JSON.stringify(currReport).length))
            .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); handleFirestoreError(err); });
        }
        
        // V2 bulk sync
        await syncLogsWithTimeBuckets(db, uid, currFoods, currBioHistory, (sf, sb) => {
          setFoodLogs(sf); setBiomarkerHistory(sb);
        });

        const foodImagePromises = currFoods.map(f => {
          if ((f.imageUrl || (f.imageUrls && f.imageUrls.length > 0)) && (f.sync_state === 'new' || f.sync_state === 'update')) {
            // Optimized image write: only write if newly added or updated
            return setDoc(doc(db, 'users', uid, 'foodImages', f.id), {
              imageUrl: f.imageUrl || null,
              imageUrls: f.imageUrls || []
            }).catch(err => console.error(err));
          }
          return Promise.resolve();
        });
        await withTimeout(
          Promise.all([
            profilePromise,
            dashboardPromise,
            reportPromise,
            ...foodImagePromises
          ]),
          3000,
          'Multi sync'
        ).catch(err => console.warn('Background sync warning:', err));
      }
      // Artificially enforce a minimum rotation time of 800ms so the user gets clear visual confirmation
      await new Promise(resolve => setTimeout(resolve, 800));
      const finalBundle = {
        profile: updatedProfile,
        foodLogs: currFoods,
        biomarkers: currBiomarkers,
        biomarkerHistory: currBioHistory,
        actions: currActions,
        dailyBenefits: currBenefits,
        foodIdeas: currFoodIdeas,
        report: currReport,
        lastSyncedAt: Date.now()
      };
      safeSaveToLocalStorage(getStorageKey(updatedProfile?.email || profile?.email || auth.currentUser?.email), finalBundle);
      setSyncState('synced');
      completeInteraction(syncRootId, true, 0);
    } catch (e: any) {
      console.error("[Sync Save Fail]", e);
      handleFirestoreError(e);
      setSyncState('local');
      completeInteraction(syncRootId, false, 0, e.message || 'Save error');
    }
  };

  const handleResolveConflict = async (biomarkerSource: 'local' | 'cloud', foodSource: 'local' | 'cloud') => {
    if (!conflictData || !auth.currentUser) return;
    setSyncState('syncing');

    const uid = auth.currentUser.uid;
    const now = Date.now();

    // 1. Resolve Profile & Biomarkers
    let resolvedProfile: UserProfile;
    let resolvedBioHistory: BiomarkerLog[];
    let resolvedActions: HealthAction[];
    let resolvedBenefits: DailyBenefit[];
    let resolvedReport: RecommendationReport | null;

    if (biomarkerSource === 'local') {
      resolvedProfile = { ...conflictData.localProfile, lastUpdatedAt: now };
      resolvedBioHistory = [...conflictData.localBioHistory];
      resolvedActions = [...conflictData.localActions];
      resolvedBenefits = [...conflictData.localBenefits];
      resolvedReport = conflictData.localReport;
    } else {
      resolvedProfile = { ...conflictData.cloudProfile, lastUpdatedAt: now };
      resolvedBioHistory = [...conflictData.cloudBioHistory];
      resolvedActions = [...conflictData.cloudActions];
      resolvedBenefits = [...conflictData.cloudBenefits];
      resolvedReport = conflictData.cloudReport;
    }

    // 2. Resolve Food Log
    let resolvedFoods: FoodLog[];
    if (foodSource === 'local') {
      resolvedFoods = [...conflictData.localFoods];
    } else {
      resolvedFoods = [...conflictData.cloudFoods];
    }

    // 3. Compute active biomarkers
    const computedBiomarkers: { [key: string]: number | string } = {};
    [...resolvedBioHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        computedBiomarkers[k] = v as string | number;
      });
    });

    // 4. Update state variables immediately
    setProfile(resolvedProfile);
    setFoodLogs(resolvedFoods);
    setBiomarkerHistory(resolvedBioHistory);
    setBiomarkers(computedBiomarkers);
    setActions(resolvedActions);
    setDailyBenefits(resolvedBenefits);
    if (resolvedReport) setReport(resolvedReport);

    // 5. Write to local storage with new sync timestamp
    const bundle = {
      profile: resolvedProfile,
      foodLogs: resolvedFoods,
      biomarkers: computedBiomarkers,
      biomarkerHistory: resolvedBioHistory,
      actions: resolvedActions,
      dailyBenefits: resolvedBenefits,
      report: resolvedReport,
      lastSyncedAt: now
    };
    safeSaveToLocalStorage(getStorageKey(resolvedProfile?.email || profile?.email || auth.currentUser?.email), bundle);

    // 6. Push fully resolved bundle to Cloud Firestore (full push)
    try {
      await saveAndSync(resolvedProfile, resolvedFoods, computedBiomarkers, resolvedBioHistory, resolvedActions, resolvedBenefits, resolvedReport, { 
        type: 'fullPush',
        cloudFoods: conflictData.cloudFoods,
        cloudBioHistory: conflictData.cloudBioHistory
      } as any);
      setConflictData(null);
      setSyncState('synced');
    } catch (err) {
      console.error("Failed to push resolved sync state:", err);
      setSyncState('local');
    }
  };

  // Sync Check on Login / Fetch user record if existing on server
  const handleLogin = async (loggedProfile: UserProfile) => {
    setProfile(loggedProfile);
    setSyncState('local');
  };
  const handleSignOut = async () => {
    try {
      // Clear all React state immediately so no glimpse of user data after sign-out
      setProfile(null);
      setFoodLogs([]);
      setBiomarkers({});
      setBiomarkerHistory([]);
      setActions([]);
      setDailyBenefits([]);
      setReport(null);
      setSyncState('local');
      await fbSignOut(auth);
      // Note: Do NOT clear localStorage — user data is preserved per-email key
      // and will load correctly when the correct user signs back in.
    } catch (e) {
      console.error("Failed to sign out from Firebase:", e);
    }
  };
  // Selected LLM Engine shared across sections - highest RPD model is the default, and we persist the user selection
  const [selectedModelId, setSelectedModelIdState] = useState<string>(() => {
    const saved = localStorage.getItem('selectedModelId');
    if (saved) return saved;
    // Default is the one with the highest RPD
    return AVAILABLE_LLMS[0]?.id || 'gemini-3.1-flash-lite';
  });
  const setSelectedModelId = (id: string) => {
    setSelectedModelIdState(id);
    localStorage.setItem('selectedModelId', id);
  };
  // Add / Edit logs handlers
  const handleLogFood = async (food: FoodLog) => {
    const newFood = { ...food, sync_state: 'new' as const, updated_at: Date.now() };
    const updatedFoods = [...foodLogs, newFood];
    setFoodLogs(updatedFoods);
    await saveAndSync(profile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodLog', targetId: newFood.id });
  };
  const handleUpdateFoodLog = async (updatedLog: FoodLog) => {
    const logWithSync = { ...updatedLog, sync_state: 'update' as const, updated_at: Date.now() };
    const updatedFoods = foodLogs.map(f => f.id === updatedLog.id ? logWithSync : f);
    setFoodLogs(updatedFoods);
    await saveAndSync(profile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodLog', targetId: updatedLog.id });
  };
  const handleDeleteFoodLog = async (id: string) => {
    // Keep it in array but mark as delete so syncUtils can process it
    const updatedFoods = foodLogs.map(f => f.id === id ? { ...f, sync_state: 'delete' as const, updated_at: Date.now() } : f);
    setFoodLogs(updatedFoods);
    
    let updatedProfile = profile ? {
      ...profile,
      deletedFoodLogIds: [...(profile.deletedFoodLogIds || []), id]
    } : null;
    if (updatedProfile) {
      setProfile(updatedProfile);
    }
    await saveAndSync(updatedProfile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'deleteFood', targetId: id });
  };
  const logBmiIfProfileWeightHeightChanged = (
    prev: UserProfile | null,
    next: UserProfile,
    history: BiomarkerLog[],
    biomarks: { [key: string]: number | string }
  ) => {
    const weightChanged = !prev || next.weight !== prev.weight;
    const heightChanged = !prev || next.height !== prev.height;
    const hasNoBmi = !biomarks.bmi || !history.some(h => h.biomarkers && h.biomarkers.bmi !== undefined);
    let updatedHistory = [...history];
    let updatedBiomarkers = { ...biomarks };
    if ((weightChanged || heightChanged || hasNoBmi) && next.weight && next.height) {
      const heightInMeters = Number(next.height) / 100;
      const bmiScore = Number(next.weight) / (heightInMeters * heightInMeters);
      const roundedBmi = parseFloat(bmiScore.toFixed(1));
      const recordDate = getCurrentDateInTimezone(next.timezone || (prev && prev.timezone));
      const existingLogIndex = updatedHistory.findIndex(h => h.date === recordDate);
      if (existingLogIndex >= 0) {
        updatedHistory[existingLogIndex] = {
          ...updatedHistory[existingLogIndex],
          biomarkers: {
            ...updatedHistory[existingLogIndex].biomarkers,
            bmi: roundedBmi
          }
        };
      } else {
        updatedHistory.push({
          id: `med_log_bmi_${Date.now()}`,
          date: recordDate,
          biomarkers: {
            bmi: roundedBmi
          },
          note: `Auto-logged BMI update based on profile change: ${next.weight} kg, ${next.height} cm.`
        });
      }
      updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
      updatedBiomarkers.bmi = roundedBmi;
    }
    return { updatedHistory, updatedBiomarkers, changed: weightChanged || heightChanged || hasNoBmi };
  };

  const handleAgentAnalysisSaved = async (agentType: string, agentResult: any) => {
    if (!profile) return;
    const newId = `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const updatedAnalyses = profile.agentAnalyses ? [...profile.agentAnalyses] : [];
    updatedAnalyses.push({
      id: newId,
      agentType: agentType,
      date: new Date().toISOString(),
      result: agentResult
    });
    const updatedProfile = { 
      ...profile,
      agentAnalyses: updatedAnalyses
    };
    setProfile(updatedProfile);
    await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'analysis', targetId: newId });
  };

  const handleDeleteAnalysis = async (id: string) => {
    if (!profile) return;
    if (profile.agentAnalyses) {
      const updatedProfile = {
        ...profile,
        agentAnalyses: profile.agentAnalyses.filter(a => a.id !== id)
      };
      setProfile(updatedProfile);
      await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'deleteAnalysis', targetId: id });
    }
  };

  const handleLogMedical = async (
    extractedBiomarkers: { [key: string]: number | string }, 
    profileUpdates?: Partial<UserProfile>, 
    date?: string, 
    entries?: { date: string | null; biomarkers: { [key: string]: number | string }; tests?: any[] }[],
    modificationCommand?: { action: 'update_biomarker' | 'update_profile' | 'remove_biomarker'; keyName: string; newValue?: string | number; date?: string }[],
    skipClose?: boolean
  ) => {
    let currentProfile = profile;
    let updatedHistory = [...biomarkerHistory];
    let updatedBiomarkers = { ...biomarkers };
    // Standardize and normalize extracted biomarkers and custom definitions
    let finalExtracted = { ...extractedBiomarkers };
    let finalProfileUpdates = profileUpdates ? { ...profileUpdates } : undefined;

    // Filter out invalid/empty biomarkers
    const isValidValue = (v: unknown): boolean => v !== null && v !== undefined && v !== '' && v !== 'N/A' && v !== 'null';
    Object.keys(finalExtracted).forEach(k => {
      if (!isValidValue(finalExtracted[k])) delete finalExtracted[k];
    });
    if (entries) {
      entries.forEach(e => {
        if (e.biomarkers) {
          Object.keys(e.biomarkers).forEach(k => {
            if (!isValidValue(e.biomarkers[k])) delete e.biomarkers[k];
          });
        }
      });
    }

    // Filter customBiomarkers to only include those that are actually being saved
    if (finalProfileUpdates && finalProfileUpdates.customBiomarkers) {
      const activeKeys = new Set<string>(Object.keys(finalExtracted));
      if (entries) {
        entries.forEach(e => {
          if (e.biomarkers) Object.keys(e.biomarkers).forEach(k => activeKeys.add(k));
        });
      }
      
      const filteredCustoms: { [key: string]: any } = {};
      Object.entries(finalProfileUpdates.customBiomarkers).forEach(([k, v]) => {
        if (activeKeys.has(k)) {
          filteredCustoms[k] = v;
        }
      });
      finalProfileUpdates.customBiomarkers = filteredCustoms;
    }

    const cleanName = (n: string): string => n.split('(')[0].split('[')[0].trim();
    const keyMapping: { [key: string]: string } = {};
    if (finalProfileUpdates && finalProfileUpdates.customBiomarkers && Object.keys(finalProfileUpdates.customBiomarkers).length > 0) {
      const currentCustoms = { ...(profile?.customBiomarkers || {}) };
      const nextCustomDefs: { [key: string]: any } = {};
      Object.entries(finalProfileUpdates.customBiomarkers).forEach(([rawKey, def]) => {
        const rawName = def.name || rawKey;
        const cleaned = cleanName(rawName);
        const normalizeUnit = (u: string) => (u || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        
        const cleanDef = { ...def };
        if (!cleanDef.unit || cleanDef.unit.trim() === '-' || cleanDef.unit.trim() === '') delete cleanDef.unit;
        if (!cleanDef.normalRange || cleanDef.normalRange.trim() === '-' || cleanDef.normalRange.trim() === '') delete cleanDef.normalRange;
        if (!cleanDef.standardMedicalGrouping || cleanDef.standardMedicalGrouping === 'Other') delete cleanDef.standardMedicalGrouping;
        if (!cleanDef.riskCategories || cleanDef.riskCategories.length === 0) delete cleanDef.riskCategories;
        // If the key is already actively tracked by the user, we MUST NOT change its key to avoid breaking history
        if (biomarkers[rawKey]) {
          keyMapping[rawKey] = rawKey;
          currentCustoms[rawKey] = {
            ...(currentCustoms[rawKey] || {}),
            ...cleanDef,
            name: cleaned
          };
          return;
        }

        // Check standard match (skip if rawKey is already an explicitly established custom key)
        const stdMatch = !currentCustoms[rawKey] ? biomarkerDefinitions.find(d => {
          const nameMatch = d.name.toLowerCase() === cleaned.toLowerCase() || d.key.toLowerCase() === cleaned.toLowerCase() || cleanName(d.name).toLowerCase() === cleaned.toLowerCase();
          const unitMatch = !def.unit || !d.unit || normalizeUnit(d.unit) === normalizeUnit(def.unit);
          return nameMatch && unitMatch;
        }) : null;
        if (stdMatch) {
          keyMapping[rawKey] = stdMatch.key;
          return; // Map to standard key, drop custom def
        }
        // Check existing custom match
        let existingKey = Object.keys(currentCustoms).find(k => {
          const nameMatch = cleanName(currentCustoms[k]?.name || '').toLowerCase() === cleaned.toLowerCase();
          const keyMatch = k.toLowerCase() === cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          return nameMatch || keyMatch;
        });
        // Always fallback to rawKey if it already exists as a known key
        if (!existingKey && currentCustoms[rawKey]) {
          existingKey = rawKey;
        }
        if (existingKey) {
          keyMapping[rawKey] = existingKey;
          currentCustoms[existingKey] = {
            ...currentCustoms[existingKey],
            ...def,
            name: cleaned // enforce simple name without brackets
          };
          return;
        }
        // Create new safe key
        const safeKey = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        let targetKey = safeKey || rawKey;
        
        // If targetKey collides with a standard key (which means it failed the unit match above), make it unique
        const isStandard = biomarkerDefinitions.some(d => d.key === targetKey);
        if (isStandard) {
          targetKey = `${targetKey}_${normalizeUnit(def.unit || 'custom')}`;
        }
        
        keyMapping[rawKey] = targetKey;
        nextCustomDefs[targetKey] = {
          ...def,
          name: cleaned
        };
      });
      finalProfileUpdates.customBiomarkers = {
        ...currentCustoms,
        ...nextCustomDefs
      };
    }
    const entriesToProcess = entries && entries.length > 0
      ? entries
      : [{ date: date || null, biomarkers: finalExtracted }];
    let hasNewBiomarkers = false;
    const modifiedLogIds: string[] = [];
    if (modificationCommand && modificationCommand.length > 0) {
      let madeChanges = false;
      modificationCommand.forEach(cmd => {
        if (cmd.action === 'update_biomarker' && cmd.keyName) {
          const targetDate = cmd.date || getCurrentDateInTimezone(profile?.timezone);
          const logIdx = updatedHistory.findIndex(h => h.date === targetDate);
          if (logIdx >= 0 && cmd.newValue !== undefined) {
            updatedHistory[logIdx].biomarkers = {
              ...updatedHistory[logIdx].biomarkers,
              [cmd.keyName]: cmd.newValue
            };
            modifiedLogIds.push(updatedHistory[logIdx].id);
            madeChanges = true;
            hasNewBiomarkers = true;
          }
        } else if (cmd.action === 'remove_biomarker' && cmd.keyName) {
          // Locked markers cannot be removed
          if (cmd.keyName === 'bmi' || cmd.keyName === 'weight' || cmd.keyName === 'height') {
            console.warn(`Prevented deletion of locked biomarker: ${cmd.keyName}`);
            return;
          }
          if (!cmd.date) {
            console.warn(`Prevented deletion: remove_biomarker command missing date`);
            return;
          }
          const targetDate = cmd.date;
          const logIdx = updatedHistory.findIndex(h => h.date === targetDate);
          if (logIdx >= 0 && updatedHistory[logIdx].biomarkers[cmd.keyName] !== undefined) {
            const newBiomarkers = { ...updatedHistory[logIdx].biomarkers };
            delete newBiomarkers[cmd.keyName];
            updatedHistory[logIdx].biomarkers = newBiomarkers;
            modifiedLogIds.push(updatedHistory[logIdx].id);
            madeChanges = true;
            hasNewBiomarkers = true;
          }
        } else if (cmd.action === 'update_profile' && cmd.keyName && cmd.newValue !== undefined) {
          if (!finalProfileUpdates) finalProfileUpdates = {};
          (finalProfileUpdates as any)[cmd.keyName] = cmd.newValue;
          madeChanges = true;
        }
      });
      // If we only processed modification commands and no normal entries, we can skip the standard entry loop.
      if (madeChanges && entriesToProcess.length === 1 && Object.keys(entriesToProcess[0].biomarkers || {}).length === 0) {
        entriesToProcess.length = 0; // Skip
      }
    }
    entriesToProcess.forEach(entry => {
      // Standardize extracted keys
      const mappedExtracted: { [key: string]: number | string } = {};
      const rawKeyToMappedKey: { [key: string]: string } = {};
      Object.entries(entry.biomarkers || {}).forEach(([rawKey, val]) => {
        // Ignore age, height, weight from extracted biomarkers
        if (rawKey === 'weight' || rawKey === 'height' || rawKey === 'age') return;
        if (biomarkerDefinitions.some(d => d.key === rawKey)) {
          mappedExtracted[rawKey] = val;
          rawKeyToMappedKey[rawKey] = rawKey;
          return;
        }
        if (keyMapping[rawKey]) {
          mappedExtracted[keyMapping[rawKey]] = val;
          rawKeyToMappedKey[rawKey] = keyMapping[rawKey];
          return;
        }
        // Check name match directly
        const cleaned = cleanName(rawKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
        const stdMatch = biomarkerDefinitions.find(d => d.name.toLowerCase() === cleaned.toLowerCase() || cleanName(d.name).toLowerCase() === cleaned.toLowerCase());
        if (stdMatch) {
          mappedExtracted[stdMatch.key] = val;
          rawKeyToMappedKey[rawKey] = stdMatch.key;
          return;
        }
        const existingCustoms = { ...(profile?.customBiomarkers || {}) };
        const custMatchKey = Object.keys(existingCustoms).find(k => cleanName(existingCustoms[k]?.name || '').toLowerCase() === cleaned.toLowerCase());
        if (custMatchKey) {
          mappedExtracted[custMatchKey] = val;
          rawKeyToMappedKey[rawKey] = custMatchKey;
          return;
        }
        const safeKey = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const finalKey = safeKey || rawKey;
        mappedExtracted[finalKey] = val;
        rawKeyToMappedKey[rawKey] = finalKey;
      });

      if (Object.keys(mappedExtracted).length > 0) {
        hasNewBiomarkers = true;
        const recordDate = entry.date || getCurrentDateInTimezone(profile?.timezone);
        const existingLogIndex = updatedHistory.findIndex(h => h.date === recordDate);

        // Map tests array
        let entryTests: any[] = [];
        if (entry.tests && Array.isArray(entry.tests)) {
          entryTests = entry.tests.map((t: any) => {
            let mappedKey = t.key;
            if (rawKeyToMappedKey[t.key]) {
              mappedKey = rawKeyToMappedKey[t.key];
            } else {
              if (biomarkerDefinitions.some(d => d.key === t.key)) {
                mappedKey = t.key;
              } else if (keyMapping[t.key]) {
                mappedKey = keyMapping[t.key];
              } else {
                const cleaned = cleanName((t.key || "").split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
                const stdMatch = biomarkerDefinitions.find(d => d.name.toLowerCase() === cleaned.toLowerCase() || cleanName(d.name).toLowerCase() === cleaned.toLowerCase());
                if (stdMatch) {
                  mappedKey = stdMatch.key;
                } else {
                  const existingCustoms = { ...(profile?.customBiomarkers || {}) };
                  const custMatchKey = Object.keys(existingCustoms).find(k => cleanName(existingCustoms[k]?.name || '').toLowerCase() === cleaned.toLowerCase());
                  if (custMatchKey) {
                    mappedKey = custMatchKey;
                  } else {
                    const safeKey = cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
                    mappedKey = safeKey || t.key;
                  }
                }
              }
            }
            return {
              ...t,
              key: mappedKey
            };
          });
        }

        if (existingLogIndex >= 0) {
          // Merge with existing log for this date
          const existingTests = updatedHistory[existingLogIndex].tests || [];
          const mergedTests = [...existingTests];
          entryTests.forEach((t: any) => {
            const idx = mergedTests.findIndex(et => et.key === t.key);
            if (idx >= 0) {
              mergedTests[idx] = { ...mergedTests[idx], ...t };
            } else {
              mergedTests.push(t);
            }
          });

          updatedHistory[existingLogIndex] = {
            ...updatedHistory[existingLogIndex],
            biomarkers: { ...updatedHistory[existingLogIndex].biomarkers, ...mappedExtracted },
            tests: mergedTests,
            sync_state: 'update',
            updated_at: Date.now()
          };
          modifiedLogIds.push(updatedHistory[existingLogIndex].id);
        } else {
          const datedLog: BiomarkerLog = {
            id: `med_log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            date: recordDate,
            biomarkers: mappedExtracted,
            tests: entryTests,
            sync_state: 'new',
            updated_at: Date.now()
          };
          updatedHistory.push(datedLog);
          modifiedLogIds.push(datedLog.id);
        }
      }
    });
    if (finalProfileUpdates && Object.keys(finalProfileUpdates).length > 0) {
      if (typeof finalProfileUpdates.age === 'string') finalProfileUpdates.age = parseFloat(finalProfileUpdates.age) || finalProfileUpdates.age;
      if (typeof finalProfileUpdates.weight === 'string') finalProfileUpdates.weight = parseFloat(finalProfileUpdates.weight) || finalProfileUpdates.weight;
      if (typeof finalProfileUpdates.height === 'string') finalProfileUpdates.height = parseFloat(finalProfileUpdates.height) || finalProfileUpdates.height;
      const nextProfile = { ...profile, ...finalProfileUpdates };
      const bmiRes = logBmiIfProfileWeightHeightChanged(profile, nextProfile, updatedHistory, updatedBiomarkers);
      currentProfile = nextProfile;
      updatedHistory = bmiRes.updatedHistory;
      updatedBiomarkers = bmiRes.updatedBiomarkers;
      setProfile(currentProfile);
      setBiomarkerHistory(updatedHistory);
      setBiomarkers(updatedBiomarkers);
    }
    if (hasNewBiomarkers) {
      // Sort history by date descending
      updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
      setBiomarkerHistory(updatedHistory);
      // Recompute the latest biomarkers from history so they reflect the latest dates (sorted ascending)
      const recomputedBiomarkers: { [key: string]: number | string } = {};
      [...updatedHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });
      setBiomarkers(recomputedBiomarkers);
      if (!skipClose) {
        setIsMedicalChatOpen(false);
        setActiveTab('home');
      }

// Sync deferred to manual button click
      
      await saveAndSync(currentProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: modifiedLogIds, deletedIds: [] });
    } else {
      if (!skipClose) {
        setIsMedicalChatOpen(false);
        setActiveTab('home');
      }
      await saveAndSync(currentProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: modifiedLogIds, deletedIds: [] });
    }
  };
  const handleDeleteMultipleBiomarkers = async (keys: string[]) => {
    const safeKeys = keys.filter(k => k !== 'bmi' && k !== 'weight' && k !== 'height');
    if (safeKeys.length === 0) {
      console.warn("Prevented deletion of locked biomarkers: weight, height, bmi");
      return;
    }
    const updatedBiomarkers = { ...biomarkers };
    safeKeys.forEach(key => delete updatedBiomarkers[key]);
    
    const logsToDelete: string[] = [];
    const logsToUpdate: string[] = [];
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      let changed = false;
      safeKeys.forEach(key => {
        if (cleanBiomarkers[key] !== undefined) {
          delete cleanBiomarkers[key];
          changed = true;
        }
      });
      if (changed) {
        if (Object.keys(cleanBiomarkers).length === 0 && !log.note) {
          logsToDelete.push(log.id);
        } else {
          logsToUpdate.push(log.id);
        }
      }
      return changed ? { ...log, biomarkers: cleanBiomarkers } : log;
    });
    
    updatedHistory = updatedHistory.filter(log => !logsToDelete.includes(log.id));
    setBiomarkers(updatedBiomarkers);
    setBiomarkerHistory(updatedHistory);
    
    let updatedProfile = { ...profile } as UserProfile;
    if (logsToDelete.length > 0) {
      updatedProfile.deletedBiomarkerLogIds = [
        ...(updatedProfile.deletedBiomarkerLogIds || []),
        ...logsToDelete
      ];
    }
    if (updatedProfile.customBiomarkers) {
      const newCustoms = { ...updatedProfile.customBiomarkers };
      safeKeys.forEach(key => delete newCustoms[key]);
      updatedProfile.customBiomarkers = newCustoms;
    }
    updatedProfile.deletedCustomBiomarkerKeys = [
      ...(updatedProfile.deletedCustomBiomarkerKeys || []),
      ...safeKeys
    ];
    setProfile(updatedProfile);
    if (logsToUpdate.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: logsToUpdate, deletedIds: logsToDelete });
    } else if (logsToDelete.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: [], deletedIds: logsToDelete });
    } else {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };

  const handleDeleteBiomarker = async (key: string) => {
    if (key === 'bmi' || key === 'weight' || key === 'height') {
      console.warn(`Prevented deletion of locked biomarker: ${key}`);
      return;
    }
    const updatedBiomarkers = { ...biomarkers };
    delete updatedBiomarkers[key];
    
    const logsToDelete: string[] = [];
    const logsToUpdate: string[] = [];
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      if (cleanBiomarkers[key] !== undefined) {
        delete cleanBiomarkers[key];
        if (Object.keys(cleanBiomarkers).length === 0 && !log.note) {
          logsToDelete.push(log.id);
        } else {
          logsToUpdate.push(log.id);
        }
      }
      return { ...log, biomarkers: cleanBiomarkers };
    });
    
    updatedHistory = updatedHistory.filter(log => !logsToDelete.includes(log.id));
    setBiomarkers(updatedBiomarkers);
    setBiomarkerHistory(updatedHistory);
    let updatedProfile = { ...profile } as UserProfile;
    if (logsToDelete.length > 0) {
      updatedProfile.deletedBiomarkerLogIds = [
        ...(updatedProfile.deletedBiomarkerLogIds || []),
        ...logsToDelete
      ];
    }
    if (updatedProfile.customBiomarkers && updatedProfile.customBiomarkers[key]) {
      const newCustoms = { ...updatedProfile.customBiomarkers };
      delete newCustoms[key];
      updatedProfile.customBiomarkers = newCustoms;
    }
    updatedProfile.deletedCustomBiomarkerKeys = [
      ...(updatedProfile.deletedCustomBiomarkerKeys || []),
      key
    ];
    setProfile(updatedProfile);
// Sync deferred to manual button click
    if (logsToUpdate.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: logsToUpdate, deletedIds: logsToDelete });
    } else if (logsToDelete.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: [], deletedIds: logsToDelete });
    } else {
      await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };
  const handleDeleteEmptyBiomarkers = async () => {
    let updatedProfile = { ...profile } as UserProfile;
    let modifiedProfile = false;
    let modifiedBiomarkers = false;

    const logsToDelete: string[] = [];
    const logsToUpdate: BiomarkerLog[] = [];

    // 1. Clean history: remove empty values from logs.
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      let logChanged = false;

      Object.keys(cleanBiomarkers).forEach(key => {
        const val = cleanBiomarkers[key];
        // Delete if it has no useful value
        if (val === undefined || val === null || val === '' || Number.isNaN(val) || (typeof val === 'string' && val.trim() === '')) {
          delete cleanBiomarkers[key];
          logChanged = true;
        }
      });

      if (logChanged) {
        if (Object.keys(cleanBiomarkers).length === 0 && !log.note) {
          logsToDelete.push(log.id);
          return { ...log, biomarkers: cleanBiomarkers, sync_state: 'delete' as const, updated_at: Date.now() };
        } else {
          const updatedLog = { ...log, biomarkers: cleanBiomarkers, sync_state: 'update' as const, updated_at: Date.now() };
          logsToUpdate.push(updatedLog);
          return updatedLog;
        }
      }
      return log;
    });

    // We do NOT filter out logsToDelete, syncUtils handles it
    // But for local calculations of usedKeys, we ignore deleted logs
    const usedKeys = new Set<string>();
    updatedHistory.filter(l => l.sync_state !== 'delete').forEach(log => {
      Object.keys(log.biomarkers).forEach(key => usedKeys.add(key));
    });

    if (logsToDelete.length > 0) {
      updatedProfile.deletedBiomarkerLogIds = [
        ...(updatedProfile.deletedBiomarkerLogIds || []),
        ...logsToDelete
      ];
      modifiedProfile = true;
    }

    // 3. Clean customBiomarkers
    const deletedKeys: string[] = [];
    if (updatedProfile.customBiomarkers) {
      const newCustoms = { ...updatedProfile.customBiomarkers };
      Object.keys(newCustoms).forEach(key => {
        if (!usedKeys.has(key)) {
          delete newCustoms[key];
          deletedKeys.push(key);
          modifiedProfile = true;
        }
      });
      if (modifiedProfile) {
        updatedProfile.customBiomarkers = newCustoms;
      }
    }
    if (deletedKeys.length > 0) {
      updatedProfile.deletedCustomBiomarkerKeys = [
        ...(updatedProfile.deletedCustomBiomarkerKeys || []),
        ...deletedKeys
      ];
    }

    // 4. Recompute the biomarkers state
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].filter(b => b.sync_state !== 'delete').sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });

    // Detect if current biomarkers state changed
    const currentKeys = Object.keys(biomarkers);
    const newKeys = Object.keys(recomputedBiomarkers);
    if (currentKeys.length !== newKeys.length || currentKeys.some(k => biomarkers[k] !== recomputedBiomarkers[k])) {
      modifiedBiomarkers = true;
    }

    if (logsToDelete.length === 0 && logsToUpdate.length === 0 && !modifiedProfile && !modifiedBiomarkers) {
      return; // Nothing to change
    }

    if (modifiedProfile) setProfile(updatedProfile);
    if (modifiedBiomarkers) setBiomarkers(recomputedBiomarkers);
    setBiomarkerHistory(updatedHistory);

// Sync deferred to manual button click
    if (logsToUpdate.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: logsToUpdate.map(l => l.id), deletedIds: logsToDelete });
    } else if (logsToDelete.length > 0) {
      await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: [], deletedIds: logsToDelete });
    } else {
      await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };
  const handleDeleteBiomarkerLog = async (id: string) => {
    const targetLog = biomarkerHistory.find(b => b.id === id);
    if (targetLog) {
      const hasLocked = Object.keys(targetLog.biomarkers).some(k => k === 'bmi' || k === 'weight' || k === 'height');
      if (hasLocked) {
        console.warn(`Prevented deletion of log ${id} containing locked biomarkers`);
        return;
      }
    }
    // Keep it in array but mark as delete so syncUtils can process it
    const updatedHistory = biomarkerHistory.map(b => b.id === id ? { ...b, sync_state: 'delete' as const, updated_at: Date.now() } : b);
    setBiomarkerHistory(updatedHistory);
    
    // We filter it out for the recomputed local state map
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].filter(b => b.sync_state !== 'delete').sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });
    setBiomarkers(recomputedBiomarkers);
    
    let updatedProfile = profile ? {
      ...profile,
      deletedBiomarkerLogIds: [...(profile.deletedBiomarkerLogIds || []), id]
    } : null;
    if (updatedProfile) {
      setProfile(updatedProfile);
    }
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'deleteBiomarker', targetId: id });
  };
  const handleDeleteBiomarkerFromLog = async (id: string, key: string) => {
    if (key === 'bmi' || key === 'weight' || key === 'height') {
      console.warn(`Prevented deletion of locked biomarker from log: ${key}`);
      return;
    }
    const targetLog = biomarkerHistory.find(b => b.id === id);
    if (!targetLog) return;

    const remainingKeys = Object.keys(targetLog.biomarkers).filter(k => k !== key);
    
    if (remainingKeys.length > 0) {
      const updatedHistory = biomarkerHistory.map(log => {
        if (log.id === id) {
          const newBiomarkers = { ...log.biomarkers };
          delete newBiomarkers[key];
          return {
            ...log,
            biomarkers: newBiomarkers,
            sync_state: 'update' as const,
            updated_at: Date.now()
          };
        }
        return log;
      });
      setBiomarkerHistory(updatedHistory);
      
      const recomputedBiomarkers: { [key: string]: number | string } = {};
      [...updatedHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });
      setBiomarkers(recomputedBiomarkers);
      
      await saveAndSync(profile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLog', targetId: id });
    } else {
      await handleDeleteBiomarkerLog(id);
    }
  };
  const handleEditBiomarkerLog = async (id: string, key: string, value: string | number, newDate?: string) => {
    const updatedHistory = biomarkerHistory.map(log => {
      if (log.id === id) {
        const numValue = typeof value === 'string' ? parseFloat(value) : value;
        return {
          ...log,
          date: newDate || log.date,
          biomarkers: {
            ...log.biomarkers,
            [key]: isNaN(numValue) ? value : numValue
          },
          sync_state: 'update' as const,
          updated_at: Date.now()
        };
      }
      return log;
    });
    updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
    setBiomarkerHistory(updatedHistory);
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });
    setBiomarkers(recomputedBiomarkers);
    await saveAndSync(profile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLog', targetId: id });
  };
  const handleStandardizeBiomarkerUnits = async (updates: { [key: string]: any }) => {
    let hasChanges = false;
    const updatedProfile = { ...profile };
    if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};

    for (const [key, val] of Object.entries(updates)) {
      const oldCustom = updatedProfile.customBiomarkers[key] || {};
      updatedProfile.customBiomarkers[key] = {
        ...oldCustom,
        name: val.name || oldCustom.name,
        unit: val.unit !== undefined ? val.unit : oldCustom.unit,
        standardMedicalGrouping: val.standardMedicalGrouping !== undefined ? val.standardMedicalGrouping : (oldCustom.standardMedicalGrouping || "By Medical Practice"),
        riskCategories: val.riskCategories !== undefined ? val.riskCategories : oldCustom.riskCategories,
        potentialMedicalConditions: val.potentialMedicalConditions !== undefined ? val.potentialMedicalConditions : oldCustom.potentialMedicalConditions
      };
      hasChanges = true;
    }

    if (hasChanges) {
      setProfile(updatedProfile);
      await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };

  
  const handleBatchCombineBiomarkers = async (
    combinations: {
      targetKey: string;
      targetDef: any;
      mergedLogs: { date: string; value: number | string; originalLogId?: string }[];
      sourceKeysToDelete: string[];
    }[]
  ) => {
    let updatedCustomBiomarkers = { ...(profile?.customBiomarkers || {}) };
    let updatedHistory = [...biomarkerHistory];
    
    combinations.forEach(combo => {
      const { targetKey, targetDef, mergedLogs, sourceKeysToDelete } = combo;
      
      sourceKeysToDelete.forEach(k => {
        delete updatedCustomBiomarkers[k];
      });
      const builtIn = biomarkerDefinitions.find(d => d.key === targetKey);
      const existingCustom = updatedCustomBiomarkers[targetKey];
      
      updatedCustomBiomarkers[targetKey] = {
        ...(builtIn || {}),
        ...(existingCustom || {}),
        name: targetDef.name,
        unit: targetDef.unit,
        normalRange: targetDef.normalRange,
        description: targetDef.description,
        standardMedicalGrouping: targetDef.standardMedicalGrouping || '',
        riskCategories: targetDef.riskCategories || [],
        potentialMedicalConditions: targetDef.potentialMedicalConditions || [],
        ...(targetDef.rangeConfig ? { rangeConfig: targetDef.rangeConfig } : {}),
        ...(targetDef.customRanges ? { customRanges: targetDef.customRanges } : {})
      };

      updatedHistory = updatedHistory.map(log => {
        const cleanBiomarkers = { ...log.biomarkers };
        sourceKeysToDelete.forEach(k => {
          delete cleanBiomarkers[k];
        });
        return {
          ...log,
          biomarkers: cleanBiomarkers
        };
      });

      mergedLogs.forEach(ml => {
        let existingIndex = -1;
        if (ml.originalLogId) {
          existingIndex = updatedHistory.findIndex(h => h.id === ml.originalLogId);
        }
        if (existingIndex < 0) {
          existingIndex = updatedHistory.findIndex(h => h.date === ml.date);
        }
        if (existingIndex >= 0) {
          updatedHistory[existingIndex] = {
            ...updatedHistory[existingIndex],
            biomarkers: {
              ...updatedHistory[existingIndex].biomarkers,
              [targetKey]: ml.value
            }
          };
        } else {
          updatedHistory.push({
            id: `med_log_combined_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            date: ml.date,
            biomarkers: {
              [targetKey]: ml.value
            }
          });
        }
      });
    });

    updatedHistory = updatedHistory.filter(h => Object.keys(h.biomarkers).length > 0);
    updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

    const updatedProfile: UserProfile = {
      ...profile as any,
      customBiomarkers: updatedCustomBiomarkers
    };

    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });

    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);

// Deferred to manual sync
    const changedLogIds = updatedHistory.map(l => l.id);
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: changedLogIds });
  };


  const handleCombineBiomarkers = async (
    targetKey: string,
    targetDef: any,
    mergedLogs: { date: string; value: number | string; originalLogId?: string }[],
    sourceKeysToDelete: string[]
  ) => {
    // 1. Remove old custom definitions, and add the new one if custom
    const updatedCustomBiomarkers = { ...(profile?.customBiomarkers || {}) };
    sourceKeysToDelete.forEach(k => {
      delete updatedCustomBiomarkers[k];
    });
    const builtIn = biomarkerDefinitions.find(d => d.key === targetKey);
    const existingCustom = profile?.customBiomarkers?.[targetKey];
    
    updatedCustomBiomarkers[targetKey] = {
      ...(builtIn || {}),
      ...(existingCustom || {}),
      name: targetDef.name,
      unit: targetDef.unit,
      normalRange: targetDef.normalRange,
      description: targetDef.description,
      standardMedicalGrouping: targetDef.standardMedicalGrouping || '',
      riskCategories: targetDef.riskCategories || [],
      potentialMedicalConditions: targetDef.potentialMedicalConditions || [],
      ...(targetDef.rangeConfig ? { rangeConfig: targetDef.rangeConfig } : {}),
      ...(targetDef.customRanges ? { customRanges: targetDef.customRanges } : {})
    };
    const updatedProfile: UserProfile = {
      ...profile,
      customBiomarkers: updatedCustomBiomarkers
    };
    // 2. Remove old keys from history and merge the consolidated logs
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      sourceKeysToDelete.forEach(k => {
        delete cleanBiomarkers[k];
      });
      return {
        ...log,
        biomarkers: cleanBiomarkers
      };
    });
    // Merge Consolidated
    mergedLogs.forEach(ml => {
      let existingIndex = -1;
      if (ml.originalLogId) {
        existingIndex = updatedHistory.findIndex(h => h.id === ml.originalLogId);
      }
      if (existingIndex < 0) {
        existingIndex = updatedHistory.findIndex(h => h.date === ml.date);
      }
      if (existingIndex >= 0) {
        updatedHistory[existingIndex] = {
          ...updatedHistory[existingIndex],
          biomarkers: {
            ...updatedHistory[existingIndex].biomarkers,
            [targetKey]: ml.value
          }
        };
      } else {
        updatedHistory.push({
          id: `med_log_combined_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          date: ml.date,
          biomarkers: {
            [targetKey]: ml.value
          }
        });
      }
    });
    // Clean completely empty history logs
    updatedHistory = updatedHistory.filter(h => Object.keys(h.biomarkers).length > 0);
    updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
    // 3. Recompute latest biomarkers
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });
    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);

// Sync deferred to manual button click
    const changedLogIds = updatedHistory.map(l => l.id);
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: changedLogIds });
  };
  const handleBatchConsolidate = async (mapping: { [key: string]: string }) => {
    const targetGroups: { [targetKey: string]: string[] } = {};
    const updatedCustomBiomarkers = { ...(profile?.customBiomarkers || {}) };

    Object.entries(mapping).forEach(([srcKey, tgtKey]) => {
      if (srcKey && tgtKey) {
        if (srcKey !== tgtKey) {
          if (!targetGroups[tgtKey]) {
            targetGroups[tgtKey] = [];
          }
          if (!targetGroups[tgtKey].includes(srcKey)) {
            targetGroups[tgtKey].push(srcKey);
          }
        } else {
          // If source equals target, the user is approving the marker as its own standard definition
          if (!updatedCustomBiomarkers[srcKey]) {
            updatedCustomBiomarkers[srcKey] = {
              name: srcKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
              unit: '',
              normalRange: '',
              standardMedicalGrouping: 'By Medical Practice' // Giving it a grouping marks it as approved
            };
          } else if (!updatedCustomBiomarkers[srcKey].standardMedicalGrouping) {
            updatedCustomBiomarkers[srcKey].standardMedicalGrouping = 'By Medical Practice';
          }
        }
      }
    });

    let updatedHistory = [...biomarkerHistory];

    Object.entries(targetGroups).forEach(([targetKey, sourceKeys]) => {
      const isTargetStandard = biomarkerDefinitions.some(d => d.key === targetKey);
      if (!isTargetStandard && !updatedCustomBiomarkers[targetKey]) {
        const sourceDef = sourceKeys.map(k => updatedCustomBiomarkers[k]).find(def => !!def);
        updatedCustomBiomarkers[targetKey] = {
          name: sourceDef?.name || targetKey.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          unit: sourceDef?.unit || '',
          normalRange: sourceDef?.normalRange || '',
          description: sourceDef?.description || '',
          benefitRisk: sourceDef?.benefitRisk || ''
        };
      }

      const allUniqueDates = Array.from(new Set(
        updatedHistory.filter(log => {
          return log.biomarkers[targetKey] !== undefined || sourceKeys.some(k => log.biomarkers[k] !== undefined);
        }).map(log => log.date)
      ));

      allUniqueDates.forEach(date => {
        const dayLogs = updatedHistory.filter(log => log.date === date);
        if (dayLogs.length === 0) return;

        const values: (number | string)[] = [];
        const notes: string[] = [];
        const summaries: string[] = [];
        const testsList: any[] = [];

        dayLogs.forEach(log => {
          if (log.biomarkers[targetKey] !== undefined && log.biomarkers[targetKey] !== null && log.biomarkers[targetKey] !== '') {
            values.push(log.biomarkers[targetKey]);
          }
          sourceKeys.forEach(k => {
            if (log.biomarkers[k] !== undefined && log.biomarkers[k] !== null && log.biomarkers[k] !== '') {
              values.push(log.biomarkers[k]);
            }
          });

          if (log.note) notes.push(log.note);
          if (log.summary) summaries.push(log.summary);
          if (log.tests && Array.isArray(log.tests)) {
            testsList.push(...log.tests);
          }
        });

        let finalValue: number | string | undefined = undefined;
        if (values.length > 0) {
          const numericValues = values.map(v => Number(v)).filter(n => !isNaN(n));
          if (numericValues.length === values.length && numericValues.length > 0) {
            const sum = numericValues.reduce((a, b) => a + b, 0);
            finalValue = Number((sum / numericValues.length).toFixed(2));
          } else {
            finalValue = values[0];
          }
        }

        const uniqueNotes = Array.from(new Set(notes.map(n => n.trim()).filter(Boolean)));
        const uniqueSummaries = Array.from(new Set(summaries.map(s => s.trim()).filter(Boolean)));

        const combinedNote = uniqueNotes.join(' | ');
        const combinedSummary = uniqueSummaries.join(' | ');

        const primaryLog = dayLogs[0];
        primaryLog.biomarkers[targetKey] = finalValue !== undefined ? finalValue : primaryLog.biomarkers[targetKey];
        if (combinedNote) primaryLog.note = combinedNote;
        if (combinedSummary) primaryLog.summary = combinedSummary;
        if (testsList.length > 0) {
          primaryLog.tests = testsList;
        }

        dayLogs.forEach(log => {
          sourceKeys.forEach(k => {
            delete log.biomarkers[k];
          });
        });
      });

      sourceKeys.forEach(k => {
        delete updatedCustomBiomarkers[k];
      });
    });

    updatedHistory = updatedHistory.filter(h => Object.keys(h.biomarkers).length > 0);
    updatedHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });

    const updatedProfile: UserProfile = {
      ...profile,
      customBiomarkers: updatedCustomBiomarkers
    };

    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);

// Sync deferred to manual button click
    const changedLogIds = updatedHistory.map(l => l.id);
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLogsBatch', targetIds: changedLogIds });
  };
  const handleApplyCalculation = async (updates: {
    targetCalories?: number;
    targetWeight?: number;
    addedBenefit?: string;
    descriptionExplain?: string;
  }) => {
    let updatedBenefits = [...dailyBenefits];
    if (updates.addedBenefit) {
      const exists = updatedBenefits.some(b => {
        const actName = b.activity || (b as any).label || '';
        return actName.toLowerCase() === updates.addedBenefit!.toLowerCase() || b.id === 'walking_30';
      });
      if (!exists) {
        updatedBenefits.push({
          id: 'walking_30',
          activity: updates.addedBenefit,
          target: '30 min',
          completed: false
        });
        setDailyBenefits(updatedBenefits);
      }
    }
    let updatedReport = report ? { ...report } : getLocalFallbackReport(profile);
    if (updates.targetCalories && updatedReport) {
      updatedReport = {
        ...updatedReport,
        dailyNutrientTargets: {
          ...updatedReport.dailyNutrientTargets,
          calories: `${updates.targetCalories} kcal`
        }
      };
      setReport(updatedReport);
    }
    let updatedHistory = [...biomarkerHistory];
    const latestBmiLogIndex = updatedHistory.findIndex(h => h.biomarkers.bmi !== undefined);
    if (latestBmiLogIndex >= 0 && updates.descriptionExplain) {
      updatedHistory[latestBmiLogIndex] = {
        ...updatedHistory[latestBmiLogIndex],
        note: updates.descriptionExplain
      };
      setBiomarkerHistory(updatedHistory);
      // Quickly save this log since multi-sync skips collections
      saveAndSync(profile, foodLogs, biomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLog', targetId: updatedHistory[latestBmiLogIndex].id }).catch(console.error);
    }
    let updatedProfile = { ...profile };
    const isAsian = isAsianEthnicity(updatedProfile.ethnicity);
    const gender = (updatedProfile.gender || 'male').toLowerCase();
    const isMale = gender.startsWith('m');
    const targetBmi = isAsian ? 21.0 : (isMale ? 22.5 : 21.7);
    const targetRange = isAsian ? '18.5 - 22.9' : '18.5 - 24.9';
    const targetWeight = updates.targetWeight || Math.round(targetBmi * Math.pow((updatedProfile.height || 170) / 100, 2) * 10) / 10;
    if (targetWeight) {
      if (!updatedProfile.customBiomarkers) {
        updatedProfile.customBiomarkers = {};
      }
      if (!updatedProfile.customBiomarkers.bmi) {
        updatedProfile.customBiomarkers.bmi = {
          name: 'Body Mass Index (BMI)',
          unit: 'kg/m²',
          normalRange: targetRange,
          description: 'A measure of body fat based on height and weight.',
          benefitRisk: ''
        };
      } else {
        updatedProfile.customBiomarkers.bmi = {
          ...updatedProfile.customBiomarkers.bmi,
          normalRange: targetRange,
          description: 'A measure of body fat based on height and weight.'
        };
      }
      setProfile(updatedProfile);
    }
    await saveAndSync(updatedProfile, foodLogs, biomarkers, updatedHistory, actions, updatedBenefits, updatedReport);
  };
  // Accept and apply recommendations to active dashboard targets
  const handleAcceptReport = async (acceptedReport: RecommendationReport) => {
    setReport(acceptedReport);
    setActions(acceptedReport.actions);
    setDailyBenefits(acceptedReport.dailyBenefits);
    setDraftReport(null);
    
    // Quick, clean targeted sync to database
    await saveAndSync(
      profile,
      foodLogs,
      biomarkers,
      biomarkerHistory,
      acceptedReport.actions,
      acceptedReport.dailyBenefits,
      acceptedReport,
      { type: 'report' }
    );
    
    // Auto-navigate to dashboard for glorious preview of newly updated targets
    setActiveTab('home');
  };
  const handleRejectReport = () => {
    setDraftReport(null);
  };
  // Run On-demand Insights Totality analysis with LLM Selection
  const handleGenerateReport = async (modelId: string, refinement?: { message: string, chatHistory: any[] }) => {
    setIsGenerating(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 18000); // 18-second robust timeout
    try {
      const response = await fetch('/api/gemini/insight-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userProfile: profile,
          foodLogs,
          biomarkerHistory,
          engine: modelId,
          refinement
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      const resData = await response.json();
      if (resData.error) throw new Error(resData.error);
      if (resData.report) {
        setDraftReport(resData.report);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      console.error("Analysis generation error/timeout:", err);
      if (err.name === 'AbortError') {
        alert('Server took longer than expected to complete profiling. Activating specialized local preventative engine fallback.');
        const fallback = getLocalFallbackReport(profile);
        setDraftReport(fallback);
      } else {
        alert(`Failed to complete analysis: ${err.message || 'Server timeout. Activating high-fidelity fallback.'}`);
        const fallback = getLocalFallbackReport(profile);
        setDraftReport(fallback);
      }
    } finally {
      setIsGenerating(false);
    }
  };
  // Lock body scroll when modals are open
  useEffect(() => {
    if (isFoodChatOpen || isMedicalChatOpen || isManualFoodLogOpen || isConflictModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isFoodChatOpen, isMedicalChatOpen, isManualFoodLogOpen, isConflictModalOpen]);

  // Render Screens based on active tab
  if (isAuthChecking) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader className="w-8 h-8 text-indigo-600 animate-spin" />
          <p className="text-xs font-semibold text-slate-500 animate-pulse">Checking your health portal...</p>
        </div>
      </div>
    );
  }
  if (!profile) {
    return <AuthScreen onLogin={handleLogin} />;
  }
  // Floating Action Button (FAB) rules:
  // - Home, Food, Trends tabs show '+' for adding food log.
  // - Medical, Insights tabs show 'Medical icon' for adding medical records chat logs.
  const isMedicalTabFAB = ['medical', 'insights'].includes(activeTab);
  return (
    <div className="h-[100dvh] overflow-hidden bg-slate-50 dark:bg-slate-950 flex flex-col transition-colors duration-200">
      <style dangerouslySetInnerHTML={{ __html: getDynamicStyles(profile) }} />
      
      {/* Header Profile Section */}
      <Header
        profile={profile}
        setProfile={(p) => {
          setProfile(p);
          const bundle = {
            profile: p,
            foodLogs,
            biomarkers,
            biomarkerHistory,
            actions,
            dailyBenefits,
            report
          };
          safeSaveToLocalStorage(getStorageKey(p?.email || profile?.email || auth.currentUser?.email), bundle);
        }}
        onSaveProfile={async (p) => {
          const updatedProfile = { ...p };
          const { updatedHistory, updatedBiomarkers, changed } = logBmiIfProfileWeightHeightChanged(profile, updatedProfile, biomarkerHistory, biomarkers);
          setProfile(updatedProfile);
          if (changed) {
            setBiomarkerHistory(updatedHistory);
            setBiomarkers(updatedBiomarkers);
            await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
          } else {
            await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
          }
        }}
        hideSensitive={hideSensitive}
        setHideSensitive={setHideSensitive}
        syncState={syncState}
        onSignOut={handleSignOut}
        onCloudSync={() => checkForDbChanges(undefined, true)}
        onForcePush={() => saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'fullPush', cloudFoods: [], cloudBioHistory: [] } as any)}
        onForcePull={() => checkForDbChanges(undefined, true, true)}
        dbInteractions={dbInteractions}
        quota={quota}
        foodLogs={foodLogs}
        activeTab={activeTab}
      />
      {isFirestoreQuotaExceeded && (
        <div className="bg-amber-500 text-white py-2 px-4 shadow-md transition-all duration-300 relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-3 text-center md:text-left z-20 border-b border-amber-600/20">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-1.5 rounded-lg shrink-0">
              <CloudLightning className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-xs font-bold leading-normal text-left">
                Cloud Sync Limit Exceeded (Offline Mode Active)
              </p>
              <p className="text-[10px] text-white/90 text-left">
                You reached your daily free Firestore write limit. Don't worry! Your clinical data, logs, and preferences are fully saved locally in your browser.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                // Clear the mock/quota flag and retry sync
                localStorage.removeItem('firestore_quota_exceeded');
                setIsFirestoreQuotaExceeded(false);
                setSyncState('syncing');
                await checkForDbChanges(undefined, true);
              }}
              className="px-3 py-1 bg-white hover:bg-slate-100 text-amber-700 font-bold text-[10px] rounded-lg transition-all shadow-sm shrink-0 cursor-pointer"
            >
              Retry Sync
            </button>
            <button
              onClick={() => {
                setIsFirestoreQuotaExceeded(false);
              }}
              className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white font-bold text-[10px] rounded-lg transition-all shrink-0 cursor-pointer"
              title="Dismiss warning bar"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {syncState === 'conflict' && conflictData && (
        <div className="bg-indigo-600 text-white py-2 px-4 shadow-md transition-all duration-300 relative overflow-hidden flex flex-col md:flex-row items-center justify-between gap-3 text-center md:text-left z-20 border-b border-indigo-700/30">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 p-1.5 rounded-lg shrink-0">
              <RefreshCw className="w-4 h-4 text-white animate-spin" />
            </div>
            <div>
              <p className="text-xs font-bold leading-normal text-left">
                Data Out of Sync / Conflict Detected
              </p>
              <p className="text-[10px] text-white/90 text-left">
                Your local device data and cloud database have both been modified separately. Click "Resolve Conflict" to choose which data to keep.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setIsConflictModalOpen(true);
              }}
              className="px-3 py-1 bg-white hover:bg-slate-100 text-indigo-700 font-bold text-[10px] rounded-lg transition-all shadow-sm shrink-0 cursor-pointer"
            >
              Resolve Conflict
            </button>
          </div>
        </div>
      )}
      <ConflictResolutionModal
        isOpen={isConflictModalOpen}
        onClose={() => setIsConflictModalOpen(false)}
        conflictData={conflictData}
        onResolve={handleResolveConflict}
      />
      {/* Main Viewport Container */}
      <main className="flex-1 overflow-y-auto overflow-x-hidden" id="main-scroll-container">
        {activeTab === 'home' && (
          <HomeTab
            profile={profile}
            foodLogs={foodLogs}
            biomarkers={biomarkers}
            biomarkerHistory={biomarkerHistory}
            actions={actions}
            setActions={async (act) => {
              setActions(act);
              await saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, act, dailyBenefits, report, { type: 'actions' });
            }}
            dailyBenefits={dailyBenefits}
            setDailyBenefits={async (ben) => {
              setDailyBenefits(ben);
              await saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, actions, ben, report, { type: 'dailyBenefits' });
            }}
            foodIdeas={foodIdeas}
            setFoodIdeas={async (ideas) => {
              setFoodIdeas(ideas);
              await saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodIdeas' }, ideas);
            }}
            report={report}
            onNavigateToTab={setActiveTab}
            onEditBiomarkerLog={handleEditBiomarkerLog}
            onDeleteBiomarkerLog={handleDeleteBiomarkerLog}
            onDeleteBiomarkerFromLog={handleDeleteBiomarkerFromLog}
            onLogMedical={handleLogMedical}
            onOpenAgentChat={(agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5', options?: { prefillMessage?: string }) => {
              setActiveAgentType(agentType);
              setPrefillMessage(options?.prefillMessage || null);
              setIsMedicalChatOpen(true);
            }}
            hideSensitive={hideSensitive}
            selectedModelId={selectedModelId}
            onChangeModelId={setSelectedModelId}
            hasBmiAlert={profile ? hasBmiPendingAlert(profile, dismissedBmiAlerts, report) : false}
            onDismissBmiAlert={handleDismissBmiAlert}
            onApplyCalculation={handleApplyCalculation}
            onUpdateReport={async (updatedReport) => {
              setReport(updatedReport);
              await saveAndSync(profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, updatedReport, { type: 'report' });
            }}
          />
        )}
        {activeTab === 'insights' && (
          <InsightsTab
            profile={profile}
            foodLogs={foodLogs}
            biomarkers={biomarkers}
            biomarkerHistory={biomarkerHistory}
            onDeleteBiomarker={handleDeleteBiomarker}
            onDeleteMultipleBiomarkers={handleDeleteMultipleBiomarkers}
            calibratingBatchIdx={calibratingBatchIdx}
            calibratingAgentType={calibratingAgentType}
            report={report}
            draftReport={draftReport}
            onAcceptReport={handleAcceptReport}
            onRejectReport={handleRejectReport}
            selectedModelId={selectedModelId}
            onChangeModelId={setSelectedModelId}
            onGenerateReport={handleGenerateReport}
            isGenerating={isGenerating}
            onNavigateToTab={setActiveTab}
                        onOpenMedicalChat={() => setIsMedicalChatOpen(true)}
            onUpdateProfile={async (updatedProfile) => {
              setProfile(updatedProfile);
              await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report);
            }}
            onUpdateHistory={async (updatedHistory, newBiomarkers, updatedProfileArg) => {
              setBiomarkerHistory(updatedHistory);
              setBiomarkers(newBiomarkers);
              if (updatedProfileArg) setProfile(updatedProfileArg);
              
              // Diff history to find what changed to save writes
              const changedLogs = updatedHistory.filter(newLog => {
                const oldLog = biomarkerHistory.find(old => old.id === newLog.id);
                if (!oldLog) return true; // new log
                return JSON.stringify(oldLog) !== JSON.stringify(newLog); // changed log
              });
              
// Sync deferred to manual button click
              
              await saveAndSync(updatedProfileArg || profile, foodLogs, newBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
            }}
            batchSize={batchSize}
            onChangeBatchSize={(size) => {
              setBatchSize(size);
              try {
                localStorage.setItem('biomarker_batch_size', size.toString());
              } catch (e) {}
            }}
            onOpenAgentChat={(agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'agent6' | 'agent7' | 'data_review', options?: { prefillMessage?: string; dataReviewBatchIdx?: number | string; dataReviewBatchKeys?: string[] }) => {
              setActiveAgentType(agentType);
              setPrefillMessage(options?.prefillMessage || null);
              setActiveDataReviewBatchIdx(options?.dataReviewBatchIdx !== undefined ? options.dataReviewBatchIdx : null);
              setActiveDataReviewBatchKeys(options?.dataReviewBatchKeys || []);
              setIsMedicalChatOpen(true);
            }}
            onDeleteAnalysis={handleDeleteAnalysis}
            onArchiveAnalysis={async (id) => {
              if (profile.agentAnalyses) {
                const updatedProfile = {
                  ...profile,
                  agentAnalyses: profile.agentAnalyses.map(a => a.id === id ? { ...a, archived: true } : a)
                };
                setProfile(updatedProfile);
                await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'analysis', targetId: id });
              }
            }}
            onAgentAnalysisSaved={handleAgentAnalysisSaved}
          />
        )}
        {activeTab === 'food' && (
          <FoodHistoryTab
            profile={profile}
            foodLogs={foodLogs}
            onUpdateFoodLog={handleUpdateFoodLog}
            onDeleteFoodLog={handleDeleteFoodLog}
            onLogFood={handleLogFood}
            onEditingActiveChange={setIsEditingFoodLog}
            isManualEntryOpen={isManualFoodLogOpen}
            onManualEntryOpenChange={setIsManualFoodLogOpen}
            manualEntryAlert={manualFoodLogError}
            onClearManualEntryAlert={() => setManualFoodLogError(null)}
            report={report}
            initiallyExpandedFoodId={initiallyExpandedFoodId}
            onClearInitiallyExpandedFoodId={() => setInitiallyExpandedFoodId(null)}
          />
        )}
        {activeTab === 'medical' && (
          <MedicalHistoryTab
            profile={profile}
            biomarkers={biomarkers}
            biomarkerHistory={biomarkerHistory}
            hideSensitive={hideSensitive}
            onDeleteEmptyBiomarkers={handleDeleteEmptyBiomarkers}
            onUpdateProfile={async (updates) => {
              const updatedProfile = { ...profile, ...updates };
              setProfile(updatedProfile);
              await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'profile' });
            }}
            onEditBiomarkerLog={handleEditBiomarkerLog}
            onLogMedical={handleLogMedical}
            onDeleteBiomarker={handleDeleteBiomarker}
            onDeleteMultipleBiomarkers={handleDeleteMultipleBiomarkers}
            onDeleteBiomarkerLog={handleDeleteBiomarkerLog}
            onDeleteBiomarkerFromLog={handleDeleteBiomarkerFromLog}
            onStandardizeUnits={handleStandardizeBiomarkerUnits}
            onCombineBiomarkers={handleCombineBiomarkers}
            onBatchCombineBiomarkers={handleBatchCombineBiomarkers}
            onBatchConsolidate={handleBatchConsolidate}
            onReviewWithAgent={(keys) => {
              const userIdentifier = profile?.email?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'guest';
              localStorage.setItem(`agent1_custom_batch_keys_${userIdentifier}`, JSON.stringify(keys));
              sessionStorage.setItem('auto_open_custom_batch_modal', 'true');
              setActiveTab('insights');
            }}
            onApplyCalculation={handleApplyCalculation}
            selectedModelId={selectedModelId}
            onChangeModelId={setSelectedModelId}
            hasBmiAlert={profile ? hasBmiPendingAlert(profile, dismissedBmiAlerts, report) : false}
            onDismissBmiAlert={handleDismissBmiAlert}
            onAgentAnalysisSaved={handleAgentAnalysisSaved}
            onDeleteAnalysis={handleDeleteAnalysis}
          />
        )}
        {activeTab === 'trends' && (
          <TrendsTab
            profile={profile}
            foodLogs={foodLogs}
            biomarkerHistory={biomarkerHistory}
            hideSensitive={hideSensitive}
            report={report}
            onSelectFood={(id) => {
              setInitiallyExpandedFoodId(id);
              setActiveTab('food');
            }}
          />
        )}
      </main>
      {/* Floating Action Button (FAB) Dock */}
      {!isEditingFoodLog && (
        <div className="fixed bottom-24 right-5 z-40">
          {isMedicalTabFAB ? (
            <button
              id="fab-medical-btn"
              onClick={() => setIsMedicalChatOpen(true)}
              className="w-14 h-14 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-xl hover:bg-indigo-700 hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-4 focus:ring-indigo-500/20"
              title="Scan Blood Report / Log Medical Biomarkers"
            >
              <Stethoscope className="w-6 h-6 stroke-[2.5px]" />
            </button>
          ) : (
            <button
              id="fab-food-btn"
              onClick={() => setIsFoodChatOpen(true)}
              className="w-14 h-14 bg-indigo-600 text-white rounded-full flex items-center justify-center shadow-xl hover:bg-indigo-700 hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-4 focus:ring-indigo-500/20"
              title="Log Meal consumed"
            >
              <Plus className="w-6 h-6 stroke-[2.5px]" />
            </button>
          )}
        </div>
      )}
      {/* Bottom Material Tab Bar (Icons only) */}
      <BottomNav activeTab={activeTab} setActiveTab={setActiveTab} />
      {/* Slide-over interactive dialogs */}
      <ErrorBoundary><LogChat type="food"
        profile={profile}
        isOpen={isFoodChatOpen}
        selectedModelId={selectedModelId}
        onChangeModelId={setSelectedModelId}
        onClose={() => setIsFoodChatOpen(false)}
        onLogFood={handleLogFood}
        biomarkers={biomarkers}
        biomarkerHistory={biomarkerHistory}
        foodLogs={foodLogs}
        report={report}
        onGoToManualEdit={(errorMsg) => {
          setIsFoodChatOpen(false);
          setActiveTab('food');
          if (errorMsg) {
            setManualFoodLogError(errorMsg);
          }
          setIsManualFoodLogOpen(true);
        }}
      /></ErrorBoundary>
      <ErrorBoundary><LogChat key={`medical_${activeAgentType || 'general'}`}
        type="medical"
        profile={profile}
        isOpen={isMedicalChatOpen}
        selectedModelId={selectedModelId}
        onChangeModelId={setSelectedModelId}
        onClose={() => {
          setIsMedicalChatOpen(false);
          setActiveAgentType(null);
          setPrefillMessage(null);
          setActiveDataReviewBatchIdx(null);
        }}
        autoSendMessage={prefillMessage}
        onLogMedical={handleLogMedical}
        biomarkers={biomarkers}
        biomarkerHistory={biomarkerHistory}
        foodLogs={foodLogs}
        report={report}
        agentType={activeAgentType}
        dataReviewBatchIdx={activeDataReviewBatchIdx}
        dataReviewBatchKeys={activeDataReviewBatchKeys}
        batchSize={batchSize}
        onAgentAnalysisSaved={async (agentType, agentResult) => {
          const newId = `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          const updatedAnalyses = profile.agentAnalyses ? [...profile.agentAnalyses] : [];
          updatedAnalyses.push({
            id: newId,
            agentType: agentType,
            date: new Date().toISOString(),
            result: agentResult
          });
          const updatedProfile = { 
            ...profile,
            agentAnalyses: updatedAnalyses
          };
          setProfile(updatedProfile);
          await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'analysis', targetId: newId });
        }}
        onAgentFinish={async (agentType, agentResult) => {
          // ─── SNAPSHOT BEFORE ANY CHANGE (FIX-8) ──────────────────────────
          const snapLabel = `Before ${agentType} approval (${new Date().toLocaleTimeString()})`;
          saveLocalSnapshot(snapLabel, profile?.email, {
            profile,
            foodLogs,
            biomarkers,
            biomarkerHistory,
            actions,
            dailyBenefits,
            report
          });
          if (profile?.email) {
            setSnapshots(loadLocalSnapshots(profile.email));
          }
          setLastSnapshotLabel(snapLabel);
          // ───────────────────────────────────────────────────────────────
          setIsMedicalChatOpen(false);
          setCalibratingAgentType(agentType);
          const updatedProfile = { ...profile };
          
          let currentHistory = [...biomarkerHistory];
          if (agentType === 'agent1') {
            const batchIdx = agentResult.batchIdx !== undefined && agentResult.batchIdx !== null 
              ? agentResult.batchIdx 
              : activeDataReviewBatchIdx;
            if (batchIdx !== undefined && batchIdx !== null) {
              // This is the batch-by-batch Data Cleaning!
              // Store the raw YAML/JSON returned under agent1_batch_results
              const savedResults = localStorage.getItem('agent1_batch_results');
              let results: any = {};
              try {
                if (savedResults) results = JSON.parse(savedResults);
              } catch (e) {}
              
              const minimalResult = { ...agentResult };
              delete minimalResult.agentPrompt;
              results[batchIdx] = minimalResult;
              try { localStorage.setItem('agent1_batch_results', JSON.stringify(results)); } catch(e){ console.warn("Quota exceeded agent1"); }

              // AUTOMATICALLY APPROVE THE BATCH NOW TO PREVENT DOUBLE CLICK!
              // Parse the cleaned YAML
              const yamlText = agentResult.extractedYaml || agentResult;
              let parsedRows: any[] = [];
              if (typeof yamlText === 'string' && yamlText.trim() !== '') {
                try {
                  const cleanText = yamlText.replace(/```(?:yaml|json)?/gi, '').trim();
                  const parsed = parse(cleanText);
                  parsedRows = Array.isArray(parsed) ? parsed : (parsed?.biomarkers || []);
                } catch (e) {
                  console.error("Failed to parse approved agent1 YAML", e);
                }
              } else if (Array.isArray(yamlText)) {
                parsedRows = yamlText;
              }
              const unselected = agentResult.unselectedRowKeys || [];
              if (unselected.length > 0) {
                 parsedRows = parsedRows.filter(row => {
                   const key = String(row.biomarker || row.name || row.key || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                   return !unselected.includes(key);
                 });
              }

              // Save customBiomarkers to user profile and history
              const updatedCustoms = { ...(updatedProfile.customBiomarkers || {}) };
              let hHistory = biomarkerHistory ? biomarkerHistory.map((h: any) => ({
                ...h,
                biomarkers: { ...h.biomarkers }
              })) : [];

              const deletedKeysToSync: string[] = [];
              // 1. Identify which unstandardized raw keys were mapped to what standardized keys and migrate/delete
              if (agentResult?.batchBiomarkers && Array.isArray(agentResult.batchBiomarkers)) {
                agentResult.batchBiomarkers.forEach((raw: any) => {
                  const rawKey = raw.key;
                  if (!rawKey) return;

                  // Find best matched parsed row in the parsedRows output
                  let bestParsedIdx = -1;
                  let bestScore = -1;
                  parsedRows.forEach((parsed: any, idx: number) => {
                    if (parsed.originalName) {
                      const cleanRawName = raw.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                      const cleanParsedOrigName = parsed.originalName.toLowerCase().replace(/[^a-z0-9]/g, '');
                      if (cleanRawName === cleanParsedOrigName || parsed.originalName === raw.name) {
                        bestParsedIdx = idx;
                      }
                    }
                    if (parsed.originalName) {
                      const cleanRawName = raw.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                      const cleanParsedOrigName = parsed.originalName.toLowerCase().replace(/[^a-z0-9]/g, '');
                      if (cleanRawName === cleanParsedOrigName || parsed.originalName === raw.name) {
                        bestParsedIdx = idx;
                        return;
                      }
                    }
                    const parsedKey = (parsed.key || parsed.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                    const parsedName = (parsed.name || parsed.biomarker || '').toLowerCase();
                    const explanation = (parsed.explanation || parsed.changeReason || parsed.description || '').toLowerCase();
                    
                    let score = 0;
                    const cleanRawKey = rawKey.toLowerCase().replace(/[^a-z0-9]/g, '');
                    const cleanParsedKey = parsedKey.toLowerCase().replace(/[^a-z0-9]/g, '');
                    
                    if (cleanRawKey === cleanParsedKey) {
                      score += 100;
                    } else if (cleanParsedKey.length >= 4 && cleanRawKey.length >= 4 && (cleanRawKey.includes(cleanParsedKey) || cleanParsedKey.includes(cleanRawKey))) {
                      score += 40;
                    }
                    if (explanation.includes(rawKey.toLowerCase())) {
                      score += 80;
                    }
                    if (score > bestScore && score >= 40) {
                      bestScore = score;
                      bestParsedIdx = idx;
                    }
                  });

                  if (bestParsedIdx !== -1) {
                    const parsedRow = parsedRows[bestParsedIdx];
                    const stdKey = (parsedRow.standardizedName || parsedRow.key || parsedRow.name || parsedRow.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                    const action = String(parsedRow.Action || parsedRow.action || '').toLowerCase();
                    
                    if (action.includes('delete')) {
                      hHistory.forEach((log: any) => {
                        if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                          delete log.biomarkers[rawKey];
                        }
                      });
                      delete updatedCustoms[rawKey];
                      deletedKeysToSync.push(rawKey);
                    } else if (stdKey && rawKey !== stdKey) {
                      // Migrate existing values from rawKey to stdKey across all historical logs, then delete rawKey
                      hHistory.forEach((log: any) => {
                        if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                          const valueToMigrate = log.biomarkers[rawKey];
                          log.biomarkers[stdKey] = valueToMigrate;
                          delete log.biomarkers[rawKey];
                        }
                      });

                      // Delete from customBiomarkers list
                      delete updatedCustoms[rawKey];
                      deletedKeysToSync.push(rawKey);
                    }
                  } else {
                    // No confident match found — leave this key untouched (FIX-7B).
                    // Do NOT delete data that wasn't explicitly handled in this batch's output.
                    console.log(`[Agent Approval] No confident match for raw key "${rawKey}" — skipping deletion.`);
                  }
                });
              }

              // 2. Apply newly cleaned/standardized readings from parsedRows
              parsedRows.forEach((row: any) => {
                const key = row.key || (row.name || row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
                if (!key) return;

                const name = row.name || row.biomarker || 'Unknown';
                const unit = row.metric || row.unit || '';

                // Update customBiomarker definition
                const existing: any = updatedCustoms[key] || {};
                updatedCustoms[key] = {
                  ...existing,
                  name,
                  unit,
                  riskCategories: (existing.riskCategories && existing.riskCategories.length > 0) ? existing.riskCategories : (row.riskCategories || []),
                  standardMedicalGrouping: (existing.standardMedicalGrouping && existing.standardMedicalGrouping !== 'Other') ? existing.standardMedicalGrouping : (row.standardMedicalGrouping || 'Other'),
                  potentialMedicalConditions: row.potentialMedicalConditions || existing.potentialMedicalConditions || []
                } as any;
              });

              hHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

              // Recompute biomarkers list
              const recomputedBiomarkers: { [key: string]: number | string } = {};
              [...hHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
                Object.entries(log.biomarkers).forEach(([k, v]) => {
                  recomputedBiomarkers[k] = v as string | number;
                });
              });
              
              if (deletedKeysToSync.length > 0) {
                updatedProfile.deletedCustomBiomarkerKeys = [
                  ...(updatedProfile.deletedCustomBiomarkerKeys || []),
                  ...deletedKeysToSync
                ];
              }

              updatedProfile.customBiomarkers = updatedCustoms;
              currentHistory = hHistory;

              // Mark as approved in localStorage
              const savedApproved = localStorage.getItem('approved_agent1_batches');
              let approved: any = {};
              try {
                if (savedApproved) approved = JSON.parse(savedApproved);
              } catch (e) {}
              approved[batchIdx] = true;
              try { localStorage.setItem('approved_agent1_batches', JSON.stringify(approved)); } catch(e){ console.warn("Quota exceeded approved_agent1"); }

              // Update React States
              setBiomarkers(recomputedBiomarkers);
            } else {
              updatedProfile.agentTriageSummary = "Data extraction completed.";
              
              // Parse extractedYaml and merge into biomarkerHistory
              const yamlText = agentResult.extractedYaml || agentResult;
              if (typeof yamlText === 'string') {
                const entries: any[] = [];
                try {
                  const cleanedText = yamlText.replace(/```(?:yaml|yml)?/gi, '').trim();
                  const parsed = parse(cleanedText);
                  const rawList = Array.isArray(parsed) 
                    ? parsed 
                    : (parsed?.biomarkers || parsed?.entries || parsed?.data || []);
                  if (Array.isArray(rawList)) {
                    rawList.forEach((item: any) => {
                      if (item && typeof item === 'object') {
                        const bName = item.biomarker || item.name || item.key;
                        const bDate = item.date || item.timestamp;
                        const bVal = item.value !== undefined ? item.value : item.val;
                        if (bName && bDate) {
                          entries.push({
                            biomarker: String(bName),
                            date: String(bDate),
                            value: isNaN(Number(bVal)) ? bVal : parseFloat(String(bVal)),
                            unit: item.unit ? String(item.unit) : '',
                            referenceRange: item.referenceRange || item.range || ''
                          });
                        }
                      }
                    });
                  }
                } catch (e) {
                  console.warn("Standard YAML parser in App.tsx failed, falling back to regex", e);
                }

                if (entries.length === 0) {
                  const lines = yamlText.split('\n');
                  let currentEntry: any = {};
                  
                  for (let line of lines) {
                    line = line.trim();
                    if (line.startsWith('-') || line.startsWith('biomarker:')) {
                      if (currentEntry.biomarker) entries.push(currentEntry);
                      currentEntry = {};
                    }
                    const bioMatch = line.match(/(?:-\s+)?biomarker:\s*(.*)/i);
                    if (bioMatch) { currentEntry.biomarker = bioMatch[1].replace(/['"]/g, '').trim(); continue; }
                    const dateMatch = line.match(/date:\s*([\d-]+)/i);
                    if (dateMatch) { currentEntry.date = dateMatch[1].trim(); continue; }
                    const valMatch = line.match(/value:\s*(.*)/i);
                    if (valMatch) { 
                      const rawVal = valMatch[1].replace(/['"]/g, '').trim(); 
                      currentEntry.value = isNaN(Number(rawVal)) ? rawVal : parseFloat(rawVal);
                      continue; 
                    }
                    const unitMatch = line.match(/unit:\s*(.*)/i);
                    if (unitMatch) { currentEntry.unit = unitMatch[1].replace(/['"]/g, '').trim(); continue; }
                    const refMatch = line.match(/referenceRange:\s*(.*)/i);
                    if (refMatch) { currentEntry.referenceRange = refMatch[1].replace(/['"]/g, '').trim(); continue; }
                  }
                  if (currentEntry.biomarker) entries.push(currentEntry);
                }
                
                entries.forEach(entry => {
                  const bioName = entry.biomarker.toLowerCase().replace(/[^a-z0-9]/g, '_');
                  let finalValue = entry.value;
                  let finalUnit = (entry.unit || '').replace(/µ/g, 'u');
                  let finalRange = (entry.referenceRange || '').replace(/µ/g, 'u');

                  // No math middleware: raw values only

                  let existingLogIndex = currentHistory.findIndex(h => h.date === entry.date);
                  if (existingLogIndex >= 0) {
                    currentHistory[existingLogIndex].biomarkers[bioName] = finalValue;
                  } else {
                    currentHistory.push({
                      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                      date: entry.date,
                      biomarkers: { [bioName]: finalValue },
                      note: "Extracted by Clinical Data Parser"
                    });
                  }
                  
                  if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};
                  if (!updatedProfile.customBiomarkers[bioName]) {
                    updatedProfile.customBiomarkers[bioName] = {
                      name: entry.biomarker,
                      unit: finalUnit,
                      normalRange: finalRange || 'Unknown',
                      description: ''
                    };
                  } else {
                    if (finalUnit && !updatedProfile.customBiomarkers[bioName].unit) {
                      updatedProfile.customBiomarkers[bioName].unit = finalUnit;
                    }
                    if (finalRange && (!updatedProfile.customBiomarkers[bioName].normalRange || updatedProfile.customBiomarkers[bioName].normalRange === 'Unknown')) {
                      updatedProfile.customBiomarkers[bioName].normalRange = finalRange;
                    }
                  }
                });
                
                currentHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
                setBiomarkerHistory(currentHistory);
                
                const recomputedBiomarkers: { [key: string]: number | string } = {};
                [...currentHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
                  Object.entries(log.biomarkers).forEach(([k, v]) => {
                    recomputedBiomarkers[k] = v as string | number;
                  });
                });
                setBiomarkers(recomputedBiomarkers);
              }
            }
          } else if (agentType === 'agent2') {
             // Agent 2: Clinical Ontologist (Mapping)
             updatedProfile.agentTriageSummary = "Biomarker categories mapped.";
             const mapping = agentResult.bucketMapping || agentResult;
             if (mapping && typeof mapping === 'object') {
               if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};
               Object.entries(mapping).forEach(([bioName, mapData]: [string, any]) => {
                 const key = bioName.toLowerCase().replace(/[^a-z0-9]/g, '_');
                 const existingDef = updatedProfile.customBiomarkers![key] || {
                   name: bioName, unit: '', normalRange: 'Unknown', description: ''
                 };
                 updatedProfile.customBiomarkers![key] = {
                   ...existingDef,
                   riskCategories: mapData.riskCategories || existingDef.riskCategories,
                   standardMedicalGrouping: mapData.standardMedicalGrouping || existingDef.standardMedicalGrouping,
                   potentialMedicalConditions: mapData.potentialMedicalConditions || existingDef.potentialMedicalConditions
                 };
               });
             }
          } else if (agentType === 'agent3') {
             // Agent 3: Clinical Data Coordinator (Assembly)
             updatedProfile.agentTriageSummary = agentResult.text || "Data assembled into buckets.";
          } else if (agentType === 'agent4') {
            updatedProfile.agentDiagnosticSummary = agentResult.primaryDiagnosis;
            updatedProfile.agent2TimelineProjections = agentResult.timelineProjections;
            updatedProfile.agent2GapTasks = agentResult.recommendedTests?.map((t: any) => `${t.testName}: ${t.reason}`);
          } else if (agentType === 'agent5') {
            updatedProfile.agentContextualizerSummary = agentResult.message;
          } else if (agentType === 'agent6') {
            updatedProfile.agentInterventionSummary = agentResult.message;
            updatedProfile.agent4Projections = agentResult.projections;
          } else if (agentType === 'agent7') {
            updatedProfile.agentLiteratureSummary = agentResult.message;
          } else if (agentType === 'data_review') {
            const batchIdx = agentResult.batchIdx !== undefined && agentResult.batchIdx !== null ? agentResult.batchIdx : activeDataReviewBatchIdx;
            if (batchIdx !== undefined && batchIdx !== null) {
              setCalibratingBatchIdx(Number(batchIdx));
            }
            setIsMedicalChatOpen(false);

            const updatedCustoms = { ...(updatedProfile.customBiomarkers || {}) };
            
            if (agentResult.reviewedBiomarkers && Array.isArray(agentResult.reviewedBiomarkers)) {
              agentResult.reviewedBiomarkers.forEach((bm: any) => {
                const existing = updatedCustoms[bm.key] || {};
                updatedCustoms[bm.key] = {
                  ...existing,
                  name: bm.name || existing.name,
                  unit: bm.unit || existing.unit,
                  normalRange: bm.profileAdjustedNormalRange || existing.normalRange || '',
                  description: bm.description || existing.description || '',
                  riskCategories: (existing.riskCategories && existing.riskCategories.length > 0) ? existing.riskCategories : (bm.riskCategories || []),
                  standardMedicalGrouping: (existing.standardMedicalGrouping && existing.standardMedicalGrouping !== 'Other') ? existing.standardMedicalGrouping : (bm.standardMedicalGrouping || 'Other'),
                  potentialMedicalConditions: bm.potentialMedicalConditions || existing.potentialMedicalConditions || [],
                  specificRiskContext: bm.specificRiskContext || existing.specificRiskContext || '',
                  status: bm.status || existing.status || 'Healthy',
                  rangeBrackets: bm.rangeBrackets || existing.rangeBrackets || []
                } as any;
              });
            }
            
            updatedProfile.customBiomarkers = updatedCustoms;
            
            if (batchIdx !== undefined && batchIdx !== null) {
              const saved = localStorage.getItem('approved_data_review_batches');
              let approved: any = {};
              try {
                if (saved) approved = JSON.parse(saved);
              } catch (e) {}
              approved[batchIdx] = true;
              try { localStorage.setItem('approved_data_review_batches', JSON.stringify(approved)); } catch(e){ console.warn("Quota exceeded approved_data"); }
              
              // Also store the analysis result so the InsightsTab can display the result immediately!
              const savedResults = localStorage.getItem('batch_analysis_results');
              let results: any = {};
              try {
                if (savedResults) results = JSON.parse(savedResults);
              } catch (e) {}
              const minimalResult = { ...agentResult };
              delete minimalResult.agentPrompt;
              results[batchIdx] = minimalResult;
              try { localStorage.setItem('batch_analysis_results', JSON.stringify(results)); } catch(e){ console.warn("Quota exceeded batch_analysis"); }

              // Perform missing biomarker movement if any keys are marked to move
              try {
                const keysToMoveSaved = localStorage.getItem(`batch_${batchIdx}_missing_keys_to_move`);
                if (keysToMoveSaved) {
                  const keysToMove: string[] = JSON.parse(keysToMoveSaved);
                  if (Array.isArray(keysToMove) && keysToMove.length > 0) {
                    const batchesSaved = localStorage.getItem('biomarker_batches_custom');
                    if (batchesSaved) {
                      let currentBatches: string[][] = JSON.parse(batchesSaved);
                      const sizeSaved = localStorage.getItem('biomarker_batch_size');
                      const batchSizeNum = sizeSaved ? Number(sizeSaved) : 20;

                      keysToMove.forEach(key => {
                        // Remove from current batch
                        if (currentBatches[batchIdx]) {
                          currentBatches[batchIdx] = currentBatches[batchIdx].filter(k => k !== key);
                        }

                        // Place in first subsequent unapproved/uncalibrated batch with space
                        let placed = false;
                        for (let i = batchIdx + 1; i < currentBatches.length; i++) {
                          if (!approved[i] && !results[i] && currentBatches[i].length < batchSizeNum) {
                            currentBatches[i].push(key);
                            placed = true;
                            break;
                          }
                        }

                        if (!placed) {
                          for (let i = batchIdx + 1; i < currentBatches.length; i++) {
                            if (!approved[i] && !results[i]) {
                              currentBatches[i].push(key);
                              placed = true;
                              break;
                            }
                          }
                        }

                        if (!placed) {
                          currentBatches.push([key]);
                        }
                      });

                      // Clean up empty batches
                      currentBatches = currentBatches.filter((batch, idx) => 
                        batch.length > 0 || idx === 0 || approved[idx] || results[idx]
                      );

                      localStorage.setItem('biomarker_batches_custom', JSON.stringify(currentBatches));
                    }
                  }
                  // Clear the missing keys list for this batch since they are now moved
                  localStorage.removeItem(`batch_${batchIdx}_missing_keys_to_move`);
                }
              } catch (e) {
                console.error("Error moving missing biomarkers on clinical calibration finish:", e);
              }
            }
          }
          
          setProfile(updatedProfile);
          try {
            // Auto-approve the step if it's one of the main agent types
            const latestAnalysis = (updatedProfile.agentAnalyses || [])
              .filter(a => a.agentType === agentType)
              .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))[0];
            
            if (latestAnalysis) {
              try {
                const savedIds = localStorage.getItem('approvedAnalysisIds');
                let approvedIds: any = {};
                if (savedIds) approvedIds = JSON.parse(savedIds);
                approvedIds[agentType] = latestAnalysis.id;
                localStorage.setItem('approvedAnalysisIds', JSON.stringify(approvedIds));
              } catch (e) {
                console.warn("Failed to auto-approve analysis in localStorage", e);
              }
            }

            await saveAndSync(updatedProfile, foodLogs, biomarkers, currentHistory, actions, dailyBenefits, report);
          } finally {
            setCalibratingBatchIdx(null);
            setCalibratingAgentType(null);
            
            const isBatch = agentType === 'data_review';
            if (isBatch) {
              const batchIdx = agentResult?.batchIdx !== undefined && agentResult?.batchIdx !== null 
                ? agentResult.batchIdx 
                : activeDataReviewBatchIdx;
              if (batchIdx !== undefined && batchIdx !== null) {
                setTimeout(() => {
                  const element = document.getElementById(`batch-card-${batchIdx}`);
                  if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }, 150);
              }
            } else {
              const getStepIndexForAgent = (aType: string) => {
                if (aType === 'agent1') return 1;
                if (aType === 'data_review') return 2;
                if (aType === 'agent6') return 3;
                if (aType === 'agent4') return 4;
                if (aType === 'agent7') return 5;
                return -1;
              };
              const stepIdx = getStepIndexForAgent(agentType);
              if (stepIdx !== -1) {
                setTimeout(() => {
                  const element = document.getElementById(`accordion-step-${stepIdx}`);
                  if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }, 150);
              }
            }
          }
        }}
      />

      {/* Undo/Snapshot button — shown when at least one snapshot exists */}
      {snapshots.length > 0 && (
        <button
          onClick={() => setShowSnapshotPanel(true)}
          className="fixed bottom-28 left-4 z-40 flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer"
          title="Restore a previous snapshot"
        >
          <span>↩</span> Undo
        </button>
      )}

      {/* Snapshot/Undo Panel */}
      {showSnapshotPanel && (
        <div className="fixed inset-0 z-[200] flex items-end justify-center bg-black/50" onClick={() => setShowSnapshotPanel(false)}>
          <div className="bg-white dark:bg-slate-900 rounded-t-2xl w-full max-w-lg p-5 pb-8 shadow-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>🕐</span> Restore a Snapshot
              </h2>
              <button onClick={() => setShowSnapshotPanel(false)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
            </div>
            {snapshots.length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-6">No snapshots yet. Snapshots are created automatically before each agent approval.</p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                {snapshots.map((snap: any) => (
                  <div key={snap.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200">{snap.label}</p>
                      <p className="text-[10px] text-slate-400">{new Date(snap.timestamp).toLocaleString()}</p>
                      <p className="text-[10px] text-slate-400 mt-1">
                        {snap.data?.biomarkerHistory?.length ?? 0} biomarker logs · {snap.data?.foodLogs?.length ?? 0} food logs
                      </p>
                    </div>
                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={() => handleRestoreSnapshot(snap)}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        Restore
                      </button>
                      <button
                        onClick={() => {
                          deleteLocalSnapshot(profile?.email, snap.id);
                          setSnapshots(loadLocalSnapshots(profile?.email));
                        }}
                        className="px-3 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/30 text-red-600 dark:text-red-400 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-slate-400 text-center mt-4">Snapshots are stored locally on this device only. Up to 5 are kept.</p>
          </div>
        </div>
      )}

      </ErrorBoundary>
    </div>
  );
}