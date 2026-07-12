import { toYYYYMMDD } from "../utils/dateUtils";
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { UserProfile, BiomarkerLog } from '../types';
import { biomarkerDefinitions, BIOMARKER_GROUPING_OPTIONS, getBiomarkerMetadata } from '../utils/biomarkers';
import { X, CheckCircle, AlertCircle, Edit2, Loader, Save, ArrowRight, CheckSquare, Square, MessageSquare, Send, ChevronLeft, ChevronDown, FileCode, Merge, Copy, Upload, Trash, Paperclip, Calendar, Info, Terminal, BrainCircuit } from 'lucide-react';
import BiomarkerRangeBuilder, { parseNormalRangeStr } from './BiomarkerRangeBuilder';
import CombineBiomarkersModal from './CombineBiomarkersModal';
import LLMSelector from './LLMSelector';
import FullScreenInstructionViewer from './FullScreenInstructionViewer';

interface BiomarkerDictionaryModalProps {
  profile: UserProfile;
  biomarkers: { [key: string]: number | string };
  biomarkerHistory: BiomarkerLog[];
  onClose: () => void;
  onUpdateProfile: (updates: Partial<UserProfile>) => void;
  onBatchCombineBiomarkers?: (combinations: {targetKey: string, targetDef: any, mergedLogs: any[], sourceKeysToDelete: string[]}[]) => Promise<void>;
  onCombineBiomarkers: (
    targetKey: string,
    targetDef: { name: string; unit: string; normalRange: string; description: string; standardMedicalGrouping?: string; riskCategories?: string[]; benefitRisk?: string },
    mergedLogs: { date: string; value: number | string }[],
    sourceKeysToDelete: string[]
  ) => void;
  onBatchConsolidate?: (mapping: { [key: string]: string }) => void;
  onStandardizeUnits?: (updates: { [key: string]: { unit: string; normalRange: string; name: string } }) => Promise<void>;
  initialSearchQuery?: string;
  onLogMedical?: (biomarkers: { [key: string]: number | string }, profileUpdates?: Partial<UserProfile>, date?: string, entries?: any, modificationCommand?: any, skipClose?: boolean) => void;
  onAgentAnalysisSaved?: (agentType: string, agentResult: any) => Promise<void>;
  onDeleteAnalysis?: (id: string) => Promise<void>;
  onDeleteBiomarker?: (key: string) => void;
  onDeleteMultipleBiomarkers?: (keys: string[]) => void;
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

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

const ensureCustomRanges = (
  key: string,
  normalRangeStr: string,
  existingCustomRanges: any[]
): any[] => {
  if (existingCustomRanges && existingCustomRanges.length > 0) {
    return existingCustomRanges;
  }

  // Auto-generate 1 custom override for Asian ethnicity
  let rangeName = 'Chinese Lipid Guidelines';
  let cleanRangeStr = normalRangeStr || '';

  if (normalRangeStr) {
    const parenMatch = normalRangeStr.match(/^(.*?)\s*\(([^)]+)\)$/);
    if (parenMatch) {
      cleanRangeStr = parenMatch[1].trim();
      rangeName = parenMatch[2].trim();
    }
  }

  // Fallbacks if cleanRangeStr is empty or not parsed well
  if (!cleanRangeStr || cleanRangeStr.trim().length === 0) {
    if (key === 'total_cholesterol') {
      rangeName = 'Chinese Lipid Guidelines';
      cleanRangeStr = '< 5.2 mmol/L';
    } else if (key === 'ldl') {
      rangeName = 'Chinese Lipid Guidelines';
      cleanRangeStr = '< 3.4 mmol/L';
    } else if (key === 'hdl') {
      rangeName = 'Chinese Lipid Guidelines';
      cleanRangeStr = '> 1.0 mmol/L';
    } else if (key === 'triglycerides') {
      rangeName = 'Chinese Lipid Guidelines';
      cleanRangeStr = '< 1.7 mmol/L';
    } else if (key === 'hba1c') {
      rangeName = 'Asian Diabetes Association Guidelines';
      cleanRangeStr = '< 5.7%';
    } else if (key === 'fasting_glucose') {
      rangeName = 'Asian Diabetes Association Guidelines';
      cleanRangeStr = '< 5.6 mmol/L';
    } else {
      rangeName = 'Asian Clinical Guidelines';
      cleanRangeStr = normalRangeStr || 'Normal';
    }
  }

  // Parse cleanRangeStr into a RangeConfig
  let type: 'simple' | 'bracket' = 'simple';
  if (cleanRangeStr.includes('-')) {
    type = 'bracket';
  }
  const parsedRangeConfig = parseNormalRangeStr(cleanRangeStr, type);

  return [
    {
      id: 'cr_auto_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      filters: {
        ethnicity: 'asian',
        gender: '',
        minAge: '',
        maxAge: ''
      },
      range: parsedRangeConfig,
      name: rangeName
    }
  ];
};

const DictionaryItem = ({
  approvalReason,
  itemKey,
  builtInDef,
  customDef,
  logsCount,
  isSelected,
  allGroupings,
  allRisks,
  allConditions,
  itemLogs,
  onToggleSelect,
  onSave,
  onRouteAgent,
  onTagClick,
  isProcessing
}: {
  approvalReason?: string;
  itemKey: string;
  builtInDef?: any;
  customDef?: any;
  logsCount: number;
  isSelected: boolean;
  allGroupings: string[];
  allRisks: string[];
  allConditions: string[];
  itemLogs?: any[];
  onToggleSelect: () => void;
  onSave: (updates: any) => void;
  onRouteAgent?: () => void;
  onTagClick?: (tag: string) => void;
  isProcessing?: boolean;
  key?: string | number;
}) => {
  const def = { ...builtInDef, ...customDef };
  const initialName = def.name || itemKey;
  const initialUnit = def.unit || '';
  const initialNormalRange = def.normalRange || '';
  const initialGrouping = def.standardMedicalGrouping || '';
  const initialRisk = def.riskCategories ? def.riskCategories.join(', ') : '';
  const initialConditions = def.potentialMedicalConditions ? def.potentialMedicalConditions.join(', ') : '';
  const displayCustomRanges = customDef?.customRanges || ensureCustomRanges(itemKey, initialNormalRange, []);
  const [isEditing, setIsEditing] = useState(false);
  const [isHistoryExpanded, setIsHistoryExpanded] = useState(false);

  const [editState, setEditState] = useState({
    key: itemKey,
    name: initialName,
    unit: initialUnit,
    normalRange: initialNormalRange,
    rangeConfig: customDef?.rangeConfig,
    customRanges: ensureCustomRanges(itemKey, initialNormalRange, customDef?.customRanges || []),
    standardMedicalGrouping: initialGrouping,
    riskCategories: initialRisk,
    potentialMedicalConditions: initialConditions
  });

  const handleNormalRangeChange = (val: string) => {
    let newRangeConfig = editState.rangeConfig;
    
    const bracketMatch = val.trim().match(/^([\d.]+)\s*-\s*([\d.]+)(?:\s+.*)?$/);
    if (bracketMatch) {
      const min = parseFloat(bracketMatch[1]);
      const max = parseFloat(bracketMatch[2]);
      if (!isNaN(min) && !isNaN(max)) {
        newRangeConfig = {
          type: 'bracket',
          brackets: [
            { min: null, max: min, alias: 'Low', severity: 'At risk' },
            { min: min, max: max, alias: 'Normal', severity: 'Normal' },
            { min: max, max: null, alias: 'Elevated', severity: 'At risk' }
          ]
        };
      }
    } else {
      const lessMatch = val.trim().match(/^(?:<|<=|under|less than|below)\s*([\d.]+)(?:\s+.*)?$/i);
      if (lessMatch) {
        const v = parseFloat(lessMatch[1]);
        if (!isNaN(v)) {
          newRangeConfig = {
            type: 'simple',
            conditions: [
              { operator: '<', value: v, alias: 'Normal', severity: 'Normal' },
              { operator: '>=', value: v, alias: 'Elevated', severity: 'At risk' }
            ]
          };
        }
      } else {
        const greaterMatch = val.trim().match(/^(?:>|>=|over|greater than|above)\s*([\d.]+)(?:\s+.*)?$/i);
        if (greaterMatch) {
          const v = parseFloat(greaterMatch[1]);
          if (!isNaN(v)) {
            newRangeConfig = {
              type: 'simple',
              conditions: [
                { operator: '>', value: v, alias: 'Normal', severity: 'Normal' },
                { operator: '<=', value: v, alias: 'Low', severity: 'At risk' }
              ]
            };
          }
        } else {
          const plainMatch = val.trim().match(/^([\d.]+)(?:\s+.*)?$/);
          if (plainMatch) {
            const v = parseFloat(plainMatch[1]);
            if (!isNaN(v)) {
              newRangeConfig = {
                type: 'simple',
                conditions: [
                  { operator: '<', value: v, alias: 'Normal', severity: 'Normal' },
                  { operator: '>=', value: v, alias: 'Elevated', severity: 'At risk' }
                ]
              };
            }
          }
        }
      }
    }
    
    setEditState({
      ...editState,
      normalRange: val,
      ...(newRangeConfig ? { rangeConfig: newRangeConfig } : {})
    });
  };

  const handleRangeConfigChange = (r: any, c: any) => {
    let newNormalRange = editState.normalRange;
    if (r) {
      if (r.type === 'bracket' && r.brackets && r.brackets.length > 0) {
        const normalBracket = r.brackets.find((b: any) => b.severity === 'Normal');
        if (normalBracket && normalBracket.min !== null && normalBracket.max !== null) {
          newNormalRange = `${normalBracket.min} - ${normalBracket.max}`;
        }
      } else if (r.type === 'simple' && r.conditions && r.conditions.length > 0) {
        const normalCond = r.conditions.find((c: any) => c.severity === 'Normal');
        if (normalCond) {
          newNormalRange = `${normalCond.operator} ${normalCond.value}`;
        }
      }
    }
    setEditState({ ...editState, rangeConfig: r, customRanges: c, normalRange: newNormalRange });
  };
  const handleSave = () => {
    onSave({
      newKey: editState.key !== itemKey ? editState.key : undefined,
      name: editState.name.trim(),
      unit: editState.unit.trim(),
      normalRange: editState.normalRange.trim(),
      rangeConfig: editState.rangeConfig,
      customRanges: editState.customRanges,
      standardMedicalGrouping: editState.standardMedicalGrouping,
      riskCategories: editState.riskCategories.split(',').map((s: string) => s.trim()).filter(Boolean),
      potentialMedicalConditions: editState.potentialMedicalConditions.split(',').map((s: string) => s.trim()).filter(Boolean),
    });
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditState({
      key: itemKey,
      name: initialName,
      unit: initialUnit,
      normalRange: initialNormalRange,
      rangeConfig: customDef?.rangeConfig,
      customRanges: customDef?.customRanges || [],
      standardMedicalGrouping: initialGrouping,
      riskCategories: initialRisk,
      potentialMedicalConditions: initialConditions
    });
    setIsEditing(false);
  };

  return (
    <div className={`flex flex-col p-3 border rounded-xl gap-3 transition-colors ${
      isSelected 
        ? 'bg-indigo-50/40 dark:bg-indigo-900/10 border-indigo-200 dark:border-indigo-900/30' 
        : 'bg-amber-50/20 dark:bg-amber-900/5 border-amber-100/60 dark:border-amber-900/20'
    }`}>
      <div className="flex items-start justify-between relative">
        <div className="flex items-start gap-2.5 flex-1 min-w-0">
          <button 
            onClick={onToggleSelect}
            className="p-1 mt-0.5 text-slate-400 hover:text-indigo-600 rounded transition-colors shrink-0 cursor-pointer"
          >
            {isSelected ? (
              <CheckSquare className="w-4 h-4 text-indigo-600" />
            ) : (
              <Square className="w-4 h-4" />
            )}
          </button>
          
          <div className="flex-1 min-w-0 pr-4">
            {!initialGrouping && !isEditing && (
               <div className="absolute top-0 right-0">
                  <button
                    onClick={() => onSave({ standardMedicalGrouping: 'Other' })}
                    className="px-2 py-1 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-900/20 dark:hover:bg-emerald-900/40 border border-emerald-200 dark:border-emerald-800 rounded-lg text-[10px] font-bold transition-colors shadow-sm"
                  >
                    Quick Approve
                  </button>
               </div>
            )}
            
            {isEditing ? (
              <div className="space-y-3 w-full">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Key (snake_case)</label>
                    <input 
                      type="text" 
                      className="w-full text-sm font-mono text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 outline-none focus:border-indigo-500"
                      value={editState.key}
                      onChange={e => setEditState({...editState, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')})}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Name</label>
                    <input 
                      type="text" 
                      className="w-full text-sm font-bold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 outline-none focus:border-indigo-500"
                      value={editState.name}
                      onChange={e => setEditState({...editState, name: e.target.value})}
                      autoFocus
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Unit</label>
                    
                    {(() => {
                      const standardUnits = ["kg/m2", "mg/dL", "mmol/L", "umol/L", "g/L", "g/dL", "%", "ng/mL", "pg/mL", "ug/dL", "nmol/L", "pmol/L", "U/L", "IU/L"];
                      const isCustom = !standardUnits.includes(editState.unit) && editState.unit !== '';
                      return (
                        <div className="flex flex-col gap-1">
                          <select 
                            className="w-full text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 outline-none focus:border-indigo-500"
                            value={isCustom ? "custom" : editState.unit}
                            onChange={e => {
                              if (e.target.value === "custom") {
                                setEditState({...editState, unit: " "}); // trigger custom input
                              } else {
                                setEditState({...editState, unit: e.target.value});
                              }
                            }}
                          >
                            <option value="">Select unit...</option>
                            {standardUnits.map(u => <option key={u} value={u}>{u}</option>)}
                            <option value="custom">Other (Custom)</option>
                          </select>
                          {isCustom && (
                            <input 
                              type="text" 
                              className="w-full mt-1 text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 outline-none focus:border-indigo-500"
                              value={editState.unit.trim()}
                              onChange={e => setEditState({...editState, unit: e.target.value})}
                              placeholder="Enter custom unit"
                              autoFocus
                            />
                          )}
                        </div>
                      );
                    })()}

                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Normal Range</label>
                    <input 
                      type="text" 
                      className="w-full text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 outline-none focus:border-indigo-500"
                      value={editState.normalRange}
                      onChange={e => handleNormalRangeChange(e.target.value)}
                    />
                  </div>
                </div>

                <div className="mt-3">
                  <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Range Configuration</label>
                  <BiomarkerRangeBuilder
                    rangeConfig={editState.rangeConfig}
                    customRanges={editState.customRanges}
                    normalRangeStr={editState.normalRange}
                    onChange={handleRangeConfigChange}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Medical Grouping</label>
                  <div className="flex gap-2 mb-1">
                    <select
                      className="flex-1 text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 outline-none focus:border-indigo-500"
                      value={allGroupings.includes(editState.standardMedicalGrouping) || !editState.standardMedicalGrouping ? editState.standardMedicalGrouping : 'custom'}
                      onChange={e => {
                        if (e.target.value !== 'custom') setEditState({...editState, standardMedicalGrouping: e.target.value});
                        else setEditState({...editState, standardMedicalGrouping: ''});
                      }}
                    >
                      <option value="">-- None --</option>
                      {allGroupings.map(g => (
                        <option key={g} value={g}>{g}</option>
                      ))}
                      <option value="custom">-- Custom --</option>
                    </select>
                    {(!allGroupings.includes(editState.standardMedicalGrouping) && editState.standardMedicalGrouping !== '') && (
                      <input 
                        type="text"
                        placeholder="Custom grouping"
                        className="flex-1 text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 outline-none focus:border-indigo-500"
                        value={editState.standardMedicalGrouping}
                        onChange={e => setEditState({...editState, standardMedicalGrouping: e.target.value})}
                      />
                    )}
                  </div>
                </div>

                <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Risk Categories</label>
                    <div className="flex flex-wrap gap-1 mb-1">
                      {allRisks.map(r => {
                        const active = editState.riskCategories.includes(r);
                        return (
                          <span 
                            key={r}
                            onClick={() => {
                              const arr = editState.riskCategories.split(',').map(s=>s.trim()).filter(Boolean);
                              if (active) setEditState({...editState, riskCategories: arr.filter(x=>x!==r).join(', ')});
                              else setEditState({...editState, riskCategories: [...arr, r].join(', ')});
                            }}
                            className={`cursor-pointer text-[9px] px-1.5 py-0.5 rounded-full border ${active ? 'bg-indigo-100 border-indigo-300 text-indigo-700 dark:bg-indigo-900/50 dark:border-indigo-700 dark:text-indigo-300' : 'bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'}`}
                          >
                            {r}
                          </span>
                        )
                      })}
                    </div>
                    <input 
                      type="text" 
                      className="w-full text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 outline-none focus:border-indigo-500"
                      value={editState.riskCategories}
                      onChange={e => setEditState({...editState, riskCategories: e.target.value})}
                      placeholder="Custom (comma sep)"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 mb-1 uppercase">Medical Conditions</label>
                    <div className="flex flex-wrap gap-1 mb-1 max-h-16 overflow-y-auto">
                      {allConditions.map(c => {
                        const active = editState.potentialMedicalConditions.includes(c);
                        return (
                          <span 
                            key={c}
                            onClick={() => {
                              const arr = editState.potentialMedicalConditions.split(',').map(s=>s.trim()).filter(Boolean);
                              if (active) setEditState({...editState, potentialMedicalConditions: arr.filter(x=>x!==c).join(', ')});
                              else setEditState({...editState, potentialMedicalConditions: [...arr, c].join(', ')});
                            }}
                            className={`cursor-pointer text-[9px] px-1.5 py-0.5 rounded-full border ${active ? 'bg-indigo-100 border-indigo-300 text-indigo-700 dark:bg-indigo-900/50 dark:border-indigo-700 dark:text-indigo-300' : 'bg-slate-50 border-slate-200 text-slate-500 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'}`}
                          >
                            {c}
                          </span>
                        )
                      })}
                    </div>
                    <input 
                      type="text" 
                      className="w-full text-xs font-medium text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded px-2 py-1 outline-none focus:border-indigo-500"
                      value={editState.potentialMedicalConditions}
                      onChange={e => setEditState({...editState, potentialMedicalConditions: e.target.value})}
                      placeholder="Custom (comma sep)"
                    />
                  </div>

                <div className="flex justify-end gap-2 mt-4">
                  <button 
                    onClick={handleCancel}
                    className="px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-700"
                  >
                    Cancel
                  </button>
                  <button 
                    onClick={handleSave}
                    className="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded hover:bg-indigo-700 flex items-center gap-1"
                  >
                    <Save className="w-3.5 h-3.5" />
                    Save
                  </button>
                </div>
              </div>
            ) : (
              <div>
                <div className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  {initialName}
                  {approvalReason && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 text-[10px] p-2 rounded flex items-start gap-1 mt-1 font-normal">
                      <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                      <span>{approvalReason}</span>
                    </div>
                  )}

                  <button onClick={() => {
                    setEditState({
                      key: itemKey,
                      name: initialName,
                      unit: initialUnit,
                      normalRange: initialNormalRange,
                      rangeConfig: customDef?.rangeConfig || builtInDef?.rangeConfig,
                      customRanges: ensureCustomRanges(itemKey, initialNormalRange, customDef?.customRanges || builtInDef?.customRanges || []),
                      standardMedicalGrouping: initialGrouping,
                      riskCategories: initialRisk,
                      potentialMedicalConditions: initialConditions
                    });
                    setIsEditing(true);
                  }} className="text-slate-400 hover:text-indigo-500 cursor-pointer p-1">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                    Key: {itemKey}
                  </span>
                  {logsCount > 0 && (
                    <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded">
                      {logsCount} log{logsCount !== 1 ? 's' : ''}
                    </span>
                  )}
                  {initialGrouping && (
                    <span 
                      onClick={() => onTagClick && onTagClick(initialGrouping.trim())}
                      className={`text-[10px] font-bold text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded flex items-center gap-1 ${onTagClick ? 'cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700' : ''}`}
                    >
                      <span className="text-[8px] uppercase tracking-wider opacity-70">Medical Practice:</span>
                      {initialGrouping}
                    </span>
                  )}
                </div>
                
                {!initialUnit ? (
                  <div className="mt-2 text-xs text-rose-500 bg-rose-50 dark:bg-rose-950/20 border border-rose-100/50 dark:border-rose-900/35 px-2.5 py-1 rounded-lg w-fit flex items-center gap-1.5 font-extrabold ring-1 ring-rose-500/10">
                    <AlertCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    Missing Unit - Update Required
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Unit:</span> {initialUnit} 
                    {initialNormalRange && <span className="ml-2"><span className="font-semibold text-slate-700 dark:text-slate-300">Range:</span> {initialNormalRange}</span>}
                    {(customDef?.rangeConfig || displayCustomRanges?.length > 0) && (
                      <span className="ml-2 text-[10px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 px-1.5 py-0.5 rounded">
                        Structured Ranges Active
                      </span>
                    )}
                  </div>
                )}

                {/* Demographic Overrides List */}
                {displayCustomRanges && displayCustomRanges.length > 0 && (
                  <div className="mt-2.5 bg-slate-50 dark:bg-slate-900/40 rounded-lg p-2.5 border border-slate-100 dark:border-slate-800/80 space-y-1.5">
                    <div className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider flex items-center gap-1">
                      <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full"></span>
                      Demographic Overrides ({displayCustomRanges.length})
                    </div>
                    <div className="divide-y divide-slate-100 dark:divide-slate-800/40">
                      {displayCustomRanges.map((cr: any, i: number) => {
                        const filterTexts: string[] = [];
                        if (cr.filters?.ethnicity) filterTexts.push(`Ethnicity: ${cr.filters.ethnicity.toUpperCase()}`);
                        if (cr.filters?.gender) filterTexts.push(`Gender: ${cr.filters.gender.toUpperCase()}`);
                        if (cr.filters?.minAge || cr.filters?.maxAge) {
                          filterTexts.push(`Age: ${cr.filters.minAge || '0'}-${cr.filters.maxAge || '∞'}`);
                        }
                        const filterLabel = filterTexts.length > 0 ? `[${filterTexts.join(', ')}]` : '[Global]';
                        
                        // Format range string
                        let rangeStr = '';
                        if (cr.range) {
                          if (cr.range.type === 'bracket') {
                            const normBracket = cr.range.brackets?.find((b: any) => b.severity === 'Normal' || b.alias === 'Normal');
                            if (normBracket) {
                              if (normBracket.min !== null && normBracket.max !== null) rangeStr = `${normBracket.min} - ${normBracket.max}`;
                              else if (normBracket.min !== null) rangeStr = `>= ${normBracket.min}`;
                              else if (normBracket.max !== null) rangeStr = `<= ${normBracket.max}`;
                            }
                          } else if (cr.range.type === 'simple') {
                            const normCond = cr.range.conditions?.find((c: any) => c.severity === 'Normal' || c.alias === 'Normal' || c.alias === 'Healthy');
                            if (normCond) {
                              rangeStr = `${normCond.operator} ${normCond.value}`;
                            }
                          }
                        }
                        if (!rangeStr) {
                          // Fallback to parsed string if range object format is simple
                          if (cr.name === 'Chinese Lipid Guidelines' && itemKey === 'total_cholesterol') rangeStr = '< 5.2';
                          else if (cr.name === 'Chinese Lipid Guidelines' && itemKey === 'ldl') rangeStr = '< 3.4';
                          else if (cr.name === 'Chinese Lipid Guidelines' && itemKey === 'hdl') rangeStr = '> 1.0';
                          else if (cr.name === 'Chinese Lipid Guidelines' && itemKey === 'triglycerides') rangeStr = '< 1.7';
                          else if (cr.name === 'Asian Diabetes Association Guidelines' && itemKey === 'hba1c') rangeStr = '< 5.7';
                          else if (cr.name === 'Asian Diabetes Association Guidelines' && itemKey === 'fasting_glucose') rangeStr = '< 5.6';
                          else rangeStr = initialNormalRange;
                        }
                        
                        return (
                          <div key={i} className="py-1 flex items-center justify-between text-[11px] gap-2 first:pt-0 last:pb-0">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-semibold text-slate-700 dark:text-slate-300">{cr.name}</span>
                              <span className="text-[9px] text-slate-400 dark:text-slate-500 font-mono">{filterLabel}</span>
                            </div>
                            <div className="font-mono text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/20 px-2 py-0.5 rounded border border-indigo-100/30 dark:border-indigo-900/20 font-bold">
                              {rangeStr} {initialUnit}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                
                {(initialRisk || initialConditions) && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {initialRisk && initialRisk.split(',').map((r: string, i: number) => (
                      <span 
                        key={i} 
                        onClick={() => onTagClick && onTagClick(r.trim())}
                        className={`text-[9px] font-bold px-1.5 py-0.5 bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400 rounded-full border border-rose-100 dark:border-rose-900/30 flex items-center gap-1 ${onTagClick ? 'cursor-pointer hover:bg-rose-100 dark:hover:bg-rose-900/40' : ''}`}
                      >
                        <span className="text-[7.5px] uppercase tracking-wider opacity-60">Risk:</span>
                        {r.trim()}
                      </span>
                    ))}
                    {initialConditions && initialConditions.split(',').map((c: string, i: number) => (
                      <span 
                        key={i} 
                        onClick={() => onTagClick && onTagClick(c.trim())}
                        className={`text-[9px] font-bold px-1.5 py-0.5 bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 rounded-full border border-amber-100 dark:border-amber-900/30 flex items-center gap-1 ${onTagClick ? 'cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/40' : ''}`}
                      >
                        <span className="text-[7.5px] uppercase tracking-wider opacity-60">Condition:</span>
                        {c.trim()}
                      </span>
                    ))}
                  </div>
                )}

                {itemLogs && itemLogs.length > 0 && (
                  <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/40">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        Latest Log: <span className="font-bold text-slate-800 dark:text-slate-200">{itemLogs[0].value} {initialUnit}</span> <span className="text-[10px] text-slate-400 dark:text-slate-500">({itemLogs[0].date})</span>
                      </div>
                      {itemLogs.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setIsHistoryExpanded(!isHistoryExpanded);
                          }}
                          className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                        >
                          {isHistoryExpanded ? "Hide History" : `History (${itemLogs.length})`}
                        </button>
                      )}
                    </div>
                    
                    {isHistoryExpanded && itemLogs.length > 1 && (
                      <div className="mt-2 space-y-1 bg-slate-50 dark:bg-slate-950/40 p-2 rounded-lg border border-slate-100 dark:border-slate-800 max-h-32 overflow-y-auto">
                        {itemLogs.map((log: any, idx: number) => (
                          <div key={idx} className="flex justify-between items-center text-[11px] font-mono py-0.5 border-b border-slate-100/30 dark:border-slate-800/20 last:border-0 text-slate-600 dark:text-slate-400">
                            <span>{log.date}</span>
                            <span className="font-bold text-slate-800 dark:text-slate-200">{log.value} {initialUnit}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>


    </div>
  );
}

export default function BiomarkerDictionaryModal({
  profile,
  biomarkers,
  biomarkerHistory,
  onClose,
  onUpdateProfile,
  onCombineBiomarkers,
  onBatchCombineBiomarkers,
  onBatchConsolidate,
  onStandardizeUnits,
  initialSearchQuery,
  onLogMedical,
  onAgentAnalysisSaved,
  onDeleteAnalysis,
  onDeleteBiomarker,
  onDeleteMultipleBiomarkers
}: BiomarkerDictionaryModalProps) {
  const [isProcessing, setIsProcessing] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<string | null>(null);
  const [showCombineModal, setShowCombineModal] = useState(false);
  const [showCleaningDropdown, setShowCleaningDropdown] = useState(false);
  const [isMedicalCategorisationMode, setIsMedicalCategorisationMode] = useState(false);
  const [editName, setEditName] = useState('');

  // Inline confirmation states (iframe safety)
  const [showResetChatConfirm, setShowResetChatConfirm] = useState(false);
  const [showDiscardResultsConfirm, setShowDiscardResultsConfirm] = useState(false);
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);
  const [showDiscardSessionConfirm, setShowDiscardSessionConfirm] = useState(false);
  const [showDataAccuracyHistory, setShowDataAccuracyHistory] = useState(false);
  const [confirmDeleteLogId, setConfirmDeleteLogId] = useState<string | null>(null);

  // Data Accuracy Agent States
  const [isDataAccuracyMode, setIsDataAccuracyMode] = useState(false);
  const [dataAccuracyMessages, setDataAccuracyMessages] = useState<any[]>(() => {
    try {
      const saved = localStorage.getItem('data_accuracy_messages');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return [
      {
        id: 'acc_msg_init',
        role: 'assistant',
        content: 'Hello! I am the Data Accuracy Agent, your cleaning specialist. 🧪\n\nShare any new biomarker readings, laboratory results, or logs by **typing them down** or **uploading files/images**.\n\nI will compare your input with your existing database definitions and latest logs to highlight any differences in **Name, Unit, Value, Date, and Comments**, and generate an interactive table so you can choose which information to keep.',
        timestamp: new Date().toISOString()
      }
    ];
  });
  const [dataAccuracyInput, setDataAccuracyInput] = useState('');
  const [dataAccuracyLoading, setDataAccuracyLoading] = useState(false);
  const [accuracyUploadedFiles, setAccuracyUploadedFiles] = useState<{ name: string; type: string; base64?: string; text?: string }[]>([]);
  const [accuracyComparisonResults, setAccuracyComparisonResults] = useState<any[] | null>(() => {
    try {
      const saved = localStorage.getItem('data_accuracy_comparison_results');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return null;
  });
  const [accuracySelectedFields, setAccuracySelectedFields] = useState<{ 
    [biomarkerKey: string]: { 
      name: 'current' | 'shared'; 
      unit: 'current' | 'shared'; 
      value: 'current' | 'shared'; 
      date: 'current' | 'shared'; 
      comments: 'current' | 'shared'; 
      selected: boolean;
    } 
  }>(() => {
    try {
      const saved = localStorage.getItem('data_accuracy_selected_fields');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {};
  });

  // Automatically persist Data Accuracy Agent States
  useEffect(() => {
    if (dataAccuracyMessages && dataAccuracyMessages.length > 1) {
      localStorage.setItem('data_accuracy_messages', JSON.stringify(dataAccuracyMessages));
    } else {
      localStorage.removeItem('data_accuracy_messages');
    }
  }, [dataAccuracyMessages]);

  useEffect(() => {
    if (accuracyComparisonResults) {
      localStorage.setItem('data_accuracy_comparison_results', JSON.stringify(accuracyComparisonResults));
    } else {
      localStorage.removeItem('data_accuracy_comparison_results');
    }
  }, [accuracyComparisonResults]);

  useEffect(() => {
    if (accuracySelectedFields && Object.keys(accuracySelectedFields).length > 0) {
      localStorage.setItem('data_accuracy_selected_fields', JSON.stringify(accuracySelectedFields));
    } else {
      localStorage.removeItem('data_accuracy_selected_fields');
    }
  }, [accuracySelectedFields]);

  const fileInputRef2 = useRef<HTMLInputElement>(null);

  // Model Selection states
  const [standardizeModel, setStandardizeModel] = useState<string>('gemini-3.1-flash-lite');
  const [medicalCategoriseModel, setMedicalCategoriseModel] = useState<string>('gemini-3.1-flash-lite');
  const [dataAccuracyModel, setDataAccuracyModel] = useState<string>('gemini-3.1-flash-lite');

  // Instruction View states
  const [showStandardizeInstructions, setShowStandardizeInstructions] = useState<boolean>(false);
  const [showMedicalInstructions, setShowMedicalInstructions] = useState<boolean>(false);
  const [showDataAccuracyInstructions, setShowDataAccuracyInstructions] = useState<boolean>(false);
  const [showConsolidationInstructions, setShowConsolidationInstructions] = useState<boolean>(false);

  // Clinical Unit Standardization Agent States
  const [isAgentMode, setIsAgentMode] = useState(false);
  const [targetMetric, setTargetMetric] = useState<'si' | 'us'>('si');
  const [agentLoading, setAgentLoading] = useState(false);
  const [standardizationYaml, setStandardizationYaml] = useState<string | null>(null);
  const [standardizationSummary, setStandardizationSummary] = useState<any[] | null>(null);

  // Name Consolidation Agent States
  const [isNameConsolidationMode, setIsNameConsolidationMode] = useState<boolean>(false);
  const [nameConsolidationModel, setNameConsolidationModel] = useState<string>('gemini-3.1-flash-lite');
  const [consolidationYaml, setConsolidationYaml] = useState<string | null>(null);
  const [consolidationGroups, setConsolidationGroups] = useState<any[] | null>(null);
  const [consolidationLoading, setConsolidationLoading] = useState<boolean>(false);
  const [consolidationInput, setConsolidationInput] = useState<string>('');
  const [consolidationMessages, setConsolidationMessages] = useState<any[]>([]);

  // Selection states
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState(initialSearchQuery || "");
  const [filterOption, setFilterOption] = useState<'all' | 'overrides' | 'missing_units'>('all');
  const [filterTag, setFilterTag] = useState<string | null>(null);
  
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

  useEffect(() => {
    const pendingKeysStr = localStorage.getItem('consolidation_pending_keys');
    const pendingNote = localStorage.getItem('consolidation_pending_note');
    if (pendingKeysStr) {
      try {
        const keys = JSON.parse(pendingKeysStr);
        if (Array.isArray(keys) && keys.length > 0) {
          setSelectedKeys(keys);
          setIsNameConsolidationMode(true);
          if (pendingNote) {
            setConsolidationInput(pendingNote);
          }
        }
      } catch (e) {
        console.error('Failed to parse pending consolidation keys:', e);
      }
      localStorage.removeItem('consolidation_pending_keys');
      localStorage.removeItem('consolidation_pending_note');
    }
  }, []);

  const builtInKeys = biomarkerDefinitions.map(d => d.key);
  const customKeys = Object.keys(profile.customBiomarkers || {});
  
  const historyKeys = useMemo(() => {
    const keys = new Set<string>();
    biomarkerHistory.forEach(log => {
      if (log.biomarkers) {
        Object.keys(log.biomarkers).forEach(k => keys.add(k));
      }
    });
    return Array.from(keys);
  }, [biomarkerHistory]);

  const hasActualOverride = React.useCallback((key: string): boolean => {
    // These keys have auto-generated custom overrides
    const keysWithAutoOverrides = ['total_cholesterol', 'ldl', 'hdl', 'triglycerides', 'hba1c', 'fasting_glucose'];
    if (keysWithAutoOverrides.includes(key)) {
      return true;
    }

    const custom = profile.customBiomarkers?.[key];
    if (!custom) return false;

    const builtIn = biomarkerDefinitions.find((d: any) => d.key === key);
    if (!builtIn) {
      // Truly custom biomarker is always considered custom
      return true;
    }

    // 1. Check for demographic-specific ranges
    if (custom.customRanges && custom.customRanges.length > 0) return true;

    // 2. Check for structured range overrides
    if (custom.structuredRanges && custom.structuredRanges.length > 0) return true;

    // 3. Check for custom range builder configuration
    if (custom.rangeConfig && Object.keys(custom.rangeConfig).length > 0) return true;

    // 4. Check for customized name
    if (custom.name && custom.name.trim() !== builtIn.name.trim()) return true;

    // 5. Check for customized unit
    const norm = (str: string) => (str || '').toLowerCase().trim().replace(/\s+/g, '');
    if (custom.unit && norm(custom.unit) !== norm(builtIn.unit)) return true;

    // 6. Check for customized flat normal range
    if (custom.normalRange && norm(custom.normalRange) !== norm(builtIn.normalRange)) return true;

    // 7. Check for customized description
    if (custom.description && custom.description.trim() !== (builtIn.descriptions?.en || '').trim()) return true;

    // 8. Check for customized medical grouping
    const standardGrouping = getBiomarkerMetadata(key).standardMedicalGrouping;
    if (custom.standardMedicalGrouping && custom.standardMedicalGrouping.trim().toLowerCase() !== standardGrouping.trim().toLowerCase()) return true;

    return false;
  }, [profile.customBiomarkers]);

  const filterFn = (k: string) => {
    const q = searchQuery.toLowerCase();
    const def = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((d: any) => d.key === k);
    
    if (filterOption === 'missing_units') {
      const unit = def?.unit || '';
      if (unit && unit.trim() !== '') return false;
    } else if (filterOption === 'overrides') {
      if (!hasActualOverride(k)) return false;
    }

    if (filterTag) {
      const meta = getBiomarkerMetadata(k, def);
      const tagLower = filterTag.toLowerCase();
      const hasTag = meta.standardMedicalGrouping?.toLowerCase() === tagLower ||
        meta.riskCategories?.some((r: string) => r.toLowerCase() === tagLower) ||
        meta.potentialMedicalConditions?.some((c: string) => c.toLowerCase() === tagLower) ||
        (def as any)?.category?.toLowerCase() === tagLower;
        
      if (!hasTag) return false;
    }

    if (!q) return true;
    if (!def) return k.toLowerCase().includes(q);
    const meta = getBiomarkerMetadata(k, def);
    const hasTagMatch = meta.standardMedicalGrouping?.toLowerCase().includes(q) ||
        meta.riskCategories?.some((r: string) => r.toLowerCase().includes(q)) ||
        meta.potentialMedicalConditions?.some((c: string) => c.toLowerCase().includes(q)) ||
        (def as any)?.category?.toLowerCase().includes(q);
    return k.toLowerCase().includes(q) || (def.name || '').toLowerCase().includes(q) || hasTagMatch;
  };

  const allApprovedKeysUnfiltered = useMemo(() => {
    const keys = new Set([...builtInKeys]);
    customKeys.forEach(k => {
      // If it explicitly needs approval (e.g. extracted from Medical Chat), exclude it from approved list
      if (profile.customBiomarkers?.[k]?.needsApproval) {
         return;
      }
      if (profile.customBiomarkers?.[k]?.standardMedicalGrouping || profile.customBiomarkers?.[k]?.unit) {
        keys.add(k);
      }
    });
    
    // If no search query, only show approved keys that are actively used (in history or customized)
    const result = Array.from(keys);
    if (searchQuery.trim() === '') {
      return result.filter(k => historyKeys.includes(k) || customKeys.includes(k));
    }
    return result;
  }, [builtInKeys, customKeys, profile.customBiomarkers, historyKeys, searchQuery]);

  const missingUnitsCount = useMemo(() => {
    let count = 0;
    const allKnown = new Set([...historyKeys, ...customKeys, ...allApprovedKeysUnfiltered]);
    allKnown.forEach(k => {
      const def = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((d: any) => d.key === k);
      const unit = def?.unit || '';
      if (!unit || unit.trim() === '') count++;
    });
    return count;
  }, [historyKeys, customKeys, allApprovedKeysUnfiltered, profile.customBiomarkers]);

  const allApprovedKeys = useMemo(() => {
    return allApprovedKeysUnfiltered.filter(filterFn);
  }, [allApprovedKeysUnfiltered, searchQuery, profile.customBiomarkers, filterOption]);

  const toApproveKeys = useMemo(() => {
    const keys = new Set([...historyKeys, ...customKeys]);
    return Array.from(keys).filter(k => !allApprovedKeysUnfiltered.includes(k)).filter(filterFn);
  }, [historyKeys, customKeys, allApprovedKeysUnfiltered, searchQuery, profile.customBiomarkers, filterOption]);

  const { allGroupings, allRisks, allConditions } = useMemo(() => {
    const groupings = new Set<string>();
    const risks = new Set<string>();
    const conditions = new Set<string>();
    
    // Check built-in and history/custom
    const allKnownKeys = new Set([...builtInKeys, ...customKeys, ...historyKeys]);
    allKnownKeys.forEach(k => {
      const def = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((b: any) => b.key === k);
      if (def?.standardMedicalGrouping) groupings.add(def.standardMedicalGrouping);
      if (def?.riskCategories) def.riskCategories.forEach((r: string) => risks.add(r));
      if (def?.potentialMedicalConditions) def.potentialMedicalConditions.forEach((c: string) => conditions.add(c));
    });
    return {
      allGroupings: Array.from(groupings).sort(),
      allRisks: Array.from(risks).sort(),
      allConditions: Array.from(conditions).sort()
    };
  }, [builtInKeys, customKeys, historyKeys, profile.customBiomarkers]);

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
      id: `welcome_${Date.now()}`,
      role: 'assistant',
      content: `Hello! I am your Clinical Ontology and Database Route Agent. I see we have selected **${keysToRoute.length}** biomarker(s) to route and consolidate:
      
${keysToRoute.map(k => `• **${profile.customBiomarkers?.[k]?.name || k}** (\`${k}\`)`).join('\n')}

I can analyze these, compare them with our database keys, and find standard mappings or define new standard entities. How would you like to proceed? You can ask me questions, or click **"Request Suggestions"** to have me automatically map them for you!`
    };

    setChatMessages([initialMessage]);
  };

  const handleSendChat = async (overridePrompt?: string) => {
    const textToSend = overridePrompt || chatInput;
    if (!textToSend.trim() || isChatLoading) return;

    const userMsg: ChatMessage = { id: `user_${Date.now()}`, role: 'user', content: textToSend };
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
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-ID': getSessionId()
        },
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

  // Data Accuracy Agent Helper Functions
  const handleAccuracyFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files ? Array.from(e.target.files) : [];
    if (fileList.length === 0) return;

    fileList.forEach((file: any) => {
      const reader = new FileReader();
      if (file.type.startsWith('image/')) {
        reader.onloadend = () => {
          setAccuracyUploadedFiles(prev => [...prev, {
            name: file.name,
            type: file.type,
            base64: reader.result as string
          }]);
        };
        reader.readAsDataURL(file);
      } else {
        reader.onloadend = () => {
          setAccuracyUploadedFiles(prev => [...prev, {
            name: file.name,
            type: file.type,
            text: reader.result as string
          }]);
        };
        reader.readAsText(file);
      }
    });

    e.target.value = '';
  };

  const removeAccuracyFile = (idx: number) => {
    setAccuracyUploadedFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleSendDataAccuracy = async () => {
    const text = dataAccuracyInput.trim();
    const attachedFiles = [...accuracyUploadedFiles];
    if (!text && attachedFiles.length === 0) return;

    setDataAccuracyInput('');
    setAccuracyUploadedFiles([]);

    const fileNames = attachedFiles.map(f => f.name).join(', ');
    const displayContent = text + (attachedFiles.length > 0 ? `\n[Attached files: ${fileNames}]` : '');

    const userMsg = {
      id: `acc_msg_${Date.now()}`,
      role: 'user',
      content: displayContent,
      timestamp: new Date().toISOString()
    };

    const updatedMessages = [...dataAccuracyMessages, userMsg];
    setDataAccuracyMessages(updatedMessages);
    setDataAccuracyLoading(true);

    try {
      const currentCustomBiomarkers = profile.customBiomarkers || {};
      const latestValues: { [key: string]: { value: any; date: string; note: string; logId: string; }[] } = {};
      const sortedHistory = [...biomarkerHistory].sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
      
      const allKnownKeys = selectedKeys.length > 0
        ? new Set<string>(selectedKeys)
        : new Set<string>([
            ...biomarkerDefinitions.map(d => d.key),
            ...Object.keys(currentCustomBiomarkers)
          ]);

      allKnownKeys.forEach((key: string) => {
        const matchingLogs = sortedHistory.filter(h => h.biomarkers && h.biomarkers[key] !== undefined);
        if (matchingLogs.length > 0) {
          latestValues[key] = matchingLogs.map(matchingLog => {
            const testDetail = matchingLog.tests?.find(t => t.key === key);
            return {
              value: matchingLog.biomarkers[key],
              date: matchingLog.date,
              note: testDetail?.doctorComment || matchingLog.note || '',
              logId: matchingLog.id
            };
          });
        }
      });

      const filteredCustomBiomarkers: { [key: string]: any } = {};
      if (selectedKeys.length > 0) {
        selectedKeys.forEach(k => {
          if (currentCustomBiomarkers[k]) {
            filteredCustomBiomarkers[k] = currentCustomBiomarkers[k];
          }
        });
      } else {
        Object.assign(filteredCustomBiomarkers, currentCustomBiomarkers);
      }

      const currentState = {
        customBiomarkers: filteredCustomBiomarkers,
        historyValues: latestValues
      };

      const imagesForAPI = attachedFiles
        .filter(f => f.base64)
        .map(f => f.base64!);

      let promptText = text;
      attachedFiles.forEach(f => {
        if (f.text) {
          promptText += `\n\n--- Content of file: ${f.name} ---\n${f.text}\n--- End of file ---`;
        }
      });

      const response = await fetch('/api/gemini/data-accuracy', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-ID': getSessionId()
        },
        body: JSON.stringify({
          inputText: promptText,
          currentState,
          images: imagesForAPI,
          currentLocalTime: new Date().toLocaleDateString(),
          engine: dataAccuracyModel,
          customSystemInstruction: localStorage.getItem('custom_system_instruction_data_accuracy') || undefined
        })
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`);
      }

      const result = await response.json();

      // Save the agent payload/analysis results to the user profile's log history (agentAnalyses)
      const newAnalysis = {
        id: `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        agentType: 'data_accuracy',
        date: new Date().toISOString(),
        result: {
          inputText: promptText,
          explanation: result.explanation || '',
          comparisonResults: result.comparisonResults || []
        }
      };
      
      if (onAgentAnalysisSaved) {
        await onAgentAnalysisSaved('data_accuracy', {
          inputText: promptText,
          explanation: result.explanation || '',
          comparisonResults: result.comparisonResults || []
        });
      } else {
        const currentAnalyses = profile.agentAnalyses || [];
        onUpdateProfile({
          agentAnalyses: [...currentAnalyses, newAnalysis]
        });
      }

      const agentMsg = {
        id: `acc_msg_${Date.now() + 1}`,
        role: 'assistant',
        content: result.explanation || "I have analyzed the provided biomarker details and compared them with your database.",
        timestamp: new Date().toISOString()
      };

      setDataAccuracyMessages(prev => [...prev, agentMsg]);

      if (result.comparisonResults && Array.isArray(result.comparisonResults) && result.comparisonResults.length > 0) {
        setAccuracyComparisonResults(result.comparisonResults);

        const initialSelectedFields: any = {};
        result.comparisonResults.forEach((item: any) => {
          initialSelectedFields[item.key] = {
            name: item.name.status === 'different' ? 'shared' : 'current',
            unit: item.unit.status === 'different' ? 'shared' : 'current',
            value: item.value.status === 'different' ? 'shared' : 'current',
            date: item.date.status === 'different' ? 'shared' : 'current',
            comments: item.comments.status === 'different' ? 'shared' : 'current',
            selected: true
          };
        });
        setAccuracySelectedFields(initialSelectedFields);
      }

    } catch (err: any) {
      console.error("[Data Accuracy Agent Error]:", err);
      const errorMsg = {
        id: `acc_msg_${Date.now() + 1}`,
        role: 'assistant',
        content: `Sorry, I encountered an error while processing and comparing your data: ${err.message}. Please check your connection and try again.`,
        timestamp: new Date().toISOString()
      };
      setDataAccuracyMessages(prev => [...prev, errorMsg]);
    } finally {
      setDataAccuracyLoading(false);
    }
  };

  const applySelectedAccuracyUpdates = async () => {
    if (!accuracyComparisonResults) return;

    const selectedUpdates = accuracyComparisonResults.filter(item => accuracySelectedFields[item.id]?.selected);
    if (selectedUpdates.length === 0) {
      alert("Please select at least one biomarker update to apply.");
      return;
    }

    const newCustomBiomarkers = { ...profile.customBiomarkers };
    const entriesByDate: { [date: string]: { biomarkers: { [key: string]: number | string }; tests: any[] } } = {};

    selectedUpdates.forEach(item => {
      const fieldSelects = accuracySelectedFields[item.id];
      
      const targetName = fieldSelects.name === 'shared' ? item.name.shared : item.name.current;
      const targetUnit = fieldSelects.unit === 'shared' ? item.unit.shared : item.unit.current;

      const builtIn = biomarkerDefinitions.find(d => d.key === item.key);
      const custom = profile.customBiomarkers?.[item.key];
      const combinedDef = { ...builtIn, ...custom };

      newCustomBiomarkers[item.key] = {
        ...combinedDef,
        name: targetName && targetName !== 'N/A' ? targetName : (combinedDef.name || item.key),
        unit: targetUnit && targetUnit !== 'N/A' ? targetUnit : (combinedDef.unit || '')
      };

      const targetValue = fieldSelects.value === 'shared' ? item.value.shared : item.value.current;
      const targetDate = fieldSelects.date === 'shared' ? item.date.shared : item.date.current;
      const targetComment = fieldSelects.comments === 'shared' ? item.comments.shared : item.comments.current;

      let finalDate = targetDate && targetDate !== 'N/A' ? targetDate : new Date().toISOString().split('T')[0];
      if (finalDate.includes('/')) {
        try {
          const parsedD = new Date(finalDate);
          if (!isNaN(parsedD.getTime())) {
            finalDate = parsedD.toISOString().split('T')[0];
          }
        } catch (_) {}
      }

      if (targetValue !== undefined && targetValue !== 'N/A') {
        if (!entriesByDate[finalDate]) {
          entriesByDate[finalDate] = {
            biomarkers: {},
            tests: []
          };
        }

        entriesByDate[finalDate].biomarkers[item.key] = targetValue;

        entriesByDate[finalDate].tests.push({
          key: item.key,
          originalTestName: targetName,
          valueNumeric: typeof targetValue === 'number' ? targetValue : parseFloat(String(targetValue)) || null,
          valueString: typeof targetValue === 'string' ? targetValue : String(targetValue),
          unit: targetUnit,
          doctorComment: targetComment && targetComment !== 'N/A' ? targetComment : undefined
        });
      }
    });

    const entriesToLog = Object.entries(entriesByDate).map(([date, data]) => ({
      date,
      biomarkers: data.biomarkers,
      tests: data.tests
    }));

    try {
      if (onLogMedical) {
        await onLogMedical({}, { customBiomarkers: newCustomBiomarkers }, undefined, entriesToLog, undefined, true);
        
        const successMsg = {
          id: `acc_msg_success_${Date.now()}`,
          role: 'assistant',
          content: `✅ Successfully applied updates for ${selectedUpdates.length} biomarker(s)! Both your biomarker dictionary definitions and historical logs have been updated and synchronized.`,
          timestamp: new Date().toISOString()
        };
        setDataAccuracyMessages(prev => [...prev, successMsg]);
        setAccuracyComparisonResults(null);
      } else {
        onUpdateProfile({ customBiomarkers: newCustomBiomarkers });
        alert("Dictionary definitions updated. Note: Historical logs could not be updated as the logging interface was not ready.");
      }
    } catch (err: any) {
      console.error("Failed to apply accuracy updates:", err);
      alert(`Error applying updates: ${err.message}`);
    }
  };

  // Scroll accuracy chat to bottom
  const accuracyChatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (accuracyChatEndRef.current) {
      accuracyChatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [dataAccuracyMessages, dataAccuracyLoading]);

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
        throw new Error("Pasted content must be a JSON Object or Array.");
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
    if (!parsedMapping) return;
    try {
      let isMapping = false;
      let isUpdate = false;
      const updatesToApply: any = {};
      const mappingToApply: any = {};

      if (Array.isArray(parsedMapping)) {
        isUpdate = true;
        parsedMapping.forEach((item: any) => {
          if (item.key) {
            updatesToApply[item.key] = { ...item };
            delete updatesToApply[item.key].key;
          }
        });
      } else {
        Object.entries(parsedMapping).forEach(([k, v]: [string, any]) => {
          if (typeof v === 'string') {
            isMapping = true;
            mappingToApply[k] = v;
          } else if (typeof v === 'object' && v !== null) {
            isUpdate = true;
            updatesToApply[k] = v;
          }
        });
      }

      if (isMapping && onBatchConsolidate) {
        onBatchConsolidate(mappingToApply);
      }
      
      if (isUpdate) {
        const newCustoms = { ...(profile.customBiomarkers || {}) };
        Object.entries(updatesToApply).forEach(([k, v]: [string, any]) => {
          newCustoms[k] = { ...(newCustoms[k] || {}), ...v };
        });
        onUpdateProfile({ customBiomarkers: newCustoms });
      }

      alert("Batch operation complete!");
      setIsBatchPasteMode(false);
      setPasteText('');
      setParsedMapping(null);
    } catch (e: any) {
      alert("Operation failed: " + e.message);
    }
  };

  // Automated Clinical Unit Standardization YAML Parser
  const parseStandardizationYaml = (yamlText: string): any[] => {
    const items: any[] = [];
    const lines = yamlText.split('\n');
    let currentItem: any = null;

    for (const rawLine of lines) {
      let trimmed = rawLine.trim();
      if (!trimmed) continue;

      // Detect new item in the list
      if (trimmed.startsWith('-')) {
        if (currentItem && currentItem.key) {
          items.push(currentItem);
        }
        currentItem = {};
        trimmed = trimmed.substring(1).trim(); // process rest of line
      }

      if (currentItem && trimmed) {
        // Look for key-value pairs like key: "value" or key: value
        const match = trimmed.match(/^["']?([a-zA-Z0-9_]+)["']?\s*:\s*(.*)$/);
        if (match) {
          const key = match[1].trim();
          let value = match[2].trim();
          // Remove surrounding quotes if any
          if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.substring(1, value.length - 1);
          }
          currentItem[key] = value;
        }
      }
    }

    if (currentItem && currentItem.key) {
      items.push(currentItem);
    }

    return items;
  };

  // Run Clinical Unit Standardization Agent
  const handleRunStandardizationAgent = async () => {
    if (selectedKeys.length === 0) return;
    setAgentLoading(true);
    setStandardizationYaml(null);
    setStandardizationSummary(null);

    try {
      const selectedBiomarkerDetails = selectedKeys.map(k => {
        const customDef = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((b: any) => b.key === k);
        return {
          key: k,
          name: customDef?.name || k,
          currentUnit: customDef?.unit || '',
        };
      });

      // Get session ID for telemetry / backend logging isolation
      const sessionId = getSessionId();

      const endpoint = isMedicalCategorisationMode ? '/api/gemini/medical-categorise' : '/api/gemini/standardize-units';
      const agentKey = isMedicalCategorisationMode ? 'medical_categorise' : 'standardize';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        },
        body: JSON.stringify({
          selectedBiomarkers: selectedBiomarkerDetails,
          metricSystem: targetMetric,
          engine: isMedicalCategorisationMode ? medicalCategoriseModel : standardizeModel,
          customSystemInstruction: localStorage.getItem(`custom_system_instruction_${agentKey}`) || undefined
        })
      });

      if (!res.ok) throw new Error("Failed to contact standardization agent");
      const data = await res.json();
      
      
      const jsonData = typeof data.jsonResponse === 'string' ? JSON.parse(data.jsonResponse) : data.jsonResponse;
      setStandardizationYaml(JSON.stringify(jsonData, null, 2));
      let parsed = jsonData.mappedBiomarkers || jsonData.categorisedBiomarkers || [];
      // Normalize key
      parsed = parsed.map((item: any) => ({
        ...item,
        key: item.originalKey || item.key
      }));

      setStandardizationSummary(parsed);
    } catch (error: any) {
      console.error(error);
      alert("Error running standardization agent: " + error.message);
    } finally {
      setAgentLoading(false);
    }
  };

  // Approve & Apply Agent Standardization
  const handleApplyStandardization = async () => {
    if (!standardizationSummary || !onStandardizeUnits) return;
    try {
      const updatesToApply: any = {};
      standardizationSummary.forEach((item: any) => {
        if (item.key) {
          updatesToApply[item.key] = {
            name: item.name || item.key
          };
          if (item.unit !== undefined) updatesToApply[item.key].unit = item.unit;
          if (item.normalRange !== undefined) updatesToApply[item.key].normalRange = item.normalRange;
          if (item.standardMedicalGrouping !== undefined) updatesToApply[item.key].standardMedicalGrouping = item.standardMedicalGrouping;
          
          // Always process riskCategories and potentialMedicalConditions even if undefined
          // so that non-selected ones are explicitly removed (set to empty array) when accepting categorisation
          if (item.riskCategories !== undefined) {
             try {
                updatesToApply[item.key].riskCategories = Array.isArray(item.riskCategories) ? item.riskCategories : JSON.parse(item.riskCategories);
             } catch (e) {
                updatesToApply[item.key].riskCategories = typeof item.riskCategories === 'string' ? item.riskCategories.split(',').map((s: string)=>s.trim()) : [];
             }
          } else if (isMedicalCategorisationMode) {
             updatesToApply[item.key].riskCategories = [];
          }
          if (isMedicalCategorisationMode && updatesToApply[item.key].riskCategories) {
             const allowedRisks = ["Cardiovascular", "Kidney", "Metabolic", "Liver", "Hematology", "Wellness", "Screenings"];
             updatesToApply[item.key].riskCategories = updatesToApply[item.key].riskCategories.filter((r: string) => allowedRisks.includes(r));
          }
          
          if (item.potentialMedicalConditions !== undefined) {
             try {
                updatesToApply[item.key].potentialMedicalConditions = Array.isArray(item.potentialMedicalConditions) ? item.potentialMedicalConditions : JSON.parse(item.potentialMedicalConditions);
             } catch (e) {
                updatesToApply[item.key].potentialMedicalConditions = typeof item.potentialMedicalConditions === 'string' ? item.potentialMedicalConditions.split(',').map(s=>s.trim()) : [];
             }
          } else if (isMedicalCategorisationMode) {
             updatesToApply[item.key].potentialMedicalConditions = [];
          }
        }
      });

      await onStandardizeUnits(updatesToApply);
      alert("Selected units successfully standardized and converted!");
      setIsAgentMode(false);
      setSelectedKeys([]);
      setStandardizationYaml(null);
      setStandardizationSummary(null);
    } catch (e: any) {
      console.error(e);
      alert("Error applying standardization: " + e.message);
    }
  };

  const [groupEdits, setGroupEdits] = useState<{
    [groupIndex: number]: {
      recommendedClinicalName: string;
      recommendedUniqueKey: string;
      masterKey: string;
      excludedKeys: { [key: string]: boolean };
    }
  }>({});


  // Run Name Consolidation Agent (Chat Interface)
  const handleRunConsolidationAgent = async (isManualClick = false) => {
    if (selectedKeys.length === 0) return;
    
    let userMsg = null;
    const text = consolidationInput.trim();
    if (text || isManualClick) {
      userMsg = {
        role: 'user',
        content: text || "Please identify the duplicates from the provided list and consolidate them.",
        timestamp: new Date().toISOString()
      };
      setConsolidationMessages(prev => [...prev, userMsg]);
    }
    
    setConsolidationInput('');
    setConsolidationLoading(true);
    setConsolidationYaml(null);
    setConsolidationGroups(null);

    try {
      const selectedBiomarkerDetails = selectedKeys.map(k => {
        const customDef: any = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((b: any) => b.key === k);
        return {
          key: k,
          name: customDef?.name || k,
          medicalGrouping: customDef?.standardMedicalGrouping || customDef?.medicalGrouping || '',
          unit: customDef?.unit || '',
          range: customDef?.normalRange || '',
          description: customDef?.description || ''
        };
      });

      const sessionId = getSessionId();

      const res = await fetch('/api/gemini/consolidate-names', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'X-Session-ID': sessionId
        },
        body: JSON.stringify({
          inputText: userMsg?.content,
          selectedBiomarkers: selectedBiomarkerDetails,
          engine: nameConsolidationModel,
          customSystemInstruction: localStorage.getItem('custom_system_instruction_consolidate_names') || undefined
        })
      });

      if (!res.ok) throw new Error("Failed to contact name consolidation agent");
      const data = await res.json();
      
      setConsolidationYaml(JSON.stringify(parsed, null, 2));
      const parsed = data.consolidatedGroups || data.groups || [];
      setConsolidationGroups(parsed);

      const newAnalysis = {
        id: `analysis_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        agentType: 'name_consolidation',
        date: new Date().toISOString(),
        result: {
          inputText: userMsg?.content || "Auto-Consolidation",
          explanation: data.explanation || '',
          groups: parsed
        }
      };

      if (onAgentAnalysisSaved) {
        await onAgentAnalysisSaved('name_consolidation', newAnalysis.result);
      } else {
        const currentAnalyses = profile.agentAnalyses || [];
        onUpdateProfile({
          agentAnalyses: [...currentAnalyses, newAnalysis]
        });
      }

      const initialEdits: any = {};
      parsed.forEach((group: any, idx: number) => {
        const firstKey = group.biomarkers?.[0]?.key || group.recommendedUniqueKey || '';
        const masterBio = group.biomarkers?.[0] || {};
        const origMasterDef = profile.customBiomarkers?.[masterBio.key] || biomarkerDefinitions.find((def: any) => def.key === masterBio.key) || {};
        initialEdits[idx] = {
          recommendedClinicalName: group.recommendedClinicalName || group.groupName || '',
          recommendedUniqueKey: group.recommendedUniqueKey || '',
          masterKey: firstKey,
          excludedKeys: {},
          unit: masterBio.unit || origMasterDef.unit || '',
          normalRange: masterBio.range || origMasterDef.normalRange || '',
          description: masterBio.description || origMasterDef.description || ''
        };
      });
      setGroupEdits(initialEdits);

      if (data.explanation) {
        setConsolidationMessages(prev => [...prev, {
          role: 'agent',
          content: data.explanation,
          timestamp: new Date().toISOString()
        }]);
      }
    } catch (error: any) {
      console.error(error);
      alert("Error running name consolidation agent: " + error.message);
      setConsolidationMessages(prev => [...prev, {
        role: 'agent',
        content: "Error: " + error.message,
        isError: true,
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setConsolidationLoading(false);
    }
  };

  // Approve & Combine Name Consolidation Results
  const handleApplyConsolidation = async () => {
    if (!consolidationGroups || !onCombineBiomarkers) return;
    setConsolidationLoading(true);
    try {
      const combinationsToApply: {targetKey: string, targetDef: any, mergedLogs: any[], sourceKeysToDelete: string[]}[] = [];
      
      for (let idx = 0; idx < consolidationGroups.length; idx++) {
        const group = consolidationGroups[idx];
        const edits = groupEdits[idx];
        if (!edits) continue;

        const targetKey = edits.recommendedUniqueKey;
        const targetName = edits.recommendedClinicalName;

        const includedBiomarkers = group.biomarkers.filter((b: any) => !edits.excludedKeys[b.key]);
        if (includedBiomarkers.length === 0) continue;

        const masterBio = includedBiomarkers.find((b: any) => b.key === edits.masterKey) || includedBiomarkers[0];
        
        const origMasterDef = profile.customBiomarkers?.[masterBio.key] || biomarkerDefinitions.find((def: any) => def.key === masterBio.key) || {};
        const targetDef = {
          name: targetName,
          unit: masterBio?.unit || '',
          normalRange: masterBio?.range || '',
          description: masterBio?.description || '',
          standardMedicalGrouping: (origMasterDef as any).standardMedicalGrouping || (origMasterDef as any).medicalGrouping || masterBio?.medicalGrouping || '',
          riskCategories: (origMasterDef as any).riskCategories || [],
          potentialMedicalConditions: (origMasterDef as any).potentialMedicalConditions || [],
          rangeConfig: (origMasterDef as any).rangeConfig,
          customRanges: (origMasterDef as any).customRanges
        };

        const sourceKeysToDelete = includedBiomarkers.map((b: any) => b.key).filter((k: string) => k !== targetKey);

        const mergedLogsMap: { [date: string]: { value: string | number, originalLogId?: string } } = {};

        biomarkerHistory.forEach((log) => {
          let valueFound: string | number | null = null;
          let originalLogId = log.id;

          if (log.biomarkers[edits.masterKey] !== undefined) {
            valueFound = log.biomarkers[edits.masterKey];
          } else {
            for (const b of includedBiomarkers) {
              if (log.biomarkers[b.key] !== undefined) {
                valueFound = log.biomarkers[b.key];
                break;
              }
            }
          }

          if (valueFound !== null && valueFound !== undefined && valueFound !== '') {
            if (mergedLogsMap[log.date]) {
              // Same date already logged, duplicate removed.
            } else {
              mergedLogsMap[log.date] = {
                value: valueFound,
                originalLogId
              };
            }
          }
        });

        const mergedLogs = Object.entries(mergedLogsMap).map(([date, data]) => ({
          date,
          value: data.value,
          originalLogId: data.originalLogId
        }));

        combinationsToApply.push({ targetKey, targetDef, mergedLogs, sourceKeysToDelete });
      }

      if (onBatchCombineBiomarkers && combinationsToApply.length > 0) {
        await onBatchCombineBiomarkers(combinationsToApply);
      } else if (combinationsToApply.length > 0) {
        for (const combo of combinationsToApply) {
          await onCombineBiomarkers(combo.targetKey, combo.targetDef, combo.mergedLogs, combo.sourceKeysToDelete);
        }
      }

      setIsNameConsolidationMode(false);
      setSelectedKeys([]);
      setConsolidationYaml(null);
      setConsolidationGroups(null);
    } catch (e: any) {
      console.error(e);
      alert("Error applying name consolidation: " + e.message);
    } finally {
      setConsolidationLoading(false);
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
            {(isChatMode || isAgentMode || isDataAccuracyMode || isNameConsolidationMode) && (
              <button 
                onClick={() => {
                  setIsChatMode(false);
                  setIsAgentMode(false);
                  setIsDataAccuracyMode(false);
                  setIsNameConsolidationMode(false);
                }} 
                className="p-1 hover:bg-slate-200 dark:hover:bg-slate-800 rounded transition-colors text-slate-500 cursor-pointer"
              >
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <div>
              <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 font-sans tracking-tight">
                {isChatMode ? "Route Agent Chat" : isAgentMode ? (isMedicalCategorisationMode ? "Clinical Categorisation Agent" : "Clinical Unit Standardization Agent") : isDataAccuracyMode ? "Data Accuracy Agent" : isNameConsolidationMode ? "Name Consolidation Agent" : isBatchPasteMode ? "Batch Consolidation" : "Biomarker Dictionary"}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isChatMode 
                  ? `Discussing standard mappings for ${selectedKeys.length} selected biomarkers` 
                  : isAgentMode
                    ? (isMedicalCategorisationMode ? `Determine medical groupings and risk categories for ${selectedKeys.length} selected biomarkers` : `Standardize units and convert ranges for ${selectedKeys.length} selected biomarkers`)
                    : isDataAccuracyMode
                      ? "Analyze and resolve data discrepancies across dictionary definitions and logs"
                      : isNameConsolidationMode
                        ? `Consolidate and group ${selectedKeys.length} biomarkers with duplicate or similar names`
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

        {/* DATA ACCURACY MODE LAYOUT */}
        {isDataAccuracyMode ? (
          <div className="flex-1 flex flex-col overflow-y-auto bg-slate-50 dark:bg-slate-950">
            {/* Top side: Chat agent thread */}
            <div className={`flex flex-col shrink-0 ${accuracyComparisonResults ? 'h-[400px] border-b border-slate-200 dark:border-slate-800' : 'h-full'}`}>
              {/* Data Accuracy Engine Settings */}
              <div className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 p-3 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between shrink-0">
                <div className="w-full sm:w-56">
                  <LLMSelector
                    selectedModelId={dataAccuracyModel}
                    onChangeModelId={setDataAccuracyModel}
                    label="Data Accuracy Engine"
                  />
                </div>
                <div className="flex items-center gap-3 shrink-0 self-center">
                  <button
                    type="button"
                    onClick={() => setShowDataAccuracyInstructions(true)}
                    className="text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <span>ℹ️ View Programmed Agent Instructions &rarr;</span>
                  </button>
                  {profile.agentAnalyses?.some(a => a.agentType === 'data_accuracy') && (
                    <button
                      type="button"
                      onClick={() => setShowDataAccuracyHistory(!showDataAccuracyHistory)}
                      className="text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer flex items-center gap-1 border-l border-slate-200 dark:border-slate-700 pl-3 ml-2"
                    >
                      <span>📜 {showDataAccuracyHistory ? 'Active Chat' : `Past Logs (${profile.agentAnalyses.filter(a => a.agentType === 'data_accuracy').length})`}</span>
                    </button>
                  )}
                  {dataAccuracyMessages.length > 1 && (
                    showResetChatConfirm ? (
                      <div className="flex items-center gap-1.5 ml-2 border-l border-slate-200 dark:border-slate-700 pl-3">
                        <span className="text-[10px] text-rose-500 font-bold">Clear chat?</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDataAccuracyMessages([
                              {
                                id: 'acc_msg_init',
                                role: 'assistant',
                                content: 'Hello! I am the Data Accuracy Agent, your cleaning specialist. 🧪\n\nShare any new biomarker readings, laboratory results, or logs by **typing them down** or **uploading files/images**.\n\nI will compare your input with your existing database definitions and latest logs to highlight any differences in **Name, Unit, Value, Date, and Comments**, and generate an interactive table so you can choose which information to keep.',
                                timestamp: new Date().toISOString()
                              }
                            ]);
                            setAccuracyComparisonResults(null);
                            setAccuracySelectedFields({});
                            setAccuracyUploadedFiles([]);
                            setDataAccuracyInput('');
                            localStorage.removeItem('data_accuracy_messages');
                            localStorage.removeItem('data_accuracy_comparison_results');
                            localStorage.removeItem('data_accuracy_selected_fields');
                            setShowResetChatConfirm(false);
                          }}
                          className="bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold px-1.5 py-0.5 rounded cursor-pointer"
                        >
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowResetChatConfirm(false);
                          }}
                          className="text-slate-500 hover:text-slate-700 text-[10px] font-bold cursor-pointer"
                        >
                          No
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowResetChatConfirm(true);
                        }}
                        className="text-xs text-rose-600 dark:text-rose-400 font-bold hover:underline cursor-pointer flex items-center gap-1 ml-2 border-l border-slate-200 dark:border-slate-700 pl-3"
                      >
                        <span>🗑️ Reset Chat</span>
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Optional selected biomarkers filter reminder */}
              <div className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 p-2.5 flex flex-wrap gap-1.5 max-h-20 overflow-y-auto shrink-0 text-xs font-medium">
                <span className="text-slate-500 font-bold self-center mr-1">Ontology Scope:</span>
                {selectedKeys.length > 0 ? (
                  selectedKeys.map(k => (
                    <span key={k} className="inline-flex items-center gap-1 bg-indigo-50 dark:bg-indigo-950/45 border border-indigo-100 dark:border-indigo-900/60 text-indigo-700 dark:text-indigo-400 px-1.5 py-0.5 rounded-md font-semibold">
                      {profile.customBiomarkers?.[k]?.name || k}
                    </span>
                  ))
                ) : (
                  <span className="text-slate-400 italic">All available custom & standard biomarkers</span>
                )}
              </div>

              {/* Chat Thread messages or Past Logs History */}
              {showDataAccuracyHistory ? (
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-150 dark:border-slate-800 pb-2.5 mb-2">
                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">Data Accuracy Log History ({profile.agentAnalyses?.filter(a => a.agentType === 'data_accuracy').length || 0})</h4>
                    <button 
                      onClick={() => setShowDataAccuracyHistory(false)}
                      className="text-xs text-indigo-600 hover:underline cursor-pointer font-bold"
                    >
                      &larr; Back to active chat
                    </button>
                  </div>
                  {(profile.agentAnalyses || [])
                    .filter(a => a.agentType === 'data_accuracy')
                    .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)))
                    .map(log => (
                      <div key={log.id} className="p-3.5 bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-xl relative group shadow-sm space-y-2.5">
                        <div className="flex justify-between items-center border-b border-slate-100 dark:border-slate-800 pb-1.5">
                          <span className="text-[10px] font-bold text-slate-400 font-mono">
                            {new Date(log.date).toLocaleString()}
                          </span>
                          {confirmDeleteLogId === log.id ? (
                            <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/20 px-2 py-1 rounded">
                              <span className="text-[9px] text-rose-600 dark:text-rose-400 font-bold">Delete?</span>
                              <button
                                onClick={async () => {
                                  if (onDeleteAnalysis) {
                                    await onDeleteAnalysis(log.id);
                                  } else {
                                    const updatedAnalyses = (profile.agentAnalyses || []).filter(a => a.id !== log.id);
                                    onUpdateProfile({ agentAnalyses: updatedAnalyses });
                                  }
                                  setConfirmDeleteLogId(null);
                                }}
                                className="bg-rose-600 hover:bg-rose-700 text-white text-[9px] font-bold px-1.5 py-0.5 rounded transition-colors cursor-pointer"
                              >
                                Yes
                              </button>
                              <button
                                onClick={() => setConfirmDeleteLogId(null)}
                                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 text-[9px] font-bold transition-colors"
                              >
                                No
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmDeleteLogId(log.id)}
                              className="text-slate-400 hover:text-rose-600 transition-colors cursor-pointer p-1"
                              title="Delete log"
                            >
                              <Trash className="w-3.5 h-3.5 text-rose-500" />
                            </button>
                          )}
                        </div>
                        <div className="space-y-2 text-xs">
                          <div className="bg-slate-50 dark:bg-slate-950 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
                            <p className="font-bold text-slate-500 dark:text-slate-400 mb-1">User Input:</p>
                            <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap font-mono text-[11px] leading-relaxed">{log.result?.inputText}</p>
                          </div>
                          <div className="bg-indigo-50/30 dark:bg-indigo-950/15 p-2.5 rounded-lg border border-indigo-100/30 dark:border-indigo-900/10">
                            <p className="font-bold text-indigo-700 dark:text-indigo-400 mb-1">Analysis Explanation:</p>
                            <p className="text-slate-700 dark:text-slate-300 whitespace-pre-wrap text-[11px] leading-relaxed">{log.result?.explanation}</p>
                          </div>
                          {log.result?.comparisonResults && log.result.comparisonResults.length > 0 && (
                            <button
                              onClick={() => {
                                setAccuracyComparisonResults(log.result.comparisonResults);
                                const initialSelectedFields: any = {};
                                log.result.comparisonResults.forEach((item: any) => {
                                  initialSelectedFields[item.key] = {
                                    name: item.name?.status === 'different' ? 'shared' : 'current',
                                    unit: item.unit?.status === 'different' ? 'shared' : 'current',
                                    value: item.value?.status === 'different' ? 'shared' : 'current',
                                    date: item.date?.status === 'different' ? 'shared' : 'current',
                                    comments: item.comments?.status === 'different' ? 'shared' : 'current',
                                    selected: true
                                  };
                                });
                                setAccuracySelectedFields(initialSelectedFields);
                                setShowDataAccuracyHistory(false);
                              }}
                              className="w-full mt-2 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/40 dark:hover:bg-indigo-950/65 text-indigo-700 dark:text-indigo-400 rounded-lg text-[11px] font-bold transition-all border border-indigo-100/50 dark:border-indigo-900/30 flex items-center justify-center gap-1 cursor-pointer"
                            >
                              <span>🔄 Restore results to resolution table</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  {(profile.agentAnalyses || []).filter(a => a.agentType === 'data_accuracy').length === 0 && (
                    <div className="text-center py-8 text-slate-400 italic text-xs">
                      No past data accuracy analyses logged.
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {/* Chat Thread messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-4">
                    {dataAccuracyMessages.map((msg, idx) => (
                      <div key={msg.id || idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[85%] rounded-2xl p-4 shadow-sm ${
                          msg.role === 'user'
                            ? 'bg-indigo-600 text-white rounded-br-none'
                            : 'bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-slate-800 dark:text-slate-200 rounded-bl-none'
                        }`}>
                          <div className="text-xs font-semibold opacity-70 mb-1">
                            {msg.role === 'user' ? 'You' : 'Data Accuracy Agent'}
                          </div>
                          <div className="text-sm leading-relaxed whitespace-pre-wrap select-text">
                            {msg.content}
                          </div>
                        </div>
                      </div>
                    ))}
                    {dataAccuracyLoading && (
                      <div className="flex justify-start">
                        <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex items-center gap-2 text-slate-500">
                          <Loader className="w-4 h-4 animate-spin text-indigo-500" />
                          <span className="text-xs font-medium">Comparing and checking logs for differences...</span>
                        </div>
                      </div>
                    )}
                    <div ref={accuracyChatEndRef} />
                  </div>

                  {/* Chat Input form area */}
                  <div className="bg-white dark:bg-slate-900 border-t border-slate-150 dark:border-slate-800 p-3 shrink-0 flex flex-col">
                    {/* Uploaded Files Tag Area */}
                    {accuracyUploadedFiles.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2.5">
                        {accuracyUploadedFiles.map((f, i) => (
                          <span key={i} className="inline-flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-950/45 border border-indigo-100 dark:border-indigo-900/60 text-indigo-700 dark:text-indigo-400 px-2 py-0.5 rounded-md text-xs font-semibold">
                            <Paperclip className="w-3 h-3 text-indigo-500" />
                            <span className="max-w-[120px] truncate" title={f.name}>{f.name}</span>
                            <button onClick={() => removeAccuracyFile(i)} className="text-rose-500 hover:text-rose-700 font-bold ml-0.5">×</button>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <button
                        onClick={() => fileInputRef2.current?.click()}
                        className="p-2.5 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700 rounded-xl transition-colors shrink-0"
                        title="Upload lab report files, data text, or images"
                      >
                        <Paperclip className="w-4.5 h-4.5" />
                      </button>
                      <input
                        type="file"
                        ref={fileInputRef2}
                        onChange={handleAccuracyFileSelect}
                        accept="image/*,.txt,.csv"
                        multiple
                        className="hidden"
                      />
                      <input
                        type="text"
                        value={dataAccuracyInput}
                        onChange={e => setDataAccuracyInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSendDataAccuracy()}
                        placeholder="Enter biomarker info (e.g. HbA1c 5.8% on 2026-07-01)..."
                        className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 text-sm outline-none focus:border-indigo-500 dark:focus:border-indigo-500 text-slate-800 dark:text-slate-200 font-medium"
                      />
                      <button
                        onClick={handleSendDataAccuracy}
                        disabled={dataAccuracyLoading || (!dataAccuracyInput.trim() && accuracyUploadedFiles.length === 0)}
                        className="p-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl transition-colors disabled:opacity-50 shrink-0"
                      >
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Bottom side: Interactive Comparison Panel */}
            {accuracyComparisonResults && (
              <div className="w-full flex flex-col bg-white dark:bg-slate-900 shrink-0 min-h-[500px]">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-900/50 sticky top-0 z-10 backdrop-blur">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                      <CheckSquare className="w-4 h-4 text-emerald-500" />
                      Data Resolution Panel
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Compare and resolve differences. Select what to keep.</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {showDiscardResultsConfirm ? (
                      <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-lg p-1">
                        <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold px-1.5">Discard results?</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setAccuracyComparisonResults(null);
                            setAccuracySelectedFields({});
                            localStorage.removeItem('data_accuracy_comparison_results');
                            localStorage.removeItem('data_accuracy_selected_fields');
                            setShowDiscardResultsConfirm(false);
                          }}
                          className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold rounded transition-colors cursor-pointer"
                        >
                          Yes, Clear
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowDiscardResultsConfirm(false);
                          }}
                          className="px-2 py-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-[10px] font-bold transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowDiscardResultsConfirm(true);
                        }}
                        className="px-3 py-2 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer"
                      >
                        <Trash className="w-3.5 h-3.5 text-rose-500" />
                        <span>Discard Results</span>
                      </button>
                    )}
                    <button
                      onClick={applySelectedAccuracyUpdates}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center gap-1.5 shadow-md shadow-emerald-600/10 cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      Apply Updates ({accuracyComparisonResults.filter(item => accuracySelectedFields[item.id]?.selected).length})
                    </button>
                  </div>
                </div>

                <div className="p-5 space-y-5">
                  {Object.entries(accuracyComparisonResults.reduce((acc: any, curr: any) => {
                    if (!acc[curr.key]) acc[curr.key] = [];
                    acc[curr.key].push(curr);
                    return acc;
                  }, {})).map(([bKey, items]: [string, any]) => (
                    <div key={bKey} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden shadow-sm bg-white dark:bg-slate-900">
                      <div className="p-3 bg-slate-100 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                        <div className="flex flex-col text-left">
                          <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{items[0]?.name?.current !== 'N/A' ? items[0]?.name?.current : bKey}</span>
                          <span className="text-[10px] text-slate-500 font-mono">key: {bKey}</span>
                        </div>
                        <span className="px-2 py-1 bg-white dark:bg-slate-900 rounded-md text-[10px] font-bold text-slate-500 shadow-sm border border-slate-200 dark:border-slate-700">
                          {items.length} Log(s)
                        </span>
                      </div>
                      <div className="divide-y divide-slate-100 dark:divide-slate-800/50">
                      {items.map((item: any, idx: number) => {
                        const selects = accuracySelectedFields[item.id] || {
                      name: 'current', unit: 'current', value: 'current', date: 'current', comments: 'current', selected: true
                    };
                    const isRowSelected = selects.selected;

                    return (
                      <div key={item.id} className={`border rounded-xl overflow-hidden transition-all duration-200 ${
                        isRowSelected 
                          ? 'border-indigo-100 dark:border-indigo-950 bg-indigo-50/10 dark:bg-indigo-950/5 shadow-sm' 
                          : 'border-slate-150 dark:border-slate-800 opacity-60'
                      }`}>
                        {/* Header */}
                        <div className="p-3 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-150 dark:border-slate-800 flex items-center justify-between">
                          <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                              type="checkbox"
                              checked={isRowSelected}
                              onChange={(e) => {
                                setAccuracySelectedFields(prev => ({
                                  ...prev,
                                  [item.id]: {
                                    ...prev[item.id],
                                    selected: e.target.checked
                                  }
                                }));
                              }}
                              className="w-4 h-4 text-indigo-600 border-slate-300 dark:border-slate-700 rounded focus:ring-indigo-500"
                            />
                            <div className="flex flex-col text-left">
                              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                                {item.name.current !== 'N/A' ? item.name.current : item.key}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono">key: {item.key}</span>
                            </div>
                          </label>

                          <div className="flex items-center gap-1.5">
                            {item.matched ? (
                              <span className="bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                                Matched Key
                              </span>
                            ) : (
                              <span className="bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider">
                                New Key Suggested
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Details Grid (only rendered if selected) */}
                        {isRowSelected && (
                          <div className="p-3 space-y-3">
                            <table className="w-full text-xs font-medium text-slate-600 dark:text-slate-400 border-collapse">
                              <thead>
                                <tr className="border-b border-slate-100 dark:border-slate-800/80 text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
                                  <th className="pb-1.5 text-left font-bold w-1/5">Field</th>
                                  <th className="pb-1.5 text-left font-bold w-2/5">Database Moment</th>
                                  <th className="pb-1.5 text-left font-bold w-2/5">Shared Value</th>
                                  <th className="pb-1.5 text-center font-bold w-[100px]">Result</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50 dark:divide-slate-800/30">
                                {/* Name */}
                                {idx === 0 && <tr className="py-2">
                                  <td className="py-2.5 font-bold text-slate-500 text-left">Biomarker Name</td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], name: 'current' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.name === 'current' 
                                          ? 'border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold ring-2 ring-indigo-500/20' 
                                          : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.name === 'current' ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300'}`}>
                                          {selects.name === 'current' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="truncate">{item.name.current}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], name: 'shared' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.name === 'shared' 
                                          ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold ring-2 ring-emerald-500/20' 
                                          : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.name === 'shared' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>
                                          {selects.name === 'shared' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="truncate">{item.name.shared}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-center">
                                    {item.name.status === 'same' ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Same
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Different
                                      </span>
                                    )}
                                  </td>
                                </tr>}

                                {/* Unit */}
                                {idx === 0 && <tr className="py-2">
                                  <td className="py-2.5 font-bold text-slate-500 text-left">Unit</td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], unit: 'current' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.unit === 'current' 
                                          ? 'border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold ring-2 ring-indigo-500/20' 
                                          : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.unit === 'current' ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300'}`}>
                                          {selects.unit === 'current' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="font-mono">{item.unit.current || 'None'}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], unit: 'shared' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.unit === 'shared' 
                                          ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold ring-2 ring-emerald-500/20' 
                                          : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.unit === 'shared' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>
                                          {selects.unit === 'shared' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="font-mono">{item.unit.shared || 'None'}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-center">
                                    {item.unit.status === 'same' ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Same
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Different
                                      </span>
                                    )}
                                  </td>
                                </tr>}

                                {/* Value */}
                                <tr className="py-2">
                                  <td className="py-2.5 font-bold text-slate-500 text-left">Value</td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], value: 'current' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.value === 'current' 
                                          ? 'border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold ring-2 ring-indigo-500/20' 
                                          : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.value === 'current' ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300'}`}>
                                          {selects.value === 'current' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="font-bold">{item.value.current}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], value: 'shared' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.value === 'shared' 
                                          ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold ring-2 ring-emerald-500/20' 
                                          : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.value === 'shared' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>
                                          {selects.value === 'shared' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="font-bold">{item.value.shared}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-center">
                                    {item.value.status === 'same' ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Same
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Different
                                      </span>
                                    )}
                                  </td>
                                </tr>

                                {/* Date */}
                                <tr className="py-2">
                                  <td className="py-2.5 font-bold text-slate-500 text-left">Date</td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], date: 'current' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.date === 'current' 
                                          ? 'border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold ring-2 ring-indigo-500/20' 
                                          : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.date === 'current' ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300'}`}>
                                          {selects.date === 'current' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="font-semibold">{item.date.current}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], date: 'shared' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.date === 'shared' 
                                          ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold ring-2 ring-emerald-500/20' 
                                          : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-center gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border ${selects.date === 'shared' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>
                                          {selects.date === 'shared' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="font-semibold">{item.date.shared}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-center">
                                    {item.date.status === 'same' ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Same
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Different
                                      </span>
                                    )}
                                  </td>
                                </tr>

                                {/* Comments */}
                                <tr className="py-2">
                                  <td className="py-2.5 font-bold text-slate-500 text-left">Comments</td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], comments: 'current' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.comments === 'current' 
                                          ? 'border-indigo-200 dark:border-indigo-900 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 font-bold ring-2 ring-indigo-500/20' 
                                          : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-start gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border mt-0.5 ${selects.comments === 'current' ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-slate-300'}`}>
                                          {selects.comments === 'current' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="text-[10px] leading-relaxed block max-h-12 overflow-y-auto w-full break-words text-left">{item.comments.current || 'No current comments'}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-left">
                                    <button
                                      onClick={() => setAccuracySelectedFields(prev => ({ ...prev, [item.id]: { ...prev[item.id], comments: 'shared' } }))}
                                      className={`px-2 py-1.5 rounded-lg text-left w-11/12 border transition-all cursor-pointer ${
                                        selects.comments === 'shared' 
                                          ? 'border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold ring-2 ring-emerald-500/20' 
                                          : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 hover:bg-slate-50 text-slate-500'
                                      }`}
                                    >
                                      <div className="flex items-start gap-1.5">
                                        <div className={`w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center border mt-0.5 ${selects.comments === 'shared' ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300'}`}>
                                          {selects.comments === 'shared' && <span className="text-[8px]">✓</span>}
                                        </div>
                                        <span className="text-[10px] leading-relaxed block max-h-12 overflow-y-auto w-full break-words text-left">{item.comments.shared || 'No comment provided'}</span>
                                      </div>
                                    </button>
                                  </td>
                                  <td className="py-2.5 text-center">
                                    {item.comments.status === 'same' ? (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Same
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 px-2 py-0.5 rounded-full font-bold">
                                        Different
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                  </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : isNameConsolidationMode ? (
          <div className="flex-1 flex flex-col overflow-y-auto bg-slate-50 dark:bg-slate-950">
            {/* Top side: Chat thread */}
            <div className={`flex flex-col shrink-0 ${consolidationGroups ? 'h-[400px] border-b border-slate-200 dark:border-slate-800' : 'h-full'}`}>
              {/* Settings Panel */}
              <div className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 p-3 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between shrink-0">
                <div className="w-full sm:w-56">
                  <LLMSelector
                    selectedModelId={nameConsolidationModel}
                    onChangeModelId={setNameConsolidationModel}
                    label="Consolidation Engine"
                  />
                </div>
                <div className="flex items-center gap-3 shrink-0 self-center">
                  <button
                    type="button"
                    onClick={() => setShowConsolidationInstructions(true)}
                    className="text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer flex items-center gap-1"
                  >
                    <span>ℹ️ View Programmed Agent Instructions &rarr;</span>
                  </button>
                  {consolidationMessages.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setConsolidationMessages([])}
                      className="text-xs text-rose-500 font-bold hover:underline cursor-pointer flex items-center gap-1 border-l border-slate-200 dark:border-slate-700 pl-3 ml-2"
                    >
                      Clear Chat
                    </button>
                  )}
                </div>
              </div>

              {/* Chat Thread */}
              <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4 bg-slate-50 dark:bg-slate-900/50">
                {consolidationMessages.length === 0 ? (
                  <div className="m-auto max-w-sm text-center">
                    <div className="w-16 h-16 bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-sm">
                      <BrainCircuit className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 mb-2 font-sans tracking-tight">Name Consolidation Agent</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      Select biomarkers you want to consolidate. I will analyze their names, standard medical groupings, units, and ranges to find duplicates and automatically group them.
                    </p>
                    <div className="mt-4 p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 text-left">
                      <div className="font-bold text-slate-700 dark:text-slate-300 mb-2">Selected Biomarkers ({selectedKeys.length}):</div>
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                        {selectedKeys.length === 0 ? (
                          <span className="italic text-slate-400">No biomarkers selected. Select them from the list.</span>
                        ) : (
                          selectedKeys.map(k => {
                            const def = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((b: any) => b.key === k);
                            return (
                              <span key={k} className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 px-2 py-0.5 rounded-md">
                                {def?.name || k}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {consolidationMessages.map((msg, idx) => (
                      <div key={idx} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                        {msg.role === 'agent' && (
                          <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0">
                            <BrainCircuit className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                          </div>
                        )}
                        <div className={`max-w-[85%] rounded-2xl p-4 ${
                          msg.role === 'user' 
                            ? 'bg-indigo-600 text-white shadow-md' 
                            : msg.isError
                              ? 'bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-400'
                              : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 shadow-sm'
                        }`}>
                          <div className="whitespace-pre-wrap text-[13px] leading-relaxed font-sans">{msg.content}</div>
                          {msg.timestamp && (
                            <div className={`text-[10px] mt-2 ${msg.role === 'user' ? 'text-indigo-200' : 'text-slate-400'}`}>
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {consolidationLoading && (
                      <div className="flex gap-3 justify-start">
                        <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center shrink-0">
                          <BrainCircuit className="w-4 h-4 text-indigo-600 dark:text-indigo-400 animate-pulse" />
                        </div>
                        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex items-center gap-2">
                          <div className="flex space-x-1">
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                            <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce"></div>
                          </div>
                          <span className="text-[13px] text-slate-500 font-medium ml-2">Analyzing biomarkers...</span>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Chat Input */}
              <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
                <div className="flex flex-col gap-2">
                  <div className="relative w-full">
                    <input
                      type="text"
                      className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl pl-4 pr-12 py-3 text-[13px] text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500"
                      placeholder="Ask the agent to group specific items or hit Start..."
                      value={consolidationInput}
                      onChange={e => setConsolidationInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleRunConsolidationAgent()}
                      disabled={consolidationLoading}
                    />
                    <button
                      type="button"
                      onClick={() => handleRunConsolidationAgent()}
                      disabled={consolidationLoading || (!consolidationInput.trim() && selectedKeys.length === 0)}
                      className="absolute right-2 top-2 bottom-2 aspect-square flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleRunConsolidationAgent(true)}
                    disabled={consolidationLoading || selectedKeys.length === 0}
                    className="w-full py-2.5 rounded-xl bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 hover:bg-violet-200 dark:hover:bg-violet-900/50 transition-colors disabled:opacity-50 font-bold text-sm flex items-center justify-center gap-2"
                  >
                    <BrainCircuit className="w-4 h-4" />
                    Start
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom side: Consolidation Data */}
            {consolidationGroups && (
              <div className="w-full flex flex-col bg-slate-50 dark:bg-slate-950/20 relative shadow-inner shrink-0 min-h-[500px]">
                <div className="p-4 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 shrink-0 flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm flex items-center gap-2">
                      <CheckSquare className="w-4 h-4 text-emerald-500" />
                      Consolidation Groups
                    </h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">Review and approve groups to combine historical records</p>
                  </div>
                  <button
                    onClick={handleApplyConsolidation}
                    disabled={consolidationLoading}
                    className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-md flex items-center gap-1 transition-all disabled:opacity-50"
                  >
                    {consolidationLoading ? <div className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {consolidationLoading ? 'Applying...' : 'Approve & Apply'}
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-4 space-y-6">
                  {consolidationGroups.map((group, groupIdx) => {
                    const edits = groupEdits[groupIdx] || {
                      recommendedClinicalName: '',
                      recommendedUniqueKey: '',
                      masterKey: '',
                      excludedKeys: {}
                    };

                    const masterBio = group.biomarkers?.find((b: any) => b.key === edits.masterKey) || group.biomarkers?.[0];

                    return (
                      <div key={groupIdx} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm overflow-hidden p-4 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Recommended Name</label>
                            <input
                              type="text"
                              className="w-full text-xs font-medium bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                              value={edits.recommendedClinicalName}
                              onChange={(e) => {
                                setGroupEdits({
                                  ...groupEdits,
                                  [groupIdx]: {
                                    ...edits,
                                    recommendedClinicalName: e.target.value
                                  }
                                });
                              }}
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Target Key</label>
                            <input
                              type="text"
                              className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                              value={edits.recommendedUniqueKey}
                              onChange={(e) => {
                                setGroupEdits({
                                  ...groupEdits,
                                  [groupIdx]: {
                                    ...edits,
                                    recommendedUniqueKey: e.target.value
                                  }
                                });
                              }}
                            />
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Final Unit</label>
                            <input
                              type="text"
                              className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                              value={edits.unit !== undefined ? edits.unit : ''}
                              onChange={(e) => {
                                setGroupEdits({
                                  ...groupEdits,
                                  [groupIdx]: { ...edits, unit: e.target.value }
                                });
                              }}
                            />
                          </div>
                          <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Final Normal Range</label>
                            <input
                              type="text"
                              className="w-full text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
                              value={edits.normalRange !== undefined ? edits.normalRange : ''}
                              onChange={(e) => {
                                setGroupEdits({
                                  ...groupEdits,
                                  [groupIdx]: { ...edits, normalRange: e.target.value }
                                });
                              }}
                            />
                          </div>
                        </div>
                        
                        <div>
                          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Final Description</label>
                          <textarea
                            className="w-full text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:border-indigo-500 min-h-[60px]"
                            value={edits.description !== undefined ? edits.description : ''}
                            onChange={(e) => {
                              setGroupEdits({
                                ...groupEdits,
                                [groupIdx]: { ...edits, description: e.target.value }
                              });
                            }}
                          />
                        </div>

                        <div className="overflow-x-auto border border-slate-100 dark:border-slate-800/50 rounded-lg">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="bg-slate-50 dark:bg-slate-950 text-[10px] font-bold text-slate-500 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800/50">
                                <th className="py-2 px-3 text-center w-12">Combine</th>
                                <th className="py-2 px-3 text-center w-12">Master</th>
                                <th className="py-2 px-3">Key / Name</th>
                                <th className="py-2 px-3">Grouping</th>
                                <th className="py-2 px-3">Unit</th>
                                <th className="py-2 px-3 min-w-[80px]">Range</th>
                                <th className="py-2 px-3 min-w-[150px]">Description</th>
                                <th className="py-2 px-3">Logs</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.biomarkers?.map((b: any, bIdx: number) => {
                                const isExcluded = !!edits.excludedKeys[b.key];
                                const isMaster = edits.masterKey === b.key;

                                return (
                                  <tr 
                                    key={bIdx} 
                                    className={`border-b border-slate-100 dark:border-slate-800/30 text-xs ${isExcluded ? 'opacity-40 bg-slate-50/50 dark:bg-slate-950/20' : ''} ${isMaster ? 'bg-violet-50/30 dark:bg-violet-900/10' : ''}`}
                                  >
                                    <td className="py-2.5 px-3 text-center">
                                      <input
                                        type="checkbox"
                                        checked={!isExcluded}
                                        disabled={isMaster}
                                        className="w-3.5 h-3.5 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500 cursor-pointer"
                                        onChange={(e) => {
                                          const newExcluded = { ...edits.excludedKeys };
                                          if (e.target.checked) {
                                            delete newExcluded[b.key];
                                          } else {
                                            newExcluded[b.key] = true;
                                          }
                                          setGroupEdits({
                                            ...groupEdits,
                                            [groupIdx]: {
                                              ...edits,
                                              excludedKeys: newExcluded
                                            }
                                          });
                                        }}
                                      />
                                    </td>
                                    <td className="py-2.5 px-3 text-center">
                                      <input
                                        type="radio"
                                        name={`group_master_${groupIdx}`}
                                        checked={isMaster}
                                        disabled={isExcluded}
                                        className="w-3.5 h-3.5 text-indigo-600 border-slate-300 focus:ring-indigo-500 cursor-pointer"
                                        onChange={() => {
                                          setGroupEdits({
                                            ...groupEdits,
                                            [groupIdx]: {
                                              ...edits,
                                              masterKey: b.key
                                            }
                                          });
                                        }}
                                      />
                                    </td>
                                    <td className="py-2.5 px-3">
                                      <div className="font-medium text-slate-800 dark:text-slate-200">{b.name}</div>
                                      <div className="font-mono text-[10px] text-slate-400 mt-0.5">{b.key}</div>
                                    </td>
                                    <td className="py-2.5 px-3">
                                      <div className="text-slate-600 dark:text-slate-400 mb-1">{b.medicalGrouping || '-'}</div>
                                      {(() => {
                                        const origDef = profile.customBiomarkers?.[b.key] || biomarkerDefinitions.find((def: any) => def.key === b.key) || {};
                                        const rTags = (origDef as any).riskCategories || [];
                                        const cTags = (origDef as any).potentialMedicalConditions || [];
                                        if (rTags.length === 0 && cTags.length === 0) return null;
                                        return (
                                          <div className="flex flex-wrap gap-1">
                                            {rTags.map((r: string, i: number) => (
                                              <span key={i} className="text-[9px] font-bold px-1.5 py-0.5 bg-rose-50 text-rose-600 dark:bg-rose-900/20 dark:text-rose-400 rounded-full border border-rose-100 dark:border-rose-900/30 whitespace-nowrap">
                                                {r}
                                              </span>
                                            ))}
                                            {cTags.map((c: string, i: number) => (
                                              <span key={i} className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-50 text-amber-600 dark:bg-amber-900/20 dark:text-amber-400 rounded-full border border-amber-100 dark:border-amber-900/30 whitespace-nowrap">
                                                {c}
                                              </span>
                                            ))}
                                          </div>
                                        );
                                      })()}
                                    </td>
                                    <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">{b.unit || '-'}</td>
                                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 text-[10px] whitespace-pre-wrap">{b.range || '-'}</td>
                                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 text-[10px]">{b.description || '-'}</td>
                                    <td className="py-2.5 px-3 font-medium text-slate-600 dark:text-slate-400">
                                      {biomarkerHistory.filter((h: any) => h.biomarkers && h.biomarkers[b.key] !== undefined).length}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                  <div className="mt-8 bg-slate-900 rounded-xl overflow-hidden shadow-inner">
                    <div className="p-2 bg-slate-950 border-b border-slate-800 flex items-center justify-between text-slate-400 text-[10px] font-mono">
                      <span className="flex items-center gap-1.5"><FileCode className="w-3.5 h-3.5" /> RAW JSON</span>
                    </div>
                    <div className="p-4 text-slate-300 font-mono text-[11px] whitespace-pre-wrap select-all">
                      {consolidationYaml}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : isChatMode ? (
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
                              {(() => {
                                const sourceDef = profile.customBiomarkers?.[src] || biomarkerDefinitions.find(d => d.key === src);
                                const latestVal = biomarkers[src] !== undefined ? biomarkers[src] : 'N/A';
                                return (
                                  <div className="flex flex-col items-start max-w-[45%] text-left">
                                    <span className="text-rose-500 dark:text-rose-400 truncate w-full" title={src}>{sourceDef?.name || src}</span>
                                    <div className="flex items-center gap-1 mt-0.5">
                                      {latestVal !== 'N/A' && <span className="text-[9px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800/80 px-1 rounded">Val: {latestVal}</span>}
                                      {sourceDef?.unit && <span className="text-[9px] text-slate-400 font-mono">{sourceDef.unit}</span>}
                                    </div>
                                    <span className="text-[8px] text-slate-400 truncate w-full opacity-70 mt-0.5" title={src}>{src}</span>
                                  </div>
                                );
                              })()}
                              <span className="text-slate-400">→</span>
                              {(() => {
                                const tgtKey = String(tgt); const targetDef = profile.customBiomarkers?.[tgtKey] || biomarkerDefinitions.find(d => d.key === tgtKey);
                                const latestVal = biomarkers[tgtKey] !== undefined ? biomarkers[tgtKey] : 'N/A';
                                return (
                                  <div className="flex flex-col items-end max-w-[45%] text-right">
                                    <span className="text-emerald-500 dark:text-emerald-400 truncate w-full" title={tgtKey}>{src === tgtKey ? 'Approve as New Standard' : (targetDef?.name || tgtKey)}</span>
                                    {src !== tgtKey && (
                                      <div className="flex items-center gap-1 mt-0.5 justify-end">
                                        {latestVal !== 'N/A' && <span className="text-[9px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800/80 px-1 rounded">Val: {latestVal}</span>}
                                        {targetDef?.unit && <span className="text-[9px] text-slate-400 font-mono">{targetDef.unit}</span>}
                                      </div>
                                    )}
                                    <span className="text-[8px] text-slate-400 truncate w-full opacity-70 mt-0.5 text-right" title={tgtKey}>{tgtKey}</span>
                                  </div>
                                );
                              })()}
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
        ) : isAgentMode ? (
          /* CLINICAL UNIT STANDARDIZATION AGENT MODE LAYOUT */
          <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
            {/* Selected Biomarkers Panel */}
            <div className="bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800 p-3 flex flex-wrap gap-1.5 max-h-24 overflow-y-auto shrink-0">
              <span className="text-xs font-bold text-slate-500 self-center mr-1">Selected Biomarkers:</span>
              {selectedKeys.map(k => {
                const def = profile.customBiomarkers?.[k] || biomarkerDefinitions.find((b: any) => b.key === k);
                return (
                  <span key={k} className="inline-flex items-center gap-1 bg-violet-50 dark:bg-violet-900/30 border border-violet-100 dark:border-violet-800 text-violet-700 dark:text-violet-300 px-2 py-0.5 rounded-full text-xs font-medium">
                    {def?.name || k} ({def?.unit || 'No Unit'})
                    <button onClick={() => handleToggleSelect(k)} className="text-violet-400 hover:text-violet-600 font-bold ml-0.5">×</button>
                  </span>
                );
              })}
              {selectedKeys.length === 0 && (
                <span className="text-xs text-amber-500 font-medium">No biomarkers selected. Close agent to return.</span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Agent Engine & Instructions Controls */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
                <div className="w-full sm:w-64">
                  <LLMSelector
                    selectedModelId={isMedicalCategorisationMode ? medicalCategoriseModel : standardizeModel}
                    onChangeModelId={isMedicalCategorisationMode ? setMedicalCategoriseModel : setStandardizeModel}
                    label={isMedicalCategorisationMode ? "Categorization Engine" : "Standardization Engine"}
                  />
                </div>
                <button
                  type="button"
                  onClick={() => isMedicalCategorisationMode ? setShowMedicalInstructions(true) : setShowStandardizeInstructions(true)}
                  className="text-xs text-indigo-600 dark:text-indigo-400 font-bold hover:underline cursor-pointer flex items-center gap-1.5 self-center"
                >
                  <span>ℹ️ View Programmed Agent Instructions &rarr;</span>
                </button>
              </div>

              {/* Metric Selection controls */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                {!isMedicalCategorisationMode && (
                  <>
                    <div>
                      <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <CheckSquare className="w-4 h-4 text-violet-500" />
                        Step 1: Choose Target Metric System
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Select whether the standardization agent should target the International System of Units (SI/Metric) or US Customary units.
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <button
                        type="button"
                        onClick={() => setTargetMetric('si')}
                        className={`p-4 rounded-xl border text-left transition-all ${
                          targetMetric === 'si'
                            ? 'border-violet-500 bg-violet-50/50 dark:bg-violet-950/20 ring-2 ring-violet-500/20'
                            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center justify-between">
                          <span>SI System (Metric)</span>
                          {targetMetric === 'si' && <CheckCircle className="w-4 h-4 text-violet-500" />}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                          Uses standard metric units (e.g., mmol/L for glucose, g/L for protein, pmol/L for hormones). Standard in global clinical research.
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() => setTargetMetric('us')}
                        className={`p-4 rounded-xl border text-left transition-all ${
                          targetMetric === 'us'
                            ? 'border-violet-500 bg-violet-50/50 dark:bg-violet-950/20 ring-2 ring-violet-500/20'
                            : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center justify-between">
                          <span>US Customary System</span>
                          {targetMetric === 'us' && <CheckCircle className="w-4 h-4 text-violet-500" />}
                        </div>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                          Uses standard United States clinical units (e.g., mg/dL for glucose, g/dL for protein, pg/mL for hormones).
                        </p>
                      </button>
                    </div>
                  </>
                )}

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={handleRunStandardizationAgent}
                    disabled={agentLoading || selectedKeys.length === 0}
                    className="w-full py-3 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 shadow-md shadow-indigo-600/10 disabled:opacity-50"
                  >
                    {agentLoading ? (
                      <>
                        <Loader className="w-4 h-4 animate-spin" />
                        {isMedicalCategorisationMode ? 'Agent Working in YAML to Add Categorisations...' : 'Agent Working in YAML to Add Standardized Units...'}
                      </>
                    ) : (
                      <>
                        <ArrowRight className="w-4 h-4" />
                        {isMedicalCategorisationMode ? 'Run Clinical Categorisation Agent (YAML)' : 'Run Clinical Unit Standardization Agent (YAML)'}
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Loader block for agent operations */}
              {agentLoading && (
                <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col items-center justify-center text-center space-y-4 shadow-sm">
                  <Loader className="w-8 h-8 animate-spin text-violet-500" />
                  <div>
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                      {isMedicalCategorisationMode ? 'Categorising Biomarkers...' : 'Standardizing Biomarker Definitions...'}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">
                      {isMedicalCategorisationMode
                        ? 'The clinical AI agent is analyzing the biomarkers to assign medical groupings and risk categories, outputting validated YAML configuration objects.'
                        : `The clinical AI agent is parsing the selected biomarkers, researching reference units for ${targetMetric.toUpperCase()}, and outputting clean, validated YAML configuration objects with suggested ranges.`}
                    </p>
                  </div>
                </div>
              )}

              {/* Agent suggestions and validation blocks */}
              {standardizationYaml && (
                <div className="space-y-6">
                  {/* Generated RAW YAML display block */}
                  <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 font-mono flex items-center gap-1.5">
                        <FileCode className="w-4 h-4 text-violet-500" />
                        AGENT_METADATA_SPECIFICATION.YAML
                      </h4>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(standardizationYaml || "");
                          alert("YAML code copied to clipboard!");
                        }}
                        className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <Copy className="w-3 h-3" /> Copy YAML
                      </button>
                    </div>
                    <pre className="p-4 bg-slate-950 text-slate-100 rounded-xl text-[11px] font-mono leading-relaxed overflow-x-auto max-h-48 border border-slate-800 select-text">
                      {standardizationYaml}
                    </pre>
                  </div>

                  {/* Aesthetic Comparison Table and Approval summary */}
                  {standardizationSummary && (
                    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-sm space-y-4">
                      <div>
                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                          <CheckCircle className="w-4 h-4 text-emerald-500" />
                          {isMedicalCategorisationMode ? "Step 2: Review Proposed Categorisations" : "Step 2: Review Proposed Standardizations"}
                        </h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          {isMedicalCategorisationMode 
                            ? "Review the physiological groupings and risk categories computed by the clinical categorisation agent. If approved, these will be applied to your active biomarker dictionary." 
                            : "Review the units and reference ranges computed by the clinical standardization agent. If approved, these will be applied to your active biomarker dictionary."}
                        </p>
                      </div>

                      <div className="border border-slate-100 dark:border-slate-800 rounded-xl overflow-hidden">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-100 dark:border-slate-800 text-slate-700 dark:text-slate-200 font-semibold">
                              <th className="p-3">Biomarker</th>
                              {isMedicalCategorisationMode ? (
                                <>
                                  <th className="p-3">Medical Practice</th>
                                  <th className="p-3">Risk Categories</th>
                                  <th className="p-3">Conditions</th>
                                </>
                              ) : (
                                <th className="p-3">Proposed Unit</th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50 text-slate-600 dark:text-slate-300">
                            {standardizationSummary.map((item: any, idx: number) => {
                              const originalDef = profile.customBiomarkers?.[item.key] || biomarkerDefinitions.find((b: any) => b.key === item.key);
                              
                              let parsedRisks = item.riskCategories;
                              if (typeof parsedRisks === 'string') {
                                try { parsedRisks = JSON.parse(parsedRisks); } catch (e) { parsedRisks = parsedRisks.split(',').map((s: string) => s.trim()); }
                              }
                              let parsedConds = item.potentialMedicalConditions;
                              if (typeof parsedConds === 'string') {
                                try { parsedConds = JSON.parse(parsedConds); } catch (e) { parsedConds = parsedConds.split(',').map((s: string) => s.trim()); }
                              }
                              
                              return (
                                <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/20">
                                  <td className="p-3 font-medium min-w-[120px]">
                                    <div className="font-bold text-slate-800 dark:text-slate-100">{item.name || item.key}</div>
                                    <div className="text-[10px] text-slate-400 font-mono">{item.key}</div>
                                  </td>
                                  {isMedicalCategorisationMode ? (
                                    <>
                                      <td className="p-3">
                                        <div className="flex flex-col gap-1">
                                          {originalDef?.standardMedicalGrouping && originalDef.standardMedicalGrouping !== item.standardMedicalGrouping && (
                                            <span className="text-slate-400 line-through text-[10px]">{originalDef.standardMedicalGrouping}</span>
                                          )}
                                          <span className="text-emerald-600 dark:text-emerald-400 font-bold">{item.standardMedicalGrouping || 'N/A'}</span>
                                        </div>
                                      </td>
                                      <td className="p-3">
                                        <div className="flex flex-wrap gap-1">
                                          {/* Show deleted risk categories */}
                                          {(originalDef?.riskCategories || []).filter((r: string) => !(Array.isArray(parsedRisks) ? parsedRisks : []).includes(r)).map((r: string, i: number) => (
                                            <span key={"del-"+i} className="px-1.5 py-0.5 border border-rose-200 dark:border-rose-900/30 text-slate-400 line-through rounded text-[10px]">{r}</span>
                                          ))}
                                          {(Array.isArray(parsedRisks) ? parsedRisks : []).map((r: string, i: number) => (
                                            <span key={i} className="px-1.5 py-0.5 bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-400 rounded text-[10px]">{r}</span>
                                          ))}
                                        </div>
                                      </td>
                                      <td className="p-3">
                                        <div className="flex flex-wrap gap-1">
                                          {/* Show deleted conditions */}
                                          {(originalDef?.potentialMedicalConditions || []).filter((c: string) => !(Array.isArray(parsedConds) ? parsedConds : []).includes(c)).map((c: string, i: number) => (
                                            <span key={"del-"+i} className="px-1.5 py-0.5 border border-indigo-200 dark:border-indigo-900/30 text-slate-400 line-through rounded text-[10px]">{c}</span>
                                          ))}
                                          {(Array.isArray(parsedConds) ? parsedConds : []).map((c: string, i: number) => (
                                            <span key={i} className="px-1.5 py-0.5 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 rounded text-[10px]">{c}</span>
                                          ))}
                                        </div>
                                      </td>
                                    </>
                                  ) : (
                                    <td className="p-3 font-mono">
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-slate-400 line-through text-[10px]">{originalDef?.unit || "none"}</span>
                                        <span className="text-slate-500">→</span>
                                        <span className="text-emerald-600 dark:text-emerald-400 font-bold">{item.unit}</span>
                                      </div>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Approval and application controls */}
                      <div className="flex gap-3 pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            setStandardizationYaml(null);
                            setStandardizationSummary(null);
                          }}
                          className="flex-1 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
                        >
                          Reset Configuration
                        </button>
                        <button
                          type="button"
                          onClick={handleApplyStandardization}
                          className="flex-1 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/10"
                        >
                          <CheckCircle className="w-4 h-4" />
                          {isMedicalCategorisationMode ? "Approve & Apply Categorisation" : "Approve & Apply Unit Standardization"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ) : isBatchPasteMode ? (
          /* BATCH CONSOLIDATION MODE LAYOUT */
          <div className="flex-1 p-5 overflow-y-auto space-y-5 bg-slate-50 dark:bg-slate-950">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <FileCode className="w-4 h-4 text-indigo-500" />
                  Batch Consolidate (JSON)
                </h3>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Paste a JSON object to merge biomarkers or update their definitions.
              </p>
              
              <details className="text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-950 overflow-hidden">
                <summary className="font-bold text-slate-700 dark:text-slate-300 p-3 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-900 transition-colors select-none">
                  Key Reference & Format Guide
                </summary>
                <div className="p-3 border-t border-slate-200 dark:border-slate-700 space-y-3 text-slate-600 dark:text-slate-400">
                  <p><strong>Option 1: Merge Historical Logs</strong><br/>
                  Map a source term to a target snake_case key to combine their logs.</p>
                  <pre className="bg-slate-100 dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800 font-mono text-[10px]">
{`{
  "HbA1c": "hba1c",
  "0": "hba1c"
}`}
                  </pre>
                  
                  <p><strong>Option 2: Batch Update (Array)</strong><br/>
                  Pass a list of objects with the <code>key</code> property to update multiple biomarkers at once.</p>
                  <pre className="bg-slate-100 dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800 font-mono text-[10px]">{JSON.stringify([
  {
    "key": "hba1c",
    "name": "HbA1c",
    "unit": "mmol/mol",
    "normalRange": "20 - 41"
  }
], null, 2)}
                  </pre>
                  
                  <p className="mt-3"><strong>Option 3: Dictionary Map</strong><br/>
                  Update multiple properties using the biomarker key as the property name.</p>
                  <pre className="bg-slate-100 dark:bg-slate-900 p-2 rounded border border-slate-200 dark:border-slate-800 font-mono text-[10px]">{JSON.stringify({
  "hba1c": {
    "name": "HbA1c",
    "unit": "mmol/mol",
    "normalRange": "20 - 41"
  }
}, null, 2)}
                  </pre>
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <div>
                      <strong>Supported Keys:</strong>
                      <ul className="list-disc pl-4 mt-1 space-y-1 text-[10px]">
                        <li><code>name</code> (string)</li>
                        <li><code>unit</code> (string)</li>
                        <li><code>normalRange</code> (string)</li>
                        <li><code>description</code> (string)</li>
                      </ul>
                    </div>
                    <div>
                      <ul className="list-disc pl-4 mt-5 space-y-1 text-[10px]">
                        <li><code>standardMedicalGrouping</code> (string)</li>
                        <li><code>riskCategories</code> (array of strings)</li>
                        <li><code>potentialMedicalConditions</code> (array of strings)</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </details>
              
              <textarea
                value={pasteText}
                onChange={e => handlePasteChange(e.target.value)}
                rows={10}
                placeholder={`{\n  "HbA1c": "hba1c",\n  "hba1c": {\n    "normalRange": "20 - 41"\n  }\n}`}
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
                    {Array.isArray(parsedMapping) ? parsedMapping.slice(0, 10).map((item, idx) => (
                      <div key={idx} className="flex flex-col border-b border-emerald-100/30 py-1 gap-0.5">
                        <span className="font-bold text-emerald-800 dark:text-emerald-300">Target Key: {item.key || 'Missing key!'}</span>
                        <div className="flex flex-col pl-2 border-l border-emerald-200/50">
                          {Object.entries(item).filter(([k]) => k !== 'key').map(([k, v]) => (
                            <span key={k} className="truncate"><span className="opacity-70">{k}:</span> {JSON.stringify(v)}</span>
                          ))}
                        </div>
                      </div>
                    )) : Object.entries(parsedMapping).slice(0, 10).map(([src, tgt]) => (
                      <div key={src} className="flex justify-between border-b border-emerald-100/30 py-0.5">
                        <span className="truncate max-w-[48%]">{src}</span>
                        <span className="text-emerald-500">→</span>
                        <span className="truncate max-w-[48%]">
                          {typeof tgt === 'string' ? tgt : <pre className="inline text-[9px] bg-emerald-100/50 dark:bg-emerald-900/50 p-0.5 rounded">{JSON.stringify(tgt)}</pre>}
                        </span>
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
              <div className="flex items-center gap-2 flex-wrap">
                <input 
                  type="text" 
                  placeholder="Search biomarkers..." 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs outline-none focus:border-indigo-500 w-48 text-slate-700 dark:text-slate-200"
                />
                <select
                  value={filterOption}
                  onChange={(e) => setFilterOption(e.target.value as any)}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-500 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <option value="all">All Approved ({allApprovedKeysUnfiltered.length})</option>
                  <option value="overrides">Custom Overrides ({allApprovedKeysUnfiltered.filter(hasActualOverride).length})</option>
                  <option value="missing_units">Missing Units ({missingUnitsCount})</option>
                </select>
                <select
                  value={filterTag || ""}
                  onChange={(e) => setFilterTag(e.target.value || null)}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 outline-none focus:border-indigo-500 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <option value="">All Tags</option>
                  <optgroup label="Medical Practice">
                    {Array.from(allGroupings).sort().map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Risk Categories">
                    {Array.from(allRisks).sort().map(r => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Conditions">
                    {Array.from(allConditions).sort().map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </optgroup>
                </select>
                <button
                  onClick={() => setIsBatchPasteMode(true)}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1"
                >
                  <FileCode className="w-3.5 h-3.5 text-indigo-500" />
                  Batch Consolidate
                </button>
                <button
                  onClick={() => {
                    const filteredKeysToCopy = selectedKeys.length > 0 ? selectedKeys : Array.from(new Set([...toApproveKeys, ...allApprovedKeys]));
                    const textContent = filteredKeysToCopy.map(k => {
                      const d = (profile.customBiomarkers?.[k] || biomarkerDefinitions.find(bd => bd.key === k) || { name: k, unit: '', normalRange: undefined }) as any;
                      const unit = d.unit || '';
                      const range = d.normalRange || 'N/A';
                      
                      const logsForBiomarker = biomarkerHistory
                        .filter(log => log.biomarkers[k] !== undefined)
                        .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
                        
                      let logString = '';
                      if (logsForBiomarker.length > 0) {
                        logString = logsForBiomarker.map(log => `  - [${log.date}] ${log.biomarkers[k]} ${unit}`).join('\n');
                      } else {
                        const latestValue = biomarkers[k] !== undefined ? biomarkers[k] : 'N/A';
                        logString = `  - [Latest Value] ${latestValue} ${unit}`;
                      }
                      
                      return `Biomarker: ${d.name || k} (${k})\nReference Range: ${range} ${unit}\nUnit: ${unit}\nLogged History:\n${logString}`;
                    }).join('\n\n========================================\n\n');
                    
                    navigator.clipboard.writeText(textContent);
                    alert('Copied ' + filteredKeysToCopy.length + ' biomarkers with full history log to clipboard!');
                  }}
                  className="px-3 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors flex items-center gap-1"
                >
                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                  Copy All
                </button>
              </div>

              {selectedKeys.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 animation-fade-in pb-2 w-full">
                  <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 shrink-0">{selectedKeys.length} selected</span>
                  <button
                    onClick={() => setShowCombineModal(true)}
                    className="shrink-0 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"
                  >
                    <Merge className="w-3.5 h-3.5" />
                    Combine Selected
                  </button>
                  <button
                    onClick={() => startChatWithKeys(selectedKeys)}
                    className="shrink-0 px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-900/30 rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    Route Selected
                  </button>
                  <div className="relative shrink-0">
                    <button
                      onClick={() => setShowCleaningDropdown(!showCleaningDropdown)}
                      className="px-3 py-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-md shadow-indigo-600/10 cursor-pointer whitespace-nowrap"
                    >
                      <CheckSquare className="w-3.5 h-3.5" />
                      Cleaning Agent
                      <ChevronDown className="w-3.5 h-3.5 ml-1 opacity-70" />
                    </button>
                     {showCleaningDropdown && (
                      <div className="absolute top-full mt-1 left-0 bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 py-1.5 min-w-[220px] z-[100] animate-in fade-in slide-in-from-top-2">
                        <button
                          onClick={() => {
                            setShowCleaningDropdown(false);
                            setIsMedicalCategorisationMode(false);
                            setIsAgentMode(true);
                            setStandardizationYaml(null);
                            setStandardizationSummary(null);
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                        >
                          Standardize Units Agent
                        </button>
                        <button
                          onClick={() => {
                            setShowCleaningDropdown(false);
                            setIsMedicalCategorisationMode(true);
                            setIsAgentMode(true);
                            setStandardizationYaml(null);
                            setStandardizationSummary(null);
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/50"
                        >
                          Medical Categorisation Agent
                        </button>
                        <button
                          onClick={() => {
                            setShowCleaningDropdown(false);
                            setIsDataAccuracyMode(true);
                            setIsChatMode(false);
                            setIsAgentMode(false);
                            setIsMedicalCategorisationMode(false);
                            setIsNameConsolidationMode(false);
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 font-semibold hover:bg-indigo-50 dark:hover:bg-indigo-950/25"
                        >
                          ✨ Data Accuracy Agent
                        </button>
                        <button
                          onClick={() => {
                            setShowCleaningDropdown(false);
                            setIsNameConsolidationMode(true);
                            setIsAgentMode(false);
                            setIsMedicalCategorisationMode(false);
                            setIsDataAccuracyMode(false);
                            setIsChatMode(false);
                            setConsolidationYaml(null);
                            setConsolidationGroups(null);
                          }}
                          className="w-full text-left px-3 py-2 text-xs font-medium text-violet-600 dark:text-violet-400 font-semibold hover:bg-violet-50 dark:hover:bg-violet-950/25 border-t border-slate-100 dark:border-slate-700/50 mt-1 pt-2"
                        >
                          🤝 Name Consolidation Agent
                        </button>
                      </div>
                    )}
                  </div>
                  {showDeleteSelectedConfirm ? (
                    <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-900/20 border border-rose-100 dark:border-rose-900/40 rounded-lg p-1.5 shrink-0">
                      <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold px-1">Delete {selectedKeys.length} items?</span>
                      <button
                        onClick={() => {
                          const newCustomBiomarkers = { ...profile.customBiomarkers };
                          selectedKeys.forEach(k => {
                            delete newCustomBiomarkers[k];
                          });
                          if (onDeleteMultipleBiomarkers) {
                             onDeleteMultipleBiomarkers(selectedKeys);
                          } else if (onDeleteBiomarker) {
                             selectedKeys.forEach(k => onDeleteBiomarker(k));
                          } else {
                             onUpdateProfile({ customBiomarkers: newCustomBiomarkers });
                          }
                          setSelectedKeys([]);
                          setShowDeleteSelectedConfirm(false);
                        }}
                        className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold rounded transition-colors cursor-pointer"
                      >
                        Yes, Delete
                      </button>
                      <button
                        onClick={() => setShowDeleteSelectedConfirm(false)}
                        className="px-2 py-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-[10px] font-bold transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowDeleteSelectedConfirm(true)}
                      className="shrink-0 px-3 py-1.5 bg-rose-50 text-rose-600 hover:bg-rose-100 dark:bg-rose-900/20 dark:hover:bg-rose-900/40 rounded-lg text-xs font-bold transition-colors"
                    >
                      Delete Selected
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedKeys([])}
                    className="shrink-0 px-2 py-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-medium"
                  >
                    Deselect
                  </button>
                </div>
              )}
            </div>

            {/* List Panels scroll container */}
            <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-6">
              
              {/* ACTIVE CLEANING SESSION REMINDER */}
              {dataAccuracyMessages.length > 1 && (
                <div className="bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-100 dark:border-indigo-900/50 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-indigo-100 dark:bg-indigo-900/50 rounded-lg text-indigo-700 dark:text-indigo-300">
                      <span className="text-sm">🧪</span>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-indigo-800 dark:text-indigo-300">Active Cleaning Session in Progress</p>
                      <p className="text-[11px] text-indigo-600 dark:text-indigo-400">You have an ongoing data accuracy review session with the agent.</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                    {showDiscardSessionConfirm ? (
                      <div className="flex items-center gap-1.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-lg p-1">
                        <span className="text-[10px] text-rose-600 dark:text-rose-400 font-bold px-1.5">Discard session?</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setDataAccuracyMessages([
                              {
                                id: 'acc_msg_init',
                                role: 'assistant',
                                content: 'Hello! I am the Data Accuracy Agent, your cleaning specialist. 🧪\n\nShare any new biomarker readings, laboratory results, or logs by **typing them down** or **uploading files/images**.\n\nI will compare your input with your existing database definitions and latest logs to highlight any differences in **Name, Unit, Value, Date, and Comments**, and generate an interactive table so you can choose which information to keep.',
                                timestamp: new Date().toISOString()
                              }
                            ]);
                            setAccuracyComparisonResults(null);
                            setAccuracySelectedFields({});
                            setAccuracyUploadedFiles([]);
                            setDataAccuracyInput('');
                            localStorage.removeItem('data_accuracy_messages');
                            localStorage.removeItem('data_accuracy_comparison_results');
                            localStorage.removeItem('data_accuracy_selected_fields');
                            setShowDiscardSessionConfirm(false);
                          }}
                          className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold rounded transition-colors cursor-pointer"
                        >
                          Discard
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowDiscardSessionConfirm(false);
                          }}
                          className="px-2 py-1 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-[10px] font-bold transition-colors cursor-pointer"
                        >
                          Keep
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setShowDiscardSessionConfirm(true);
                        }}
                        className="px-2.5 py-1.5 text-xs font-semibold text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 transition-colors cursor-pointer"
                      >
                        Discard
                      </button>
                    )}
                    <button
                      onClick={() => {
                        setIsDataAccuracyMode(true);
                        setIsChatMode(false);
                        setIsAgentMode(false);
                        setIsMedicalCategorisationMode(false);
                      }}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-sm shadow-indigo-600/10"
                    >
                      Resume Agent &rarr;
                    </button>
                  </div>
                </div>
              )}

              {/* TO BE APPROVED PANEL */}
              {toApproveKeys.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-amber-500" />
                      To Be Approved ({toApproveKeys.length})
                    </h3>
                    {toApproveKeys.length > 0 && (
                      <div className="flex items-center gap-3">
                        {selectedKeys.some(k => toApproveKeys.includes(k)) && (
                          <button
                            onClick={() => {
                              const updates = {};
                              selectedKeys.forEach(k => {
                                if (toApproveKeys.includes(k)) {
                                  updates[k] = { name: k, unit: '' };
                                }
                              });
                              // Assuming onStandardizeUnits can take an object of custom definitions, or we need to dispatch profile update directly.
                              // Let's call onSave for each, or we can add a batch update in App.tsx. 
                              // Since BiomarkerDictionaryModal doesn't have onBatchSave, we can use onUpdateProfile if available, or just call onSave?
                              // Wait, onSave in DictionaryItem calls onSave prop. Let's see how onSave is passed to DictionaryItem:
                              // onSave={(updates) => {
                              //  // Wait, the parent has handleUpdateCustomBiomarker(updates)
                              // }}
                              // Let's just create a new customBiomarkers object and update profile.
                              const updatedCustom = { ...(profile.customBiomarkers || {}) };
                              let hasChanges = false;
                              selectedKeys.forEach(k => {
                                if (toApproveKeys.includes(k)) {
                                  updatedCustom[k] = { ...profile.customBiomarkers?.[k], name: k, standardMedicalGrouping: profile.customBiomarkers?.[k]?.standardMedicalGrouping || 'By Medical Practice' };
                                  delete updatedCustom[k].needsApproval;
                                  hasChanges = true;
                                }
                              });
                              if (hasChanges) {
                                onUpdateProfile({ ...profile, customBiomarkers: updatedCustom });
                                setSelectedKeys(selectedKeys.filter(k => !toApproveKeys.includes(k)));
                              }
                            }}
                            className="text-xs font-bold px-2 py-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-400 rounded hover:bg-emerald-200"
                          >
                            Approve Selected
                          </button>
                        )}
                        <button 
                          onClick={() => handleToggleSelectAll(toApproveKeys)}
                          className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                        >
                          {toApproveKeys.every(k => selectedKeys.includes(k)) ? "Deselect All" : "Select All"}
                        </button>
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                    These biomarkers were extracted but do not match the standardized dictionary. Check them to route together, or standard-route individually.
                  </p>
                  <div className="space-y-2">
                    {toApproveKeys.map(key => {
                      const def = profile.customBiomarkers?.[key];
                      const isSelected = selectedKeys.includes(key);
                      const itemLogs = biomarkerHistory
                        .filter(h => h.biomarkers && h.biomarkers[key] !== undefined)
                        .map(h => ({ date: h.date, value: h.biomarkers[key] }))
                        .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
                      const logsCount = itemLogs.length;
                      return (
                        <DictionaryItem
                          approvalReason={`Found in uploaded logs but missing: ${[
                            !def && 'standard dictionary definition',
                            (def && !def.unit) && 'unit',
                            (def && !def.normalRange) && 'normal range',
                            (def && !def.standardMedicalGrouping) && 'medical grouping'
                          ].filter(Boolean).join(', ')}. Please review, standardize, or approve it manually.`}
                          key={key}
                          itemKey={key}
                          customDef={def}
                          logsCount={logsCount}
                          isSelected={isSelected}
                          onTagClick={setFilterTag}
                          allGroupings={allGroupings}
                          allRisks={allRisks}
                          allConditions={allConditions}
                          itemLogs={itemLogs}
                          onToggleSelect={() => handleToggleSelect(key)}
                          onSave={(updates) => {
                            const { newKey, ...restUpdates } = updates;
                            const newCustomBiomarkers = { ...profile.customBiomarkers };
                            let updatedHistory = [...biomarkerHistory];

                            if (newKey && newKey !== key) {
                               // Key was renamed
                               newCustomBiomarkers[newKey] = { ...def, ...restUpdates, name: restUpdates.name || newKey };
                               delete newCustomBiomarkers[key];
                               
                               // Need to update history directly via combining or propagating
                               onCombineBiomarkers(
                                 newKey, 
                                 newCustomBiomarkers[newKey], 
                                 updatedHistory.map(h => {
                                   if (h.biomarkers[key] !== undefined) {
                                     return { date: h.date, value: h.biomarkers[key] };
                                   }
                                   return null;
                                 }).filter(Boolean) as any[],
                                 [key]
                                );
                               return; // combineBiomarkers saves the profile
                            } else {
                               newCustomBiomarkers[key] = { ...def, ...restUpdates };
                            }

                            onUpdateProfile({
                              customBiomarkers: newCustomBiomarkers
                            });
                          }}
                          onRouteAgent={() => handleRouteBiomarker(key)}
                          isProcessing={isProcessing === key}
                        />
                      );
                    })}
                  </div>
                </div>
              )}

              {/* APPROVED DICTIONARY PANEL */}
              {allApprovedKeys.length > 0 ? (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                      <CheckCircle className="w-4 h-4 text-indigo-500" />
                      {filterOption === 'overrides' && `Custom Overrides (${allApprovedKeys.length})`}
                      {filterOption === 'missing_units' && `Missing Units (${allApprovedKeys.length})`}
                      {filterOption === 'all' && `Approved Biomarkers (${allApprovedKeys.length})`}
                    </h3>
                    <button 
                      onClick={() => handleToggleSelectAll(allApprovedKeys)}
                      className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      {allApprovedKeys.every(k => selectedKeys.includes(k)) ? "Deselect All" : "Select All"}
                    </button>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                    {filterOption === 'overrides' && "These approved biomarkers have custom reference ranges or demographic-specific overrides defined."}
                    {filterOption === 'missing_units' && "These approved biomarkers are missing units of measurement. Select or update them to maintain clean data records."}
                    {filterOption === 'all' && "These approved biomarkers are mapped to your profile. You can select them to consolidate multiple biomarkers using Route Agent, or edit their normal ranges and properties."}
                  </p>
                  <div className="space-y-2">
                    {allApprovedKeys.map(key => {
                      const builtIn = biomarkerDefinitions.find((d: any) => d.key === key);
                      const custom = profile.customBiomarkers?.[key];
                      const isSelected = selectedKeys.includes(key);
                      const itemLogs = biomarkerHistory
                        .filter(h => h.biomarkers && h.biomarkers[key] !== undefined)
                        .map(h => ({ date: h.date, value: h.biomarkers[key] }))
                        .sort((a, b) => toYYYYMMDD(b.date).localeCompare(toYYYYMMDD(a.date)));
                      const logsCount = itemLogs.length;
                      return (
                        <DictionaryItem
                          key={key}
                          itemKey={key}
                          builtInDef={builtIn}
                          customDef={custom}
                          logsCount={logsCount}
                          isSelected={isSelected}
                          onTagClick={setFilterTag}
                          allGroupings={allGroupings}
                          allRisks={allRisks}
                          allConditions={allConditions}
                          itemLogs={itemLogs}
                          onToggleSelect={() => handleToggleSelect(key)}
                          onSave={(updates) => {
                            const combined = { ...builtIn, ...custom };
                            const { newKey, ...restUpdates } = updates;
                            const newCustomBiomarkers = { ...profile.customBiomarkers };
                              
                            if (newKey && newKey !== key) {
                               newCustomBiomarkers[newKey] = { ...combined, ...restUpdates, name: restUpdates.name || newKey };
                               if (!builtIn) { delete newCustomBiomarkers[key]; }
                                 
                               let updatedHistory = [...biomarkerHistory];
                               onCombineBiomarkers(
                                 newKey, 
                                 newCustomBiomarkers[newKey], 
                                 updatedHistory.map(h => {
                                   if (h.biomarkers[key] !== undefined) {
                                     return { date: h.date, value: h.biomarkers[key] };
                                   }
                                   return null;
                                 }).filter(Boolean) as any[],
                                 [key]
                                );
                               return;
                            } else {
                               newCustomBiomarkers[key] = { ...combined, ...restUpdates };
                            }

                            onUpdateProfile({
                              customBiomarkers: newCustomBiomarkers
                            });
                          }}
                          onRouteAgent={() => handleRouteBiomarker(key)}
                          isProcessing={isProcessing === key}
                        />
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-slate-400 dark:text-slate-500 text-xs">
                  No biomarkers found matching the filter options.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {showCombineModal && (
        <CombineBiomarkersModal
          profile={profile}
          isOpen={showCombineModal}
          onClose={() => {
            setShowCombineModal(false);
            setSelectedKeys([]);
          }}
          initialSelectedKeys={selectedKeys}
          biomarkers={biomarkers}
          biomarkerHistory={biomarkerHistory}
          allDefinitions={biomarkerDefinitions}
          onSaveCombine={(targetKey, targetDef, mergedLogs, sourceKeysToDelete) => {
            onCombineBiomarkers(targetKey, targetDef, mergedLogs, sourceKeysToDelete);
            setShowCombineModal(false);
            setSelectedKeys([]);
          }}
        />
      )}
      <FullScreenInstructionViewer
        isOpen={showStandardizeInstructions}
        onClose={() => setShowStandardizeInstructions(false)}
        agentType="standardize"
        profile={profile}
      />
      <FullScreenInstructionViewer
        isOpen={showMedicalInstructions}
        onClose={() => setShowMedicalInstructions(false)}
        agentType="medical_categorise"
        profile={profile}
      />
      <FullScreenInstructionViewer
        isOpen={showDataAccuracyInstructions}
        onClose={() => setShowDataAccuracyInstructions(false)}
        agentType="data_accuracy"
        profile={profile}
      />
    </div>
  );
}
