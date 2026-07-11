import { toYYYYMMDD } from "../utils/dateUtils";
import React, { useState, useEffect } from 'react';
import { UserProfile, FoodLog, RecommendationReport } from '../types';
import { translations } from '../utils/translations';
import { 
  Brain, Sparkles, AlertCircle, TrendingDown, BookOpen, Clock, Heart, 
  CheckCircle, HelpCircle, Loader, ShieldCheck, Database, Check, X, ArrowRight, Activity, Send, ChevronDown, ChevronUp, Trash2, Lock, Archive, Search
} from 'lucide-react';
import LLMSelector from './LLMSelector';
import { Agent5View, Agent6View, Agent7View } from './AgentResultViews';
import { AgentResultTable } from './AgentResultTable';
import { parse } from 'yaml';
import { biomarkerDefinitions, getBiomarkerMetadata, getPhysiologicalBucket, BIOMARKER_GROUPING_OPTIONS, getMappedBiomarkerKey } from '../utils/biomarkers';
import BiomarkerDictionaryModal from './BiomarkerDictionaryModal';

interface InsightsTabProps {
  profile: UserProfile;
  foodLogs: FoodLog[];
  biomarkers: { [key: string]: number | string };
  biomarkerHistory?: any[];
  report: RecommendationReport | null;
  draftReport: RecommendationReport | null;
  onAcceptReport: (report: RecommendationReport) => Promise<void>;
  onRejectReport: () => void;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  onGenerateReport: (engine: string) => Promise<void>;
  isGenerating: boolean;
  onNavigateToTab?: (tab: string) => void;
  onOpenMedicalChat?: () => void;
  onOpenAgentChat?: (
    agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'agent6' | 'agent7' | 'data_review',
    options?: { prefillMessage?: string; dataReviewBatchIdx?: number | string; dataReviewBatchKeys?: string[] }
  ) => void;
  onDeleteAnalysis?: (id: string) => Promise<void>;
  onArchiveAnalysis?: (id: string) => Promise<void>;
  onDeleteBiomarker?: (key: string) => void;
  onDeleteMultipleBiomarkers?: (keys: string[]) => void;
  onUpdateProfile?: (profile: UserProfile) => Promise<void>;
  onUpdateHistory?: (history: any[], biomarkers: { [key: string]: number | string }, updatedProfile?: UserProfile) => Promise<void>;
  batchSize?: number;
  onChangeBatchSize?: (size: number) => void;
  calibratingBatchIdx?: number | null;
  calibratingAgentType?: string | null;
  onCombineBiomarkers?: (
    targetKey: string,
    targetDef: any,
    mergedLogs: any[],
    sourceKeysToDelete: string[]
  ) => void;
  onBatchConsolidate?: (mapping: { [key: string]: string }) => void;
  onAgentAnalysisSaved?: (agentType: string, agentResult: any) => Promise<void>;
}

const STABLE_EMPTY_ARRAY: string[] = [];

export default function InsightsTab({
  profile,
  foodLogs,
  biomarkers,
  report,
  draftReport,
  onAcceptReport,
  onRejectReport,
  selectedModelId,
  onChangeModelId,
  onGenerateReport,
  isGenerating,
  onNavigateToTab,
  onOpenMedicalChat,
  onOpenAgentChat,
  onDeleteAnalysis,
  onArchiveAnalysis,
  onDeleteBiomarker,
  onDeleteMultipleBiomarkers,
  biomarkerHistory,
  onUpdateProfile,
  onUpdateHistory,
  batchSize = 20,
  onChangeBatchSize,
  calibratingBatchIdx = null,
  calibratingAgentType = null,
  onCombineBiomarkers,
  onBatchConsolidate,
  onAgentAnalysisSaved
}: InsightsTabProps) {
  const t = translations[profile.language] || translations.en;
  const userIdentifier = profile?.email?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'guest';
  const [isApplying, setIsApplying] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [refinementText, setRefinementText] = useState("");
  const [chatHistory, setChatHistory] = useState<any[]>([]);
  const [showDictionaryModal, setShowDictionaryModal] = useState(false);
  const [dictionaryPreFillKey, setDictionaryPreFillKey] = useState<string | null>(null);
  const [expandedAgentHistory, setExpandedAgentHistory] = useState<Record<string, boolean>>({});

  // Accordion active step index
  const [activeStepIndex, setActiveStepIndex] = useState<number | null>(0);

  const [batchSizeInput, setBatchSizeInput] = useState<string>(batchSize.toString());
  const [customBatchKeys, setCustomBatchKeys] = useState<string[]>(() => {
    try {
      const uId = profile?.email?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'guest';
      const saved = localStorage.getItem(`agent1_custom_batch_keys_${uId}`);
      return saved ? JSON.parse(saved) : [];
    } catch(e) { return []; }
  });
  const [showCustomBatchModal, setShowCustomBatchModal] = useState(false);
  const [customBatchSearch, setCustomBatchSearch] = useState('');
  const [batchGroupType, setBatchGroupType] = useState<'risk' | 'practice' | 'condition'>('risk');
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  
  React.useEffect(() => {
    setBatchSizeInput(batchSize.toString());
  }, [batchSize]);

  React.useEffect(() => {
    try {
      const savedApprovedData = localStorage.getItem('approved_data_review_batches');
      if (savedApprovedData) setApprovedBatches(JSON.parse(savedApprovedData));
      
      const savedAnalysisResults = localStorage.getItem('batch_analysis_results');
      if (savedAnalysisResults) setBatchAnalysisResults(JSON.parse(savedAnalysisResults));

      const savedApprovedAgent1 = localStorage.getItem('approved_agent1_batches');
      if (savedApprovedAgent1) setApprovedAgent1Batches(JSON.parse(savedApprovedAgent1));

      const savedAgent1Results = localStorage.getItem('agent1_batch_results');
      if (savedAgent1Results) setAgent1BatchResults(JSON.parse(savedAgent1Results));
    } catch (e) {
      console.warn("Failed to sync localStorage in InsightsTab useEffect", e);
    }
  }, [profile]);

  React.useEffect(() => {
    if (sessionStorage.getItem('auto_open_custom_batch_modal') === 'true') {
      sessionStorage.removeItem('auto_open_custom_batch_modal');
      setShowCustomBatchModal(true);
      // Reload keys from localStorage to ensure we have the prefilled keys
      try {
        const uId = profile?.email?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'guest';
        const saved = localStorage.getItem(`agent1_custom_batch_keys_${uId}`);
        if (saved) {
          setCustomBatchKeys(JSON.parse(saved));
        }
      } catch (e) {}
    }
  }, []);

  // Accordion approved steps state
  const [approvedSteps, setApprovedSteps] = useState<Record<string, boolean>>(() => {
    return {
      agent1: !!profile.agentTriageSummary,
      agent2: !!(profile.agentAnalyses?.some(a => a.agentType === 'agent2' && profile.customBiomarkers && Object.values(profile.customBiomarkers).some(b => b && b.riskCategories && b.riskCategories.length > 0))),
      agent3: !!(profile.agentAnalyses?.some(a => a.agentType === 'agent3')),
      agent4: !!(profile.agentDiagnosticSummary),
      agent5: !!(profile.agentContextualizerSummary),
      agent6: !!(profile.agentInterventionSummary),
      agent7: !!(profile.agentLiteratureSummary)
    };
  });

  const [isAdminMode, setIsAdminMode] = useState(() => {
    const saved = localStorage.getItem('health_cockpit_admin_mode');
    if (saved) return saved === 'admin';
    return profile?.email?.toLowerCase().trim() === 'cwah.liu@gmail.com';
  });

  useEffect(() => {
    const handleStorageChange = () => {
      const saved = localStorage.getItem('health_cockpit_admin_mode');
      if (saved) {
        setIsAdminMode(saved === 'admin');
      }
    };
    window.addEventListener('storage', handleStorageChange);
    const interval = setInterval(() => {
      const saved = localStorage.getItem('health_cockpit_admin_mode');
      if (saved) {
        setIsAdminMode(saved === 'admin');
      }
    }, 1000);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  // Approved analysis ids state, kept across sessions
  const [approvedAnalysisIds, setApprovedAnalysisIdsState] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('approvedAnalysisIds');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error(e);
    }
    
    const initialIds: Record<string, string> = {};
    const initialApproved = {
      agent1: !!profile.agentTriageSummary,
      agent2: !!(profile.agentAnalyses?.some(a => a.agentType === 'agent2' && profile.customBiomarkers && Object.values(profile.customBiomarkers).some(b => b && b.riskCategories && b.riskCategories.length > 0))),
      agent3: !!(profile.agentAnalyses?.some(a => a.agentType === 'agent3')),
      agent4: !!(profile.agentDiagnosticSummary),
      agent5: !!(profile.agentContextualizerSummary),
      agent6: !!(profile.agentInterventionSummary),
      agent7: !!(profile.agentLiteratureSummary)
    };
    
    Object.keys(initialApproved).forEach(agentType => {
      if (initialApproved[agentType as keyof typeof initialApproved]) {
        const history = (profile.agentAnalyses || [])
          .filter(a => a.agentType === agentType)
          .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
        if (history.length > 0) {
          initialIds[agentType] = history[0].id;
        }
      }
    });
    return initialIds;
  });

  const setApprovedAnalysisId = (agentType: string, id: string) => {
    setApprovedAnalysisIdsState(prev => {
      const updated = { ...prev, [agentType]: id };
      localStorage.setItem('approvedAnalysisIds', JSON.stringify(updated));
      return updated;
    });
  };

  const hasStepSomethingToApprove = (step: any, latestAnalysis: any) => {
    if (!latestAnalysis || !latestAnalysis.result) return false;
    
    if (step.id === 'data_review') {
      return batches.some((_, bIdx) => !approvedBatches[bIdx] && batchAnalysisResults[bIdx]);
    }
    
    if (step.agentType === 'agent1') {
      const yamlText = latestAnalysis.result.extractedYaml || latestAnalysis.result;
      let parsedRows: any[] = [];
      if (Array.isArray(yamlText)) {
        parsedRows = yamlText;
      } else if (typeof yamlText === 'string') {
        const cleanText = yamlText.replace(/```(?:yaml|json)?/gi, '').trim();
        try {
          const parsed = parse(cleanText);
          if (Array.isArray(parsed)) parsedRows = parsed;
          else if (parsed?.biomarkers && Array.isArray(parsed.biomarkers)) parsedRows = parsed.biomarkers;
        } catch (e) {}
      }
      if (parsedRows.length === 0) return false;
      
      return parsedRows.some((row: any) => {
        const key = (row.biomarker || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
        if (!key) return false;
        const existingEntries = (biomarkerHistory || []).filter((h: any) => h.biomarkers[key] !== undefined);
        const isNew = existingEntries.length === 0;
        if (isNew) return true;
        
        const sortedHistory = [...existingEntries].sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
        const latestVal = sortedHistory[0].biomarkers[key];
        if (latestVal !== undefined && String(latestVal) !== String(row.value)) {
          return true;
        }
        return false;
      });
    }
    
    if (step.agentType === 'agent2') {
      const mapping = latestAnalysis.result.bucketMapping || latestAnalysis.result || {};
      const entries = Object.entries(mapping).filter(([k]) => k !== 'text' && k !== 'extractedYaml');
      if (entries.length === 0) return false;
      
      return entries.some(([bioName, mapData]: [string, any]) => {
        const key = bioName.toLowerCase().replace(/[^a-z0-9]/g, '_');
        const existingDef = profile?.customBiomarkers?.[key];
        if (!existingDef) return true;
        const newGroup = mapData.standardMedicalGrouping || 'Other';
        const oldGroup = existingDef?.standardMedicalGrouping || 'Other';
        if (newGroup !== oldGroup) return true;
        const newCategories = (mapData.riskCategories || []).join(', ');
        const oldCategories = (existingDef?.riskCategories || []).join(', ');
        if (newCategories !== oldCategories) return true;
        return false;
      });
    }
    
    if (step.agentType === 'agent3') {
      return true;
    }
    
    if (step.agentType === 'agent4') {
      const conditions = Array.isArray(latestAnalysis.result.prioritizedConditions) ? latestAnalysis.result.prioritizedConditions : [];
      return conditions.length > 0;
    }
    
    return true;
  };

  const [approvedBatches, setApprovedBatches] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('approved_data_review_batches');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    
    const initial: Record<number, boolean> = {};
    // Auto-approve batches if all keys in the batch exist in profile.customBiomarkers
    const batchSize = 20;
    const markerKeysList = Object.keys(biomarkers).filter(k => biomarkers[k] !== undefined && biomarkers[k] !== null && biomarkers[k] !== '');
    for (let i = 0; i < markerKeysList.length; i += batchSize) {
      const batchIdx = Math.floor(i / batchSize);
      const batchKeys = markerKeysList.slice(i, i + batchSize);
      const allExist = batchKeys.every(k => profile.customBiomarkers?.[k]?.standardMedicalGrouping !== undefined);
      if (allExist && batchKeys.length > 0) {
        initial[batchIdx] = true;
      }
    }
    return initial;
  });

  const [isAnalyzingBatch, setIsAnalyzingBatch] = useState<Record<string, boolean>>({});
  const [batchAnalysisResults, setBatchAnalysisResults] = useState<Record<string, any>>(() => {
    try {
      const saved = localStorage.getItem('batch_analysis_results');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  const [expandedBatches, setExpandedBatches] = useState<Record<string, boolean>>({});
  const [fullscreenBatchIndex, setFullscreenBatchIndex] = useState<number | null>(null);

  const [approvedAgent1Batches, setApprovedAgent1Batches] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('approved_agent1_batches');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  const [isAnalyzingAgent1Batch, setIsAnalyzingAgent1Batch] = useState<Record<string, boolean>>({});
  const [agent1BatchResults, setAgent1BatchResults] = useState<Record<string, any>>(() => {
    try {
      const saved = localStorage.getItem('agent1_batch_results');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      return {};
    }
  });

  const [expandedAgent1Batches, setExpandedAgent1Batches] = useState<Record<string, boolean>>({});

  const [excludeStandardized, setExcludeStandardized] = useState<boolean>(() => {
    return localStorage.getItem('agent1_exclude_standardized') === 'true';
  });

  const clearCustomBatchResults = () => {
    setApprovedAgent1Batches(prev => {
      const updated = { ...prev };
      delete updated['custom'];
      localStorage.setItem('approved_agent1_batches', JSON.stringify(updated));
      return updated;
    });
    setAgent1BatchResults(prev => {
      const updated = { ...prev };
      delete updated['custom'];
      localStorage.setItem('agent1_batch_results', JSON.stringify(updated));
      return updated;
    });
    try {
      sessionStorage.removeItem('chat_messages_medical_agent1_custom');
      sessionStorage.removeItem('last_sent_payload_medical_agent1_custom');
    } catch (err) {}
  };

  // Batch keys and splitting
  const markerKeys = React.useMemo(() => {
    // Derive all known keys from history, not from the flat biomarkers dict
    const allKnownKeys = new Set<string>();
    (biomarkerHistory || []).forEach((h: any) => {
      if (h.biomarkers) {
        Object.keys(h.biomarkers).forEach(k => {
          if (h.biomarkers[k] !== undefined && h.biomarkers[k] !== null && h.biomarkers[k] !== '') {
            allKnownKeys.add(k);
          }
        });
      }
    });

    // Fallback to flat dict if some keys exist only there
    if (biomarkers) {
      Object.keys(biomarkers).forEach(k => {
        if (biomarkers[k] !== undefined && biomarkers[k] !== null && biomarkers[k] !== '') {
          allKnownKeys.add(k);
        }
      });
    }

    return Array.from(allKnownKeys).filter(k => {
      if (excludeStandardized) {
        if (profile.customBiomarkers?.[k]?.standardMedicalGrouping !== undefined) return false;
        // Exclude built-in definitions that are already categorized
        const builtIn = biomarkerDefinitions.find(d => d.key === k);
        if (builtIn?.standardMedicalGrouping) return false;
      }
      return true;
    });
  }, [biomarkerHistory, biomarkers, excludeStandardized, profile.customBiomarkers]);

  const [biomarkerBatches, setBiomarkerBatches] = React.useState<string[][]>(() => {
    try {
      const saved = localStorage.getItem('biomarker_batches_custom');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [];
  });

  const [selectedMissingKeysToMove, setSelectedMissingKeysToMove] = React.useState<Record<number, string[]>>({});

  const batches = biomarkerBatches;

  React.useEffect(() => {
    localStorage.setItem('biomarker_batch_size', String(batchSize || 20));
  }, [batchSize]);

  React.useEffect(() => {
    const activeKeys = [...markerKeys];
    if (activeKeys.length === 0) {
      if (biomarkerBatches.length > 0) {
        setBiomarkerBatches([]);
        localStorage.setItem('biomarker_batches_custom', JSON.stringify([]));
      }
      return;
    }

    let currentBatches: string[][] = [];
    try {
      const saved = localStorage.getItem('biomarker_batches_custom');
      if (saved) currentBatches = JSON.parse(saved);
    } catch (e) {}

    currentBatches = currentBatches.map(batch => 
      batch.filter(key => activeKeys.includes(key))
    );

    // Keep completed batches exactly as they are. Re-chunk all uncompleted batches and any missing keys.
    const preservedBatches: string[][] = [];
    const keysToRechunk: string[] = [];

    currentBatches.forEach((batch, idx) => {
      const isApprovedStep2 = approvedAgent1Batches[idx];
      const hasResultStep2 = agent1BatchResults[idx];
      const isApprovedStep3 = approvedBatches[idx];
      const hasResultStep3 = batchAnalysisResults[idx];
      const isCompleted = isApprovedStep2 || hasResultStep2 || isApprovedStep3 || hasResultStep3;

      if (isCompleted) {
        preservedBatches.push(batch);
      } else {
        batch.forEach(key => {
          if (!keysToRechunk.includes(key)) {
            keysToRechunk.push(key);
          }
        });
      }
    });

    // Gather any active keys not present in any batch
    const keysInBatches = new Set([
      ...preservedBatches.flat(),
      ...keysToRechunk
    ]);
    const missingKeys = activeKeys.filter(k => !keysInBatches.has(k));
    missingKeys.forEach(key => {
      if (!keysToRechunk.includes(key)) {
        keysToRechunk.push(key);
      }
    });

    // Re-chunk the keysToRechunk into optimal chunks of size batchSize
    const size = batchSize || 20;
    let finalBatches = [...preservedBatches];

    if (keysToRechunk.length > 0) {
      for (let i = 0; i < keysToRechunk.length; i += size) {
        finalBatches.push(keysToRechunk.slice(i, i + size));
      }
    }

    // Fallback if we have absolutely empty batches but have active keys
    if (finalBatches.length === 0 && activeKeys.length > 0) {
      for (let i = 0; i < activeKeys.length; i += size) {
        finalBatches.push(activeKeys.slice(i, i + size));
      }
    }

    localStorage.setItem('biomarker_batch_size_last', String(batchSize || 20));

    // Filter out absolutely any empty batch to completely avoid empty batches and shift indices of associated metadata
    const nonEmptyBatches: string[][] = [];
    const indexMapping: Record<number, number> = {};

    finalBatches.forEach((batch, oldIdx) => {
      if (batch.length > 0) {
        const newIdx = nonEmptyBatches.length;
        indexMapping[newIdx] = oldIdx;
        nonEmptyBatches.push(batch);
      }
    });

    let indicesShifted = false;
    const nextApprovedBatches: Record<string, boolean> = {};
    const nextBatchAnalysisResults: Record<string, any> = {};
    const nextApprovedAgent1Batches: Record<string, boolean> = {};
    const nextAgent1BatchResults: Record<string, any> = {};

    nonEmptyBatches.forEach((batch, newIdx) => {
      const oldIdx = indexMapping[newIdx];
      if (oldIdx !== undefined) {
        if (oldIdx !== newIdx) {
          indicesShifted = true;
        }
        if (approvedBatches[oldIdx] !== undefined) nextApprovedBatches[newIdx] = approvedBatches[oldIdx];
        if (batchAnalysisResults[oldIdx] !== undefined) nextBatchAnalysisResults[newIdx] = batchAnalysisResults[oldIdx];
        if (approvedAgent1Batches[oldIdx] !== undefined) nextApprovedAgent1Batches[newIdx] = approvedAgent1Batches[oldIdx];
        if (agent1BatchResults[oldIdx] !== undefined) nextAgent1BatchResults[newIdx] = agent1BatchResults[oldIdx];
      }
    });

    // Also preserve non-numeric keys like 'custom' if they exist in the record
    Object.keys(approvedBatches).forEach(k => {
      if (isNaN(Number(k))) nextApprovedBatches[k] = approvedBatches[k];
    });
    Object.keys(batchAnalysisResults).forEach(k => {
      if (isNaN(Number(k))) nextBatchAnalysisResults[k] = batchAnalysisResults[k];
    });
    Object.keys(approvedAgent1Batches).forEach(k => {
      if (isNaN(Number(k))) nextApprovedAgent1Batches[k] = approvedAgent1Batches[k];
    });
    Object.keys(agent1BatchResults).forEach(k => {
      if (isNaN(Number(k))) nextAgent1BatchResults[k] = agent1BatchResults[k];
    });

    if (indicesShifted) {
      setApprovedBatches(nextApprovedBatches);
      localStorage.setItem('approved_data_review_batches', JSON.stringify(nextApprovedBatches));

      setBatchAnalysisResults(nextBatchAnalysisResults);
      localStorage.setItem('batch_analysis_results', JSON.stringify(nextBatchAnalysisResults));

      setApprovedAgent1Batches(nextApprovedAgent1Batches);
      localStorage.setItem('approved_agent1_batches', JSON.stringify(nextApprovedAgent1Batches));

      setAgent1BatchResults(nextAgent1BatchResults);
      localStorage.setItem('agent1_batch_results', JSON.stringify(nextAgent1BatchResults));
    }

    currentBatches = nonEmptyBatches;

    const currentStr = JSON.stringify(currentBatches);
    const stateStr = JSON.stringify(biomarkerBatches);
    if (currentStr !== stateStr) {
      setBiomarkerBatches(currentBatches);
      localStorage.setItem('biomarker_batches_custom', JSON.stringify(currentBatches));
    }
  }, [markerKeys, batchSize, approvedBatches, batchAnalysisResults, approvedAgent1Batches, agent1BatchResults]);


  React.useEffect(() => {
    const interval = setInterval(() => {
      const checkAndSet = (key, setter) => {
        try {
          const saved = localStorage.getItem(key);
          if (saved) {
            setter(prev => {
              if (JSON.stringify(prev) !== saved) {
                return JSON.parse(saved);
              }
              return prev;
            });
          }
        } catch (e) {}
      };

      checkAndSet('agent1_batch_results', setAgent1BatchResults);
      checkAndSet('approved_agent1_batches', setApprovedAgent1Batches);
      checkAndSet('batch_analysis_results', setBatchAnalysisResults);
      checkAndSet('approved_data_review_batches', setApprovedBatches);
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  React.useEffect(() => {
    const checkAndSet = (key, setter) => {
      try {
        const saved = localStorage.getItem(key);
        if (saved) {
          setter(prev => {
            if (JSON.stringify(prev) !== saved) {
              return JSON.parse(saved);
            }
            return prev;
          });
        }
      } catch (e) {}
    };
    checkAndSet('agent1_batch_results', setAgent1BatchResults);
    checkAndSet('approved_agent1_batches', setApprovedAgent1Batches);
    checkAndSet('batch_analysis_results', setBatchAnalysisResults);
    checkAndSet('approved_data_review_batches', setApprovedBatches);
  }, [profile, calibratingBatchIdx]);

  const handleMoveMissingBiomarkers = (bIdx: number, missingKeysToMove: string[]) => {
    if (!missingKeysToMove || missingKeysToMove.length === 0) return;

    let currentBatches = [...biomarkerBatches];

    missingKeysToMove.forEach(key => {
      // 1. Remove from current batch
      currentBatches[bIdx] = currentBatches[bIdx].filter(k => k !== key);

      // 2. Find the first subsequent unapproved & uncalibrated batch with space
      let placed = false;
      const size = batchSize || 20;

      for (let i = bIdx + 1; i < currentBatches.length; i++) {
        const isApproved = approvedBatches[i];
        const hasResult = batchAnalysisResults[i];
        const batchKeys = currentBatches[i];

        if (!isApproved && !hasResult && batchKeys.length < size) {
          batchKeys.push(key);
          placed = true;
          break;
        }
      }

      if (!placed) {
        // Find any subsequent unapproved & uncalibrated batch (even if full), and append it
        for (let i = bIdx + 1; i < currentBatches.length; i++) {
          const isApproved = approvedBatches[i];
          const hasResult = batchAnalysisResults[i];
          const batchKeys = currentBatches[i];

          if (!isApproved && !hasResult) {
            batchKeys.push(key);
            placed = true;
            break;
          }
        }
      }

      if (!placed) {
        // If there's no unapproved & uncalibrated subsequent batch, create a new batch at the end!
        currentBatches.push([key]);
      }
    });

    // Clean up empty batches
    currentBatches = currentBatches.filter((batch, idx) => 
      batch.length > 0 || idx === 0 || approvedBatches[idx] || batchAnalysisResults[idx]
    );

    // Save batches to state and localStorage
    setBiomarkerBatches(currentBatches);
    localStorage.setItem('biomarker_batches_custom', JSON.stringify(currentBatches));
  };

  // Biomarkers grouped dynamically by risk categories
  const groupedBiomarkers = React.useMemo<Record<string, Array<{ key: string; name: string; present: boolean }>>>(() => {
    const groups: Record<string, Array<{ key: string; name: string; present: boolean }>> = {};

    const isPresent = (key: string) => {
      const inBiomarkers = biomarkers[key] !== undefined && biomarkers[key] !== null && biomarkers[key] !== '';
      const inHistory = biomarkerHistory?.some(h => h.biomarkers && h.biomarkers[key] !== undefined) || false;
      return inBiomarkers || inHistory;
    };

    // Gather standard ones
    biomarkerDefinitions.forEach(def => {
      const present = isPresent(def.key);
      const customDef = profile?.customBiomarkers?.[def.key] as any;
      let risks = (customDef && customDef.riskCategories) ? customDef.riskCategories : (def.riskCategories || ['Uncategorized']);
      if (!Array.isArray(risks)) risks = [risks];
      if (risks.length === 0) risks = ['Uncategorized'];
      risks.forEach((cat: string) => {
        if (!groups[cat]) groups[cat] = [];
        if (!groups[cat].some(item => item.key === def.key)) {
          groups[cat].push({ key: def.key, name: customDef?.name || def.name, present });
        }
      });
    });

    // Custom/User ones in profile
    if (profile?.customBiomarkers) {
      Object.entries(profile.customBiomarkers).forEach(([key, def]) => {
        if (!def) return;
        // Skip if it's already a standard biomarker (handled above)
        if (biomarkerDefinitions.some(d => d.key === key)) return;
        
        const present = isPresent(key);
        let risks = (def as any).riskCategories || ['Uncategorized'];
        if (!Array.isArray(risks)) risks = [risks];
        if (risks.length === 0) risks = ['Uncategorized'];
        risks.forEach((cat: string) => {
          if (!groups[cat]) groups[cat] = [];
          if (!groups[cat].some(item => item.key === key)) {
            groups[cat].push({ key, name: (def as any).name, present });
          }
        });
      });
    }

    return groups;
  }, [profile, biomarkers, biomarkerHistory]);

  const toggleAgentHistory = (agentType: string) => {
    setExpandedAgentHistory(prev => ({ ...prev, [agentType]: !prev[agentType] }));
  };

  const handleApproveBatchStep1 = async (bIdx: number, result: any) => {
    // Parse the cleaned YAML
    const yamlText = result ? (result.extractedYaml || result) : '';
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
    const updatedCustoms = { ...(profile.customBiomarkers || {}) };
    let currentHistory = biomarkerHistory ? biomarkerHistory.map((h: any) => ({
      ...h,
      biomarkers: { ...h.biomarkers }
    })) : [];

    // 1. Identify which unstandardized raw keys were mapped to what standardized keys and migrate/delete
    if (result?.batchBiomarkers && Array.isArray(result.batchBiomarkers)) {
      result.batchBiomarkers.forEach((raw: any) => {
        const rawKey = raw.key;
        if (!rawKey) return;

        // Find best matched parsed row in the parsedRows output
        let bestParsedIdx = -1;
        parsedRows.forEach((parsed: any, idx: number) => {
          if (parsed.originalName) {
            const cleanRawName = raw.name.toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanParsedOrigName = parsed.originalName.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanRawName === cleanParsedOrigName || parsed.originalName === raw.name) {
              bestParsedIdx = idx;
            }
          }
        });

        if (bestParsedIdx !== -1) {
          const matched = parsedRows[bestParsedIdx];
          const stdKey = (matched.key || matched.biomarker || matched.standardizedName || matched.name || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
          if (stdKey && rawKey !== stdKey) {
            // Migrate existing values from rawKey to stdKey across all historical logs, then delete rawKey
            currentHistory.forEach((log: any) => {
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
          currentHistory.forEach((log: any) => {
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
      const key = row.key || (row.name || row.biomarker || row.standardizedName || '').toLowerCase().replace(/[^a-z0-9]/g, '_');
      if (!key) return;

      const name = row.name || row.biomarker || row.standardizedName || 'Unknown';
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

    currentHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

    // Recompute biomarkers list
    const recomputedBiomarkers: { [key: string]: number | string } = {};
    [...currentHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
      Object.entries(log.biomarkers).forEach(([k, v]) => {
        recomputedBiomarkers[k] = v as string | number;
      });
    });

    const updatedProfile = {
      ...profile,
      customBiomarkers: updatedCustoms
    };

    if (onUpdateProfile) {
      await onUpdateProfile(updatedProfile);
    }
    if (onUpdateHistory) {
      await onUpdateHistory(currentHistory, recomputedBiomarkers, updatedProfile);
    }

    // Mark as approved
    setApprovedAgent1Batches(prev => {
      const updated = { ...prev, [bIdx]: true };
      localStorage.setItem('approved_agent1_batches', JSON.stringify(updated));
      return updated;
    });
  };

  const handleApproveBatchStep2 = async (bIdx: number, result: any) => {
    // Save customBiomarkers to user profile
    const updatedCustoms = { ...(profile.customBiomarkers || {}) };
    result.reviewedBiomarkers?.forEach((bm: any) => {
      const existing: any = updatedCustoms[bm.key] || {};
      updatedCustoms[bm.key] = {
        ...existing,
        name: bm.name || existing.name,
        unit: existing.unit || bm.unit || '',
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

    const updatedProfile = {
      ...profile,
      customBiomarkers: updatedCustoms
    };

    if (onUpdateProfile) {
      await onUpdateProfile(updatedProfile);
    }

    // Move missing biomarkers to future batches if selected
    const keysToMove = selectedMissingKeysToMove[bIdx] || [];
    if (keysToMove.length > 0) {
      handleMoveMissingBiomarkers(bIdx, keysToMove);
    }

    // Mark as approved
    setApprovedBatches(prev => {
      const updated = { ...prev, [bIdx]: true };
      localStorage.setItem('approved_data_review_batches', JSON.stringify(updated));
      return updated;
    });
  };

  const handleRefineDataCleaning = () => {
    // 1. Set excludeStandardized to true to hide already standardized biomarkers
    setExcludeStandardized(true);
    localStorage.setItem('agent1_exclude_standardized', 'true');

    // 2. Reset approved agent 1 batches
    setApprovedAgent1Batches({});
    localStorage.removeItem('approved_agent1_batches');

    // 3. Clear agent 1 batch results
    setAgent1BatchResults({});
    localStorage.removeItem('agent1_batch_results');

    // 4. Clear session storage chat messages & payloads for all agent1 batches
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key && (key.includes('chat_messages_medical_agent1') || key.includes('last_sent_payload_medical_agent1'))) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(k => sessionStorage.removeItem(k));
    } catch (e) {
      console.warn("Failed to clear session storage during refine:", e);
    }
    
    // Also clear custom batch
    setCustomBatchKeys([]);
    localStorage.removeItem(`agent1_custom_batch_keys_${userIdentifier}`);
  };

  const renderAgentHistory = (agentType: string) => {
    const history = (profile.agentAnalyses || [])
      .filter(a => a.agentType === agentType)
      .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
    
    // Exclude the currently displayed active one
    const isDataAccuracy = agentType === 'data_accuracy';
    const latestActive = isDataAccuracy ? null : history.filter(a => !a.archived)[0];
    const prevAnalyses = isDataAccuracy ? history : history.filter(a => a.id !== latestActive?.id);
    
    if (prevAnalyses.length === 0) return null;
    
    const isExpanded = expandedAgentHistory[agentType] ?? (!latestActive);
    const latestPrev = prevAnalyses[0];
    
    const dateObj = new Date(latestPrev.date);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - dateObj.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    const timeStr = diffDays > 0 ? `${diffDays} days ago` : 'today';

    return (
      <div className="mt-3">
        <button 
          onClick={() => toggleAgentHistory(agentType)}
          className="text-[11px] text-slate-500 dark:text-slate-400 font-medium flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
        >
          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          Last analysis on {dateObj.toLocaleDateString()} ({timeStr})
        </button>
        {isExpanded && (
          <div className="mt-2 space-y-2">
            {prevAnalyses.map(item => (
              <div key={item.id} className="p-3 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 rounded-xl relative group">
                <p className="text-[10px] font-bold text-slate-400 mb-1">{new Date(item.date).toLocaleString()}</p>
                {['agent1', 'agent2', 'agent3', 'agent4'].includes(agentType) && item.result ? (
                  <div className="mt-2">
                    <AgentResultTable
                      agentType={agentType as 'agent1' | 'agent2' | 'agent3' | 'agent4'}
                      agentResult={item.result}
                      profile={profile}
                      biomarkerHistory={biomarkerHistory || []}
                      initialRawText=""
                    />
                  </div>
                ) : agentType === 'agent5' ? (
                  <div className="mt-2">
                    <Agent5View rawResult={item.result} />
                  </div>
                ) : agentType === 'agent6' ? (
                  <div className="mt-2">
                    <Agent6View rawResult={item.result} />
                  </div>
                ) : agentType === 'agent7' ? (
                  <div className="mt-2">
                    <Agent7View rawResult={item.result} />
                  </div>
                ) : agentType === 'data_accuracy' ? (
                  <div className="mt-2 space-y-2 text-xs text-left">
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-2.5 rounded-lg">
                      <p className="font-semibold text-slate-500 dark:text-slate-400">User Input:</p>
                      <p className="text-slate-800 dark:text-slate-200 mt-1 italic whitespace-pre-wrap">"{item.result?.inputText}"</p>
                    </div>
                    <div className="bg-indigo-50/50 dark:bg-indigo-950/15 border border-indigo-100/50 dark:border-indigo-900/30 p-2.5 rounded-lg text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                      <p className="font-semibold text-indigo-800 dark:text-indigo-400 mb-1">Agent Explanation:</p>
                      {item.result?.explanation}
                    </div>
                  </div>
                ) : (
                  <div className={`text-[10px] text-slate-700 dark:text-slate-300 font-mono overflow-auto ${agentType === 'agent1' ? 'max-h-96' : 'max-h-32'}`}>
                    <pre>{typeof item.result === 'string' ? item.result : (() => { try { return JSON.stringify(item.result, null, 2); } catch (e) { return String(item.result); } })()}</pre>
                  </div>
                )}
                {onDeleteAnalysis && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteAnalysis(item.id); }}
                    className="absolute top-2 right-2 p-1.5 text-slate-400 hover:text-red-500 transition-opacity cursor-pointer bg-white dark:bg-slate-900 rounded-lg shadow-sm border border-slate-200 dark:border-slate-800"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const handleRefine = () => {
    if (!refinementText.trim() || isGenerating) return;
    const userMessage = { role: "user", text: refinementText };
    const aiMessage = { role: "ai", text: JSON.stringify(draftReport) };
    const updatedHistory = [...chatHistory, aiMessage, userMessage];
    setChatHistory(updatedHistory);
    // @ts-ignore - we updated the signature in App.tsx but interface might not match exactly, so casting
    (onGenerateReport as any)(selectedModelId, { message: refinementText, chatHistory: updatedHistory });
    setRefinementText("");
  };

  const missingProfilePoints: string[] = [];
  if (profile.age === undefined || profile.age === null || String(profile.age).trim() === '') missingProfilePoints.push('Age');
  if (profile.ethnicity === undefined || profile.ethnicity === null || String(profile.ethnicity).trim() === '' || String(profile.ethnicity).toLowerCase() === 'unknown') missingProfilePoints.push('Ethnicity');
  if (profile.weight === undefined || profile.weight === null || String(profile.weight).trim() === '') missingProfilePoints.push('Weight');
  if (profile.height === undefined || profile.height === null || String(profile.height).trim() === '') missingProfilePoints.push('Height');

  const hasProfileInfo = missingProfilePoints.length === 0;

  // Verify missing data points above the button
   // Determine if basic demographics are present
  const criticalMissing = [
    { name: 'Age', present: !!profile?.age },
    { name: 'Ethnicity', present: !!profile?.ethnicity && String(profile.ethnicity).toLowerCase() !== 'unknown' },
    { name: 'Weight', present: !!profile?.weight },
    { name: 'Height', present: !!profile?.height }
  ].filter(p => !p.present);

  const getMissingNote = () => {
    if (criticalMissing.length === 0) return "";
    const missingNames = criticalMissing.map(p => p.name).join(", ");
    return `For best health recommendations, please add the following data: ${missingNames}.`;
  };

  const steps = [
    {
      id: 'add_health_data',
      title: 'Add your health data',
      agentType: null,
      description: 'Allows the clinical multi-agent team to calibrate reference ranges and interventions to your precise physiology.',
      valueProposition: 'Demographics and core biomarkers checklist calibration.'
    },
    {
      id: 'data_review',
      title: 'Data review',
      agentType: 'data_review',
      description: 'Performs clinical taxonomy mapping, reference range calibration, and personalized health risk estimation on biomarker batches.',
      valueProposition: 'Provides interactive review of your biomarkers with custom reference range adjustments.'
    },
    {
      id: 'agent6',
      title: 'Diagnostic',
      agentType: 'agent6',
      description: 'Translates diagnostic risk into strict, mathematically projected dietary and movement targets.',
      valueProposition: 'Generates precision physical and nutritional modifiers targeted to mitigate risk trajectories.'
    },
    {
      id: 'agent4',
      title: 'Projections',
      agentType: 'agent4',
      description: 'Analyzes biomarker history to project timeline risks (2, 5, 10 years) and identifies testing gaps.',
      valueProposition: 'Forecasts cardiovascular, metabolic, and systemic health trajectories over a 10-year horizon.'
    },
    {
      id: 'agent7',
      title: 'Insights',
      agentType: 'agent7',
      description: 'Scans PubMed and clinical trials to bring recent scientific debate and consensus on your specific health context.',
      valueProposition: 'Synthesizes clinical trial consensus and research evidence specific to your biomarkers.'
    }
  ];

  const getStepStatus = (index: number): 'Not ready' | 'To do' | 'To review' | 'Done' => {
    const step = steps[index];
    if (!step) return 'Not ready';

    if (index === 0) {
      const isDone = criticalMissing.length === 0;
      return isDone ? 'Done' : 'To do';
    }

    // Gating check: previous required steps must be Done
    const isProjectOrInsight = step.agentType === 'agent4' || step.agentType === 'agent7';

    if (!isAdminMode || !isProjectOrInsight) {
      for (let j = 0; j < index; j++) {
        if (j === 0) {
          const isDone = criticalMissing.length === 0;
          if (!isDone) return 'Not ready';
        } else {
          const prevStep = steps[j];
          if (prevStep.id === 'data_review') {
            // Do not block subsequent steps if data review is not completed
            continue;
          } else if (prevStep.id === 'agent1') {
            // Do not block if data cleaning is not done
            continue;
          } else {
            const prevAgentType = prevStep.agentType!;
            const prevApproved = approvedSteps[prevAgentType];
            if (!prevApproved) return 'Not ready';
          }
        }
      }
    }
    if (step.id === 'data_review') {
      if (batches.length === 0) return 'To do';
      const allApproved = batches.every((_, bIdx) => approvedBatches[bIdx]);
      if (allApproved) return 'Done';
      const hasSomeAnalysis = Object.keys(batchAnalysisResults).length > 0;
      return hasSomeAnalysis ? 'To review' : 'To do';
    }

    const agentType = step.agentType!;
    
    // Check if there's any saved analysis for this agent in history
    const history = (profile.agentAnalyses || []).filter(a => a.agentType === agentType);
    if (history.length === 0) return 'To do';

    const latestAnalysis = (profile.agentAnalyses || [])
      .filter(a => a.agentType === agentType && !a.archived)
      .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))[0];

    const isApproved = approvedSteps[agentType] && (!latestAnalysis || approvedAnalysisIds[agentType] === latestAnalysis.id);
    return isApproved ? 'Done' : 'To review';
  };

  const getStepSummaryText = (index: number, status: 'Not ready' | 'To do' | 'To review' | 'Done') => {
    if (index === 0) {
      if (status === 'Done') return 'Demographics complete';
      return `${criticalMissing.length} demographics missing`;
    }

    const step = steps[index];
    if (step.id === 'data_review') {
      const total = markerKeys.length;
      if (total === 0) return 'No biomarkers logged';
      const approvedCount = batches.filter((_, bIdx) => approvedBatches[bIdx]).length;
      return `${approvedCount} of ${batches.length} batches reviewed`;
    }

    const latestAnalysis = (profile.agentAnalyses || [])
      .filter(a => a.agentType === step.agentType && !a.archived)
      .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))[0];

    if (!latestAnalysis) {
      if (status === 'Not ready') return 'Waiting for previous steps';
      return 'Unlocked & awaiting analysis';
    }

    const recWord = status === 'Done' ? 'applied' : 'need review';
    switch (step.agentType) {
      case 'agent1': {
        let count = 0;
        if (typeof latestAnalysis.result === 'string') {
          count = latestAnalysis.result.split('\n').filter(l => l.trim().startsWith('-') || l.trim().startsWith('biomarker:')).length;
        } else if (Array.isArray(latestAnalysis.result)) {
          count = latestAnalysis.result.length;
        }
        return `${count || 5} biomarkers extracted, ${recWord}`;
      }
      case 'agent6':
        return `Precision diet and exercise recommendations generated, ${recWord}`;
      case 'agent4':
        return `10-year trajectories projected, ${recWord}`;
      case 'agent7':
        return `PubMed & clinical literature insights integrated, ${recWord}`;
      default:
        return 'Analysis results ready';
    }
  };

  const handleApproveStep = (index: number) => {
    const step = steps[index];
    if (step.id === 'data_review') {
      const updatedApproved = { ...approvedBatches };
      batches.forEach((_, bIdx) => {
        updatedApproved[bIdx] = true;
      });
      setApprovedBatches(updatedApproved);
      localStorage.setItem('approved_data_review_batches', JSON.stringify(updatedApproved));
    } else {
      if (!step.agentType) return;
      
      // Save state
      setApprovedSteps(prev => ({ ...prev, [step.agentType!]: true }));
      
      const latestAnalysis = (profile.agentAnalyses || [])
        .filter(a => a.agentType === step.agentType && !a.archived)
        .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))[0];
      if (latestAnalysis) {
        setApprovedAnalysisId(step.agentType!, latestAnalysis.id);
      }
    }
    
    // Find next open/To do step to expand
    const nextIndex = index + 1;
    if (nextIndex < steps.length) {
      setActiveStepIndex(nextIndex);
      
      // Smooth scroll to next step element
      setTimeout(() => {
        const el = document.getElementById(`accordion-step-${nextIndex}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 150);
    } else {
      setActiveStepIndex(null); // All steps completed!
    }
  };

  const handleAcceptClick = async () => {
    if (!draftReport) return;
    setIsApplying(true);
    try {
      await onAcceptReport(draftReport);
    } catch (e) {
      console.error(e);
    } finally {
      setIsApplying(false);
    }
  };

  // If a draft is generated, show the interactive review & approval screen
  if (draftReport) {
    const isSpecialUser = profile?.email?.toLowerCase() === 'chiwah.liu@gmail.com' || profile?.email?.toLowerCase() === 'cwah.liu@gmail.com';

    return (
      <div className="space-y-10 pb-24 animation-fade-in max-w-md mx-auto px-[10px] mt-4 font-sans text-slate-900 dark:text-slate-100">
        
        {/* Draft Heading Alert */}
        <div className="space-y-3 relative overflow-hidden">
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-amber-500 animate-pulse" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200/20 px-2 py-0.5 rounded-full">Prevention Draft</span>
          </div>
          <h2 className="text-xl font-extrabold tracking-tight font-display text-slate-900 dark:text-slate-100 leading-tight">Interactive Target Review</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Our preventative algorithms generated customized clinical guidelines tailored specifically to your biochemistry. Please review and approve these targets to sync them directly to your dashboard.
          </p>
        </div>

        {/* SECTION 1: Data Taken Into Account */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/50 pb-3">
            <Database className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">1. Source Clinical Data Analyzed</h3>
          </div>
          
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800/20">
              <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">User Profile</span>
              <span className="font-semibold block">{profile.age}yo, {profile.ethnicity || 'Unknown Ethnicity'}</span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">{profile.weight} kg | {profile.height} cm</span>
              {(profile.gender || profile.bloodType) && (
                <span className="text-[10px] text-slate-500 block">
                  {profile.gender ? profile.gender : ''} {profile.gender && profile.bloodType ? '|' : ''} {profile.bloodType ? `Blood: ${profile.bloodType}` : ''}
                </span>
              )}
            </div>

            <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800/20">
              <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Nutrition Inputs</span>
              <span className="font-semibold block">{foodLogs.length} logged entries</span>
              <span className="text-[10px] text-slate-500 mt-0.5 block">Recent eating patterns</span>
            </div>
          </div>

          <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800/20 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">Checked Biomarker Values</span>
              <span className="text-[10px] text-slate-400">{Object.keys(biomarkers).length} logged</span>
            </div>
            
            {Object.keys(biomarkers).length > 0 ? (
              <details className="group">
                <summary className="text-[11px] font-bold text-indigo-600 cursor-pointer list-none flex items-center gap-1">
                  <span>View All Used Biomarkers</span>
                  <span className="transition-transform group-open:rotate-180">▼</span>
                </summary>
                <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-center text-[11px]">
                  {Object.entries(biomarkers).map(([k, v]) => (
                    <div key={k} className="py-1 px-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-150 dark:border-slate-800/60 overflow-hidden">
                      <span className="block text-[9px] text-slate-400 font-semibold truncate" title={k}>{k.replace(/_/g, ' ').toUpperCase()}</span>
                      <span className="font-bold text-indigo-600 font-mono">
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            ) : (
              <p className="text-[11px] text-slate-500 italic">No biomarker data available. Using general population defaults.</p>
            )}
            
            {isSpecialUser && (
              <p className="text-[10px] text-slate-500 italic mt-2 leading-normal">
                🧬 East Asian genetics and specific kidney filtration rate (eGFR) profiles were fully integrated.
              </p>
            )}
          </div>
        </div>

        {/* SECTION 2: Proposed Daily Nutrient Targets */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/50 pb-3">
            <Activity className="w-4 h-4 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">2. Proposed Nutrient Recommendations</h3>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs py-2 px-3 bg-slate-50 dark:bg-slate-950 rounded-xl">
              <span className="font-semibold text-slate-700 dark:text-slate-350">Calories</span>
              <span className="font-mono font-bold text-slate-900 dark:text-white">{draftReport.dailyNutrientTargets.calories || '1,800 kcal'}</span>
            </div>
            <div className="flex items-center justify-between text-xs py-2 px-3 bg-slate-50 dark:bg-slate-950 rounded-xl">
              <span className="font-semibold text-slate-700 dark:text-slate-350">Saturated Fat</span>
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{draftReport.dailyNutrientTargets.saturatedFat || 'under 15 g'}</span>
            </div>
            <div className="flex items-center justify-between text-xs py-2 px-3 bg-slate-50 dark:bg-slate-950 rounded-xl">
              <span className="font-semibold text-slate-700 dark:text-slate-350">Sodium</span>
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{draftReport.dailyNutrientTargets.sodium || 'under 1,200 mg'}</span>
            </div>
            <div className="flex items-center justify-between text-xs py-2 px-3 bg-slate-50 dark:bg-slate-950 rounded-xl">
              <span className="font-semibold text-slate-700 dark:text-slate-350">Protein</span>
              <span className="font-mono font-bold text-slate-900 dark:text-white">{draftReport.dailyNutrientTargets.protein || '90-100 g'}</span>
            </div>
            <div className="flex items-center justify-between text-xs py-2 px-3 bg-slate-50 dark:bg-slate-950 rounded-xl">
              <span className="font-semibold text-slate-700 dark:text-slate-350">Soluble Fibre</span>
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400">{draftReport.dailyNutrientTargets.solubleFibre || '10-15 g'}</span>
            </div>
          </div>
        </div>

        {/* SECTION 3: Action Plan / What Target User Should Do */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/50 pb-3">
            <Heart className="w-4 h-4 text-rose-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">3. Preventative Action Checklist</h3>
          </div>

          <div className="space-y-3.5">
            {draftReport.actions.slice(0, 3).map((act, idx) => (
              <div key={idx} className="flex gap-2 text-xs">
                <div className="w-1.5 h-1.5 rounded-full bg-rose-500 mt-1.5 flex-shrink-0" />
                <div className="space-y-0.5">
                  <span className="font-bold text-slate-900 dark:text-white block">{act.task}</span>
                  <span className="text-[10px] text-slate-500 leading-normal block">{act.explanation}</span>
                </div>
              </div>
            ))}

            <div className="border-t border-slate-100 dark:border-slate-800/40 my-3 pt-3" />

            <div className="space-y-2">
              <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Recommended Habit Modifiers</span>
              {draftReport.dailyBenefits.slice(0, 3).map((ben, idx) => (
                <div key={idx} className="flex items-center gap-2 text-xs">
                  <CheckCircle className="w-3.5 h-3.5 text-indigo-500 flex-shrink-0" />
                  <span className="font-medium text-slate-750 dark:text-slate-300">{ben.activity || (ben as any).label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* SECTION 4: Risk Forecast Comparison */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800/50 pb-3">
            <TrendingDown className="w-4 h-4 text-rose-500" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 font-display">4. 10-Year Clinical Forecast</h3>
          </div>

          <div className="space-y-3 text-xs leading-relaxed">
            <div className="p-3 bg-rose-50/50 dark:bg-rose-950/20 border border-rose-100/40 rounded-2xl">
              <span className="text-[9px] uppercase font-bold tracking-wider text-rose-600 block mb-1">If Habits Do Not Change:</span>
              <p className="text-rose-700 dark:text-rose-300 font-medium">{draftReport.healthRiskForecast.year10}</p>
            </div>

            <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-100/40 rounded-2xl">
              <span className="text-[9px] uppercase font-bold tracking-wider text-emerald-600 block mb-1">With Optimized Targets Applied:</span>
              <p className="text-emerald-700 dark:text-emerald-300 font-semibold">{draftReport.healthRiskForecast.optimized10}</p>
            </div>
          </div>
        </div>

        {/* REFINEMENT CHAT PANEL */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-2xl p-3 flex items-center gap-2">
          <input 
            type="text" 
            placeholder="Refine this recommendation..." 
            className="flex-1 bg-transparent text-sm text-slate-800 dark:text-slate-200 focus:outline-none"
            value={refinementText}
            onChange={(e) => setRefinementText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleRefine()}
          />
          <button 
            onClick={handleRefine}
            disabled={!refinementText.trim() || isGenerating}
            className="w-8 h-8 rounded-full bg-indigo-600 text-white flex items-center justify-center cursor-pointer disabled:opacity-50"
          >
            {isGenerating ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>

        {/* ACCEPT / REJECT BUTTONS */}
        <div className="grid grid-cols-2 gap-3 pt-2">
          <button
            onClick={onRejectReport}
            disabled={isApplying}
            className="py-3 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 rounded-2xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" />
            Reject Draft
          </button>

          <button
            onClick={handleAcceptClick}
            disabled={isApplying}
            className="py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-xs font-bold transition-all shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            {isApplying ? (
              <>
                <Loader className="w-3.5 h-3.5 animate-spin" />
                Applying...
              </>
            ) : (
              <>
                <Check className="w-3.5 h-3.5" />
                Accept & Apply
              </>
            )}
          </button>
        </div>

      </div>
    );
  }

  // Normal view when no draft is generated
  const completedCount = steps.map((_, idx) => idx).filter(idx => getStepStatus(idx) === 'Done').length;

  return (
    <div className="space-y-10 pb-24 animation-fade-in max-w-md mx-auto px-[10px] mt-4 font-sans text-slate-900 dark:text-slate-100">
      
      {/* Global Progress Indicator */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between text-xs font-mono font-bold text-slate-500">
          <span className="text-indigo-600 dark:text-indigo-400">CLINICAL PIPELINE PROGRESS</span>
          <span>{completedCount} of {steps.length} Steps Completed</span>
        </div>
        <div className="w-full bg-slate-100 dark:bg-slate-800 h-2.5 rounded-full overflow-hidden border border-slate-200/20">
          <div 
            className="bg-gradient-to-r from-indigo-500 to-indigo-600 h-full rounded-full transition-all duration-500 ease-out" 
            style={{ width: `${(completedCount / steps.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Multi-Agent Clinical Diagnostics Accordion Group */}
      <div id="agent-diagnostics-dashboard" className="space-y-4">
        <div className="flex items-center gap-2 pb-3 border-b border-slate-100 dark:border-slate-800/50">
          <Sparkles className="w-5 h-5 text-indigo-600" />
          <h3 className="font-bold text-slate-950 dark:text-slate-100 text-sm flex items-center gap-2">
            Clinical Multi-Agent Pipeline
          </h3>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800/60">
          {steps.map((step, index) => {
            const status = getStepStatus(index);
            const summaryText = getStepSummaryText(index, status);
            const latestAnalysis = step.agentType 
              ? (profile.agentAnalyses || [])
                  .filter(a => a.agentType === step.agentType && !a.archived)
                  .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))[0]
              : null;

            return (
              <div 
                key={step.id} 
                id={`accordion-step-${index}`} 
                className={`py-4 first:pt-0 last:pb-0`}
              >
                {/* Accordion Header */}
                <div 
                  onClick={() => {
                    setActiveStepIndex(activeStepIndex === index ? null : index);
                  }}
                  className="flex items-center justify-between cursor-pointer group transition-opacity hover:opacity-95"
                >
                  <div className="flex items-center gap-3">
                    {/* Step Number Badge */}
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                      status === 'Done' 
                        ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400' 
                        : status === 'To review'
                        ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400'
                        : status === 'To do'
                        ? 'bg-indigo-100 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                    }`}>
                      {index + 1}
                    </span>
                    
                    <div className="space-y-0.5">
                      <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs flex items-center gap-1.5">
                        {step.title}
                      </h4>
                      {/* Dynamic Summary */}
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium">
                        {summaryText}
                      </p>
                    </div>
                  </div>

                  {/* Status Indicator Badge */}
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider ${
                      status === 'Done'
                        ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border border-emerald-200/20'
                        : status === 'To review'
                        ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border border-amber-200/20 animate-pulse'
                        : status === 'To do'
                        ? 'bg-indigo-50 dark:bg-indigo-950/20 text-indigo-700 dark:text-indigo-400 border border-indigo-200/20'
                        : 'bg-slate-50 dark:bg-slate-900 text-slate-450 border border-slate-200/10'
                    }`}>
                      {status === 'Not ready' ? 'Pending' : status}
                    </span>
                    {activeStepIndex === index ? <ChevronUp className="w-3.5 h-3.5 text-slate-400" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 dark:group-hover:text-slate-200" />}
                  </div>
                </div>

                {/* Expanded Content */}
                {activeStepIndex === index && (
                  <div className="mt-3.5 pl-0 space-y-4 animation-fade-in">
                    {step.description && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                        {step.description}
                      </p>
                    )}

                    {/* Value Proposition Box */}
                    <div className="p-3 bg-indigo-50/20 dark:bg-indigo-950/10 rounded-2xl border border-indigo-100/30 dark:border-indigo-900/10">
                      <span className="block text-[8px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-1">CLINICAL VALUE PROPOSITION</span>
                      <p className="text-[11px] text-slate-900 dark:text-white leading-relaxed font-medium">
                        {step.valueProposition}
                      </p>
                    </div>

                    {index === 0 ? (
                      /* Tell us about you Step 0 expanded */
                      <div className="space-y-4">
                        {(() => {
                          const checklistItems = [
                            { name: 'Age', present: !!profile?.age, presentCount: 0, type: 'demographic' },
                            { name: 'Ethnicity', present: !!profile?.ethnicity && String(profile.ethnicity).toLowerCase() !== 'unknown', presentCount: 0, type: 'demographic' },
                            { name: 'Weight', present: !!profile?.weight, presentCount: 0, type: 'demographic' },
                            { name: 'Height', present: !!profile?.height, presentCount: 0, type: 'demographic' },
                            ...Object.entries(groupedBiomarkers).map(([category, items]) => {
                              const typedItems = items as Array<{ key: string; name: string; present: boolean }>;
                              const presentCount = typedItems.filter(item => item.present).length;
                              return {
                                name: category,
                                present: presentCount > 0,
                                presentCount,
                                type: 'biomarker_category'
                              };
                            })
                          ];

                          return (
                            <div className="space-y-4">
                              {/* what's done so far Checklist */}
                              <div className="space-y-3">
                                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                  what's done so far
                                </span>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                  {checklistItems.map((item, idx) => {
                                    const hasAtLeastOne = item.present;
                                    return (
                                      <div 
                                        key={idx} 
                                        className={`flex items-center justify-between p-2.5 rounded-xl border transition-all ${
                                          hasAtLeastOne
                                            ? 'bg-emerald-50/20 dark:bg-emerald-950/10 border-emerald-100/30 dark:border-emerald-950/30 text-slate-800 dark:text-slate-200'
                                            : 'bg-slate-50/50 dark:bg-slate-900/30 border-slate-100/60 dark:border-slate-800/40 text-slate-400'
                                        }`}
                                      >
                                        <div className="flex items-center gap-2">
                                          <Activity className={`w-3.5 h-3.5 ${hasAtLeastOne ? 'text-emerald-500' : 'text-slate-400'}`} />
                                          <div className="flex flex-col">
                                            <span className={`text-[11px] font-bold ${hasAtLeastOne ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>
                                              {item.name}
                                            </span>
                                            {item.type === 'biomarker_category' && (
                                              <span className="text-[9px] font-mono text-slate-400">
                                                {item.presentCount} added
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                        <div>
                                          {hasAtLeastOne ? (
                                            <CheckCircle className="w-3.5 h-3.5 text-emerald-600 fill-emerald-600/10" />
                                          ) : (
                                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300 dark:bg-slate-700 mr-1" />
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>

                              {criticalMissing.length > 0 && (
                                <div className="bg-amber-50/50 dark:bg-amber-950/20 border border-amber-500/10 rounded-2xl p-3 flex gap-2">
                                  <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                                  <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-normal font-medium">
                                    You are missing critical indicators: <strong>{criticalMissing.map(m => m.name).join(', ')}</strong>. You can still generate, but the analysis will use generalized defaults.
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        })()}

                        {onOpenMedicalChat && (
                          <button
                            onClick={() => onOpenMedicalChat()}
                            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center mt-2 cursor-pointer"
                          >
                            Add health data
                          </button>
                        )}
                      </div>
                    ) : step.id === 'agent1' ? (
                      /* Interactive Data Cleaning / Standardization Batch-by-Batch UI */
                      <div className="space-y-4">
                        {batches.length === 0 ? (
                          <div className="p-4 text-center bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 text-slate-500 text-xs">
                            No biomarkers available. Please add some health data first in Step 1.
                          </div>
                        ) : (
                          <div className="space-y-4 text-left">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800/60 pb-3 mb-2">
                              <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                Biomarker Standardization Batches ({batchSize} items max)
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-medium text-slate-500">Items per batch:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="100"
                                  value={batchSizeInput}
                                  onChange={(e) => {
                                    const valStr = e.target.value;
                                    setBatchSizeInput(valStr);
                                    if (valStr !== '') {
                                      const val = parseInt(valStr, 10);
                                      if (!isNaN(val) && val > 0 && onChangeBatchSize) {
                                        onChangeBatchSize(val);
                                      }
                                    }
                                  }}
                                  className="w-16 text-[10px] font-bold bg-slate-50 dark:bg-slate-900 border border-slate-250 dark:border-slate-800 rounded-lg px-2 py-1 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-text"
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm("This will clear all processed batches in Data Cleaning and Data Review, and force a full re-chunking. Proceed?")) {
                                      setApprovedBatches({});
                                      setBatchAnalysisResults({});
                                      setApprovedAgent1Batches({});
                                      setAgent1BatchResults({});
                                      localStorage.removeItem('approved_data_review_batches');
                                      localStorage.removeItem('batch_analysis_results');
                                      localStorage.removeItem('approved_agent1_batches');
                                      localStorage.removeItem('agent1_batch_results');
                                      if (onChangeBatchSize) onChangeBatchSize(parseInt(batchSizeInput) || 20);
                                    }
                                  }}
                                  title="Reset all batch progress to force re-chunk"
                                  className="ml-2 px-2 py-1 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 text-[10px] font-bold rounded flex-shrink-0 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                                >
                                  Reset Batches
                                </button>
                              </div>
                            </div>
                            
                            <div className="space-y-3">
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50 dark:bg-slate-900/60 p-3 rounded-2xl border border-slate-100 dark:border-slate-800/80 mb-2">
                                <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium flex flex-wrap items-center gap-2">
                                  <span>Standardized: <span className="font-bold text-indigo-600 dark:text-indigo-400">{Object.keys(approvedAgent1Batches).filter(k => approvedAgent1Batches[k]).length}</span> of <span className="font-bold text-slate-700 dark:text-slate-300">{batches.length}</span> batches.</span>
                                  {excludeStandardized && (
                                    <span className="bg-amber-100 dark:bg-amber-950/40 text-amber-850 dark:text-amber-300 px-2 py-0.5 rounded-full text-[9px] font-semibold border border-amber-200/30 flex items-center gap-1">
                                      Refinement Active
                                      <button 
                                        onClick={() => {
                                          setExcludeStandardized(false);
                                          localStorage.setItem('agent1_exclude_standardized', 'false');
                                        }} 
                                        className="text-amber-700 dark:text-amber-400 hover:text-amber-900 dark:hover:text-amber-100 ml-1 font-bold cursor-pointer underline"
                                        title="Show All Biomarkers"
                                      >
                                        Show All
                                      </button>
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    onClick={() => {
                                      const next = !excludeStandardized;
                                      setExcludeStandardized(next);
                                      localStorage.setItem('agent1_exclude_standardized', String(next));
                                    }}
                                    className={`px-3 py-1.5 text-[10px] font-bold rounded-lg border transition-colors cursor-pointer ${excludeStandardized ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300' : 'bg-slate-50 dark:bg-slate-900/40 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                                    title={excludeStandardized ? "Showing only unstandardized biomarkers. Click to show all." : "Showing all biomarkers. Click to hide already standardized ones."}
                                  >
                                    {excludeStandardized ? 'Filter: Unstandardized Only' : 'Filter: Show All'}
                                  </button>
                                  <button
                                    onClick={handleRefineDataCleaning}
                                    className="px-3 py-1.5 text-[10px] font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 dark:text-amber-400 dark:bg-amber-950/20 dark:hover:bg-amber-950/35 rounded-lg transition-colors flex items-center gap-1 border border-amber-200/40 cursor-pointer"
                                    title="Keep currently saved standardizations but reset the batch list & cached responses to run a fresh pass over remaining biomarkers"
                                  >
                                    <Sparkles className="w-3 h-3 text-amber-500" />
                                    Refine Data Cleaning
                                  </button>
                                  <button onClick={() => setShowCustomBatchModal(true)} className="px-3 py-1.5 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 dark:text-indigo-400 dark:bg-indigo-950/20 dark:hover:bg-indigo-950/35 rounded-lg transition-colors cursor-pointer">
                                    + Test Custom Batch
                                  </button>
                                </div>
                              </div>
                              {[...batches.map((b, i) => ({ keys: b, idx: i.toString(), isCustom: false })), ...(customBatchKeys.length > 0 ? [{ keys: customBatchKeys, idx: 'custom', isCustom: true }] : [])].map(({ keys: batchKeys, idx: bIdx, isCustom }) => {
                                const isApproved = approvedAgent1Batches[bIdx];
                                const isAnalyzing = isAnalyzingAgent1Batch[bIdx];
                                const result = agent1BatchResults[bIdx];
                                const isCurrentUnlocked = true;
                                const isExpanded = expandedAgent1Batches[bIdx] ?? (!isApproved || !result);

                                return (
                                  <div 
                                    key={bIdx} 
                                    className={`p-4 rounded-2xl border transition-all ${
                                      isApproved 
                                        ? 'bg-emerald-50/10 border-emerald-500/20' 
                                        : result 
                                        ? 'bg-indigo-50/5 border-indigo-500/20'
                                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <div className="flex items-center gap-3">
                                        <div className={`p-2 rounded-xl ${
                                          isApproved 
                                            ? 'bg-emerald-500/10 text-emerald-600' 
                                            : result 
                                            ? 'bg-indigo-500/10 text-indigo-600'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                                        }`}>
                                          <Database className="w-4 h-4" />
                                        </div>
                                        <div className="text-left">
                                          <h5 className="text-[12px] font-bold text-slate-900 dark:text-white flex items-center gap-2">
                                            {isCustom ? 'Custom Test Batch' : `Batch ${parseInt(bIdx as string) + 1}`}
                                          </h5>
                                          <p 
                                            className="text-[10px] text-slate-400 dark:text-slate-500 font-medium"
                                            style={{ fontVariant: 'small-caps' }}
                                          >
                                            {batchKeys.length} biomarkers assigned
                                          </p>
                                        </div>
                                      </div>

                                      <div className="flex items-center gap-2">
                                        {/* Status badge */}
                                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider ${
                                          isApproved 
                                            ? 'bg-emerald-500/10 text-emerald-600' 
                                            : result 
                                            ? 'bg-indigo-500/10 text-indigo-600'
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-400'
                                        }`}>
                                          {isApproved ? 'Approved & Logged' : result ? 'Cleaned' : 'Not Cleaned'}
                                        </span>

                                        <button
                                          type="button"
                                          onClick={() => {
                                            setExpandedAgent1Batches(prev => ({ ...prev, [bIdx]: !isExpanded }));
                                          }}
                                          className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                                        >
                                          {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                                        </button>
                                      </div>
                                    </div>

                                    {/* Expanded Batch Details */}
                                    {isExpanded && (
                                      <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/60 space-y-3">
                                        {/* Biomarkers in this batch */}
                                        <div>
                                          <span className="block text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                                            Biomarkers in {isCustom ? 'Custom Test Batch' : `Batch ${parseInt(bIdx as string) + 1}`}
                                          </span>
                                          <div className="flex flex-wrap gap-1.5">
                                            {batchKeys.map((key, kIdx) => {
                                              const value = biomarkers[key];
                                              const unit = profile?.customBiomarkers?.[key]?.unit || '';
                                              return (
                                                <div 
                                                  key={`${key}_${kIdx}`}
                                                  className="px-2.5 py-1 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800/60 rounded-lg text-[10px] font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
                                                >
                                                  <span className="font-bold text-slate-900 dark:text-white">
                                                    {(key ? String(key).replace(/_/g, ' ').toUpperCase() : '')}
                                                  </span>
                                                  <span className="font-mono text-[9px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">
                                                    {value} {unit}
                                                  </span>
                                                </div>
                                              );
                                            })}
                                          </div>
                                        </div>

                                        {/* Cleaning Result rendering */}
                                        {result && (
                                          <div className="space-y-2">
                                            <span className="block text-[9px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
                                              Standardized Extracted Clinical Terminology
                                            </span>
                                            
                                            <div className="border border-slate-150 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm mt-2">
                                              <AgentResultTable
                                                agentType="agent1"
                                                agentResult={result}
                                                profile={profile}
                                                biomarkerHistory={biomarkerHistory}
                                                initialRawText={""}
                                                onApplyChanges={async () => {
                                                  await handleApproveBatchStep1(bIdx, result);
                                                }}
                                              />
                                            </div>

                                            <div className="bg-blue-50/40 dark:bg-blue-950/10 border border-blue-500/10 rounded-xl p-2.5 flex gap-2">
                                              <Sparkles className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                                              <p className="text-[10px] text-blue-800 dark:text-blue-300 leading-relaxed">
                                                Review the standardized terminologies, key matching, and metrics before approving the batch.
                                              </p>
                                            </div>
                                          </div>
                                        )}

                                        {/* Action controls */}
                                        {isCurrentUnlocked && (
                                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-50 dark:border-slate-800/20">
                                            <div className="flex gap-2">
                                              {result && (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setAgent1BatchResults(prev => {
                                                      const updated = { ...prev };
                                                      delete updated[bIdx];
                                                      localStorage.setItem('agent1_batch_results', JSON.stringify(updated));
                                                      return updated;
                                                    });
                                                    setApprovedAgent1Batches(prev => {
                                                      const updated = { ...prev };
                                                      delete updated[bIdx];
                                                      localStorage.setItem('approved_agent1_batches', JSON.stringify(updated));
                                                      return updated;
                                                    });
                                                  }}
                                                  className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 dark:bg-red-950/20 dark:hover:bg-red-950/30 rounded-xl text-xs font-bold transition-all cursor-pointer border border-red-200/20"
                                                >
                                                  Reset Result
                                                </button>
                                              )}
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 sm:flex sm:gap-2">
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  if (onOpenAgentChat) {
                                                    onOpenAgentChat('agent1', {
                                                      dataReviewBatchIdx: bIdx,
                                                      dataReviewBatchKeys: batchKeys,
                                                      prefillMessage: `Clean and standardize ${isCustom ? 'Custom Test Batch' : 'Batch ' + (parseInt(bIdx as string) + 1)} biomarkers`
                                                    });
                                                  }
                                                }}
                                                className="py-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/25 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 border border-indigo-150 dark:border-indigo-900/30 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                                                title="Chat with Agent to calibrate or clean further"
                                              >
                                                <Send className="w-3.5 h-3.5" />
                                                <span>Clean with Agent</span>
                                              </button>
                                              
                                              {/* Approve Button / Checked state */}
                                              {isApproved ? (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setApprovedAgent1Batches(prev => {
                                                      const updated = { ...prev };
                                                      delete updated[bIdx];
                                                      localStorage.setItem('approved_agent1_batches', JSON.stringify(updated));
                                                      return updated;
                                                    });
                                                  }}
                                                  className="w-full py-2 bg-emerald-100 dark:bg-emerald-950/40 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 transition-colors text-emerald-700 dark:text-emerald-400 border border-emerald-200/30 rounded-xl text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                                                >
                                                  <Check className="w-3.5 h-3.5" />
                                                  <span>Approved (Undo)</span>
                                                </button>
                                              ) : (() => {
                                                const yamlText = result ? (result.extractedYaml || result) : '';
                                                let parsedRows: any[] = [];
                                                if (typeof yamlText === 'string' && yamlText.trim() !== '') {
                                                  try {
                                                    const cleanText = yamlText.replace(/```(?:yaml|json)?/gi, '').trim();
                                                    const parsed = parse(cleanText);
                                                    parsedRows = Array.isArray(parsed) ? parsed : (parsed?.biomarkers || []);
                                                  } catch (e) {}
                                                } else if (Array.isArray(yamlText)) {
                                                  parsedRows = yamlText;
                                                }
                                                const hasBatchToApprove = parsedRows.length > 0;
                                                if (!hasBatchToApprove) return null;

                                                return (
                                                  <button
                                                    type="button"
                                                    onClick={async () => {
                                                      // Parse the cleaned YAML
                                                      const yamlText = result ? (result.extractedYaml || result) : '';
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
                                                      const updatedCustoms = { ...(profile.customBiomarkers || {}) };
                                                      let currentHistory = biomarkerHistory ? biomarkerHistory.map((h: any) => ({
                                                        ...h,
                                                        biomarkers: { ...h.biomarkers }
                                                      })) : [];

                                                      // 1. Identify which unstandardized raw keys were mapped to what standardized keys and migrate/delete
                                                      if (result?.batchBiomarkers && Array.isArray(result.batchBiomarkers)) {
                                                        result.batchBiomarkers.forEach((raw: any) => {
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
                                                              currentHistory.forEach((log: any) => {
                                                                if (log.biomarkers && log.biomarkers[rawKey] !== undefined) {
                                                                  delete log.biomarkers[rawKey];
                                                                }
                                                              });
                                                              delete updatedCustoms[rawKey];
                                                            } else if (stdKey && rawKey !== stdKey) {
                                                              // Migrate existing values from rawKey to stdKey across all historical logs, then delete rawKey
                                                              currentHistory.forEach((log: any) => {
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
                                                            currentHistory.forEach((log: any) => {
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
                                                        const value = row.value !== undefined ? parseFloat(row.value) : undefined;
                                                        const date = row.date || new Date().toISOString().split('T')[0];

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

                                                        // Not overriding or duplicating values in history here because we simply map keys for data cleaning.
                                                      });

                                                      currentHistory.sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));

                                                      // Recompute biomarkers list
                                                      const recomputedBiomarkers: { [key: string]: number | string } = {};
                                                      [...currentHistory].sort((a, b) => toYYYYMMDD(a.date).localeCompare(toYYYYMMDD(b.date))).forEach(log => {
                                                        Object.entries(log.biomarkers).forEach(([k, v]) => {
                                                          recomputedBiomarkers[k] = v as string | number;
                                                        });
                                                      });

                                                      const updatedProfile = {
                                                        ...profile,
                                                        customBiomarkers: updatedCustoms
                                                      };

                                                      if (onUpdateProfile) {
                                                        await onUpdateProfile(updatedProfile);
                                                      }
                                                      if (onUpdateHistory) {
                                                        await onUpdateHistory(currentHistory, recomputedBiomarkers, updatedProfile);
                                                      }

                                                      // Mark as approved
                                                      setApprovedAgent1Batches(prev => {
                                                        const updated = { ...prev, [bIdx]: true };
                                                        localStorage.setItem('approved_agent1_batches', JSON.stringify(updated));
                                                        return updated;
                                                      });
                                                    }}
                                                    className="py-2 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 shadow-md shadow-emerald-600/10 cursor-pointer"
                                                  >
                                                    <Check className="w-3.5 h-3.5" />
                                                    <span>Approve</span>
                                                  </button>
                                                );
                                              })()}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    {isCustom && (
                                      <div className="mt-3 pt-2.5 border-t border-slate-150 dark:border-slate-800/60 flex items-center justify-between">
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setCustomBatchKeys([]);
                                            localStorage.removeItem(`agent1_custom_batch_keys_${userIdentifier}`);
                                            setAgent1BatchResults(prev => {
                                              const updated = { ...prev };
                                              delete updated['custom'];
                                              localStorage.setItem('agent1_batch_results', JSON.stringify(updated));
                                              return updated;
                                            });
                                            try {
                                              sessionStorage.removeItem('chat_messages_medical_agent1_custom');
                                              sessionStorage.removeItem('last_sent_payload_medical_agent1_custom');
                                            } catch(err) {}
                                          }}
                                          className="text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 px-2.5 py-1.5 rounded-lg transition-colors flex items-center gap-1.5 font-bold text-[10px] cursor-pointer text-left"
                                          title="Delete Custom Batch"
                                        >
                                          <Trash2 className="w-3.5 h-3.5" />
                                          <span>Delete Custom Batch</span>
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : step.id === 'data_review' ? (
                      /* Interactive Data Review / Calibration Batch-by-Batch UI */
                      <div className="space-y-4">
                        {batches.length === 0 ? (
                          <div className="p-4 text-center bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 text-slate-500 text-xs">
                            No biomarkers available. Please add some health data first in Step 1.
                          </div>
                        ) : (
                          <div className="space-y-4 text-left">
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800/60 pb-3 mb-2">
                              <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                                Biomarker Calibration Batches ({batchSize} items max)
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-medium text-slate-500">Items per batch:</span>
                                <input
                                  type="number"
                                  min="1"
                                  max="100"
                                  value={batchSizeInput}
                                  onChange={(e) => {
                                    const valStr = e.target.value;
                                    setBatchSizeInput(valStr);
                                    if (valStr !== '') {
                                      const val = parseInt(valStr, 10);
                                      if (!isNaN(val) && val > 0 && onChangeBatchSize) {
                                        onChangeBatchSize(val);
                                      }
                                    }
                                  }}
                                  className="w-16 text-[10px] font-bold bg-slate-50 dark:bg-slate-900 border border-slate-250 dark:border-slate-800 rounded-lg px-2 py-1 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-text"
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm("This will clear all processed batches in Data Cleaning and Data Review, and force a full re-chunking. Proceed?")) {
                                      setApprovedBatches({});
                                      setBatchAnalysisResults({});
                                      setApprovedAgent1Batches({});
                                      setAgent1BatchResults({});
                                      localStorage.removeItem('approved_data_review_batches');
                                      localStorage.removeItem('batch_analysis_results');
                                      localStorage.removeItem('approved_agent1_batches');
                                      localStorage.removeItem('agent1_batch_results');
                                      if (onChangeBatchSize) onChangeBatchSize(parseInt(batchSizeInput) || 20);
                                    }
                                  }}
                                  title="Reset all batch progress to force re-chunk"
                                  className="ml-2 px-2 py-1 bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 text-[10px] font-bold rounded flex-shrink-0 hover:bg-red-200 dark:hover:bg-red-900/50 transition-colors"
                                >
                                  Reset Batches
                                </button>
                              </div>
                            </div>
                            
                            <div className="space-y-3">
                              {batches.map((batchKeys, bIdx) => {
                                const isApproved = approvedBatches[bIdx];
                                const isAnalyzing = isAnalyzingBatch[bIdx];
                                const result = batchAnalysisResults[bIdx];
                                const isCurrentUnlocked = true;
                                const isExpanded = expandedBatches[bIdx] ?? (!isApproved || !result);
                                const isCustom = false;

                                return (
                                  <div 
                                    key={bIdx} 
                                    id={`batch-card-${bIdx}`}
                                    className={`p-4 rounded-2xl border transition-all ${
                                      isApproved 
                                        ? 'bg-emerald-50/10 border-emerald-500/20' 
                                        : result 
                                        ? 'bg-indigo-50/5 border-indigo-500/20'
                                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'
                                    }`}
                                  >
                                    {/* Collapsible Header */}
                                    <div 
                                      onClick={() => {
                                        setExpandedBatches(prev => ({
                                          ...prev,
                                          [bIdx]: !isExpanded
                                        }));
                                      }}
                                      className="flex items-start justify-between cursor-pointer select-none"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <h5 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                                          <span>{isCustom ? 'Custom Test Batch' : `Batch ${parseInt(bIdx as string) + 1}`}</span>
                                          <span 
                                            className="text-[10px] font-mono text-slate-400 font-normal"
                                            style={{ fontVariant: 'small-caps' }}
                                          >
                                            ({batchKeys.length} biomarkers)
                                          </span>
                                        </h5>
                                        <div className={`text-[10px] text-slate-400 mt-0.5 font-medium ${isExpanded ? '' : 'line-clamp-2'}`}>
                                          {batchKeys.map(k => (k ? String(k).replace(/_/g, ' ').toLowerCase() : '')).join(', ')}
                                        </div>
                                      </div>
                                      
                                      <div className="flex items-center gap-2 mt-0.5 ml-2">
                                        {isApproved ? (
                                          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/30 px-2 py-0.5 rounded-full border border-emerald-200/20">
                                            <CheckCircle className="w-3.5 h-3.5" />
                                            Reviewed
                                          </span>
                                        ) : result ? (
                                          <span className="flex items-center gap-1 text-[10px] font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider bg-indigo-50 dark:bg-indigo-950/30 px-2 py-0.5 rounded-full border border-indigo-200/20">
                                            <Sparkles className="w-3.5 h-3.5" />
                                            Calibration Ready
                                          </span>
                                        ) : (
                                          <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
                                            Pending
                                          </span>
                                        )}
                                        <div className="text-slate-400">
                                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                        </div>
                                      </div>
                                    </div>

                                    {/* Expanded Batch Content */}
                                    {isExpanded && (
                                      <div className="mt-3.5 pt-3.5 border-t border-slate-150 dark:border-slate-800/60 space-y-3 animation-fade-in">
                                        {!result ? (
                                          (() => {
                                            const batchBiomarkersInfo = batchKeys.map(k => {
                                              const mappedKey = getMappedBiomarkerKey(k);
                                              const customDef = profile?.customBiomarkers?.[mappedKey] || profile?.customBiomarkers?.[k];
                                              const stdDef = biomarkerDefinitions.find(d => d.key === mappedKey) || biomarkerDefinitions.find(d => d.key === k);
                                              const displayName = customDef?.name || stdDef?.name || k.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                                              const unit = customDef?.unit || stdDef?.unit || '';
                                              return {
                                                key: k,
                                                mappedKey,
                                                name: displayName,
                                                unit
                                              };
                                            });

                                            const missingUnitBiomarkers = batchBiomarkersInfo.filter(b => !b.unit || b.unit.trim() === '');

                                            return (
                                              <div className="space-y-3">
                                                {missingUnitBiomarkers.length > 0 ? (
                                                  <>
                                                    <div className="p-3.5 bg-amber-50/70 dark:bg-amber-950/10 border border-amber-200/20 dark:border-amber-950/20 rounded-xl text-left space-y-2.5">
                                                      <div className="flex items-start gap-2 text-amber-800 dark:text-amber-400">
                                                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                                        <div>
                                                          <h6 className="text-[11px] font-bold">Calibration Blocked: Missing Units</h6>
                                                          <p className="text-[10px] text-amber-700/90 dark:text-amber-500/90 leading-normal">
                                                            The biomarkers below do not have clinical units configured. Updates must be completed directly in the Biomarker Dictionary to ensure reference consistency.
                                                          </p>
                                                        </div>
                                                      </div>

                                                      <div className="space-y-1.5 bg-white/60 dark:bg-slate-900/40 p-2 rounded-lg border border-amber-100/30 dark:border-amber-950/20 max-h-[160px] overflow-y-auto">
                                                        {missingUnitBiomarkers.map(bm => (
                                                          <div key={bm.key} className="flex items-center justify-between gap-2 text-[11px] py-1 border-b border-dashed border-amber-100/50 last:border-0">
                                                            <div className="flex flex-col min-w-0">
                                                              <span className="font-bold text-slate-700 dark:text-slate-300 truncate max-w-[150px]" title={bm.name}>{bm.name}</span>
                                                              <span className="text-[9px] font-mono text-slate-400">Key: {bm.mappedKey || bm.key}</span>
                                                            </div>
                                                            <button
                                                              onClick={() => {
                                                                setDictionaryPreFillKey(bm.mappedKey || bm.key);
                                                                setShowDictionaryModal(true);
                                                              }}
                                                              className="px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[9px] font-bold transition-all cursor-pointer flex items-center gap-1 shadow-sm shrink-0"
                                                            >
                                                              <BookOpen className="w-3 h-3" />
                                                              Update in Dictionary
                                                            </button>
                                                          </div>
                                                        ))}
                                                      </div>
                                                    </div>

                                                    <button
                                                      disabled
                                                      className="w-full py-2 bg-slate-100 dark:bg-slate-900/60 text-slate-400 dark:text-slate-500 border border-slate-200/20 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-not-allowed"
                                                    >
                                                      <Sparkles className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
                                                      <span>Calibration Locked (Missing Units)</span>
                                                    </button>
                                                  </>
                                                ) : (
                                                  <button
                                                    onClick={() => {
                                                      if (onOpenAgentChat) {
                                                        onOpenAgentChat('data_review', {
                                                          dataReviewBatchIdx: bIdx,
                                                          dataReviewBatchKeys: batchKeys,
                                                          prefillMessage: `Calibrate Batch ${bIdx + 1}`
                                                        });
                                                      }
                                                    }}
                                                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-indigo-600/10 transition-all"
                                                  >
                                                    <Sparkles className="w-3.5 h-3.5 animate-pulse" />
                                                    <span>Calibrate with Agent</span>
                                                  </button>
                                                )}
                                              </div>
                                            );
                                          })()
                                        ) : (
                                          <div className="space-y-4">
                                            {/* Summary message */}
                                            <div className="p-3 bg-indigo-50/30 dark:bg-indigo-950/15 border border-indigo-100/30 dark:border-indigo-950/20 rounded-xl text-left">
                                              <p className="text-[11px] text-slate-900 dark:text-slate-100 leading-relaxed font-medium">
                                                {(result.message || 'Calibration completed successfully.').replace(/Clinical review for a ([\w\s-]+)\.\s*/i, '')}
                                              </p>
                                            </div>

                                            {/* Sortable and filterable reference table */}
                                            <div className="border border-slate-150 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm">
                                              <AgentResultTable
                                                agentType="data_review"
                                                agentResult={result}
                                                profile={profile}
                                                biomarkerHistory={biomarkerHistory}
                                                selectedMissingKeys={selectedMissingKeysToMove[bIdx] || STABLE_EMPTY_ARRAY}
                                                onChangeSelectedMissingKeys={(keys) => setSelectedMissingKeysToMove(prev => ({ ...prev, [bIdx]: keys }))}
                                                onApplyChanges={async () => {
                                                  await handleApproveBatchStep2(bIdx, result);
                                                }}
                                              />
                                            </div>

                                            {/* Action Buttons */}
                                            <div className="grid grid-cols-3 gap-2 pt-2">
                                              {/* Delete/Reset Button */}
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  setBatchAnalysisResults(prev => {
                                                    const updated = { ...prev };
                                                    delete updated[bIdx];
                                                    localStorage.setItem('batch_analysis_results', JSON.stringify(updated));
                                                    return updated;
                                                  });
                                                  setApprovedBatches(prev => {
                                                    const updated = { ...prev };
                                                    delete updated[bIdx];
                                                    localStorage.setItem('approved_data_review_batches', JSON.stringify(updated));
                                                    return updated;
                                                  });
                                                }}
                                                className="py-2 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-900/30 text-rose-600 dark:text-rose-450 border border-rose-100 dark:border-rose-950/20 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer"
                                                title="Delete Calibration Result"
                                              >
                                                <Trash2 className="w-3.5 h-3.5" />
                                                <span>Delete</span>
                                              </button>

                                              {/* Review with Agent (Chat with Agent) Button */}
                                              <button
                                                type="button"
                                                disabled={calibratingBatchIdx === bIdx}
                                                onClick={() => {
                                                  if (onOpenAgentChat) {
                                                    onOpenAgentChat('data_review', {
                                                      dataReviewBatchIdx: bIdx,
                                                      dataReviewBatchKeys: batchKeys,
                                                      prefillMessage: `Review Batch ${bIdx + 1} calibrate results`
                                                    });
                                                  }
                                                }}
                                                className={`py-2 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/25 dark:hover:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 border border-indigo-150 dark:border-indigo-900/30 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer ${calibratingBatchIdx === bIdx ? 'opacity-50 cursor-not-allowed' : ''}`}
                                                title="Chat with Agent to calibrate further"
                                              >
                                                <Send className="w-3.5 h-3.5" />
                                                <span>Review with Agent</span>
                                              </button>
                                              
                                              {/* Approve Button / Checked state */}
                                              {calibratingBatchIdx === bIdx ? (
                                                <button
                                                  type="button"
                                                  disabled
                                                  className="w-full py-2 bg-emerald-600/50 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-not-allowed opacity-75"
                                                >
                                                  <Loader className="w-3.5 h-3.5 animate-spin" />
                                                  <span>Approving & Saving...</span>
                                                </button>
                                              ) : isApproved ? (
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    setApprovedBatches(prev => {
                                                      const updated = { ...prev };
                                                      delete updated[bIdx];
                                                      localStorage.setItem('approved_data_review_batches', JSON.stringify(updated));
                                                      return updated;
                                                    });
                                                  }}
                                                  className="w-full py-2 bg-emerald-100 dark:bg-emerald-950/40 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 transition-colors text-emerald-700 dark:text-emerald-400 border border-emerald-200/30 rounded-xl text-xs font-bold flex items-center justify-center gap-1 cursor-pointer"
                                                >
                                                  <Check className="w-3.5 h-3.5" />
                                                  <span>Approved (Undo)</span>
                                                </button>
                                              ) : (() => {
                                                const reviewed = Array.isArray(result?.reviewedBiomarkers) ? result.reviewedBiomarkers : [];
                                                const hasCalibrationToApprove = reviewed.length > 0;
                                                if (!hasCalibrationToApprove) return null;

                                                return (
                                                  <button
                                                    type="button"
                                                    onClick={async () => {
                                                      // Save customBiomarkers to user profile
                                                      const updatedCustoms = { ...(profile.customBiomarkers || {}) };
                                                      result.reviewedBiomarkers?.forEach((bm: any) => {
                                                        const existing: any = updatedCustoms[bm.key] || {};
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

                                                      const updatedProfile = {
                                                        ...profile,
                                                        customBiomarkers: updatedCustoms
                                                      };

                                                      if (onUpdateProfile) {
                                                        await onUpdateProfile(updatedProfile);
                                                      }

                                                      // Move missing biomarkers to future batches if selected
                                                      const keysToMove = selectedMissingKeysToMove[bIdx] || [];
                                                      if (keysToMove.length > 0) {
                                                        handleMoveMissingBiomarkers(bIdx, keysToMove);
                                                      }

                                                      // Mark as approved
                                                      setApprovedBatches(prev => {
                                                        const updated = { ...prev, [bIdx]: true };
                                                        localStorage.setItem('approved_data_review_batches', JSON.stringify(updated));
                                                        return updated;
                                                      });
                                                    }}
                                                    className="py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1 cursor-pointer shadow-md shadow-emerald-600/10"
                                                  >
                                                    <Check className="w-3.5 h-3.5" />
                                                    <span>Approve</span>
                                                  </button>
                                                );
                                              })()}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Steps 1-7 expanded content */
                      <div className="space-y-4">
                        {status === 'Not ready' && (
                          <div className="p-3.5 bg-slate-50 dark:bg-slate-900 rounded-2xl border border-slate-150 dark:border-slate-850 flex gap-2">
                            <Sparkles className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5" />
                            <div className="space-y-1">
                              <span className="block text-xs font-bold text-indigo-600 dark:text-indigo-400">WHAT TO EXPECT & CLINICAL VALUE</span>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-normal">
                                This module will analyze your {step.title.toLowerCase()} when unlocked.
                              </p>
                              <p className="text-[11px] text-slate-700 dark:text-slate-300 leading-normal">
                                <strong>Value:</strong> <span className="text-slate-900 dark:text-white font-medium">{step.valueProposition}</span>
                              </p>
                              <p className="text-[11px] text-slate-450 dark:text-slate-500 leading-normal italic pt-1">
                                (Will become fully operational once prior steps are approved.)
                              </p>
                            </div>
                          </div>
                        )}

                        {status === 'To do' && (
                          <div className="pt-2">
                            <button
                              onClick={() => onOpenAgentChat?.(step.agentType as any)}
                              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Sparkles className="w-3.5 h-3.5" />
                              Start {step.title}
                            </button>
                          </div>
                        )}

                        {(status === 'To review' || status === 'Done') && !latestAnalysis && (
                          <div className="pt-2">
                            <p className="text-xs text-slate-500 mb-2 italic">All previous results have been archived.</p>
                            <button
                              onClick={() => onOpenAgentChat?.(step.agentType as any)}
                              className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                              <Send className="w-3.5 h-3.5 text-slate-400" />
                              Chat with agent
                            </button>
                            {step.agentType && renderAgentHistory(step.agentType)}
                          </div>
                        )}

                        {(status === 'To review' || status === 'Done') && latestAnalysis && (
                          <div className="space-y-4 pt-1">
                            {/* Proposal Content */}
                            <div className="p-3 bg-slate-50/50 dark:bg-slate-900/40 rounded-2xl border border-slate-100 dark:border-slate-800/80 space-y-3">
                              <div className="flex items-center justify-between">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[8px] font-bold bg-indigo-100/50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400 uppercase tracking-wider">
                                  Agent Finding Proposal
                                </span>
                                <span className="text-[9px] text-slate-400 font-mono">
                                  {new Date(latestAnalysis.date).toLocaleDateString()}
                                </span>
                              </div>

                              {/* Specific view rendering based on agent type */}
                              {['agent1', 'agent2', 'agent3', 'agent4'].includes(step.agentType!) && latestAnalysis.result ? (
                                <div className="overflow-hidden rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950">
                                  <AgentResultTable
                                    agentType={step.agentType! as 'agent1' | 'agent2' | 'agent3' | 'agent4'}
                                    agentResult={latestAnalysis.result}
                                    profile={profile}
                                    biomarkerHistory={biomarkerHistory || []}
                                    initialRawText=""
                                  />
                                </div>
                              ) : step.agentType! === 'agent5' ? (
                                <div className="bg-white dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-850">
                                  <Agent5View rawResult={latestAnalysis.result} />
                                </div>
                              ) : step.agentType! === 'agent6' ? (
                                <div className="bg-white dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-850">
                                  <Agent6View rawResult={latestAnalysis.result} />
                                </div>
                              ) : step.agentType! === 'agent7' ? (
                                <div className="bg-white dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-850">
                                  <Agent7View rawResult={latestAnalysis.result} />
                                </div>
                              ) : (
                                <div className="text-[10px] text-slate-700 dark:text-slate-300 font-mono bg-white dark:bg-slate-950 p-3 rounded-xl border border-slate-100 dark:border-slate-850 max-h-32 overflow-auto">
                                  <pre>{typeof latestAnalysis.result === 'string' ? latestAnalysis.result : JSON.stringify(latestAnalysis.result, null, 2)}</pre>
                                </div>
                              )}
                            </div>

                            {status === 'To review' && (
                              <div className={`grid grid-cols-1 ${hasStepSomethingToApprove(step, latestAnalysis) ? 'md:grid-cols-3' : 'md:grid-cols-2'} gap-2 pt-1`}>
                                <button
                                  onClick={() => onArchiveAnalysis?.(latestAnalysis.id)}
                                  className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                  <Archive className="w-3.5 h-3.5" />
                                  Archive
                                </button>
                                <button
                                  onClick={() => {
                                    const suggestionText = typeof latestAnalysis.result === 'string' 
                                      ? latestAnalysis.result 
                                      : JSON.stringify(latestAnalysis.result, null, 2);
                                    onOpenAgentChat?.(step.agentType as any, {
                                      prefillMessage: `I want to edit some information in your previous suggestion for ${step.title}. Here is the suggestion:\n\n${suggestionText}\n\nCould you please help me edit and adjust this suggestion?`
                                    });
                                  }}
                                  className="py-2.5 px-3 bg-slate-150 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                  <Send className="w-3.5 h-3.5 text-slate-400" />
                                  Review
                                </button>
                                {hasStepSomethingToApprove(step, latestAnalysis) && (
                                  calibratingAgentType === step.agentType ? (
                                    <button
                                      type="button"
                                      disabled
                                      className="py-2.5 px-3 bg-indigo-400 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-not-allowed opacity-75"
                                    >
                                      <Loader className="w-3.5 h-3.5 animate-spin" />
                                      Approving...
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => handleApproveStep(index)}
                                      className="py-2.5 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-md shadow-indigo-600/10"
                                    >
                                      <Check className="w-3.5 h-3.5" />
                                      Approve
                                    </button>
                                  )
                                )}
                              </div>
                            )}

                            {status === 'Done' && (
                              <div className="pt-1">
                                <button
                                  onClick={() => onOpenAgentChat?.(step.agentType as any)}
                                  className="w-full py-2.5 px-3 bg-slate-100 hover:bg-slate-150 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                >
                                  <Send className="w-3 h-3 text-slate-400" />
                                  Chat with agent
                                </button>
                              </div>
                            )}

                            {step.agentType && renderAgentHistory(step.agentType)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Model Engine Selector & Run On-demand Button */}
      {hasProfileInfo && (
        <div id="analysis-control-card" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-4">
          <LLMSelector
            selectedModelId={selectedModelId}
            onChangeModelId={onChangeModelId}
          />

          <button
            id="trigger-analysis-btn"
            onClick={() => setShowConfirm(true)}
            disabled={isGenerating}
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl text-sm font-bold shadow-lg shadow-indigo-600/20 flex items-center justify-center gap-2 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
          >
            {isGenerating ? (
              <>
                <Loader className="w-4 h-4 animate-spin" />
                {t.generating}
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                {t.generateInsight}
              </>
            )}
          </button>
        </div>
      )}

      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex flex-col justify-end sm:justify-center p-0 sm:p-4 animation-fade-in font-sans">
          <div className="w-full max-w-md mx-auto bg-white dark:bg-slate-900 rounded-t-[32px] sm:rounded-[32px] flex flex-col shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800/80 transition-colors duration-200 p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg font-display text-slate-900 dark:text-slate-100">Confirm Analysis Data</h3>
              <button 
                onClick={() => setShowConfirm(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              The following information will be used to generate your personalized health diagnostic:
            </p>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800/20">
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">User Profile</span>
                <span className="font-semibold block">{profile.age}yo, {profile.ethnicity || 'Unknown Ethnicity'}</span>
                {profile.weight && profile.height ? (() => {
                  const heightInMeters = Number(profile.height) / 100;
                  const bmi = Number(profile.weight) / (heightInMeters * heightInMeters);
                  return (
                    <span className="text-[10px] text-slate-500 mt-0.5 block">BMI: <strong className="text-slate-800 dark:text-slate-200">{bmi.toFixed(1)}</strong></span>
                  );
                })() : (
                  <span className="text-[10px] text-slate-500 mt-0.5 block">BMI: N/A</span>
                )}
                {(profile.gender || profile.bloodType) && (
                  <span className="text-[10px] text-slate-500 block">
                    {profile.gender ? profile.gender : ''} {profile.gender && profile.bloodType ? '|' : ''} {profile.bloodType ? `Blood: ${profile.bloodType}` : ''}
                  </span>
                )}
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800/20">
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Nutrition Inputs</span>
                <span className="font-semibold block">{foodLogs.length} logged entries</span>
                <span className="text-[10px] text-slate-500 mt-0.5 block">Recent eating patterns</span>
              </div>
            </div>

            <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-100 dark:border-slate-800/20 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">Checked Biomarker Values</span>
                <span className="text-[10px] text-slate-400">{Object.keys(biomarkers).length} logged</span>
              </div>
              
              {Object.keys(biomarkers).length > 0 ? (
                <details className="group">
                  <summary className="text-[11px] font-bold text-indigo-600 cursor-pointer list-none flex items-center gap-1">
                    <span>View All Used Biomarkers</span>
                    <span className="transition-transform group-open:rotate-180">▼</span>
                  </summary>
                  <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-center text-[11px]">
                    {Object.entries(biomarkers).map(([k, v]) => (
                      <div key={k} className="py-1 px-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-150 dark:border-slate-800/60 overflow-hidden">
                        <span className="block text-[9px] text-slate-400 font-semibold truncate" title={k}>{k.replace(/_/g, ' ').toUpperCase()}</span>
                        <span className="font-bold text-indigo-600 font-mono">
                          {v}
                        </span>
                      </div>
                    ))}
                  </div>
                </details>
              ) : (
                <p className="text-[11px] text-slate-500 italic">No biomarker data available. Using general population defaults.</p>
              )}
            </div>
            
            <p className="text-xs text-amber-600 dark:text-amber-500 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-lg font-medium">
              Are these details correct? To get the most accurate clinical diagnostic, ensure you have also logged your latest blood test results such as ApoB, LDL-C, and HbA1c in the medical history.
            </p>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => {
                  setShowConfirm(false);
                  if (onOpenMedicalChat) onOpenMedicalChat();
                }}
                className="flex-1 py-3 bg-slate-100 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-sm font-bold transition-all cursor-pointer"
              >
                Update
              </button>
              <button
                onClick={() => {
                  setShowConfirm(false);
                  onGenerateReport(selectedModelId);
                }}
                className="flex-1 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-md shadow-indigo-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                Start Diagnostic
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Results Section */}
      {report ? (
        <div className="space-y-6">
          
          {/* Health Risk Forecasting Timelines - 5, 10, 20 Years */}
          <div id="risk-timeline-card" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-950 dark:text-slate-100 text-sm flex items-center gap-1.5 font-display">
              <TrendingDown className="w-4 h-4 text-rose-500" />
              Cardiovascular & Renal Risk Forecasting
            </h3>

            <div className="space-y-4">
              {/* 5 Year Forecast */}
              <div className="border-l-2 border-slate-200 dark:border-slate-800 pl-3.5 relative">
                <span className="absolute left-[-5px] top-1.5 w-2 h-2 rounded-full bg-slate-400" />
                <span className="text-xs font-bold text-slate-400 font-mono">5 Years Timeline</span>
                <div className="mt-1 space-y-1.5 text-xs font-medium">
                  <p className="text-rose-600 dark:text-rose-400 leading-relaxed">
                    &bull; {report.healthRiskForecast.year5}
                  </p>
                  <p className="text-indigo-600 dark:text-indigo-400 leading-relaxed font-semibold">
                    &bull; {report.healthRiskForecast.optimized5}
                  </p>
                </div>
              </div>

              {/* 10 Year Forecast */}
              <div className="border-l-2 border-slate-200 dark:border-slate-800 pl-3.5 relative">
                <span className="absolute left-[-5px] top-1.5 w-2 h-2 rounded-full bg-slate-400" />
                <span className="text-xs font-bold text-slate-400 font-mono">10 Years Timeline</span>
                <div className="mt-1 space-y-1.5 text-xs font-medium">
                  <p className="text-rose-600 dark:text-rose-400 leading-relaxed">
                    &bull; {report.healthRiskForecast.year10}
                  </p>
                  <p className="text-indigo-600 dark:text-indigo-400 leading-relaxed font-semibold">
                    &bull; {report.healthRiskForecast.optimized10}
                  </p>
                </div>
              </div>

              {/* 20 Year Forecast */}
              <div className="border-l-2 border-slate-200 dark:border-slate-800 pl-3.5 relative">
                <span className="absolute left-[-5px] top-1.5 w-2 h-2 rounded-full bg-slate-400" />
                <span className="text-xs font-bold text-slate-400 font-mono">20 Years Timeline</span>
                <div className="mt-1 space-y-1.5 text-xs font-medium">
                  <p className="text-rose-600 dark:text-rose-400 leading-relaxed">
                    &bull; {report.healthRiskForecast.year20}
                  </p>
                  <p className="text-indigo-600 dark:text-indigo-400 leading-relaxed font-semibold">
                    &bull; {report.healthRiskForecast.optimized20}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Core Medical Insights summarised bullet points */}
          <div id="latest-insights-card" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-950 dark:text-slate-100 text-sm flex items-center gap-1.5 font-display">
              <BookOpen className="w-4 h-4 text-indigo-600" />
              {t.latestInsights}
            </h3>

            <div className="space-y-4">
              {report.latestInsights.map((insight, idx) => (
                <div key={idx} className="space-y-1 bg-slate-50 dark:bg-slate-950 p-4 rounded-2xl border border-slate-100 dark:border-slate-800/20">
                  <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs">
                    {insight.title}
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed mt-0.5 font-medium">
                    {insight.summary}
                  </p>
                  <a
                    href={insight.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 hover:underline block pt-1.5 font-mono"
                  >
                    PubMed &rarr;
                  </a>
                </div>
              ))}
            </div>
          </div>

        </div>
      ) : (
        /* Empty insights state */
        <div id="insights-empty-state" className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-[32px] p-8 text-center shadow-sm flex flex-col items-center">
          <Clock className="w-10 h-10 text-slate-300 dark:text-slate-700 mb-3" />
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
            {t.noDataInsight}
          </p>
        </div>
      )}


      {fullscreenBatchIndex !== null && batchAnalysisResults[fullscreenBatchIndex] && (
        <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-[60] flex items-center justify-center p-4 sm:p-6 md:p-10">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[32px] w-full max-w-7xl h-[85vh] flex flex-col shadow-2xl overflow-hidden animation-zoom-in">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20">
              <div>
                <h3 className="text-sm font-bold text-slate-950 dark:text-slate-100 font-display">
                  Batch {fullscreenBatchIndex + 1} Full-Screen Calibrated Reference Table
                </h3>
                <p className="text-[10px] text-slate-450 mt-1">
                  Showing detailed physiological calibrations, ranges, and clinical insights for Batch {fullscreenBatchIndex + 1}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setFullscreenBatchIndex(null)}
                className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-850 text-slate-450 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-auto p-6 bg-slate-50/20 dark:bg-slate-950/10">
              <AgentResultTable
                agentType="data_review"
                agentResult={batchAnalysisResults[fullscreenBatchIndex]}
                profile={profile}
                biomarkerHistory={biomarkerHistory}
                selectedMissingKeys={selectedMissingKeysToMove[fullscreenBatchIndex] || STABLE_EMPTY_ARRAY}
                onChangeSelectedMissingKeys={(keys) => setSelectedMissingKeysToMove(prev => ({ ...prev, [fullscreenBatchIndex]: keys }))}
                onApplyChanges={async () => {
                  await handleApproveBatchStep2(fullscreenBatchIndex, batchAnalysisResults[fullscreenBatchIndex]);
                  setFullscreenBatchIndex(null);
                }}
              />
            </div>
            
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 flex justify-end">
              <button
                type="button"
                onClick={() => setFullscreenBatchIndex(null)}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer"
              >
                Close Fullscreen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Batch Builder Modal */}
      {showCustomBatchModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4 animation-fade-in font-sans">
          <div className="w-full max-w-lg bg-white dark:bg-slate-950 rounded-2xl shadow-xl flex flex-col border border-slate-200 dark:border-slate-800 overflow-hidden max-h-[80vh]">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Test Custom Batch</h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[10px] text-slate-500">Pick any biomarker to test data cleaning</span>
                    <span className="text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.25 rounded-md">
                      {customBatchKeys.length} selected
                    </span>
                  </div>
                </div>
                <button onClick={() => setShowCustomBatchModal(false)} className="text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full p-1 transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search biomarkers..."
                  value={customBatchSearch}
                  onChange={e => setCustomBatchSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-2 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              {/* Group By Selector */}
              <div className="flex items-center justify-between gap-2 mt-3 pt-3 border-t border-slate-150 dark:border-slate-800">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Group By:</span>
                <select
                  value={batchGroupType}
                  onChange={(e) => setBatchGroupType(e.target.value as any)}
                  className="px-2.5 py-1 text-xs font-semibold bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer shadow-sm"
                >
                  {BIOMARKER_GROUPING_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {(() => {
                const filtered = markerKeys.filter(k => k.toLowerCase().includes(customBatchSearch.toLowerCase()));
                if (filtered.length === 0) {
                  return <p className="text-xs text-slate-500 text-center py-4">No biomarkers available.</p>;
                }

                // Compute groups
                const groups: Record<string, string[]> = {};
                filtered.forEach(key => {
                  const meta = getBiomarkerMetadata(key, profile.customBiomarkers?.[key]);
                  
                  if (batchGroupType === 'risk') {
                    const cats = meta.riskCategories && meta.riskCategories.length > 0 ? meta.riskCategories : ['General Health'];
                    cats.forEach(c => {
                      if (!groups[c]) groups[c] = [];
                      groups[c].push(key);
                    });
                  } else if (batchGroupType === 'practice') {
                    const practice = meta.standardMedicalGrouping || 'Other';
                    if (!groups[practice]) groups[practice] = [];
                    groups[practice].push(key);
                  } else if (batchGroupType === 'condition') {
                    const conditions = meta.potentialMedicalConditions && meta.potentialMedicalConditions.length > 0 ? meta.potentialMedicalConditions : ['General Health'];
                    conditions.forEach(c => {
                      if (!groups[c]) groups[c] = [];
                      groups[c].push(key);
                    });
                  }
                });

                const groupNames = Object.keys(groups).sort();

                return groupNames.map(groupName => {
                  const keysInGroup = groups[groupName];
                  const selectedInGroup = keysInGroup.filter(k => customBatchKeys.includes(k));
                  const isExpanded = expandedGroups[groupName] !== false;

                  const toggleGroup = () => {
                    setExpandedGroups(prev => ({
                      ...prev,
                      [groupName]: !isExpanded
                    }));
                  };

                  return (
                    <div key={groupName} className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50/20 dark:bg-slate-900/10">
                      <div 
                        onClick={toggleGroup}
                        className="flex items-center justify-between p-3 bg-slate-50/80 dark:bg-slate-900/60 hover:bg-slate-100/60 dark:hover:bg-slate-800/60 cursor-pointer select-none transition-colors border-b border-slate-100 dark:border-slate-800"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-300">{groupName}</span>
                          <span className="text-[10px] bg-slate-200/60 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded-full font-bold">
                            {keysInGroup.length}
                          </span>
                          {selectedInGroup.length > 0 && (
                            <span className="text-[10px] bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded-full font-bold">
                              {selectedInGroup.length} selected
                            </span>
                          )}
                        </div>
                        {isExpanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      </div>

                      {isExpanded && (
                        <div className="p-3 space-y-2 bg-white dark:bg-slate-950">
                          {keysInGroup.map(key => {
                            const isSelected = customBatchKeys.includes(key);
                            return (
                              <div 
                                key={key} 
                                onClick={() => {
                                  clearCustomBatchResults();
                                  setCustomBatchKeys(prev => {
                                    const updated = isSelected ? prev.filter(k => k !== key) : [...prev, key];
                                    localStorage.setItem(`agent1_custom_batch_keys_${userIdentifier}`, JSON.stringify(updated));
                                    return updated;
                                  });
                                }}
                                className={`p-2.5 rounded-xl border flex items-center justify-between cursor-pointer transition-colors ${isSelected ? 'bg-indigo-50/30 border-indigo-200 dark:bg-indigo-900/20 dark:border-indigo-800' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800/60'}`}
                              >
                                <div className="flex items-center gap-2">
                                  <div className={`w-4 h-4 rounded-md border flex items-center justify-center ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 dark:border-slate-700'}`}>
                                    {isSelected && <Check className="w-3 h-3 text-white" />}
                                  </div>
                                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">{key}</span>
                                </div>
                                <span className="text-[10px] text-slate-400 font-medium">{biomarkers[key]}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
            
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex justify-end gap-2">
              <button 
                type="button" 
                onClick={() => {
                  clearCustomBatchResults();
                  setCustomBatchKeys([]);
                  localStorage.removeItem(`agent1_custom_batch_keys_${userIdentifier}`);
                }} 
                className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors"
              >
                Clear
              </button>
              <button 
                type="button" 
                onClick={() => setShowCustomBatchModal(false)} 
                className="px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 shadow-md shadow-indigo-600/10 rounded-xl transition-colors"
              >
                Done ({customBatchKeys.length})
              </button>
            </div>
          </div>
        </div>
      )}

      {showDictionaryModal && (
        <BiomarkerDictionaryModal
          profile={profile}
          biomarkers={biomarkers}
          biomarkerHistory={biomarkerHistory || []}
          onClose={() => {
            setShowDictionaryModal(false);
            setDictionaryPreFillKey(null);
          }}
          initialSearchQuery={dictionaryPreFillKey || undefined}
          onDeleteBiomarker={onDeleteBiomarker}
          onDeleteMultipleBiomarkers={onDeleteMultipleBiomarkers}
          onUpdateProfile={async (updates) => {
            if (onUpdateProfile) {
              await onUpdateProfile({ ...profile, ...updates });
            }
          }}
          onCombineBiomarkers={onCombineBiomarkers || (() => {})}
          onBatchConsolidate={onBatchConsolidate}
          onAgentAnalysisSaved={onAgentAnalysisSaved}
          onDeleteAnalysis={onDeleteAnalysis}
        />
      )}
    </div>
  );
}
