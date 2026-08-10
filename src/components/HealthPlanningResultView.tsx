import React, { useState } from 'react';
import { HealthAction, UserProfile } from '../types';
import { 
  Stethoscope, 
  CheckCircle2, 
  Circle, 
  AlertTriangle, 
  Calendar, 
  Clock, 
  ShieldAlert, 
  Check,
  FlaskConical
} from 'lucide-react';

export interface RetestBiomarkerItem {
  key?: string;
  name: string;
  currentValue?: string | number;
  unit?: string;
  retestTimeframe?: string;
  recommendedTestName?: string;
  isProvisional?: boolean;
  priority?: 'high' | 'medium' | 'low' | 'High' | 'Medium' | 'Low';
  priorityReason?: string;
  reason?: string;
  lastTestedDate?: string;
  nextScheduledDate?: string;
  dueStatus?: string;
  dateImportanceRating?: string;
  dateRationale?: string;
  userBenefit?: string;
  gpClinicalJustification?: string;
}

export interface TestingGapItem {
  testName: string;
  category?: 'short_term' | 'long_term';
  timeframe?: string;
  priority?: 'high' | 'medium' | 'low' | 'High' | 'Medium' | 'Low';
  priorityReason?: string;
  reason?: string;
  targetCondition?: string;
  nextScheduledDate?: string;
  userBenefit?: string;
  profileRationale?: string;
  gpClinicalJustification?: string;
}

export interface HealthPlanningResultData {
  summary?: string;
  primaryDiagnosis?: string;
  text?: string;
  retestBiomarkers?: RetestBiomarkerItem[];
  testingGaps?: TestingGapItem[];
  // Fallbacks for backward compatibility
  recommendedTests?: Array<{ testName: string; reason: string }>;
  prioritizedConditions?: any[];
}

interface HealthPlanningResultViewProps {
  agentResult: HealthPlanningResultData;
  profile?: UserProfile;
  onAcceptRecommendations?: (acceptedActions: HealthAction[]) => Promise<void>;
  isApplying?: boolean;
  isApproved?: boolean;
}

export const HealthPlanningResultView: React.FC<HealthPlanningResultViewProps> = ({
  agentResult,
  profile,
  onAcceptRecommendations,
  isApplying = false,
  isApproved = false
}) => {
  // Normalize agentResult object
  let resultObj: any = agentResult || {};
  if (typeof resultObj === 'string') {
    try {
      resultObj = JSON.parse(resultObj);
    } catch (e) {
      resultObj = {};
    }
  }
  if (resultObj && typeof resultObj === 'object' && resultObj.agentResult && typeof resultObj.agentResult === 'object') {
    resultObj = { ...resultObj, ...resultObj.agentResult };
  }

  // Extract summary text cleanly for the Executive Summary Banner
  let summaryText = "Diagnostic accuracy and health planning evaluation complete.";
  const rawSummary = resultObj?.summary || resultObj?.primaryDiagnosis;
  if (typeof rawSummary === 'string' && rawSummary.trim() && !rawSummary.trim().startsWith('{')) {
    summaryText = rawSummary;
  } else if (rawSummary && typeof rawSummary === 'object') {
    const obj = rawSummary as any;
    if (typeof obj.summary === 'string' && obj.summary.trim()) {
      summaryText = obj.summary;
    } else if (typeof obj.primaryDiagnosis === 'string' && obj.primaryDiagnosis.trim()) {
      summaryText = obj.primaryDiagnosis;
    }
  } else if (typeof resultObj?.text === 'string' && resultObj.text.trim() && !resultObj.text.trim().startsWith('{')) {
    summaryText = resultObj.text;
  }

  const safeStr = (val: any): string => {
    if (val === undefined || val === null) return '';
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (typeof val === 'object') {
      return val.primaryDiagnosis || val.testName || val.reason || val.name || val.text || JSON.stringify(val);
    }
    return String(val);
  };
  
  // Extract retest list
  let retestList: RetestBiomarkerItem[] = [];
  const rawRetest = resultObj?.retestBiomarkers || resultObj?.retest_biomarkers || resultObj?.recommendedRetests;
  if (Array.isArray(rawRetest)) {
    retestList = rawRetest.map((t: any) => ({
      ...t,
      name: t.name || t.biomarker || t.testName || 'Biomarker',
      recommendedTestName: t.recommendedTestName || t.recommended_test || t.testToTake || t.testName || (t.name ? `${t.name} Panel` : 'Clinical Test')
    }));
  } else if (typeof rawRetest === 'string') {
    try {
      const parsed = JSON.parse(rawRetest);
      if (Array.isArray(parsed)) {
        retestList = parsed.map((t: any) => ({
          ...t,
          name: t.name || t.biomarker || t.testName || 'Biomarker',
          recommendedTestName: t.recommendedTestName || t.recommended_test || t.testToTake || t.testName || (t.name ? `${t.name} Panel` : 'Clinical Test')
        }));
      }
    } catch (e) {}
  }
  
  // Extract testing gaps list
  let gapList: TestingGapItem[] = [];
  const rawGaps = resultObj?.testingGaps || resultObj?.testing_gaps || resultObj?.recommendedTests;
  if (Array.isArray(rawGaps)) {
    gapList = rawGaps.map((t: any) => ({
      ...t,
      testName: t.testName || t.name || t.test || 'Diagnostic Test',
      category: t.category || (t.timeframe && /annual|2\s*year|5\s*year|long/i.test(t.timeframe) ? 'long_term' : 'short_term'),
      timeframe: t.timeframe || t.retestTimeframe || 'Within 3-6 months',
      priority: t.priority || 'medium',
      reason: t.reason || t.description || '',
      targetCondition: t.targetCondition || t.target_condition || t.condition || ''
    }));
  } else if (typeof rawGaps === 'string') {
    try {
      const parsed = JSON.parse(rawGaps);
      if (Array.isArray(parsed)) {
        gapList = parsed.map((t: any) => ({
          ...t,
          testName: t.testName || t.name || t.test || 'Diagnostic Test',
          category: t.category || (t.timeframe && /annual|2\s*year|5\s*year|long/i.test(t.timeframe) ? 'long_term' : 'short_term'),
          timeframe: t.timeframe || t.retestTimeframe || 'Within 3-6 months',
          priority: t.priority || 'medium',
          reason: t.reason || t.description || '',
          targetCondition: t.targetCondition || t.target_condition || t.condition || ''
        }));
      }
    } catch (e) {}
  }

  // Selected state for retest items and gap items
  const [selectedRetests, setSelectedRetests] = useState<Record<number, boolean>>(() => {
    const initial: Record<number, boolean> = {};
    retestList.forEach((_, idx) => { initial[idx] = true; });
    return initial;
  });

  const [selectedGaps, setSelectedGaps] = useState<Record<number, boolean>>(() => {
    const initial: Record<number, boolean> = {};
    gapList.forEach((_, idx) => { initial[idx] = true; });
    return initial;
  });

  const [hasSubmitted, setHasSubmitted] = useState(isApproved);

  const toggleRetest = (idx: number) => {
    if (hasSubmitted) return;
    setSelectedRetests(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const toggleGap = (idx: number) => {
    if (hasSubmitted) return;
    setSelectedGaps(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  const selectedRetestCount = Object.values(selectedRetests).filter(Boolean).length;
  const selectedGapCount = Object.values(selectedGaps).filter(Boolean).length;
  const totalSelectedCount = selectedRetestCount + selectedGapCount;

  const handleAccept = async () => {
    if (!onAcceptRecommendations) return;

    const acceptedActions: HealthAction[] = [];
    const timestamp = Date.now();

    // 1. Process selected retests
    retestList.forEach((item, idx) => {
      if (selectedRetests[idx]) {
        const valStr = item.currentValue !== undefined && item.currentValue !== null && item.currentValue !== '' 
          ? ` (Current: ${item.currentValue}${item.unit ? ' ' + item.unit : ''})` 
          : '';
        const recTestName = item.recommendedTestName || (item.name ? `${item.name} Panel` : 'Clinical Test');
        const tf = item.nextScheduledDate || item.retestTimeframe || '3-6 months';
        const itemPrio = item.priority || (item.isProvisional ? 'high' : 'medium');
        
        let explanationText = '';
        if (item.userBenefit || item.gpClinicalJustification) {
          const parts = [
            item.userBenefit || '',
            item.gpClinicalJustification ? `[Clinical Justification for GP: ${item.gpClinicalJustification}]` : ''
          ].filter(Boolean).join(' ');
          explanationText = parts;
        } else {
          const prioReasonText = item.priorityReason ? ` [Priority Reason: ${item.priorityReason}]` : '';
          explanationText = `${item.reason || 'Repeat test to verify baseline accuracy and eliminate acute confounding variables.'}${prioReasonText}`;
        }
        
        acceptedActions.push({
          id: `action_retest_${timestamp}_${idx}`,
          task: `Retest ${item.name}`,
          explanation: `${explanationText}${item.isProvisional ? ' [Provisional reading pending confirmation]' : ''}${valStr}`,
          priority: itemPrio.toLowerCase() as 'low' | 'medium' | 'high',
          completed: false,
          type: 'test',
          testName: recTestName,
          timeframe: tf,
          createdAt: timestamp
        });
      }
    });

    // 2. Process selected testing gaps
    gapList.forEach((item, idx) => {
      if (selectedGaps[idx]) {
        const catLabel = item.category === 'long_term' ? 'Long-Term Gap' : 'Short-Term Gap';
        const tf = item.nextScheduledDate || item.timeframe || '3-6 months';
        const itemPrio = item.priority || (item.category === 'short_term' ? 'high' : 'medium');
        
        let explanationText = '';
        if (item.userBenefit || item.gpClinicalJustification) {
          const parts = [
            item.userBenefit || '',
            item.gpClinicalJustification ? `[Clinical Justification for GP: ${item.gpClinicalJustification}]` : ''
          ].filter(Boolean).join(' ');
          explanationText = `[${item.targetCondition || catLabel}] ${parts}`;
        } else {
          const prioReasonText = item.priorityReason ? ` [Priority Reason: ${item.priorityReason}]` : '';
          explanationText = `[${item.targetCondition || catLabel}] ${item.reason || 'Diagnostic gap identified to uncover potential health risks.'}${prioReasonText}`;
        }
        
        acceptedActions.push({
          id: `action_gap_${timestamp}_${idx}`,
          task: `Perform Diagnostic Test: ${item.testName}`,
          explanation: explanationText,
          priority: itemPrio.toLowerCase() as 'low' | 'medium' | 'high',
          completed: false,
          type: 'test',
          testName: item.testName,
          timeframe: tf,
          createdAt: timestamp
        });
      }
    });

    await onAcceptRecommendations(acceptedActions);
    setHasSubmitted(true);
  };

  // Group testing gaps by short_term (< 2 years) and long_term (>= 2 years)
  const shortTermGaps = gapList.map((item, originalIdx) => ({ item, originalIdx })).filter(({ item }) => item.category !== 'long_term');
  const longTermGaps = gapList.map((item, originalIdx) => ({ item, originalIdx })).filter(({ item }) => item.category === 'long_term');

  return (
    <div className="space-y-6 font-sans text-theme-text text-left p-1">
      {/* Executive Summary Banner */}
      <div className="p-4 bg-indigo-50/60 dark:bg-indigo-950/30 rounded-2xl border border-indigo-100 dark:border-indigo-900/40 space-y-2">
        <div className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400 font-bold text-xs uppercase tracking-wider">
          <Stethoscope className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
          <span>Health Planning & Diagnostic Audit</span>
        </div>
        <p className="text-xs text-theme-neutral leading-relaxed font-medium">
          {summaryText}
        </p>
      </div>

      {/* Retest & Value Accuracy Section */}
      <div className="space-y-3">
        <div>
          <h4 className="font-bold text-xs uppercase tracking-wider text-theme-neutral flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-amber-500" />
            <span>Biomarker Retests & Value Accuracy</span>
          </h4>
          <p className="text-[11px] text-theme-text-secondary mt-0.5">
            Metrics that may have changed or require repeat testing to confirm baseline accuracy due to external factors (e.g., dehydration, acute exertion).
          </p>
        </div>

        {retestList.length > 0 ? (
          <div className="space-y-2.5">
            {retestList.map((item, idx) => {
              const isSelected = !!selectedRetests[idx];
              return (
                <div
                  key={idx}
                  onClick={() => toggleRetest(idx)}
                  className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-amber-50/40 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/50 shadow-sm'
                      : 'bg-theme-bg-card border-theme-border opacity-60'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <button type="button" className="mt-0.5 text-slate-400 shrink-0">
                      {isSelected ? (
                        <CheckCircle2 className="w-4 h-4 text-amber-600 dark:text-amber-500 fill-amber-600/10" />
                      ) : (
                        <Circle className="w-4 h-4" />
                      )}
                    </button>
                    <div className="space-y-1.5 flex-1 min-w-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-theme-text">
                              {safeStr(item.name)}
                            </span>
                            {(item.currentValue !== undefined && item.currentValue !== null) && (
                              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-md text-[10px] font-mono font-bold text-theme-neutral">
                                {safeStr(item.currentValue)} {safeStr(item.unit)}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 border border-teal-200 dark:border-teal-800/60">
                              <FlaskConical className="w-3 h-3 text-teal-600 dark:text-teal-400" />
                              <span>Test to take: {safeStr(item.recommendedTestName || `${item.name} Panel`)}</span>
                            </span>
                            {item.lastTestedDate && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                <span>Last tested: {safeStr(item.lastTestedDate)}</span>
                              </span>
                            )}
                            {item.dueStatus && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
                                <span>{safeStr(item.dueStatus)}</span>
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {item.priority && (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                              item.priority.toLowerCase() === 'high'
                                ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                                : item.priority.toLowerCase() === 'low'
                                ? 'bg-slate-100 dark:bg-slate-800 text-theme-text-secondary border-theme-border'
                                : 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                            }`}>
                              {item.priority.toUpperCase()} PRIORITY
                            </span>
                          )}
                          {item.isProvisional && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-300 border border-amber-300/40">
                              <AlertTriangle className="w-2.5 h-2.5" />
                              Provisional
                            </span>
                          )}
                          {(item.nextScheduledDate || item.retestTimeframe) && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                              <Calendar className="w-2.5 h-2.5" />
                              {safeStr(item.nextScheduledDate || item.retestTimeframe)}
                            </span>
                          )}
                        </div>
                      </div>

                      {(item.gpClinicalJustification || item.dateRationale) && (
                        <p className="text-[10.5px] font-medium text-amber-800 dark:text-amber-300 bg-amber-50/70 dark:bg-amber-950/40 p-2 rounded-lg border border-amber-200/60 dark:border-amber-800/50 whitespace-pre-line leading-relaxed">
                          <span className="font-bold text-amber-900 dark:text-amber-200 block mb-0.5">Clinical Justification (Letter for GP):</span>
                          {safeStr(item.gpClinicalJustification || item.dateRationale)}
                        </p>
                      )}
                      
                      {item.userBenefit ? (
                        <p className="text-[11px] text-theme-text-secondary leading-relaxed font-medium text-indigo-700 dark:text-indigo-400">
                          {safeStr(item.userBenefit)}
                        </p>
                      ) : (
                        item.reason && (
                          <p className="text-[11px] text-theme-text-secondary leading-relaxed">
                            {safeStr(item.reason)}
                          </p>
                        )
                      )}
                      
                      {!item.gpClinicalJustification && item.priorityReason && (
                        <p className="text-[10px] font-medium text-amber-700 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-950/40 p-1.5 rounded-lg border border-amber-200/50 dark:border-amber-800/40">
                          <span className="font-bold">Priority Rationale:</span> {safeStr(item.priorityReason)}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="p-3 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-theme-border text-xs text-slate-500 italic">
            No existing biomarker readings require re-testing or verification at this time.
          </div>
        )}
      </div>

      {/* Diagnostic & Risk Testing Gaps Section */}
      <div className="space-y-3 pt-2">
        <div>
          <h4 className="font-bold text-xs uppercase tracking-wider text-theme-neutral flex items-center gap-1.5">
            <ShieldAlert className="w-3.5 h-3.5 text-indigo-500" />
            <span>Diagnostic & Risk Testing Gaps</span>
          </h4>
          <p className="text-[11px] text-theme-text-secondary mt-0.5">
            Recommended tests (existing or unentered markers) to uncover potential health risks for your specific demographic and biomarker profile.
          </p>
        </div>

        {/* Short Term Risk (< 2 Years) */}
        <div className="space-y-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2.5 py-0.5 rounded-md inline-block">
            Short-Term Risk Testing (&lt; 2 Years)
          </span>

          {shortTermGaps.length > 0 ? (
            <div className="space-y-2">
              {shortTermGaps.map(({ item, originalIdx }) => {
                const isSelected = !!selectedGaps[originalIdx];
                return (
                  <div
                    key={originalIdx}
                    onClick={() => toggleGap(originalIdx)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-indigo-50/40 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-800/50 shadow-sm'
                        : 'bg-theme-bg-card border-theme-border opacity-60'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <button type="button" className="mt-0.5 text-slate-400 shrink-0">
                        {isSelected ? (
                          <CheckCircle2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 fill-indigo-600/10" />
                        ) : (
                          <Circle className="w-4 h-4" />
                        )}
                      </button>
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-xs text-theme-text">
                            {safeStr(item.testName)}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {item.priority && (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                                (item.priority || '').toLowerCase() === 'high'
                                  ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                                  : (item.priority || '').toLowerCase() === 'low'
                                  ? 'bg-slate-100 dark:bg-slate-800 text-theme-text-secondary border-theme-border'
                                  : 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                              }`}>
                                {String(item.priority).toUpperCase()} PRIORITY
                              </span>
                            )}
                            {item.targetCondition && (
                              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-md text-[9px] font-bold text-theme-text-secondary">
                                {safeStr(item.targetCondition)}
                              </span>
                            )}
                            {(item.nextScheduledDate || item.timeframe) && (
                              <span className="px-2 py-0.5 bg-indigo-100/70 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded-md text-[9px] font-bold">
                                {safeStr(item.nextScheduledDate || item.timeframe)}
                              </span>
                            )}
                          </div>
                        </div>
                        
                        {(item.gpClinicalJustification || item.profileRationale) && (
                          <p className="text-[10.5px] font-medium text-amber-800 dark:text-amber-300 bg-amber-50/70 dark:bg-amber-950/40 p-2 rounded-lg border border-amber-200/60 dark:border-amber-800/50 whitespace-pre-line leading-relaxed">
                            <span className="font-bold text-amber-900 dark:text-amber-200 block mb-0.5">Clinical Justification (Letter for GP):</span>
                            {safeStr(item.gpClinicalJustification || item.profileRationale)}
                          </p>
                        )}

                        {item.userBenefit ? (
                          <p className="text-[11px] text-theme-text-secondary leading-relaxed font-medium">
                            {safeStr(item.userBenefit)}
                          </p>
                        ) : (
                          item.reason && (
                            <p className="text-[11px] text-theme-text-secondary leading-relaxed">
                              {safeStr(item.reason)}
                            </p>
                          )
                        )}
                        
                        {!item.gpClinicalJustification && item.priorityReason && (
                          <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400 font-semibold">
                            (Priority: {safeStr(item.priorityReason)})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-2.5 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-theme-border text-[11px] text-slate-500 italic">
              No short-term testing gaps flagged.
            </div>
          )}
        </div>

        {/* Long Term Risk (≥ 2 Years) */}
        <div className="space-y-2 pt-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-theme-text-secondary bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 rounded-md inline-block">
            Long-Term Risk Testing (&ge; 2 Years)
          </span>

          {longTermGaps.length > 0 ? (
            <div className="space-y-2">
              {longTermGaps.map(({ item, originalIdx }) => {
                const isSelected = !!selectedGaps[originalIdx];
                return (
                  <div
                    key={originalIdx}
                    onClick={() => toggleGap(originalIdx)}
                    className={`p-3.5 rounded-2xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-slate-50 dark:bg-slate-800/40 border-slate-300 dark:border-slate-700 shadow-sm'
                        : 'bg-theme-bg-card border-theme-border opacity-60'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <button type="button" className="mt-0.5 text-slate-400 shrink-0">
                        {isSelected ? (
                          <CheckCircle2 className="w-4 h-4 text-theme-neutral fill-slate-700/10" />
                        ) : (
                          <Circle className="w-4 h-4" />
                        )}
                      </button>
                      <div className="space-y-1.5 flex-1 min-w-0">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-bold text-xs text-theme-text">
                            {safeStr(item.testName)}
                          </span>
                          <div className="flex items-center gap-1.5">
                            {item.priority && (
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold border ${
                                (item.priority || '').toLowerCase() === 'high'
                                  ? 'bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                                  : (item.priority || '').toLowerCase() === 'low'
                                  ? 'bg-slate-100 dark:bg-slate-800 text-theme-text-secondary border-theme-border'
                                  : 'bg-amber-100 dark:bg-amber-950/80 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                              }`}>
                                {String(item.priority).toUpperCase()} PRIORITY
                              </span>
                            )}
                            {item.targetCondition && (
                              <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded-md text-[9px] font-bold text-theme-text-secondary">
                                {safeStr(item.targetCondition)}
                              </span>
                            )}
                            {item.timeframe && (
                              <span className="px-2 py-0.5 bg-slate-200/70 dark:bg-slate-800 text-theme-neutral rounded-md text-[9px] font-bold">
                                {safeStr(item.timeframe)}
                              </span>
                            )}
                          </div>
                        </div>

                        {(item.gpClinicalJustification || item.profileRationale) && (
                          <p className="text-[10.5px] font-medium text-amber-800 dark:text-amber-300 bg-amber-50/70 dark:bg-amber-950/40 p-2 rounded-lg border border-amber-200/60 dark:border-amber-800/50 whitespace-pre-line leading-relaxed">
                            <span className="font-bold text-amber-900 dark:text-amber-200 block mb-0.5">Clinical Justification (Letter for GP):</span>
                            {safeStr(item.gpClinicalJustification || item.profileRationale)}
                          </p>
                        )}

                        {item.userBenefit ? (
                          <p className="text-[11px] text-theme-text-secondary leading-relaxed font-medium">
                            {safeStr(item.userBenefit)}
                          </p>
                        ) : (
                          item.reason && (
                            <p className="text-[11px] text-theme-text-secondary leading-relaxed">
                              {safeStr(item.reason)}
                            </p>
                          )
                        )}
                        
                        {!item.gpClinicalJustification && item.priorityReason && (
                          <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-400 font-semibold">
                            (Priority: {safeStr(item.priorityReason)})
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-2.5 bg-slate-50 dark:bg-slate-900/60 rounded-xl border border-theme-border text-[11px] text-slate-500 italic">
              No long-term testing gaps flagged.
            </div>
          )}
        </div>
      </div>

      {/* Action Footer Button */}
      {onAcceptRecommendations && (
        <div className="pt-3 border-t border-theme-border">
          {hasSubmitted ? (
            <div className="p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-xl text-xs font-bold text-emerald-700 dark:text-emerald-400 flex items-center justify-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              <span>Recommendations accepted & saved to Clinical Action Recommendations on Home</span>
            </div>
          ) : (
            <button
              type="button"
              disabled={isApplying || totalSelectedCount === 0}
              onClick={handleAccept}
              className="w-full py-3 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-all shadow-md shadow-emerald-600/10 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Check className="w-4 h-4" />
              <span>
                {isApplying ? 'Saving Recommendations...' : `Accept Selected Recommendations (${totalSelectedCount})`}
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
