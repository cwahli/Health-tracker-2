import React, { useState } from 'react';
import { UserProfile, FoodLog, BiomarkerLog, RecommendationReport, NutrientBreakdown } from '../types';
import { nutrientDefinitions } from '../utils/nutrition';
import { translations } from '../utils/translations';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { TrendingUp, BarChart2, Calendar, EyeOff } from 'lucide-react';
import { toYYYYMMDD, formatTimelineDate } from '../utils/dateUtils';

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

  return (
    <div className="space-y-5 pb-24 animation-fade-in max-w-md mx-auto px-[15px] mt-4 font-sans text-slate-900">
      
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

    </div>
  );
}
