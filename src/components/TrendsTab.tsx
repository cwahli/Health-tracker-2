import React, { useState } from 'react';
import { UserProfile, FoodLog, BiomarkerLog, RecommendationReport, NutrientBreakdown } from '../types';
import { nutrientDefinitions } from '../utils/nutrition';
import { translations } from '../utils/translations';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp, BarChart2, Calendar, EyeOff, Copy, Check } from 'lucide-react';
import { toYYYYMMDD, formatTimelineDate } from '../utils/dateUtils';
import { getBiomarkerStatus, getBiomarkerStatusLabel, biomarkerDefinitions, isAsianEthnicity } from '../utils/biomarkers';
const parseTargetBounds = (targetStr: string | undefined, nutrientKey: string, defaultMin: number = 0, defaultMax: number = Infinity) => {
  if (!targetStr) return { min: defaultMin, max: defaultMax };
  const lowerStr = targetStr.toLowerCase().replace(/,/g, '');
  if (lowerStr.includes('under') || lowerStr.includes('less') || lowerStr.includes('<') || lowerStr.includes('max')) {
    const nums = lowerStr.match(/\d+(\.\d+)?/g);
    if (nums) return { min: 0, max: parseFloat(nums[0]) };
  }
  if (lowerStr.includes('over') || lowerStr.includes('more') || lowerStr.includes('>')) {
    const nums = lowerStr.match(/\d+(\.\d+)?/g);
    if (nums) return { min: parseFloat(nums[0]), max: Infinity };
  }
  const nums = lowerStr.match(/\d+(\.\d+)?/g);
  if (nums && nums.length >= 2) {
    return { min: parseFloat(nums[0]), max: parseFloat(nums[1]) };
  }
  if (nums && nums.length === 1) {
    const val = parseFloat(nums[0]);
    const limitMaxKeys = ['calories', 'totalFat', 'saturatedFat', 'addedSugar', 'sodium'];
    if (limitMaxKeys.includes(nutrientKey)) {
       return { min: 0, max: val };
    }
    return { min: val, max: Infinity };
  }
  return { min: defaultMin, max: defaultMax };
};

const getBiomarkerTargetBounds = (key: string, report: any) => {
  if (key === 'ldl') return { min: 0, max: 100 };
  if (key === 'hba1c') return { min: 0, max: 5.7 };
  if (key === 'egfr') return { min: 90, max: Infinity };
  if (key === 'steps') {
    const stepsStr = report?.dailyNutrientTargets?.steps;
    const nums = stepsStr ? String(stepsStr).replace(/,/g, '').match(/\d+/) : null;
    return { min: nums ? parseInt(nums[0], 10) : 3000, max: Infinity };
  }
  return { min: 0, max: Infinity };
};

const evaluateNutrientStatus = (value: number, bounds: { min: number, max: number }, nutrientKey?: string) => {
  if (bounds.min === 0 && bounds.max === Infinity) return { color: 'bg-slate-300 dark:bg-slate-600', text: 'No Target' };

  const betterLowKeys = ['calories', 'totalFat', 'saturatedFat', 'addedSugar', 'sodium', 'sugar', 'cholesterol', 'transFat', 'carbohydrates'];
  
  if (nutrientKey && betterLowKeys.includes(nutrientKey)) {
    // For these, being under bounds.max is optimal (green)
    const maxLimit = bounds.max !== Infinity ? bounds.max : (bounds.min !== 0 ? bounds.min : Infinity);
    if (maxLimit === Infinity) return { color: 'bg-slate-300 dark:bg-slate-600', text: 'No Target' };
    
    if (value <= maxLimit) {
      return { color: 'bg-emerald-500', text: 'On Target' };
    } else {
      const diff = value - maxLimit;
      if (diff <= maxLimit * 0.10) return { color: 'bg-amber-500', text: '<10% Over' };
      return { color: 'bg-rose-500', text: '>10% Over' };
    }
  }

  // Standard evaluation for other nutrients
  if (bounds.max === Infinity) { // Target is "over X"
    if (value >= bounds.min) return { color: 'bg-emerald-500', text: 'On Target' };
    const diff = bounds.min - value;
    if (diff <= bounds.min * 0.10) return { color: 'bg-amber-500', text: '<10% Under' };
    return { color: 'bg-rose-500', text: '>10% Under' };
  }
  
  if (bounds.min === 0) { // Target is "under Y"
    if (value <= bounds.max) return { color: 'bg-emerald-500', text: 'On Target' };
    const diff = value - bounds.max;
    if (diff <= bounds.max * 0.10) return { color: 'bg-amber-500', text: '<10% Over' };
    return { color: 'bg-rose-500', text: '>10% Over' };
  }

  // Range
  if (value >= bounds.min && value <= bounds.max) return { color: 'bg-emerald-500', text: 'On Target' };
  if (value < bounds.min) {
    const diff = bounds.min - value;
    if (diff <= bounds.min * 0.10) return { color: 'bg-amber-500', text: '<10% Under' };
    return { color: 'bg-rose-500', text: '>10% Under' };
  }
  if (value > bounds.max) {
    const diff = value - bounds.max;
    if (diff <= bounds.max * 0.10) return { color: 'bg-amber-500', text: '<10% Over' };
    return { color: 'bg-rose-500', text: '>10% Over' };
  }
  
  return { color: 'bg-slate-300 dark:bg-slate-600', text: 'Unknown' };
};

interface TrendsTabProps {
  profile: UserProfile;
  foodLogs: FoodLog[];
  biomarkerHistory: BiomarkerLog[];
  hideSensitive: boolean;
  report: RecommendationReport | null;
  onSelectFood?: (foodId: string) => void;
}

export default function TrendsTab({
  profile,
  foodLogs,
  biomarkerHistory,
  hideSensitive,
  report,
  onSelectFood
}: TrendsTabProps) {
  const t = translations[profile.language] || translations.en;
  const [selectedMetric, setSelectedMetric] = useState<string>(() => {
    return localStorage.getItem('trends_selected_metric') || 'calories';
  });
  const [activeSubTab, setActiveSubTab] = useState<'trends' | 'summary'>('trends');
  const [summaryDays, setSummaryDays] = useState<number | ''>(7);
  const [selectedDot, setSelectedDot] = useState<any>(null);
  const [hoveredDot, setHoveredDot] = useState<any>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [rollingPeriod, setRollingPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const handleMetricChange = (metric: string) => {
    setSelectedMetric(metric);
    localStorage.setItem('trends_selected_metric', metric);
  };

  const parseTarget = (val: any, fallback: number) => {
    if (val === null || val === undefined) return fallback;
    const cleanStr = String(val).replace(/,/g, '');
    const matches = cleanStr.match(/\d+(\.\d+)?/g);
    if (!matches || matches.length === 0) return fallback;
    const parsed = parseFloat(matches[0]);
    return isNaN(parsed) ? fallback : parsed;
  };

  // Generate continuous or logged timeline data for the chart
  const getChartData = () => {
    // Collect all unique dates from both logs normalized to YYYY-MM-DD
    const emailSuffix = profile?.email ? `_${profile.email.toLowerCase().trim()}` : '_guest';
    const datesSet = new Set<string>();
    foodLogs.forEach(f => datesSet.add(toYYYYMMDD(f.date)));
    biomarkerHistory.forEach(b => datesSet.add(toYYYYMMDD(b.date)));
    
    let stepsHistory: { date: string, value: number }[] = [];
    if (selectedMetric === 'steps') {
      const historyStr = localStorage.getItem(`googleStepsHistory${emailSuffix}`);
      if (historyStr) {
        try {
          stepsHistory = JSON.parse(historyStr);
          stepsHistory.forEach(h => datesSet.add(toYYYYMMDD(h.date)));
        } catch (e) {}
      }
      const today = new Date().toISOString().split('T')[0];
      datesSet.add(today);
    }

    // Sort dates chronologically
    const sortedDates = Array.from(datesSet).sort();

    const compiled = sortedDates.map(dateStr => {
      // Aggregate foods for this day
      const daysFoods = foodLogs.filter(f => toYYYYMMDD(f.date) === dateStr);

      // Extract biomarker if logged on this day
      const dayBio = biomarkerHistory.find(b => toYYYYMMDD(b.date) === dateStr);
      const ldlVal = dayBio?.biomarkers.ldl;
      const hba1cVal = dayBio?.biomarkers.hba1c;
      const egfrVal = dayBio?.biomarkers.egfr;

      let value = 0;
      const isNutrient = nutrientDefinitions.some(n => n.key === selectedMetric);
      
      if (isNutrient) {
        value = daysFoods.reduce((acc, f) => acc + (f.nutrients?.[selectedMetric as keyof NutrientBreakdown] || 0), 0);
      } else if (selectedMetric === 'ldl') value = typeof ldlVal === 'string' ? parseFloat(ldlVal) : Number(ldlVal || 0);
      else if (selectedMetric === 'hba1c') value = typeof hba1cVal === 'string' ? parseFloat(hba1cVal) : Number(hba1cVal || 0);
      else if (selectedMetric === 'egfr') value = typeof egfrVal === 'string' ? parseFloat(egfrVal) : Number(egfrVal || 0);
      else if (selectedMetric === 'steps') {
        const today = new Date().toISOString().split('T')[0];
        if (dateStr === today) {
          const todaySteps = localStorage.getItem(`googleSteps${emailSuffix}`);
          value = todaySteps ? parseInt(todaySteps, 10) : (stepsHistory.find(h => toYYYYMMDD(h.date) === dateStr)?.value || 0);
        } else {
          value = stepsHistory.find(h => toYYYYMMDD(h.date) === dateStr)?.value || 0;
        }
      }

      return {
        date: dateStr,
        value: Number(value.toFixed(1))
      };
    });

    // Data points in the past that are empty (value <= 0) are excluded for the chart so that the timeline better represents the data
    const activeCompiled = compiled.filter(item => item.value > 0);

    // If there is zero data, pre-populate dummy points to allow beautiful visual rendering
    if (activeCompiled.length === 0) {
      return [
        { date: '2026-06-20', value: 0 },
        { date: '2026-06-21', value: 0 },
        { date: '2026-06-22', value: 0 },
      ];
    }

    // Handle rolling aggregate depending on selection
    if (rollingPeriod === 'weekly') {
      // Group by weeks
      const grouped: { [key: string]: number[] } = {};
      activeCompiled.forEach(item => {
        // Simple approximate week identifier (first 8 chars or custom week bracket)
        const weekKey = item.date.substring(0, 7) + "-W";
        if (!grouped[weekKey]) grouped[weekKey] = [];
        grouped[weekKey].push(item.value);
      });
      return Object.entries(grouped).map(([week, vals]) => ({
        date: week,
        value: Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1))
      }));
    } else if (rollingPeriod === 'monthly') {
      const grouped: { [key: string]: number[] } = {};
      activeCompiled.forEach(item => {
        const monthKey = item.date.substring(0, 7);
        if (!grouped[monthKey]) grouped[monthKey] = [];
        grouped[monthKey].push(item.value);
      });
      return Object.entries(grouped).map(([month, vals]) => ({
        date: month,
        value: Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1))
      }));
    }

    return activeCompiled;
  };

  const chartData = getChartData();

  const getMetricMeta = () => {
    const nutDef = nutrientDefinitions.find(n => n.key === selectedMetric);
    if (nutDef) {
      let t = 0;
      if (report?.dailyNutrientTargets && (report.dailyNutrientTargets as any)[selectedMetric]) {
        t = parseTarget((report.dailyNutrientTargets as any)[selectedMetric], 0);
      }
      return { label: nutDef.labels[profile.language] || nutDef.labels.en, unit: nutDef.unit, color: '#6366f1', target: t || 100 };
    }
    
    return {
      ldl: { label: 'LDL Cholesterol', unit: 'mg/dL', color: '#f59e0b', target: 100 },
      hba1c: { label: 'HbA1c Blood Glucose', unit: '%', color: '#8b5cf6', target: 5.7 },
      egfr: { label: 'eGFR Kidney Filtration', unit: 'mL/min', color: '#ec4899', target: 90 },
      steps: { label: 'Daily Steps', unit: 'steps', color: '#10b981', target: report?.dailyNutrientTargets?.steps ? parseTarget(report.dailyNutrientTargets.steps, 3000) : 3000 },
    }[selectedMetric] || { label: 'Metric', unit: '', color: '#6366f1', target: 0 };
  };
  const metricMeta = getMetricMeta();

  const getSummaryData = () => {
    const days = typeof summaryDays === 'number' ? summaryDays : 7;
    const dateStrs: string[] = [];
    const today = new Date();
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dateStrs.push(toYYYYMMDD(d.toISOString()));
    }
    
    const nutrientAverages: { [key: string]: number } = {};
    const dayFoodSums: { [date: string]: { [key: string]: number } } = {};
    dateStrs.forEach(d => dayFoodSums[d] = {});
    
    let daysWithFood = 0;
    dateStrs.forEach(dStr => {
      const dFoods = foodLogs.filter(f => toYYYYMMDD(f.date) === dStr);
      if (dFoods.length > 0) daysWithFood++;
      nutrientDefinitions.forEach(nut => {
        const sum = dFoods.reduce((acc, f) => acc + (f.nutrients?.[nut.key] || 0), 0);
        dayFoodSums[dStr][nut.key] = sum;
      });
    });
    
    const divFood = Math.max(1, daysWithFood);
    nutrientDefinitions.forEach(nut => {
      const total = dateStrs.reduce((acc, dStr) => acc + dayFoodSums[dStr][nut.key], 0);
      nutrientAverages[nut.key] = total / divFood;
    });
    
    const bioAverages: { [key: string]: number } = {};
    const allBioKeys = new Set<string>(['ldl', 'hba1c', 'egfr']);
    biomarkerHistory.forEach(b => {
      Object.keys(b.biomarkers).forEach(k => allBioKeys.add(k));
    });
    
    const sortedHistory = [...biomarkerHistory].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    
    Array.from(allBioKeys).forEach(k => {
      for (const log of sortedHistory) {
        const v = log.biomarkers[k];
        if (v !== undefined) {
          if (typeof v === 'number') {
             bioAverages[k] = v;
             break;
          } else if (typeof v === 'string') {
             const parsed = parseFloat(v);
             if (!isNaN(parsed)) {
               bioAverages[k] = parsed;
               break;
             }
          }
        }
      }
    });
    
    const emailSuffix = profile?.email ? `_${profile.email.toLowerCase().trim()}` : '_guest';
    let stepsHistory: { date: string, value: number }[] = [];
    try { stepsHistory = JSON.parse(localStorage.getItem(`googleStepsHistory${emailSuffix}`) || '[]'); } catch (e) {}
    
    const todayStr = toYYYYMMDD(new Date().toISOString());
    const todaySteps = localStorage.getItem(`googleSteps${emailSuffix}`);
    
    if (todaySteps) {
      bioAverages['steps'] = parseInt(todaySteps, 10);
    } else if (stepsHistory.length > 0) {
      const latestStep = [...stepsHistory].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0];
      bioAverages['steps'] = latestStep.value;
    } else {
      bioAverages['steps'] = 0;
    }
    
    allBioKeys.add('steps');
    
    return { nutrientAverages, bioAverages, allBioKeys: Array.from(allBioKeys) };
  };
  const summaryData = activeSubTab === 'summary' ? getSummaryData() : null;
  const nutrientDots = summaryData ? nutrientDefinitions.map(nut => {
    const value = summaryData.nutrientAverages[nut.key] || 0;
    const targetStr = report?.dailyNutrientTargets?.[nut.key as any];
    const bounds = parseTargetBounds(targetStr, nut.key);
    const status = evaluateNutrientStatus(value, bounds);
    return { name: nut.labels[profile.language] || nut.labels.en, value: value.toFixed(1), unit: nut.unit, target: targetStr || 'No target', bounds, statusText: status.text, color: status.color, key: nut.key };
  }) : [];
  const biomarkerDots = summaryData ? summaryData.allBioKeys.map(key => {
    const value = summaryData.bioAverages[key] || 0;
    const bStatus = getBiomarkerStatus(key, value, undefined, profile?.customBiomarkers?.[key], profile);
    let color = 'bg-slate-300 dark:bg-slate-600';
    let text = 'Unknown';
    if (bStatus === 'normal') { color = 'bg-emerald-500'; text = 'Normal'; }
    else if (bStatus === 'low' || bStatus === 'high') { color = 'bg-amber-500'; text = 'At Risk'; }
    else if (bStatus === 'critical') { color = 'bg-rose-500'; text = 'Critical'; }
    
    // Override text with precise dictionary label if available
    text = getBiomarkerStatusLabel(key, text, profile?.customBiomarkers?.[key], value, profile);


    let label = key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    let targetText = 'No target';
    let unit = '';
    
    if (key === 'bmi') {
      const isAsian = isAsianEthnicity(profile.ethnicity);
      targetText = isAsian ? '18.5 - 22.9' : '18.5 - 24.9';
      label = 'BMI';
      unit = 'kg/m²';
    } else if (key === 'steps') {
      label = 'Steps';
      unit = '';
      const stepsStr = report?.dailyNutrientTargets?.steps;
      if (stepsStr) {
        targetText = `> ${String(stepsStr).replace(/,/g, '').match(/\d+/)?.[0] || '3000'}`;
      } else {
        targetText = '> 3000';
      }
    } else {
      const def = biomarkerDefinitions.find(d => d.key === key);
      const customDef = profile?.customBiomarkers?.[key];
      if (customDef) {
        targetText = customDef.normalRange || 'Unknown';
        label = customDef.name || key;
        unit = customDef.unit || '';
      } else if (def) {
        targetText = def.normalRange;
        label = def.name;
        unit = def.unit || '';
      }
    }

    return { name: label, value: value.toFixed(1), unit: unit, target: targetText, bounds: { min: 0, max: Infinity }, statusText: text, color, key };
  }) : [];
  return (
    <div className="space-y-5 pb-24 animation-fade-in max-w-md mx-auto px-[15px] mt-4 font-sans text-slate-900">
      <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mb-4">
        <button onClick={() => setActiveSubTab('trends')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${activeSubTab === 'trends' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500'}`}>Trends</button>
        <button onClick={() => setActiveSubTab('summary')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${activeSubTab === 'summary' ? 'bg-white dark:bg-slate-700 shadow-sm text-indigo-600 dark:text-indigo-400' : 'text-slate-500'}`}>Summary</button>
      </div>
      
      {activeSubTab === 'summary' && (
        <div className="space-y-6" onClick={() => setSelectedDot(null)}>
          <div className="flex justify-between items-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-3 rounded-xl relative">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide font-mono">Aggregated Time Period</span>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-950 dark:text-slate-200">Last</span>
              <input 
                type="number" 
                value={summaryDays} 
                onChange={e => setSummaryDays(e.target.value === '' ? '' : parseInt(e.target.value, 10))} 
                className="w-12 text-center text-xs font-bold text-white bg-slate-800 dark:bg-slate-800 rounded-lg py-1 border-none focus:ring-2 focus:ring-indigo-500/20"
              />
              <span className="text-xs font-bold text-slate-950 dark:text-slate-200">days</span>
            </div>
            
            <button 
              onClick={(e) => {
                e.stopPropagation();
                const text = `Nutrients (Last ${summaryDays} Days):\n` + 
                  nutrientDots.map(d => `- ${d.name}: ${d.value} ${d.unit} (Target: ${d.target}) - ${d.statusText}`).join('\n') + 
                  '\n\nBiomarkers (Latest):\n' + 
                  biomarkerDots.map(d => `- ${d.name}: ${d.value} ${d.unit} (Target: ${d.target}) - ${d.statusText}`).join('\n');
                navigator.clipboard.writeText(text);
                const btn = document.getElementById('copy-summary-btn');
                if (btn) {
                  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-green-500"><polyline points="20 6 9 17 4 12"></polyline></svg>';
                  setTimeout(() => {
                    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-slate-500 hover:text-indigo-600"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path></svg>';
                  }, 2000);
                }
              }}
              id="copy-summary-btn"
              className="absolute -top-3 -right-2 p-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full shadow-sm hover:scale-105 transition-all"
              title="Copy all data"
            >
              <Copy className="w-3.5 h-3.5 text-slate-500 hover:text-indigo-600 transition-colors" />
            </button>
          </div>
          
          <div>
            <h3 className="text-xs font-bold text-slate-950 dark:text-slate-200 mb-3 font-display uppercase tracking-wider">Nutrients (Last {summaryDays} Days)</h3>
            <div className="grid grid-cols-10 gap-x-1 gap-y-3 justify-items-center">
              {nutrientDots.map((dot, i) => (
                <div 
                  key={i} 
                  className="relative flex items-center justify-center cursor-pointer group"
                  style={{ width: '35px', height: '35px' }}
                  onMouseEnter={() => setHoveredDot(dot)}
                  onMouseLeave={() => setHoveredDot(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedDot(selectedDot?.key === dot.key ? null : dot);
                  }}
                >
                  <div className={`rounded-full ${dot.color} transition-all duration-300 ${selectedDot?.key === dot.key || hoveredDot?.key === dot.key ? 'ring-2 ring-offset-2 ring-indigo-500 dark:ring-offset-slate-950 scale-110' : ''}`} style={{ width: '25px', height: '25px' }} />
                  
                  {/* Tooltip */}
                  <div className={`absolute bottom-full mb-2 ${i % 10 < 2 ? 'left-0' : i % 10 > 7 ? 'right-0' : 'left-1/2 -translate-x-1/2'} w-48 p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 transition-all duration-200 pointer-events-none ${selectedDot?.key === dot.key || hoveredDot?.key === dot.key ? 'opacity-100 visible' : 'opacity-0 invisible'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${dot.color}`} />
                      <h4 className="text-xs font-bold text-slate-950 dark:text-white capitalize truncate">{dot.name}</h4>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div>
                        <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-wide font-mono mb-0.5">Value</span>
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-200">{dot.value} {dot.unit}</span>
                      </div>
                      <div>
                        <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-wide font-mono mb-0.5">Target</span>
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-200 block truncate">{dot.target}</span>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                      <span className={`text-[10px] font-bold ${dot.color.replace('bg-', 'text-')}`}>{dot.statusText}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          
          <div>
            <h3 className="text-xs font-bold text-slate-950 dark:text-slate-200 mb-3 font-display uppercase tracking-wider mt-6">Biomarkers (Latest Value)</h3>
            <div className="grid grid-cols-10 gap-x-1 gap-y-3 justify-items-center">
              {biomarkerDots.map((dot, i) => (
                <div 
                  key={i} 
                  className="relative flex items-center justify-center cursor-pointer group"
                  style={{ width: '35px', height: '35px' }}
                  onMouseEnter={() => setHoveredDot(dot)}
                  onMouseLeave={() => setHoveredDot(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedDot(selectedDot?.key === dot.key ? null : dot);
                  }}
                >
                  <div className={`rounded-full ${dot.color} transition-all duration-300 ${selectedDot?.key === dot.key || hoveredDot?.key === dot.key ? 'ring-2 ring-offset-2 ring-indigo-500 dark:ring-offset-slate-950 scale-110' : ''}`} style={{ width: '25px', height: '25px' }} />
                  
                  {/* Tooltip */}
                  <div className={`absolute bottom-full mb-2 ${i % 10 < 2 ? 'left-0' : i % 10 > 7 ? 'right-0' : 'left-1/2 -translate-x-1/2'} w-48 p-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl z-50 transition-all duration-200 pointer-events-none ${selectedDot?.key === dot.key || hoveredDot?.key === dot.key ? 'opacity-100 visible' : 'opacity-0 invisible'}`}>
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`w-2.5 h-2.5 rounded-full ${dot.color}`} />
                      <h4 className="text-xs font-bold text-slate-950 dark:text-white capitalize truncate">{dot.name}</h4>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div>
                        <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-wide font-mono mb-0.5">Value</span>
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-200">{dot.value} {dot.unit}</span>
                      </div>
                      <div>
                        <span className="block text-[8px] font-bold text-slate-400 uppercase tracking-wide font-mono mb-0.5">Target</span>
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-200 block truncate">{dot.target}</span>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                      <span className={`text-[10px] font-bold ${dot.color.replace('bg-', 'text-')}`}>{dot.statusText}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      
      {activeSubTab === 'trends' && (
        <>
      
      {/* Select Controls Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 font-mono">Select Metric</label>
          <select
            id="trend-metric-selector"
            value={selectedMetric}
            onChange={(e) => handleMetricChange(e.target.value)}
            className="w-full text-xs font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 rounded-xl px-2.5 py-2.5 text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
          >
            <option value="steps">Daily Steps</option>
            {nutrientDefinitions.map(nut => (
              <option key={nut.key} value={nut.key}>
                {nut.labels[profile.language] || nut.labels.en} ({nut.unit})
              </option>
            ))}
            <option value="ldl">LDL Cholesterol (mg/dL)</option>
            <option value="hba1c">HbA1c (%)</option>
            <option value="egfr">eGFR Kidney Filtration</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 font-mono">Time Roll</label>
          <div className="grid grid-cols-3 gap-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800/80 p-1 rounded-xl">
            {(['daily', 'weekly', 'monthly'] as const).map(p => (
              <button
                key={p}
                onClick={() => setRollingPeriod(p)}
                className={`py-1.5 rounded-lg text-[10px] font-bold capitalize transition-all ${
                  rollingPeriod === p
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Responsive Recharts Viewport */}
      <div id="trends-chart-card" className="relative">
        {hideSensitive && ['ldl', 'hba1c', 'egfr'].includes(selectedMetric) ? (
          /* Masked view to respect privacy toggles in trends as well */
          <div className="h-60 flex flex-col items-center justify-center text-center text-slate-400">
            <EyeOff className="w-8 h-8 text-rose-400 mb-2" />
            <p className="text-xs font-semibold">Sensitive biometric trends are currently hidden.</p>
            <p className="text-[10px] mt-1">Disable privacy shield in profile header to display charts.</p>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center mb-4">
              <div>
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide font-mono block">
                  {metricMeta.label}
                </span>
                <span className="text-base font-bold text-slate-950 dark:text-slate-200 font-display">
                  Timeline ({metricMeta.unit})
                </span>
              </div>
              <div className="text-right text-[10px] font-mono text-slate-400 font-bold">
                Target: {metricMeta.target} {metricMeta.unit}
              </div>
            </div>

            <div className="h-60 w-full text-xs">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -25, bottom: 5 }} onClick={(e) => {
                  if (e && e.activeLabel) {
                    if (selectedDate === e.activeLabel) setSelectedDate(null);
                    else setSelectedDate(e.activeLabel);
                  } else {
                    setSelectedDate(null);
                  }
                }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  {chartData.length > 0 && (() => {
                    // Find the last index where a value has been entered (i.e. value > 0)
                    let lastActiveIndex = -1;
                    for (let i = chartData.length - 1; i >= 0; i--) {
                      if (chartData[i].value > 0) {
                        lastActiveIndex = i;
                        break;
                      }
                    }
                    const dataForAvg = lastActiveIndex >= 0 ? chartData.slice(0, lastActiveIndex + 1) : chartData;
                    const avg = dataForAvg.length > 0 ? dataForAvg.reduce((sum, d) => sum + d.value, 0) / dataForAvg.length : 0;
                    return (
                      <ReferenceLine 
                        y={avg} 
                        stroke="#94a3b8" 
                        strokeDasharray="3 3" 
                        label={{ position: 'insideTopLeft', value: `Avg: ${avg.toFixed(1)}`, fill: '#94a3b8', fontSize: 10 }}
                      />
                    );
                  })()}
                  <XAxis 
                    dataKey="date" 
                    stroke="#94a3b8" 
                    fontSize={9}
                    tickLine={false}
                    tickFormatter={formatTimelineDate}
                  />
                  <YAxis 
                    stroke="#94a3b8" 
                    fontSize={9}
                    tickLine={false}
                    axisLine={false}
                    domain={[0, (dataMax: number) => Math.max(dataMax, metricMeta.target * 1.2)]}
                  />
                  <Tooltip 
                    contentStyle={{ background: '#0f172a', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '11px' }}
                    labelStyle={{ fontWeight: 'bold' }}
                    labelFormatter={formatTimelineDate}
                  />
                  {/* Target reference boundary guideline line */}
                  <ReferenceLine 
                    y={metricMeta.target} 
                    stroke="#6366f1" 
                    strokeDasharray="4 4" 
                    label={{ value: 'Target', fill: '#6366f1', fontSize: 9, position: 'top' }} 
                  />
                  <Line 
                    type="monotone" 
                    dataKey="value" 
                    stroke={metricMeta.color} 
                    strokeWidth={3}
                    dot={(dotProps: any) => {
                      const { cx, cy, payload } = dotProps;
                      if (!cx || !cy || !payload) return null;
                      const isSelected = selectedDate === payload.date;
                      return (
                        <g 
                          key={`dot-${payload.date}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (selectedDate === payload.date) {
                              setSelectedDate(null);
                            } else {
                              setSelectedDate(payload.date);
                            }
                          }}
                          className="cursor-pointer"
                        >
                          {/* Invisible large touch target of 30px diameter (15px radius) */}
                          <circle 
                            cx={cx} 
                            cy={cy} 
                            r={15} 
                            fill="transparent" 
                            pointerEvents="all" 
                          />
                          {/* Visible small elegant dot */}
                          <circle 
                            cx={cx} 
                            cy={cy} 
                            r={isSelected ? 6 : 4} 
                            fill={isSelected ? '#ffffff' : metricMeta.color} 
                            stroke={isSelected ? metricMeta.color : '#ffffff'} 
                            strokeWidth={isSelected ? 2.5 : 1.5} 
                          />
                        </g>
                      );
                    }}
                    activeDot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>

      {nutrientDefinitions.some(n => n.key === selectedMetric) && (
        <div className="space-y-6 mt-4">
          {(() => {
            const datesToShow = selectedDate 
              ? [selectedDate] 
              : chartData.map(c => c.date).sort((a, b) => b.localeCompare(a));
            
            return datesToShow.map(dateStr => {
              const dayFoods = foodLogs.filter(f => toYYYYMMDD(f.date) === toYYYYMMDD(dateStr));
              if (dayFoods.length === 0) return null;

              const totalValue = dayFoods.reduce((acc, f) => acc + (f.nutrients?.[selectedMetric as keyof NutrientBreakdown] || 0), 0);
              const targetVal = metricMeta.target || 1;
              const datePercentage = Math.min((totalValue / targetVal) * 100, 100);

              const sortedFoods = [...dayFoods].sort((a, b) => 
                (b.nutrients?.[selectedMetric as keyof NutrientBreakdown] || 0) - 
                (a.nutrients?.[selectedMetric as keyof NutrientBreakdown] || 0)
              );

              let datePieGradient = '';
              const dateTotalPercent = (totalValue / targetVal) * 100;
              if (totalValue <= targetVal) {
                  datePieGradient = `conic-gradient(currentColor ${dateTotalPercent}%, transparent ${dateTotalPercent}%)`;
              } else {
                  const excess = dateTotalPercent - 100;
                  const cappedExcess = Math.min(excess, 100);
                  datePieGradient = `conic-gradient(#ef4444 ${cappedExcess}%, currentColor ${cappedExcess}% 100%)`;
              }
              
              const chronoFoods = [...dayFoods].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime() || a.id.localeCompare(b.id));
              let acc = 0;
              const timingMap = new Map();
              for (const f of chronoFoods) {
                const v = f.nutrients?.[selectedMetric as keyof NutrientBreakdown] || 0;
                timingMap.set(f.id, { startsAt: acc, endsAt: acc + v });
                acc += v;
              }

              return (
                <div key={dateStr} className="">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wide font-mono">
                      Food Consumed on {formatTimelineDate(dateStr)}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold ${totalValue > targetVal ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}>
                        {totalValue.toFixed(1)} / {targetVal} {metricMeta.unit}
                      </span>
                      <div className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden flex-shrink-0 relative text-slate-900 dark:text-white">
                        <div className="absolute inset-0" style={{ background: datePieGradient }} />
                      </div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {sortedFoods.map(f => {
                      const itemVal = f.nutrients?.[selectedMetric as keyof NutrientBreakdown] || 0;
                      const { startsAt, endsAt } = timingMap.get(f.id) || { startsAt: 0, endsAt: itemVal };
                      
                      const normalAmount = Math.max(0, Math.min(targetVal, endsAt) - Math.min(targetVal, startsAt));
                      const normalPercent = (normalAmount / targetVal) * 100;
                      const excessAmount = Math.max(0, endsAt - Math.max(targetVal, startsAt));
                      const excessPercent = (excessAmount / targetVal) * 100;

                      let pieGradient = '';
                      let textColorClass = 'text-slate-900 dark:text-white';
                      
                      if (endsAt <= targetVal) {
                        pieGradient = `conic-gradient(currentColor ${normalPercent}%, transparent ${normalPercent}%)`;
                      } else if (startsAt >= targetVal) {
                        pieGradient = `conic-gradient(#ef4444 ${excessPercent}%, transparent ${excessPercent}%)`;
                        textColorClass = 'text-rose-500';
                      } else {
                        pieGradient = `conic-gradient(currentColor ${normalPercent}%, #ef4444 ${normalPercent}% ${normalPercent + excessPercent}%, transparent ${normalPercent + excessPercent}%)`;
                        textColorClass = 'text-rose-500';
                      }
                      
                      return (
                        <div key={f.id} className="flex justify-between items-center py-1.5">
                          <div className="flex items-baseline gap-2 truncate pr-3 flex-1">
                            <span 
                              onClick={() => onSelectFood?.(f.id)}
                              className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 hover:underline transition-colors"
                              title="Click to view details in Food Log"
                            >
                              {f.name}
                            </span>
                            {(f.consumedAmount !== undefined && f.consumedAmount !== 1) && (
                              <span className="text-[10px] font-bold text-slate-400 flex-shrink-0">({f.consumedAmount}x)</span>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2 flex-shrink-0 whitespace-nowrap">
                            <span className={`text-xs font-bold ${textColorClass}`}>
                              {itemVal.toFixed(1)} {metricMeta.unit}
                            </span>
                            <div className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden flex-shrink-0 relative text-slate-900 dark:text-white">
                              <div className="absolute inset-0" style={{ background: pieGradient }} />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}
      </>
      )}
    </div>
  );
}
