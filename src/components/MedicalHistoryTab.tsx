import { toYYYYMMDD } from "../utils/dateUtils";
import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { UserProfile, BiomarkerLog, ChatMessage, FoodLog } from '../types';
import { translations } from '../utils/translations';
import { ShieldAlert, ClipboardList, Trash2, ChevronDown, ChevronUp, LineChart as LineChartIcon, BrainCircuit, AlertCircle, Clock, CheckCircle2, EyeOff } from 'lucide-react';
import { standardizeUnit, reverseStandardizeUnit, formatNormalRange } from '../utils/unitConversion';
import { biomarkerDefinitions, getBiomarkerStatus, getBiomarkerColor, getBiomarkerStatusLabel, getBiomarkerRiskTag, BiomarkerDefinition, isAsianEthnicity, getPhysiologicalBucket, getBiomarkerMetadata, BIOMARKER_GROUPING_OPTIONS, getCustomBiomarkerDef, getMergedBiomarkerDef, isBiomarkerApproved, isValEmpty, isBiomarkerMissingRange, isBiomarkerNeedingReview, detectFlaggedTelemetryErrors, buildBiomarkerReviewPrefill } from '../utils/biomarkers';
import { getAgentCalibration, formatOptimalTargetValue } from '../utils/agentCalibration';

const getBiomarkerDef = (key: string) => biomarkerDefinitions.find(d => d.key === key);

import { BiomarkerExpandedSection } from './BiomarkerExpandedSection';
import CombineBiomarkersModal from './CombineBiomarkersModal';
const BiomarkerDictionaryModal = React.lazy(() => import('./BiomarkerDictionaryModal'));
import NotUsedBiomarkersModal from './NotUsedBiomarkersModal';
import TaskPlaceholderCard from './TaskPlaceholderCard';
import { JobStore } from '../jobs/JobStore';

interface MedicalHistoryTabProps {
  profile: UserProfile;
  biomarkers: { [key: string]: number | string };
  biomarkerHistory: BiomarkerLog[];
  foodLogs?: FoodLog[];
  onApplyDataSanitize?: (selected: any[]) => Promise<void>;
  [key: string]: any;
  hideSensitive: boolean;
  onDeleteBiomarkerLog: (id: string) => void;
  onBatchCombineBiomarkers?: (combinations: {targetKey: string, targetDef: any, mergedLogs: any[], sourceKeysToDelete: string[]}[]) => Promise<void>;
  onDeleteBiomarkerFromLog?: (id: string, key: string) => void;
  onDeleteBiomarker?: (key: string) => void;
  onFlagNotUsed?: (key: string) => void;
  onFlagNotUsedLocal?: (key: string) => void;
  onRestoreNotUsedLocal?: (key: string) => void;
  onRestoreNotUsedGlobal?: (key: string) => void;
  onDeleteMultipleBiomarkers?: (keys: string[]) => void;
  onDeleteEmptyBiomarkers?: () => void;
  onStandardizeUnits?: (updates: { [key: string]: { unit: string; normalRange: string; name: string } }) => Promise<void>;
  onUpdateProfile?: (updates: Partial<UserProfile>) => void;
  onEditBiomarkerLog: (id: string, key: string, value: string | number, newDate?: string) => void;
  onLogMedical?: (biomarkers: { [key: string]: number | string }, profileUpdates?: Partial<UserProfile>, date?: string, entries?: any, modificationCommand?: any, skipClose?: boolean) => void;
  onCombineBiomarkers?: (
    targetKey: string,
    targetDef: { name: string; unit: string; normalRange: string; description: string },
    mergedLogs: { date: string; value: number | string }[],
    sourceKeysToDelete: string[]
  ) => void;
  onBatchConsolidate?: (mapping: { [key: string]: string }) => void;
  onReviewWithAgent?: (keys: string[]) => void;
  onOpenAgentChat?: (agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'health_baseline' | 'agent7' | 'data_review' | 'biomarker_review', options?: { prefillMessage?: string; dataReviewBatchKeys?: string[]; dataReviewBatchIdx?: number | string; biomarkerKey?: string }) => void;
  onApplyCalculation?: (updates: {
    targetCalories?: number;
    targetWeight?: number;
    addedBenefit?: string;
    descriptionExplain?: string;
  }) => void;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  hasBmiAlert?: boolean;
  onDismissBmiAlert?: () => void;
  onAgentAnalysisSaved?: (agentType: string, agentResult: any, existingId?: string) => Promise<string | void>;
  onDeleteAnalysis?: (id: string) => Promise<void>;
  onViewJob?: (jobId: string) => void;
}

export default function MedicalHistoryTab({
  profile,
  biomarkers,
  biomarkerHistory,
  hideSensitive,
  onDeleteBiomarkerLog,
  onDeleteBiomarkerFromLog,
  onDeleteBiomarker,
  onFlagNotUsed,
  onFlagNotUsedLocal,
  onRestoreNotUsedLocal,
  onRestoreNotUsedGlobal,
  onDeleteMultipleBiomarkers,
  onDeleteEmptyBiomarkers,
  onEditBiomarkerLog,
  onLogMedical,
  onCombineBiomarkers,
  onBatchCombineBiomarkers,
  onBatchConsolidate,
  onReviewWithAgent,
  onOpenAgentChat,
  onApplyCalculation,
  selectedModelId,
  onChangeModelId,
  hasBmiAlert,
  onDismissBmiAlert,
  onUpdateProfile,
  onStandardizeUnits,
  onAgentAnalysisSaved,
  onDeleteAnalysis,
  onViewJob,
}: MedicalHistoryTabProps) {
  const t = translations[profile.language] || translations.en;
  
  const [jobs, setJobs] = useState(() => JobStore.getAllJobs().filter(j => j.kind === 'medical'));
  useEffect(() => {
    const unsubscribe = JobStore.subscribe(() => {
      setJobs(JobStore.getAllJobs().filter(j => j.kind === 'medical'));
    });
    return () => { unsubscribe(); };
  }, []);

  const activeMedicalJobs = useMemo(() => {
    return jobs.filter(job => {
      if (job.status === 'draft') return false;
      const hasText = !!job.inputSnapshot?.text?.trim();
      const hasPayload = hasText || !!(job.inputSnapshot as any)?.extractedData || !!(job.inputSnapshot as any)?.remainingText || !!(job.inputSnapshot as any)?.hasImage;
      if (!hasPayload && job.status === 'queued') return false;
      return true;
    });
  }, [jobs]);

  const activeHistory = useMemo(() => (biomarkerHistory || []).filter(h => h.sync_state !== 'delete'), [biomarkerHistory]);
  
  const getLatestValue = useCallback((key: string) => {
    const historyLogs = activeHistory.filter(h => h.biomarkers && h.biomarkers[key] !== undefined);
    if (historyLogs.length > 0) {
      const sortedLogs = [...historyLogs].sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
      return sortedLogs[0].biomarkers[key];
    }
    return biomarkers?.[key];
  }, [activeHistory, biomarkers]);
  const isKeyNotUsedGlobal = useCallback((k: string) => {
    if (!profile?.notUsedBiomarkers) return false;
    if (profile.notUsedBiomarkers[k]) return true;
    const kLower = k.toLowerCase();
    return Object.keys(profile.notUsedBiomarkers).some(nok => nok.toLowerCase() === kLower);
  }, [profile?.notUsedBiomarkers]);

  const isKeyNotUsedLocal = useCallback((k: string) => {
    if (!profile?.notUsedInMedicalHistory) return false;
    if (profile.notUsedInMedicalHistory[k]) return true;
    const kLower = k.toLowerCase();
    return Object.keys(profile.notUsedInMedicalHistory).some(nok => nok.toLowerCase() === kLower);
  }, [profile?.notUsedInMedicalHistory]);

  const isKeyNotUsedInMedicalHistory = useCallback((k: string) => {
    return isKeyNotUsedGlobal(k) || isKeyNotUsedLocal(k);
  }, [isKeyNotUsedGlobal, isKeyNotUsedLocal]);

  const totalUniqueBiomarkers = useMemo(() => {
    const keys = new Set(Object.keys(biomarkers || {}));
    activeHistory.forEach(h => {
      Object.keys(h.biomarkers || {}).forEach(k => keys.add(k));
    });
    let count = 0;
    keys.forEach(k => {
      if (!isKeyNotUsedInMedicalHistory(k)) count++;
    });
    return count;
  }, [biomarkers, activeHistory, isKeyNotUsedInMedicalHistory]);
  const [viewType, setViewType] = useState<'risk' | 'condition' | 'practice'>('risk');
  const [selectedSubCategory, setSelectedSubCategory] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'risk' | 'name'>('risk');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [editDate, setEditDate] = useState<string>('');
  
  const [combineBiomarkerKey, setCombineBiomarkerKey] = useState<string | null>(null);
  const [flashingKey, setFlashingKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [reviewHistories, setReviewHistories] = useState<{[key: string]: ChatMessage[]}>({});
  const [openSubCategories, setOpenSubCategories] = useState<{ [category: string]: boolean }>({});
  const [showDictionaryModal, setShowDictionaryModal] = useState(false);
  const [showNotUsedLocalModal, setShowNotUsedLocalModal] = useState(false);

  useEffect(() => {
    const handleOpenConsolidation = () => {
      setShowDictionaryModal(true);
    };
    window.addEventListener('open-dictionary-consolidation', handleOpenConsolidation);
    return () => window.removeEventListener('open-dictionary-consolidation', handleOpenConsolidation);
  }, []);

  const toggleSubCategory = (cat: string) => {
    setOpenSubCategories(prev => ({
      ...prev,
      [cat]: !prev[cat]
    }));
  };

  const hasEmptyBiomarkers = useMemo(() => {
    return activeHistory.some(log => {
      return Object.values(log.biomarkers || {}).some(val => isValEmpty(val));
    });
  }, [activeHistory]);



  // Important/highlighted biomarkers for user cardiovascular/kidney health
  const highlightKeys = ['ldl', 'apob', 'hba1c', 'egfr', 'hscrp'];

  // Combine definitions with dynamic ones from `biomarkers` object and profile.customBiomarkers
  const allDefinitions = useMemo(() => {
    // Clone biomarkerDefinitions so we don't mutate the original static array
    // ONLY show standard definitions if they have data!
    const hasData = (key: string) => {
      if (biomarkers && biomarkers[key] !== undefined) return true;
      return (activeHistory || []).some(h => h.biomarkers && h.biomarkers[key] !== undefined);
    };
    const combined = biomarkerDefinitions.filter(d => hasData(d.key)).map(d => {
      if (d.key === 'bmi') {
        const isAsian = isAsianEthnicity(profile.ethnicity);
        const gender = (profile.gender || 'male').toLowerCase();
        const isMale = gender.startsWith('m');
        const targetBmi = isAsian ? 21.0 : (isMale ? 22.5 : 21.7);
        const targetWeight = Math.round(targetBmi * Math.pow((profile.height || 170) / 100, 2) * 10) / 10;
        return {
          ...d,
          normalRange: isAsian ? '18.5 - 22.9' : '18.5 - 24.9',
          descriptions: {
            ...d.descriptions,
            en: 'A measure of body fat based on height and weight.'
          }
        };
      }
      return {
        ...d,
        descriptions: { ...d.descriptions }
      };
    });
    
    // First, merge from profile.customBiomarkers
    if (profile.customBiomarkers) {
      Object.entries(profile.customBiomarkers).forEach(([key, def]) => {
        const existing = combined.find(d => d.key === key);
        if (existing) {
          if (key === 'bmi') {
            const isAsian = isAsianEthnicity(profile.ethnicity);
            const gender = (profile.gender || 'male').toLowerCase();
            const isMale = gender.startsWith('m');
            const targetBmi = isAsian ? 21.0 : (isMale ? 22.5 : 21.7);
            const targetWeight = Math.round(targetBmi * Math.pow((profile.height || 170) / 100, 2) * 10) / 10;
            existing.normalRange = isAsian ? '18.5 - 22.9' : '18.5 - 24.9';
            existing.descriptions = {
              ...existing.descriptions,
              en: 'A measure of body fat based on height and weight.'
            };
            existing.structuredRanges = def.structuredRanges || existing.structuredRanges;
          } else {
            existing.name = def.name || existing.name; existing.normalRange = def.normalRange || existing.normalRange;
            existing.structuredRanges = def.structuredRanges || existing.structuredRanges;
            existing.unit = def.unit || existing.unit; existing.standardMedicalGrouping = def.standardMedicalGrouping || existing.standardMedicalGrouping; existing.potentialMedicalConditions = def.potentialMedicalConditions || existing.potentialMedicalConditions; existing.riskCategories = def.riskCategories || existing.riskCategories;
            if (def.description) {
              existing.descriptions = { ...existing.descriptions, en: def.description };
            }
          }
          if (def.benefitRisk) {
            (existing as any).benefitRisk = def.benefitRisk;
          }
        } else {
          combined.push({
            key,
            name: def.name || key,
            category: 'other',
            unit: def.unit || '',
            normalRange: def.normalRange || 'Unknown',
            descriptions: {
              en: def.description || ''
            },
            benefitRisk: def.benefitRisk,
            standardMedicalGrouping: def.standardMedicalGrouping,
            potentialMedicalConditions: def.potentialMedicalConditions,
            riskCategories: def.riskCategories,
            structuredRanges: def.structuredRanges
          } as any);
        }
      });
    }

    const allHistoryKeys = new Set<string>();
    (activeHistory || []).forEach(h => {
      if (h.biomarkers) {
        Object.keys(h.biomarkers).forEach(k => allHistoryKeys.add(k));
      }
    });
    if (biomarkers) {
      Object.keys(biomarkers).forEach(k => allHistoryKeys.add(k));
    }

    allHistoryKeys.forEach(key => {
      if (key === 'weight' || key === 'height' || key === 'age') return;
      if (!combined.find(d => d.key === key)) {
        const builtIn = biomarkerDefinitions.find((d: any) => d.key === key || (Array.isArray(d.aliases) && d.aliases.includes(key)));
        const custom = getCustomBiomarkerDef(profile, key);
        const itemLogs = activeHistory.map(h => ({
          date: h.date,
          value: h.biomarkers?.[key],
          unit: (h as any).units?.[key] || (h as any).unit,
          normalRange: (h as any).normalRanges?.[key] || (h as any).normalRange
        })).filter(l => l.value !== undefined || l.unit || l.normalRange);
        const merged = getMergedBiomarkerDef(key, builtIn, custom, itemLogs);
        combined.push({
          key,
          name: merged.name,
          category: 'other',
          unit: merged.unit,
          normalRange: merged.normalRange || 'Unknown',
          descriptions: {
            en: merged.description || ''
          }
        } as any);
      }
    });

    const withMetadata = combined.map(def => {
      const customDef = getCustomBiomarkerDef(profile, def.key);
      const meta = getBiomarkerMetadata(def.key, customDef);
      const isBuiltIn = biomarkerDefinitions.some(b => b.key === def.key || (Array.isArray(b.aliases) && b.aliases.includes(def.key)));
      const needsApproval = customDef?.needsApproval === true || (def as any).needsApproval === true || (!isBuiltIn && customDef?.needsApproval !== false && (customDef?.needsApproval === true || (def as any).needsApproval === true));
      return {
        ...def,
        needsApproval,
        riskCategories: meta.riskCategories,
        standardMedicalGrouping: meta.standardMedicalGrouping,
        potentialMedicalConditions: meta.potentialMedicalConditions
      };
    });
    return withMetadata.filter(d => !isKeyNotUsedInMedicalHistory(d.key));
  }, [biomarkers, activeHistory, profile.customBiomarkers, profile.ethnicity, profile.gender, profile.height, isKeyNotUsedInMedicalHistory]);

  const checkIsPending = (def: any) => {
    return !isBiomarkerApproved(def.key, profile, activeHistory);
  };

  // Dynamic list of subcategories based on current viewType
  const subCategories = useMemo(() => {
    const hasPendingApproval = allDefinitions.some(def => checkIsPending(def));
    const hasBiomarkersToReview = allDefinitions.some(def => isBiomarkerNeedingReview(def.key, profile, activeHistory, biomarkers, allDefinitions));

    let baseCategories: string[] = [];
    if (viewType === 'risk') {
      const allRisks = new Set<string>();
      let hasUncategorized = false;
      allDefinitions.forEach(def => {
        if (!def.riskCategories || def.riskCategories.length === 0) {
           hasUncategorized = true;
        } else {
          def.riskCategories.forEach(r => {
            if (r) allRisks.add(r);
          });
        }
      });
      const arr = Array.from(allRisks).sort();
      if (hasUncategorized) arr.push('Uncategorized');
      baseCategories = ['all', ...arr];
    } else if (viewType === 'condition') {
      const allConditions = new Set<string>();
      let hasUnknown = false;
      allDefinitions.forEach(def => {
        if (!def.potentialMedicalConditions || def.potentialMedicalConditions.length === 0) {
           hasUnknown = true;
        } else {
          def.potentialMedicalConditions.forEach(c => {
            if (c) allConditions.add(c);
          });
        }
      });
      const arr = Array.from(allConditions).sort();
      if (hasUnknown) arr.push('Unknown');
      baseCategories = ['all', ...arr];
    } else {
      const allPractices = new Set<string>();
      allDefinitions.forEach(def => {
        let groupName = def.standardMedicalGrouping;
        if (!groupName || groupName === 'Other') {
           groupName = getPhysiologicalBucket(def.key, def.name);
        }
        allPractices.add(groupName);
      });
      const sortedPractices = Array.from(allPractices).sort();
      baseCategories = ['all', ...sortedPractices];
    }

    if (hasBiomarkersToReview) baseCategories.push('Biomarkers to Review');
    if (hasPendingApproval) baseCategories.push('Pending Approval');

    return baseCategories;
  }, [allDefinitions, viewType, profile.customBiomarkers, biomarkers, activeHistory]);

  const filteredBiomarkers = useMemo(() => {
    let filtered = allDefinitions.filter(def => {
      // Apply search query filter if it exists
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        const matchesName = def.name.toLowerCase().includes(q);
        const matchesKey = def.key.toLowerCase().includes(q);
        const matchesConditions = def.potentialMedicalConditions?.some(c => c.toLowerCase().includes(q));
        const matchesRisks = def.riskCategories?.some(r => r.toLowerCase().includes(q));
        const matchesGroup = def.standardMedicalGrouping?.toLowerCase().includes(q);
        if (!matchesName && !matchesKey && !matchesConditions && !matchesRisks && !matchesGroup) {
          return false;
        }
      }

      if (selectedSubCategory === 'all') return true;
      if (viewType === 'risk') {
        return def.riskCategories?.includes(selectedSubCategory);
      } else if (viewType === 'condition') {
        return def.potentialMedicalConditions?.includes(selectedSubCategory);
      } else {
        return def.standardMedicalGrouping === selectedSubCategory;
      }
    });

    if (sortBy === 'name') {
      filtered.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      // Sort by importance: critical > high/low > normal > unknown > no data
      const getSeverityScore = (key: string) => {
        const val = getLatestValue(key);
        if (val === undefined) return -1;
        
        const def = allDefinitions.find(d => d.key === key);
        const status = getBiomarkerStatus(key, val, def?.normalRange, def, profile);
        
        if (status === 'critical') return 4;
        if (status === 'high' || status === 'low') return 3;
        if (status === 'normal') return 2;
        return 1; // unknown
      };

      const getLatestDate = (key: string) => {
        const logs = activeHistory.filter(h => h.biomarkers[key] !== undefined);
        if (logs.length === 0) return '0000-00-00';
        return logs.map(h => h.date).sort((a, b) => toYYYYMMDD(a).localeCompare(toYYYYMMDD(b))).reverse()[0];
      };

      filtered.sort((a, b) => {
        const scoreA = getSeverityScore(a.key);
        const scoreB = getSeverityScore(b.key);
        
        if (scoreA !== scoreB) return scoreB - scoreA; // higher severity first
        
        // Secondary sort: Latest date
        const dateA = getLatestDate(a.key);
        const dateB = getLatestDate(b.key);
        if (dateA !== dateB) return toYYYYMMDD(dateB).localeCompare(toYYYYMMDD(dateA));
        
        return a.name.localeCompare(b.name);
      });
    }

    return filtered;
  }, [allDefinitions, viewType, selectedSubCategory, sortBy, activeHistory, biomarkers, searchQuery]);

  // Helper to filter biomarkers for a subcategory
  const getBiomarkersForSubCategory = (cat: string) => {
    return filteredBiomarkers.filter(def => {
      const isApproved = isBiomarkerApproved(def.key, profile, activeHistory);
      const isPending = !isApproved;
      const hasVal = getLatestValue(def.key) !== undefined;

      if (cat === 'Pending Approval') {
        return isPending;
      }

      if (cat === 'Biomarkers to Review' || cat === 'Unknown Range') {
        return isBiomarkerNeedingReview(def.key, profile, activeHistory, biomarkers, allDefinitions);
      }

      // If pending approval, exclude from all standard medical groupings/categories until approved
      if (isPending) {
        return false;
      }

      // Rule 7: If a biomarker has no logged value and is approved (categorisation + unit + range), it is ONLY in the biomarker dictionary (exclude from medical history categories)
      if (!hasVal && isApproved) {
        return false;
      }

      if (viewType === 'risk') {
        if (cat === 'Uncategorized') return !def.riskCategories || def.riskCategories.length === 0 || def.riskCategories.includes('Uncategorized');
        return def.riskCategories?.includes(cat);
      } else if (viewType === 'condition') {
        if (cat === 'Unknown') return !def.potentialMedicalConditions || def.potentialMedicalConditions.length === 0;
        return def.potentialMedicalConditions?.includes(cat);
      } else {
        let groupName = def.standardMedicalGrouping;
        if (!groupName || groupName === 'Other') {
           groupName = getPhysiologicalBucket(def.key, def.name);
        }
        return groupName === cat;
      }
    });
  };

  // Helper to calculate highest risk info for a subcategory
  const getSubCategoryRiskInfo = (cat: string) => {
    if (cat === 'Pending Approval') {
      return { label: 'Pending Approval', bg: 'bg-amber-500', text: 'text-white' };
    }
    if (cat === 'Biomarkers to Review' || cat === 'Unknown Range') {
      return { label: 'Biomarkers to Review', bg: 'bg-amber-600', text: 'text-white' };
    }
    const groupMarkers = getBiomarkersForSubCategory(cat);
    let maxScore = 0;
    let worstMarkerName = '';
    let worstMarkerStatusLabel = '';
    
    groupMarkers.forEach(def => {
      const val = getLatestValue(def.key);
      if (val !== undefined) {
        const status = getBiomarkerStatus(def.key, val, def.normalRange, def, profile);
        let score = 0;
        if (status === 'critical') score = 4;
        else if (status === 'high' || status === 'low') score = 3;
        else if (status === 'normal') score = 2;
        else score = 1;
        
        if (score > maxScore) {
          maxScore = score;
          worstMarkerName = def.name;
          worstMarkerStatusLabel = getBiomarkerStatusLabel(def.key, status, getCustomBiomarkerDef(profile, def.key), val, profile);
        }
      }
    });
    
    if (maxScore === 4) return { label: 'Critical Risk', bg: 'bg-rose-600', text: 'text-white' };
    if (maxScore === 3) return { label: 'At risk', bg: 'bg-amber-500', text: 'text-white' };
    if (maxScore === 2) return { label: 'Normal', bg: 'bg-emerald-600', text: 'text-white' };
    if (maxScore === 1) return { label: 'Unknown', bg: 'bg-slate-400', text: 'text-white' };
    return { label: 'No Data', bg: 'bg-slate-200 dark:bg-slate-800/50', text: 'text-theme-text-secondary' };
  };

  // Sort subcategories
  const activeCategories = useMemo(() => {
    const cats = subCategories.filter(cat => cat !== 'all' && getBiomarkersForSubCategory(cat).length > 0);
    if (sortBy === 'name') {
      return [...cats].sort((a, b) => {
        if (a === 'Pending Approval') return 1;
        if (b === 'Pending Approval') return -1;
        return a.localeCompare(b);
      });
    } else {
      const getCatScore = (cat: string) => {
        if (cat === 'Pending Approval') return -1;
        const groupMarkers = getBiomarkersForSubCategory(cat);
        let maxScore = 0;
        groupMarkers.forEach(def => {
          const val = getLatestValue(def.key);
          if (val !== undefined) {
            const status = getBiomarkerStatus(def.key, val, def.normalRange, def, profile);
            if (status === 'critical') maxScore = Math.max(maxScore, 4);
            else if (status === 'high' || status === 'low') maxScore = Math.max(maxScore, 3);
            else if (status === 'normal') maxScore = Math.max(maxScore, 2);
            else maxScore = Math.max(maxScore, 1);
          }
        });
        return maxScore;
      };
      
      return [...cats].sort((a, b) => {
        const scoreA = getCatScore(a);
        const scoreB = getCatScore(b);
        if (scoreB !== scoreA) return scoreB - scoreA;
        return a.localeCompare(b);
      });
    }
  }, [subCategories, sortBy, allDefinitions, biomarkers, filteredBiomarkers]);

  // Sort markers inside each subcategory
  const getSortedBiomarkersForSubCategory = (cat: string) => {
    const markers = getBiomarkersForSubCategory(cat);
    if (sortBy === 'name') {
      return [...markers].sort((a, b) => a.name.localeCompare(b.name));
    } else {
      const getSeverityScore = (key: string) => {
        const val = getLatestValue(key);
        if (val === undefined) return -1;
        const def = allDefinitions.find(d => d.key === key);
        const status = getBiomarkerStatus(key, val, def?.normalRange, def, profile);
        if (status === 'critical') return 4;
        if (status === 'high' || status === 'low') return 3;
        if (status === 'normal') return 2;
        return 1;
      };
      const getLatestDate = (key: string) => {
        const logs = activeHistory.filter(h => h.biomarkers[key] !== undefined);
        if (logs.length === 0) return '0000-00-00';
        return logs.map(h => h.date).sort((a, b) => toYYYYMMDD(a).localeCompare(toYYYYMMDD(b))).reverse()[0];
      };
      
      return [...markers].sort((a, b) => {
        const scoreA = getSeverityScore(a.key);
        const scoreB = getSeverityScore(b.key);
        if (scoreA !== scoreB) return scoreB - scoreA;
        const dateA = getLatestDate(a.key);
        const dateB = getLatestDate(b.key);
        if (dateA !== dateB) return toYYYYMMDD(dateB).localeCompare(toYYYYMMDD(dateA));
        return a.name.localeCompare(b.name);
      });
    }
  };

  return (
    <div className="space-y-4 pb-40 animation-fade-in max-w-md mx-auto px-3 mt-4 font-sans text-theme-text">
      
      {/* Search Input */}
      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
        <input
          type="text"
          placeholder="Search conditions or markers..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full pl-10 pr-3 py-2 bg-white dark:bg-slate-800 border border-theme-border rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm"
        />
      </div>

      {/* View Selection Controls */}
      <div className="grid grid-cols-2 gap-3 mb-1">
        {/* View Selection */}
        <div className="flex flex-col gap-1">
          <select
            value={viewType}
            onChange={(e) => {
              setViewType(e.target.value as any);
              setSelectedSubCategory('all');
            }}
            className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-theme-border rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all cursor-pointer shadow-sm"
          >
            {BIOMARKER_GROUPING_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* Sort Selection */}
        <div className="flex flex-col gap-1">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="w-full px-2.5 py-1.5 text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-theme-border rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 focus:outline-none transition-all cursor-pointer shadow-sm"
          >
            <option value="risk">Risk Level</option>
            <option value="name">Name</option>
          </select>
        </div>
      </div>

      {/* Active Medical Jobs */}
      {activeMedicalJobs.length > 0 && (
        <div className="space-y-3 mb-4" id="active-medical-jobs">
          {activeMedicalJobs.map((job) => (
            <TaskPlaceholderCard
              key={job.id}
              job={job}
              onView={(id) => {
                if (onViewJob) onViewJob(id);
              }}
              onDelete={async (id) => {
                await JobStore.deleteJob(id);
              }}
              onCancel={(id) => {
                const j = JobStore.getJob(id);
                if (j) {
                  if (j.status === 'queued') {
                    JobStore.updateJob(id, { status: 'cancelled' });
                  } else if (j.status === 'running') {
                    j.abortController?.abort();
                    JobStore.updateJob(id, { status: 'cancelled' });
                  }
                }
              }}
              onSave={() => {}}
              profileLanguage={profile.language}
            />
          ))}
        </div>
      )}

      {/* Accordions Group of Biomarkers */}
      <div className="space-y-2.5 mt-[20px]">
        {activeCategories.map((cat) => {
          const isOpen = searchQuery.trim() !== '' || !!openSubCategories[cat];
          const riskInfo = getSubCategoryRiskInfo(cat);
          const markers = getSortedBiomarkersForSubCategory(cat);
          
          return (
            <div key={cat} className="border border-theme-border rounded-2xl overflow-hidden bg-theme-bg-card shadow-xs">
              {/* Accordion Header */}
              <div 
                onClick={() => toggleSubCategory(cat)}
                className="flex items-center justify-between p-3.5 bg-slate-50/50 dark:bg-slate-900/60 hover:bg-slate-100/60 dark:hover:bg-slate-850/40 cursor-pointer select-none transition-colors border-b border-theme-border/30"
              >
                <span className="text-xs font-bold text-slate-700 dark:text-slate-200 capitalize">
  {cat} ({markers.length})
</span>

                <div className="flex items-center gap-2">
                  <span className={`${riskInfo.bg} ${riskInfo.text} text-[10px] font-bold px-2.5 py-0.5 rounded-full lowercase [font-variant:small-caps] tracking-wider`}>
                    {riskInfo.label}
                  </span>
                  <span className="text-slate-400">
                    {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </span>
                </div>
              </div>

              {/* Accordion Content */}
              {isOpen && (
                <div className="divide-y divide-slate-100 dark:divide-slate-800/40 bg-theme-bg-card">
                  {(cat === 'Biomarkers to Review' || cat === 'Unknown Range') && markers.length > 0 && (
                    <div className="p-3 bg-amber-500/10 border-b border-amber-500/20 text-amber-900 dark:text-amber-200 text-xs flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>There are <strong>{markers.length}</strong> biomarker(s) needing calibration or review (scaling/notation errors, missing reference ranges, or improbable log values).</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const keys = markers.map(m => m.key);
                          if (onReviewWithAgent) {
                            onReviewWithAgent(keys);
                          } else if (onOpenAgentChat) {
                            const telemetryErrors = detectFlaggedTelemetryErrors(biomarkers, profile, activeHistory, allDefinitions || []);
                            const prefillMsg = `Please help me review and correct scaling, unit, and notation errors in my historical biomarker logs:\n` +
                              markers.map(m => {
                                const errInfo = telemetryErrors.find(e => e.key === m.key);
                                const flaggedSamples = errInfo ? errInfo.samples : [];
                                return `- ${m.name}: ${flaggedSamples.join(', ')}`;
                              }).join('\n');

                            onOpenAgentChat('data_review', {
                              dataReviewBatchKeys: keys,
                              prefillMessage: prefillMsg
                            });
                          }
                        }}
                        className="px-2.5 py-1 text-[11px] font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors shrink-0 cursor-pointer shadow-xs"
                      >
                        Fix All with Data Review Agent
                      </button>
                    </div>
                  )}

                  {markers.length > 0 ? (
                    markers.map((def) => {
                      let val = getLatestValue(def.key);
                      const originalVal = val;
                      const isEmptyVal = isValEmpty(val);
                      const hasVal = val !== undefined && val !== null && val !== '';
                      const customDef = getCustomBiomarkerDef(profile, def.key);
                      const status = (hasVal && !isEmptyVal) ? getBiomarkerStatus(def.key, val, def.normalRange, def, profile) : 'unknown';
                      const statusLabel = (hasVal && !isEmptyVal) ? getBiomarkerStatusLabel(def.key, status, customDef, val, profile) : '';
                      const colorClass = isEmptyVal ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30' : getBiomarkerColor(statusLabel || status);
                      const isExpanded = expandedKey === def.key;
                      const riskTag = (hasVal && !isEmptyVal) ? getBiomarkerRiskTag(def.key, status, customDef, val, profile) : null;
                      const isNeedsApproval = !!(def as any).needsApproval || !!profile.customBiomarkers?.[def.key]?.needsApproval;
                      const isMissingUnit = !def.unit || def.unit.trim() === '';
                      const isMissingCategory = !def.standardMedicalGrouping || def.standardMedicalGrouping.trim() === '' || def.standardMedicalGrouping === 'Other' || !def.riskCategories || def.riskCategories.length === 0 || def.riskCategories.includes('Uncategorized');
                      const isPendingApproval = !isBiomarkerApproved(def.key, profile, activeHistory);
                      
                      const latestLogForUnit = [...(activeHistory || [])]
                        .filter((h: any) => h.biomarkers && h.biomarkers[def.key] !== undefined)
                        .sort((a: any, b: any) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))[0];
                      let displayUnit = latestLogForUnit?.observationMeta?.[def.key]?.rawUnit || def.unit || '';
                      if (profile.unitPreference === 'US' && typeof val === 'number') {
                        const reversed = reverseStandardizeUnit(def.key, val, displayUnit);
                        val = reversed.newValue;
                        displayUnit = reversed.newUnit || displayUnit;
                      }
                      
                      // Clone def so we can safely update the unit
                      const displayRange = formatNormalRange(def.key, def.normalRange || '', def.unit || '', profile.unitPreference as 'SI' | 'US');
                      const displayDef = { ...def, unit: displayUnit, normalRange: displayRange };

                      return (
                        <div 
                          key={def.key} 
                          id={`biomarker-card-${def.key}`} 
                          className={`flex flex-col transition-all duration-1000 ${
                            flashingKey === def.key 
                              ? 'bg-indigo-50/70 dark:bg-indigo-950/30 ring-2 ring-indigo-500/50 dark:ring-indigo-400/50 rounded-xl overflow-hidden' 
                              : ''
                          }`}
                        >
                          <div
                            onClick={() => setExpandedKey(isExpanded ? null : def.key)}
                            className={`flex items-center justify-between p-3.5 cursor-pointer hover:bg-slate-50/60 dark:hover:bg-slate-800/20 ${isExpanded ? 'bg-slate-50/50 dark:bg-slate-800/20' : ''}`}
                          >
                            <div className="min-w-0 flex-1 pr-3">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate capitalize">
                                  {def.name}
                                </span>
                                {def.key === 'bmi' && hasBmiAlert && (
                                  <AlertCircle className="w-3.5 h-3.5 text-amber-500 shrink-0 animate-pulse" />
                                )}
                                <span className="text-[10px] font-mono text-slate-400">({displayUnit})</span>
                              </div>
                              <p className="text-[10px] text-slate-400 mt-0.5">
                                Normal range: {displayDef.normalRange}
                              </p>
                              
                              {/* Associated Metadata Badges */}
                              <div className="flex flex-wrap gap-1 mt-1.5 max-w-full overflow-hidden">
                                {isEmptyVal && (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/80 dark:text-rose-300 rounded-md border border-rose-300/80 dark:border-rose-700/60 whitespace-nowrap flex items-center gap-1 animate-pulse">
                                    <AlertCircle className="w-2.5 h-2.5 text-rose-600 dark:text-rose-400" />
                                    Zero / Empty Value (Flagged to Delete)
                                  </span>
                                )}
                                {isBiomarkerNeedingReview(def.key, profile, activeHistory, biomarkers, allDefinitions) && (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-300 rounded-md border border-amber-300/80 dark:border-amber-700/60 whitespace-nowrap flex items-center gap-1">
                                    <AlertCircle className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400" />
                                    Biomarker to Review
                                  </span>
                                )}
                                {(() => {
                                  const customOpt = profile.customBiomarkers?.[def.key]?.optimalValue;
                                  const agentCal = getAgentCalibration(def.key);
                                  const optVal = customOpt || (agentCal ? formatOptimalTargetValue(agentCal) : null);
                                  if (optVal && optVal.trim() && optVal.trim() !== def.normalRange) {
                                    return (
                                      <span className="px-1.5 py-0.5 text-[8px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 rounded-md border border-emerald-300/80 dark:border-emerald-700/60 whitespace-nowrap flex items-center gap-1">
                                        🎯 Target: {optVal}
                                      </span>
                                    );
                                  }
                                  return null;
                                })()}
                                {isNeedsApproval && (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 rounded-md border border-amber-300/80 dark:border-amber-700/60 whitespace-nowrap flex items-center gap-1 animate-pulse">
                                    <Clock className="w-2.5 h-2.5 text-amber-600 dark:text-amber-400" />
                                    Pending Approval
                                  </span>
                                )}
                                {isMissingUnit && (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold bg-orange-100 text-orange-800 dark:bg-orange-950/80 dark:text-orange-300 rounded-md border border-orange-300/80 dark:border-orange-700/60 whitespace-nowrap flex items-center gap-1">
                                    <AlertCircle className="w-2.5 h-2.5 text-orange-600 dark:text-orange-400" />
                                    Missing Unit (To Be Approved)
                                  </span>
                                )}
                                {isMissingCategory && (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold bg-yellow-100 text-yellow-800 dark:bg-yellow-950/80 dark:text-yellow-300 rounded-md border border-yellow-300/80 dark:border-yellow-700/60 whitespace-nowrap flex items-center gap-1">
                                    <AlertCircle className="w-2.5 h-2.5 text-yellow-600 dark:text-yellow-400" />
                                    Missing Category (To Be Approved)
                                  </span>
                                )}
                                {status === 'flagged' && (
                                  <span className="px-1.5 py-0.5 text-[8px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 rounded-md border border-purple-300 dark:border-purple-700 whitespace-nowrap animate-pulse flex items-center gap-1">
                                    <AlertCircle className="w-2.5 h-2.5 text-purple-600 dark:text-purple-400" />
                                    FLAGGED: Improbable Value - Please Review
                                  </span>
                                )}
                                {riskTag && (
                                  <span className={`px-1.5 py-0.5 text-[8px] font-bold rounded-md border whitespace-nowrap uppercase ${
                                    riskTag.toLowerCase() === 'healthy' 
                                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border-emerald-100/60 dark:border-emerald-900/40' 
                                      : riskTag.toLowerCase().includes('at risk')
                                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border-amber-100/60 dark:border-amber-900/40'
                                        : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 border-rose-100/60 dark:border-rose-900/40'
                                  }`}>
                                    {riskTag}
                                  </span>
                                )}
                                {def.riskCategories && def.riskCategories.length > 0 && def.riskCategories.map((catName: string, i: number) => (
                                  <span key={`risk-${i}`} className="px-1.5 py-0.5 text-[8px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 rounded-md border border-rose-100/60 dark:border-rose-900/40 whitespace-nowrap">
                                    {catName}
                                  </span>
                                ))}
                                {def.potentialMedicalConditions && def.potentialMedicalConditions.length > 0 && def.potentialMedicalConditions.map((cond: string, i: number) => (
                                  <span key={`cond-${i}`} className="px-1.5 py-0.5 text-[8px] font-bold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded-md border border-amber-100/60 dark:border-amber-900/40 whitespace-nowrap">
                                    {cond}
                                  </span>
                                ))}
                              </div>
                            </div>

                            <div className="text-right flex items-center gap-2">
                              <div className="flex flex-col items-end">
                                <span className={`text-xs font-bold font-sans ${isEmptyVal ? 'text-rose-600 dark:text-rose-400 font-extrabold' : (hasVal ? colorClass : 'text-slate-300')}`}>
                                  {hasVal ? (hideSensitive ? '***' : (isEmptyVal ? `${val} (Empty/Zero)` : val)) : 'Unset'}
                                </span>
                                {hasVal && (
                                  <span className={`text-[9px] font-bold uppercase tracking-wider ${isEmptyVal ? 'text-rose-600 dark:text-rose-400' : colorClass}`}>
                                    {isEmptyVal ? 'To Be Deleted' : statusLabel}
                                  </span>
                                )}
                              </div>
                              <div className="text-slate-400">
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </div>
                            </div>
                          </div>
                          
                          {isExpanded && (
                            <BiomarkerExpandedSection onOpenAiReview={(key) => {
                                if (onOpenAgentChat) {
                                  const targetDef = def || getBiomarkerDef(key);
                                  onOpenAgentChat('biomarker_review', { 
                                    biomarkerKey: key, 
                                    prefillMessage: buildBiomarkerReviewPrefill(key, targetDef, biomarkers, profile) 
                                  });
                                }
                              }} onCombineBiomarker={() => {}}
                              def={def}
                              profile={profile}
                              biomarkerHistory={activeHistory}
                              biomarkers={biomarkers}
                              onEditBiomarkerLog={onEditBiomarkerLog}
                              onDeleteBiomarkerLog={onDeleteBiomarkerLog}
                              onDeleteBiomarkerFromLog={onDeleteBiomarkerFromLog}
                              onDeleteBiomarker={onDeleteBiomarker}
                                                                                          onApplyCalculation={onApplyCalculation}
                              hasPendingAlert={def.key === 'bmi' ? hasBmiAlert : false}
                              onDismissAlert={def.key === 'bmi' ? onDismissBmiAlert : undefined}
                              hideSensitive={hideSensitive}
                              onEditBiomarkerDef={(key, range, unit) => {
                                const newCustom = { ...profile.customBiomarkers };
                                const existing = newCustom[key] || { name: key, unit: unit, normalRange: range, description: '' };
                                newCustom[key] = { ...existing, normalRange: range, unit: unit };
                                if (onUpdateProfile) {
                                  onUpdateProfile({ customBiomarkers: newCustom });
                                }
                              }}
                              onFlagNotUsedLocal={onFlagNotUsedLocal}
                            />
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <p className="p-4 text-xs text-slate-400 italic text-center">No biomarkers in this category</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-8 pt-6 border-t border-theme-border/80 flex flex-col sm:flex-row items-center justify-between gap-4 px-4">
        <div className="flex flex-wrap items-center gap-6 text-xs text-theme-text-secondary font-medium">
          <div className="flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-indigo-500" />
            <span>Total Unique Biomarkers: <strong className="text-slate-800 dark:text-slate-200 font-bold">{totalUniqueBiomarkers}</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="w-4 h-4 text-indigo-500" />
            <span>Total Log Entries: <strong className="text-slate-800 dark:text-slate-200 font-bold">{activeHistory.reduce((sum, h) => sum + Object.keys(h.biomarkers).length, 0)}</strong></span>
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-3 pb-8">
        <button
          onClick={() => setShowDictionaryModal(true)}
          className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-bold text-xs rounded-xl border border-indigo-100 dark:border-indigo-800/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors cursor-pointer flex items-center gap-2"
        >
          <ClipboardList className="w-4 h-4" />
          Open Biomarker Dictionary
        </button>

        {Object.keys(profile?.notUsedInMedicalHistory || {}).length > 0 && (
          <button
            type="button"
            onClick={() => setShowNotUsedLocalModal(true)}
            className="px-3 py-1.5 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-bold text-xs rounded-xl border border-amber-200 dark:border-amber-800/60 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors cursor-pointer flex items-center gap-2"
          >
            <EyeOff className="w-3.5 h-3.5" />
            Not used ({Object.keys(profile?.notUsedInMedicalHistory || {}).length})
          </button>
        )}
        
        {onDeleteEmptyBiomarkers && hasEmptyBiomarkers && (
          <button
            onClick={() => {
              onDeleteEmptyBiomarkers();
            }}
            className="px-4 py-2 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 font-bold text-xs rounded-xl border border-rose-100 dark:border-rose-800/50 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors cursor-pointer flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            Delete Empty Biomarkers
          </button>
        )}
      </div>
      
      

      {combineBiomarkerKey && onCombineBiomarkers && (
        <CombineBiomarkersModal
          profile={profile}
          isOpen={true}
          initialKey={combineBiomarkerKey}
          biomarkers={biomarkers}
          biomarkerHistory={activeHistory}
          allDefinitions={allDefinitions}
          onClose={() => setCombineBiomarkerKey(null)}
          onSaveCombine={onCombineBiomarkers}
          onReviewWithAgent={onReviewWithAgent}
        />
      )}

      {showDictionaryModal && onLogMedical && (
        <React.Suspense fallback={null}>
        <BiomarkerDictionaryModal
          profile={profile?.email === 'demo@healthcockpit.com' ? { ...profile, agentAnalyses: [] } : profile}
          biomarkers={profile?.email === 'demo@healthcockpit.com' ? {} : biomarkers}
          biomarkerHistory={profile?.email === 'demo@healthcockpit.com' ? [] : activeHistory}
          onClose={() => {
            setShowDictionaryModal(false);
          }}
          onReviewWithAgent={onReviewWithAgent}
          onUpdateProfile={onUpdateProfile ? (updates) => onUpdateProfile(updates) : (updates) => onLogMedical({}, updates, undefined, undefined, undefined, true)}
          onDeleteBiomarker={onDeleteBiomarker}
          onFlagNotUsed={onFlagNotUsed}
          onRestoreNotUsedGlobal={onRestoreNotUsedGlobal}
          onDeleteMultipleBiomarkers={onDeleteMultipleBiomarkers}
          onCombineBiomarkers={onCombineBiomarkers!}
          onBatchCombineBiomarkers={onBatchCombineBiomarkers}
          onBatchConsolidate={onBatchConsolidate}
          onStandardizeUnits={onStandardizeUnits}
          onLogMedical={onLogMedical}
          onAgentAnalysisSaved={onAgentAnalysisSaved}
          onDeleteAnalysis={onDeleteAnalysis}
          selectedModelId={selectedModelId}
          onChangeModelId={onChangeModelId}
        />
        </React.Suspense>
      )}

      {/* LOCAL NOT USED BIOMARKERS MODAL FOR MEDICAL HISTORY */}
      <NotUsedBiomarkersModal
        isOpen={showNotUsedLocalModal}
        onClose={() => setShowNotUsedLocalModal(false)}
        flaggedKeys={Object.keys(profile?.notUsedInMedicalHistory || {})}
        getDisplayName={(k) => profile?.customBiomarkers?.[k]?.name || biomarkerDefinitions.find((b: any) => b.key === k || (Array.isArray(b.aliases) && b.aliases.some((a: string) => a.toLowerCase() === k.toLowerCase())))?.name || k}
        onRestore={(k) => {
          if (onRestoreNotUsedLocal) onRestoreNotUsedLocal(k);
        }}
      />
    </div>
  );
}
