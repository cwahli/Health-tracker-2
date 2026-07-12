import { ErrorBoundary } from './ErrorBoundary';
import React, { useState, useRef, useEffect } from 'react';
import { parse } from 'yaml';
import { ChatMessage, FoodLog, UserProfile, FoodIdea } from '../types';
import { translations } from '../utils/translations';
import { X, Send, Image, Camera, MessageSquare, Sparkles, Plus, Terminal, ChevronDown, ChevronUp, Loader, MapPin, Trash2, Check, Table, RotateCcw, AlertTriangle, ShieldAlert, Edit2 } from 'lucide-react';
import { nutrientDefinitions } from '../utils/nutrition';
import { biomarkerDefinitions, getBiomarkerStatus, isAsianEthnicity, getBiomarkerStatusLabel } from '../utils/biomarkers';
import LLMSelector from './LLMSelector';
import { AVAILABLE_LLMS } from '../utils/llm';
import { compressMultipleImages } from '../utils/imageCompressor';
import { getCurrentDateInTimezone } from '../utils/dateUtils';
import ImageSlider from './ImageSlider';
import FullScreenLogViewer from './FullScreenLogViewer';
import FullScreenInstructionViewer from './FullScreenInstructionViewer';
import { InteractivePlacesMap } from './InteractivePlacesMap';
import exifr from 'exifr';
import { auth, db } from '../firebase';
import { collection, query, where, getDocs, setDoc, doc, deleteDoc, getDoc } from 'firebase/firestore';
import { sanitizeForFirestore } from '../utils/firestoreUtils';
import { Agent5View, Agent6View, Agent7View } from './AgentResultViews';
import { AgentResultTable } from './AgentResultTable';
import { resolveFoodImage } from '../utils/imageResolver';
import { NutrientPieChart } from './NutrientPieChart';

interface BiomarkerEntry {
  biomarker: string;
  date: string;
  value: number;
  unit: string;
}

function parseYamlOffline(yamlText: string): BiomarkerEntry[] {
  const entries: BiomarkerEntry[] = [];
  if (!yamlText) return entries;
  
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
              value: Number(bVal) || 0,
              unit: item.unit ? String(item.unit) : ''
            });
          }
        }
      });
    }
  } catch (e) {
    console.warn("parseYamlOffline: standard parser failed, falling back to regex", e);
  }

  if (entries.length > 0) {
    return entries;
  }

  const lines = yamlText.split('\n');
  let currentEntry: Partial<BiomarkerEntry> = {};
  
  for (let line of lines) {
    line = line.trim();
    if (line.startsWith('-') || line.startsWith('biomarker:')) {
      if (currentEntry.biomarker) {
        entries.push(currentEntry as BiomarkerEntry);
      }
      currentEntry = {};
    }
    
    const biomarkerMatch = line.match(/(?:-\s+)?biomarker:\s*(.*)/i);
    if (biomarkerMatch) {
      currentEntry.biomarker = biomarkerMatch[1].replace(/['"]/g, '').trim();
      continue;
    }
    
    const dateMatch = line.match(/date:\s*([\d-]+)/i);
    if (dateMatch) {
      currentEntry.date = dateMatch[1].trim();
      continue;
    }
    
    const valueMatch = line.match(/value:\s*([\d.]+)/i);
    if (valueMatch) {
      currentEntry.value = parseFloat(valueMatch[1]);
      continue;
    }
    
    const unitMatch = line.match(/unit:\s*(.*)/i);
    if (unitMatch) {
      currentEntry.unit = unitMatch[1].replace(/['"]/g, '').trim();
      continue;
    }
  }
  
  if (currentEntry.biomarker) {
    entries.push(currentEntry as BiomarkerEntry);
  }
  
  return entries;
}

function getOfflineCategorization(name: string) {
  const lowerName = name.toLowerCase();
  
  if (lowerName.includes('alt') || lowerName.includes('ast') || lowerName.includes('alp') || lowerName.includes('bilirubin') || lowerName.includes('liver') || lowerName.includes('ggt')) {
    return {
      riskCategories: ['Liver & hepatitis stress'],
      standardMedicalGrouping: 'Hepatic',
      potentialMedicalConditions: ['Fatty Liver', 'Hepatitis Stress']
    };
  }
  
  if (lowerName.includes('creatinine') || lowerName.includes('egfr') || lowerName.includes('urea') || lowerName.includes('kidney') || lowerName.includes('bun') || lowerName.includes('uric acid')) {
    return {
      riskCategories: ['Kidney & hydration'],
      standardMedicalGrouping: 'Renal',
      potentialMedicalConditions: ['Chronic Kidney Disease', 'Hydration Issues']
    };
  }
  
  if (lowerName.includes('glucose') || lowerName.includes('hba1c') || lowerName.includes('insulin') || lowerName.includes('cholesterol') || lowerName.includes('ldl') || lowerName.includes('hdl') || lowerName.includes('triglycerides') || lowerName.includes('tg') || lowerName.includes('sugar') || lowerName.includes('metabolic')) {
    return {
      riskCategories: ['Metabolic & glycemic', 'Cardiovascular'],
      standardMedicalGrouping: 'Metabolic',
      potentialMedicalConditions: ['Diabetes Risk', 'Insulin Resistance', 'Cardiovascular Risk']
    };
  }
  
  if (lowerName.includes('hemoglobin') || lowerName.includes('hgb') || lowerName.includes('wbc') || lowerName.includes('rbc') || lowerName.includes('platelet') || lowerName.includes('plt') || lowerName.includes('hematocrit') || lowerName.includes('mcv') || lowerName.includes('mch') || lowerName.includes('anemia') || lowerName.includes('iron') || lowerName.includes('ferritin')) {
    return {
      riskCategories: ['Hematology'],
      standardMedicalGrouping: 'Hematology',
      potentialMedicalConditions: ['Anemia', 'Hematology Disbalance']
    };
  }
  
  if (lowerName.includes('weight') || lowerName.includes('height') || lowerName.includes('bmi') || lowerName.includes('bp') || lowerName.includes('blood pressure') || lowerName.includes('heart rate') || lowerName.includes('pulse')) {
    return {
      riskCategories: ['Cardiovascular'],
      standardMedicalGrouping: 'Biometrics',
      potentialMedicalConditions: ['Hypertension', 'Obesity']
    };
  }
  
  return {
    riskCategories: ['General Health'],
    standardMedicalGrouping: 'Other',
    potentialMedicalConditions: ['General Imbalance']
  };
}

function performOfflineDataAssembly(yamlText: string, bucketMapping: any) {
  const entries = parseYamlOffline(yamlText);
  const bucketsMap: Record<string, any> = {
    'Metabolic': [],
    'Hepatic': [],
    'Renal': [],
    'Hematology': [],
    'Biometrics': [],
    'Other': []
  };
  
  const biomarkerHistory: Record<string, { value: number; date: string; unit: string }[]> = {};
  for (const entry of entries) {
    if (!entry.biomarker) continue;
    if (!biomarkerHistory[entry.biomarker]) {
      biomarkerHistory[entry.biomarker] = [];
    }
    biomarkerHistory[entry.biomarker].push({
      value: entry.value,
      date: entry.date,
      unit: entry.unit
    });
  }
  
  for (const [name, history] of Object.entries(biomarkerHistory)) {
    const mapping = bucketMapping[name] || getOfflineCategorization(name);
    const grouping = mapping.standardMedicalGrouping || 'Other';
    
    const sortedHistory = [...history].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latest = sortedHistory[0];
    
    const bObj = {
      name,
      riskCategories: mapping.riskCategories || [],
      standardMedicalGrouping: grouping,
      potentialMedicalConditions: mapping.potentialMedicalConditions || [],
      history: history.map(h => {
        const lower = name.toLowerCase();
        let refRange = '0 - 100 ' + h.unit;
        if (lower.includes('glucose')) refRange = '70 - 99 ' + h.unit;
        else if (lower.includes('hba1c')) refRange = '4.0 - 5.6 ' + h.unit;
        else if (lower.includes('alt')) refRange = '7 - 56 ' + h.unit;
        else if (lower.includes('ast')) refRange = '10 - 40 ' + h.unit;
        else if (lower.includes('creatinine')) refRange = '0.6 - 1.2 ' + h.unit;
        
        return {
          date: h.date,
          value: h.value,
          referenceRange: refRange,
          level: "Normal"
        };
      })
    };
    
    if (bucketsMap[grouping]) {
      bucketsMap[grouping].push(bObj);
    } else {
      bucketsMap['Other'].push(bObj);
    }
  }
  
  const buckets = Object.entries(bucketsMap)
    .filter(([_, list]) => list.length > 0)
    .map(([systemName, biomarkers]) => ({
      systemName,
      biomarkers
    }));
    
  return {
    text: "Data successfully processed and categorized offline.",
    entriesCount: entries.length,
    buckets
  };
}

function extractBiomarkerKeysFromYaml(yamlStr: string): string[] {
  if (!yamlStr) return [];
  const keys: string[] = [];

  try {
    const cleanedText = yamlStr.replace(/```(?:yaml|yml)?/gi, '').trim();
    const parsed = parse(cleanedText);
    const rawList = Array.isArray(parsed) 
      ? parsed 
      : (parsed?.biomarkers || parsed?.entries || parsed?.data || []);
    if (Array.isArray(rawList)) {
      rawList.forEach((item: any) => {
        if (item && typeof item === 'object') {
          const bName = item.biomarker || item.name || item.key;
          if (bName) {
            keys.push(String(bName));
          }
        }
      });
    }
  } catch (e) {
    console.warn("extractBiomarkerKeysFromYaml: standard parser failed, falling back to regex", e);
  }

  if (keys.length > 0) {
    return Array.from(new Set(keys)).filter(Boolean);
  }

  const lines = yamlStr.split("\n");
  lines.forEach(line => {
    const trimmed = line.trim();
    const match = trimmed.match(/^(?:-\s*)?biomarker\s*:\s*["']?([^"'\s:]+)["']?/i);
    if (match && match[1]) {
      keys.push(match[1]);
    } else {
      const keyValMatch = trimmed.match(/^([a-zA-Z0-9_-]+)\s*:\s*/);
      if (keyValMatch && keyValMatch[1]) {
        const k = keyValMatch[1].toLowerCase();
        if (k !== 'date' && k !== 'value' && k !== 'unit' && k !== 'biomarker' && k !== 'name') {
          keys.push(keyValMatch[1]);
        }
      }
    }
  });
  return Array.from(new Set(keys)).filter(Boolean);
}

function extractBiomarkerKeysFromPrioritizedConditions(prioritizedConditions: any[]): string[] {
  if (!Array.isArray(prioritizedConditions)) return [];
  const keys: string[] = [];
  prioritizedConditions.forEach(cond => {
    if (cond) {
      if (Array.isArray(cond.biomarkers)) {
        cond.biomarkers.forEach((m: any) => {
          if (m && typeof m.key === 'string') {
            keys.push(m.key);
          }
        });
      }
      if (Array.isArray(cond.biomarkerKeys)) {
        cond.biomarkerKeys.forEach((k: any) => {
          if (typeof k === 'string') {
            keys.push(k);
          }
        });
      }
    }
  });
  return Array.from(new Set(keys)).filter(Boolean);
}

function detectBiomarkersInText(text: string): string[] {
  if (!text) return [];
  const found = new Set<string>();
  const lowerText = text.toLowerCase();
  
  biomarkerDefinitions.forEach(def => {
    const keyLower = def.key.toLowerCase().replace(/_/g, ' ');
    const nameLower = def.name.toLowerCase();
    
    // Check key (as a word boundary if short, otherwise substring)
    const cleanKey = def.key.toLowerCase();
    const isShortKey = cleanKey.length <= 4;
    
    let isKeyInText = false;
    if (isShortKey) {
      const words = lowerText.split(/[^a-zA-Z0-9]/);
      isKeyInText = words.includes(cleanKey);
    } else {
      isKeyInText = lowerText.includes(cleanKey);
    }
    
    const isNameInText = lowerText.includes(nameLower);
    
    if (isNameInText || isKeyInText) {
      found.add(def.name);
    }
  });
  
  return Array.from(found);
}

interface LogChatProps {
  key?: string;
  type: 'food' | 'medical' | 'food_idea' | 'daily_recommendation';
  profile?: UserProfile | null;
  isOpen: boolean;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  onClose: () => void;
  onLogFood?: (food: FoodLog) => void;
  onLogFoodIdeas?: (ideas: FoodIdea[]) => void;
  onLogMedical?: (
    biomarkers: { [key: string]: number | string }, 
    profileUpdates?: Partial<UserProfile>, 
    date?: string, 
    entries?: { date: string | null; biomarkers: { [key: string]: number | string } }[],
    modificationCommand?: { action: 'update_biomarker' | 'update_profile' | 'remove_biomarker'; keyName: string; newValue?: string | number; date?: string }[],
    skipClose?: boolean
  ) => void;
  biomarkers?: { [key: string]: number | string };
  foodLogs?: FoodLog[];
  report?: any;
  actions?: any[];
  googleSteps?: number | null;
  agentType?: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'agent6' | 'agent7' | 'data_review' | null;
  biomarkerHistory?: any[];
  onAgentFinish?: (agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'agent6' | 'agent7' | 'data_review', agentResult: any) => Promise<void>;
  onAgentAnalysisSaved?: (agentType: string, agentResult: any) => Promise<void>;
  onGoToManualEdit?: (errorMsg?: string) => void;
  autoSendMessage?: string | null;
  dataReviewBatchIdx?: number | string | null;
  dataReviewBatchKeys?: string[];
  batchSize?: number;
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

export default function LogChat({ 
  type, 
  profile, 
  isOpen, 
  selectedModelId, 
  onChangeModelId, 
  onClose, 
  onLogFood, 
  onLogFoodIdeas,
  onLogMedical, 
  biomarkers,
  foodLogs,
  report,
  actions = [],
  googleSteps = null,
  agentType = null,
  biomarkerHistory = [],
  onAgentFinish,
  onAgentAnalysisSaved,
  onGoToManualEdit,
  autoSendMessage = null,
  dataReviewBatchIdx = null,
  dataReviewBatchKeys = [],
  batchSize = 20
}: LogChatProps) {
  const [showDataUsed, setShowDataUsed] = useState(false);
  const [showFullScreenConv, setShowFullScreenConv] = useState(false);
  const [isSendingLogs, setIsSendingLogs] = useState(false);
  const [logsSendStatus, setLogsSendStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [activeModalTableRows, setActiveModalTableRows] = useState<any[] | null>(null);
  const [activeModalTitle, setActiveModalTitle] = useState<string>('Consolidated Clinical Biomarker Log');
  const [activeInstructionAgentType, setActiveInstructionAgentType] = useState<string | null>(null);
  const [activeInstructionPrompt, setActiveInstructionPrompt] = useState<string | null>(null);
  const [expandedAudits, setExpandedAudits] = useState<Record<string, boolean>>({});
  const [fullScreenJson, setFullScreenJson] = useState<string | null>(null);
  const [localBatchSize, setLocalBatchSize] = useState(batchSize || 20);
  const [numberOfBatches, setNumberOfBatches] = useState<number>(() => {
    const saved = localStorage.getItem('agent_num_batches');
    return saved ? parseInt(saved, 10) : 50;
  });

  const [showFullScreenDebugLogs, setShowFullScreenDebugLogs] = useState(false);
  const [debugLogs, setDebugLogs] = useState<{ timestamp: string, message: string }[]>([]);
  const [isDebugSendingLogs, setIsDebugSendingLogs] = useState(false);
  const [debugLogsSendStatus, setDebugLogsSendStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const fetchDebugLogs = async () => {
    try {
      const sessionId = getSessionId();
      const res = await fetch('/api/gemini/debug-logs', {
        headers: {
          'X-Session-ID': sessionId
        }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.logs)) {
          setDebugLogs(data.logs);
        }
      }
    } catch (err) {
      console.error("Error fetching debug logs:", err);
    }
  };

  const handleClearDebugLogs = async () => {
    try {
      const sessionId = getSessionId();
      const res = await fetch('/api/gemini/clear-debug-logs', { 
        method: 'POST',
        headers: {
          'X-Session-ID': sessionId
        }
      });
      if (res.ok) {
        const data = await res.json();
        setDebugLogs(data.logs || []);
      }
    } catch (err) {
      console.error("Error clearing debug logs:", err);
    }
  };

  const handleSendDebugLogsToAdmin = async () => {
    setIsDebugSendingLogs(true);
    setDebugLogsSendStatus('idle');
    try {
      const logsText = debugLogs.map(l => `[${l.timestamp}] ${l.message}`).join('\n');
      const sessionId = getSessionId();
      
      const res = await fetch('/api/gemini/send-logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        },
        body: JSON.stringify({ logsText })
      });
      
      if (res.ok) {
        try {
          const res2 = await fetch('/api/gemini/debug-logs', {
            headers: {
              'X-Session-ID': sessionId
            }
          });
          if (res2.ok) {
            const data = await res2.json();
            if (data && Array.isArray(data.logs)) {
              setDebugLogs(data.logs);
            }
          }
        } catch (err) {
          console.error("Error fetching debug logs:", err);
        }
        setDebugLogsSendStatus('success');
        setTimeout(() => setDebugLogsSendStatus('idle'), 3000);
      } else {
        setDebugLogsSendStatus('error');
        const subject = encodeURIComponent(`Healthy App Debug Logs - Session ${sessionId}`);
        const body = encodeURIComponent(`Hello Admin,\n\nHere is the compiled log history for session ${sessionId}:\n\n${logsText}`);
        window.open(`mailto:cwah.liu@gmail.com?subject=${subject}&body=${body}`, '_blank');
      }
    } catch (err) {
      console.error("Error sending logs:", err);
      setDebugLogsSendStatus('error');
    } finally {
      setIsDebugSendingLogs(false);
    }
  };

  useEffect(() => {
    let interval: any;
    if (showFullScreenDebugLogs) {
      fetchDebugLogs();
      interval = setInterval(fetchDebugLogs, 1500);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [showFullScreenDebugLogs]);
  useEffect(() => {
    localStorage.setItem('agent_num_batches', String(numberOfBatches));
  }, [numberOfBatches]);

  const handleSendLogToAdmin = async () => {
    setIsSendingLogs(true);
    setLogsSendStatus('idle');
    try {
      const logsText = messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n');
      const sessionId = auth.currentUser?.uid || 'anonymous';
      
      const res = await fetch('/api/gemini/send-logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        },
        body: JSON.stringify({ logsText })
      });
      
      if (res.ok) {
        setLogsSendStatus('success');
        
        // Native mailto link fallback
        const subject = encodeURIComponent(`Healthy App Food Chat Logs - User ${sessionId}`);
        const body = encodeURIComponent(`Hello Admin,\n\nHere is the compiled food log history for user ${sessionId}:\n\n${logsText}`);
        window.open(`mailto:cwah.liu@gmail.com?subject=${subject}&body=${body}`, '_blank');
      } else {
        setLogsSendStatus('error');
      }
    } catch (err) {
      console.error("Error sending logs:", err);
      setLogsSendStatus('error');
    } finally {
      setIsSendingLogs(false);
      setTimeout(() => setLogsSendStatus('idle'), 4000);
    }
  };

  const userIdentifier = profile?.email?.toLowerCase().replace(/[^a-z0-9]/g, '_') || 'guest';

  const payloadStorageKey = agentType ? `last_sent_payload_${userIdentifier}_${type}_${agentType}_${dataReviewBatchIdx ?? 'none'}` : `last_sent_payload_${userIdentifier}_${type}`;
  const chatStorageKey = agentType ? `chat_messages_${userIdentifier}_${type}_${agentType}_${dataReviewBatchIdx ?? 'none'}` : `chat_messages_${userIdentifier}_${type}`;

  const [lastSentPayload, setLastSentPayload] = useState<any>(null);
  const [messageFormats, setMessageFormats] = useState<Record<string, 'prose' | 'table' | 'card'>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string>(() => {
    return `session_${Date.now()}`;
  });
  const [conversationsList, setConversationsList] = useState<any[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState<boolean>(false);

  const getWelcomeMessage = () => {
    return {
      id: `welcome_${type}_${agentType || 'default'}_${Date.now()}`,
      role: 'assistant' as const,
      content: type === 'food' 
        ? 'Hello! Tell me or upload a photo of what you are planning to eat, and I will analyze its health benefits, risk factors, and full 30 nutrient breakdown based on your profile.'
        : type === 'food_idea'
          ? 'Hello! Do you have any specific food preferences or cravings today? I will need your location to find the best dining options matching your biomarker goals.'
          : type === 'daily_recommendation'
            ? 'Hello! I am your AI Health Coach. Let me look at your clinical biomarkers, daily steps, and latest dietary intake to give you a customized, comprehensive health recommendation today.'
            : agentType === 'agent1'
            ? 'Hello! I am the Clinical Data Parser. I extract biomarkers and readings from raw text or reports into a structured format.'
            : agentType === 'agent2'
              ? 'Hello! I am the Clinical Ontologist. I map extracted biomarkers to clinical conditions and physiological risk categories.'
              : agentType === 'agent3'
                ? 'Hello! I am the Clinical Data Coordinator. I assemble mapped data into clean physiological buckets.'
                : agentType === 'agent4'
                  ? 'Hello! I am the Prognostic Diagnostics Assessment agent. I analyze your biomarker history to project timeline risks and identify testing gaps.'
                  : agentType === 'agent5'
                    ? 'Hello! I am the Personalized Reference Ranges agent. I calibrate normal biomarker reference ranges to your exact demographics.'
                    : agentType === 'agent6'
                      ? 'Hello! I am the Lifestyle Precision Intervention agent. I translate diagnostic risk into strict dietary and movement targets.'
                      : agentType === 'agent7'
                        ? 'Hello! I am the Medical Literature Consensus agent. I scan PubMed and clinical trials to bring recent scientific debate to your context.'
                        : agentType === 'data_review'
                          ? `Hello! I am your Clinical Calibration Agent. Here is what is about to happen: I will analyze ${dataReviewBatchIdx === 'custom' ? 'Custom Test Batch' : 'Batch ' + (dataReviewBatchIdx !== null && dataReviewBatchIdx !== undefined ? (dataReviewBatchIdx as number) + 1 : 1)} containing your raw biomarker readings. I will automatically recognize your demographic parameters (age, gender, ethnicity) and calibrate all reference ranges precisely to your profile. I will then map each biomarker to its standard physiological grouping, potential medical conditions, and break down each medical range clinically (such as Borderline High or Optimal zones) with clear, actionable insights—all without repeating boilerplate demographic lines. Let's start the calibration!`
                          : 'Hello! I can help you parse blood report photos, medical test charts, or manual body logs to build a comprehensive profile of your biomarkers. What information would you like to enter today?',
      timestamp: new Date().toISOString()
    };
  };

  const saveConversationToFirestore = async (id: string, msgs: ChatMessage[], payload: any) => {
    const userId = auth.currentUser?.uid;
    if (!userId) {
      try {
        sessionStorage.setItem(chatStorageKey, JSON.stringify(msgs));
        if (payload) sessionStorage.setItem(payloadStorageKey, JSON.stringify(payload));
      } catch (e) {
        console.warn("Quota exceeded in sessionStorage");
      }
      return;
    }

    try {
      const docRef = doc(db, 'users', userId, 'conversations', id);
      await setDoc(docRef, sanitizeForFirestore({
        id,
        userId,
        type: type || 'medical',
        agentType: agentType || null,
        title: msgs.length > 1 
          ? (msgs[1].role === 'user' ? msgs[1].content.slice(0, 30) + '...' : `Session - ${new Date(msgs[0].timestamp).toLocaleDateString()}`)
          : `Session - ${new Date().toLocaleDateString()}`,
        createdAt: msgs[0]?.timestamp || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messages: msgs,
        lastSentPayload: payload || null
      }), { merge: true });
    } catch (err) {
      console.error("Error saving conversation to Firestore:", err);
    }
  };

  const loadConversationsFromFirestore = async () => {
    const userId = auth.currentUser?.uid;
    if (!userId) {
      const saved = sessionStorage.getItem(chatStorageKey);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          setMessages(parsed);
          const savedPayload = sessionStorage.getItem(payloadStorageKey);
          setLastSentPayload(savedPayload ? JSON.parse(savedPayload) : null);
        } catch {}
      } else {
        const welcome = getWelcomeMessage();
        setMessages([welcome]);
        setLastSentPayload(null);
      }
      return;
    }

    setIsLoadingConversations(true);
    try {
      const q = query(
        collection(db, 'users', userId, 'conversations'),
        where('type', '==', type || 'medical'),
        where('agentType', '==', agentType || null)
      );
      const snapshot = await getDocs(q);
      const list: any[] = [];
      snapshot.forEach(docSnap => {
        list.push(docSnap.data());
      });

      list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      setConversationsList(list);

      if (list.length > 0) {
        const match = list.find(c => c.id === activeConversationId) || list[0];
        setActiveConversationId(match.id);
        setMessages(match.messages || []);
        setLastSentPayload(match.lastSentPayload || null);
      } else {
        const newId = `session_${Date.now()}`;
        setActiveConversationId(newId);
        const welcome = getWelcomeMessage();
        setMessages([welcome]);
        setLastSentPayload(null);
        await saveConversationToFirestore(newId, [welcome], null);
        setConversationsList([{
          id: newId,
          type: type || 'medical',
          agentType: agentType || null,
          title: 'New Session',
          updatedAt: new Date().toISOString(),
          messages: [welcome]
        }]);
      }
    } catch (err) {
      console.error("Error loading conversations from Firestore:", err);
    } finally {
      setIsLoadingConversations(false);
    }
  };

  const handleNewSession = async () => {
    const newId = `session_${Date.now()}`;
    setActiveConversationId(newId);
    const welcome = getWelcomeMessage();
    setMessages([welcome]);
    setLastSentPayload(null);
    await saveConversationToFirestore(newId, [welcome], null);
    
    setConversationsList(prev => [
      {
        id: newId,
        type: type || 'medical',
        agentType: agentType || null,
        title: `Session - ${new Date().toLocaleDateString()}`,
        updatedAt: new Date().toISOString(),
        messages: [welcome]
      },
      ...prev
    ]);
  };

  const handleDeleteSession = async (sessId: string) => {
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    try {
      await deleteDoc(doc(db, 'users', userId, 'conversations', sessId));
      const updatedList = conversationsList.filter(c => c.id !== sessId);
      setConversationsList(updatedList);
      
      if (sessId === activeConversationId) {
        if (updatedList.length > 0) {
          const nextSess = updatedList[0];
          setActiveConversationId(nextSess.id);
          setMessages(nextSess.messages || []);
          setLastSentPayload(nextSess.lastSentPayload || null);
        } else {
          handleNewSession();
        }
      }
    } catch (err) {
      console.error("Error deleting session:", err);
    }
  };

  const handleSwitchSession = (sessId: string) => {
    const found = conversationsList.find(c => c.id === sessId);
    if (found) {
      setActiveConversationId(sessId);
      setMessages(found.messages || []);
      setLastSentPayload(found.lastSentPayload || null);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadConversationsFromFirestore();
    }
  }, [auth.currentUser, type, agentType, isOpen]);

  useEffect(() => {
    if (activeConversationId && messages && messages.length > 0) {
      saveConversationToFirestore(activeConversationId, messages, lastSentPayload);
    }
  }, [messages, lastSentPayload, activeConversationId]);

  const [inputText, setInputText] = useState('');
  const [budget, setBudget] = useState(() => localStorage.getItem('food_budget') || '');
  const [currency, setCurrency] = useState(() => localStorage.getItem('food_currency') || 'GBP');
  const [maxDistance, setMaxDistance] = useState(() => {
    const saved = localStorage.getItem('food_max_distance');
    return saved ? parseFloat(saved) : 3;
  });

  useEffect(() => {
    localStorage.setItem('food_budget', budget);
  }, [budget]);

  useEffect(() => {
    localStorage.setItem('food_currency', currency);
  }, [currency]);

  useEffect(() => {
    localStorage.setItem('food_max_distance', String(maxDistance));
  }, [maxDistance]);

  useEffect(() => {
    const savedCurrency = localStorage.getItem('food_currency');
    if (!savedCurrency) {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const isIndo = tz && (tz.includes('Jakarta') || tz.includes('Makassar') || tz.includes('Jayapura') || tz.includes('Asia/Jakarta') || tz.includes('Asia/Makassar') || tz.includes('Asia/Jayapura'));
      if (isIndo) {
        setCurrency('IDR');
        setBudget('100000');
      } else {
        setCurrency('GBP');
        setBudget('5');
      }
    }
  }, []);

  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [selectedImagesForAnalysis, setSelectedImagesForAnalysis] = useState<string[]>([]);
  const [imageDates, setImageDates] = useState<string[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const [compressionProgress, setCompressionProgress] = useState({ current: 0, total: 0, percent: 0 });
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzingStepIndex, setAnalyzingStepIndex] = useState(0);
  const [expandedNutrients, setExpandedNutrients] = useState(false);
  const [isEngineSelectorOpen, setIsEngineSelectorOpen] = useState(false);
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const t = translations[profile?.language || 'en'] || translations.en;

  const ANALYZING_STEPS = type === 'food'
    ? ["Reading your photos...", "Searching nutrition databases...", "Checking your biomarker profile...", "Consulting the clinical AI model..."]
    : ["Gathering your recent history...", "Checking your biomarker profile...", "Consulting the clinical AI model..."];

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;
    if (isAnalyzing) {
      interval = setInterval(() => {
        setAnalyzingStepIndex((prev) => {
          if (prev < ANALYZING_STEPS.length - 1) {
            return prev + 1;
          }
          return prev;
        });
      }, 1800);
    } else {
      setAnalyzingStepIndex(0);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isAnalyzing, type]);

  const [loggedMessageIds, setLoggedMessageIds] = useState<string[]>([]);
  const [showPastDiscussion, setShowPastDiscussion] = useState(false);
  const [sessionStartTime, setSessionStartTime] = useState<number>(Date.now());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleDeleteMessagePair = (messageId: string) => {
    setMessages(prev => {
      const idx = prev.findIndex(m => m.id === messageId);
      if (idx === -1) return prev;
      const msgToDelete = prev[idx];
      const newMsgs = [...prev];
      if (msgToDelete.role === 'user') {
        if (idx + 1 < newMsgs.length && newMsgs[idx + 1].role === 'assistant') {
          newMsgs.splice(idx, 2);
        } else {
          newMsgs.splice(idx, 1);
        }
      } else if (msgToDelete.role === 'assistant') {
        if (idx - 1 >= 0 && newMsgs[idx - 1].role === 'user') {
          newMsgs.splice(idx - 1, 2);
        } else {
          newMsgs.splice(idx, 1);
        }
      }
      return newMsgs;
    });
  };

  useEffect(() => {
    if (isOpen) {
      const saved = sessionStorage.getItem(chatStorageKey);
      let lastMsg: ChatMessage | null = null;
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.length > 0) {
            lastMsg = parsed[parsed.length - 1];
          }
        } catch (e) {}
      }

      // Removed session start time resetting

      // Removed forced welcome message append and hiding of past discussion
    }
  }, [isOpen, type, chatStorageKey]);

  useEffect(() => {
    // Eagerly fetch user location only when food idea chat is active
    if (type !== 'food_idea' || !isOpen) return;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        setUserLocation({ lat, lng });
        
        const isIndo = lat >= -11 && lat <= 6 && lng >= 95 && lng <= 141;
        const savedCurrency = localStorage.getItem('food_currency');
        if (!savedCurrency && isIndo) {
          setCurrency('IDR');
          setBudget('100000');
        }
      }, (err) => {
        console.warn("Could not get location:", err);
      });
    }
  }, [isOpen, type]);

  const outOfRangeBiomarkers = React.useMemo(() => {
    if (!biomarkers) return [];
    const list: { key: string; name: string; value: any; status: string; normalRange: string; unit: string }[] = [];
    Object.entries(biomarkers || {}).forEach(([key, val]) => {
      const def = biomarkerDefinitions.find(d => d.key === key);
      const customDef = profile?.customBiomarkers?.[key];
      if (!def && !customDef) return;
      
      const normalRange = customDef?.normalRange || def?.normalRange || '';
      const unit = customDef?.unit || def?.unit || '';
      const name = customDef?.name || def?.name || key;
      
      const status = getBiomarkerStatus(key, val, normalRange, customDef || def, profile);
      if (status === 'high' || status === 'low' || status === 'critical') {
        list.push({
          key,
          name,
          value: val,
          status,
          normalRange,
          unit
        });
      }
    });
    return list;
  }, [biomarkers, profile?.ethnicity]);

  const remainingAllowance = React.useMemo(() => {
    const todayStr = getCurrentDateInTimezone(profile?.timezone);
    const todaysFoods = foodLogs ? foodLogs.filter(f => f.date === todayStr) : [];

    const todaysTotals = todaysFoods.reduce((acc, curr) => {
      if (curr.nutrients) {
        Object.keys(curr.nutrients).forEach(k => {
          const key = k as keyof typeof curr.nutrients;
          acc[key] = (Number(acc[key]) || 0) + (Number(curr.nutrients[key]) || 0);
        });
      }
      return acc;
    }, {} as { [key: string]: number });

    const parseTarget = (val: any, fallback: number) => {
      if (val === null || val === undefined) return fallback;
      const cleanStr = String(val).replace(/,/g, '');
      const matches = cleanStr.match(/\d+(\.\d+)?/g);
      if (!matches || matches.length === 0) return fallback;
      const parsed = parseFloat(matches[0]);
      return isNaN(parsed) ? fallback : parsed;
    };

    const activeTargets = {
      calories: Number(todaysTotals.calories || 0),
      caloriesTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.calories, 1700) : 1800,
      satFat: Number(todaysTotals.saturatedFat || 0),
      satFatTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.saturatedFat, 15) : 15,
      sodium: Number(todaysTotals.sodium || 0),
      sodiumTarget: report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.sodium, 1200) : 1200,
    };

    return {
      calories: Math.max(0, activeTargets.caloriesTarget - activeTargets.calories),
      saturatedFat: Math.max(0, activeTargets.satFatTarget - activeTargets.satFat),
      sodium: Math.max(0, activeTargets.sodiumTarget - activeTargets.sodium),
      caloriesTarget: activeTargets.caloriesTarget,
      saturatedFatTarget: activeTargets.satFatTarget,
      sodiumTarget: activeTargets.sodiumTarget,
    };
  }, [foodLogs, report, profile?.timezone]);

  useEffect(() => {
    if (!isAnalyzing && messages.length > 1) {
      const lastMsg = messages[messages.length - 1];
      if (lastMsg && lastMsg.role === 'assistant') {
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 150);
      }
    }
  }, [isAnalyzing, messages]);

  const matchingPreviousLogs = React.useMemo(() => {
    if (type !== 'food' || !foodLogs || inputText.trim().length < 3) return [];
    const query = inputText.toLowerCase().trim();
    const uniqueMatches: FoodLog[] = [];
    const seenNames = new Set<string>();
    
    const reversedLogs = [...foodLogs].reverse();
    for (const log of reversedLogs) {
      if (log.name && log.name.toLowerCase().includes(query)) {
        if (!seenNames.has(log.name.toLowerCase())) {
          seenNames.add(log.name.toLowerCase());
          uniqueMatches.push(log);
        }
      }
    }
    return uniqueMatches;
  }, [type, foodLogs, inputText]);



  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = ''; // Reset input value immediately so same files can be selected again
    
    if (fileList.length > 0) {
      const validFiles = fileList.filter((file: any) => {
        const isDng = file.name.toLowerCase().endsWith('.dng') || file.type.includes('dng') || file.type === 'image/x-adobe-dng';
        return !isDng;
      });

      const dngCount = fileList.length - validFiles.length;
      if (dngCount > 0) {
        alert("DNG (RAW) files are not supported by web browsers. Please select standard images like JPEG, PNG, or WEBP.");
      }

      if (validFiles.length === 0) return;

      setIsCompressing(true);
      setCompressionProgress({ current: 0, total: validFiles.length, percent: 0 });
      try {
        const compressed = await compressMultipleImages(validFiles, (progress) => {
          setCompressionProgress({
            current: progress.currentIndex,
            total: progress.totalCount,
            percent: progress.percentage
          });
        }, 400, 400, 0.5);
        const analysisCompressed = await compressMultipleImages(validFiles, () => {}, 1280, 1280, 0.85);
        const dates = await Promise.all(validFiles.map(async (f: any) => {
          try {
            const exifData = await exifr.parse(f, ['DateTimeOriginal']);
            if (exifData && exifData.DateTimeOriginal) {
              return new Date(exifData.DateTimeOriginal).toLocaleString();
            }
          } catch (e) {
            console.warn("Could not parse EXIF for", f.name);
          }
          return new Date(f.lastModified).toLocaleString();
        }));
        setSelectedImages(prev => [...prev, ...compressed]);
        setSelectedImagesForAnalysis(prev => [...prev, ...analysisCompressed]);
        setImageDates(prev => [...prev, ...dates]);
      } catch (err) {
        console.error("Error compressing selected images:", err);
      } finally {
        setIsCompressing(false);
      }
    }
  };

  const handleSend = async (overrideText?: string | any) => {
    const textToSend = typeof overrideText === 'string' ? overrideText : inputText;
    if (!textToSend && selectedImages.length === 0) return;

    // Eagerly wait for geolocation if doing food ideas and it's not resolved yet
    let loc = userLocation;
    if (type === 'food_idea' && !loc) {
      if (navigator.geolocation) {
        try {
          console.log("[Geolocation] Awaiting geolocation resolution before food-idea request...");
          const position = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 4000 });
          });
          loc = { lat: position.coords.latitude, lng: position.coords.longitude };
          setUserLocation(loc);
        } catch (err) {
          console.warn("[Geolocation] Could not await location during handleSend:", err);
        }
      }
    }

    const userMsg: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: textToSend,
      timestamp: new Date().toISOString(),
      imageUrl: selectedImages[0] || undefined,
      imageUrls: selectedImages.length > 0 ? selectedImages : undefined
    };

    setMessages(prev => [...prev, userMsg]);
    if (typeof overrideText !== 'string') {
      setInputText('');
    }
    const tempImages = [...selectedImages];
    const tempAnalysisImages = [...selectedImagesForAnalysis];
    const tempDates = [...imageDates];
    setSelectedImages([]);
    setSelectedImagesForAnalysis([]);
    setImageDates([]);
    setIsAnalyzing(true);

    try {
      let endpoint = '';
      if (type === 'food') endpoint = '/api/gemini/food-analyze';
      else if (type === 'food_idea') endpoint = '/api/gemini/food-idea';
      else if (type === 'daily_recommendation') endpoint = '/api/gemini/daily-recommendation-chat';
      else endpoint = '/api/gemini/medical-analyze';

      const lightProfile = profile ? { ...profile } as any : null;
      if (lightProfile) {
        delete lightProfile.fontSizeTitle;
        delete lightProfile.fontSizeSubtitle;
        delete lightProfile.fontSizeSubtitleSmall;
        delete lightProfile.fontSizeBodySmall;
        delete lightProfile.fontSizeXS;
        delete lightProfile.fontSizeKeyMetric;
        delete lightProfile.fontSizeDescription;
        delete lightProfile.photoUrl;
        delete lightProfile.timezone;
        delete lightProfile.language;
        delete lightProfile.deletedBiomarkerLogIds;
        delete lightProfile.deletedFoodLogIds;
        delete lightProfile.deletedCustomBiomarkerKeys;
        delete lightProfile.agentTriageSummary;
        delete lightProfile.approved_agent1_batches;
        delete lightProfile.approved_data_review_batches;
        delete lightProfile.agentAnalyses;
        delete lightProfile.agentContextualizerSummary;
        delete lightProfile.stripeSubscriptionId;
      }

      const revIdx = [...messages].reverse().findIndex(m => m.id.startsWith('welcome_'));
      const lastWelcomeIndex = revIdx >= 0 ? messages.length - 1 - revIdx : -1;
      const activeSessionIdx = lastWelcomeIndex >= 0 ? lastWelcomeIndex : 0;
      
      const bodyData: any = {
        userId: auth.currentUser?.uid || undefined,
        message: userMsg.content,
        image: tempAnalysisImages[0] || tempImages[0] || undefined,
        images: tempAnalysisImages.length > 0 ? tempAnalysisImages : (tempImages.length > 0 ? tempImages : undefined),
        imageDates: tempDates.length > 0 ? tempDates : undefined,
        history: messages.slice(activeSessionIdx).filter(m => !m.id.startsWith('welcome_')).slice(-10).map(m => {
          let extra = "";
          if (m.role === 'assistant') {
            if (m.pendingBiomarkers) extra += `\n[Extracted Biomarkers: ${JSON.stringify(m.pendingBiomarkers)}]`;
            if (m.pendingFoodLog) {
               extra += `\n[Extracted Food: ${m.pendingFoodLog.name}, ${m.pendingFoodLog.quantity}, ${m.pendingFoodLog.nutrients?.calories || 0} kcal. (Full nutrient data omitted for brevity)]`;
            }
            if (m.pendingDate) extra += `\n[Extracted Date: ${m.pendingDate}]`;
            if (m.pendingProfile) extra += `\n[Extracted Profile: ${JSON.stringify(m.pendingProfile)}]`;
          }
          return { role: m.role, content: m.content + extra };
        }),
        userProfile: lightProfile,
        engine: selectedModelId
      };
      
      // Clean up undefined fields
      Object.keys(bodyData).forEach(key => {
        if (bodyData[key] === undefined) delete bodyData[key];
      });

      if (type === 'food') {
        const lastFoodLog = [...messages].reverse().find(m => m.pendingFoodLog)?.pendingFoodLog;
        if (lastFoodLog) {
          bodyData.activeMeal = lastFoodLog;
        }
        bodyData.biomarkersNeedingImprovement = outOfRangeBiomarkers.map(b => `${b.name} is ${getBiomarkerStatusLabel(b.key, b.status, profile?.customBiomarkers?.[b.key], b.value, profile).toUpperCase()} (${b.value} ${b.unit}, normal range: ${b.normalRange})`);
        bodyData.remainingAllowance = {
          calories: remainingAllowance.calories,
          caloriesTarget: remainingAllowance.caloriesTarget,
          saturatedFat: remainingAllowance.saturatedFat,
          saturatedFatTarget: remainingAllowance.saturatedFatTarget,
          sodium: remainingAllowance.sodium,
          sodiumTarget: remainingAllowance.sodiumTarget,
        };
      } else if (type === 'daily_recommendation') {
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
        const monthPrefix = `${currentYear}-${currentMonth}`;

        // Filter food logs for this month
        const thisMonthFoodLogs = (foodLogs || []).filter(f => f.date && f.date.startsWith(monthPrefix));

        // Group by day
        const dailyNutrientIntake: { [date: string]: { [nutrient: string]: number } } = {};
        thisMonthFoodLogs.forEach(log => {
          const d = log.date;
          if (!dailyNutrientIntake[d]) {
            dailyNutrientIntake[d] = {
              calories: 0,
              protein: 0,
              saturatedFat: 0,
              sodium: 0,
              carbohydrates: 0,
              totalFat: 0
            };
          }
          const nut = (log.nutrients || {}) as any;
          dailyNutrientIntake[d].calories += Number(nut.calories || 0);
          dailyNutrientIntake[d].protein += Number(nut.protein || 0);
          dailyNutrientIntake[d].saturatedFat += Number(nut.saturatedFat || 0);
          dailyNutrientIntake[d].sodium += Number(nut.sodium || 0);
          dailyNutrientIntake[d].carbohydrates += Number(nut.carbohydrates || 0);
          dailyNutrientIntake[d].totalFat += Number(nut.totalFat || 0);
        });

        const emailSuffix = profile?.email ? `_${profile.email.toLowerCase().trim()}` : '_guest';
        const stepsHistoryStr = localStorage.getItem(`googleStepsHistory${emailSuffix}`);
        let stepsHistory: { date: string, value: number }[] = [];
        if (stepsHistoryStr) {
          try {
            stepsHistory = JSON.parse(stepsHistoryStr);
          } catch (e) {}
        }
        const thisMonthSteps = stepsHistory.filter(h => h.date && h.date.startsWith(monthPrefix));

        bodyData.foodLogs = (foodLogs || []).map(f => ({ name: f.name, date: f.date, nutrients: f.nutrients }));
        bodyData.biomarkers = biomarkers;
        bodyData.report = report;
        bodyData.actions = actions;
        bodyData.steps = googleSteps;
        bodyData.location = loc;
        bodyData.thisMonthTrends = {
          dailyNutrientIntake,
          stepsHistory: thisMonthSteps
        };
      } else if (type === 'food_idea') {
        bodyData.location = loc;
        bodyData.recentMeals = (foodLogs || []).slice(-20).map(f => f.name);
        bodyData.budget = budget;
        bodyData.currency = currency;
        bodyData.maxDistance = maxDistance;
        bodyData.outOfRangeBiomarkers = outOfRangeBiomarkers;
        bodyData.biomarkersNeedingImprovement = outOfRangeBiomarkers.map(b => `${b.name} is ${getBiomarkerStatusLabel(b.key, b.status, profile?.customBiomarkers?.[b.key], b.value, profile).toUpperCase()} (${b.value} ${b.unit}, normal range: ${b.normalRange})`);
        
        // Fetch real places from Overpass API (client-side bypasses container blocks)
        if (loc) {
          try {
            const radius = Math.min(Number(maxDistance) * 1000, 5000);
            const overpassQuery = `[out:json];(node["amenity"~"restaurant|cafe|fast_food|food_court"](around:${radius},${loc.lat},${loc.lng}););out 30;`;
            const overpassRes = await fetch("https://overpass-api.de/api/interpreter", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: "data=" + encodeURIComponent(overpassQuery)
            });
            if (overpassRes.ok) {
              const overpassData = await overpassRes.json();
              if (overpassData && overpassData.elements && overpassData.elements.length > 0) {
                bodyData.clientNearbyPlaces = overpassData.elements
                  .filter((e: any) => e.tags && e.tags.name)
                  .map((e: any) => ({
                    name: e.tags.name,
                    lat: e.lat,
                    lng: e.lon,
                    address: e.tags['addr:street'] ? `${e.tags['addr:street']} ${e.tags['addr:housenumber'] || ''}` : '',
                    opening_hours: e.tags['opening_hours'] || '--'
                  }));
              }
            }
          } catch (e) {
            console.warn("Client side Overpass fetch failed:", e);
          }
        }
      } else if (type === 'medical') {
        bodyData.existingBiomarkers = Array.from(new Set([...(biomarkers ? Object.keys(biomarkers) : []), ...Object.keys(profile?.customBiomarkers || {})]));
        bodyData.numberOfBatches = numberOfBatches;
        const lastMsg = [...messages].reverse().find(m => m.lastProcessedItem !== undefined);
        if (lastMsg && lastMsg.lastProcessedItem) {
          bodyData.lastProcessedItem = lastMsg.lastProcessedItem;
        }
        if (agentType) {
          let currentStep = 'agent1_step1';
          if (agentType === 'agent1') {
            if (dataReviewBatchIdx !== null && dataReviewBatchIdx !== undefined) {
              currentStep = 'agent1';
            } else {
              // New user-typed text queries must ALWAYS start fresh at Step 1
              currentStep = 'agent1_step1';
            }
            
            // Also find and attach extractedYaml and bucketMapping if available
            const yamlMsg = [...messages].reverse().find(m => m.agentResult?.extractedYaml || m.extractedYaml);
            if (yamlMsg) {
              bodyData.extractedYaml = yamlMsg.agentResult?.extractedYaml || yamlMsg.extractedYaml;
            }
            const mapMsg = [...messages].reverse().find(m => m.agentResult?.bucketMapping || m.bucketMapping);
            if (mapMsg) {
              bodyData.bucketMapping = typeof (mapMsg.agentResult?.bucketMapping || mapMsg.bucketMapping) === 'string'
                ? (mapMsg.agentResult?.bucketMapping || mapMsg.bucketMapping)
                : JSON.stringify(mapMsg.agentResult?.bucketMapping || mapMsg.bucketMapping);
            }
          } else {
            currentStep = agentType;
          }
          bodyData.agentType = currentStep;
          if (currentStep === 'agent6') {
            bodyData.biomarkerHistory = [];
            bodyData.biomarkers = biomarkers || {};
            bodyData.recentMeals = [];
            bodyData.agentDiagnosticSummary = profile?.agentDiagnosticSummary || '';
            if (bodyData.history && bodyData.history.length > 0) {
              bodyData.history = bodyData.history.filter((h: any) => {
                if (!h.content) return false;
                const lower = h.content.toLowerCase();
                return !(
                  lower.includes("food log") || 
                  lower.includes("[extracted food") || 
                  lower.includes("active meal") || 
                  lower.includes("[extracted biomarkers") ||
                  lower.includes("meal log") ||
                  lower.includes("banana") ||
                  lower.includes("pineapple")
                );
              });
            }
          } else {
            bodyData.biomarkerHistory = biomarkerHistory || [];
            bodyData.biomarkers = biomarkers || {};
            bodyData.recentMeals = foodLogs ? (foodLogs || []).slice(-20).map(f => f.name) : [];
            bodyData.agentDiagnosticSummary = profile?.agentDiagnosticSummary || '';
          }

          if ((currentStep === 'data_review' || currentStep === 'agent1') && dataReviewBatchIdx !== null && dataReviewBatchIdx !== undefined) {
            let batchKeys: string[] = [];
            if (dataReviewBatchIdx === 'custom') {
              try {
                const batchKeyName = `agent1_custom_batch_keys_${userIdentifier}`;
                batchKeys = JSON.parse(localStorage.getItem(batchKeyName) || '[]');
              } catch(e) {}
            } else if (dataReviewBatchKeys && dataReviewBatchKeys.length > 0) {
              batchKeys = dataReviewBatchKeys;
            } else {
              const markerKeysList = Object.keys(biomarkers || {}).filter(k => biomarkers?.[k] !== undefined && biomarkers?.[k] !== null && biomarkers?.[k] !== '');
              const bSize = localBatchSize || batchSize || 20;
              const batchRes: string[][] = [];
              for (let i = 0; i < markerKeysList.length; i += bSize) {
                batchRes.push(markerKeysList.slice(i, i + bSize));
              }
              batchKeys = batchRes[dataReviewBatchIdx as number] || [];
            }
            bodyData.batchBiomarkers = batchKeys.map(k => {
              const customDef = profile?.customBiomarkers?.[k];
              const stdDef = biomarkerDefinitions.find(d => d.key === k);
              const displayName = customDef?.name || stdDef?.name || k.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
              return {
                key: k,
                name: displayName,
                value: biomarkers?.[k],
                unit: customDef?.unit || stdDef?.unit || ''
              };
            });
            bodyData.batchIdx = dataReviewBatchIdx;

            // Unit Enforcement Check
            if (currentStep === 'data_review') {
              const missing = bodyData.batchBiomarkers.filter((bm: any) => !bm.unit || bm.unit.trim() === '');
              if (missing.length > 0) {
                const names = missing.map((bm: any) => bm.name).join(', ');
                throw new Error(`The following biomarkers in this batch are missing clinical units: ${names}. Please configure their units in the Reference Ranges / Calibration tab under Insights before executing calibration.`);
              }
            }
          }
        }
      }

      const storageKey = type === 'food' ? 'food' : (type === 'food_idea' ? 'food_idea' : (agentType || 'agent1'));
      const customSystemInstruction = localStorage.getItem(`custom_system_instruction_${storageKey}`);
      const customVariableData = localStorage.getItem(`custom_variable_data_${storageKey}`);
      if (customSystemInstruction) {
        bodyData.customSystemInstruction = customSystemInstruction;
      }
      if (customVariableData) {
        bodyData.customVariableData = customVariableData;
      }

      // Save display-friendly payload for debug mode
      const displayPayload = { ...bodyData };
      if (displayPayload.image && typeof displayPayload.image === 'string') {
        displayPayload.image = displayPayload.image.substring(0, 100) + "... [truncated base64]";
      }
      if (displayPayload.images && Array.isArray(displayPayload.images)) {
        displayPayload.images = displayPayload.images.map((img: any) => typeof img === 'string' ? img.substring(0, 100) + "... [truncated base64]" : img);
      }
      setLastSentPayload(displayPayload);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-ID': getSessionId()
        },
        body: JSON.stringify(bodyData)
      });

      const resData = await response.json();
      if (resData.error) throw new Error(resData.error);

      if (bodyData.batchBiomarkers && !resData.batchBiomarkers) {
        resData.batchBiomarkers = bodyData.batchBiomarkers;
      }

      const assistantMsg: ChatMessage = {
        id: `msg_${Date.now() + 1}`,
        role: 'assistant',
        content: resData.text || 'Information extracted.',
        timestamp: new Date().toISOString(),
        agentResult: resData,
      };
      
      if (type === 'food') {
        if (resData.data) {
          const lastFoodLog = [...messages].reverse().find(m => m.pendingFoodLog)?.pendingFoodLog;
          const currentTranscript = [...messages, userMsg, assistantMsg].map(m => ({
            role: m.role as 'user' | 'assistant',
            content: m.content,
            timestamp: m.timestamp
          }));
          assistantMsg.pendingFoodLog = {
            ...resData.data,
            date: resData.data.date || lastFoodLog?.date || getCurrentDateInTimezone(profile?.timezone),
            id: `food_${Date.now()}`,
            imageUrl: tempImages.length > 0 ? tempImages[0] : resData.data.imageUrl,
            imageUrls: tempImages.length > 0 ? tempImages : resData.data.imageUrls,
            chatTranscript: currentTranscript
          };
        }
      } else if (type === 'food_idea') {
        if (resData.ideas && resData.ideas.length > 0) {
          assistantMsg.pendingFoodIdeas = resData.ideas;
        }
      } else {
        if (agentType) {
          assistantMsg.agentType = agentType;
          assistantMsg.agentResult = resData;
          if (agentType === 'agent1') {
            assistantMsg.agentTypeStep = resData.agentType || 'agent1_step1';
          }
          if (onAgentAnalysisSaved) {
            await onAgentAnalysisSaved(agentType, resData);
          }
        } else {
          assistantMsg.mode = resData.mode;
          assistantMsg.status = resData.status;
          assistantMsg.planningDetails = resData.planningDetails;
          assistantMsg.lastProcessedItem = resData.lastProcessedItem;
          assistantMsg.modificationCommand = resData.modificationCommand;
          assistantMsg.pendingBiomarkerEntries = resData.entries || [];
          // Legacy fallback
          assistantMsg.pendingBiomarkers = resData.biomarkers;
          assistantMsg.pendingDate = resData.date;
          
          // Merge custom biomarker definitions into profile if any
          let mergedProfile = { ...resData.profile };
          if (resData.customBiomarkerDefs && Object.keys(resData.customBiomarkerDefs).length > 0) {
            const defsWithApproval: { [key: string]: any } = {};
            Object.entries(resData.customBiomarkerDefs).forEach(([k, v]: [string, any]) => {
              defsWithApproval[k] = { ...v, needsApproval: true };
            });
            mergedProfile.customBiomarkers = {
              ...(profile?.customBiomarkers || {}),
              ...defsWithApproval
            };
          }
          assistantMsg.pendingProfile = mergedProfile;
        }
      }

      setMessages(prev => {
        if (type === 'food' && resData.mode === 'modify' && resData.data) {
          let updated = false;
          const newPrev = [...prev].reverse().map(m => {
            if (!updated && m.pendingFoodLog) {
              updated = true;
              return {
                ...m,
                pendingFoodLog: {
                  ...m.pendingFoodLog,
                  ...resData.data
                }
              };
            }
            return m;
          }).reverse();
          return [...newPrev, assistantMsg];
        }
        return [...prev, assistantMsg];
      });
    } catch (err: any) {
      console.error(err);
      if (type === 'food') {
        setMessages(prev => [
          ...prev,
          {
            id: `msg_err_${Date.now()}`,
            role: 'assistant',
            content: `The food log agent is not available. Please enter the food details manually.`,
            timestamp: new Date().toISOString(),
            agentUnavailable: true
          }
        ]);
        if (onGoToManualEdit) {
          setTimeout(() => {
            onGoToManualEdit("The AI agent is not available. Please enter the food details manually.");
          }, 800);
        }
      } else {
        const isQuota = err.message?.includes("429") || err.message?.includes("quota") || err.message?.includes("RESOURCE_EXHAUSTED");
        setMessages(prev => [
          ...prev,
          {
            id: `msg_err_${Date.now()}`,
            role: 'assistant',
            content: isQuota ? `You have exceeded your Gemini API quota limit. Please check your billing or try again later.` : `Error running analysis: ${err.message || 'Server connection timed out.'}`,
            timestamp: new Date().toISOString()
          }
        ]);
      }
    } finally {
      setIsAnalyzing(false);
    }
  };

  useEffect(() => {
    if (isOpen && autoSendMessage && (type === 'medical' || type === 'daily_recommendation')) {
      if (agentType === 'data_review') {
        setInputText(autoSendMessage);
        return;
      }
      const alreadySent = messages.some(m => m.role === 'user' && m.content === autoSendMessage);
      if (!alreadySent) {
        const timer = setTimeout(() => {
          handleSend(autoSendMessage);
        }, 400);
        return () => clearTimeout(timer);
      }
    }
  }, [isOpen, autoSendMessage, type, messages, agentType]);

  const handleContinueExtractionChunk = async (msg: any) => {
    setIsAnalyzing(true);
    try {
      const msgIndex = messages.findIndex(m => m.id === msg.id);
      const allUserText = messages.slice(0, msgIndex).filter(m => m.role === 'user').map(m => m.content).join('\n\n');

      const bodyData: any = {
        agentType: 'agent1_step1',
        message: `continue: ${allUserText}`,
        extractedYaml: msg.agentResult?.extractedYaml || msg.extractedYaml,
        remainingText: msg.agentResult?.remainingText || '',
        estimatedTotalMarkers: msg.agentResult?.estimatedTotalMarkers,
        numberOfBatches: numberOfBatches,
        engine: selectedModelId
      };

      const response = await fetch('/api/gemini/medical-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Server returned ${response.status}: ${errText}`);
      }

      const resData = await response.json();

      setMessages(prev => prev.map(m => {
        if (m.id === msg.id) {
          return {
            ...m,
            content: resData.text || m.content,
            agentResult: {
              ...m.agentResult,
              text: resData.text || m.agentResult?.text,
              extractedYaml: resData.extractedYaml || m.agentResult?.extractedYaml,
              hasMoreMarkers: resData.hasMoreMarkers,
              remainingText: resData.remainingText || '',
              estimatedTotalMarkers: resData.estimatedTotalMarkers !== undefined ? resData.estimatedTotalMarkers : m.agentResult?.estimatedTotalMarkers
            }
          };
        }
        return m;
      }));
    } catch (err: any) {
      console.error(err);
      setMessages(prev => [
        ...prev,
        {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `Error during chunk extraction: ${err.message}`,
          timestamp: new Date().toISOString(),
          isError: true,
          errorStep: 'agent1_step1',
          originalMsg: msg
        }
      ]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAgent1Step = async (step: 'agent1_step2' | 'agent1_step3', msg: any) => {
    setIsAnalyzing(true);
    try {
      const bodyData: any = {
        agentType: step,
        extractedYaml: msg.agentResult?.extractedYaml || msg.extractedYaml,
        bucketMapping: msg.agentResult?.bucketMapping ? JSON.stringify(msg.agentResult.bucketMapping) : msg.bucketMapping ? JSON.stringify(msg.bucketMapping) : undefined,
        message: "Continue processing",
        engine: selectedModelId
      };

      // To grab yaml and mapping correctly from previous messages
      if (!bodyData.extractedYaml) {
         const yamlMsg = [...messages].reverse().find(m => m.agentResult?.extractedYaml || m.extractedYaml);
         bodyData.extractedYaml = yamlMsg?.agentResult?.extractedYaml || yamlMsg?.extractedYaml;
      }
      if (step === 'agent1_step3' && !bodyData.bucketMapping) {
         const mapMsg = [...messages].reverse().find(m => m.agentResult?.bucketMapping || m.bucketMapping);
         bodyData.bucketMapping = JSON.stringify(mapMsg?.agentResult?.bucketMapping || mapMsg?.bucketMapping);
      }

      let prevTotalMarkers = msg.agentResult?.estimatedTotalMarkers;
      if (prevTotalMarkers === undefined) {
         const oldMsg = [...messages].reverse().find(m => m.agentResult?.estimatedTotalMarkers !== undefined);
         prevTotalMarkers = oldMsg?.agentResult?.estimatedTotalMarkers;
      }

      const displayPayload = { ...bodyData };
      setLastSentPayload(displayPayload);

      const response = await fetch('/api/gemini/medical-analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyData)
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Server returned ${response.status}: ${errText}`);
      }

      const resData = await response.json();
      
      const assistantMsg: ChatMessage & { agentTypeStep?: string } = {
        id: `msg_agent1_${step}_${Date.now()}`,
        role: 'assistant',
        content: resData.text || 'Processing...',
        timestamp: new Date().toISOString(),
        agentType: 'agent1',
        agentResult: {
           ...resData,
           extractedYaml: bodyData.extractedYaml,
           bucketMapping: resData.bucketMapping || (bodyData.bucketMapping ? JSON.parse(bodyData.bucketMapping) : undefined),
           estimatedTotalMarkers: prevTotalMarkers !== undefined ? prevTotalMarkers : resData.estimatedTotalMarkers
        },
        agentTypeStep: step
      };

      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error(err);
      setMessages(prev => [
        ...prev,
        {
          id: `msg_err_${Date.now()}`,
          role: 'assistant',
          content: `Error during processing step: ${err.message}`,
          timestamp: new Date().toISOString(),
          isError: true,
          errorStep: step,
          originalMsg: msg
        }
      ]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDuplicateFoodLog = (log: FoodLog) => {
    if (!onLogFood) return;
    const todayDate = getCurrentDateInTimezone(profile?.timezone);
    
    // Save image reference to the primary log to avoid duplicating raw Base64 data in the database
    let resolvedImageUrl = log.imageUrl;
    let resolvedImageUrls = log.imageUrls;

    if (log.imageUrl) {
      const primaryId = log.imageUrl.startsWith('ref:') ? log.imageUrl.replace('ref:', '') : log.id;
      resolvedImageUrl = `ref:${primaryId}`;
    }
    if (log.imageUrls && log.imageUrls.length > 0) {
      const primaryId = log.imageUrls[0].startsWith('ref:') ? log.imageUrls[0].replace('ref:', '') : log.id;
      resolvedImageUrls = [`ref:${primaryId}`];
    }

    const duplicatedLog: FoodLog = {
      ...log,
      id: `food_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      date: todayDate,
      imageUrl: resolvedImageUrl,
      imageUrls: resolvedImageUrls
    };
    onLogFood(duplicatedLog);
    setInputText('');
    setMessages(prev => [
      ...prev,
      {
        id: `msg_dup_${Date.now()}`,
        role: 'assistant',
        content: `Successfully duplicated your previously logged **${log.name}** to today (${todayDate})!`,
        timestamp: new Date().toISOString()
      }
    ]);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex flex-col justify-end sm:justify-center p-0 sm:p-4 animation-fade-in font-sans">
      <div id="food-chat-container" className="w-full max-w-md mx-auto bg-white dark:bg-slate-900 rounded-t-[32px] sm:rounded-[32px] h-[90vh] sm:h-[80vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800/80 transition-colors duration-200">
        
        {/* Modal Header */}
        <div className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800/80 px-4 py-3 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/10 flex items-center justify-center text-indigo-600">
              <Sparkles className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-950 dark:text-slate-100 font-display">
                {type === 'food' 
                  ? t.addFood 
                  : type === 'food_idea' 
                    ? 'Food ideas' 
                    : agentType === 'agent1' 
                      ? 'Clinical Data Parser' 
                      : agentType === 'agent2' 
                        ? 'Clinical Ontologist' 
                        : agentType === 'agent3' 
                          ? 'Clinical Data Coordinator' 
                          : agentType === 'agent4' 
                            ? 'Prognostic Diagnostics Assessment' 
                            : agentType === 'agent5' 
                              ? 'Personalized Reference Ranges' 
                              : agentType === 'agent6' 
                                ? 'Lifestyle Precision Intervention' 
                                : agentType === 'agent7' 
                                  ? 'Medical Literature Consensus' 
                                  : agentType === 'data_review'
                                    ? `${dataReviewBatchIdx === 'custom' ? 'Custom Test Batch' : 'Batch ' + (dataReviewBatchIdx !== null && dataReviewBatchIdx !== undefined ? (dataReviewBatchIdx as number) + 1 : 1)}`
                                    : t.addMedical}
              </h2>
              <button
                type="button"
                onClick={() => setIsEngineSelectorOpen(!isEngineSelectorOpen)}
                className="flex items-center gap-1 text-[10px] font-mono text-indigo-600 dark:text-indigo-400 font-bold hover:text-indigo-700 transition-colors focus:outline-none cursor-pointer"
              >
                <span>{AVAILABLE_LLMS.find(m => m.id === selectedModelId)?.name || selectedModelId}</span>
                <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isEngineSelectorOpen ? 'rotate-180 text-indigo-500' : 'text-slate-400'}`} />
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowFullScreenDebugLogs(true)}
              className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 transition-colors"
              title="View Historical Logs"
            >
              <Terminal className="w-5 h-5" />
            </button>
            <button 
              id="close-food-chat-btn"
              onClick={onClose} 
              className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Expandable Model Selector Dropdown */}
        {isEngineSelectorOpen && (
          <div className="px-4 py-2.5 bg-indigo-50/50 dark:bg-indigo-950/25 border-b border-indigo-100 dark:border-indigo-950/40 animation-slide-down">
            <LLMSelector
              selectedModelId={selectedModelId}
              variant="inline"
              onChangeModelId={(id) => {
                onChangeModelId(id);
                setIsEngineSelectorOpen(false);
              }}
            />
          </div>
        )}

        {/* Session/History Control Bar */}
        <div className="bg-slate-100/60 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800/80 px-4 py-2 flex items-center justify-between text-xs shrink-0 gap-2">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <span className="text-slate-400 dark:text-slate-500 font-medium whitespace-nowrap">Session:</span>
            {isLoadingConversations ? (
              <span className="text-slate-400 dark:text-slate-500 font-mono animate-pulse">Loading...</span>
            ) : (
              <select
                value={activeConversationId}
                onChange={(e) => handleSwitchSession(e.target.value)}
                className="bg-transparent hover:bg-slate-200/50 dark:hover:bg-slate-850/50 border border-slate-200 dark:border-slate-850 rounded px-2 py-0.5 font-semibold text-slate-700 dark:text-slate-200 outline-none cursor-pointer truncate max-w-[200px] flex-1 text-xs"
              >
                {conversationsList.map((conv) => (
                  <option key={conv.id} value={conv.id} className="bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
                    {conv.title || 'Untitled Session'}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={handleNewSession}
              className="p-1 rounded-lg bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 font-semibold flex items-center justify-center transition-colors shadow-sm cursor-pointer border border-indigo-500/10"
              title="Start New Session"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleDeleteSession(activeConversationId)}
              className="p-1 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 font-semibold flex items-center justify-center transition-colors shadow-sm cursor-pointer border border-rose-500/10"
              title="Delete Current Session"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Chat Message Window */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/50 dark:bg-slate-900/20">
          
          {/* Data used by agent inline block */}
          {(type === 'food' || type === 'food_idea' || type === 'medical') && (
            <div className="bg-slate-50 dark:bg-slate-900/55 rounded-xl px-4 py-2.5 mb-4 border border-slate-100 dark:border-slate-800/20">
              <button
                type="button"
                onClick={() => setShowDataUsed(!showDataUsed)}
                className="w-full flex items-center justify-between text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 font-bold cursor-pointer transition-colors"
              >
                <span className="flex items-center gap-1.5 text-sm font-semibold font-sans text-slate-600 dark:text-slate-300">
                  Data used by agent
                </span>
                <div className="flex items-center text-slate-400 dark:text-slate-500">
                  {showDataUsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </div>
              </button>
              
              {showDataUsed && (
                <div className="mt-2.5 pt-2.5 border-t border-slate-200/50 dark:border-slate-800/50 space-y-3.5 text-slate-600 dark:text-slate-300 font-sans leading-normal">
                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        let targetAgent = 'agent1';
                        let targetPrompt = null;
                        if (type === 'food') {
                          targetAgent = 'food';
                          const lastMsgWithStep = [...messages].reverse().find(m => m.agentResult?.agentPrompt);
                          targetPrompt = lastMsgWithStep?.agentResult?.agentPrompt || null;
                        }
                        else if (type === 'food_idea') {
                          targetAgent = 'food_idea';
                          const lastMsgWithStep = [...messages].reverse().find(m => m.pendingFoodIdeas && m.agentResult?.agentPrompt);
                          targetPrompt = lastMsgWithStep?.agentResult?.agentPrompt || null;
                        }
                        else {
                          const lastMsgWithStep = [...messages].reverse().find(m => m.agentTypeStep || m.agentType);
                          targetAgent = lastMsgWithStep?.agentType || agentType || 'agent1';
                          targetPrompt = lastMsgWithStep?.agentResult?.agentPrompt || null;
                        }
                        
                        setActiveInstructionAgentType(targetAgent);
                        setActiveInstructionPrompt(targetPrompt);
                      }}
                      className="flex-1 py-2 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800/30 text-indigo-700 dark:text-indigo-400 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm"
                    >
                      <span>ℹ️ View Instructions</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowFullScreenConv(true)}
                      className="flex-1 py-2 bg-indigo-50 dark:bg-indigo-900/20 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800/30 text-indigo-700 dark:text-indigo-400 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm text-center"
                    >
                      <Terminal className="w-4 h-4 text-indigo-500" />
                      <span>📜 View Log History</span>
                    </button>
                  </div>
                  {/* Profile Stats */}
                  <div className="grid grid-cols-2 gap-2.5 font-size-xs bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30">
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Demographics</span>
                      <span className="font-bold text-slate-700 dark:text-slate-200">{(profile?.age) || 'Unknown'} yo • {profile?.gender || 'Unknown'} • {profile?.ethnicity || 'Unknown'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Body Metrics</span>
                      <span className="font-bold text-slate-700 dark:text-slate-200">{profile?.weight || 'Unknown'} kg • {profile?.height || 'Unknown'} cm (BMI: {profile?.weight && profile?.height ? (Number(profile.weight) / Math.pow(Number(profile.height) / 100, 2)).toFixed(1) : 'Unknown'})</span>
                    </div>
                  </div>
                  
                  {type === 'medical' && (
                    <div className="grid grid-cols-2 gap-2.5 mt-2.5">
                      <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                        <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Items per batch</span>
                        <input 
                            type="number"
                            min="1"
                            max="200"
                            value={numberOfBatches}
                            onChange={(e) => setNumberOfBatches(Math.max(1, Number(e.target.value)))}
                            placeholder="Max items..."
                            className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none"
                        />
                      </div>
                      {dataReviewBatchIdx !== null && (
                        <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                          <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Agent Batch Size</span>
                          <input 
                              type="number"
                              value={localBatchSize}
                              onChange={(e) => setLocalBatchSize(Number(e.target.value))}
                              placeholder="Number of items per batch..."
                              className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {type === 'food_idea' && (
                    <>
                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                          <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Max Budget</span>
                          <input 
                              type="number"
                              value={budget}
                              onChange={(e) => setBudget(e.target.value)}
                              placeholder="Enter budget..."
                              className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none"
                          />
                        </div>
                        <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                          <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Currency</span>
                          <select
                              value={currency}
                              onChange={(e) => setCurrency(e.target.value)}
                              className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none border-none p-0 cursor-pointer"
                          >
                            <option value="IDR" className="bg-slate-100 dark:bg-slate-900">IDR (Rp)</option>
                            <option value="GBP" className="bg-slate-100 dark:bg-slate-900">GBP (£)</option>
                            <option value="USD" className="bg-slate-100 dark:bg-slate-900">USD ($)</option>
                            <option value="EUR" className="bg-slate-100 dark:bg-slate-900">EUR (€)</option>
                            <option value="AUD" className="bg-slate-100 dark:bg-slate-900">AUD ($)</option>
                            <option value="SGD" className="bg-slate-100 dark:bg-slate-900">SGD ($)</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5">
                        <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                          <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Max Distance</span>
                          <select
                              value={maxDistance}
                              onChange={(e) => setMaxDistance(parseFloat(e.target.value) || 3)}
                              className="w-full bg-transparent font-bold text-slate-700 dark:text-slate-200 outline-none border-none p-0 cursor-pointer"
                          >
                            <option value="0.5" className="bg-slate-100 dark:bg-slate-900">0.5 km</option>
                            <option value="1" className="bg-slate-100 dark:bg-slate-900">1 km</option>
                            <option value="2" className="bg-slate-100 dark:bg-slate-900">2 km</option>
                            <option value="3" className="bg-slate-100 dark:bg-slate-900">3 km</option>
                            <option value="5" className="bg-slate-100 dark:bg-slate-900">5 km</option>
                            <option value="7" className="bg-slate-100 dark:bg-slate-900">7 km</option>
                            <option value="10" className="bg-slate-100 dark:bg-slate-900">10 km</option>
                          </select>
                        </div>
                        <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                          <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Location</span>
                          <span className="font-bold text-slate-700 dark:text-slate-200 truncate block mt-0.5">
                            {userLocation ? `📍 ${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)}` : '❌ Not available'}
                          </span>
                        </div>
                      </div>
                      
                      <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                        <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Last 20 Meals</span>
                        <span className="font-bold text-slate-700 dark:text-slate-200 max-h-20 overflow-y-auto block whitespace-pre-wrap">
                          {(foodLogs || []).slice(-20).map(f => f.name).join(', ') || 'No meals logged yet'}
                        </span>
                      </div>
                    </>
                  )}

                  {agentType && (
                    <div className="space-y-2">
                      <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                        <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-0.5">Biomarker History Logs</span>
                        <details className="group cursor-pointer">
                          <summary className="font-bold text-slate-700 dark:text-slate-200 select-none">
                            {biomarkerHistory?.length || 0} historic logs
                          </summary>
                          <div className="mt-2 text-[10px] font-mono text-slate-500 max-h-32 overflow-y-auto pl-2 border-l-2 border-slate-200 dark:border-slate-800">
                            {biomarkerHistory?.map((h, i) => (
                              <div key={i} className="mb-1">{h.date}: {Object.keys(h.biomarkers || {}).length} markers</div>
                            ))}
                          </div>
                        </details>
                      </div>
                      <div className="bg-slate-100/50 dark:bg-slate-950/20 p-2 rounded-xl border border-slate-150 dark:border-slate-800/30 font-size-xs">
                        <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-1.5">Checked Biomarker Values ({biomarkers ? Object.keys(biomarkers).length : 0})</span>
                        {biomarkers && Object.keys(biomarkers).length > 0 ? (
                          <div className="flex flex-wrap gap-1.5 mt-1 max-h-32 overflow-y-auto">
                            {Object.entries(biomarkers || {}).map(([key, value]) => {
                              const def = (profile?.customBiomarkers && profile.customBiomarkers[key]) || biomarkerDefinitions[key] || { name: key, unit: '' };
                              return (
                                <span key={key} className="px-2 py-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded text-[10px] font-mono text-slate-700 dark:text-slate-300">
                                  {def.name}: <strong className="text-indigo-600 dark:text-indigo-400">{value}</strong> <span className="text-slate-400">{def.unit}</span>
                                </span>
                              );
                            })}
                          </div>
                        ) : (
                          <span className="text-slate-450 dark:text-slate-500 italic font-size-xs block mt-1">No biomarker data available.</span>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Warning Biomarkers */}
                  {(type === 'food' || type === 'food_idea') && (
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-1.5">Important Biomarkers Needing Improvement</span>
                      {outOfRangeBiomarkers.length > 0 ? (
                        <div className="space-y-1">
                          {outOfRangeBiomarkers.map(b => (
                            <div key={b.key} className="flex items-center justify-between font-size-xs font-mono bg-rose-50/50 dark:bg-rose-950/10 border border-rose-100 dark:border-rose-950/30 px-2 py-1 rounded-lg">
                              <span className="font-sans font-bold text-slate-700 dark:text-slate-300">{b.name}</span>
                              <span className="text-rose-600 dark:text-rose-450 font-black">
                                {b.value} {b.unit} ({getBiomarkerStatusLabel(b.key, b.status, profile?.customBiomarkers?.[b.key], b.value, profile).toUpperCase()})
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-450 dark:text-slate-500 italic font-size-xs">All active biomarkers are within normal reference ranges.</span>
                      )}
                    </div>
                  )}

                  {/* Remaining Daily Allowances */}
                  {(type === 'food' || type === 'food_idea') && (
                    <div>
                      <span className="text-slate-400 dark:text-slate-500 font-bold block font-size-xs uppercase tracking-wider mb-1.5">Today's Remaining Nutrition Allowance</span>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="text-center bg-slate-100/60 dark:bg-slate-950/30 border border-slate-150 dark:border-slate-800/40 p-2 rounded-lg">
                          <span className="text-slate-400 font-size-xs block uppercase font-bold tracking-wider mb-0.5">Calories</span>
                          <span className="font-mono font-size-xs font-bold text-slate-800 dark:text-slate-200">
                            {remainingAllowance.calories} <span className="font-size-xs text-slate-400">kcal</span>
                          </span>
                          <span className="font-size-xs text-slate-400 dark:text-slate-500 block mt-0.5">/ {remainingAllowance.caloriesTarget} target</span>
                        </div>
                        <div className="text-center bg-slate-100/60 dark:bg-slate-950/30 border border-slate-150 dark:border-slate-800/40 p-2 rounded-lg">
                          <span className="text-slate-400 font-size-xs block uppercase font-bold tracking-wider mb-0.5">Sat. Fat</span>
                          <span className={`font-mono font-size-xs font-bold ${remainingAllowance.saturatedFat === 0 ? 'text-rose-500' : 'text-slate-800 dark:text-slate-200'}`}>
                            {remainingAllowance.saturatedFat.toFixed(1)} <span className="font-size-xs text-slate-400">g</span>
                          </span>
                          <span className="font-size-xs text-slate-400 dark:text-slate-500 block mt-0.5">/ {remainingAllowance.saturatedFatTarget}g max</span>
                        </div>
                        <div className="text-center bg-slate-100/60 dark:bg-slate-950/30 border border-slate-150 dark:border-slate-800/40 p-2 rounded-lg">
                          <span className="text-slate-400 font-size-xs block uppercase font-bold tracking-wider mb-0.5">Sodium</span>
                          <span className={`font-mono font-size-xs font-bold ${remainingAllowance.sodium === 0 ? 'text-rose-500' : 'text-slate-800 dark:text-slate-200'}`}>
                            {remainingAllowance.sodium} <span className="font-size-xs text-slate-400">mg</span>
                          </span>
                          <span className="font-size-xs text-slate-400 dark:text-slate-500 block mt-0.5">/ {remainingAllowance.sodiumTarget}mg max</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Conversation Log History */}
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-slate-100/50 dark:bg-slate-950/20 p-3 mt-3 space-y-2 text-left">
                    <div className="flex items-center justify-between">
                      <span className="text-indigo-650 dark:text-indigo-400 font-bold block text-[10px] uppercase tracking-wider">
                        📡 Real-Time Full Agent Request Payload & Log
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          let logTxt = lastSentPayload ? JSON.stringify(lastSentPayload, null, 2) : messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n');
                          if (type === 'medical') {
                            logTxt = `=== PAYLOAD ===\n` + logTxt;
                          }
                          navigator.clipboard.writeText(logTxt);
                        }}
                        className="px-2 py-0.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 rounded text-[10px] font-bold text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                      >
                        Copy Log
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowFullScreenConv(true)}
                      className="w-full py-2 bg-indigo-600/10 hover:bg-indigo-600/20 border border-indigo-500/20 text-indigo-600 dark:text-indigo-400 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-sm animate-fade-in mb-2"
                    >
                      <span>🔍 View Log</span>
                    </button>

                    <FullScreenLogViewer
                      isOpen={showFullScreenConv}
                      onClose={() => setShowFullScreenConv(false)}
                      title="Full Agent Request Payload & Log"
                      logsText={(() => {
                        const msgLog = messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`).join('\n\n---\n\n');
                        let logTxt = lastSentPayload ? `=== PAYLOAD ===\n${JSON.stringify(lastSentPayload, null, 2)}\n\n=== CONVERSATION ===\n${msgLog}` : msgLog;
                        if (type === 'medical') {
                          logTxt += `\n\n[Medical Profile]\n${JSON.stringify(profile, null, 2)}`;
                        }
                        return logTxt;
                      })()}
                      logsArray={(() => {
                        const arr = messages.map(m => `[${m.role.toUpperCase()}]\n${m.content}`);
                        if (lastSentPayload) {
                          arr.unshift(`=== PAYLOAD ===\n${JSON.stringify(lastSentPayload, null, 2)}`);
                        }
                        if (type === 'medical') {
                          arr.push(`[Medical Profile]\n${JSON.stringify(profile, null, 2)}`);
                        }
                        return arr;
                      })()}
                      onSendToAdmin={handleSendLogToAdmin}
                      isSendingLogs={isSendingLogs}
                      logsSendStatus={logsSendStatus}
                      onClearLogs={() => {
                        setMessages(prev => prev.length > 0 ? [prev[0]] : []);
                        setLastSentPayload(null);
                        sessionStorage.removeItem(payloadStorageKey);
                        sessionStorage.removeItem(chatStorageKey);
                        setShowFullScreenConv(false);
                      }}
                      eventsCount={messages.length}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {(() => {
            const revIdx = [...messages].reverse().findIndex(m => m.id.startsWith('welcome_'));
            const lastWelcomeIndex = revIdx >= 0 ? messages.length - 1 - revIdx : -1;
            const sessionStartIdx = lastWelcomeIndex >= 0 ? lastWelcomeIndex : 0;
            const pastCount = sessionStartIdx;
            const hasPastMessages = pastCount > 0;

            return (
              <>
                {(hasPastMessages || messages.length > 1) && (
                  <div className="flex justify-center items-center gap-2 mb-4 mt-2">
                    {hasPastMessages && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowPastDiscussion(!showPastDiscussion)}
                          className="px-4 py-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 hover:underline flex items-center gap-1.5 cursor-pointer bg-slate-100/50 dark:bg-slate-950/20 rounded-xl border border-slate-200/50 dark:border-slate-800/40"
                        >
                          <MessageSquare className="w-3.5 h-3.5" />
                          <span>
                            {showPastDiscussion ? "Hide past discussion" : `View past discussion (${pastCount})`}
                          </span>
                        </button>
                        {showPastDiscussion && (
                          <button 
                            type="button"
                            onClick={() => {
                              setMessages(messages.slice(sessionStartIdx));
                              setShowPastDiscussion(false);
                            }}
                            className="p-1.5 rounded-xl bg-slate-100/50 dark:bg-slate-950/20 border border-slate-200/50 dark:border-slate-800/40 hover:bg-rose-100 dark:hover:bg-rose-900/30 text-rose-500 hover:text-rose-600 transition-colors"
                            title="Clear past discussion history"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {messages.map((msg, idx) => {
                  const isPast = idx < sessionStartIdx;
                  if (isPast && !showPastDiscussion) return null;

                  const isAss = msg.role === 'assistant';
                  if (isAss) {
                    const currentFormat = messageFormats[msg.id] || 'prose';
                    const hasFormattingOptions = !!(msg.pendingFoodLog || msg.agentResult || msg.pendingFoodIdeas);

                  return (
                <div
                  key={msg.id}
                  className="w-full space-y-2.5 px-1 min-w-0 relative group"
                >
                  {!msg.id.startsWith('welcome_') && (
                    <button
                      type="button"
                      onClick={() => handleDeleteMessagePair(msg.id)}
                      className="absolute right-2 top-0 p-1 text-slate-300 hover:text-rose-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors z-20 cursor-pointer sm:opacity-0 sm:group-hover:opacity-100 opacity-100"
                      title="Delete conversation step"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {/* Multi-Format Rendering Switcher */}
                  {hasFormattingOptions && (
                    <div className="flex items-center gap-1 bg-slate-100/80 dark:bg-slate-800/85 p-1 rounded-xl border border-slate-200/50 dark:border-slate-750/50 w-fit mb-2 text-[10px] font-sans shrink-0">
                      <button
                        type="button"
                        onClick={() => setMessageFormats(prev => ({ ...prev, [msg.id]: 'prose' }))}
                        className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                          currentFormat === 'prose'
                            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        📝 Prose
                      </button>
                      <button
                        type="button"
                        onClick={() => setMessageFormats(prev => ({ ...prev, [msg.id]: 'table' }))}
                        className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                          currentFormat === 'table'
                            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        📊 Table
                      </button>
                      <button
                        type="button"
                        onClick={() => setMessageFormats(prev => ({ ...prev, [msg.id]: 'card' }))}
                        className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                          currentFormat === 'card'
                            ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                            : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                        }`}
                      >
                        📇 Bento Card
                      </button>
                    </div>
                  )}

                  <div className="w-full leading-relaxed font-size-body text-slate-850 dark:text-slate-100 font-medium break-words overflow-x-hidden bg-transparent border-none shadow-none">
                    {currentFormat === 'prose' && (
                      <div className="animation-fade-in">
                        {msg.imageUrls && msg.imageUrls.length > 0 ? (
                          <div className="mb-2 overflow-hidden border-y sm:border border-slate-200 dark:border-slate-700/30 w-[calc(100%+2.5rem)] -mx-5 sm:mx-0 sm:w-full sm:rounded-xl">
                            <ImageSlider images={msg.imageUrls} altText="Attached meal pictures" />
                          </div>
                        ) : msg.imageUrl ? (
                          <div className="mb-2 overflow-hidden border-y sm:border border-slate-200 dark:border-slate-700/30 max-h-40 w-[calc(100%+2.5rem)] -mx-5 sm:mx-0 sm:w-full sm:rounded-xl">
                            <img src={msg.imageUrl} alt="Attached meal" className="w-full h-full object-cover" />
                          </div>
                        ) : null}
                        <p className="whitespace-pre-line break-words">{typeof msg.content === 'object' ? JSON.stringify(msg.content) : msg.content}</p>
                      </div>
                    )}

                    {msg.agentUnavailable && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => {
                            if (onGoToManualEdit) {
                              onGoToManualEdit("The AI agent is not available. Please enter the food details manually.");
                            }
                          }}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md flex items-center gap-1.5"
                        >
                          <Edit2 className="w-4 h-4" />
                          Go to Manual Edit
                        </button>
                      </div>
                    )}
                    
                    {msg.isError && (
                      <div className="mt-3 p-4 bg-amber-500/5 dark:bg-amber-500/10 border border-amber-500/20 rounded-2xl space-y-3">
                        <div className="flex items-start gap-2">
                          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <h5 className="text-xs font-bold text-amber-700 dark:text-amber-400">
                              Service Unavailable
                            </h5>
                            <p className="text-[11px] text-slate-600 dark:text-slate-400 font-medium leading-relaxed font-sans">
                              The AI Service is currently experiencing transient spikes in demand. You can seamlessly bypass this error and proceed to the next agent.
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex flex-col sm:flex-row gap-2 font-sans">
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                            }}
                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                          >
                            <ShieldAlert className="w-3.5 h-3.5" />
                            Skip to Next Agent
                          </button>
                        </div>
                      </div>
                    )}
                    {msg.id.startsWith('welcome_') && type === 'food_idea' && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => handleSend('Surprise me')}
                          disabled={isAnalyzing}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md flex items-center gap-1.5"
                        >
                          Surprise Me
                        </button>
                      </div>
                    )}
                    {msg.id.startsWith('welcome_') && type === 'daily_recommendation' && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => handleSend("What's up today?")}
                          disabled={isAnalyzing}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md flex items-center gap-1.5"
                        >
                          What's up today?
                        </button>
                      </div>
                    )}
                    {msg.id.startsWith('welcome_') && agentType && (
                      <div className="mt-3">
                        <button
                          type="button"
                          onClick={() => handleSend(autoSendMessage || 'Start')}
                          disabled={isAnalyzing}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-md flex items-center gap-1.5"
                        >
                          {autoSendMessage ? (autoSendMessage.toLowerCase().includes('calibrate') ? 'Start Calibration' : 'Start Review') : "Let's start"}
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Render extracted Pending Food Log block if assistant has finished parsing */}
                  {/* Render extracted Pending Food Log info */}
                  {type === 'food_idea' && msg.pendingFoodIdeas && (
                    <InteractivePlacesMap
                      ideas={msg.pendingFoodIdeas}
                      onSaveSelected={(selectedIdeas) => {
                        if (onLogFoodIdeas) {
                          onLogFoodIdeas(selectedIdeas);
                          setLoggedMessageIds(prev => [...prev, msg.id]);
                        }
                      }}
                      isLogged={loggedMessageIds.includes(msg.id)}
                    />
                  )}

                  {type === 'food' && msg.agentResult && msg.agentResult.mode === 'evaluation' && msg.agentResult.comparison && currentFormat === 'card' && (
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-md space-y-3 animation-fade-in w-full max-w-full min-w-0 overflow-hidden">
                      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/50 pb-2 gap-2">
                        <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate min-w-0 flex items-center gap-1.5">
                          ⚖️ Comparison: <span className="text-indigo-600 dark:text-indigo-400 font-bold">{msg.agentResult.comparison.keyNutrientConcern || 'Nutrients of Concern'}</span>
                        </h4>
                      </div>

                      {/* Foods Comparison Cards */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                        {(msg.agentResult.comparison.foods || []).map((food: any, idx: number) => {
                          const suitabilityColors: any = {
                            good: "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-100 dark:border-emerald-900/40",
                            moderate: "bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-100 dark:border-amber-900/40",
                            bad: "bg-rose-50 dark:bg-rose-950/20 text-rose-700 dark:text-rose-400 border-rose-100 dark:border-rose-900/40",
                          };
                          const suitabilityClass = suitabilityColors[food.suitability] || "bg-slate-50 dark:bg-slate-900 text-slate-700 border-slate-100";

                          return (
                            <div key={idx} className="border border-slate-200 dark:border-slate-700/30 rounded-xl p-3 bg-slate-50/50 dark:bg-slate-900/30 space-y-2 flex flex-col justify-between">
                              <div className="space-y-1.5">
                                <div className="flex items-center justify-between gap-1.5 border-b border-slate-100 dark:border-slate-800/50 pb-1.5">
                                  <span className="font-bold text-xs text-slate-800 dark:text-slate-200 truncate">{food.name}</span>
                                  <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded font-mono text-slate-600 dark:text-slate-400 font-bold">{food.weightGrams}g</span>
                                </div>
                                <div className="text-[11px] space-y-1 text-slate-600 dark:text-slate-400 font-semibold">
                                  <div className="flex justify-between">
                                    <span>Calories:</span>
                                    <span className="font-mono text-slate-900 dark:text-slate-200">{food.calories} kcal</span>
                                  </div>
                                  {food.saturatedFat !== undefined && (
                                    <div className="flex justify-between">
                                      <span>Saturated Fat:</span>
                                      <span className="font-mono text-slate-900 dark:text-slate-200">{food.saturatedFat}g</span>
                                    </div>
                                  )}
                                  {food.sodium !== undefined && (
                                    <div className="flex justify-between">
                                      <span>Sodium:</span>
                                      <span className="font-mono text-slate-900 dark:text-slate-200">{food.sodium}mg</span>
                                    </div>
                                  )}
                                  {food.sugar !== undefined && (
                                    <div className="flex justify-between">
                                      <span>Sugar:</span>
                                      <span className="font-mono text-slate-900 dark:text-slate-200">{food.sugar}g</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                              <div className="space-y-1.5 pt-2">
                                <div className={`text-[10px] px-2 py-1 rounded-lg border font-bold text-center ${suitabilityClass}`}>
                                  Suitability: {String(food.suitability).toUpperCase()}
                                </div>
                                {food.pros && (
                                  <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-normal">
                                    <strong className="text-emerald-600 dark:text-emerald-400">✓ Pros:</strong> {food.pros}
                                  </p>
                                )}
                                {food.cons && (
                                  <p className="text-[10px] text-slate-600 dark:text-slate-400 leading-normal">
                                    <strong className="text-rose-500 dark:text-rose-400">✗ Cons:</strong> {food.cons}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {type === 'food' && msg.agentResult && msg.agentResult.mode === 'evaluation' && msg.agentResult.comparison && currentFormat === 'table' && (
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-md space-y-3 animation-fade-in w-full max-w-full min-w-0 overflow-hidden">
                      {/* Key Nutrient Comparison Table */}
                      {(msg.agentResult.comparison.comparisonTableYaml || msg.agentResult.comparison.comparisonTableMarkdown) && (
                        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50/30 dark:bg-slate-900/10 mt-2">
                          <div className="px-3 py-1.5 bg-slate-100/70 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              📊 Side-by-Side Comparison Matrix
                            </span>
                          </div>
                          {msg.agentResult.comparison.comparisonTableYaml ? (
                            <div className="p-0 overflow-x-auto">
                              <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                                <thead className="bg-slate-100 dark:bg-slate-800 text-slate-500">
                                  <tr>
                                    {msg.agentResult.comparison.comparisonTableYaml.columns?.map((col: string, idx: number) => (
                                      <th key={idx} className="px-3 py-2 font-semibold whitespace-nowrap">{col}</th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                                  {msg.agentResult.comparison.comparisonTableYaml.rows?.map((row: any, idx: number) => (
                                    <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                      <td className="px-3 py-2 whitespace-nowrap font-medium text-slate-900 dark:text-slate-100">{row.nutrient}</td>
                                      <td className="px-3 py-2 whitespace-nowrap">{row.foodA}</td>
                                      <td className="px-3 py-2 whitespace-nowrap">{row.foodB}</td>
                                      <td className="px-3 py-2 whitespace-nowrap text-amber-600 dark:text-amber-400 font-medium">{row.target}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          ) : (
                            <div className="p-3 text-[11px] overflow-x-auto font-mono text-slate-700 dark:text-slate-300 whitespace-pre leading-relaxed">
                              {msg.agentResult.comparison.comparisonTableMarkdown}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {type === 'food' && msg.pendingFoodLog && currentFormat === 'card' && (
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-md space-y-3 animation-fade-in w-full max-w-full min-w-0 overflow-hidden">
                      {msg.pendingFoodLog.imageUrls && msg.pendingFoodLog.imageUrls.length > 0 && (
                        <div className="overflow-hidden border-y sm:border border-slate-100 dark:border-slate-700/50 shadow-sm mb-3 w-[calc(100%+2rem)] -mx-4 sm:mx-0 sm:w-full sm:rounded-2xl">
                          <ImageSlider images={msg.pendingFoodLog.imageUrls} altText={msg.pendingFoodLog.name || "Pending meal"} />
                        </div>
                      )}
                      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/50 pb-2 gap-2">
                        <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm truncate min-w-0">
                          {msg.pendingFoodLog.name}
                        </h4>
                        <span className="text-xs bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 px-2.5 py-0.5 rounded-full font-bold flex-shrink-0">
                          {msg.pendingFoodLog.weightGrams}g ({msg.pendingFoodLog.quantity})
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs font-medium border-b border-slate-100 dark:border-slate-800/50 pb-2">
                        <span className="text-slate-500">Record Date:</span>
                        <span className="font-mono text-slate-800 dark:text-slate-200">{msg.pendingFoodLog.date}</span>
                      </div>

                      <div className="text-xs space-y-2 text-slate-600 dark:text-slate-300 font-medium">
                        <p><strong>{t.composition}:</strong> {msg.pendingFoodLog.composition}</p>
                        <p className="text-slate-700 dark:text-slate-200"><strong>{t.benefits}:</strong> {msg.pendingFoodLog.benefits}</p>
                        {msg.pendingFoodLog.risks && <p className="text-slate-700 dark:text-slate-200"><strong>{t.risks}:</strong> {msg.pendingFoodLog.risks}</p>}
                        <p><strong>{t.impact}:</strong> {msg.pendingFoodLog.healthImpact}</p>
                      </div>

                      {/* Top Nutrients Badge */}
                      {(() => {
                        const parseTarget = (val: any, fallback: number) => {
                          if (val === null || val === undefined) return fallback;
                          const cleanStr = String(val).replace(/,/g, '');
                          const matches = cleanStr.match(/\d+(\.\d+)?/g);
                          if (!matches || matches.length === 0) return fallback;
                          const parsed = parseFloat(matches[0]);
                          return isNaN(parsed) ? fallback : parsed;
                        };

                        const caloriesTarget = report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.calories, 1700) : 1800;
                        const satFatTarget = report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.saturatedFat, 15) : 15;
                        const sodiumTarget = report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.sodium, 1200) : 1200;

                        const logDate = msg.pendingFoodLog.date;
                        const dayLogs = foodLogs ? foodLogs.filter(f => f.date === logDate) : [];

                        const caloriesConsumedToday = dayLogs.reduce((acc, curr) => acc + (curr.nutrients?.calories || 0), 0);
                        const satFatConsumedToday = dayLogs.reduce((acc, curr) => acc + (curr.nutrients?.saturatedFat || 0), 0);
                        const sodiumConsumedToday = dayLogs.reduce((acc, curr) => acc + (curr.nutrients?.sodium || 0), 0);

                        const caloriesInMeal = (msg.pendingFoodLog.nutrients && msg.pendingFoodLog.nutrients.calories) || 0;
                        const satFatInMeal = (msg.pendingFoodLog.nutrients && msg.pendingFoodLog.nutrients.saturatedFat) || 0;
                        const sodiumInMeal = (msg.pendingFoodLog.nutrients && msg.pendingFoodLog.nutrients.sodium) || 0;

                        return (
                          <div className="flex flex-wrap items-center gap-3 pt-2">
                            <div className="flex items-center gap-1.5">
                              <NutrientPieChart
                                allowance={caloriesTarget}
                                alreadyConsumed={caloriesConsumedToday}
                                mealValue={caloriesInMeal}
                                nutrientKey="calories"
                                size="sm"
                              />
                              <span className="text-[11px] font-extrabold" style={{ color: 'rgb(249, 115, 22)' }}>
                                {caloriesInMeal} kcal
                              </span>
                            </div>

                            {msg.pendingFoodLog.nutrients && msg.pendingFoodLog.nutrients.saturatedFat !== undefined && (
                              <div className="flex items-center gap-1.5">
                                <NutrientPieChart
                                  allowance={satFatTarget}
                                  alreadyConsumed={satFatConsumedToday}
                                  mealValue={satFatInMeal}
                                  nutrientKey="saturatedFat"
                                  size="sm"
                                />
                                <span className="text-[11px] font-bold" style={{ color: 'rgb(234, 179, 8)' }}>
                                  Sat Fat: {satFatInMeal}g
                                </span>
                              </div>
                            )}

                            {msg.pendingFoodLog.nutrients && msg.pendingFoodLog.nutrients.sodium !== undefined && (
                              <div className="flex items-center gap-1.5">
                                <NutrientPieChart
                                  allowance={sodiumTarget}
                                  alreadyConsumed={sodiumConsumedToday}
                                  mealValue={sodiumInMeal}
                                  nutrientKey="sodium"
                                  size="sm"
                                />
                                <span className="text-[11px] font-bold" style={{ color: 'rgb(34, 197, 94)' }}>
                                  Sodium: {sodiumInMeal}mg
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* Log Action Button */}
                      {loggedMessageIds.includes(msg.id) ? (
                        <div className="w-full py-2 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 animation-fade-in">
                          <Check className="w-4 h-4" />
                          Saved to History
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            if (msg.pendingFoodLog && onLogFood) {
                              onLogFood(msg.pendingFoodLog as FoodLog);
                              setLoggedMessageIds(prev => [...prev, msg.id]);
                            }
                          }}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          {t.logThisFood}
                        </button>
                      )}
                    </div>
                  )}

                  {type === 'food' && msg.pendingFoodLog && currentFormat === 'table' && (
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-md space-y-3 animation-fade-in w-full max-w-full min-w-0 overflow-hidden">
                      <div className="border-b border-slate-100 dark:border-slate-800/50 pb-2">
                        <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs tracking-wider uppercase font-display">
                          📊 Nutritional Table Matrix
                        </h4>
                      </div>

                      {/* Individual Items Contribution Breakdown Table */}
                      {msg.pendingFoodLog.itemsBreakdown && Array.isArray(msg.pendingFoodLog.itemsBreakdown) && msg.pendingFoodLog.itemsBreakdown.length > 0 && (
                        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50/30 dark:bg-slate-900/10">
                          <div className="px-3 py-1.5 bg-slate-100/70 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                            <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                              📊 Components Contribution Table
                            </span>
                          </div>
                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-[11px]">
                              <thead>
                                <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-100/30 dark:bg-slate-800/30 text-slate-500 dark:text-slate-400 font-semibold">
                                  <th className="p-2">Item Name</th>
                                  <th className="p-2 text-right">Weight</th>
                                  <th className="p-2 text-right">Calories</th>
                                  <th className="p-2 text-right">Sat Fat</th>
                                  <th className="p-2 text-right">Sodium</th>
                                </tr>
                              </thead>
                              <tbody>
                                {(msg.pendingFoodLog.itemsBreakdown || []).map((item, itemIdx) => (
                                  <tr 
                                    key={itemIdx} 
                                    className="border-b last:border-b-0 border-slate-100 dark:border-slate-800/40 text-slate-700 dark:text-slate-200 font-medium hover:bg-slate-50 dark:hover:bg-slate-850/20 transition-colors"
                                  >
                                    <td className="p-2 font-semibold truncate max-w-[120px]" title={item.name}>
                                      {item.name}
                                    </td>
                                    <td className="p-2 text-right font-mono text-slate-500">
                                      {item.weightGrams}g
                                    </td>
                                    <td className="p-2 text-right font-mono text-amber-600 dark:text-amber-400">
                                      {item.calories} kcal
                                    </td>
                                    <td className="p-2 text-right font-mono text-orange-600 dark:text-orange-400">
                                      {item.saturatedFat}g
                                    </td>
                                    <td className="p-2 text-right font-mono text-teal-600 dark:text-teal-400">
                                      {item.sodium}mg
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {/* Display Nutrients - Spreadsheet Style */}
                      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-slate-50/50 dark:bg-slate-900/30">
                        <div className="px-3 py-1.5 bg-slate-100/70 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800">
                          <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                            📋 Comprehensive Nutrient Values (31 Nutrients)
                          </span>
                        </div>
                        
                        <div className="px-3 py-2 space-y-3 text-[11px] font-mono">
                          {/* Core Nutrients */}
                          <div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 pb-0.5 border-b border-slate-200/50 dark:border-slate-800/50">Core Nutrients (11)</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                              {(() => {
                                const coreKeys = ["calories", "protein", "carbohydrates", "totalFat", "saturatedFat", "transFat", "addedSugar", "sodium", "potassium", "totalFibre", "solubleFibre"];
                                return nutrientDefinitions
                                  .filter(nut => coreKeys.includes(nut.key))
                                  .map((nut) => {
                                    const val = msg.pendingFoodLog?.nutrients?.[nut.key];
                                    return (
                                      <div key={nut.key} className="flex justify-between py-0.5 text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800/30 last:border-b-0 sm:even:border-l sm:even:pl-4">
                                        <span className="text-slate-500">{nut.labels[profile?.language || 'en'] || nut.labels.en}:</span>
                                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                                          {val !== undefined ? `${val} ${nut.unit}` : `--`}
                                        </span>
                                      </div>
                                    );
                                  });
                              })()}
                            </div>
                          </div>

                          {/* Additional Nutrients */}
                          <div>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 pb-0.5 border-b border-slate-200/50 dark:border-slate-800/50">Additional Nutrients (20)</div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                              {(() => {
                                const coreKeys = ["calories", "protein", "carbohydrates", "totalFat", "saturatedFat", "transFat", "addedSugar", "sodium", "potassium", "totalFibre", "solubleFibre"];
                                return nutrientDefinitions
                                  .filter(nut => !coreKeys.includes(nut.key))
                                  .map((nut) => {
                                    const val = msg.pendingFoodLog?.nutrients?.[nut.key];
                                    return (
                                      <div key={nut.key} className="flex justify-between py-0.5 text-slate-600 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800/30 last:border-b-0 sm:even:border-l sm:even:pl-4">
                                        <span className="text-slate-500">{nut.labels[profile?.language || 'en'] || nut.labels.en}:</span>
                                        <span className="font-semibold text-slate-800 dark:text-slate-100">
                                          {val !== undefined ? `${val} ${nut.unit}` : `--`}
                                        </span>
                                      </div>
                                    );
                                  });
                              })()}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Log Action Button */}
                      {loggedMessageIds.includes(msg.id) ? (
                        <div className="w-full py-2 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-900/50 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 animation-fade-in">
                          <Check className="w-4 h-4" />
                          Saved to History
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            if (msg.pendingFoodLog && onLogFood) {
                              onLogFood(msg.pendingFoodLog as FoodLog);
                              setLoggedMessageIds(prev => [...prev, msg.id]);
                            }
                          }}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                        >
                          <Plus className="w-4 h-4" />
                          {t.logThisFood}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Render Agent Result Blocks */}
                  {msg.agentType && msg.agentResult && !loggedMessageIds.includes(msg.id) && currentFormat !== 'prose' && (
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-md space-y-4 animation-fade-in w-full max-w-full min-w-0 overflow-hidden">
                      <div className="flex items-center justify-between gap-1.5 pb-2 border-b border-slate-100 dark:border-slate-800/50">
                        <div className="flex items-center gap-1.5">
                          <Sparkles className="w-4 h-4 text-indigo-600" />
                          <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs tracking-wider uppercase font-display">
                            {msg.agentType === 'agent1' && 'Clinical Data Parser'}
                            {msg.agentType === 'agent2' && 'Clinical Ontologist'}
                            {msg.agentType === 'agent3' && 'Clinical Data Coordinator'}
                            {msg.agentType === 'agent4' && 'Prognostic Diagnostics Assessment'}
                            {msg.agentType === 'agent5' && 'Personalized Reference Ranges'}
                            {msg.agentType === 'agent6' && 'Lifestyle Precision Intervention'}
                            {msg.agentType === 'agent7' && 'Medical Literature Consensus'}
                          </h4>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const resolvedAgentType = msg.agentType;
                            setActiveInstructionAgentType(resolvedAgentType || 'agent1');
                            setActiveInstructionPrompt(msg.agentResult?.agentPrompt || null);
                          }}
                          className="text-[9px] font-mono font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-colors"
                        >
                          View Agent Instruction
                        </button>
                      </div>

                      {/* Content details based on Agent type */}
                      {['agent1', 'agent2', 'agent3', 'agent4', 'data_review'].includes(msg.agentType || '') && msg.agentResult && (currentFormat === 'table' || currentFormat === 'card') && (
                        <ErrorBoundary>
                        <AgentResultTable
                          agentType={
                            msg.agentTypeStep === 'agent1_step2' ? 'agent2' :
                            msg.agentTypeStep === 'agent1_step3' ? 'agent3' :
                            msg.agentType as 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'data_review'
                          }
                          agentResult={msg.agentResult}
                          profile={profile}
                          biomarkerHistory={biomarkerHistory || []}
                          initialRawText={(() => {
                            const precedingUserMsg = messages
                              .slice(0, idx)
                              .reverse()
                              .find(m => m.role === 'user');
                            return precedingUserMsg?.content || '';
                          })()}
                          precedingAgent1Result={(() => {
                            const precedingStep1Msg = messages
                              .slice(0, idx)
                              .reverse()
                              .find(m => m.agentTypeStep === 'agent1_step1' || m.agentType === 'agent1');
                            return precedingStep1Msg?.agentResult;
                          })()}
                          onContinueToNextStep={
                            (msg.agentResult?.hasMoreMarkers || msg.agentResult?.hasMore || msg.agentResult?.needsContinuation || msg.agentResult?.status === 'needs_continuation') ? undefined :
                            msg.agentTypeStep === 'agent1_step1' ? async () => { await handleAgent1Step('agent1_step2', msg); } :
                            msg.agentTypeStep === 'agent1_step2' ? async () => { await handleAgent1Step('agent1_step3', msg); } :
                            undefined
                          }
                          onApplyChanges={async (filteredKeys) => {
                            if (onAgentFinish) {
                              const isContinuation = !!(msg.agentResult?.hasMoreMarkers || msg.agentResult?.hasMore || msg.agentResult?.needsContinuation || msg.agentResult?.status === 'needs_continuation');
                              if (filteredKeys && Array.isArray(filteredKeys) && msg.agentResult) {
                                msg.agentResult.unselectedRowKeys = filteredKeys;
                              }
                              if (isContinuation) {
                                await handleContinueExtractionChunk(msg);
                              } else {
                                await onAgentFinish(msg.agentType!, msg.agentResult);
                                setLoggedMessageIds(prev => [...prev, msg.id]);
                              }
                            }
                          }}
                          onSendMessage={handleSend}
                        />
                        </ErrorBoundary>
                      )}

                      {msg.agentType === 'agent5' && msg.agentResult && (currentFormat === 'card' || currentFormat === 'table') && (
                        <div className="space-y-2">
                          <Agent5View rawResult={msg.agentResult} />
                        </div>
                      )}

                      {msg.agentType === 'agent6' && msg.agentResult && (currentFormat === 'card' || currentFormat === 'table') && (
                        <div className="space-y-2">
                          <Agent6View rawResult={msg.agentResult} />
                        </div>
                      )}

                      {msg.agentType === 'agent7' && msg.agentResult && (currentFormat === 'card' || currentFormat === 'table') && (
                        <div className="space-y-2">
                          <Agent7View rawResult={msg.agentResult} />
                        </div>
                      )}

                      {/* Confirm Button */}
                      {msg.agentResult && msg.agentType && !['agent1', 'agent2', 'agent3', 'agent4', 'data_review'].includes(msg.agentType || '') && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (onAgentFinish) {
                              await onAgentFinish(msg.agentType!, msg.agentResult);
                                setLoggedMessageIds(prev => [...prev, msg.id]);
                            }
                          }}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer mt-3"
                        >
                          <Check className="w-4 h-4" />
                          Apply & Save Agent Findings
                        </button>
                      )}
                    </div>
                  )}

                  {/* Render extracted Pending Medical info */}
                  {type === 'medical' && !loggedMessageIds.includes(msg.id) && (((msg.pendingBiomarkerEntries && Array.isArray(msg.pendingBiomarkerEntries) && msg.pendingBiomarkerEntries.length > 0) || (msg.pendingBiomarkers && typeof msg.pendingBiomarkers === 'object' && Object.keys(msg.pendingBiomarkers).length > 0)) || (msg.pendingProfile && typeof msg.pendingProfile === 'object' && Object.keys(msg.pendingProfile).length > 0) || (msg.mode === 'modify' && msg.modificationCommand && Array.isArray(msg.modificationCommand) && msg.modificationCommand.length > 0)) && (
                    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-md space-y-3 animation-fade-in w-full max-w-full min-w-0 overflow-hidden">
                      <div className="border-b border-slate-100 dark:border-slate-800/50 pb-2">
                        <h4 className="font-bold text-slate-900 dark:text-slate-100 text-xs tracking-wider uppercase font-display">
                          {msg.mode === 'modify' ? 'Proposed Modifications' : 'Extracted Information'}
                        </h4>
                      </div>

                      <div className="space-y-4">
                        {msg.mode === 'modify' && msg.modificationCommand && Array.isArray(msg.modificationCommand) && msg.modificationCommand.length > 0 ? (
                          <div className="space-y-1">
                            {msg.modificationCommand.map((cmd, idx) => (
                              <div key={idx} className="flex items-center justify-between py-1 border-b border-slate-50 dark:border-slate-800/20 text-xs px-2">
                                <span className="text-slate-600 dark:text-slate-400 font-medium">
                                  {cmd.action === 'remove_biomarker' ? 'Remove' : 'Update'} {cmd.keyName} {cmd.date ? `(${cmd.date})` : ''}
                                </span>
                                <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                  {cmd.action === 'remove_biomarker' ? 'DELETED' : (typeof cmd.newValue === 'object' ? JSON.stringify(cmd.newValue) : String(cmd.newValue))}
                                </span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <>
                            {msg.pendingProfile && Object.entries(msg.pendingProfile).filter(([k, v]) => typeof v !== 'object' && k !== 'customBiomarkers').length > 0 && (
                              <div className="space-y-1">
                                <h5 className="text-[10px] uppercase font-bold text-slate-500 mb-1">Profile Updates</h5>
                                {Object.entries(msg.pendingProfile)
                                  .filter(([key, val]) => typeof val !== 'object' && key !== 'customBiomarkers')
                                  .map(([key, val]) => (
                                  <div key={key} className="flex items-center justify-between py-1 border-b border-slate-50 dark:border-slate-800/20 text-xs">
                                    <span className="text-slate-600 dark:text-slate-400 font-medium capitalize">
                                      {key}
                                    </span>
                                    <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                      {String(val)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {msg.mode === 'plan' && msg.planningDetails && (
                              <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-xl border border-blue-100 dark:border-blue-800/30">
                                <h5 className="text-[10px] uppercase font-bold text-blue-600 dark:text-blue-400 mb-2">Extraction Plan</h5>
                                <div className="space-y-1.5 text-xs text-blue-800 dark:text-blue-200">
                                  <div className="flex justify-between">
                                    <span>Estimated Metrics:</span>
                                    <span className="font-mono font-bold">{msg.planningDetails.estimatedTotalMetrics || 'Unknown'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Batches Required:</span>
                                    <span className="font-mono font-bold">{msg.planningDetails.batchesRequired || 'Unknown'}</span>
                                  </div>
                                  <div className="flex justify-between">
                                    <span>Max Per Batch:</span>
                                    <span className="font-mono font-bold">{msg.planningDetails.maxMetricsPerBatch}</span>
                                  </div>
                                </div>
                              </div>
                            )}

                            {(msg.pendingBiomarkerEntries && Array.isArray(msg.pendingBiomarkerEntries) && msg.pendingBiomarkerEntries.length > 0) ? (
                              <AgentResultTable
                                agentType="medical_extract"
                                agentResult={msg.pendingBiomarkerEntries}
                                profile={profile}
                                biomarkerHistory={biomarkerHistory}
                                onSendMessage={handleSend}
                                onApplyChanges={async (unselectedKeys) => {
                                  if (onLogMedical) {
                                    const isContinuation = !!(msg.status === 'needs_continuation' || msg.agentResult?.status === 'needs_continuation' || msg.agentResult?.hasMore || msg.agentResult?.hasMoreMarkers || msg.agentResult?.needsContinuation);
                                    
                                    // Filter pendingBiomarkers
                                    const filteredBiomarkers = { ...(msg.pendingBiomarkers || {}) };
                                    if (Array.isArray(unselectedKeys)) {
                                      unselectedKeys.forEach(k => delete filteredBiomarkers[k]);
                                    }

                                    // Filter pendingBiomarkerEntries
                                    let filteredEntries = msg.pendingBiomarkerEntries;
                                    if (Array.isArray(filteredEntries) && Array.isArray(unselectedKeys)) {
                                      filteredEntries = filteredEntries.map((entry: any) => {
                                        const newBiomarkers = { ...(entry.biomarkers || {}) };
                                        unselectedKeys.forEach(k => delete newBiomarkers[k]);
                                        const newTests = (entry.tests || []).filter((t: any) => !unselectedKeys.includes(t.key));
                                        newTests.forEach((t: any) => {
                                          newBiomarkers[t.key] = t.valueNumeric !== null && t.valueNumeric !== undefined ? t.valueNumeric : t.valueString;
                                        });
                                        return { ...entry, biomarkers: newBiomarkers, tests: newTests };
                                      }).filter((entry: any) => Object.keys(entry.biomarkers).length > 0);
                                    }
                                    
                                    onLogMedical(filteredBiomarkers, msg.pendingProfile || {}, msg.pendingDate, filteredEntries, msg.modificationCommand, isContinuation);
                                    setLoggedMessageIds(prev => [...prev, msg.id]);
                                    if (isContinuation) {
                                      handleSend("Proceed with extraction.");
                                    }
                                  }
                                }}
                                onCancel={() => {
                                  setLoggedMessageIds(prev => [...prev, msg.id]);
                                  const isContinuation = !!(msg.status === 'needs_continuation' || msg.agentResult?.status === 'needs_continuation' || msg.agentResult?.hasMore || msg.agentResult?.hasMoreMarkers || msg.agentResult?.needsContinuation);
                                  if (isContinuation) {
                                    handleSend("Cancel extraction.");
                                  }
                                }}
                              />
                            ) : (
                              (msg.pendingBiomarkers && typeof msg.pendingBiomarkers === 'object' && Object.keys(msg.pendingBiomarkers).length > 0 ? [{ date: msg.pendingDate || null, biomarkers: msg.pendingBiomarkers }] : []).map((entry, idx) => (
                                <div key={idx} className="space-y-1">
                                  <div className="flex items-center justify-between py-1 bg-slate-50 dark:bg-slate-800/50 px-2 rounded-md mb-2">
                                    <span className="text-slate-500 dark:text-slate-400 font-bold text-[10px] uppercase">Record Date</span>
                                    <span className="font-mono font-bold text-slate-700 dark:text-slate-300 text-xs">{entry.date || 'Unknown Date'}</span>
                                  </div>
                                  {entry.biomarkers && typeof entry.biomarkers === 'object' && Object.entries(entry.biomarkers).map(([key, val]) => {
                                    const def = biomarkerDefinitions.find(d => d.key === key);
                                    const customDef = msg.pendingProfile?.customBiomarkers?.[key] || profile?.customBiomarkers?.[key];
                                    const name = def?.name || customDef?.name || key;
                                    const unit = def?.unit || customDef?.unit || '';
                                    return (
                                      <div key={key} className="flex items-center justify-between py-1 border-b border-slate-50 dark:border-slate-800/20 text-xs px-2">
                                        <span className="text-slate-600 dark:text-slate-400 font-medium">
                                          {name}
                                        </span>
                                        <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                          {val} {String(val).includes(unit) ? '' : unit}
                                        </span>
                                      </div>
                                    );
                                  })}
                                </div>
                              ))
                            )}
                          </>
                        )}
                      </div>

                      {msg.mode !== 'plan' && msg.mode !== 'discussion' && !(msg.pendingBiomarkerEntries && Array.isArray(msg.pendingBiomarkerEntries) && msg.pendingBiomarkerEntries.length > 0) && (
                        <div className="pt-2 space-y-2">
                          <button
                            onClick={() => {
                              if (onLogMedical) {
                                const isContinuation = !!(msg.status === 'needs_continuation' || msg.agentResult?.status === 'needs_continuation' || msg.agentResult?.hasMore || msg.agentResult?.hasMoreMarkers || msg.agentResult?.needsContinuation);
                                onLogMedical(msg.pendingBiomarkers || {}, msg.pendingProfile || {}, msg.pendingDate, msg.pendingBiomarkerEntries, msg.modificationCommand, isContinuation);
                                setLoggedMessageIds(prev => [...prev, msg.id]);
                                if (isContinuation) {
                                  handleSend("Proceed with extraction.");
                                }
                              }
                            }}
                            className="w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-md shadow-indigo-600/10 flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                          >
                            <Plus className="w-4 h-4" />
                            {msg.mode === 'modify' ? 'Apply modifications' : (!!(msg.status === 'needs_continuation' || msg.agentResult?.status === 'needs_continuation' || msg.agentResult?.hasMore || msg.agentResult?.hasMoreMarkers || msg.agentResult?.needsContinuation)) ? 'Save and continue to next batch' : 'Save extracted data'}
                          </button>
                          
                          <button
                            onClick={() => {
                              setLoggedMessageIds(prev => [...prev, msg.id]);
                              const isContinuation = !!(msg.status === 'needs_continuation' || msg.agentResult?.status === 'needs_continuation' || msg.agentResult?.hasMore || msg.agentResult?.hasMoreMarkers || msg.agentResult?.needsContinuation);
                              if (isContinuation) {
                                handleSend("Cancel extraction.");
                              }
                            }}
                            className="w-full py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800/50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 rounded-xl text-xs font-bold transition-all cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            } else {
              if (msg.content === 'Surprise me') return null;
              return (
                <div
                  key={msg.id}
                  className="flex gap-3 max-w-[85%] w-full min-w-0 ml-auto flex-row-reverse"
                >
                  <div className="space-y-2 flex-1 min-w-0 max-w-full">
                    <div className="relative group rounded-2xl px-3.5 py-2.5 leading-relaxed font-size-body shadow-sm font-medium break-words overflow-x-hidden bg-indigo-600 text-white">
                      <button
                        type="button"
                        onClick={() => handleDeleteMessagePair(msg.id)}
                        className="absolute right-2 top-2 p-1 text-indigo-200 hover:text-white hover:bg-white/10 rounded-lg transition-colors z-20 cursor-pointer opacity-0 group-hover:opacity-100"
                        title="Delete conversation step"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                      {msg.imageUrls && msg.imageUrls.length > 0 ? (
                        <div className="mb-2 overflow-hidden sm:rounded-xl border-y sm:border border-slate-200 dark:border-slate-700/30 w-[calc(100%+1.75rem)] -mx-[0.875rem] sm:mx-0 sm:w-full">
                          <ImageSlider images={msg.imageUrls} altText="Attached meal pictures" />
                        </div>
                      ) : msg.imageUrl ? (
                        <div className="mb-2 overflow-hidden sm:rounded-lg border-y sm:border border-white/10 max-h-40 w-[calc(100%+1.75rem)] -mx-[0.875rem] sm:mx-0 sm:w-full">
                          <img src={msg.imageUrl} alt="Attached meal" className="w-full h-full object-cover" />
                        </div>
                      ) : null}
                      {String(msg.content).includes('Here is the suggestion:\n\n') ? (
                        <div className="whitespace-pre-line break-words text-sm">
                          {String(msg.content).split('Here is the suggestion:\n\n')[0]}
                          Here is the suggestion:
                          <div className="mt-2 mb-2 p-2 bg-indigo-700/30 rounded border border-indigo-400/30 font-mono text-xs overflow-hidden h-10 relative cursor-pointer"
                               onClick={() => {
                                  const jsonStr = String(msg.content).split('Here is the suggestion:\n\n')[1].split('\n\nCould you please')[0];
                                  setFullScreenJson(jsonStr);
                               }}
                          >
                            <span className="text-indigo-200 hover:text-white underline">(previous review)</span>
                          </div>
                          {String(msg.content).split('\n\nCould you please')[1] ? 'Could you please' + String(msg.content).split('\n\nCould you please')[1] : ''}
                        </div>
                      ) : (
                        <p className="whitespace-pre-line break-words">{typeof msg.content === 'object' ? JSON.stringify(msg.content) : msg.content}</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            }
          })}
        </>
      );
    })()}
        {isAnalyzing && (
          <div className="flex gap-3 mr-auto max-w-[85%]">
            <div className="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-400 flex-shrink-0 animate-pulse">
              <Loader className="w-4 h-4 animate-spin text-indigo-600" />
            </div>
            <div className="bg-white dark:bg-slate-800 rounded-2xl px-4 py-3 shadow-sm border border-slate-200 dark:border-slate-800/40">
              <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-2 font-medium">
                {ANALYZING_STEPS[analyzingStepIndex]}
              </p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

        {/* Input Dock */}
        <div className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800/80 p-3 flex flex-col gap-2 shrink-0 relative">
          {matchingPreviousLogs.length > 0 && (
            <div className="absolute bottom-full left-0 right-0 mb-2 mx-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden max-h-48 overflow-y-auto z-50 animate-fade-in font-sans">
              <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-700/50 flex justify-between items-center">
                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">Previous Matches</span>
                <span className="text-[9px] text-slate-400">Click Add to duplicate</span>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {matchingPreviousLogs.map((log) => (
                  <div key={log.id} className="p-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors">
                    <div className="flex items-center gap-2.5 min-w-0">
                      {log.imageUrl || (log.imageUrls && log.imageUrls.length > 0) ? (
                        <img 
                          src={resolveFoodImage(log.imageUrl || log.imageUrls?.[0], foodLogs)} 
                          alt={log.name} 
                          className="w-8 h-8 rounded-lg object-cover border border-slate-100 dark:border-slate-700 shrink-0"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 flex items-center justify-center text-indigo-500 font-bold text-xs shrink-0">
                          {log.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate">{log.name}</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{log.composition || log.quantity}</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDuplicateFoodLog(log)}
                      className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-600 dark:text-indigo-400 rounded-lg text-[10px] font-bold transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      Add
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {isCompressing && (
            <div className="flex items-center gap-2 p-2 bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900 rounded-xl">
              <Loader className="w-3.5 h-3.5 text-indigo-600 animate-spin" />
              <span className="text-[11px] text-indigo-700 dark:text-indigo-400 font-bold">
                Compressing image {compressionProgress.current} of {compressionProgress.total} ({compressionProgress.percent}%) ...
              </span>
            </div>
          )}

          {selectedImages.length > 0 && (
            <div className="flex gap-2 overflow-x-auto py-1 max-w-full">
              {selectedImages.map((imgSrc, idx) => (
                <div key={idx} className="relative w-14 h-14 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 flex-shrink-0 group">
                  <img src={imgSrc} alt="Preview thumbnail" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setSelectedImages(prev => prev.filter((_, i) => i !== idx))}
                    className="absolute top-0 right-0 bg-slate-900/80 hover:bg-rose-600 text-white p-0.5 rounded-bl-lg transition-colors"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}



          <div className="flex items-center gap-2">
            <button
              id="food-chat-photo-btn"
              onClick={() => fileInputRef.current?.click()}
              className="p-3 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 flex-shrink-0"
              title={t.uploadPhoto}
            >
              <Image className="w-5 h-5" />
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageSelect}
              accept="image/*"
              multiple
              className="hidden"
            />

            <button
              id="food-chat-camera-btn"
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="p-3 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 flex-shrink-0"
              title="Take photo from phone camera"
            >
              <Camera className="w-5 h-5" />
            </button>
            <input
              type="file"
              ref={cameraInputRef}
              onChange={handleImageSelect}
              accept="image/*"
              capture="environment"
              className="hidden"
            />

            <input
              id="food-chat-input"
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={t.chatPlaceholder}
              className="flex-1 min-w-0 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/50 rounded-xl px-3.5 py-3 text-sm text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-medium"
            />

            <button
              id="food-chat-send-btn"
              onClick={handleSend}
              className="p-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-md transition-all active:scale-95 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>

      </div>

      {/* Full View Consolidated Log Modal */}
      {activeModalTableRows && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[110] flex items-center justify-center p-4 animation-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[32px] shadow-2xl w-full max-w-5xl h-[80vh] flex flex-col overflow-hidden animate-scale-up">
            
            {/* Modal Header */}
            <div className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800/80 px-6 py-4 flex items-center justify-between shrink-0 font-sans">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/10 flex items-center justify-center text-indigo-600">
                  <Table className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-950 dark:text-slate-100 font-display">
                    {activeModalTitle}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {activeModalTitle.includes('Reference')
                      ? 'Demographically adjusted reference ranges and risk analysis based on age, gender, and ethnicity'
                      : 'Unified view of system-by-system health indicators and 2-year longitudinal insights'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveModalTableRows(null)}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-850 text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-auto p-6 bg-slate-50/35 dark:bg-slate-950/20 font-sans">
              <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-sm">
                {/* min-w-[1200px] ensures the table is twice as wide for easier reading */}
                <table className="min-w-[1200px] w-full divide-y divide-slate-200 dark:divide-slate-800 text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-900/90 font-bold text-slate-500 dark:text-slate-400 sticky top-0 backdrop-blur-sm">
                    <tr>
                      <th className="px-4 py-3 w-[200px]">
                        {activeModalTitle.includes('Reference') ? 'Calibration Domain' : 'System'}
                      </th>
                      <th className="px-4 py-3 w-[180px]">Biomarker</th>
                      <th className="px-4 py-3 w-[120px] text-center">Result</th>
                      <th className="px-4 py-3 w-[100px] text-center">Status</th>
                      <th className="px-4 py-3 min-w-[600px]">
                        {activeModalTitle.includes('Reference') ? 'Profile Calibrated Ranges & Diagnostic Explanations' : '2-Year Trend / Insight (Twice as Wide)'}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150 dark:divide-slate-800/60 bg-white dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-medium">
                    {activeModalTableRows.map((row, idx) => {
                      const stat = row.status.toUpperCase();
                      let badgeStyle = "text-slate-600 bg-slate-50 dark:bg-slate-900 border-slate-150";
                      if (stat === 'CRITICAL') {
                        badgeStyle = "text-rose-600 bg-rose-50 dark:bg-rose-950/40 border-rose-100 dark:border-rose-900/40";
                      } else if (stat === 'WARNING' || stat === 'AMBER' || stat === 'HIGH' || stat === 'LOW') {
                        badgeStyle = "text-amber-600 bg-amber-50 dark:bg-amber-950/40 border-amber-100 dark:border-amber-900/40";
                      } else if (stat === 'NORMAL' || stat === 'OPTIMAL') {
                        badgeStyle = "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900/40";
                      }
                      return (
                        <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/30 transition-colors">
                          <td className="px-4 py-3.5 font-bold text-slate-500 dark:text-slate-400 capitalize">{row.system}</td>
                          <td className="px-4 py-3.5 text-slate-900 dark:text-slate-100 font-bold">{row.biomarker}</td>
                          <td className="px-4 py-3.5 text-center font-mono font-bold text-slate-800 dark:text-slate-200">{row.result}</td>
                          <td className="px-4 py-3.5 text-center">
                            <span className={`inline-block px-2.5 py-1 rounded-md text-[10px] font-bold border ${badgeStyle}`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="px-4 py-3.5 text-slate-650 dark:text-slate-400 leading-relaxed font-medium whitespace-pre-line">
                            {row.insight}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 dark:bg-slate-900/40 border-t border-slate-200 dark:border-slate-800/80 px-6 py-4 flex items-center justify-between shrink-0 font-sans">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Showing {activeModalTableRows.length} biomarker correlations. Tip: Use horizontal scroll on narrow views.
              </span>
              <button
                type="button"
                onClick={() => setActiveModalTableRows(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-sm"
              >
                Close View
              </button>
            </div>

          </div>
        </div>
      )}

      {/* Full Screen JSON Viewer */}
      {fullScreenJson && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-[120] flex items-center justify-center p-4 animation-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-[32px] shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden animate-scale-up">
            
            {/* Modal Header */}
            <div className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-800/80 px-6 py-4 flex items-center justify-between shrink-0 font-sans">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-600/10 flex items-center justify-center text-indigo-600">
                  <Table className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-950 dark:text-slate-100 font-display">
                    Previous Review Data
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    The JSON data provided for context in this conversation step.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setFullScreenJson(null)}
                className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-850 text-slate-400 dark:text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-auto p-6 bg-slate-50/35 dark:bg-slate-950/20 font-sans">
              <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shadow-sm p-4 overflow-auto">
                <pre className="text-xs font-mono text-slate-700 dark:text-slate-300 whitespace-pre-wrap break-words">
                  {fullScreenJson}
                </pre>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 dark:bg-slate-900/40 border-t border-slate-200 dark:border-slate-800/80 px-6 py-4 flex items-center justify-between shrink-0 font-sans">
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Read-only view
              </span>
              <button
                type="button"
                onClick={() => setFullScreenJson(null)}
                className="px-5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-xs font-bold rounded-xl transition-all cursor-pointer shadow-sm"
              >
                Close
              </button>
            </div>

          </div>
        </div>
      )}

      <FullScreenInstructionViewer
        isOpen={activeInstructionAgentType !== null}
        onClose={() => {
          setActiveInstructionAgentType(null);
          setActiveInstructionPrompt(null);
        }}
        agentType={activeInstructionAgentType || ''}
        profile={profile}
        biomarkerHistory={biomarkerHistory}
        agentPrompt={activeInstructionPrompt || undefined}
        outOfRangeBiomarkers={outOfRangeBiomarkers}
        remainingAllowance={remainingAllowance}
        activeMeal={[...messages].reverse().find(m => m.pendingFoodLog)?.pendingFoodLog}
        location={userLocation}
        recentMeals={foodLogs?.slice(-20).map(f => f.name)}
        budget={budget}
        currency={currency}
        maxDistance={maxDistance}
      />
      <FullScreenLogViewer
        isOpen={showFullScreenDebugLogs}
        onClose={() => setShowFullScreenDebugLogs(false)}
        title="AI Agent Diagnostic Log History"
        logsText={debugLogs.map(l => `[${l.timestamp}] ${l.message}`).join('\n')}
        logsArray={debugLogs.map(l => `[${l.timestamp}]\n${l.message}`)}
        onSendToAdmin={handleSendDebugLogsToAdmin}
        isSendingLogs={isDebugSendingLogs}
        logsSendStatus={debugLogsSendStatus}
        onClearLogs={handleClearDebugLogs}
        eventsCount={debugLogs.length}
      />
    </div>
  );
}
