import React, { useState, useEffect } from 'react';
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
import LogChat from './components/LogChat';
import { translations } from './utils/translations';
import { AVAILABLE_LLMS } from './utils/llm';
import { getLocalFallbackReport } from './utils/fallbackReport';
import { Plus, HeartHandshake, RefreshCw, Sparkles, Stethoscope, Utensils, Loader, CloudLightning } from 'lucide-react';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, getDocs, deleteDoc, getDocFromServer, getDocsFromServer, onSnapshot, getDocsFromCache, writeBatch } from 'firebase/firestore';
import { getCurrentDateInTimezone, normalizeBiomarkerHistory } from './utils/dateUtils';
import { biomarkerDefinitions, isAsianEthnicity, hasBmiPendingAlert, getProfileFingerprint } from './utils/biomarkers';
import { get, set } from 'idb-keyval';
import { parse } from 'yaml';
const getStorageKey = (email?: string | null) => {
  const norm = (email || auth.currentUser?.email || 'guest').toLowerCase().trim();
  return `health_cockpit_app_data_${norm}`;
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
const safeSaveToLocalStorage = async (key: string, bundle: any) => {
  try {
    await set(key, bundle);
  } catch (e) {
    console.error("Failed to save to IndexedDB:", e);
  }
};
export default function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
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
  const [initiallyExpandedFoodId, setInitiallyExpandedFoodId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<'synced' | 'syncing' | 'local'>('local');
  const [isFirestoreQuotaExceeded, setIsFirestoreQuotaExceeded] = useState<boolean>(() => {
    return localStorage.getItem('firestore_quota_exceeded') === 'true';
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
  const [dbInteractions, setDbInteractions] = useState<DbInteraction[]>([]);
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
    return Promise.race([
      Promise.resolve(promise),
      new Promise<void>((resolve) => {
        setTimeout(() => {
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
  const [isMedicalChatOpen, setIsMedicalChatOpen] = useState(false);
  const [activeAgentType, setActiveAgentType] = useState<'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'agent6' | 'agent7' | 'data_review' | null>(null);
  const [activeDataReviewBatchIdx, setActiveDataReviewBatchIdx] = useState<number | string | null>(null);
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
        updatedHistory[todayLogIndex] = log;
      } else {
        const newLog: BiomarkerLog = {
          id: `log_${Date.now()}`,
          date: todayStr,
          biomarkers: { steps: stepsVal },
          note: 'Auto-synced from Google Fit',
          summary: `Synced ${stepsVal} steps from Google Fit`
        };
        updatedHistory.unshift(newLog);
      }

      const recomputedBiomarkers: { [key: string]: number | string } = {};
      [...updatedHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });

      setBiomarkerHistory(updatedHistory);
      setBiomarkers(recomputedBiomarkers);
      if (profile) {
        await saveAndSync(profile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
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
  const checkForDbChanges = async (forceUserId?: string) => {
    const uid = forceUserId || auth.currentUser?.uid;
    if (!uid) {
      setSyncState('local');
      return;
    }
    // Load local storage first so we don't wipe it on page load
    const parsedLocal = await get(getStorageKey()) || {};
    // Snapshot of current local state (from storage or memory) for safe merge
    const currentEmail = auth.currentUser?.email?.toLowerCase().trim() || 'guest';
    const profileEmail = profile?.email?.toLowerCase().trim();
    const isSameUser = profileEmail === currentEmail;

    const localProfile = isSameUser ? (profile || parsedLocal.profile) : parsedLocal.profile;
    const localFoods = isSameUser ? (foodLogs.length > 0 ? [...foodLogs] : (parsedLocal.foodLogs || [])) : (parsedLocal.foodLogs || []);
    const localBioHistory = isSameUser ? (biomarkerHistory.length > 0 ? [...biomarkerHistory] : (parsedLocal.biomarkerHistory || [])) : (parsedLocal.biomarkerHistory || []);
    const localActions = isSameUser ? (actions.length > 0 ? [...actions] : (parsedLocal.actions || [])) : (parsedLocal.actions || []);
    const localBenefits = isSameUser ? (dailyBenefits.length > 0 ? [...dailyBenefits] : (parsedLocal.dailyBenefits || [])) : (parsedLocal.dailyBenefits || []);
    const localReport = isSameUser ? (report || parsedLocal.report) : parsedLocal.report;
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
    if (isFirestoreQuotaExceeded) {
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
      return;
    }
    setSyncState('syncing');
    const syncRootId = logInteraction('sync', `users/${uid} (Full Check)`, null);
    let tProfileId = '';
    let tFoodsId = '';
    let tBioId = '';
    let tActsId = '';
    let tBensId = '';
    let tRepId = '';
    try {
      const userDocRef = doc(db, 'users', uid);
      let userDoc;
      tProfileId = logInteraction('download', `users/${uid} (Profile)`, null);
      try {
        const docResult = await withTimeout(getDocFromServer(userDocRef), 2000, 'getDocFromServer (Profile)');
        if (docResult) {
          userDoc = docResult;
        } else {
          throw new Error("getDocFromServer timed out");
        }
        completeInteraction(tProfileId, true, userDoc.exists() ? JSON.stringify(userDoc.data()).length : 0);
      } catch (err) {
        console.warn("getDocFromServer failed or timed out, falling back to local/cached getDoc:", err);
        const docResult = await withTimeout(getDoc(userDocRef), 2000, 'getDoc (Profile)');
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
        // Optimization: if cloud lastUpdatedAt matches local lastUpdatedAt and we have local data, we skip subcollection reads
        const canSkipFetch = !!(
          localProfile &&
          localProfile.lastUpdatedAt &&
          cloudProfile.lastUpdatedAt &&
          cloudProfile.lastUpdatedAt === localProfile.lastUpdatedAt &&
          parsedLocal.foodLogs &&
          parsedLocal.biomarkerHistory
        );
        if (canSkipFetch) {
          console.log("[Sync] Local data is fully up-to-date with cloud timestamp:", cloudProfile.lastUpdatedAt);
          mergedProfile = cloudProfile;
          if (localProfile?.agentAnalyses) {
            mergedProfile.agentAnalyses = localProfile.agentAnalyses;
          }
          foods = localFoods;
          bioHistory = localBioHistory;
          acts = localActions;
          bens = localBenefits;
          cloudReport = localReport;
        } else {
          tFoodsId = logInteraction('download', `users/${uid}/foodLogs`, null);
          tBioId = logInteraction('download', `users/${uid}/biomarkerHistory`, null);
          tActsId = logInteraction('download', `users/${uid}/actions`, null);
          tBensId = logInteraction('download', `users/${uid}/dailyBenefits`, null);
          tRepId = logInteraction('download', `users/${uid}/reports/latest`, null);
          // By using getDocs and getDoc (not FromServer), Firestore can utilize its local cache if configured,
          // and won't throw if offline, gracefully degrading to cached data.
          try {
            const foodLogsSnap = await getDocs(collection(db, 'users', uid, 'foodLogs'));
            foods = foodLogsSnap.docs.map(d => d.data() as FoodLog);
            completeInteraction(tFoodsId, true, foodLogsSnap.docs.reduce((acc, d) => acc + JSON.stringify(d.data()).length, 0), undefined, foodLogsSnap.size);
          } catch (foodErr: any) {
            console.warn("Failed to fetch foodLogs:", foodErr);
            foods = localFoods; // Fallback to local
            completeInteraction(tFoodsId, false, 0, foodErr.message || String(foodErr));
          }
          // 1. Fetch biomarker history robustly
          try {
            const bioHistorySnap = await getDocs(collection(db, 'users', uid, 'biomarkerHistory'));
            bioHistory = bioHistorySnap.docs.map(d => d.data() as BiomarkerLog);
            completeInteraction(tBioId, true, bioHistorySnap.docs.reduce((acc, d) => acc + JSON.stringify(d.data()).length, 0), undefined, bioHistorySnap.size);
          } catch (bioErr: any) {
            console.warn("Failed to fetch biomarkerHistory:", bioErr);
            bioHistory = localBioHistory; // Fallback to local
            completeInteraction(tBioId, false, 0, bioErr.message || String(bioErr));
          }
          // 2. Fetch dashboard metadata robustly
          try {
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
            acts = localActions;
            bens = localBenefits;
            completeInteraction(tActsId, false, 0, dashErr.message || String(dashErr));
            completeInteraction(tBensId, false, 0, dashErr.message || String(dashErr));
          }
          // 3. Fetch reports robustly
          try {
            const latestReportDoc = await getDoc(doc(db, 'users', uid, 'reports', 'latest'));
            cloudReport = latestReportDoc.exists() ? (latestReportDoc.data() as RecommendationReport) : null;
            completeInteraction(tRepId, true, latestReportDoc.exists() ? JSON.stringify(latestReportDoc.data()).length : 0);
          } catch (repErr: any) {
            console.warn("Failed to fetch reports:", repErr);
            cloudReport = localReport;
            completeInteraction(tRepId, false, 0, repErr.message || String(repErr));
          }
          // 4. Fetch agentAnalyses
          try {
            const analysesSnap = await getDocs(collection(db, 'users', uid, 'agentAnalyses'));
            const analyses = analysesSnap.docs.map(d => d.data());
            if (analyses.length > 0) {
              cloudProfile.agentAnalyses = analyses as any;
            } else if (localProfile?.agentAnalyses) {
              cloudProfile.agentAnalyses = localProfile.agentAnalyses;
            }
          } catch (err) {
            console.warn("Failed to fetch agentAnalyses:", err);
            if (localProfile?.agentAnalyses) {
              cloudProfile.agentAnalyses = localProfile.agentAnalyses;
            }
          }

          if (cloudTime >= localTime) {
            console.log("[Sync] Cloud profile is newer or equal. Overwriting local with cloud.");
            mergedProfile = cloudProfile;
          } else {
            console.log("[Sync] Local profile is newer. Pushing local to cloud.");
            mergedProfile = localProfile;
            foods = localFoods;
            bioHistory = localBioHistory;
            acts = localActions;
            bens = localBenefits;
            cloudReport = localReport;
            // Trigger background save and sync - lightweight multi-doc sync instead of heavy fullPush of subcollections to save write quota
            setTimeout(() => {
              saveAndSync(localProfile, localFoods, biomarkers, localBioHistory, localActions, localBenefits, localReport, { type: 'multi' }, undefined, true);
            }, 50);
          }
        }
        // Apply loaded values merged with local state to React states
        const mergedFoods = [...foods];
        localFoods.forEach(localFood => {
          const existingCloudIndex = mergedFoods.findIndex(f => f.id === localFood.id);
          if (existingCloudIndex === -1) {
            mergedFoods.push(localFood);
          } else {
            const cloudFood = mergedFoods[existingCloudIndex];
            mergedFoods[existingCloudIndex] = {
              ...cloudFood,
              ...localFood,
              imageUrl: localFood.imageUrl || cloudFood.imageUrl,
              imageUrls: (localFood.imageUrls && localFood.imageUrls.length > 0) ? localFood.imageUrls : cloudFood.imageUrls,
            };
          }
        });
        const mergedBioHistory = [...bioHistory];
        localBioHistory.forEach(localLog => {
          const existingCloudIndex = mergedBioHistory.findIndex(b => b.id === localLog.id);
          if (existingCloudIndex === -1) {
            mergedBioHistory.push(localLog);
          } else {
            mergedBioHistory[existingCloudIndex] = { ...mergedBioHistory[existingCloudIndex], ...localLog };
          }
        });
        const mergedActions = [...acts];
        localActions.forEach(localAct => {
          const existingCloudIndex = mergedActions.findIndex(a => a.id === localAct.id);
          if (existingCloudIndex === -1) {
            mergedActions.push(localAct);
          } else {
            mergedActions[existingCloudIndex] = { ...mergedActions[existingCloudIndex], ...localAct };
          }
        });
        const mergedBenefits = [...bens];
        localBenefits.forEach(localBen => {
          const existingCloudIndex = mergedBenefits.findIndex(b => b.id === localBen.id);
          if (existingCloudIndex === -1) {
            mergedBenefits.push(localBen);
          } else {
            mergedBenefits[existingCloudIndex] = { ...mergedBenefits[existingCloudIndex], ...localBen };
          }
        });
        setProfile(mergedProfile);
        setFoodLogs(mergedFoods);
        setBiomarkerHistory(mergedBioHistory);
        setActions(mergedActions);
        setDailyBenefits(mergedBenefits);
        setReport(cloudReport);
        // Recompute active biomarkers (sorted ascending so that newer logs overwrite older values)
        const computedBiomarkers: { [key: string]: number | string } = {};
        [...mergedBioHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
          Object.entries(log.biomarkers).forEach(([k, v]) => {
            computedBiomarkers[k] = v;
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
          report: cloudReport
        };
        safeSaveToLocalStorage(getStorageKey(), bundle);
        // Add a small delay for delightful visual feedback
        await new Promise(resolve => setTimeout(resolve, 800));
        setSyncState('synced');
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
        [...localBioHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach((log: BiomarkerLog) => {
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
        safeSaveToLocalStorage(getStorageKey(), bundle);
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
        safeSaveToLocalStorage(getStorageKey(), bundle);
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
          
          // Automatically fetch the latest database data on login/load to restore the account data
          checkForDbChanges(user.uid);
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
    safeSaveToLocalStorage(getStorageKey(), bundle);
  }, [profile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, foodIdeas, report]);
  // Automatically log BMI on initial load if profile has height/weight but BMI is missing from history or biomarkers
  useEffect(() => {
    if (profile && profile.weight && profile.height) {
      const hasBmiInHistory = biomarkerHistory.some(h => h.biomarkers && h.biomarkers.bmi !== undefined);
      const hasBmiInBiomarkers = biomarkers.bmi !== undefined;
      if (!hasBmiInHistory || !hasBmiInBiomarkers) {
        const heightInMeters = Number(profile.height) / 100;
        const bmiScore = Number(profile.weight) / (heightInMeters * heightInMeters);
        if (Number.isNaN(bmiScore) || !isFinite(bmiScore)) return;
        const roundedBmi = parseFloat(bmiScore.toFixed(1));
        const recordDate = getCurrentDateInTimezone(profile.timezone);
        const logId = `med_log_bmi_init_${Date.now()}`;
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
          updatedHistory.sort((a, b) => b.date.localeCompare(a.date));
          // Trigger saveAndSync in background
          setTimeout(() => {
            const updatedBiomarkers = { ...biomarkers, bmi: roundedBmi };
            saveAndSync(profile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLog', targetId: targetIdToSave });
          }, 0);
          return updatedHistory;
        });
      }
    }
  }, [profile?.weight, profile?.height, biomarkerHistory.length, biomarkers.bmi]);
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
          
          // Write to Firestore in a single atomic batch to prevent excessive separate write operations
          const batch = writeBatch(db);
          let addedToBatch = false;
          newFoodLogs.forEach(f => {
            const oldLog = foodLogs.find(old => old.id === f.id);
            if (!oldLog?.imageUrl && f.imageUrl) {
              const docRef = doc(db, 'users', uid, 'foodLogs', f.id);
              batch.set(docRef, cleanData(f));
              addedToBatch = true;
            }
          });
          if (addedToBatch) {
            const trackId = logInteraction('upload', `users/${uid}/foodLogs (Batch Restore)`, null, updateCount);
            batch.commit()
              .then(() => completeInteraction(trackId, true, 0))
              .catch(err => {
                completeInteraction(trackId, false, 0, err?.message || String(err));
                console.error("Failed to commit batch image restore:", err);
              });
          }
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
      type: 'profile' | 'foodLog' | 'biomarkerLog' | 'actions' | 'dailyBenefits' | 'foodIdeas' | 'report' | 'deleteFood' | 'deleteBiomarker' | 'multi' | 'fullPush' | 'analysis' | 'deleteAnalysis';
      targetId?: string;
    },
    currFoodIdeas: FoodIdea[] = foodIdeas,
    isManualSync: boolean = false
  ) => {
    const now = Date.now();
    let updatedProfile = currProfile;
    if (currProfile) {
      updatedProfile = {
        ...currProfile,
        lastUpdatedAt: now
      };
      // Keep local state in sync immediately with the timestamped profile
      setProfile(updatedProfile);
    }
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
    safeSaveToLocalStorage(getStorageKey(), bundle);

    // Only do the sync when user explicitly clicks on the sync icon.
    // Otherwise, all edits remain local in IndexedDB.
    if (!isManualSync) {
      setSyncState('local');
      return;
    }

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
    setSyncState('syncing');
    const uid = auth.currentUser.uid;
    const syncRootId = logInteraction('sync', `users/${uid} (${specificUpdate ? specificUpdate.type : 'Save changes'})`, null);
    try {
      if (specificUpdate && specificUpdate.type !== 'multi' && specificUpdate.type !== 'fullPush') {
        // Only touch profile timestamp for critical metadata changes, never for high-frequency logs like foodLog or biomarkerLog
        if (specificUpdate.type !== 'profile' && specificUpdate.type !== 'foodLog' && specificUpdate.type !== 'biomarkerLog') {
          setDoc(doc(db, 'users', uid), { lastUpdatedAt: now }, { merge: true }).catch(err => {
            console.warn("Failed to touch lastUpdatedAt timestamp in cloud:", err);
          });
        }
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
          const f = currFoods.find(item => item.id === specificUpdate.targetId);
          if (f) {
            const itemTrackId = logInteraction('upload', `users/${uid}/foodLogs/${f.id}`, f);
            await withTimeout(
              setDoc(doc(db, 'users', uid, 'foodLogs', f.id), cleanData(f))
                .then(() => completeInteraction(itemTrackId, true, JSON.stringify(f).length))
                .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); handleFirestoreError(err); console.error(err); }),
              2000,
              'FoodLog write'
            );
          }
        } else if (specificUpdate.type === 'biomarkerLog' && specificUpdate.targetId) {
          const b = currBioHistory.find(item => item.id === specificUpdate.targetId);
          if (b) {
            const itemTrackId = logInteraction('upload', `users/${uid}/biomarkerHistory/${b.id}`, b);
            await withTimeout(
              setDoc(doc(db, 'users', uid, 'biomarkerHistory', b.id), cleanData(b))
                .then(() => completeInteraction(itemTrackId, true, JSON.stringify(b).length))
                .catch(err => { completeInteraction(itemTrackId, false, 0, err.message); handleFirestoreError(err); console.error(err); }),
              2000,
              'BiomarkerLog write'
            );
          }
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
          const delTrackId = logInteraction('delete', `users/${uid}/foodLogs/${specificUpdate.targetId}`, null);
          await withTimeout(
            deleteDoc(doc(db, 'users', uid, 'foodLogs', specificUpdate.targetId))
              .then(() => completeInteraction(delTrackId, true, 0))
              .catch(err => { completeInteraction(delTrackId, false, 0, err.message); handleFirestoreError(err); console.error(err); }),
            2000,
            'Delete foodLog'
          );
        } else if (specificUpdate.type === 'deleteBiomarker' && specificUpdate.targetId) {
          const delTrackId = logInteraction('delete', `users/${uid}/biomarkerHistory/${specificUpdate.targetId}`, null);
          await withTimeout(
            deleteDoc(doc(db, 'users', uid, 'biomarkerHistory', specificUpdate.targetId))
              .then(() => completeInteraction(delTrackId, true, 0))
              .catch(err => { completeInteraction(delTrackId, false, 0, err.message); handleFirestoreError(err); console.error(err); }),
            2000,
            'Delete biomarkerHistory'
          );
        }
      } else if (specificUpdate && specificUpdate.type === 'fullPush') {
        const pId = logInteraction('upload', `users/${uid} (Profile)`, currProfile);
        const profilePromise = setDoc(doc(db, 'users', uid), cleanData(profileForCloud))
          .then(() => completeInteraction(pId, true, JSON.stringify(currProfile).length))
          .catch(err => { completeInteraction(pId, false, 0, err.message); handleFirestoreError(err); });
        
        const foodPromises = currFoods.map(f => 
          setDoc(doc(db, 'users', uid, 'foodLogs', f.id), cleanData(f)).catch(err => { handleFirestoreError(err); console.error(err); })
        );
        const bioPromises = currBioHistory.map(b => 
          setDoc(doc(db, 'users', uid, 'biomarkerHistory', b.id), cleanData(b)).catch(err => { handleFirestoreError(err); console.error(err); })
        );
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
            ...foodPromises,
            ...bioPromises
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
        await withTimeout(
          Promise.all([
            profilePromise,
            dashboardPromise,
            reportPromise
          ]),
          3000,
          'Multi sync'
        ).catch(err => console.warn('Background sync warning:', err));
      }
      // Artificially enforce a minimum rotation time of 800ms so the user gets clear visual confirmation
      await new Promise(resolve => setTimeout(resolve, 800));
      setSyncState('synced');
      completeInteraction(syncRootId, true, 0);
    } catch (e: any) {
      console.error("[Sync Save Fail]", e);
      handleFirestoreError(e);
      setSyncState('local');
      completeInteraction(syncRootId, false, 0, e.message || 'Save error');
    }
  };
  // Sync Check on Login / Fetch user record if existing on server
  const handleLogin = async (loggedProfile: UserProfile) => {
    setProfile(loggedProfile);
    if (auth.currentUser) {
      await checkForDbChanges(auth.currentUser.uid);
    } else {
      setSyncState('synced');
    }
  };
  const handleSignOut = async () => {
    try {
      await fbSignOut(auth);
      setProfile(null);
      // Removed localStorage clear to preserve data in case cloud sync is out of quota
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
    const updatedFoods = [...foodLogs, food];
    setFoodLogs(updatedFoods);
    setIsFoodChatOpen(false);
    setActiveTab('home');
    await saveAndSync(profile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodLog', targetId: food.id });
  };
  const handleUpdateFoodLog = async (updatedLog: FoodLog) => {
    const updatedFoods = foodLogs.map(f => f.id === updatedLog.id ? updatedLog : f);
    setFoodLogs(updatedFoods);
    await saveAndSync(profile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'foodLog', targetId: updatedLog.id });
  };
  const handleDeleteFoodLog = async (id: string) => {
    const updatedFoods = foodLogs.filter(f => f.id !== id);
    setFoodLogs(updatedFoods);
    await saveAndSync(profile, updatedFoods, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'deleteFood', targetId: id });
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
      updatedHistory.sort((a, b) => b.date.localeCompare(a.date));
      updatedBiomarkers.bmi = roundedBmi;
    }
    return { updatedHistory, updatedBiomarkers, changed: weightChanged || heightChanged || hasNoBmi };
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
    const cleanName = (n: string): string => n.split('(')[0].split('[')[0].trim();
    const keyMapping: { [key: string]: string } = {};
    if (finalProfileUpdates && finalProfileUpdates.customBiomarkers && Object.keys(finalProfileUpdates.customBiomarkers).length > 0) {
      const currentCustoms = { ...(profile?.customBiomarkers || {}) };
      const nextCustomDefs: { [key: string]: any } = {};
      Object.entries(finalProfileUpdates.customBiomarkers).forEach(([rawKey, def]) => {
        const rawName = def.name || rawKey;
        const cleaned = cleanName(rawName);
        const normalizeUnit = (u: string) => (u || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        // Check standard match
        const stdMatch = biomarkerDefinitions.find(d => {
          const nameMatch = d.name.toLowerCase() === cleaned.toLowerCase() || d.key.toLowerCase() === cleaned.toLowerCase() || cleanName(d.name).toLowerCase() === cleaned.toLowerCase();
          const unitMatch = !def.unit || !d.unit || normalizeUnit(d.unit) === normalizeUnit(def.unit);
          return nameMatch && unitMatch;
        });
        if (stdMatch) {
          keyMapping[rawKey] = stdMatch.key;
          return; // Map to standard key, drop custom def
        }
        // Check existing custom match
        const existingKey = Object.keys(currentCustoms).find(k => {
          const nameMatch = cleanName(currentCustoms[k]?.name || '').toLowerCase() === cleaned.toLowerCase();
          const keyMatch = k.toLowerCase() === cleaned.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
          return nameMatch || keyMatch;
        });
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
    let targetId: string | undefined = undefined;
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
            madeChanges = true;
            hasNewBiomarkers = true;
          }
        } else if (cmd.action === 'remove_biomarker' && cmd.keyName) {
          // Locked markers cannot be removed
          if (cmd.keyName === 'bmi' || cmd.keyName === 'weight' || cmd.keyName === 'height') {
            console.warn(`Prevented deletion of locked biomarker: ${cmd.keyName}`);
            return;
          }
          const targetDate = cmd.date || getCurrentDateInTimezone(profile?.timezone);
          const logIdx = updatedHistory.findIndex(h => h.date === targetDate);
          if (logIdx >= 0 && updatedHistory[logIdx].biomarkers[cmd.keyName] !== undefined) {
            const newBiomarkers = { ...updatedHistory[logIdx].biomarkers };
            delete newBiomarkers[cmd.keyName];
            updatedHistory[logIdx].biomarkers = newBiomarkers;
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
            tests: mergedTests
          };
          targetId = updatedHistory[existingLogIndex].id;
        } else {
          const datedLog: BiomarkerLog = {
            id: `med_log_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            date: recordDate,
            biomarkers: mappedExtracted,
            tests: entryTests
          };
          updatedHistory.push(datedLog);
          targetId = datedLog.id;
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
      updatedHistory.sort((a, b) => b.date.localeCompare(a.date));
      setBiomarkerHistory(updatedHistory);
      // Recompute the latest biomarkers from history so they reflect the latest dates (sorted ascending)
      const recomputedBiomarkers: { [key: string]: number | string } = {};
      [...updatedHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
        Object.entries(log.biomarkers).forEach(([k, v]) => {
          recomputedBiomarkers[k] = v as string | number;
        });
      });
      setBiomarkers(recomputedBiomarkers);
      if (!skipClose) {
        setIsMedicalChatOpen(false);
        setActiveTab('home');
      }
      await saveAndSync(currentProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLog', targetId });
    } else {
      if (!skipClose) {
        setIsMedicalChatOpen(false);
        setActiveTab('home');
      }
      await saveAndSync(currentProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
    }
  };
  const handleDeleteBiomarker = async (key: string) => {
    const updatedBiomarkers = { ...biomarkers };
    delete updatedBiomarkers[key];
    
    const logsToDelete: string[] = [];
    let updatedHistory = biomarkerHistory.map(log => {
      const cleanBiomarkers = { ...log.biomarkers };
      if (cleanBiomarkers[key] !== undefined) {
        delete cleanBiomarkers[key];
        if (Object.keys(cleanBiomarkers).length === 0 && !log.note) {
          logsToDelete.push(log.id);
        }
      }
      return { ...log, biomarkers: cleanBiomarkers };
    });
    
    updatedHistory = updatedHistory.filter(log => !logsToDelete.includes(log.id));
    setBiomarkers(updatedBiomarkers);
    setBiomarkerHistory(updatedHistory);
    let updatedProfile = { ...profile } as UserProfile;
    if (updatedProfile.customBiomarkers && updatedProfile.customBiomarkers[key]) {
      const newCustoms = { ...updatedProfile.customBiomarkers };
      delete newCustoms[key];
      updatedProfile.customBiomarkers = newCustoms;
      setProfile(updatedProfile);
    }
    if (auth.currentUser) {
      const uid = auth.currentUser.uid;
      try {
        for (const logId of logsToDelete) {
          await deleteDoc(doc(db, 'users', uid, 'biomarkerHistory', logId));
        }
        const logsToUpdate = updatedHistory.filter(log => biomarkerHistory.find(old => old.id === log.id)?.biomarkers[key] !== undefined);
        for (const log of logsToUpdate) {
          await setDoc(doc(db, 'users', uid, 'biomarkerHistory', log.id), cleanData(log));
        }
      } catch (err) {
        console.error("Failed to delete biomarker from Firestore:", err);
      }
    }
    await saveAndSync(updatedProfile, foodLogs, updatedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
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
        } else {
          logsToUpdate.push({ ...log, biomarkers: cleanBiomarkers });
        }
        return { ...log, biomarkers: cleanBiomarkers };
      }
      return log;
    });

    updatedHistory = updatedHistory.filter(log => !logsToDelete.includes(log.id));

    // 2. Determine which keys actually have data remaining
    const usedKeys = new Set<string>();
    updatedHistory.forEach(log => {
      Object.keys(log.biomarkers).forEach(key => usedKeys.add(key));
    });

    // 3. Clean customBiomarkers
    if (updatedProfile.customBiomarkers) {
      const newCustoms = { ...updatedProfile.customBiomarkers };
      Object.keys(newCustoms).forEach(key => {
        if (!usedKeys.has(key)) {
          delete newCustoms[key];
          modifiedProfile = true;
        }
      });
      if (modifiedProfile) {
        updatedProfile.customBiomarkers = newCustoms;
      }
    }

    // 4. Recompute the biomarkers state
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
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

    if (auth.currentUser) {
      const uid = auth.currentUser.uid;
      try {
        let batch = writeBatch(db);
        let opCount = 0;

        for (const logId of logsToDelete) {
          batch.delete(doc(db, 'users', uid, 'biomarkerHistory', logId));
          opCount++;
          if (opCount === 450) {
            await batch.commit();
            batch = writeBatch(db);
            opCount = 0;
          }
        }

        for (const log of logsToUpdate) {
          batch.set(doc(db, 'users', uid, 'biomarkerHistory', log.id), cleanData(log));
          opCount++;
          if (opCount === 450) {
            await batch.commit();
            batch = writeBatch(db);
            opCount = 0;
          }
        }

        if (opCount > 0) {
          await batch.commit();
        }
      } catch (err) {
        console.error("Failed to delete empty biomarkers from Firestore:", err);
      }
    }

    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
  };
  const handleDeleteBiomarkerLog = async (id: string) => {
    const updatedHistory = biomarkerHistory.filter(b => b.id !== id);
    setBiomarkerHistory(updatedHistory);
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });
    setBiomarkers(recomputedBiomarkers);
    await saveAndSync(profile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'deleteBiomarker', targetId: id });
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
          }
        };
      }
      return log;
    });
    updatedHistory.sort((a, b) => b.date.localeCompare(a.date));
    setBiomarkerHistory(updatedHistory);
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });
    setBiomarkers(recomputedBiomarkers);
    await saveAndSync(profile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'biomarkerLog', targetId: id });
  };
  const handleCombineBiomarkers = async (
    targetKey: string,
    targetDef: { name: string; unit: string; normalRange: string; description: string },
    mergedLogs: { date: string; value: number | string; originalLogId?: string }[],
    sourceKeysToDelete: string[]
  ) => {
    // 1. Remove old custom definitions, and add the new one if custom
    const updatedCustomBiomarkers = { ...(profile?.customBiomarkers || {}) };
    sourceKeysToDelete.forEach(k => {
      delete updatedCustomBiomarkers[k];
    });
    const isStandard = biomarkerDefinitions.some(d => d.key === targetKey);
    if (!isStandard) {
      updatedCustomBiomarkers[targetKey] = {
        name: targetDef.name,
        unit: targetDef.unit,
        normalRange: targetDef.normalRange,
        description: targetDef.description,
        benefitRisk: ''
      };
    }
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
    updatedHistory.sort((a, b) => b.date.localeCompare(a.date));
    // 3. Recompute latest biomarkers
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });
    setProfile(updatedProfile);
    setBiomarkerHistory(updatedHistory);
    setBiomarkers(recomputedBiomarkers);
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
  };
  const handleBatchConsolidate = async (mapping: { [key: string]: string }) => {
    const targetGroups: { [targetKey: string]: string[] } = {};
    Object.entries(mapping).forEach(([srcKey, tgtKey]) => {
      if (srcKey && tgtKey && srcKey !== tgtKey) {
        if (!targetGroups[tgtKey]) {
          targetGroups[tgtKey] = [];
        }
        if (!targetGroups[tgtKey].includes(srcKey)) {
          targetGroups[tgtKey].push(srcKey);
        }
      }
    });

    const updatedCustomBiomarkers = { ...(profile?.customBiomarkers || {}) };
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
    updatedHistory.sort((a, b) => b.date.localeCompare(a.date));

    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...updatedHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
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
    await saveAndSync(updatedProfile, foodLogs, recomputedBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'profile' });
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col transition-colors duration-200">
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
          safeSaveToLocalStorage(getStorageKey(), bundle);
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
        onCloudSync={() => checkForDbChanges()}
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
                await checkForDbChanges();
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
      {/* Main Viewport Container */}
      <main className="flex-1 overflow-x-hidden">
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
          />
        )}
        {activeTab === 'insights' && (
          <InsightsTab
            profile={profile}
            foodLogs={foodLogs}
            biomarkers={biomarkers}
            biomarkerHistory={biomarkerHistory}
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
              
              if (changedLogs.length > 0 && auth.currentUser) {
                const uid = auth.currentUser.uid;
                let batch = writeBatch(db);
                let opCount = 0;
                for (const log of changedLogs) {
                  batch.set(doc(db, 'users', uid, 'biomarkerHistory', log.id), cleanData(log));
                  opCount++;
                  if (opCount === 450) {
                    await batch.commit();
                    batch = writeBatch(db);
                    opCount = 0;
                  }
                }
                if (opCount > 0) await batch.commit();
              }
              
              await saveAndSync(updatedProfileArg || profile, foodLogs, newBiomarkers, updatedHistory, actions, dailyBenefits, report, { type: 'multi' });
            }}
            batchSize={batchSize}
            onChangeBatchSize={(size) => {
              setBatchSize(size);
              try {
                localStorage.setItem('biomarker_batch_size', size.toString());
              } catch (e) {}
            }}
            onOpenAgentChat={(agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'agent6' | 'agent7' | 'data_review', options?: { prefillMessage?: string; dataReviewBatchIdx?: number | string }) => {
              setActiveAgentType(agentType);
              setPrefillMessage(options?.prefillMessage || null);
              setActiveDataReviewBatchIdx(options?.dataReviewBatchIdx !== undefined ? options.dataReviewBatchIdx : null);
              setIsMedicalChatOpen(true);
            }}
            onDeleteAnalysis={async (id) => {
              if (profile.agentAnalyses) {
                const updatedProfile = {
                  ...profile,
                  agentAnalyses: profile.agentAnalyses.filter(a => a.id !== id)
                };
                setProfile(updatedProfile);
                await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'deleteAnalysis', targetId: id });
              }
            }}
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
            onEditBiomarkerLog={handleEditBiomarkerLog}
            onLogMedical={handleLogMedical}
            onDeleteBiomarker={handleDeleteBiomarker}
            onDeleteBiomarkerLog={handleDeleteBiomarkerLog}
            onCombineBiomarkers={handleCombineBiomarkers}
            onBatchConsolidate={handleBatchConsolidate}
            onReviewWithAgent={(keys) => {
              localStorage.setItem('agent1_custom_batch_keys', JSON.stringify(keys));
              sessionStorage.setItem('auto_open_custom_batch_modal', 'true');
              setActiveTab('insights');
            }}
            onApplyCalculation={handleApplyCalculation}
            selectedModelId={selectedModelId}
            onChangeModelId={setSelectedModelId}
            hasBmiAlert={profile ? hasBmiPendingAlert(profile, dismissedBmiAlerts, report) : false}
            onDismissBmiAlert={handleDismissBmiAlert}
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
        onGoToManualEdit={() => {
          setIsFoodChatOpen(false);
          setActiveTab('food');
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
        batchSize={batchSize}
        onAgentAnalysisSaved={async (agentType, agentResult) => {
          const newId = `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
          const updatedProfile = { ...profile };
          if (!updatedProfile.agentAnalyses) {
            updatedProfile.agentAnalyses = [];
          }
          updatedProfile.agentAnalyses.push({
            id: newId,
            agentType: agentType,
            date: new Date().toISOString(),
            result: agentResult
          });
          setProfile(updatedProfile);
          await saveAndSync(updatedProfile, foodLogs, biomarkers, biomarkerHistory, actions, dailyBenefits, report, { type: 'analysis', targetId: newId });
        }}
        onAgentFinish={async (agentType, agentResult) => {
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

              // Save customBiomarkers to user profile and history
              const updatedCustoms = { ...(updatedProfile.customBiomarkers || {}) };
              let hHistory = biomarkerHistory ? biomarkerHistory.map((h: any) => ({
                ...h,
                biomarkers: { ...h.biomarkers }
              })) : [];

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
                    } else if (cleanRawKey.includes(cleanParsedKey) || cleanParsedKey.includes(cleanRawKey)) {
                      score += 40;
                    }
                    if (explanation.includes(rawKey.toLowerCase())) {
                      score += 80;
                    }
                    if (score > bestScore) {
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
                    }
                  } else {
                    // Completely unmapped/deleted raw item: delete from all historical logs and custom definitions
                    hHistory.forEach((log: any) => {
                      if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                        delete log.biomarkers[rawKey];
                      }
                    });
                    delete updatedCustoms[rawKey];
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

              hHistory.sort((a, b) => b.date.localeCompare(a.date));

              // Recompute biomarkers list
              const recomputedBiomarkers: { [key: string]: number | string } = {};
              [...hHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
                Object.entries(log.biomarkers).forEach(([k, v]) => {
                  recomputedBiomarkers[k] = v as string | number;
                });
              });

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
                const lines = yamlText.split('\n');
                let currentEntry: any = {};
                const entries: any[] = [];
                
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
                  const valMatch = line.match(/value:\s*([\d.]+)/i);
                  if (valMatch) { currentEntry.value = parseFloat(valMatch[1]); continue; }
                  const unitMatch = line.match(/unit:\s*(.*)/i);
                  if (unitMatch) { currentEntry.unit = unitMatch[1].replace(/['"]/g, '').trim(); continue; }
                }
                if (currentEntry.biomarker) entries.push(currentEntry);
                
                entries.forEach(entry => {
                  const bioName = entry.biomarker.toLowerCase().replace(/[^a-z0-9]/g, '_');
                  let existingLogIndex = currentHistory.findIndex(h => h.date === entry.date);
                  if (existingLogIndex >= 0) {
                    currentHistory[existingLogIndex].biomarkers[bioName] = entry.value;
                  } else {
                    currentHistory.push({
                      id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
                      date: entry.date,
                      biomarkers: { [bioName]: entry.value },
                      note: "Extracted by Clinical Data Parser"
                    });
                  }
                  
                  if (!updatedProfile.customBiomarkers) updatedProfile.customBiomarkers = {};
                  if (!updatedProfile.customBiomarkers[bioName]) {
                    updatedProfile.customBiomarkers[bioName] = {
                      name: entry.biomarker,
                      unit: entry.unit || '',
                      normalRange: 'Unknown',
                      description: ''
                    };
                  }
                });
                
                currentHistory.sort((a, b) => b.date.localeCompare(a.date));
                setBiomarkerHistory(currentHistory);
                
                const recomputedBiomarkers: { [key: string]: number | string } = {};
                [...currentHistory].sort((a, b) => a.date.localeCompare(b.date)).forEach(log => {
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
              .sort((a, b) => b.date.localeCompare(a.date))[0];
            
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
      /></ErrorBoundary>
    </div>
  );
}