import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { UserProfile, DbInteraction, QuotaData, FoodLog } from '../types';
import { translations } from '../utils/translations';
import {
  Eye, EyeOff, CloudLightning, CloudCheck, RefreshCw, LogOut, Check, ShieldCheck,
  Archive, FileSpreadsheet, KeyRound, Lock, Unlock, FileDown, FileUp, AlertTriangle,
  CloudUpload, CloudDownload, HelpCircle, Terminal, User
} from 'lucide-react';
import { db, auth } from '../firebase';
import { doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import GoogleHealthIntegration from './GoogleHealthIntegration';
import FullScreenLogViewer from './FullScreenLogViewer';
import {
  getGoogleAccessToken,
  hasGoogleToken,
  runBackupWorkflow,
  listBackupsFromDrive,
  downloadFileFromDrive,
  previewBackupZip,
  restoreAccountToFirestore,
  clearGoogleToken
} from '../utils/googleBackup';
import { compressImage } from '../utils/imageCompressor';

const ColorPickerField = ({ label, value, onChange }: { label: string, value: string, onChange: (v: string) => void }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-150 dark:border-slate-800 gap-2">
    <div className="min-w-0 text-left">
      <span className="block text-xs font-bold text-slate-800 dark:text-slate-200">{label}</span>
    </div>
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-20 text-xs px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-md font-mono text-slate-700 dark:text-slate-300"
      />
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-8 h-8 rounded cursor-pointer overflow-hidden bg-transparent shrink-0"
        style={{ padding: 0, border: 'none' }}
      />
    </div>
  </div>
);

const TIMEZONES = [
  "Pacific/Midway", "Pacific/Honolulu", "America/Anchorage", "America/Los_Angeles", 
  "America/Denver", "America/Chicago", "America/New_York", "America/Caracas", 
  "America/Buenos_Aires", "Atlantic/Azores", "Europe/London", "Europe/Paris", 
  "Africa/Cairo", "Europe/Moscow", "Asia/Dubai", "Asia/Karachi", "Asia/Dhaka", 
  "Asia/Bangkok", "Asia/Hong_Kong", "Asia/Tokyo", "Australia/Sydney", "Pacific/Noumea", "Pacific/Auckland"
];

const formatTimezone = (tz: string) => {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' });
    const parts = formatter.formatToParts(new Date());
    const tzName = parts.find(p => p.type === 'timeZoneName')?.value;
    const city = tz.split('/')[1]?.replace(/_/g, ' ') || tz;
    return `${city} (${tzName?.replace('GMT', 'UTC') || 'UTC'})`;
  } catch (e) {
    return tz;
  }
};

interface HeaderProps {
  profile: UserProfile;
  setProfile: (p: UserProfile) => void;
  onSaveProfile?: (p: UserProfile) => Promise<void>;
  hideSensitive: boolean;
  setHideSensitive: (h: boolean) => void;
  syncState: 'synced' | 'syncing' | 'local';
  onSignOut: () => void;
  onCloudSync?: () => Promise<void>;
  onForcePush?: () => Promise<void>;
  onForcePull?: () => Promise<void>;
  dbInteractions?: DbInteraction[];
  quota?: QuotaData;
  foodLogs?: FoodLog[];
  activeTab?: string;
}

const getSessionId = (): string => {
  if (typeof window === 'undefined') return 'global';
  let id = sessionStorage.getItem('app_session_id');
  if (!id) {
    id = `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    sessionStorage.setItem('app_session_id', id);
  }
  return id;
};

export default function Header({
  profile,
  setProfile,
  onSaveProfile,
  hideSensitive,
  setHideSensitive,
  syncState,
  onSignOut,
  onCloudSync,
  onForcePush,
  onForcePull,
  dbInteractions = [],
  quota,
  foodLogs = [],
  activeTab = 'home'
}: HeaderProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [showThemeScreen, setShowThemeScreen] = useState(false);
  const [showDbInteractionsOverlay, setShowDbInteractionsOverlay] = useState(false);
  const [dbOverlayViewMode, setDbOverlayViewMode] = useState<'admin' | 'user'>(() => {
    if (profile?.email?.toLowerCase().trim() !== 'cwah.liu@gmail.com') return 'user';
    const saved = localStorage.getItem('health_cockpit_admin_mode');
    if (saved) return saved as 'admin' | 'user';
    return 'admin';
  });
  const [showAgentLogs, setShowAgentLogs] = useState(false);
  const [agentLogs, setAgentLogs] = useState<{ timestamp: string, message: string }[]>([]);
  const [isFetchingLogs, setIsFetchingLogs] = useState(false);
  const [nickname, setNickname] = useState(profile.nickname);
  const [age, setAge] = useState<number | string>(profile.age);
  const [ethnicity, setEthnicity] = useState(profile.ethnicity);
  const [weight, setWeight] = useState<number | string>(profile.weight);
  const [height, setHeight] = useState<number | string>(profile.height);
  const [bloodType, setBloodType] = useState<string>(profile.bloodType || '');
  const [gender, setGender] = useState<string>(profile.gender || 'Unknown');
  const [unitPreference, setUnitPreference] = useState<string>(profile.unitPreference || 'SI');
  const [timezone, setTimezone] = useState<string>(profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [now, setNow] = useState(Date.now());
  const t = translations[profile.language] || translations.en;
  useEffect(() => {
    let interval: any;
    if (showAgentLogs) {
      const fetchLogs = async () => {
        try {
          const res = await fetch('/api/gemini/debug-logs', {
            headers: { 'X-Session-ID': 'global' }
          });
          if (res.ok) {
            const data = await res.json();
            if (data && Array.isArray(data.logs)) {
              setAgentLogs(data.logs);
            }
          }
        } catch (e) {}
      };
      fetchLogs();
      interval = setInterval(fetchLogs, 1500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showAgentLogs]);

  const handleClearAgentLogs = async () => {
    try {
      await fetch('/api/gemini/clear-debug-logs', { method: 'POST', headers: { 'X-Session-ID': 'global' } });
      setAgentLogs([]);
    } catch (e) {}
  };


  const [debugMode, setDebugMode] = useState(() => localStorage.getItem('agent_debug_mode') === 'true');
  const [serverStartTime, setServerStartTime] = useState<number | null>(null);

  // Keep track of last sync time in local state
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(() => {
    const email = profile?.email?.toLowerCase().trim() || 'guest';
    return localStorage.getItem(`ghealth_${email}_last_sync`);
  });

  // Whenever syncState changes to 'synced', update last sync time to now
  useEffect(() => {
    if (syncState === 'synced') {
      const nowStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const email = profile?.email?.toLowerCase().trim() || 'guest';
      localStorage.setItem(`ghealth_${email}_last_sync`, nowStr);
      setLastSyncTime(nowStr);
    }
  }, [syncState, profile?.email]);

  useEffect(() => {
    const email = profile?.email?.toLowerCase().trim() || 'guest';
    setLastSyncTime(localStorage.getItem(`ghealth_${email}_last_sync`));
  }, [profile?.email]);

  // Google Drive & Sheets Backup / Restore States
  const [googleAuthorized, setGoogleAuthorized] = useState(() => hasGoogleToken());
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);

  const [backupVersion, setBackupVersion] = useState('V1');
  const [backupPassword, setBackupPassword] = useState('');
  const [backupComment, setBackupComment] = useState('');
  const [backupStatus, setBackupStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');
  const [backupError, setBackupError] = useState('');
  const [backupResult, setBackupResult] = useState<any>(null);

  const [restoreFiles, setRestoreFiles] = useState<any[]>([]);
  const [selectedRestoreFile, setSelectedRestoreFile] = useState<any>(null);
  const [restorePassword, setRestorePassword] = useState('');
  const [restoreStatus, setRestoreStatus] = useState<'idle' | 'listing' | 'downloading' | 'preview' | 'restoring' | 'success' | 'error'>('idle');
  const [restoreError, setRestoreError] = useState('');
  const [restorePreviewData, setRestorePreviewData] = useState<any[]>([]);
  const [restoreTargetAccount, setRestoreTargetAccount] = useState<string>('all'); // 'all' or specific account email
  const [restoreTargetFileBlob, setRestoreTargetFileBlob] = useState<Blob | null>(null);

  const handleOpenBackup = async () => {
    try {
      const token = await getGoogleAccessToken();
      setGoogleAuthorized(true);
      setBackupStatus('idle');
      setBackupError('');
      setBackupResult(null);
      setBackupPassword('');
      setBackupComment('');
      setShowBackupModal(true);
    } catch (err: any) {
      console.error("Google Auth failed:", err);
    }
  };

  const handleExecuteBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!backupPassword) {
      setBackupError("An encryption password is required to secure your backup ZIP file.");
      return;
    }
    setBackupStatus('processing');
    setBackupError('');
    try {
      const token = await getGoogleAccessToken();
      const result = await runBackupWorkflow(token, backupVersion, backupComment, backupPassword);
      setBackupResult(result);
      setBackupStatus('success');
    } catch (err: any) {
      console.error("Backup failed:", err);
      setBackupError(err.message || String(err));
      setBackupStatus('error');
    }
  };

  const handleOpenRestore = async () => {
    setRestoreStatus('listing');
    setRestoreError('');
    setRestoreFiles([]);
    setSelectedRestoreFile(null);
    setRestorePassword('');
    setRestorePreviewData([]);
    setRestoreTargetAccount('all');
    setRestoreTargetFileBlob(null);
    setShowRestoreModal(true);

    try {
      const token = await getGoogleAccessToken();
      setGoogleAuthorized(true);
      const files = await listBackupsFromDrive(token);
      setRestoreFiles(files);
      setRestoreStatus('idle');
    } catch (err: any) {
      console.error("Failed to list backups:", err);
      setRestoreError(err.message || "Failed to list backups from Google Drive.");
      setRestoreStatus('error');
    }
  };

  const handleSelectRestoreFile = (file: any) => {
    setSelectedRestoreFile(file);
    setRestorePassword('');
    setRestoreError('');
    setRestorePreviewData([]);
    setRestoreTargetFileBlob(null);
    setRestoreStatus('idle');
  };

  const handleLoadAndDecryptBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedRestoreFile) return;
    setRestoreStatus('downloading');
    setRestoreError('');

    try {
      const token = await getGoogleAccessToken();
      const blob = await downloadFileFromDrive(token, selectedRestoreFile.id);
      setRestoreTargetFileBlob(blob);

      const preview = await previewBackupZip(blob, restorePassword);
      setRestorePreviewData(preview);
      setRestoreStatus('preview');
    } catch (err: any) {
      console.error("Unzip/Decrypt failed:", err);
      setRestoreError(err.message || "Decryption failed. Please verify your backup password.");
      setRestoreStatus('idle');
    }
  };

  const handleExecuteRestore = async () => {
    if (!restoreTargetFileBlob) return;
    if (!window.confirm("This will restore the selected records back to Firestore. Are you sure you want to proceed?")) {
      return;
    }

    setRestoreStatus('restoring');
    setRestoreError('');
    try {
      if (restoreTargetAccount === 'all') {
        for (const account of restorePreviewData) {
          if (account.jsonData) {
            await restoreAccountToFirestore(account.jsonData.uid, account.jsonData);
          }
        }
      } else {
        const account = restorePreviewData.find(acc => acc.email === restoreTargetAccount);
        if (account && account.jsonData) {
          await restoreAccountToFirestore(account.jsonData.uid, account.jsonData);
        } else {
          throw new Error("Selected account data not found in archive.");
        }
      }
      setRestoreStatus('success');
    } catch (err: any) {
      console.error("Restore failed:", err);
      setRestoreError(err.message || String(err));
      setRestoreStatus('error');
    }
  };

  const handleToggleDebugMode = (enabled: boolean) => {
    setDebugMode(enabled);
    localStorage.setItem('agent_debug_mode', enabled ? 'true' : 'false');
  };


  // Fetch real server start time
  useEffect(() => {
    fetch('/api/status')
      .then(r => r.json())
      .then(d => {
        if (d && typeof d.startTime === 'number') {
          setServerStartTime(d.startTime);
        }
      })
      .catch(e => console.error("Error fetching status:", e));
  }, []);

  useEffect(() => {
    let interval: any;
    if (showDbInteractionsOverlay) {
      interval = setInterval(() => setNow(Date.now()), 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showDbInteractionsOverlay]);


  useEffect(() => {
    setNickname(profile.nickname);
    setAge(profile.age);
    setEthnicity(profile.ethnicity);
    setWeight(profile.weight);
    setHeight(profile.height);
    setBloodType(profile.bloodType || '');
    setGender(profile.gender || 'Unknown');
    setUnitPreference(profile.unitPreference || 'SI');
    setTimezone(profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, [profile]);

  const handleSave = () => {
    const finalProfile = {
      ...profile,
      nickname,
      age: Number(age) || 0,
      ethnicity,
      weight: Number(weight) || 0,
      height: Number(height) || 0,
      bloodType,
      gender,
      unitPreference: unitPreference as 'SI' | 'US',
      timezone
    };
    if (onSaveProfile) {
      onSaveProfile(finalProfile);
    } else {
      setProfile(finalProfile);
    }
    setIsEditing(false);
  };

  return (
    <>
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800/80 px-6 py-4 sticky top-0 z-40 shadow-sm transition-colors duration-200">
        <div className="max-w-md mx-auto flex items-center justify-between gap-3">
        {/* Profile Info Row */}
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <button 
            id="avatar-edit-btn"
            onClick={() => setIsEditing(!isEditing)} 
            className="relative w-12 h-12 rounded-full overflow-hidden border-2 border-indigo-500/20 flex-shrink-0 hover:scale-105 active:scale-95 transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            <img 
              src={profile.photoUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120"} 
              alt="User profile" 
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </button>
          
          <div className="min-w-0 flex-1">
            <div className="flex flex-col justify-center">
              <span id="user-nickname-text" className="font-semibold text-slate-950 dark:text-slate-100 truncate text-base leading-tight">
                {profile.nickname || 'Healthy User'}
              </span>
              <span className="text-[10px] text-slate-400 capitalize font-medium mt-0.5 block tracking-wide">
                {activeTab === 'home' ? 'Home' : activeTab === 'insights' ? 'Health insights' : activeTab === 'food' ? 'Food & Nutrition Logs' : activeTab === 'medical' ? 'Medical History' : activeTab === 'trends' ? 'Health Trends' : activeTab}
              </span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          {lastSyncTime && (
            <span
              onClick={() => setShowDbInteractionsOverlay(true)}
              className="text-[10px] font-mono font-bold text-slate-400 dark:text-slate-500 cursor-pointer hover:underline hover:text-indigo-600 transition-colors"
              title="Click to view detailed database sync log"
            >
              Sync: {lastSyncTime}
            </span>
          )}

          {/* Sync Status Icon Indicator */}
          {(() => {
            const isAttentionNeeded = syncState === 'syncing' || dbInteractions.some(o => o.status === 'pending') || localStorage.getItem('firestore_quota_exceeded') === 'true';
            return (
              <button
                id="cloud-sync-btn"
                onClick={async () => {
                  if (onCloudSync) {
                    await onCloudSync();
                  }
                }}
                className={`flex items-center p-2 rounded-xl transition-colors cursor-pointer relative ${
                  isAttentionNeeded 
                    ? 'text-amber-500 hover:bg-amber-500/10' 
                    : 'text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Click to manually synchronize data with cloud database"
              >
                {syncState === 'syncing' && (
                  <RefreshCw className="w-5 h-5 text-amber-500 animate-spin" />
                )}
                {syncState === 'synced' && (
                  <CloudCheck className="w-5.5 h-5.5 text-slate-400 dark:text-slate-500" />
                )}
                {syncState === 'local' && (
                  localStorage.getItem('firestore_quota_exceeded') === 'true' ? (
                    <CloudLightning className="w-5 h-5 text-amber-500 animate-pulse" title="Firestore Quota Exceeded - Offline Mode Only" />
                  ) : (
                    <CloudLightning className="w-5 h-5 text-slate-400 dark:text-slate-500" />
                  )
                )}
                {dbInteractions.some(o => o.status === 'pending') && (
                  <span className="absolute top-1 right-1 w-2 h-2 bg-amber-500 rounded-full animate-ping" />
                )}
              </button>
            );
          })()}
        </div>
      </div>
    
      {/* AI Agent Full Screen Logs */}
      <FullScreenLogViewer
        isOpen={showAgentLogs}
        onClose={() => setShowAgentLogs(false)}
        title="AI Agent Diagnostic Log History"
        logsText={agentLogs.map(l => `[${l.timestamp}] ${l.message}`).join('\n')}
        logsArray={agentLogs.map(l => `[${l.timestamp}]\n${l.message}`)}
        onClearLogs={handleClearAgentLogs}
        eventsCount={agentLogs.length}
      />
    </header>


      {/* Editing Dialog Slide-down for Profile Parameters */}
      {isEditing && createPortal((
        <div id="profile-edit-modal" className="fixed inset-0 z-[100] bg-white dark:bg-slate-900 sm:bg-slate-900/60 sm:backdrop-blur-sm flex items-center justify-center sm:p-4 overflow-hidden">
          <div className="w-full h-full sm:h-auto sm:max-h-[90vh] flex flex-col bg-white dark:bg-slate-900 sm:border border-slate-200 dark:border-slate-800 sm:rounded-3xl sm:shadow-xl max-w-lg animation-fade-in text-slate-800 dark:text-slate-100 overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between flex-shrink-0">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Edit Profile</h2>
                <p className="text-xs text-slate-450 dark:text-slate-400">Update your health indicators and settings</p>
              </div>
              <div className="flex gap-2">
                <button
                  id="profile-save-btn"
                  onClick={handleSave}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
                >
                  {t.save}
                </button>
                <button
                  onClick={() => setIsEditing(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

              {/* Content scroll area */}
            <div className="p-6 overflow-y-auto space-y-4 text-left flex-1 pb-16">
              
              {/* Real Profile Photo Uploader */}
          <div className="flex items-center gap-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800/80 rounded-2xl p-3.5">
            <div className="relative w-14 h-14 rounded-full overflow-hidden border-2 border-indigo-500/25 flex-shrink-0 bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
              <img 
                src={profile.photoUrl || "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=120"} 
                alt="User profile" 
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            </div>
            <div className="flex-1 text-left min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Upload photo</span>
                <button
                  type="button"
                  id="edit-theme-link"
                  onClick={() => {
                    setIsEditing(false);
                    setShowThemeScreen(true);
                  }}
                  className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                >
                  edit theme
                </button>
              </div>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    compressImage(file, 200, 200, 0.5)
                      .then((compressedBase64) => {
                        const updated = { ...profile, photoUrl: compressedBase64 };
                        if (onSaveProfile) {
                          onSaveProfile(updated);
                        } else {
                          setProfile(updated);
                        }
                      })
                      .catch((err) => {
                        console.error("Failed to compress profile photo, falling back to raw reader:", err);
                        const reader = new FileReader();
                        reader.onloadend = () => {
                          const base64String = reader.result as string;
                          const updated = { ...profile, photoUrl: base64String };
                          if (onSaveProfile) {
                            onSaveProfile(updated);
                          } else {
                            setProfile(updated);
                          }
                        };
                        reader.readAsDataURL(file);
                      });
                  }
                }}
                className="text-xs text-slate-500 dark:text-slate-400 file:mr-2 file:py-1 file:px-2.5 file:rounded-lg file:border-0 file:text-[10px] file:font-bold file:bg-indigo-50 file:text-indigo-600 dark:file:bg-indigo-950/40 dark:file:text-indigo-400 hover:file:bg-indigo-100/50 cursor-pointer w-full"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.nicknameLabel}</label>
              <input
                type="text"
                value={nickname}
                onChange={(e) => setNickname(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.ethnicity}</label>
              <select
                value={ethnicity}
                onChange={(e) => setEthnicity(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-850 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="Unknown">Unknown</option>
                <option value="Chinese">Chinese / East Asian</option>
                <option value="Caucasian">Caucasian</option>
                <option value="South Asian">South Asian</option>
                <option value="African American">African American / Black</option>
                <option value="Hispanic">Hispanic / Latino</option>
                <option value="Southeast Asian">Southeast Asian</option>
                <option value="Other">Mixed / Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.age}</label>
              <input
                type="number"
                value={age === 0 ? '' : age}
                onChange={(e) => setAge(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.weight} (kg)</label>
              <input
                type="number"
                value={weight === 0 ? '' : weight}
                onChange={(e) => setWeight(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">{t.height} (cm)</label>
              <input
                type="number"
                value={height === 0 ? '' : height}
                onChange={(e) => setHeight(e.target.value === '' ? '' : Number(e.target.value))}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Blood Type</label>
              <select
                value={bloodType}
                onChange={(e) => setBloodType(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="">Unknown</option>
                <option value="A+">A+</option>
                <option value="A-">A-</option>
                <option value="B+">B+</option>
                <option value="B-">B-</option>
                <option value="AB+">AB+</option>
                <option value="AB-">AB-</option>
                <option value="O+">O+</option>
                <option value="O-">O-</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Gender</label>
              <select
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="Unknown">Unknown</option>
                <option value="Male">Male</option>
                <option value="Female">Female</option>
                <option value="Other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Unit Preference</label>
              <select
                value={unitPreference}
                onChange={(e) => setUnitPreference(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="SI">SI Units (International)</option>
                <option value="US">US Units</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Timezone</label>
              <select
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="w-full text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
              >
                {TIMEZONES.map(tz => (
                  <option key={tz} value={tz}>{formatTimezone(tz)}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2 bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800/80 rounded-xl px-3 py-2 mt-1 text-left">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Account Email</span>
              <span className="text-xs font-mono text-slate-650 dark:text-slate-300 break-all">{profile.email}</span>
            </div>

            {/* Preferences & Session */}
            <div className="col-span-2 border-t border-slate-100 dark:border-slate-800/85 mt-2 pt-3 text-left">
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Google Health Integration</span>
              <GoogleHealthIntegration profile={profile} />
              
              <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 mt-4">Preferences & Session</span>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {/* Language Selection */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Language</label>
                  <select
                    id="lang-selector"
                    value={profile.language}
                    onChange={(e) => setProfile({ ...profile, language: e.target.value as any })}
                    className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                  >
                    <option value="en">English (EN)</option>
                    <option value="fr">Français (FR)</option>
                    <option value="zh">中文 (ZH)</option>
                    <option value="id">Bahasa Indonesia (ID)</option>
                  </select>
                </div>

                {/* Privacy mode toggle */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Privacy Mode</label>
                  <button
                    type="button"
                    id="toggle-sensitive-btn"
                    onClick={() => setHideSensitive(!hideSensitive)}
                    className="w-full flex items-center justify-between text-sm bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3 py-2 text-slate-850 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 hover:bg-slate-100 dark:hover:bg-slate-800/80 transition-all cursor-pointer"
                  >
                    <span className="truncate">{hideSensitive ? t.sensitiveHidden : t.sensitiveShown}</span>
                    {hideSensitive ? <EyeOff className="w-4.5 h-4.5 text-rose-500 flex-shrink-0" /> : <Eye className="w-4.5 h-4.5 text-slate-400 flex-shrink-0" />}
                  </button>
                </div>
              </div>



              {/* Logout button */}
              <div className="mt-4 border-t border-slate-100 dark:border-slate-800/85 pt-3">
                <button
                  type="button"
                  id="signout-btn"
                  onClick={() => {
                    clearGoogleToken();
                    onSignOut();
                  }}
                  className="w-full flex items-center justify-center gap-2 text-sm bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-950/30 border border-rose-100 dark:border-rose-900/30 rounded-xl px-3 py-2 text-rose-600 dark:text-rose-400 font-semibold transition-colors cursor-pointer"
                >
                  <LogOut className="w-4.5 h-4.5" />
                  <span>{t.signOut}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  ), document.body)}

      {/* Dedicated full-screen or elegant modal Theme Customizer Screen */}
      {showThemeScreen && createPortal((
        <div id="theme-customizer-screen" className="fixed inset-0 z-[60] overflow-y-auto bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animation-fade-in text-slate-800 dark:text-slate-100">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Theme & Accent Settings</h2>
                <p className="text-xs text-slate-450 dark:text-slate-400">Customize the typography and color styling of your portal</p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (onSaveProfile) {
                      onSaveProfile(profile);
                    }
                    setShowThemeScreen(false);
                  }}
                  className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-all cursor-pointer"
                >
                  {t.save}
                </button>
                <button
                  onClick={() => setShowThemeScreen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Content scroll area */}
            <div className="p-6 overflow-y-auto space-y-6 text-left flex-1">
              {/* Theme Reset Button */}
              <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/40 border border-slate-150 dark:border-slate-800 rounded-2xl p-4">
                <div className="space-y-0.5 text-left pr-4">
                  <h4 className="text-sm font-bold text-slate-850 dark:text-slate-200">Reset Custom Theme</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Restore all application colors and typography back to defaults.</p>
                </div>
                <button
                  type="button"
                  onClick={() => setProfile({
                    ...profile,
                    themePalette: {
                      button: '#4f46e5',
                      background: '#f8fafc',
                      border: '#e2e8f0',
                      warning: '#f43f5e',
                      caution: '#d97706',
                      success: '#059669',
                      text: '#1e293b',
                      textSecondary: '#64748b',
                      bgApp: '#f8fafc',
                      bgCard: '#ffffff',
                      neutralSetting: '#334155'
                    }
                  })}
                  className="px-4 py-2 bg-slate-150 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold cursor-pointer transition-all shadow-sm shrink-0"
                >
                  Reset Theme
                </button>
              </div>

              {/* Editable Color Pickers */}
              <div className="space-y-4">
                <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Fine-Tune Colors (All App Accents)</span>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <ColorPickerField 
                    label="Buttons & Highlights" 
                    value={profile.themePalette?.button || '#4f46e5'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), button: v}})} 
                  />
                  <ColorPickerField 
                    label="App Background" 
                    value={profile.themePalette?.background || '#f8fafc'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), background: v, bgApp: v}})} 
                  />
                  <ColorPickerField 
                    label="Card & Containers" 
                    value={profile.themePalette?.bgCard || '#ffffff'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), bgCard: v}})} 
                  />
                  <ColorPickerField 
                    label="Borders & Dividers" 
                    value={profile.themePalette?.border || '#e2e8f0'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), border: v}})} 
                  />
                  <ColorPickerField 
                    label="Primary Text" 
                    value={profile.themePalette?.text || '#1e293b'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), text: v}})} 
                  />
                  <ColorPickerField 
                    label="Secondary Text" 
                    value={profile.themePalette?.textSecondary || '#64748b'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), textSecondary: v}})} 
                  />
                  <ColorPickerField 
                    label="Severe Warnings (Rose)" 
                    value={profile.themePalette?.warning || '#f43f5e'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), warning: v}})} 
                  />
                  <ColorPickerField 
                    label="Caution / Moderate (Amber)" 
                    value={profile.themePalette?.caution || '#d97706'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), caution: v}})} 
                  />
                  <ColorPickerField 
                    label="Success Highlights (Green)" 
                    value={profile.themePalette?.success || '#059669'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), success: v}})} 
                  />
                  <ColorPickerField 
                    label="Neutral Accents" 
                    value={profile.themePalette?.neutralSetting || '#334155'} 
                    onChange={(v) => setProfile({...profile, themePalette: {...(profile.themePalette || {}), neutralSetting: v}})} 
                  />
                </div>
              </div>

              {/* Typography Customization */}
              <div className="space-y-4 border-t border-slate-100 dark:border-slate-800/80 pt-4">
                <span className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Application Typography</span>
                
                <div className="space-y-3">
                  {/* Typography Scales */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Title Size</label>
                      <select
                        value={profile.fontSizeTitle || 'normal'}
                        onChange={(e) => setProfile({ ...profile, fontSizeTitle: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                        <option value="large">Large (18px)</option>
                        <option value="xl">XL (20px)</option>
                        <option value="xxl">2XL (24px)</option>
                        <option value="3xl">3XL (30px)</option>
                        <option value="4xl">4XL (36px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Subtitle Size</label>
                      <select
                        value={profile.fontSizeSubtitle || 'normal'}
                        onChange={(e) => setProfile({ ...profile, fontSizeSubtitle: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="tiny">Tiny (12px)</option>
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                        <option value="large">Large (18px)</option>
                        <option value="xl">XL (20px)</option>
                        <option value="xxl">2XL (24px)</option>
                        <option value="3xl">3XL (30px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Body / Desc Size</label>
                      <select
                        value={profile.fontSizeDescription || 'normal'}
                        onChange={(e) => setProfile({ ...profile, fontSizeDescription: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="tiny">Tiny (12px)</option>
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                        <option value="large">Large (18px)</option>
                        <option value="xl">XL (20px)</option>
                        <option value="xxl">2XL (24px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Body Small Size</label>
                      <select
                        value={profile.fontSizeBodySmall || 'small'}
                        onChange={(e) => setProfile({ ...profile, fontSizeBodySmall: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="tiny">Tiny (12px)</option>
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                        <option value="large">Large (18px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Subtitle Small Size</label>
                      <select
                        value={profile.fontSizeSubtitleSmall || 'small'}
                        onChange={(e) => setProfile({ ...profile, fontSizeSubtitleSmall: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="tiny">Tiny (12px)</option>
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                        <option value="large">Large (18px)</option>
                        <option value="xl">XL (20px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Key Metric Size</label>
                      <select
                        value={profile.fontSizeKeyMetric || '4xl'}
                        onChange={(e) => setProfile({ ...profile, fontSizeKeyMetric: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="large">Large (18px)</option>
                        <option value="xl">XL (20px)</option>
                        <option value="xxl">2XL (24px)</option>
                        <option value="3xl">3xl (30px)</option>
                        <option value="4xl">4xl (36px)</option>
                        <option value="5xl">5xl (48px)</option>
                        <option value="6xl">6xl (60px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Smallest Size (XS)</label>
                      <select
                        value={profile.fontSizeXS || 'tiny'}
                        onChange={(e) => setProfile({ ...profile, fontSizeXS: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="tiny">Tiny (12px)</option>
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Body Standard Size</label>
                      <select
                        value={profile.fontSizeBody || 'normal'}
                        onChange={(e) => setProfile({ ...profile, fontSizeBody: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="tiny">Tiny (12px)</option>
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                        <option value="large">Large (18px)</option>
                        <option value="xl">XL (20px)</option>
                      </select>
                    </div>
                    <div className="space-y-1 text-left col-span-2">
                      <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Base Root Size</label>
                      <select
                        value={profile.fontSize || 'normal'}
                        onChange={(e) => setProfile({ ...profile, fontSize: e.target.value as any })}
                        className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                      >
                        <option value="tiny">Tiny (12px)</option>
                        <option value="small">Small (14px)</option>
                        <option value="normal">Normal (16px)</option>
                        <option value="large">Large (18px)</option>
                        <option value="xl">XL (20px)</option>
                        <option value="xxl">2XL (24px)</option>
                      </select>
                    </div>
                  </div>

                  {/* Sans-Serif Font Family Dropdown */}
                  <div className="space-y-1 text-left">
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Primary Font Face (Sans-Serif)</label>
                    <select
                      value={profile.fontFamily || 'Inter'}
                      onChange={(e) => setProfile({ ...profile, fontFamily: e.target.value })}
                      className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2.5 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                    >
                      <option value="Inter">Inter - Elegant Swiss utility</option>
                      <option value="Space Grotesk">Space Grotesk - Neo-brutalist display</option>
                      <option value="Outfit">Outfit - Warm geometric sans</option>
                      <option value="Playfair Display">Playfair Display - Elegant Editorial Serif</option>
                      <option value="Merriweather">Merriweather - Highly readable Serif</option>
                      <option value="system-ui">System UI - Fast default system native</option>
                    </select>
                  </div>

                  {/* Monospace Font Family Dropdown */}
                  <div className="space-y-1 text-left">
                    <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400">Technical Font Face (Monospace)</label>
                    <select
                      value={profile.fontMono || 'JetBrains Mono'}
                      onChange={(e) => setProfile({ ...profile, fontMono: e.target.value })}
                      className="w-full text-sm font-sans bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-2xl px-3 py-2.5 text-slate-850 dark:text-slate-100 focus:outline-none cursor-pointer"
                    >
                      <option value="JetBrains Mono">JetBrains Mono - Clear code spacing</option>
                      <option value="Courier New">Courier New - Traditional Typewriter</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Live Preview Box */}
              <div className="border border-slate-200 dark:border-slate-800 rounded-3xl p-4 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 space-y-4">
                <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider text-left">Live Aesthetic Preview Sandbox</span>
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-4 text-left shadow-sm">
                  <div className="space-y-1">
                    <h4 className="text-lg font-bold font-display text-slate-900 dark:text-slate-100">Heading Title</h4>
                    <h5 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Subtitle Element</h5>
                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                      This is secondary description text demonstrating typography scaling and color weight pairing. This helps visualize spacing and readability.
                    </p>
                  </div>
                  
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-1 text-xs font-semibold text-rose-500 bg-rose-50 dark:bg-rose-950/30 rounded-lg border border-rose-100 dark:border-rose-900/50">Severe Alert</span>
                    <span className="px-2 py-1 text-xs font-semibold text-amber-500 bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-100 dark:border-amber-900/50">Moderate</span>
                    <span className="px-2 py-1 text-xs font-semibold text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg border border-emerald-100 dark:border-emerald-900/50">Healthy</span>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-semibold transition-colors">
                      Secondary
                    </button>
                    <button className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-sm transition-colors">
                      Primary Action
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ), document.body)}

      {/* Database Interactions Live Sync Overlay */}
      {showDbInteractionsOverlay && createPortal((
        <div id="db-interactions-overlay" className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl w-full max-w-xl overflow-hidden flex flex-col max-h-[80vh] animation-fade-in text-slate-850 dark:text-slate-100">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-indigo-600" />
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Settings</h2>
                  <span className="text-xs font-normal text-slate-400 block mt-0.5">
                    {(() => {
                      const buildTime = serverStartTime || 1782721085000;
                      const diffMs = Math.max(0, now - buildTime);
                      const diffMins = Math.floor(diffMs / 60000);
                      return diffMins < 1 ? 'last published just now' : `last published ${diffMins} min ago`;
                    })()}
                  </span>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                {dbOverlayViewMode === 'admin' && (
                  <button
                    onClick={() => setShowAgentLogs(true)}
                    className="p-1.5 rounded-lg text-indigo-600 bg-indigo-50 dark:text-indigo-400 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
                    title="View AI Agent Logs"
                  >
                    <Terminal className="w-4 h-4" /> View AI Logs
                  </button>
                )}
                {onCloudSync && (

                  <button
                    onClick={() => {
                      if (onCloudSync) onCloudSync();
                    }}
                    className="p-1.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer flex items-center gap-1 text-xs font-bold"
                    title="Manual Sync"
                  >
                    <RefreshCw className="w-4 h-4" /> Sync Now
                  </button>
                )}
                <button
                  onClick={() => setShowDbInteractionsOverlay(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Content area */}
            <div className="p-6 overflow-y-auto space-y-6 text-left flex-1">
              
              {dbOverlayViewMode === 'admin' && (
                <div className="p-4 bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/20 dark:border-amber-800/20 rounded-2xl flex items-start gap-3">
                  <div className="bg-amber-100 dark:bg-amber-900/40 p-2 rounded-xl text-amber-600 dark:text-amber-400 shrink-0">
                    <CloudLightning className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                      Offline First Database Mode
                    </h3>
                    <p className="text-xs text-amber-605 dark:text-amber-400/80 mt-1 leading-relaxed">
                      All operations are recorded <strong>offline first</strong> in local secure storage, allowing you to view and interact with your health data instantly even when cloud quotas are temporarily exhausted. Data changes will be automatically queued and safely synchronized with the cloud database.
                    </p>
                  </div>
                </div>
              )}

              {/* Admin / User View Toggle */}
              {profile?.email?.toLowerCase().trim() === 'cwah.liu@gmail.com' && (
                <div className="flex bg-slate-100 dark:bg-slate-850 p-1 rounded-2xl border border-slate-200/60 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setDbOverlayViewMode('user');
                      localStorage.setItem('health_cockpit_admin_mode', 'user');
                    }}
                    className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      dbOverlayViewMode === 'user'
                        ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-md border border-slate-200/20'
                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <User className="w-4 h-4" />
                    User View
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDbOverlayViewMode('admin');
                      localStorage.setItem('health_cockpit_admin_mode', 'admin');
                    }}
                    className={`flex-1 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                      dbOverlayViewMode === 'admin'
                        ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 shadow-md border border-slate-200/20'
                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4" />
                    Admin View
                  </button>
                </div>
              )}

              {dbOverlayViewMode === 'admin' && (
                <div className="space-y-4">
                  <div className="p-4 bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-800/30 rounded-2xl flex items-center gap-3">
                    <div className="bg-rose-100 dark:bg-rose-900/40 p-2 rounded-xl text-rose-600 dark:text-rose-400">
                      <ShieldCheck className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-rose-800 dark:text-rose-300">Admin Account Confirmed</h3>
                      <p className="text-xs text-rose-600 dark:text-rose-400/80 mt-0.5 font-medium">
                        This account is verified as the system administrator with full read/write, sync, and override privileges.
                      </p>
                    </div>
                  </div>

                  {/* Google Workspace Cloud Backup Utility */}
                  <div className="p-4 bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-3">
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                        <Archive className="w-4.5 h-4.5 text-indigo-500" />
                        <span>Google Workspace Backups</span>
                      </h4>
                      <p className="text-[10px] text-slate-500 mt-1">
                        Secure, password-protected snapshots of all accounts (profiles, biomarkers, clinical actions, and meal logs) written directly to Google Drive & Sheet.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-1">
                      <button
                        type="button"
                        onClick={handleOpenBackup}
                        className="p-3 bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500 text-white font-bold rounded-xl text-xs flex flex-col items-center justify-center gap-1.5 transition-all shadow-sm cursor-pointer hover:scale-[1.01]"
                      >
                        <CloudUpload className="w-4.5 h-4.5" />
                        <span>Backup Data</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleOpenRestore}
                        className="p-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 font-bold rounded-xl text-xs flex flex-col items-center justify-center gap-1.5 transition-all cursor-pointer hover:scale-[1.01]"
                      >
                        <CloudDownload className="w-4.5 h-4.5" />
                        <span>Restore Data</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Interaction statistics row */}
              {dbOverlayViewMode === 'admin' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-100/30 rounded-2xl relative overflow-hidden">
                    <div className="absolute inset-0 bg-indigo-600/5 dark:bg-indigo-400/5 w-full" style={{ width: `${Math.max(2, (dbInteractions.filter(i => i.type === 'upload' && i.status === 'completed').reduce((sum, i) => sum + i.sizeBytes, 0) / Math.max(1, dbInteractions.filter(i => i.type === 'upload').reduce((sum, i) => sum + i.sizeBytes, 0))) * 100)}%` }} />
                    <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wider mb-1">Upload Pipeline</span>
                    <div className="flex items-end justify-between">
                      <span className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 relative z-10">
                        {(dbInteractions.filter(i => i.type === 'upload' && i.status === 'completed').reduce((sum, i) => sum + i.sizeBytes, 0) / 1024).toFixed(2)} KB
                      </span>
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100 dark:bg-indigo-900/40 px-1.5 py-0.5 rounded relative z-10">
                        {dbInteractions.filter(i => i.type === 'upload' && i.status === 'pending').length} pending
                      </span>
                    </div>
                    <span className="block text-[10px] text-slate-500 mt-1.5 font-medium relative z-10 truncate">
                      <strong className="text-slate-700 dark:text-slate-300">{(dbInteractions.filter(i => i.type === 'upload' && i.status === 'completed').reduce((sum, i) => sum + i.sizeBytes, 0) / 1024).toFixed(2)} KB</strong> achieved / {(dbInteractions.filter(i => i.type === 'upload').reduce((sum, i) => sum + i.sizeBytes, 0) / 1024).toFixed(2)} KB needed
                    </span>
                  </div>
                  
                  <div className="p-4 bg-emerald-50/40 dark:bg-emerald-950/20 border border-emerald-100/30 rounded-2xl relative overflow-hidden">
                    <div className="absolute inset-0 bg-emerald-600/5 dark:bg-emerald-400/5 w-full" style={{ width: `${Math.max(2, (dbInteractions.filter(i => i.type === 'download' && i.status === 'completed').reduce((sum, i) => sum + (i.sizeBytes || 1024), 0) / Math.max(1, dbInteractions.filter(i => i.type === 'download').reduce((sum, i) => sum + (i.sizeBytes || 1024), 0))) * 100)}%` }} />
                    <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wider mb-1">Download Pipeline</span>
                    <div className="flex items-end justify-between">
                      <span className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 relative z-10">
                        {(dbInteractions.filter(i => i.type === 'download' && i.status === 'completed').reduce((sum, i) => sum + i.sizeBytes, 0) / 1024).toFixed(2)} KB
                      </span>
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40 px-1.5 py-0.5 rounded relative z-10">
                        {dbInteractions.filter(i => i.type === 'download' && i.status === 'pending').length} pending
                      </span>
                    </div>
                    <span className="block text-[10px] text-slate-500 mt-1.5 font-medium relative z-10 truncate">
                      <strong className="text-slate-700 dark:text-slate-300">{(dbInteractions.filter(i => i.type === 'download' && i.status === 'completed').length)}</strong> achieved / {dbInteractions.filter(i => i.type === 'download').length} needed
                    </span>
                  </div>
                </div>
              )}

              {/* Images Quota */}
              {dbOverlayViewMode === 'admin' && (
                <div className="p-4 bg-blue-50/40 dark:bg-blue-950/20 border border-blue-100/30 rounded-2xl">
                  <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wider mb-1">Database Images (5GB Limit)</span>
                  <div className="flex items-end justify-between">
                    <span className="text-lg font-mono font-semibold text-slate-900 dark:text-slate-100 relative z-10">
                      {foodLogs.reduce((acc, log) => acc + (log.imageUrls?.length || 0) + (log.imageUrl ? 1 : 0), 0)} Images
                    </span>
                    <span className="text-xs font-bold text-blue-600 bg-blue-100 dark:bg-blue-900/40 px-1.5 py-0.5 rounded relative z-10">
                      {(foodLogs.reduce((acc, log) => acc + (log.imageUrl ? log.imageUrl.length : 0) + (log.imageUrls ? log.imageUrls.reduce((sum, img) => sum + img.length, 0) : 0), 0) / (1024 * 1024)).toFixed(2)} MB
                    </span>
                  </div>
                </div>
              )}

              {/* AI Agent Live thinking / Debug Logs section */}
              {dbOverlayViewMode === 'admin' && (
                <div className="p-4 bg-slate-50 dark:bg-slate-900/40 border border-slate-150 dark:border-slate-800 rounded-2xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <span className="block text-[10px] font-bold text-slate-400 dark:text-slate-550 uppercase tracking-wider">
                        🔬 AI Agent Live thinking Process
                      </span>
                      <span className="text-[11px] text-slate-500 dark:text-slate-400 block">
                        View real-time LLM API handshakes & timeouts
                      </span>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer select-none">
                      <input 
                        type="checkbox" 
                        className="sr-only peer" 
                        checked={debugMode}
                        onChange={(e) => handleToggleDebugMode(e.target.checked)}
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-750 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-indigo-600"></div>
                    </label>
                  </div>
                </div>
              )}

              {/* List of transactions */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider">Sync Transaction Activity Feed</span>
                  <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                    {dbInteractions.length} Total Logs
                  </span>
                </div>

                {dbInteractions.length === 0 ? (
                  <div className="text-center py-8 text-xs text-slate-450 bg-slate-50 dark:bg-slate-850 rounded-2xl border border-dashed border-slate-250 dark:border-slate-800">
                    No active transactions logged in this session yet. Tapping sync or updating your records will populate this feed.
                  </div>
                ) : (
                  <div className="border border-slate-150 dark:border-slate-800/80 rounded-2xl overflow-hidden max-h-60 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-900 dark:bg-slate-950 border-b border-slate-800 text-[10px] font-bold text-white uppercase tracking-wider">
                          <th className="p-3">Time / Type</th>
                          <th className="p-3">Path & Payload</th>
                          <th className="p-3 text-right">Size</th>
                          <th className="p-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {dbInteractions.map((op) => (
                          <tr key={op.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/20">
                            <td className="p-3">
                              <span className="block font-mono text-[10px] text-slate-400">{op.timestamp}</span>
                              <span className={`inline-block text-[9px] font-bold px-1.5 py-0.2 rounded-md ${
                                op.type === 'upload' ? 'bg-blue-50 text-blue-600 dark:bg-blue-950/25 dark:text-blue-400' :
                                op.type === 'download' ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/25 dark:text-emerald-400' :
                                op.type === 'delete' ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/25 dark:text-rose-400' :
                                'bg-amber-50 text-amber-600 dark:bg-amber-950/25 dark:text-amber-400'
                              }`}>
                                {op.type.toUpperCase()}
                              </span>
                            </td>
                            <td className="p-3 font-mono text-[10px] max-w-[180px] truncate" title={op.path}>
                              {op.path}
                            </td>
                            <td className="p-3 text-right font-mono text-slate-650 dark:text-slate-350">
                              {op.sizeBytes > 0 ? `${op.sizeBytes} B` : '-'}
                            </td>
                            <td className="p-3 text-center">
                              <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                op.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400' :
                                op.status === 'pending' ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/30 dark:text-blue-400 animate-pulse' :
                                'bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400'
                              }`}>
                                {op.status} {op.status === 'pending' && op.startTimeMs ? `(${Math.floor((now - op.startTimeMs) / 1000)}s)` : ''}
                              </span>
                              {op.status === 'pending' && op.startTimeMs && now - op.startTimeMs > 5000 && (
                                <span className="block text-[9px] text-amber-600 dark:text-amber-500 mt-1" title="Waiting for server acknowledgment or offline sync queue">
                                  Waiting for connection...
                                </span>
                              )}
                              {op.errorMessage && (
                                <span className="block text-[9px] text-rose-500 mt-1 text-left max-w-[120px] truncate" title={op.errorMessage}>
                                  {op.errorMessage}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center">
              <div className="flex gap-2">
                <button
                  onClick={onForcePull || onCloudSync}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-xs font-bold rounded-2xl hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                  title="Overwrite local data with cloud data"
                >
                  Force Pull
                </button>
                <button
                  onClick={onForcePush}
                  className="px-4 py-2 bg-indigo-50 dark:bg-indigo-950/20 text-indigo-600 dark:text-indigo-400 border border-indigo-200/40 text-xs font-bold rounded-2xl hover:bg-indigo-100/50 cursor-pointer"
                  title="Overwrite cloud data with local data"
                >
                  Force Push
                </button>
              </div>
              <button
                onClick={() => setShowDbInteractionsOverlay(false)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-2xl shadow-sm cursor-pointer transition-all"
              >
                Close Logs
              </button>
            </div>
          </div>
        </div>
      ), document.body)}

      {/* Backup Modal Overlay */}
      {showBackupModal && createPortal((
        <div id="backup-modal-overlay" className="fixed inset-0 z-[10000] bg-slate-900/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animation-fade-in text-slate-800 dark:text-slate-100">
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-indigo-50/50 dark:bg-indigo-950/25">
              <div className="flex items-center gap-2.5">
                <CloudUpload className="w-5.5 h-5.5 text-indigo-600 dark:text-indigo-400" />
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Create Secured Cloud Backup</h2>
                  <span className="text-[10px] text-slate-500 font-medium block mt-0.5">Saves all patient logs and metadata in a password-secured ZIP archive</span>
                </div>
              </div>
              <button
                onClick={() => setShowBackupModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-850 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Content Area */}
            <div className="p-6 overflow-y-auto space-y-5 text-left flex-1">
              {backupStatus === 'idle' && (
                <form onSubmit={handleExecuteBackup} className="space-y-4">
                  {/* Version */}
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Backup Version Name
                    </label>
                    <input
                      type="text"
                      value={backupVersion}
                      onChange={(e) => setBackupVersion(e.target.value)}
                      placeholder="e.g., V1, V2, V1-initial"
                      className="w-full text-sm px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100"
                      required
                    />
                  </div>

                  {/* Password */}
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-indigo-500" />
                      <span>ZIP Encryption Password</span>
                    </label>
                    <input
                      type="password"
                      value={backupPassword}
                      onChange={(e) => setBackupPassword(e.target.value)}
                      placeholder="Enter a secure password to encrypt files"
                      className="w-full text-sm px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100"
                      required
                    />
                    <p className="text-[10px] text-slate-400 mt-1">This password will be required to decrypt and restore the records.</p>
                  </div>

                  {/* Comment */}
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Backup Comments / Notes
                    </label>
                    <textarea
                      value={backupComment}
                      onChange={(e) => setBackupComment(e.target.value)}
                      placeholder="Add an optional comment to log in the Sheets registry..."
                      rows={3}
                      className="w-full text-sm px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100 resize-none"
                    />
                  </div>

                  {backupError && (
                    <div className="p-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-250 dark:border-rose-900/30 rounded-2xl flex items-start gap-2 text-xs text-rose-600 dark:text-rose-400">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{backupError}</span>
                    </div>
                  )}

                  <div className="pt-2 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowBackupModal(false)}
                      className="w-1/2 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="w-1/2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-xs transition-colors cursor-pointer shadow-md"
                    >
                      Execute Secured Backup
                    </button>
                  </div>
                </form>
              )}

              {backupStatus === 'processing' && (
                <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                  <div className="w-12 h-12 rounded-full border-4 border-indigo-600/25 border-t-indigo-600 animate-spin" />
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Creating secure cloud backup archive...</h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">Fetching account records, serializing biomarker history, resolving meal photos, compiling spreadsheet, encrypting with AES, and syncing with Google Workspace...</p>
                  </div>
                </div>
              )}

              {backupStatus === 'success' && backupResult && (
                <div className="space-y-5 py-2">
                  <div className="p-4 bg-emerald-50/60 dark:bg-emerald-950/25 border border-emerald-250 dark:border-emerald-900/40 rounded-3xl flex items-start gap-3">
                    <div className="p-2 bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 rounded-2xl shrink-0">
                      <Check className="w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-emerald-800 dark:text-emerald-400">Secure Backup Completed Successfully!</h3>
                      <p className="text-xs text-emerald-600 dark:text-emerald-500/80 mt-1 font-medium">
                        The encrypted archive has been saved to your Google Drive and logged in the 'Health Cockpit Backup Registry' Sheet.
                      </p>
                    </div>
                  </div>

                  <div className="p-4 bg-slate-50 dark:bg-slate-950 border border-slate-150 dark:border-slate-850 rounded-2xl space-y-2">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Archive Metadata & Stats</span>
                    <div className="grid grid-cols-2 gap-4 text-xs font-medium">
                      <div>
                        <span className="text-slate-500 block">Backup Filename</span>
                        <span className="font-mono text-slate-850 dark:text-slate-200 font-semibold">{backupResult.filename}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Accounts Snapped</span>
                        <span className="text-slate-850 dark:text-slate-200 font-bold">{backupResult.stats.accountsCount}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Total Biomarkers</span>
                        <span className="text-slate-850 dark:text-slate-200 font-bold">{backupResult.stats.totalBiomarkers}</span>
                      </div>
                      <div>
                        <span className="text-slate-500 block">Total meal pictures</span>
                        <span className="text-slate-850 dark:text-slate-200 font-bold">{backupResult.stats.totalImages}</span>
                      </div>
                    </div>
                  </div>

                  {/* Individual breakdown list */}
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Individual Accounts Details</span>
                    <div className="divide-y divide-slate-100 dark:divide-slate-850 border border-slate-150 dark:border-slate-850 rounded-2xl overflow-hidden">
                      {backupResult.stats.details?.map((item: any, idx: number) => (
                        <div key={idx} className="p-3 bg-white dark:bg-slate-900 flex justify-between items-center text-xs">
                          <div>
                            <span className="font-bold text-slate-800 dark:text-slate-200 block">{item.nickname}</span>
                            <span className="text-[10px] text-slate-500 block font-mono">{item.email}</span>
                          </div>
                          <div className="text-right space-y-0.5">
                            <span className="block text-[10px] font-semibold text-slate-600 dark:text-slate-400">{item.biomarkers} biomarkers</span>
                            <span className="block text-[10px] text-slate-500">{item.images} photos</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={() => setShowBackupModal(false)}
                    className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-xs transition-colors cursor-pointer shadow-md"
                  >
                    Close Backup Panel
                  </button>
                </div>
              )}

              {backupStatus === 'error' && (
                <div className="space-y-4 py-2 text-center">
                  <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/45 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mx-auto">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Backup Generation Failed</h3>
                    <p className="text-xs text-rose-600 dark:text-rose-400/80 max-w-sm mx-auto">{backupError}</p>
                  </div>
                  <div className="flex gap-3 pt-2">
                    <button
                      onClick={() => setBackupStatus('idle')}
                      className="w-1/2 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                    >
                      Try Again
                    </button>
                    <button
                      onClick={() => setShowBackupModal(false)}
                      className="w-1/2 py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                    >
                      Close
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ), document.body)}

      {/* Restore Modal Overlay */}
      {showRestoreModal && createPortal((
        <div id="restore-modal-overlay" className="fixed inset-0 z-[10000] bg-slate-900/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh] animation-fade-in text-slate-800 dark:text-slate-100">
            {/* Header */}
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-indigo-50/50 dark:bg-indigo-950/25">
              <div className="flex items-center gap-2.5">
                <CloudDownload className="w-5.5 h-5.5 text-indigo-600 dark:text-indigo-400" />
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Restore Database Records</h2>
                  <span className="text-[10px] text-slate-500 font-medium block mt-0.5">Restore data structures from Google Drive encrypted ZIP archives</span>
                </div>
              </div>
              <button
                onClick={() => setShowRestoreModal(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-850 transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Content Area */}
            <div className="p-6 overflow-y-auto space-y-4 text-left flex-1">
              {restoreStatus === 'listing' && (
                <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                  <div className="w-12 h-12 rounded-full border-4 border-indigo-600/25 border-t-indigo-600 animate-spin" />
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Listing Google Drive snapshots...</h3>
                    <p className="text-xs text-slate-500">Querying backup files matching encryption schema from your Drive...</p>
                  </div>
                </div>
              )}

              {restoreStatus === 'downloading' && (
                <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                  <div className="w-12 h-12 rounded-full border-4 border-indigo-600/25 border-t-indigo-600 animate-spin" />
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Downloading archive payload...</h3>
                    <p className="text-xs text-slate-500">Retrieving full encrypted snapshot binary from Google Drive safely...</p>
                  </div>
                </div>
              )}

              {restoreStatus === 'restoring' && (
                <div className="py-12 flex flex-col items-center justify-center space-y-4 text-center">
                  <div className="w-12 h-12 rounded-full border-4 border-indigo-600/25 border-t-indigo-600 animate-spin" />
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Rebuilding records in Firestore...</h3>
                    <p className="text-xs text-slate-500">Overwriting subcollections, setting biomarkers, and committing batch mutations to Firebase.</p>
                  </div>
                </div>
              )}

              {/* Stage 1: Select Archive file */}
              {restoreStatus === 'idle' && selectedRestoreFile === null && (
                <div className="space-y-4">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Available Backup Archives</span>
                  {restoreFiles.length === 0 ? (
                    <div className="text-center py-10 text-xs text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/50">
                      No matching backup archives found in your Google Drive. Ensure you have run a backup first.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                      {restoreFiles.map((file) => (
                        <button
                          key={file.id}
                          onClick={() => handleSelectRestoreFile(file)}
                          className="w-full text-left p-3.5 bg-slate-50 hover:bg-slate-100 dark:bg-slate-950 dark:hover:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center justify-between cursor-pointer group transition-all"
                        >
                          <div className="flex items-center gap-3">
                            <Archive className="w-5 h-5 text-indigo-500 group-hover:scale-105 transition-transform" />
                            <div>
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block truncate max-w-[280px]">{file.name}</span>
                              <span className="text-[10px] text-slate-400 block">{new Date(file.createdTime).toLocaleString()}</span>
                            </div>
                          </div>
                          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-100/60 dark:bg-indigo-950/50 px-2 py-1 rounded-lg">Select</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => setShowRestoreModal(false)}
                    className="w-full py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              )}

              {/* Stage 2: Decrypt with password */}
              {selectedRestoreFile !== null && restoreStatus !== 'preview' && restoreStatus !== 'success' && restoreStatus !== 'restoring' && restoreStatus !== 'downloading' && (
                <form onSubmit={handleLoadAndDecryptBackup} className="space-y-4">
                  <div className="p-3.5 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-150 dark:border-indigo-900/30 rounded-2xl flex items-start gap-2.5 text-xs">
                    <Archive className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold text-slate-850 dark:text-slate-200 block">Selected Snapshot Archive</span>
                      <span className="font-mono text-slate-500 block mt-0.5">{selectedRestoreFile.name}</span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <KeyRound className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Archive Decryption Password</span>
                    </label>
                    <input
                      type="password"
                      value={restorePassword}
                      onChange={(e) => setRestorePassword(e.target.value)}
                      placeholder="Enter the secure password used for this backup"
                      className="w-full text-sm px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100"
                      required
                    />
                  </div>

                  {restoreError && (
                    <div className="p-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-250 dark:border-rose-900/30 rounded-2xl flex items-start gap-2 text-xs text-rose-600 dark:text-rose-400">
                      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{restoreError}</span>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => handleSelectRestoreFile(null)}
                      className="w-1/2 py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                    >
                      Change File
                    </button>
                    <button
                      type="submit"
                      className="w-1/2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-xs transition-colors cursor-pointer shadow-md"
                    >
                      Decrypt & Load Preview
                    </button>
                  </div>
                </form>
              )}

              {/* Stage 3: Preview list & Target options */}
              {restoreStatus === 'preview' && (
                <div className="space-y-4">
                  <div className="p-4 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-250 dark:border-amber-900/30 rounded-2xl">
                    <span className="text-[10px] font-bold text-amber-800 dark:text-amber-400 uppercase tracking-wider block">Decryption Preview Verified</span>
                    <div className="grid grid-cols-3 gap-3 text-center text-xs mt-2.5 font-bold text-slate-800 dark:text-slate-100">
                      <div className="p-2 bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-850 rounded-xl">
                        <span className="text-[10px] text-slate-400 block font-normal">Accounts</span>
                        {restorePreviewData.length}
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-850 rounded-xl">
                        <span className="text-[10px] text-slate-400 block font-normal">Biomarkers</span>
                        {restorePreviewData.reduce((sum, a) => sum + a.biomarkerCount, 0)}
                      </div>
                      <div className="p-2 bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-850 rounded-xl">
                        <span className="text-[10px] text-slate-400 block font-normal">Images</span>
                        {restorePreviewData.reduce((sum, a) => sum + a.imageCount, 0)}
                      </div>
                    </div>
                  </div>

                  {/* Restorable Accounts Table */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Archive Accounts Contents</span>
                    <div className="border border-slate-150 dark:border-slate-800 rounded-2xl overflow-hidden max-h-40 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-850">
                      {restorePreviewData.map((item, idx) => (
                        <div key={idx} className="p-3 bg-slate-50/50 dark:bg-slate-950/30 flex justify-between items-center text-xs">
                          <div>
                            <span className="font-bold text-slate-850 dark:text-slate-200 block">{item.nickname}</span>
                            <span className="text-[10px] text-slate-500 block font-mono">{item.email}</span>
                          </div>
                          <div className="text-right text-[10px] text-slate-550 dark:text-slate-400 space-y-0.5">
                            <span className="block font-semibold">{item.biomarkerCount} biomarkers</span>
                            <span className="block">{item.imageCount} images</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Restoration Target Dropdown */}
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                      Restoration Scope
                    </label>
                    <select
                      value={restoreTargetAccount}
                      onChange={(e) => setRestoreTargetAccount(e.target.value)}
                      className="w-full text-xs px-4 py-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-850 dark:text-slate-100 font-medium"
                    >
                      <option value="all">Restore All Accounts in Backup File</option>
                      {restorePreviewData.map((item, idx) => (
                        <option key={idx} value={item.email}>
                          Only Restore Specific Account: {item.nickname} ({item.email})
                        </option>
                      ))}
                    </select>
                  </div>

                  {restoreError && (
                    <div className="p-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-250 dark:border-rose-900/30 rounded-2xl flex items-start gap-2 text-xs text-rose-600 dark:text-rose-400">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{restoreError}</span>
                    </div>
                  )}

                  <div className="flex gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setRestoreStatus('idle');
                        setSelectedRestoreFile(null);
                        setRestorePreviewData([]);
                      }}
                      className="w-1/3 py-3.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                    >
                      Go Back
                    </button>
                    <button
                      onClick={handleExecuteRestore}
                      className="w-2/3 py-3.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-2xl text-xs transition-colors cursor-pointer shadow-md flex items-center justify-center gap-1.5"
                    >
                      <Unlock className="w-4 h-4" />
                      <span>Execute Restore Operation</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Stage 5: Success */}
              {restoreStatus === 'success' && (
                <div className="space-y-4 py-2 text-center">
                  <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-950/45 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto">
                    <Check className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Database Restored Successfully!</h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">All medical profiles, biomarker logs, actions, and meal logs have been fully recovered in Firestore and local databases.</p>
                  </div>
                  <button
                    onClick={() => {
                      setShowRestoreModal(false);
                      // Refresh dashboard state
                      window.location.reload();
                    }}
                    className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                  >
                    Close & Reload Application
                  </button>
                </div>
              )}

              {/* Stage 6: Error */}
              {restoreStatus === 'error' && (
                <div className="space-y-4 py-2 text-center">
                  <div className="w-12 h-12 bg-rose-100 dark:bg-rose-950/45 text-rose-600 dark:text-rose-400 rounded-full flex items-center justify-center mx-auto">
                    <AlertTriangle className="w-6 h-6" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Restoration Operation Failed</h3>
                    <p className="text-xs text-rose-600 dark:text-rose-400/80 max-w-sm mx-auto">{restoreError}</p>
                  </div>
                  <button
                    onClick={() => {
                      setRestoreStatus('idle');
                      setSelectedRestoreFile(null);
                      setRestorePreviewData([]);
                    }}
                    className="w-full py-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-xs transition-colors cursor-pointer"
                  >
                    Go Back to File Selection
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      ), document.body)}
    </>
  );
}
