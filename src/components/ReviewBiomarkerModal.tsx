import React, { useState, useRef, useEffect, useMemo } from 'react';
import { ChatMessage, UserProfile, BiomarkerLog } from '../types';
import { translations } from '../utils/translations';
import { X, Send, Sparkles, Loader, ChevronDown, ChevronUp, Terminal } from 'lucide-react';
import { biomarkerDefinitions, getBiomarkerStatus, getBiomarkerColor, getPhysiologicalBucket, getBiomarkerMetadata } from '../utils/biomarkers';
import LLMSelector from './LLMSelector';
import { AVAILABLE_LLMS } from '../utils/llm';
import FullScreenInstructionViewer from './FullScreenInstructionViewer';
import FullScreenLogViewer from './FullScreenLogViewer';

function buildYamlContext(
  biomarkerKey: string,
  currentValue: number | string,
  allDefinitions: any[],
  biomarkerHistory: BiomarkerLog[],
  profile: UserProfile
): string {
  const def = allDefinitions.find(d => d.key === biomarkerKey) || {};
  
  // 1. Gathers demographic metadata
  const age = profile.age || 'unknown';
  const gender = profile.gender || 'unknown';
  const ethnicity = profile.ethnicity || 'unknown';
  const unitPreference = profile.unitPreference || 'SI';
  
  // 2. Selected biomarker details
  const targetMeta = getBiomarkerMetadata(biomarkerKey, profile.customBiomarkers?.[biomarkerKey]);
  const targetCategories = targetMeta.riskCategories || [];
  const targetConditions = targetMeta.potentialMedicalConditions || [];
  const targetGrouping = targetMeta.standardMedicalGrouping || '';
  
  // 3. Get full log history for the selected biomarker
  const sortedLogs = [...(biomarkerHistory || [])].sort((a, b) => b.date.localeCompare(a.date));
  const selectedHistory = sortedLogs
    .filter(log => log.biomarkers && log.biomarkers[biomarkerKey] !== undefined && log.biomarkers[biomarkerKey] !== '')
    .map(log => ({
      date: log.date,
      value: log.biomarkers[biomarkerKey],
      unit: def.unit || ''
    }));

  // 4. Find all related biomarkers grouped by tags
  const targetTags = new Set<string>();
  targetCategories.forEach((c: string) => targetTags.add(c.trim()));
  targetConditions.forEach((c: string) => targetTags.add(c.trim()));
  if (targetGrouping) targetTags.add(targetGrouping.trim());
  if (def.category && def.category.toLowerCase() !== 'other') targetTags.add(def.category.trim());
  
  const relatedBiomarkersByTag: Record<string, any[]> = {};
  
  targetTags.forEach(tag => {
    const tagMatches: any[] = [];
    allDefinitions.forEach(otherDef => {
      if (otherDef.key === biomarkerKey) return;
      
      const otherMeta = getBiomarkerMetadata(otherDef.key, profile.customBiomarkers?.[otherDef.key]);
      
      const otherTags = new Set<string>();
      (otherMeta.riskCategories || []).forEach((c: string) => otherTags.add(c.trim().toLowerCase()));
      (otherMeta.potentialMedicalConditions || []).forEach((c: string) => otherTags.add(c.trim().toLowerCase()));
      if (otherMeta.standardMedicalGrouping) otherTags.add(otherMeta.standardMedicalGrouping.trim().toLowerCase());
      if (otherDef.category && otherDef.category.toLowerCase() !== 'other') otherTags.add(otherDef.category.trim().toLowerCase());
      
      if (otherTags.has(tag.toLowerCase())) {
        // Find latest value in history
        let latestVal: number | string = 'N/A';
        let latestDate = 'N/A';
        for (const log of sortedLogs) {
          if (log.biomarkers && log.biomarkers[otherDef.key] !== undefined && log.biomarkers[otherDef.key] !== '') {
            latestVal = log.biomarkers[otherDef.key];
            latestDate = log.date;
            break;
          }
        }
        
        const customDetail = (profile.customBiomarkers?.[otherDef.key] || {}) as any;
        const medicalInsights = customDetail.specificRiskContext || otherDef.description || otherDef.descriptions?.en || '';
        
        tagMatches.push({
          key: otherDef.key,
          name: otherDef.name,
          latest_value: latestVal,
          unit: otherDef.unit || '',
          latest_date: latestDate,
          medical_insights: medicalInsights
        });
      }
    });
    
    if (tagMatches.length > 0) {
      relatedBiomarkersByTag[tag] = tagMatches;
    }
  });
  
  // Format as clean YAML
  const lines: string[] = [];
  lines.push("user_profile:");
  lines.push(`  age: "${age}"`);
  lines.push(`  gender: "${gender}"`);
  lines.push(`  ethnicity: "${ethnicity}"`);
  lines.push(`  unit_preference: "${unitPreference}"`);
  lines.push("");
  lines.push("target_biomarker:");
  lines.push(`  key: "${biomarkerKey}"`);
  lines.push(`  name: "${def.name || ''}"`);
  lines.push(`  current_value: "${currentValue}"`);
  lines.push(`  unit: "${def.unit || ''}"`);
  lines.push(`  normal_range: "${def.normalRange || ''}"`);
  const cleanDesc = (def.descriptions?.[profile.language] || def.descriptions?.en || '').replace(/"/g, '\\"');
  lines.push(`  description: "${cleanDesc}"`);
  
  const targetCustom = (profile.customBiomarkers?.[biomarkerKey] || {}) as any;
  const targetInsights = (targetCustom.specificRiskContext || '').replace(/"/g, '\\"');
  lines.push(`  medical_insights: "${targetInsights}"`);
  lines.push("");
  lines.push("target_biomarker_history:");
  if (selectedHistory.length === 0) {
    lines.push("  []");
  } else {
    selectedHistory.forEach(h => {
      lines.push("  - date: \"" + h.date + "\"");
      lines.push("    value: \"" + h.value + "\"");
      lines.push("    unit: \"" + h.unit + "\"");
    });
  }
  lines.push("");
  lines.push("related_biomarkers_by_tag:");
  if (Object.keys(relatedBiomarkersByTag).length === 0) {
    lines.push("  {}");
  } else {
    Object.entries(relatedBiomarkersByTag).forEach(([tag, matches]) => {
      lines.push(`  "${tag}":`);
      matches.forEach(rb => {
        lines.push("    - key: \"" + rb.key + "\"");
        lines.push("      name: \"" + rb.name + "\"");
        lines.push("      latest_value: \"" + rb.latest_value + "\"");
        lines.push("      unit: \"" + rb.unit + "\"");
        lines.push("      latest_date: \"" + rb.latest_date + "\"");
        const cleanInsights = (rb.medical_insights || '').replace(/"/g, '\\"').replace(/\n/g, ' ');
        lines.push("      medical_insights: \"" + cleanInsights + "\"");
      });
    });
  }
  
  return lines.join("\n");
}

interface ReviewBiomarkerModalProps {
  profile: UserProfile;
  isOpen: boolean;
  biomarkerKey: string;
  currentValue: number | string;
  onClose: () => void;
  onUpdateBiomarker: (key: string, value: string | number, proposal?: any, fieldsToKeep?: any) => void;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  initialMessages?: ChatMessage[];
  onUpdateMessages?: (msgs: ChatMessage[]) => void;
  biomarkerHistory?: BiomarkerLog[];
}

export default function ReviewBiomarkerModal({ 
  profile, 
  isOpen, 
  biomarkerKey, 
  currentValue, 
  onClose, 
  onUpdateBiomarker,
  selectedModelId,
  onChangeModelId,
  initialMessages,
  onUpdateMessages,
  biomarkerHistory = []
}: ReviewBiomarkerModalProps) {
  const t = translations[profile.language] || translations.en;
  
  const [messages, setMessages] = useState<ChatMessage[]>(() => {
    if (initialMessages && initialMessages.length > 0) {
      return initialMessages;
    }
    return [];
  });
  const [inputText, setInputText] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isEngineSelectorOpen, setIsEngineSelectorOpen] = useState(false);
  const [fieldsToKeep, setFieldsToKeep] = useState({
    description: true,
    range: true,
    value: true,
    unit: true
  });
  
  const toggleField = (field: keyof typeof fieldsToKeep) => {
    setFieldsToKeep(prev => ({ ...prev, [field]: !prev[field] }));
  };
  const [showDataUsed, setShowDataUsed] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [showFullScreenConv, setShowFullScreenConv] = useState(false);
  const [hasLoadedPrevious, setHasLoadedPrevious] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Combine standard definitions and custom definitions
  const allDefinitions = useMemo(() => {
    const combined = biomarkerDefinitions.map(d => ({
      ...d,
      descriptions: { ...d.descriptions }
    }));
    
    if (profile.customBiomarkers) {
      Object.entries(profile.customBiomarkers).forEach(([key, def]) => {
        const existing = combined.find(d => d.key === key);
        if (existing) {
          existing.normalRange = def.normalRange || existing.normalRange;
          existing.unit = def.unit || existing.unit;
          if (def.description) {
            existing.descriptions = { ...existing.descriptions, en: def.description };
          }
          if (def.benefitRisk) {
            (existing as any).benefitRisk = def.benefitRisk;
          }
          if (def.riskCategories) {
            existing.riskCategories = def.riskCategories;
          }
          if (def.potentialMedicalConditions) {
            existing.potentialMedicalConditions = def.potentialMedicalConditions;
          }
          if (def.standardMedicalGrouping) {
            existing.standardMedicalGrouping = def.standardMedicalGrouping;
          }
        } else {
          combined.push({
            key,
            name: def.name || key,
            category: (def as any).category || 'other',
            unit: def.unit || '',
            normalRange: def.normalRange || 'Unknown',
            descriptions: {
              en: def.description || ''
            },
            benefitRisk: def.benefitRisk,
            riskCategories: def.riskCategories,
            potentialMedicalConditions: def.potentialMedicalConditions,
            standardMedicalGrouping: def.standardMedicalGrouping
          } as any);
        }
      });
    }
    return combined;
  }, [profile.customBiomarkers]);

  const def = allDefinitions.find(d => d.key === biomarkerKey);
  const status = getBiomarkerStatus(biomarkerKey, currentValue, def?.normalRange || '', def, profile);
  const descriptionText = def ? (def.descriptions[profile.language] || def.descriptions.en) : '';

  useEffect(() => {
    if (isOpen && def && messages.length === 0) {
      setMessages([
        {
          id: `welcome_${biomarkerKey}`,
          role: 'assistant',
          content: `Let's review your data for **${def.name}**.\n\nCurrent Value: ${currentValue} ${def.unit}\nStatus: ${status}\nNormal Range: ${def.normalRange}\n\nWhat would you like to discuss or correct about this?`,
          timestamp: new Date().toISOString()
        }
      ]);
    }
  }, [isOpen, biomarkerKey, def]);

  // Sync messages back to parent using a safe ref pattern to completely avoid infinite re-render loops
  const onUpdateMessagesRef = useRef(onUpdateMessages);
  useEffect(() => {
    onUpdateMessagesRef.current = onUpdateMessages;
  }, [onUpdateMessages]);

  useEffect(() => {
    if (onUpdateMessagesRef.current && messages.length > 0) {
      onUpdateMessagesRef.current(messages);
    }
  }, [messages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isAnalyzing]);

  if (!isOpen || !def) return null;

  const handleSend = async () => {
    if (!inputText.trim() && !isAnalyzing) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: inputText,
      timestamp: new Date().toISOString()
    };

    setMessages(prev => [...prev, userMsg]);
    setInputText('');
    setIsAnalyzing(true);

    try {
      const historyContext = messages.map(m => ({ role: m.role, content: m.content }));
      
      const yamlContext = buildYamlContext(biomarkerKey, currentValue, allDefinitions, biomarkerHistory, profile);

      const lightweightProfile = {
        age: profile.age,
        gender: profile.gender,
        weight: profile.weight,
        height: profile.height,
        ethnicity: profile.ethnicity,
        unitPreference: profile.unitPreference
      };

      const payload = {
        message: userMsg.content,
        history: historyContext,
        profile: lightweightProfile,
        biomarkerDef: {
          ...def,
          description: descriptionText
        },
        currentValue,
        modelId: selectedModelId,
        yamlContext
      };

      const res = await fetch('/api/gemini/review-biomarker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        let errJson;
        try {
          errJson = await res.json();
        } catch (_) {}
        throw new Error(errJson?.error || `HTTP ${res.status} ${res.statusText}`);
      }
      
      const data = await res.json();
      
      const assistantMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data.reply,
        pendingBiomarkers: data.pendingBiomarkers || (data.proposedValue !== undefined && data.proposedValue !== null ? { [biomarkerKey]: data.proposedValue } : undefined),
        proposal: data.proposal || undefined,
        agentResult: { agentPrompt: data.agentPrompt },
        timestamp: new Date().toISOString()
      };
      
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err: any) {
      console.error(err);
      const errorCode = err.name || "API_ERROR";
      const errorMsg = err.message || "Unknown error occurred during API communication";
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Sorry, there was an error processing your request. Please try again. [Error Code: ${errorCode} - ${errorMsg}]`,
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/40 backdrop-blur-sm sm:p-4 p-0">
      <div className="flex-1 bg-white dark:bg-slate-900 sm:rounded-[32px] rounded-none shadow-2xl flex flex-col overflow-hidden max-w-3xl w-full mx-auto relative border border-slate-200 dark:border-slate-800">
        
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-100 dark:border-slate-800/60 bg-white/50 dark:bg-slate-900/50 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 rounded-xl">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 dark:text-slate-100 leading-tight">Review Biomarker</h3>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="text-[10px] text-slate-500 font-medium">Discussing {def.name}</span>
                <span className="text-[10px] text-slate-300 dark:text-slate-700">•</span>
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
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowFullScreenConv(true)}
              className="p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 transition-colors cursor-pointer"
              title="View Historical Logs"
            >
              <Terminal className="w-5 h-5" />
            </button>
            <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-full transition-colors cursor-pointer">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Expandable Model Selector Dropdown */}
        {isEngineSelectorOpen && (
          <div className="px-4 py-2.5 bg-indigo-50/50 dark:bg-indigo-950/25 border-b border-indigo-100 dark:border-indigo-950/40">
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

        {/* Expandable Data Used by Agent Block */}
        <div className="px-4 py-2 border-b border-slate-100 dark:border-slate-800/60 bg-white dark:bg-slate-900">
          <button
            type="button"
            onClick={() => setShowDataUsed(!showDataUsed)}
            className="w-full flex items-center justify-between text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 font-bold cursor-pointer transition-colors py-1.5"
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold font-sans text-slate-600 dark:text-slate-300">
              Data used by agent
            </span>
            <div className="flex items-center text-slate-400 dark:text-slate-500">
              {showDataUsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </div>
          </button>
          
          {showDataUsed && (
            <div className="mt-2 pt-3 pb-2 border-t border-slate-100 dark:border-slate-800/40 flex flex-wrap gap-x-6 gap-y-2 text-[11px] font-medium text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/30 p-3 rounded-xl">
              <div><strong className="text-slate-800 dark:text-slate-200">Biomarker:</strong> {def.name} ({def.key})</div>
              <div><strong className="text-slate-800 dark:text-slate-200">Current:</strong> {currentValue} {def.unit}</div>
              <div><strong className="text-slate-800 dark:text-slate-200">Range:</strong> {def.normalRange}</div>
              <div><strong className="text-slate-800 dark:text-slate-200">User Profile:</strong> Age {profile.age || 'N/A'} • {profile.gender || 'N/A'} • {(() => {
                if (profile.weight && profile.height) {
                  const heightInMeters = Number(profile.height) / 100;
                  const bmi = Number(profile.weight) / (heightInMeters * heightInMeters);
                  return `BMI: ${bmi.toFixed(1)}`;
                }
                return "BMI: N/A";
              })()} • {profile.ethnicity || 'N/A'}</div>
              <div className="w-full mt-1 pt-1.5 border-t border-slate-150 dark:border-slate-800/40"><strong className="text-slate-800 dark:text-slate-200">Description:</strong> {descriptionText}</div>
              
              <div className="w-full mt-2 pt-2 border-t border-slate-150 dark:border-slate-800/40 flex justify-between items-center">
                <button
                  type="button"
                  onClick={() => setShowInstructions(true)}
                  className="text-[11px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer flex items-center gap-1"
                >
                  <span>ℹ️ View Programmed Agent Instructions &rarr;</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowFullScreenConv(true)}
                  className="text-[11px] text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer flex items-center gap-1.5"
                >
                  <Terminal className="w-3 h-3" />
                  <span>📜 View Log History &rarr;</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {initialMessages && initialMessages.length > 1 && !hasLoadedPrevious && (
            <div className="flex justify-center pb-2 border-b border-slate-100 dark:border-slate-800/40">
              <button 
                type="button"
                onClick={() => {
                  setMessages(prev => {
                    const existingIds = new Set(prev.map(m => m.id));
                    const uniquePrevious = initialMessages.filter(m => !existingIds.has(m.id));
                    return [...uniquePrevious, ...prev].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
                  });
                  setHasLoadedPrevious(true);
                }}
                className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 transition-colors bg-indigo-50 dark:bg-indigo-950/40 px-3 py-1.5 rounded-full cursor-pointer flex items-center gap-1.5"
              >
                <Sparkles className="w-3.5 h-3.5" />
                View previous conversation
              </button>
            </div>
          )}
          {messages.map((msg) => (
            <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`max-w-[85%] rounded-2xl p-3.5 text-sm font-medium leading-relaxed ${
                msg.role === 'user' 
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20 rounded-tr-sm' 
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 rounded-tl-sm'
              }`}>
                <p className="whitespace-pre-line break-words">{msg.content}</p>
              </div>
              
              {/* Detailed Proposal Block */}
              {msg.role === 'assistant' && msg.proposal && (
                <div className="mt-3 bg-indigo-50/70 dark:bg-slate-800/80 border border-indigo-100 dark:border-slate-700/60 rounded-2xl p-4 max-w-[85%] w-full shadow-md animate-fade-in">
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b border-indigo-100/50 dark:border-slate-700/40">
                    <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span className="text-xs font-bold text-indigo-900 dark:text-indigo-200 uppercase tracking-wider">Proposed Correction Details</span>
                  </div>
                  
                  <div className="space-y-2.5 text-xs">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-white/60 dark:bg-slate-900/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold tracking-wide">Biomarker</span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200 text-sm">{msg.proposal.name}</span>
                      </div>
                      <div className="bg-white/60 dark:bg-slate-900/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold tracking-wide">Proposed Value</span>
                        <span className="font-bold text-indigo-600 dark:text-indigo-400 text-sm">{msg.proposal.value} {msg.proposal.metric}</span>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-white/60 dark:bg-slate-900/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold tracking-wide">Metric / Unit</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{msg.proposal.metric}</span>
                      </div>
                      <div className="bg-white/60 dark:bg-slate-900/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold tracking-wide">Healthy Range</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{msg.proposal.range}</span>
                      </div>
                    </div>

                    <div className="bg-white/60 dark:bg-slate-900/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800/40">
                      <span className="text-[10px] text-slate-400 dark:text-slate-500 block uppercase font-bold tracking-wide">Description</span>
                      <p className="text-slate-600 dark:text-slate-300 leading-relaxed mt-0.5">{msg.proposal.description}</p>
                    </div>

                    <div className="bg-indigo-50/40 dark:bg-indigo-950/20 p-3 rounded-xl border border-indigo-100/40 dark:border-indigo-950/30">
                      <span className="text-[10px] text-indigo-600 dark:text-indigo-400 block uppercase font-bold tracking-wide">Profile Benefit & Risk Assessment</span>
                      <p className="text-slate-700 dark:text-slate-200 font-semibold leading-relaxed mt-1 text-[11px]">{msg.proposal.benefitRisk}</p>
                    </div>

                    {msg.proposal.isDuplicate && (
                      <div className="mt-2.5 p-3.5 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-xl flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                          <Terminal className="w-4 h-4 text-amber-500" />
                          <span className="text-xs font-bold text-amber-800 dark:text-amber-400">Duplicate Recognized</span>
                        </div>
                        <p className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed font-semibold">
                          {msg.proposal.duplicateExplanation || `This biomarker is identified as a duplicate of other records in the system. Suggest consolidating.`}
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            const keysToConsolidate = msg.proposal.duplicateSuggestedKeys && msg.proposal.duplicateSuggestedKeys.length > 0
                              ? msg.proposal.duplicateSuggestedKeys
                              : [biomarkerKey];
                            const uniqueKeys = Array.from(new Set([biomarkerKey, ...keysToConsolidate]));
                            
                            localStorage.setItem('consolidation_pending_keys', JSON.stringify(uniqueKeys));
                            localStorage.setItem('consolidation_pending_note', msg.proposal.duplicateExplanation || `Consolidation request for ${biomarkerKey}`);
                            
                            window.dispatchEvent(new CustomEvent('switch-tab', { detail: { tab: 'medical' } }));
                            window.dispatchEvent(new CustomEvent('open-dictionary-consolidation'));
                            onClose();
                          }}
                          className="mt-1 self-start px-3 py-1.5 bg-amber-600 hover:bg-amber-700 dark:bg-amber-700 dark:hover:bg-amber-600 text-white text-[11px] font-bold rounded-lg shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                        >
                          Hand Over to Name Consolidation Agent
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 bg-slate-50 dark:bg-slate-800 rounded-xl p-3 border border-slate-200 dark:border-slate-700">
                    <p className="text-[10px] font-bold text-slate-500 uppercase mb-2">Merge Fields to Keep:</p>
                    <div className="flex flex-wrap gap-3">
                      {['description', 'range', 'value', 'unit'].map(field => (
                         <label key={field} className="flex items-center gap-1.5 cursor-pointer">
                           <input type="checkbox" checked={fieldsToKeep[field as keyof typeof fieldsToKeep]} onChange={() => toggleField(field as keyof typeof fieldsToKeep)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                           <span className="text-[11px] text-slate-700 dark:text-slate-200 capitalize">{field}</span>
                         </label>
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2 justify-end pt-3 border-t border-indigo-100/30 dark:border-slate-700/30">
                    <button
                      onClick={onClose}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => {
                        const textarea = document.querySelector('textarea');
                        if (textarea) {
                          textarea.focus();
                        }
                      }}
                      className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                    >
                      Keep Discussing
                    </button>
                    <button
                      onClick={() => {
                        const valToUse = msg.pendingBiomarkers && msg.pendingBiomarkers[biomarkerKey] !== undefined
                          ? msg.pendingBiomarkers[biomarkerKey]
                          : (msg.proposal?.value !== undefined ? msg.proposal.value : currentValue);
                        if (valToUse !== undefined) {
                          onUpdateBiomarker(biomarkerKey, valToUse, msg.proposal, fieldsToKeep);
                        }
                      }}
                      className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow-sm shadow-indigo-600/10 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
                    >
                      Approve & Replace
                    </button>
                  </div>
                </div>
              )}

              {/* Simple Proposal Block Fallback */}
              {msg.role === 'assistant' && !msg.proposal && msg.pendingBiomarkers && msg.pendingBiomarkers[biomarkerKey] !== undefined && (
                <div className="mt-2 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/30 rounded-xl p-3 max-w-[85%] w-full flex items-center justify-between">
                  <div>
                    <span className="block text-[10px] text-indigo-500 font-bold uppercase tracking-wide">Proposed Update</span>
                    <span className="text-sm font-bold text-indigo-700 dark:text-indigo-300">{msg.pendingBiomarkers[biomarkerKey]} {String(msg.pendingBiomarkers[biomarkerKey]).includes(def.unit) ? '' : def.unit}</span>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        const textarea = document.querySelector('textarea');
                        if (textarea) textarea.focus();
                      }}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-lg transition-colors cursor-pointer"
                    >
                      Keep Discussing
                    </button>
                    <button 
                      onClick={() => {
                        const valToUse = (msg.pendingBiomarkers && msg.pendingBiomarkers[biomarkerKey] !== undefined) 
                          ? msg.pendingBiomarkers[biomarkerKey] 
                          : (msg.proposal?.value !== undefined ? msg.proposal.value : currentValue);
                        onUpdateBiomarker(biomarkerKey, valToUse, msg.proposal);
                        onClose();
                      }}
                      className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 shadow-sm transition-colors cursor-pointer"
                    >
                      Approve
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {isAnalyzing && (
            <div className="flex items-start">
              <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl rounded-tl-sm p-4 text-slate-500 flex items-center gap-2">
                <Loader className="w-4 h-4 animate-spin text-indigo-600" />
                <span className="text-xs font-semibold animate-pulse">Analyzing...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input Box */}
        <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800">
          <div className="relative flex items-center bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-1 shadow-inner focus-within:ring-2 focus-within:ring-indigo-500/20 transition-shadow">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Ask about this biomarker or propose a correction..."
              className="flex-1 bg-transparent px-4 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none resize-none h-10 max-h-32 min-h-10"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              onClick={handleSend}
              disabled={!inputText.trim() || isAnalyzing}
              className="p-2 ml-1 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>

        <FullScreenInstructionViewer
          isOpen={showInstructions}
          onClose={() => setShowInstructions(false)}
          agentType="biomarker_review"
          profile={profile}
          agentPrompt={messages.length > 0 ? messages.slice().reverse().find(m => m.agentResult?.agentPrompt)?.agentResult?.agentPrompt : undefined}
        />

        <FullScreenLogViewer
          isOpen={showFullScreenConv}
          onClose={() => setShowFullScreenConv(false)}
          title="Full Agent Request Payload & Log"
          logsText={(() => {
            const arr = messages.map(m => {
              let text = `[${m.role.toUpperCase()}]\n${m.content}`;
              if (m.agentResult?.agentPrompt) {
                text += `\n\n[Agent Prompt / Request]\n${m.agentResult.agentPrompt}`;
              }
              return text;
            });
            return arr.join('\n\n---\n\n');
          })()}
          logsArray={(() => {
            const arr = messages.map(m => {
              let text = `[${m.role.toUpperCase()}]\n${m.content}`;
              if (m.agentResult?.agentPrompt) {
                text += `\n\n[Agent Prompt / Request]\n${m.agentResult.agentPrompt}`;
              }
              return text;
            });
            return arr;
          })()}
          onClearLogs={() => {
            setMessages(prev => prev.length > 0 ? [prev[0]] : []);
            if (onUpdateMessages) {
              onUpdateMessages(messages.length > 0 ? [messages[0]] : []);
            }
            setShowFullScreenConv(false);
          }}
          eventsCount={messages.length}
        />

      </div>
    </div>
  );
}
