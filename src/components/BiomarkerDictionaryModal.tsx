import React, { useState, useMemo, useRef, useEffect } from 'react';
import { UserProfile, BiomarkerLog } from '../types';
import { biomarkerDefinitions, BIOMARKER_GROUPING_OPTIONS } from '../utils/biomarkers';
import { X, CheckCircle, AlertCircle, Edit2, Loader, Save, ArrowRight, CheckSquare, Square, MessageSquare, Send, ChevronLeft, FileCode } from 'lucide-react';

interface BiomarkerDictionaryModalProps {
  profile: UserProfile;
  biomarkers: { [key: string]: number | string };
  biomarkerHistory: BiomarkerLog[];
  onClose: () => void;
  onUpdateProfile: (updates: Partial<UserProfile>) => void;
  onCombineBiomarkers: (
    targetKey: string,
    targetDef: { name: string; unit: string; normalRange: string; description: string; standardMedicalGrouping?: string; riskCategories?: string[]; benefitRisk?: string },
    mergedLogs: { date: string; value: number | string }[],
    sourceKeysToDelete: string[]
  ) => void;
  onBatchConsolidate?: (mapping: { [key: string]: string }) => void;
}

interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  suggestedMapping?: { [key: string]: string };
}

export default function BiomarkerDictionaryModal({
  profile,
  biomarkers,
  biomarkerHistory,
  onClose,
  onUpdateProfile,
  onCombineBiomarkers,
  onBatchConsolidate
}: BiomarkerDictionaryModalProps) {
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  // Selection states
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  
  // Chat States
  const [isChatMode, setIsChatMode] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Batch paste state
  const [isBatchPasteMode, setIsBatchPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [parsedMapping, setParsedMapping] = useState<{ [key: string]: string } | null>(null);

  const builtInKeys = Object.keys(biomarkerDefinitions);
  const customKeys = Object.keys(profile.customBiomarkers || {});
  
  const allApprovedKeys = useMemo(() => {
    const keys = [...builtInKeys];
    customKeys.forEach(k => {
      if (profile.customBiomarkers?.[k]?.standardMedicalGrouping) {
        keys.push(k);
      }
    });
    return Array.from(new Set(keys));
  }, [builtInKeys, customKeys, profile.customBiomarkers]);

  const toApproveKeys = useMemo(() => {
    return customKeys.filter(k => !profile.customBiomarkers?.[k]?.standardMedicalGrouping);
  }, [customKeys, profile.customBiomarkers]);

  const allAvailableKeys = useMemo(() => {
    return [...toApproveKeys, ...allApprovedKeys];
  }, [toApproveKeys, allApprovedKeys]);

  // Handle single Route Agent logic (legacy, but we can make it start a chat for that single key!)
  const handleRouteBiomarker = (key: string) => {
    setSelectedKeys([key]);
    startChatWithKeys([key]);
  };

  const startChatWithKeys = (keysToRoute: string[]) => {
    if (keysToRoute.length === 0) return;
    setIsChatMode(true);
    
    // Create initial message
    const listString = keysToRoute.map(k => {
      const customDef = profile.customBiomarkers?.[k];
      return `"${customDef?.name || k}" (key: ${k})`;
    }).join(', ');

    const initialMessage: ChatMessage = {
      role: 'model',
      content: `Hello! I am your Clinical Ontology and Database Route Agent. I see we have selected **${keysToRoute.length}** biomarker(s) to route and consolidate:
      
${keysToRoute.map(k => `• **${profile.customBiomarkers?.[k]?.name || k}** (\`${k}\`)`).join('\n')}

I can analyze these, compare them with our database keys, and find standard mappings or define new standard entities. How would you like to proceed? You can ask me questions, or click **"Request Suggestions"** to have me automatically map them for you!`
    };

    setChatMessages([initialMessage]);
  };

  const handleSendChat = async (overridePrompt?: string) => {
    const textToSend = overridePrompt || chatInput;
    if (!textToSend.trim() || isChatLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: textToSend };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const selectedBiomarkerDetails = selectedKeys.map(k => {
        const customDef = profile.customBiomarkers?.[k];
        return {
          key: k,
          name: customDef?.name || k,
          unit: customDef?.unit || '',
          description: customDef?.description || ''
        };
      });

      const nextMessages = [...chatMessages, userMsg].map(m => ({
        role: m.role,
        content: m.content
      }));

      const res = await fetch('/api/gemini/route-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: nextMessages,
          selectedBiomarkers: selectedBiomarkerDetails,
          allApprovedKeys
        })
      });

      if (!res.ok) throw new Error("Failed to chat with route agent");
      const result = await res.json();

      setChatMessages(prev => [...prev, {
        role: 'model',
        content: result.text,
        suggestedMapping: result.suggestedMapping
      }]);
    } catch (e: any) {
      console.error(e);
      setChatMessages(prev => [...prev, {
        role: 'model',
        content: `Error communicating with Route Agent: ${e.message || "Unknown error"}. Please check your connection and try again.`
      }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  // Scroll chat to bottom
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isChatLoading]);

  // Apply a specific suggestion mapping
  const handleApplySuggestedMapping = (mapping: { [key: string]: string }) => {
    if (!onBatchConsolidate) return;
    try {
      onBatchConsolidate(mapping);
      alert("Selected biomarkers successfully consolidated according to Route Agent recommendations!");
      setIsChatMode(false);
      setSelectedKeys([]);
    } catch (e) {
      console.error(e);
      alert("Error applying mapping.");
    }
  };

  // Toggle checkbox helper
  const handleToggleSelect = (key: string) => {
    setSelectedKeys(prev => {
      if (prev.includes(key)) {
        return prev.filter(k => k !== key);
      } else {
        return [...prev, key];
      }
    });
  };

  // Select all helper
  const handleToggleSelectAll = (keysList: string[]) => {
    const allSelected = keysList.every(k => selectedKeys.includes(k));
    if (allSelected) {
      // Unselect all of these
      setSelectedKeys(prev => prev.filter(k => !keysList.includes(k)));
    } else {
      // Select all of these
      setSelectedKeys(prev => Array.from(new Set([...prev, ...keysList])));
    }
  };

  // Validate pasted batch JSON
  const handlePasteChange = (text: string) => {
    setPasteText(text);
    if (!text.trim()) {
      setParsedMapping(null);
      setPasteError(null);
      return;
    }
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null) {
        throw new Error("Pasted content must be a JSON Object.");
      }
      // Check if keys/values are strings
      const keys = Object.keys(parsed);
      if (keys.length === 0) {
        throw new Error("JSON Object is empty.");
      }
      setParsedMapping(parsed);
      setPasteError(null);
    } catch (e: any) {
      setParsedMapping(null);
      setPasteError(e.message || "Invalid JSON format.");
    }
  };

  // Apply batch consolidation
  const handleApplyBatchConsolidate = () => {
    if (!parsedMapping || !onBatchConsolidate) return;
    try {
      onBatchConsolidate(parsedMapping);
      alert("Batch consolidation complete! All matching log entries, notes, and comments have been aggregated.");
      setIsBatchPasteMode(false);
      setPasteText('');
      setParsedMapping(null);
    } catch (e: any) {
      alert("Consolidation failed: " + e.message);
    }
  };

  const handleManualRename = (key: string) => {
    if (!editName.trim()) return;
    const def = profile.customBiomarkers?.[key];
    if (def) {
      onUpdateProfile({
        customBiomarkers: {
          ...profile.customBiomarkers,
          [key]: {
            ...def,
            name: editName.trim()
          }
        }
      });
    }
    setEditMode(null);
  };

  return (
    <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden border border-slate-200 dark:border-slate-800">
        
        {/* MODAL HEADER */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-900">
          <div className="flex items-center gap-3">
            {isChatMode && (
              <button onClick={() => setIsChatMode(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors text-slate-500">
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 font-sans tracking-tight">
                {isChatMode ? "Route Agent Chat" : isBatchPasteMode ? "Batch Consolidation" : "Biomarker Dictionary"}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isChatMode 
                  ? `Discussing standard mappings for ${selectedKeys.length} selected biomarkers` 
                  : isBatchPasteMode 
                    ? "Paste a JSON configuration file to automatically map and aggregate history logs"
                    : "Standardize, route, or batch-consolidate your custom biomarkers"}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-full transition-colors text-slate-500 dark:text-slate-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* CHAT MODE LAYOUT */}
        {isChatMode ? (
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
            {/* Selected Biomarkers Panel */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 p-3 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
              <span className="text-xs font-bold text-slate-500 self-center mr-1">Selected:</span>
              {selectedKeys.map(k => {
                const def = profile.customBiomarkers?.[k];
                return (
                  <span key={k} className="inline-flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-full text-xs font-medium">
                    {def?.name || k}
                    <button onClick={() => handleToggleSelect(k)} className="text-indigo-400 hover:text-indigo-600 font-bold ml-0.5">×</button>
                  </span>
                );
              })}
              {selectedKeys.length === 0 && (
                <span className="text-xs text-amber-500 font-medium">No biomarkers selected. Click back to select some.</span>
              )}
            </div>

            {/* Messages Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {chatMessages.map((msg, index) => (
                <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                    msg.role === 'user' 
                      ? 'bg-indigo-600 text-white rounded-br-none' 
                      : 'bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-none'
                  }`}>
                    <div className="text-xs font-semibold opacity-70 mb-1">
                      {msg.role === 'user' ? 'You' : 'Route Agent'}
                    </div>
                    <div className="text-sm leading-relaxed whitespace-pre-wrap select-text">
                      {msg.content}
                    </div>

                    {/* Render Suggestion Card inside chat thread */}
                    {msg.suggestedMapping && Object.keys(msg.suggestedMapping).length > 0 && (
                      <div className="mt-4 p-3 bg-indigo-50 dark:bg-slate-800/80 border border-indigo-100 dark:border-slate-700 rounded-xl">
                        <div className="text-xs font-bold text-indigo-700 dark:text-indigo-400 flex items-center gap-1 mb-2">
                          <CheckCircle className="w-3.5 h-3.5" />
                          Recommended Database Consolidation:
                        </div>
                        <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                          {Object.entries(msg.suggestedMapping).map(([src, tgt]) => (
                            <div key={src} className="flex items-center justify-between text-xs font-mono py-1 border-b border-indigo-50/50 dark:border-slate-700/50">
                              <span className="text-rose-500 dark:text-rose-400 truncate max-w-[45%]" title={src}>{src}</span>
                              <span className="text-slate-400">→</span>
                              <span className="text-emerald-500 dark:text-emerald-400 truncate max-w-[45%]" title={tgt}>{tgt}</span>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => handleApplySuggestedMapping(msg.suggestedMapping!)}
                          className="mt-3 w-full py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
                        >
                          <CheckSquare className="w-4 h-4" />
                          Confirm & Apply Consolidation
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isChatLoading && (
                <div className="flex justify-start">
                  <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex items-center gap-2 text-slate-500">
                    <Loader className="w-4 h-4 animate-spin text-indigo-500" />
                    <span className="text-xs font-medium">Route Agent is analyzing ontology mappings...</span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input Form */}
            <div className="bg-white dark:bg-slate-900 p-4 border-t border-slate-100 dark:border-slate-800 flex gap-2">
              <button
                onClick={() => handleSendChat("Please analyze the chosen biomarkers, map them to existing master keys if synonyms exist, or propose new standard snake_case keys if missing, and output the recommended mappings in your suggestedMapping JSON block.")}
                disabled={isChatLoading || selectedKeys.length === 0}
                className="px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/30 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800 text-xs font-bold rounded-xl transition-colors shrink-0"
              >
                Request Suggestions
              </button>
              <input
                type="text"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendChat()}
                placeholder="Ask route agent or instruct how you want them mapped..."
                className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-sm outline-none focus:border-indigo-500 dark:focus:border-indigo-500"
              />
              <button
                onClick={() => handleSendChat()}
                disabled={isChatLoading || !chatInput.trim()}
                className="p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        ) : isBatchPasteMode ? (
          /* BATCH CONSOLIDATION MODE LAYOUT */
          <div className="flex-1 p-5 overflow-y-auto space-y-5 bg-slate-50 dark:bg-slate-950">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <FileCode className="w-4 h-4 text-indigo-500" />
                Paste Mapping File (JSON)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Pasting a JSON dictionary of <code>{"\"Source Term\": \"target_snake_case\""}</code> keys will merge all respective logs, notes, and comments seamlessly into the target biomarker, then remove the raw source biomarker definitions.
              </p>
              
              <textarea
                value={pasteText}
                onChange={e => handlePasteChange(e.target.value)}
                rows={10}
                placeholder={`{\n  "HbA1c": "hemoglobin_a1c",\n  "0": "hemoglobin_a1c",\n  "hba1c": "hemoglobin_a1c",\n  "Fasting Glucose": "fasting_glucose"\n}`}
                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl p-3 font-mono text-xs outline-none focus:ring-2 focus:ring-indigo-500/20"
              />

              {pasteError && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-lg text-rose-600 dark:text-rose-400 text-xs font-medium flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" /> {pasteError}
                </div>
              )}

              {parsedMapping && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-100 dark:border-emerald-900/30 rounded-lg text-emerald-700 dark:text-emerald-400 text-xs">
                  <div className="font-bold flex items-center gap-1.5 mb-2">
                    <CheckCircle className="w-4 h-4 text-emerald-500" /> JSON parsed successfully! Found {Object.keys(parsedMapping).length} mappings:
                  </div>
                  <div className="max-h-48 overflow-y-auto pr-1 space-y-1 font-mono text-[11px]">
                    {Object.entries(parsedMapping).slice(0, 10).map(([src, tgt]) => (
                      <div key={src} className="flex justify-between border-b border-emerald-100/30 py-0.5">
                        <span className="truncate max-w-[48%]">{src}</span>
                        <span className="text-emerald-500">→</span>
                        <span className="truncate max-w-[48%]">{tgt}</span>
                      </div>
                    ))}
                    {Object.keys(parsedMapping).length > 10 && (
                      <div className="text-center text-slate-400 font-sans text-[10px] mt-1">
                        ...and {Object.keys(parsedMapping).length - 10} more mappings
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setIsBatchPasteMode(false)}
                className="px-4 py-2 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyBatchConsolidate}
                disabled={!parsedMapping}
                className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50 flex items-center gap-1.5 shadow-sm"
              >
                <CheckCircle className="w-4 h-4" />
                Run Batch Consolidation
              </button>
            </div>
          </div>
        ) : (
          /* STANDARD DICTIONARY LISTS */
          <div className="flex-1 flex flex-col overflow-hidden">
            
            {/* Top Batch and Selection Controls */}
            <div className="bg-slate-50 dark:bg-slate-900/50 p-3 border-b border-slate-100 dark:border-slate-800 flex flex-wrap gap-2 justify-between items-center">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsBatchPasteMode(true)}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1"
                >
                  <FileCode className="w-3.5 h-3.5 text-indigo-500" />
                  Batch Consolidate (Paste JSON)
                </button>
              </div>

              {selectedKeys.length > 0 && (
                <div className="flex items-center gap-2 animation-fade-in">
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{selectedKeys.length} selected</span>
                  <button
                    onClick={() => startChatWithKeys(selectedKeys)}
                    className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Route Selected via Chat
                  </button>
                  <button
                    onClick={() => setSelectedKeys([])}
                    className="px-2 py-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-medium"
                  >
                    Deselect
                  </button>
                </div>
              )}
            </div>

            {/* List Panels scroll container */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-6">
              
              {/* TO BE APPROVED PANEL */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-amber-500" />
                    To Be Approved ({toApproveKeys.length})
                  </h3>
                  {toApproveKeys.length > 0 && (
                    <button 
                      onClick={() => handleToggleSelectAll(toApproveKeys)}
                      className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {toApproveKeys.every(k => selectedKeys.includes(k)) ? "Deselect All" : "Select All"}
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                  These biomarkers were extracted but do not match the standardized dictionary. Check them to route together, or standard-route individually.
                </p>
                {toApproveKeys.length === 0 ? (
                  <div className="text-center p-6 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 text-sm text-slate-500">
                    All biomarkers are approved.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {toApproveKeys.map(key => {
                      const def = profile.customBiomarkers?.[key];
                      const name = def?.name || key;
                      const isSelected = selectedKeys.includes(key);
                      return (
                        <div key={key} className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 border rounded-xl gap-3 transition-colors ${
                          isSelected 
                            ? 'bg-indigo-50/40 dark:bg-indigo-900/10 border-indigo-200 dark:border-indigo-900/30' 
                            : 'bg-amber-50/20 dark:bg-amber-900/5 border-amber-100/60 dark:border-amber-900/20'
                        }`}>
                          <div className="flex items-start gap-2.5">
                            <button 
                              onClick={() => handleToggleSelect(key)}
                              className="p-1 mt-0.5 text-slate-400 hover:text-indigo-600 rounded transition-colors shrink-0"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-indigo-600" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>
                            <div>
                              {editMode === key ? (
                                <input 
                                  type="text" 
                                  className="text-sm font-bold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 outline-none"
                                  value={editName}
                                  onChange={e => setEditName(e.target.value)}
                                  autoFocus
                                />
                              ) : (
                                <div className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                  {name}
                                  <button onClick={() => { setEditMode(key); setEditName(name); }} className="text-slate-400 hover:text-indigo-500"><Edit2 className="w-3 h-3" /></button>
                                </div>
                              )}
                              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 mt-1">{key}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 pl-7 sm:pl-0">
                            {editMode === key && (
                              <button onClick={() => handleManualRename(key)} className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg flex items-center gap-1">
                                <Save className="w-3 h-3" /> Save
                              </button>
                            )}
                            <button 
                              onClick={() => handleRouteBiomarker(key)}
                              disabled={isProcessing === key}
                              className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-indigo-600 dark:text-indigo-400 font-bold text-xs rounded-lg hover:bg-indigo-50 dark:hover:bg-indigo-900/30 transition-colors flex items-center gap-1 shrink-0"
                            >
                              {isProcessing === key ? <Loader className="w-3 h-3 animate-spin" /> : <ArrowRight className="w-3 h-3" />}
                              Route Agent
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* APPROVED DICTIONARY PANEL */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-emerald-500" />
                    Approved Dictionary ({allApprovedKeys.length})
                  </h3>
                  {allApprovedKeys.length > 0 && (
                    <button 
                      onClick={() => handleToggleSelectAll(allApprovedKeys)}
                      className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {allApprovedKeys.every(k => selectedKeys.includes(k)) ? "Deselect All" : "Select All"}
                    </button>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  These standard biomarkers are mapped correctly. You can select them if you want to consolidate multiple approved biomarkers with Route Agent.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {allApprovedKeys.map(key => {
                    const builtIn = biomarkerDefinitions[key as keyof typeof biomarkerDefinitions];
                    const custom = profile.customBiomarkers?.[key];
                    const name = builtIn?.name || custom?.name || key;
                    const isSelected = selectedKeys.includes(key);
                    return (
                      <div 
                        key={key} 
                        onClick={() => handleToggleSelect(key)}
                        className={`p-2.5 border rounded-lg flex items-center gap-2 cursor-pointer transition-colors ${
                          isSelected 
                            ? 'bg-indigo-50/40 dark:bg-indigo-900/10 border-indigo-200 dark:border-indigo-900/30' 
                            : 'border-slate-100 dark:border-slate-850 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="shrink-0 text-slate-400">
                          {isSelected ? (
                            <CheckSquare className="w-3.5 h-3.5 text-indigo-600" />
                          ) : (
                            <Square className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <div className="truncate">
                          <div className="text-xs font-bold text-slate-850 dark:text-slate-200 truncate" title={name}>{name}</div>
                          <div className="text-[9px] font-mono text-slate-400 truncate" title={key}>{key}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
