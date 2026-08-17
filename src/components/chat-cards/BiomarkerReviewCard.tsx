import * as React from 'react';
import { AgentCardProps } from './types';
import { Check, Edit2, Sparkles, ArrowRight } from 'lucide-react';

import { biomarkerDefinitions } from '../../utils/biomarkers';

const COMMON_UNITS = [
  '%',
  'g/dL',
  'g/L',
  'mg/dL',
  'mg/L',
  'ng/dL',
  'ng/mL',
  'pg/mL',
  'U/L',
  'uIU/mL',
  'mIU/L',
  'mmol/L',
  'umol/L',
  'K/uL',
  'M/uL',
  'fL',
  'pg',
  'mL/min/1.73m²',
  'ratio',
  'score',
];

const normalizeDateStr = (s?: string) => {
  if (!s) return '';
  const clean = s.trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(clean)) {
    const [d, m, y] = clean.split('-');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return clean;
};

const findOldValInHistory = (history: any[], modDate: string, keyName: string) => {
  if (!history || !modDate || !keyName) return null;
  const targetNorm = normalizeDateStr(modDate);
  const matchedLog = history.find(h => normalizeDateStr(h.date) === targetNorm);
  if (!matchedLog || !matchedLog.biomarkers) return null;

  if (matchedLog.biomarkers[keyName] !== undefined && matchedLog.biomarkers[keyName] !== null) {
    return matchedLog.biomarkers[keyName];
  }
  const lowerKey = keyName.toLowerCase().replace(/\s+/g, '_');
  for (const [k, v] of Object.entries(matchedLog.biomarkers)) {
    if (k.toLowerCase().replace(/\s+/g, '_') === lowerKey) {
      return v;
    }
  }
  return null;
};

const STOPWORDS = new Set([
  'through', 'from', 'to', 'until', 'between', 'and', 'or', 'on', 'at', 'in',
  'entry', 'entries', 'log', 'logs', 'error', 'errors', 'date', 'dates'
]);

export function extractFallbackModifications(text: string, history: any[], profile: any): any[] {
  if (!text || typeof text !== 'string') return [];
  const results: any[] = [];
  const cleanText = text.replace(/[*_]/g, '');

  const chunks = cleanText.split(/(?:[•\n;\r]|(?:\d+[\.\)]\s+))/);
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed || !/(?:->|→)/.test(trimmed)) continue;

    // Pattern 1: date (biomarker): old [unit] -> new [unit]
    let m = trimmed.match(/(\d{2}[-\/]\d{2}[-\/]\d{4})\s*\(([^)]+)\)[:\s]*([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)\s*(?:->|→)\s*([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)/);
    if (m) {
      const date = m[1].replace(/\//g, '-');
      const rawName = m[2].trim();
      const matchedDef = biomarkerDefinitions.find(d => d.name.toLowerCase() === rawName.toLowerCase() || d.key.toLowerCase() === rawName.toLowerCase());
      const keyName = matchedDef ? matchedDef.key : rawName.toLowerCase().replace(/\s+/g, '_');
      const oldUnit = m[4].trim() || undefined;
      const newUnit = m[6].trim() || undefined;
      results.push({
        action: 'update_biomarker',
        keyName,
        date,
        oldValue: m[3],
        oldUnit,
        newValue: m[5],
        unit: newUnit || oldUnit,
        reason: 'Scaling and notation calibration'
      });
      continue;
    }

    // Pattern 2: biomarker date: old [unit] -> new [unit]
    m = trimmed.match(/([a-zA-Z_]+(?:\s+[a-zA-Z_]+)?)\s+(?:on\s+)?(\d{2}[-\/]\d{2}[-\/]\d{4})[:\s]*([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)\s*(?:->|→)\s*([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)/);
    if (m) {
      const rawName = m[1].trim();
      if (STOPWORDS.has(rawName.toLowerCase())) continue;
      const date = m[2].replace(/\//g, '-');
      const matchedDef = biomarkerDefinitions.find(d => d.name.toLowerCase() === rawName.toLowerCase() || d.key.toLowerCase() === rawName.toLowerCase());
      const keyName = matchedDef ? matchedDef.key : rawName.toLowerCase().replace(/\s+/g, '_');
      const oldUnit = m[4].trim() || undefined;
      const newUnit = m[6].trim() || undefined;
      results.push({
        action: 'update_biomarker',
        keyName,
        date,
        oldValue: m[3],
        oldUnit,
        newValue: m[5],
        unit: newUnit || oldUnit,
        reason: 'Scaling and notation calibration'
      });
      continue;
    }

    // Pattern 3: Range dates, e.g. "hemoglobin 03-08-2026 through 05-06-2026: 166 g/L -> 16.6 g/dL"
    m = trimmed.match(/([a-zA-Z_]+(?:\s+[a-zA-Z_]+)?)\s+(\d{2}[-\/]\d{2}[-\/]\d{4})\s+(?:through|to|until|-)\s+(\d{2}[-\/]\d{2}[-\/]\d{4})[:\s]*([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)\s*(?:->|→)\s*([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)/);
    if (m) {
      const rawName = m[1].trim();
      if (!STOPWORDS.has(rawName.toLowerCase())) {
        const matchedDef = biomarkerDefinitions.find(d => d.name.toLowerCase() === rawName.toLowerCase() || d.key.toLowerCase() === rawName.toLowerCase());
        const keyName = matchedDef ? matchedDef.key : rawName.toLowerCase().replace(/\s+/g, '_');
        const oldUnit = m[5].trim() || undefined;
        const newUnit = m[7].trim() || undefined;
        const d1 = m[2].replace(/\//g, '-');
        const d2 = m[3].replace(/\//g, '-');

        const matchedHistory = (history || []).filter(h => {
          if (!h || !h.date) return false;
          return h.biomarkers && (h.biomarkers[keyName] !== undefined || Object.keys(h.biomarkers).some(k => k.toLowerCase().replace(/\s+/g, '_') === keyName));
        });

        if (matchedHistory.length > 0) {
          matchedHistory.forEach(h => {
            results.push({
              action: 'update_biomarker',
              keyName,
              date: h.date,
              oldValue: m[4],
              oldUnit,
              newValue: m[6],
              unit: newUnit || oldUnit,
              reason: 'Scaling and notation calibration'
            });
          });
        } else {
          results.push({
            action: 'update_biomarker',
            keyName,
            date: d1,
            oldValue: m[4],
            oldUnit,
            newValue: m[6],
            unit: newUnit || oldUnit,
            reason: 'Scaling and notation calibration'
          });
        }
        continue;
      }
    }

    // Pattern 4: date biomarker old [unit] -> new [unit] (e.g. "03-08-2026 Hematocrit 0.48 -> 48.0 %" or "02-08-2026 LDL-C 4.2 mmol/L -> 162 mg/dL")
    m = trimmed.match(/^(\d{2}[-\/]\d{2}[-\/]\d{4})\s+([a-zA-Z0-9_\-\s]+?)\s+([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)\s*(?:->|→)\s*([+-]?\d+(?:\.\d+)?)\s*([a-zA-Z\/%^0-9*]*)/);
    if (m) {
      const date = m[1].replace(/\//g, '-');
      const rawName = m[2].trim();
      const matchedDef = biomarkerDefinitions.find(d => d.name.toLowerCase() === rawName.toLowerCase() || d.key.toLowerCase() === rawName.toLowerCase());
      const keyName = matchedDef ? matchedDef.key : rawName.toLowerCase().replace(/[\s\-]+/g, '_');
      const oldUnit = m[4].trim() || undefined;
      const newUnit = m[6].trim() || undefined;
      results.push({
        action: 'update_biomarker',
        keyName,
        date,
        oldValue: m[3],
        oldUnit,
        newValue: m[5],
        unit: newUnit || oldUnit,
        reason: 'Scaling and notation calibration'
      });
      continue;
    }
  }

  return results;
}

export const BiomarkerReviewCard: React.FC<AgentCardProps> = ({ msg, onLogMedical, profile, biomarkerHistory }) => {
  const targetKey = msg.data?.targetBiomarkerKey || msg.data?.agentResult?.targetBiomarkerKey || msg.data?.agentResult?.proposal?.name || msg.data?.proposal?.name || (msg.agentResult as any)?.targetBiomarkerKey || '';
  const currentDef = profile?.customBiomarkers?.[targetKey] || biomarkerDefinitions.find(d => d.key === targetKey) || {};

  const proposal = msg.data?.agentResult?.proposal || msg.data?.proposal || (msg.agentResult as any)?.proposal || null;
  const mods = msg.data?.agentResult?.modificationCommand || msg.data?.modificationCommand || msg.modificationCommand || (msg.agentResult as any)?.modificationCommand || null;
  const reply = msg.data?.agentResult?.reply || msg.data?.agentResult?.text || msg.content;

  const [localMods, setLocalMods] = React.useState<any[]>([]);
  const [localProposal, setLocalProposal] = React.useState<any>(null);
  const [localUnits, setLocalUnits] = React.useState<Record<string, string>>({});
  const [isEditingProposal, setIsEditingProposal] = React.useState(false);

  React.useEffect(() => {
    let initialMods = (mods && Array.isArray(mods) && mods.length > 0) ? mods : [];
    if (initialMods.length === 0 && reply) {
      initialMods = extractFallbackModifications(reply, biomarkerHistory || [], profile);
    }
    setLocalMods(initialMods ? JSON.parse(JSON.stringify(initialMods)) : []);
    setLocalProposal(proposal ? JSON.parse(JSON.stringify(proposal)) : null);
    
    // Initialize units
    const initialUnits: Record<string, string> = {};
    if (proposal && proposal.metric) {
      initialUnits[targetKey] = proposal.metric;
    }
    if (initialMods) {
      initialMods.forEach((m: any) => {
        if (m.keyName && !initialUnits[m.keyName]) {
          const currentDef = profile?.customBiomarkers?.[m.keyName] || biomarkerDefinitions.find(d => d.key === m.keyName) || {};
          initialUnits[m.keyName] = currentDef.unit || '';
        }
      });
    }
    setLocalUnits(initialUnits);
  }, [msg, mods, proposal, profile, targetKey, reply, biomarkerHistory]);

  if (msg.role !== 'assistant') return null;
  if (!proposal && (!mods || mods.length === 0) && !reply) return null;

  const hasModifications = localMods && localMods.length > 0;

  return (
    <div className="mt-3 bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-800/30 rounded-2xl p-4 w-full">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="w-4 h-4 text-indigo-500" />
        <h4 className="text-sm font-bold text-indigo-900 dark:text-indigo-200">AI Review & Calibration</h4>
      </div>

      {reply && (
        <div className="mb-4 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line leading-relaxed">
          {reply}
        </div>
      )}

      {localProposal && (
        <div className="space-y-2 mb-4 bg-white/60 dark:bg-slate-900/40 p-3 rounded-xl border border-indigo-50 dark:border-indigo-800/20">
          <div className="flex items-center justify-between mb-1.5 border-b border-indigo-100/30 dark:border-indigo-900/10 pb-1.5">
            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Biomarker Definition</div>
            <button
              onClick={() => setIsEditingProposal(!isEditingProposal)}
              className="text-[10px] font-bold text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-350 flex items-center gap-1 cursor-pointer"
            >
              <Edit2 className="w-2.5 h-2.5" />
              {isEditingProposal ? 'Finish Editing' : 'Edit Definition'}
            </button>
          </div>

          {isEditingProposal ? (
            <div className="space-y-3 pt-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Name</label>
                  <input
                    type="text"
                    value={localProposal.name || ''}
                    onChange={(e) => setLocalProposal({ ...localProposal, name: e.target.value })}
                    className="w-full px-2 py-1 text-xs font-bold text-slate-800 dark:text-slate-200 bg-white/80 dark:bg-slate-900/80 border border-indigo-200 dark:border-indigo-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Unit</label>
                  <input
                    type="text"
                    list="proposal-units-list"
                    value={localProposal.metric || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setLocalProposal({ ...localProposal, metric: val });
                      setLocalUnits(prev => ({ ...prev, [targetKey]: val }));
                    }}
                    className="w-full px-2 py-1 text-xs font-bold text-slate-800 dark:text-slate-200 bg-white/80 dark:bg-slate-900/80 border border-indigo-200 dark:border-indigo-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                  <datalist id="proposal-units-list">
                    {COMMON_UNITS.map(unit => (
                      <option key={unit} value={unit} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Range</label>
                <input
                  type="text"
                  value={localProposal.range || ''}
                  onChange={(e) => setLocalProposal({ ...localProposal, range: e.target.value })}
                  className="w-full px-2 py-1 text-xs font-bold text-slate-800 dark:text-slate-200 bg-white/80 dark:bg-slate-900/80 border border-indigo-200 dark:border-indigo-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="e.g. 13.5 - 17.5"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Description</label>
                <textarea
                  value={localProposal.description || ''}
                  onChange={(e) => setLocalProposal({ ...localProposal, description: e.target.value })}
                  rows={2}
                  className="w-full px-2 py-1 text-xs text-slate-800 dark:text-slate-200 bg-white/80 dark:bg-slate-900/80 border border-indigo-200 dark:border-indigo-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Medical Insight</label>
                <textarea
                  value={localProposal.medicalInsight || ''}
                  onChange={(e) => setLocalProposal({ ...localProposal, medicalInsight: e.target.value })}
                  rows={2}
                  className="w-full px-2 py-1 text-xs text-slate-800 dark:text-slate-200 bg-white/80 dark:bg-slate-900/80 border border-indigo-200 dark:border-indigo-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                />
              </div>
            </div>
          ) : (
            <>
              {localProposal.name && <DiffRow label="Name" oldVal={currentDef.name} newVal={localProposal.name} />}
              {localProposal.metric && <DiffRow label="Unit" oldVal={currentDef.unit} newVal={localProposal.metric} />}
              {localProposal.range && <DiffRow label="Range" oldVal={currentDef.normalRange} newVal={localProposal.range} />}
              {localProposal.description && <DiffRow label="Description" oldVal={currentDef.description || currentDef.descriptions?.en} newVal={localProposal.description} />}
              {localProposal.medicalInsight && <DiffRow label="Medical Insight" oldVal={(currentDef as any).specificRiskContext || currentDef.medicalInsight || ''} newVal={localProposal.medicalInsight} />}
            </>
          )}
        </div>
      )}

      {hasModifications && (
        <div className="space-y-3 mb-4 bg-white/60 dark:bg-slate-900/40 p-3 rounded-xl border border-indigo-50 dark:border-indigo-800/20">
          <div className="text-xs font-bold text-indigo-950 dark:text-indigo-200 uppercase tracking-wider mb-2 flex items-center justify-between">
            <span>Proposed Log Modifications</span>
            <span className="text-[10px] font-normal text-indigo-600 dark:text-indigo-400 font-mono bg-indigo-100/80 dark:bg-indigo-900/50 px-2 py-0.5 rounded-full font-bold">
              {localMods.length} {localMods.length === 1 ? 'entry change' : 'entry changes'}
            </span>
          </div>
          {localMods.map((mod: any, i: number) => {
            const historyOldVal = findOldValInHistory(biomarkerHistory || [], mod.date, mod.keyName);
            const rawOld = mod.oldValue ?? historyOldVal;
            const oldValStr = rawOld !== null && rawOld !== undefined ? String(rawOld) : '';
            const markerName = profile?.customBiomarkers?.[mod.keyName]?.name 
              || biomarkerDefinitions.find(d => d.key === mod.keyName)?.name 
              || mod.keyName;

            return (
              <div key={i} className="flex flex-col gap-2 text-xs p-3 rounded-xl bg-indigo-50/40 dark:bg-indigo-950/20 border border-indigo-100/70 dark:border-indigo-800/30">
                <div className="flex items-center justify-between font-bold text-slate-800 dark:text-slate-200">
                  <span className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.5 bg-indigo-200/60 dark:bg-indigo-800/60 text-indigo-900 dark:text-indigo-100 rounded text-[10px] font-mono font-bold">
                      {mod.date}
                    </span>
                    <span className="font-semibold text-slate-900 dark:text-slate-100">{markerName}</span>
                  </span>
                  <span className="text-[10px] uppercase tracking-wide font-extrabold text-indigo-600 dark:text-indigo-400">
                    {mod.action === 'remove_biomarker' ? 'Remove Entry' : 'Update Value'}
                  </span>
                </div>

                {mod.action === 'remove_biomarker' ? (
                  <div className="text-rose-600 dark:text-rose-400 font-medium text-[11px] flex items-center gap-2 pt-0.5">
                    <span>Current: <span className="line-through font-bold">{oldValStr || 'Flagged value'}</span></span>
                    <ArrowRight className="w-3 h-3 shrink-0" />
                    <span className="font-bold text-rose-600">Entry Removed</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between bg-white/40 dark:bg-slate-900/30 p-2.5 rounded-lg border border-indigo-100/30 dark:border-indigo-900/10">
                    {/* Current value display */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-slate-500 dark:text-slate-400 font-medium text-[10px] uppercase tracking-wider">Current:</span>
                      <span className="line-through text-rose-500 font-mono font-bold bg-rose-50 dark:bg-rose-950/30 px-2 py-0.5 rounded border border-rose-200/40 dark:border-rose-800/20">
                        {oldValStr || 'Unspecified'}
                      </span>
                    </div>

                    <div className="hidden sm:block text-slate-400 font-light">→</div>

                    {/* Editable Inputs for manual override */}
                    <div className="flex flex-wrap items-center gap-3">
                      {/* Fixed Value Input */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500 dark:text-slate-400 font-medium text-[10px] uppercase tracking-wider">Fixed:</span>
                        <input
                          type="text"
                          value={mod.newValue ?? ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLocalMods(prev => prev.map((m, idx) => idx === i ? { ...m, newValue: val } : m));
                          }}
                          className="w-20 px-2 py-1 text-xs font-mono font-bold text-emerald-800 dark:text-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/30 border border-emerald-300 dark:border-emerald-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 text-center"
                          placeholder="value"
                        />
                      </div>

                      {/* Unit Input using datalist */}
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-500 dark:text-slate-400 font-medium text-[10px] uppercase tracking-wider">Unit:</span>
                        <input
                          type="text"
                          list={`units-list-${i}`}
                          value={localUnits[mod.keyName] || ''}
                          onChange={(e) => {
                            const val = e.target.value;
                            setLocalUnits(prev => ({ ...prev, [mod.keyName]: val }));
                            if (localProposal && mod.keyName === targetKey) {
                              setLocalProposal({ ...localProposal, metric: val });
                            }
                          }}
                          className="w-24 px-2 py-1 text-xs font-bold text-indigo-800 dark:text-indigo-300 bg-indigo-50/50 dark:bg-indigo-950/30 border border-indigo-300 dark:border-indigo-800 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          placeholder="e.g. pg/mL"
                        />
                        <datalist id={`units-list-${i}`}>
                          {COMMON_UNITS.map(unit => (
                            <option key={unit} value={unit} />
                          ))}
                        </datalist>
                      </div>
                    </div>
                  </div>
                )}

                {mod.reason && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 italic pt-1.5 border-t border-indigo-100/40 dark:border-indigo-900/30">
                    Reason: {mod.reason}
                  </div>
                )}
              </div>
            );
          })} 
        </div>
      )}

      <div className="flex justify-end gap-2 mt-4 pt-3 border-t border-indigo-100/50 dark:border-indigo-800/30">
        <button
          onClick={() => {
            const textarea = document.querySelector('textarea');
            if (textarea) textarea.focus();
          }}
          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-xl transition-colors cursor-pointer"
        >
          Keep Discussing
        </button>
        <button
          onClick={() => {
            if (onLogMedical) {
              const profileUpdates: any = {};
              
              // 1. If we have a local proposal (definition update), build its customBiomarkers entry
              if (localProposal) {
                const key = msg.data?.targetBiomarkerKey || localProposal.keyName || 'unknown';
                profileUpdates.customBiomarkers = {
                  [key]: {
                    name: localProposal.name,
                    unit: localUnits[key] || localProposal.metric,
                    normalRange: localProposal.range,
                    description: localProposal.description,
                    specificRiskContext: localProposal.medicalInsight // Save into specificRiskContext correctly
                  }
                };
              }

              // 2. Add units for other modified biomarkers to the profileUpdates
              localMods.forEach((m: any) => {
                if (m.action === 'update_biomarker' && m.keyName) {
                  const key = m.keyName;
                  const chosenUnit = localUnits[key];
                  if (chosenUnit !== undefined) {
                    if (!profileUpdates.customBiomarkers) {
                      profileUpdates.customBiomarkers = {};
                    }
                    const currentDef = profile?.customBiomarkers?.[key] || biomarkerDefinitions.find(d => d.key === key) || {};
                    profileUpdates.customBiomarkers[key] = {
                      ...currentDef,
                      name: currentDef.name || key,
                      unit: chosenUnit,
                      normalRange: currentDef.normalRange || currentDef.range || 'Unknown',
                      description: currentDef.description || '',
                      specificRiskContext: currentDef.specificRiskContext || ''
                    };
                  }
                }
              });

              // Parse numeric values correctly
              const parsedMods = localMods.map((m: any) => {
                if (m.action === 'update_biomarker' && m.newValue !== undefined && m.newValue !== null) {
                  const num = Number(m.newValue);
                  return {
                    ...m,
                    newValue: Number.isFinite(num) ? num : m.newValue
                  };
                }
                return m;
              });

              onLogMedical({}, Object.keys(profileUpdates).length > 0 ? profileUpdates : undefined, undefined, undefined, parsedMods);
            }
          }}
          className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer flex items-center gap-1.5"
        >
          <Check className="w-3.5 h-3.5" />
          Approve & Apply
        </button>
      </div>
    </div>
  );
};

const DiffRow = ({ label, oldVal, newVal }: { label: string, oldVal?: string, newVal: string }) => (
  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-1 sm:gap-4 py-1 border-b border-slate-100 dark:border-slate-800/50 last:border-0">
    <span className="text-[11px] text-slate-400 font-medium uppercase tracking-wide shrink-0 w-24">{label}</span>
    
    <div className="flex flex-col gap-0.5 w-full">
      {oldVal && oldVal !== newVal && (
        <span className="text-[10px] text-slate-400 dark:text-slate-500 line-through truncate">{oldVal}</span>
      )}
      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 break-words">{newVal}</span>
    </div>
  </div>
);
