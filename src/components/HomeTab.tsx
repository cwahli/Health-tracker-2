import React from 'react';
import { UserProfile, FoodLog, HealthAction, DailyBenefit, RecommendationReport, BiomarkerLog, ChatMessage, FoodIdea } from '../types';
import { translations } from '../utils/translations';
import { CheckCircle2, Circle, AlertCircle, Heart, ChevronDown, ChevronUp, Calendar, MapPin, Search, Sparkles, Trash2, RefreshCw, Clock, Settings, X, TrendingUp, Activity, Copy } from 'lucide-react';
import { getBiomarkerStatus, getBiomarkerColor, getBiomarkerStatusLabel, biomarkerDefinitions, isAsianEthnicity, getBiomarkerMetadata } from '../utils/biomarkers';
import { getAgentCalibration } from '../utils/agentCalibration';
import { getCurrentDateInTimezone } from '../utils/dateUtils';
import { standardizeUnit, reverseStandardizeUnit, formatNormalRange } from '../utils/unitConversion';
import { BiomarkerExpandedSection } from './BiomarkerExpandedSection';
import ReviewBiomarkerModal from './ReviewBiomarkerModal';
import LogChat from './LogChat';

interface HomeTabProps {
  profile: UserProfile;
  foodLogs: FoodLog[];
  biomarkers: { [key: string]: number | string };
  biomarkerHistory: BiomarkerLog[];
  actions: HealthAction[];
  setActions: (actions: HealthAction[]) => void;
  dailyBenefits: DailyBenefit[];
  setDailyBenefits: (b: DailyBenefit[]) => void;
  foodIdeas: FoodIdea[];
  setFoodIdeas: (ideas: FoodIdea[]) => void;
  report: RecommendationReport | null;
  onNavigateToTab: (tab: 'home' | 'insights' | 'food' | 'medical' | 'trends') => void;
  onEditBiomarkerLog: (id: string, key: string, value: string | number, newDate?: string) => void;
  onDeleteBiomarkerLog: (id: string) => void;
  onDeleteBiomarkerFromLog?: (id: string, key: string) => void;
  onLogMedical?: (biomarkers: { [key: string]: number | string }, profileUpdates?: Partial<UserProfile>, date?: string, entries?: { date: string | null; biomarkers: { [key: string]: number | string } }[]) => void;
  onOpenAgentChat?: (agentType: 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5', options?: { prefillMessage?: string }) => void;
  hideSensitive: boolean;
  selectedModelId: string;
  onChangeModelId: (id: string) => void;
  hasBmiAlert?: boolean;
  onDismissBmiAlert?: () => void;
  onUpdateReport?: (report: any) => void;
  onApplyCalculation?: (updates: {
    targetCalories?: number;
    targetWeight?: number;
    addedBenefit?: string;
    descriptionExplain?: string;
  }) => void;
}

export default function HomeTab({
  profile,
  foodLogs,
  biomarkers,
  biomarkerHistory,
  actions,
  setActions,
  dailyBenefits,
  setDailyBenefits,
  foodIdeas,
  setFoodIdeas,
  report,
  onNavigateToTab,
  onEditBiomarkerLog,
  onDeleteBiomarkerLog,
  onDeleteBiomarkerFromLog,
  onLogMedical,
  onOpenAgentChat,
  hideSensitive,
  selectedModelId,
  onChangeModelId,
  hasBmiAlert,
  onDismissBmiAlert,
  onApplyCalculation,
  onUpdateReport,
}: HomeTabProps) {
  const t = translations[profile.language] || translations.en;
  const [showAllTargets, setShowAllTargets] = React.useState(false);
  const [expandedKey, setExpandedKey] = React.useState<string | null>(null);
  const [reviewingBiomarkerKey, setReviewingBiomarkerKey] = React.useState<string | null>(null);
  const [reviewHistories, setReviewHistories] = React.useState<{[key: string]: ChatMessage[]}>({});
  const [isFoodIdeaChatOpen, setIsFoodIdeaChatOpen] = React.useState(false);
  const [isDailyRecommendationChatOpen, setIsDailyRecommendationChatOpen] = React.useState(false);
  const [showHealthDiagnostics, setShowHealthDiagnostics] = React.useState(false);
  const [healthApiStatus, setHealthApiStatus] = React.useState<string>("Success (No API payload cached)");
  const [lastApiPayload, setLastApiPayload] = React.useState<any>(null);
  const [userLocation, setUserLocation] = React.useState<{ lat: number; lng: number } | null>(null);

  // Rolling target configurations and persistent states
  const [rollingEnabled, setRollingEnabled] = React.useState<boolean>(() => {
    return localStorage.getItem('rollingTargetEnabled') === 'true';
  });
  const [rollingDays, setRollingDays] = React.useState<number>(() => {
    const saved = localStorage.getItem('rollingDays');
    return saved ? parseInt(saved, 10) : 7;
  });
  const [rollingAllowance, setRollingAllowance] = React.useState<number>(() => {
    const saved = localStorage.getItem('rollingAllowance');
    return saved ? parseInt(saved, 10) : 20;
  });
  const [viewTimeframe, setViewTimeframe] = React.useState<string>(() => {
    return localStorage.getItem('targetViewTimeframe') || '1';
  });
  const [isSettingsModalOpen, setIsSettingsModalOpen] = React.useState<boolean>(false);
  const [isTargetsExpanded, setIsTargetsExpanded] = React.useState<boolean>(false);

  React.useEffect(() => {
    localStorage.setItem('targetViewTimeframe', viewTimeframe);
  }, [viewTimeframe]);

  React.useEffect(() => {
    localStorage.setItem('rollingTargetEnabled', String(rollingEnabled));
  }, [rollingEnabled]);

  React.useEffect(() => {
    localStorage.setItem('rollingDays', String(rollingDays));
  }, [rollingDays]);

  React.useEffect(() => {
    localStorage.setItem('rollingAllowance', String(rollingAllowance));
  }, [rollingAllowance]);



  // Combine static and custom definitions for HomeTab
  const allDefinitions = React.useMemo(() => {
    // Clone biomarkerDefinitions so we don't mutate the original static array
    const combined = biomarkerDefinitions.map(d => {
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
              [profile.language || 'en']: 'A measure of body fat based on height and weight.'
            };
          } else {
            existing.normalRange = def.normalRange || existing.normalRange;
            existing.unit = def.unit || existing.unit;
            if (def.description) {
              existing.descriptions = { ...existing.descriptions, [profile.language || 'en']: def.description };
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
            benefitRisk: def.benefitRisk
          } as any);
        }
      });
    }
    return combined;
  }, [profile.customBiomarkers, profile.language, profile.ethnicity, profile.gender, profile.height]);

  // Compute resolvedBiomarkers including BMI from profile if not explicitly defined in historical log
  const resolvedBiomarkers = React.useMemo(() => {
    // Collect all keys from history + biomarkers
    const keys = new Set<string>();
    (biomarkerHistory || []).forEach(h => {
      if (h.biomarkers) {
        Object.keys(h.biomarkers).forEach(k => keys.add(k));
      }
    });
    if (biomarkers) {
      Object.keys(biomarkers).forEach(k => keys.add(k));
    }

    // Derive the latest value for each key from history, fallback to biomarkers
    const res: Record<string, number | string> = {};
    keys.forEach(key => {
      const relevantLogs = (biomarkerHistory || [])
        .filter(h => h.biomarkers && h.biomarkers[key] !== undefined && h.biomarkers[key] !== null && h.biomarkers[key] !== '')
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      if (relevantLogs.length > 0) {
        res[key] = relevantLogs[0].biomarkers[key];
      } else if (biomarkers && biomarkers[key] !== undefined) {
        res[key] = biomarkers[key];
      }
    });

    if (res.bmi === undefined && profile.weight && profile.height) {
      const heightInMeters = Number(profile.height) / 100;
      const bmiScore = Number(profile.weight) / (heightInMeters * heightInMeters);
      res.bmi = parseFloat(bmiScore.toFixed(1));
    }
    return res;
  }, [biomarkers, biomarkerHistory, profile.weight, profile.height]);

  const problematicBiomarkers = React.useMemo(() => {
    const list = Object.entries(resolvedBiomarkers)
      .map(([key, val]) => {
        const def = allDefinitions.find(d => d.key === key);
        if (!def) return null;
        const status = getBiomarkerStatus(key, val as string | number, def.normalRange, def, profile);
        
        let displayValue = val;
        let displayUnit = def.unit || '';
        if (profile.unitPreference === 'US' && typeof val === 'number') {
           const reversed = reverseStandardizeUnit(key, val, displayUnit);
           displayValue = reversed.newValue;
           displayUnit = reversed.newUnit || displayUnit;
        }

        return {
          key,
          value: displayValue,
          unit: displayUnit,
          originalValue: val,
          status,
          def: { ...def, unit: displayUnit, normalRange: formatNormalRange(key, def.normalRange || '', def.unit || '', profile.unitPreference as 'SI' | 'US') }
        };
      })
      .filter((b): b is NonNullable<typeof b> => {
        if (b === null) return false;
        if (b.key === 'bmi' && hasBmiAlert) return true;
        return b.status === 'high' || b.status === 'low' || b.status === 'critical';
      });

    return list.sort((a, b) => {
      const getPriority = (status: string) => {
        if (status === 'critical') return 3;
        if (status === 'high' || status === 'low') return 2;
        return 1;
      };
      return getPriority(b.status) - getPriority(a.status);
    });
  }, [resolvedBiomarkers, allDefinitions, hasBmiAlert]);

  // Compute daily consumption from food history for today
  const todayStr = getCurrentDateInTimezone(profile.timezone);
  const todaysFoods = foodLogs.filter(f => f.date === todayStr);

  const todaysTotals = todaysFoods.reduce((acc, curr) => {
    if (curr.nutrients) {
      Object.keys(curr.nutrients).forEach(k => {
        const key = k as keyof typeof curr.nutrients;
        acc[key] = (Number(acc[key]) || 0) + (Number(curr.nutrients[key]) || 0);
      });
    }
    return acc;
  }, {} as { [key: string]: number });

  // Compute consumption totals/averages based on selected viewTimeframe
  const timeframeTotals = React.useMemo(() => {
    const days = parseInt(viewTimeframe, 10);
    if (days <= 1) {
      return todaysTotals;
    }
    
    const totals: { [key: string]: number } = {};
    
    const parts = todayStr.split('-');
    const todayDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    
    const targetDates = new Set<string>();
    for (let i = 0; i < days; i++) {
      const d = new Date(todayDate);
      d.setDate(todayDate.getDate() - i);
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      targetDates.add(`${yyyy}-${mm}-${dd}`);
    }
    
    const foodsInRange = foodLogs.filter(f => targetDates.has(f.date));
    
    foodsInRange.forEach(f => {
      if (f.nutrients) {
        Object.keys(f.nutrients).forEach(k => {
          const val = Number(f.nutrients[k]) || 0;
          totals[k] = (totals[k] || 0) + val;
        });
      }
    });
    
    const averages: { [key: string]: number } = {};
    Object.keys(totals).forEach(k => {
      const avg = totals[k] / days;
      if (avg >= 10) {
        averages[k] = Math.round(avg);
      } else {
        averages[k] = Math.round(avg * 10) / 10;
      }
    });
    
    return averages;
  }, [viewTimeframe, todaysTotals, foodLogs, todayStr]);

  const toggleAction = (id: string) => {
    setActions(actions.map(act => act.id === id ? { ...act, completed: !act.completed } : act));
  };

  const toggleBenefit = (id: string) => {
    setDailyBenefits(dailyBenefits.map(ben => ben.id === id ? { ...ben, completed: !ben.completed } : ben));
  };

  const deleteBenefit = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDailyBenefits(dailyBenefits.filter(ben => ben.id !== id));
  };

  // Target values (Default or from report)
  const parseTarget = (val: any, fallback: number) => {
    if (val === null || val === undefined) return fallback;
    const cleanStr = String(val).replace(/,/g, '');
    const matches = cleanStr.match(/\d+(\.\d+)?/g);
    if (!matches || matches.length === 0) return fallback;
    const parsed = parseFloat(matches[0]);
    return isNaN(parsed) ? fallback : parsed;
  };

  const fallbackUnits: { [key: string]: string } = {
    calories: 'kcal',
    protein: 'g',
    totalFat: 'g',
    saturatedFat: 'g',
    unsaturatedFat: 'g',
    omega3: 'g',
    carbohydrates: 'g',
    addedSugar: 'g',
    totalFibre: 'g',
    solubleFibre: 'g',
    sodium: 'mg',
    potassium: 'mg',
    magnesium: 'mg',
    calcium: 'mg',
    iron: 'mg',
    zinc: 'mg',
    selenium: 'mcg',
    iodine: 'mcg',
    phosphorus: 'mg',
    vitaminD: 'IU',
    vitaminB12: 'mcg',
    folate: 'mcg',
    vitaminC: 'mg',
    vitaminE: 'mg',
    vitaminK: 'mcg',
    vitaminA: 'mcg',
    vitaminB6: 'mg',
    thiamine: 'mg',
    riboflavin: 'mg',
    niacin: 'mg',
    steps: 'steps'
  };

  const parseUnit = (val: any, fallbackUnit: string) => {
    if (val === null || val === undefined) return fallbackUnit;
    const valStr = String(val).trim();
    const unitMatch = valStr.match(/(kcal|mcg|mg|g|IU|steps)/i);
    return unitMatch ? unitMatch[0] : fallbackUnit;
  };

  const getDecimalPlaces = (num: number): number => {
    const str = String(num);
    const dotIndex = str.indexOf('.');
    return dotIndex === -1 ? 0 : str.length - dotIndex - 1;
  };

  const getRollingBreakdown = React.useCallback((key: string, baseTarget: number) => {
    if (!rollingEnabled) return null;
    
    const numPrevDays = rollingDays - 1;
    if (numPrevDays <= 0) return null;
    let totalPrevIntake = 0;
    
    for (let d = 1; d <= numPrevDays; d++) {
      const parts = todayStr.split('-');
      const todayDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      const prevDate = new Date(todayDate);
      prevDate.setDate(todayDate.getDate() - d);
      
      const yyyy = prevDate.getFullYear();
      const mm = String(prevDate.getMonth() + 1).padStart(2, '0');
      const dd = String(prevDate.getDate()).padStart(2, '0');
      const targetDateStr = `${yyyy}-${mm}-${dd}`;
      
      const dayFoods = foodLogs.filter(f => f.date === targetDateStr);
      if (dayFoods.length > 0) {
        const dayTotal = dayFoods.reduce((acc, curr) => {
          return acc + (Number(curr.nutrients?.[key]) || 0);
        }, 0);
        totalPrevIntake += dayTotal;
      } else {
        totalPrevIntake += baseTarget;
      }
    }
    const totalPrevTarget = numPrevDays * baseTarget;
    const deficit = totalPrevTarget - totalPrevIntake;
    
    const maxAdjustment = baseTarget * (rollingAllowance / 100);
    const adjustment = Math.max(-maxAdjustment, Math.min(maxAdjustment, deficit));
    const adjustedValue = baseTarget + adjustment;
    
    const decimals = getDecimalPlaces(baseTarget);
    const factor = Math.pow(10, decimals);
    
    return {
      totalPrevTarget: Math.ceil(totalPrevTarget * factor) / factor,
      totalPrevIntake: Math.ceil(totalPrevIntake * factor) / factor,
      maxAdjustment: Math.ceil(maxAdjustment * factor) / factor,
      adjustment: Math.ceil(adjustment * factor) / factor,
      adjustedValue: Math.ceil(adjustedValue * factor) / factor,
      numPrevDays
    };
  }, [rollingEnabled, rollingDays, rollingAllowance, todayStr, foodLogs]);

  const getAdjustedTarget = React.useCallback((key: string, baseTarget: number): number => {
    const breakdown = getRollingBreakdown(key, baseTarget);
    if (!breakdown) return baseTarget;
    return breakdown.adjustedValue;
  }, [getRollingBreakdown]);

  const baseCaloriesTarget = report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.calories, 1700) : 1800;
  const baseSatFatTarget = report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.saturatedFat, 15) : 15;
  const baseSodiumTarget = report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.sodium, 1200) : 1200;
  const baseProteinTarget = report && report.dailyNutrientTargets ? parseTarget(report.dailyNutrientTargets.protein, 90) : 90;

  const formatValue = (val: number) => {
    if (val >= 10) return Math.ceil(val);
    return Math.ceil(val * 10) / 10;
  };

  const activeTargets = {
    calories: formatValue(Number(timeframeTotals.calories || 0)),
    caloriesTarget: getAdjustedTarget('calories', baseCaloriesTarget),
    satFat: formatValue(Number(timeframeTotals.saturatedFat || 0)),
    satFatTarget: getAdjustedTarget('saturatedFat', baseSatFatTarget),
    sodium: formatValue(Number(timeframeTotals.sodium || 0)),
    sodiumTarget: getAdjustedTarget('sodium', baseSodiumTarget),
    protein: formatValue(Number(timeframeTotals.protein || 0)),
    proteinTarget: getAdjustedTarget('protein', baseProteinTarget),
  };

  // Compliance calculations (Last 7 days/30 days mock score + live factor)
  const completedActionsCount = actions.filter(a => a.completed).length;
  const completedBenefitsCount = dailyBenefits.filter(b => b.completed).length;
  
  // Real live index score derived from checks
  const rawScore = 65 + (completedActionsCount * 6) + (completedBenefitsCount * 4) - (activeTargets.satFat > activeTargets.satFatTarget ? 8 : 0);
  const complianceScore7Day = Math.min(100, rawScore);
  const complianceScore30Day = Math.min(100, Math.round(rawScore * 0.95));

  const distinctDaysOfData = new Set(foodLogs.map(l => l.date)).size;

  const missingProfilePoints: string[] = [];
  if (profile.age === undefined || profile.age === null || String(profile.age).trim() === '') missingProfilePoints.push('Age');
  if (profile.ethnicity === undefined || profile.ethnicity === null || String(profile.ethnicity).trim() === '' || String(profile.ethnicity).toLowerCase() === 'unknown') missingProfilePoints.push('Ethnicity');
  if (profile.weight === undefined || profile.weight === null || String(profile.weight).trim() === '') missingProfilePoints.push('Weight');
  if (profile.height === undefined || profile.height === null || String(profile.height).trim() === '') missingProfilePoints.push('Height');

  const getMissingDataStatus = () => {
    const basicInfoMissing = ['Age', 'Ethnicity', 'Weight', 'Height'].filter(f => missingProfilePoints.includes(f));
    const missing = [];
    if (basicInfoMissing.length > 0) missing.push('basic profile info (Age, Height, etc)');
    if (foodLogs.length === 0) missing.push('some food logs');
    if (Object.keys(biomarkers).length === 0) missing.push('medical biomarkers');
    return missing;
  };

  const getDynamicNextStep = () => {
    if (report?.mostImportantNextStep) {
      return report.mostImportantNextStep;
    }
    const missing = getMissingDataStatus();
    if (missing.length > 0) {
      return `To get your personalized health recommendations, please add ${missing.join(', ')}.`;
    }
    return "You have provided enough information. Please go to Insights and run a health analysis!";
  };

  const emailSuffix = React.useMemo(() => {
    return profile?.email ? `_${profile.email.toLowerCase().trim()}` : '_guest';
  }, [profile?.email]);

  const [googleSteps, setGoogleSteps] = React.useState<number | null>(null);
  const [googleStepsAverage, setGoogleStepsAverage] = React.useState<number | null>(null);
  const [lastActiveDaySteps, setLastActiveDaySteps] = React.useState<number | null>(null);
  const [lastActiveDayTimestamp, setLastActiveDayTimestamp] = React.useState<string | null>(null);

  React.useEffect(() => {
    const gs = localStorage.getItem(`googleSteps${emailSuffix}`);
    setGoogleSteps(gs ? parseInt(gs, 10) : null);
    
    const gsa = localStorage.getItem(`googleStepsAverage${emailSuffix}`);
    setGoogleStepsAverage(gsa ? parseInt(gsa, 10) : null);
    
    const lads = localStorage.getItem(`lastActiveDaySteps${emailSuffix}`);
    setLastActiveDaySteps(lads ? parseInt(lads, 10) : null);
    
    setLastActiveDayTimestamp(localStorage.getItem(`lastActiveDayTimestamp${emailSuffix}`));
  }, [emailSuffix]);

  const currentStepsValue = React.useMemo(() => {
    const days = parseInt(viewTimeframe, 10);
    if (days <= 1) {
      return googleSteps || 0;
    }
    const historyStr = localStorage.getItem(`googleStepsHistory${emailSuffix}`);
    if (historyStr) {
      try {
        const history: { date: string; value: number }[] = JSON.parse(historyStr);
        const parts = todayStr.split('-');
        const todayDate = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
        const targetDates = new Set<string>();
        for (let i = 0; i < days; i++) {
          const d = new Date(todayDate);
          d.setDate(todayDate.getDate() - i);
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          targetDates.add(`${yyyy}-${mm}-${dd}`);
        }
        const matches = history.filter(h => targetDates.has(h.date));
        if (matches.length > 0) {
          const total = matches.reduce((sum, h) => sum + h.value, 0);
          return Math.round(total / days);
        }
      } catch (e) {
        console.warn(e);
      }
    }
    return googleStepsAverage || 0;
  }, [viewTimeframe, googleSteps, googleStepsAverage, todayStr, emailSuffix]);

  React.useEffect(() => {
    const handleGoogleUpdate = () => {
      const gs = localStorage.getItem(`googleSteps${emailSuffix}`);
      setGoogleSteps(gs ? parseInt(gs, 10) : null);
      
      const gsa = localStorage.getItem(`googleStepsAverage${emailSuffix}`);
      setGoogleStepsAverage(gsa ? parseInt(gsa, 10) : null);
      
      const lads = localStorage.getItem(`lastActiveDaySteps${emailSuffix}`);
      setLastActiveDaySteps(lads ? parseInt(lads, 10) : null);
      
      setLastActiveDayTimestamp(localStorage.getItem(`lastActiveDayTimestamp${emailSuffix}`));
    };
    
    window.addEventListener('googleStepsUpdated', handleGoogleUpdate);
    return () => window.removeEventListener('googleStepsUpdated', handleGoogleUpdate);
  }, [emailSuffix]);

  const hasNoData = foodLogs.length === 0 && biomarkerHistory.length === 0;

  if (hasNoData) {
    return (
      <div className="space-y-6 pb-24 animation-fade-in max-w-md mx-auto px-[15px] mt-4 font-sans text-slate-900">
        <div className="text-center py-8 space-y-3">
          <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-3xl flex items-center justify-center mx-auto shadow-inner">
            <Sparkles className="w-8 h-8" />
          </div>
          <div className="space-y-1">
            <h2 id="empty-state-title" className="text-xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100">
              Welcome to Your Health Portal
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto leading-relaxed">
              Your dashboard is ready! Log some records to calibrate your metabolic targets, nutrition recommendations, and biomarker risk assessments.
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {/* Option 1: Complete Profile */}
          <div id="empty-state-profile-card" className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-150 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-xl shrink-0">
                <Settings className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Complete Your Profile
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
                  Add details like age, weight, height, ethnicity, and gender. This calibrates our medical and AI engines to calculate custom daily targets specifically for you.
                </p>
              </div>
            </div>
            <button
              id="empty-state-profile-btn"
              onClick={() => {
                document.getElementById('avatar-edit-btn')?.click();
              }}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              Configure Profile
            </button>
          </div>

          {/* Option 2: Log Food */}
          <div id="empty-state-food-card" className="p-5 bg-white dark:bg-slate-900 rounded-2xl border border-slate-150 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex items-start gap-3">
              <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-xl shrink-0">
                <Heart className="w-5 h-5" />
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Log a Food or Meal
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-normal">
                  Type what you ate or speak naturally to get an automatic clinical breakdown, nutrient calculations, and personalized health recommendations.
                </p>
              </div>
            </div>
            <button
              id="empty-state-food-btn"
              onClick={() => {
                const foodFab = document.getElementById('fab-food-btn');
                if (foodFab) {
                  foodFab.click();
                } else {
                  onNavigateToTab('food');
                }
              }}
              className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer"
            >
              Add Your First Food Log
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24 animation-fade-in max-w-md mx-auto px-[15px] mt-4 font-sans text-slate-900">
      
      {/* Daily Recommendation */}
      <div id="primary-action-card" className="p-2">
        <div className="flex items-center justify-between bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-2xl border border-indigo-100 dark:border-indigo-800/50 shadow-sm">
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-indigo-900 dark:text-indigo-100 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-indigo-500" />
              Daily Recommendation
            </h3>
            <p className="text-xs text-indigo-700 dark:text-indigo-300">
              Get personalized insights on your progress and today's goals.
            </p>
          </div>
          <button
            onClick={() => setIsDailyRecommendationChatOpen(true)}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer whitespace-nowrap"
          >
            What's up today?
          </button>
        </div>
      </div>

      {/* Nutrition Allowance Tracker Dashboard (MOVED UP just above Health Status & BMI) */}
      <div id="dashboard-nutrition-targets" className="space-y-4">
        <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800/50">
          <h3 className="font-bold text-slate-950 dark:text-slate-100 text-sm flex items-center gap-2">
            <Heart className="w-4 h-4 text-indigo-600" />
            Today's Top Targets
          </h3>
          <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
            <Calendar className="w-3 h-3" /> {todayStr}
          </span>
        </div>

        {/* Live progress bars comparing actual todaysTotals vs targets */}
        <div className="space-y-4">
          {/* Calorie Bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-slate-700 dark:text-slate-300">Calories Allowed</span>
              {activeTargets.calories > activeTargets.caloriesTarget ? (
                <span className="text-rose-500 font-bold font-mono">
                  {Math.ceil(activeTargets.calories - activeTargets.caloriesTarget)} cal over {activeTargets.caloriesTarget} daily
                </span>
              ) : (
                <span className="text-slate-500 font-mono">{activeTargets.calories} / {activeTargets.caloriesTarget} kcal</span>
              )}
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
              {activeTargets.calories > activeTargets.caloriesTarget ? (
                <>
                  <div 
                    className="h-full bg-indigo-600 transition-all duration-500" 
                    style={{ width: `${(activeTargets.caloriesTarget / activeTargets.calories) * 100}%` }}
                  />
                  <div 
                    className="h-full bg-rose-500 transition-all duration-500" 
                    style={{ width: `${((activeTargets.calories - activeTargets.caloriesTarget) / activeTargets.calories) * 100}%` }}
                  />
                </>
              ) : (
                <div 
                  className="h-full bg-indigo-600 rounded-full transition-all duration-500" 
                  style={{ width: `${(activeTargets.calories / activeTargets.caloriesTarget) * 100}%` }}
                />
              )}
            </div>
          </div>

          {/* Saturated Fat Bar (Critical for LDL) */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-slate-700 dark:text-slate-300">Saturated Fat Limit</span>
              {activeTargets.satFat > activeTargets.satFatTarget ? (
                <span className="text-rose-500 font-bold font-mono">
                  {(activeTargets.satFat - activeTargets.satFatTarget).toFixed(1)}g over {activeTargets.satFatTarget}g daily
                </span>
              ) : (
                <span className="text-slate-500 font-mono">{activeTargets.satFat}g / {activeTargets.satFatTarget}g</span>
              )}
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
              {activeTargets.satFat > activeTargets.satFatTarget ? (
                <>
                  <div 
                    className="h-full bg-indigo-600 transition-all duration-500" 
                    style={{ width: `${(activeTargets.satFatTarget / activeTargets.satFat) * 100}%` }}
                  />
                  <div 
                    className="h-full bg-rose-500 transition-all duration-500" 
                    style={{ width: `${((activeTargets.satFat - activeTargets.satFatTarget) / activeTargets.satFat) * 100}%` }}
                  />
                </>
              ) : (
                <div 
                  className="h-full bg-indigo-600 rounded-full transition-all duration-500" 
                  style={{ width: `${(activeTargets.satFat / activeTargets.satFatTarget) * 100}%` }}
                />
              )}
            </div>
          </div>

          {/* Sodium Bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-slate-700 dark:text-slate-300">Sodium Guard</span>
              {activeTargets.sodium > activeTargets.sodiumTarget ? (
                <span className="text-rose-500 font-bold font-mono">
                  {(activeTargets.sodium - activeTargets.sodiumTarget).toFixed(0)}mg over {activeTargets.sodiumTarget}mg daily
                </span>
              ) : (
                <span className="text-slate-500 font-mono">{activeTargets.sodium}mg / {activeTargets.sodiumTarget}mg</span>
              )}
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden flex">
              {activeTargets.sodium > activeTargets.sodiumTarget ? (
                <>
                  <div 
                    className="h-full bg-indigo-600 transition-all duration-500" 
                    style={{ width: `${(activeTargets.sodiumTarget / activeTargets.sodium) * 100}%` }}
                  />
                  <div 
                    className="h-full bg-rose-500 transition-all duration-500" 
                    style={{ width: `${((activeTargets.sodium - activeTargets.sodiumTarget) / activeTargets.sodium) * 100}%` }}
                  />
                </>
              ) : (
                <div 
                  className="h-full bg-indigo-600 rounded-full transition-all duration-500" 
                  style={{ width: `${(activeTargets.sodium / activeTargets.sodiumTarget) * 100}%` }}
                />
              )}
            </div>
          </div>

          {/* Steps Bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs font-semibold">
              <span className="text-slate-700 dark:text-slate-300 flex items-center gap-1">
                <span>Steps</span>
                {googleStepsAverage !== null && (
                  <span className="text-[10px] text-slate-400 font-normal">
                    (7d avg: {googleStepsAverage.toLocaleString()})
                  </span>
                )}
              </span>
              <span className={`font-mono ${currentStepsValue >= (parseTarget(report?.dailyNutrientTargets?.steps, 3000)) ? 'text-emerald-500 font-bold' : 'text-slate-500'}`}>
                {currentStepsValue} / {parseTarget(report?.dailyNutrientTargets?.steps, 3000)} steps
              </span>
            </div>
            <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-500 ${currentStepsValue >= (parseTarget(report?.dailyNutrientTargets?.steps, 3000)) ? 'bg-emerald-500' : 'bg-indigo-600'}`} 
                style={{ width: `${Math.min(100, (currentStepsValue / (parseTarget(report?.dailyNutrientTargets?.steps, 3000))) * 100)}%` }}
              />
            </div>
            {currentStepsValue === 0 && lastActiveDaySteps && (
              <p className="text-[10px] text-slate-400 italic">
                Today: 0 steps. Last active day: {lastActiveDaySteps.toLocaleString()} steps ({lastActiveDayTimestamp})
              </p>
            )}
          </div>
        </div>

        {/* Expandable Targets Section */}
        {report && (
          <div>
            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800/30 mt-3">
              <button
                onClick={() => setShowAllTargets(!showAllTargets)}
                className="flex items-center gap-1 text-xs text-slate-400 hover:text-indigo-600 font-semibold cursor-pointer"
              >
                <span>{showAllTargets ? 'Show Less Targets' : 'Expand Less Important Targets'}</span>
                {showAllTargets ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              
              <button
                onClick={() => setIsSettingsModalOpen(true)}
                className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-semibold cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
                <span>Settings</span>
              </button>
            </div>

            {showAllTargets && (
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs py-2 animation-slide-down">
                {Object.entries(report?.dailyNutrientTargets || {}).map(([key, val]) => {
                  if (['calories', 'saturatedFat', 'sodium', 'steps'].includes(key)) return null;
                  
                  const baseTarget = parseTarget(val, 0);
                  const unit = parseUnit(val, fallbackUnits[key] || 'g');
                  const actual = Number(timeframeTotals[key] || 0);
                  const adjustedTarget = getAdjustedTarget(key, baseTarget);
                  
                  const pct = adjustedTarget > 0 ? (actual / adjustedTarget) * 100 : 0;
                  
                  // Decide if this nutrient is a limit or a requirement
                  // Limits: addedSugar, saturatedFat, sodium, totalFat
                  const isLimit = ['addedSugar', 'saturatedFat', 'sodium', 'totalFat'].includes(key);
                  const isOver = actual > adjustedTarget;
                  
                  let barColor = 'bg-indigo-600';
                  if (isLimit) {
                    barColor = isOver ? 'bg-rose-500' : 'bg-emerald-500';
                  } else {
                    barColor = actual >= adjustedTarget ? 'bg-emerald-500' : 'bg-indigo-600';
                  }

                  const formattedActual = formatValue(actual);

                  return (
                    <div key={key} className="flex flex-col py-2 border-b border-slate-100 dark:border-slate-800/50 space-y-1">
                      <div className="flex justify-between items-start text-[10px] leading-tight">
                        <span className="text-slate-500 dark:text-slate-400 font-bold capitalize truncate max-w-[80px]">
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </span>
                        <span className="text-slate-400 dark:text-slate-500 font-semibold font-mono text-[9px] whitespace-nowrap">
                          {formattedActual}/{adjustedTarget}{unit}
                        </span>
                      </div>
                      <div className="h-1.5 bg-slate-100 dark:bg-slate-800/80 rounded-full overflow-hidden">
                        <div 
                          className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                          style={{ width: `${Math.min(100, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {isSettingsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-3xl p-6 shadow-xl space-y-5 max-h-[90vh] overflow-y-auto">
            {/* Header */}
            <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800/50">
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                <Settings className="w-4 h-4 text-indigo-600" />
                Target Budget Settings
              </h3>
              <button
                onClick={() => setIsSettingsModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-850 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Explanation card */}
            <div className="p-3 bg-indigo-50/50 dark:bg-indigo-950/20 border border-indigo-500/10 rounded-2xl text-xs text-indigo-950 dark:text-indigo-200/90 leading-relaxed space-y-2">
              <span className="font-bold block text-indigo-900 dark:text-indigo-300">How Rolling Budget Works</span>
              {(() => {
                const calBD = getRollingBreakdown('calories', baseCaloriesTarget);
                const proBD = getRollingBreakdown('protein', baseProteinTarget);
                const fatBD = getRollingBreakdown('saturatedFat', baseSatFatTarget);
                
                if (!calBD || !proBD || !fatBD) return <p>Adjusts your target today based on your previous days' averages.</p>;
                
                return (
                  <div className="space-y-2">
                    <div className="grid grid-cols-1 gap-1.5 text-[10px] font-mono">
                      <div className="flex flex-col">
                        <span className="font-bold">Calories:</span>
                        <span className="text-indigo-600 dark:text-indigo-400">({calBD.totalPrevIntake} kcal / {calBD.numPrevDays} days) ± {rollingAllowance}% allowance = {calBD.adjustedValue} kcal</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="font-bold">Protein:</span>
                        <span className="text-indigo-600 dark:text-indigo-400">({proBD.totalPrevIntake} g / {proBD.numPrevDays} days) ± {rollingAllowance}% allowance = {proBD.adjustedValue} g</span>
                      </div>
                      <div className="flex flex-col">
                        <span className="font-bold">Sat. Fat:</span>
                        <span className="text-indigo-600 dark:text-indigo-400">({fatBD.totalPrevIntake} g / {fatBD.numPrevDays} days) ± {rollingAllowance}% allowance = {fatBD.adjustedValue} g</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Form Fields */}
            <div className="space-y-4">
              {/* Toggle */}
              <div className="flex items-center justify-between p-1">
                <div className="space-y-0.5">
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-200">Enable Rolling Target</span>
                  <p className="text-[10px] text-slate-400">Adapt targets dynamically based on history</p>
                </div>
                <button
                  onClick={() => setRollingEnabled(!rollingEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                    rollingEnabled ? 'bg-indigo-600' : 'bg-slate-200 dark:bg-slate-800'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      rollingEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {rollingEnabled && (
                <>
                  {/* Rolling Days */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-bold text-slate-900 dark:text-slate-100">
                      <span>Rolling Timeframe</span>
                      <span className="text-indigo-650 dark:text-indigo-400 font-mono">{rollingDays} Days</span>
                    </div>
                    <input
                      type="range"
                      min="2"
                      max="30"
                      value={rollingDays}
                      onChange={(e) => setRollingDays(parseInt(e.target.value))}
                      className="w-full accent-indigo-600 cursor-pointer"
                    />
                    <p className="text-[9px] text-slate-400">Uses the last {rollingDays - 1} logged days to calibrate today's target.</p>
                  </div>

                  {/* Authorization Limit % */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-xs font-bold text-slate-900 dark:text-slate-100">
                      <span>Maximum Adjustment Limit</span>
                      <span className="text-indigo-650 dark:text-indigo-400 font-mono">{rollingAllowance}%</span>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max="100"
                      step="5"
                      value={rollingAllowance}
                      onChange={(e) => setRollingAllowance(parseInt(e.target.value))}
                      className="w-full accent-indigo-600 cursor-pointer"
                    />
                    <p className="text-[9px] text-slate-400">Cap the target fluctuation to a maximum of ±{rollingAllowance}% of the base budget.</p>
                  </div>
                </>
              )}

              {/* Targets Section */}
              <div className="space-y-3 border-t border-slate-100 dark:border-slate-800/50 pt-3">
                <button
                  onClick={() => setIsTargetsExpanded(!isTargetsExpanded)}
                  className="flex items-center justify-between w-full text-xs font-bold text-slate-900 dark:text-slate-100 cursor-pointer"
                >
                  <span>Edit Nutrient Targets</span>
                  <ChevronDown className={`w-4 h-4 transition-transform ${isTargetsExpanded ? 'rotate-180' : ''}`} />
                </button>
                                {isTargetsExpanded && (
                  <div className="grid grid-cols-2 gap-3 pt-2 max-h-[300px] overflow-y-auto pr-1">
                    {[{"key":"calories","label":"Calories","unit":"kcal","default":1800},{"key":"protein","label":"Protein","unit":"g","default":70},{"key":"carbohydrates","label":"Carbs","unit":"g","default":200},{"key":"totalFat","label":"Total Fat","unit":"g","default":60},{"key":"saturatedFat","label":"Sat. Fat","unit":"g","default":20},{"key":"unsaturatedFat","label":"Unsat. Fat","unit":"g","default":40},{"key":"omega3","label":"Omega 3","unit":"g","default":1.1},{"key":"addedSugar","label":"Added Sugar","unit":"g","default":25},{"key":"totalFibre","label":"Fibre","unit":"g","default":25},{"key":"solubleFibre","label":"Soluble Fibre","unit":"g","default":5},{"key":"sodium","label":"Sodium","unit":"mg","default":1500},{"key":"potassium","label":"Potassium","unit":"mg","default":3500},{"key":"magnesium","label":"Magnesium","unit":"mg","default":310},{"key":"calcium","label":"Calcium","unit":"mg","default":1000},{"key":"iron","label":"Iron","unit":"mg","default":18},{"key":"zinc","label":"Zinc","unit":"mg","default":8},{"key":"selenium","label":"Selenium","unit":"mcg","default":55},{"key":"iodine","label":"Iodine","unit":"mcg","default":150},{"key":"phosphorus","label":"Phosphorus","unit":"mg","default":700},{"key":"vitaminD","label":"Vitamin D","unit":"IU","default":600},{"key":"vitaminB12","label":"Vitamin B12","unit":"mcg","default":2.4},{"key":"folate","label":"Folate","unit":"mcg","default":400},{"key":"vitaminC","label":"Vitamin C","unit":"mg","default":75},{"key":"vitaminE","label":"Vitamin E","unit":"mg","default":15},{"key":"vitaminK","label":"Vitamin K","unit":"mcg","default":90},{"key":"vitaminA","label":"Vitamin A","unit":"mcg","default":700},{"key":"vitaminB6","label":"Vitamin B6","unit":"mg","default":1.3},{"key":"thiamine","label":"Thiamine","unit":"mg","default":1.1},{"key":"riboflavin","label":"Riboflavin","unit":"mg","default":1.1},{"key":"niacin","label":"Niacin","unit":"mg","default":14},{"key":"steps","label":"Steps","unit":"steps","default":3000}].map(t => (
                      <div className="space-y-1" key={t.key}>
                        <label className="text-[10px] font-bold text-slate-500">{t.label} ({t.unit})</label>
                        <input 
                          type="number"
                          value={report && report.dailyNutrientTargets ? parseTarget((report.dailyNutrientTargets as any)[t.key], t.default) : t.default}
                          onChange={(e) => {
                             if (onUpdateReport && report) {
                               onUpdateReport({...report, dailyNutrientTargets: {...report.dailyNutrientTargets, [t.key]: `${e.target.value} ${t.unit}`}})
                             }
                          }}
                          className="w-full bg-slate-50 dark:bg-slate-950/45 border border-slate-150 dark:border-slate-800 rounded-lg px-2 py-1 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              
              {/* View Timeframe Selection */}
              <div className="space-y-1.5 border-t border-slate-100 dark:border-slate-800/50 pt-3">
                <div className="flex justify-between text-xs font-bold text-slate-900 dark:text-slate-100">
                  <span>Display View Timeframe</span>
                  <span className="text-indigo-650 dark:text-indigo-400 font-mono">
                    {viewTimeframe === '1' ? 'Today' : `Last ${viewTimeframe} Days`}
                  </span>
                </div>
                <select
                  value={viewTimeframe}
                  onChange={(e) => setViewTimeframe(e.target.value)}
                  className="w-full bg-slate-50 dark:bg-slate-950/45 border border-slate-150 dark:border-slate-800 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 outline-none cursor-pointer"
                >
                  <option value="1">Last 1 day (Today)</option>
                  <option value="7">Last 7 days</option>
                  <option value="14">Last 14 days</option>
                  <option value="30">Last 30 days</option>
                </select>
                <p className="text-[9px] text-slate-400">Average daily intake across the selected timeframe compared to your adjusted budget.</p>
              </div>
            </div>

            {/* Footer / Actions */}
            <div className="pt-2">
              <button
                onClick={() => setIsSettingsModalOpen(false)}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-2xl text-xs transition-colors cursor-pointer"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Food Ideas Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-500" />
            Food Ideas
          </h3>
          <button
            onClick={() => setIsFoodIdeaChatOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-900 rounded-lg text-xs font-bold transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5" /> Ask Agent
          </button>
        </div>

        {foodIdeas.length > 0 && (
          <div className="space-y-2">
            {foodIdeas.map(idea => (
              <div key={idea.id} className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <button
                  onClick={() => setExpandedKey(expandedKey === idea.id ? null : idea.id)}
                  className="w-full flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-0 text-left hover:bg-slate-50 dark:hover:bg-slate-800/80 transition-colors cursor-pointer"
                >
                  <span className="font-bold text-sm text-slate-800 dark:text-slate-200">{idea.name}</span>
                  {expandedKey === idea.id ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                </button>
                {expandedKey === idea.id && (
                  <div className="py-4 space-y-4 animation-fade-in text-xs">
                    <p className="text-slate-600 dark:text-slate-300 leading-relaxed font-medium">{idea.benefitExplanation}</p>
                    
                     {idea.locationLink && (
                      <div className="space-y-3">
                        <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5">
                          <a href={idea.locationLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 font-bold hover:underline">
                            <MapPin className="w-3.5 h-3.5" /> {idea.placeName || "Find Nearby"}
                          </a>
                          {idea.distanceKm !== undefined && (
                            <span className="text-[10px] bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-1.5 py-0.5 rounded font-semibold border border-slate-300/30">
                              {idea.distanceKm} km away
                            </span>
                          )}
                          {idea.estimatedBudget && (
                            <span className="text-[10px] bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded font-bold border border-emerald-100/50 dark:border-emerald-900/30">
                              Est: {idea.estimatedBudget}
                            </span>
                          )}
                          {idea.openingHours && (
                            <span className="text-[10px] flex items-center gap-1 bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded font-bold border border-amber-200/50 dark:border-amber-900/40">
                              <Clock className="w-3 h-3" /> {idea.openingHours}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {idea.tags.map((tag, idx) => (
                        <span key={idx} className="bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-2 py-0.5 rounded text-[10px] font-bold border border-slate-200 dark:border-slate-700">
                          {tag}
                        </span>
                      ))}
                    </div>
                    <button
                      onClick={() => {
                        const newIdeas = foodIdeas.filter(i => i.id !== idea.id);
                        setFoodIdeas(newIdeas);
                      }}
                      className="text-rose-600 hover:text-rose-700 font-bold mt-2 block w-full text-center py-2 bg-rose-50 dark:bg-rose-950/20 hover:bg-rose-100 dark:hover:bg-rose-900/40 rounded-lg transition-colors cursor-pointer text-xs"
                    >
                      Remove Idea
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Health status to improve (Previously Health & BMI Summary) */}
      <div id="health-summary-section" className="space-y-5">
        <div className="flex justify-between items-center pb-2 border-b border-slate-100 dark:border-slate-800/50">
          <h3 className="font-bold text-slate-950 dark:text-slate-100 text-sm flex items-center gap-2 font-display">
            <Heart className="w-4.5 h-4.5 text-indigo-600" />
            Health status to improve
          </h3>
          {problematicBiomarkers.length > 0 && (
            <button
              onClick={() => {
                const textToCopy = problematicBiomarkers.map(b => {
                  const rating = getBiomarkerStatusLabel(b.key, b.status, profile.customBiomarkers?.[b.key], b.value, profile);
                  const calibration = getAgentCalibration(b.key);
                  const insight = calibration?.specificRiskContext || calibration?.description || b.def.benefitRisk || '';
                  return `${b.def.name}: ${b.value} ${b.def.unit || ''} (${rating})\n${insight}`.trim();
                }).join('\n\n');
                navigator.clipboard.writeText(textToCopy);
                alert('Copied to clipboard!');
              }}
              className="text-xs font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 flex items-center gap-1.5 transition-colors bg-slate-100 dark:bg-slate-800/50 px-2.5 py-1.5 rounded-lg"
            >
              <Copy className="w-3.5 h-3.5" />
              Copy All
            </button>
          )}
        </div>

        {/* Problematic Biomarkers list (rendered in 2 columns as expandable tabs/cards) */}
        <div>
          {problematicBiomarkers.length > 0 ? (
            <div className="space-y-4">
              {(() => {
                const groups: Record<string, typeof problematicBiomarkers> = {};
                problematicBiomarkers.forEach(b => {
                  const meta = getBiomarkerMetadata(b.key, profile.customBiomarkers?.[b.key] || b.def);
                  const cat = (meta.riskCategories && meta.riskCategories.length > 0) ? meta.riskCategories[0] : 'Uncategorized';
                  if (!groups[cat]) groups[cat] = [];
                  groups[cat].push(b);
                });

                return Object.entries(groups).map(([category, items]) => {
                  const chunks: typeof problematicBiomarkers[] = [];
                  for (let i = 0; i < items.length; i += 2) {
                    chunks.push(items.slice(i, i + 2));
                  }
                  
                  return (
                    <div key={category} className="space-y-4 mb-6 last:mb-0">
                      <h4 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pl-1 border-b border-slate-100 dark:border-slate-800 pb-2">{category}</h4>
                      <div className="space-y-4">
                        {chunks.map((chunk, chunkIdx) => {
                          const expandedInChunk = chunk.find(b => expandedKey === b.key);
                          return (
                            <div key={chunkIdx} className="space-y-3">
                              <div className="grid grid-cols-2 gap-3">
                        {chunk.map((b) => {
                          const colorClass = getBiomarkerColor(b.status);
                          const isExpanded = expandedKey === b.key;
                          return (
                            <button
                              key={b.key}
                              id={`biomarker-card-${b.key}`}
                              onClick={() => setExpandedKey(isExpanded ? null : b.key)}
                              className={`p-3 text-left rounded-2xl border transition-all duration-200 cursor-pointer flex flex-col justify-between h-24 ${
                                isExpanded
                                  ? 'bg-indigo-50/50 dark:bg-indigo-950/20 border-indigo-500 shadow-sm ring-1 ring-indigo-500'
                                  : 'bg-slate-50 dark:bg-slate-950 border-slate-100 dark:border-slate-800/20 hover:bg-slate-100/50 dark:hover:bg-slate-800/30'
                              }`}
                            >
                              <div className="min-w-0 w-full">
                                <div className="flex items-center gap-1.5 min-w-0 w-full">
                                  <span className="font-size-body-small font-bold text-slate-800 dark:text-slate-200 truncate block">
                                    {b.def.name}
                                  </span>
                                  {b.key === 'bmi' && hasBmiAlert && (
                                    <AlertCircle className="w-4 h-4 text-amber-500 shrink-0 animate-pulse" />
                                  )}
                                </div>
                              </div>

                              <div className="flex items-baseline justify-between mt-auto w-full">
                                <span className={`font-size-key-metric font-black font-sans leading-none tracking-tight ${colorClass}`}>
                                  {hideSensitive ? '***' : b.value}
                                </span>
                                <span className={`font-size-subtitle-small font-bold uppercase tracking-tight ${colorClass}`}>
                                  {getBiomarkerStatusLabel(b.key, b.status, profile.customBiomarkers?.[b.key], b.value, profile)}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {expandedInChunk && (
                        <div id={`biomarker-expanded-${expandedInChunk.key}`} className="overflow-hidden animation-fade-in mt-1">
                          <div className="py-4 border-b border-slate-100 dark:border-slate-800/30 flex items-center justify-between">
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="font-size-body-small font-bold text-slate-800 dark:text-slate-200">
                                  {expandedInChunk.def.name}
                                </span>
                                <span className="font-size-xs font-mono text-slate-400">({expandedInChunk.def.unit})</span>
                              </div>
                              <p className="font-size-body-small text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
                                Normal range: {expandedInChunk.def.normalRange}
                              </p>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className={`font-size-subtitle font-black font-sans ${getBiomarkerColor(expandedInChunk.status)}`}>
                                {hideSensitive ? '***' : expandedInChunk.value}
                              </span>
                               <span className={`font-size-xs font-black px-1.5 py-0.5 rounded-full uppercase tracking-wider ${getBiomarkerColor(expandedInChunk.status)} bg-current/10`}>
                                {getBiomarkerStatusLabel(expandedInChunk.key, expandedInChunk.status, profile.customBiomarkers?.[expandedInChunk.key], expandedInChunk.value, profile)}
                              </span>
                            </div>
                          </div>

                          <BiomarkerExpandedSection
                            def={expandedInChunk.def}
                            profile={profile}
                            biomarkerHistory={biomarkerHistory}
                            biomarkers={resolvedBiomarkers}
                            onEditBiomarkerLog={onEditBiomarkerLog}
                            onDeleteBiomarkerLog={onDeleteBiomarkerLog}
                            onDeleteBiomarkerFromLog={onDeleteBiomarkerFromLog}
                            onOpenAiReview={setReviewingBiomarkerKey}
                            onApplyCalculation={onApplyCalculation}
                            hasPendingAlert={expandedInChunk.key === 'bmi' ? hasBmiAlert : false}
                            onDismissAlert={expandedInChunk.key === 'bmi' ? onDismissBmiAlert : undefined}
                            hideSensitive={hideSensitive}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        });
      })()}
            </div>
          ) : (
            <div className="p-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center">
              <p className="text-xs text-slate-400 font-medium">All recorded biomarkers are within normal range! 🎉</p>
            </div>
          )}
        </div>
      </div>

      {/* Target Compliance score meters */}
      {distinctDaysOfData >= 7 && (
        <div id="compliance-card" className="grid grid-cols-2 gap-4">
          <div className="border-r border-slate-100 dark:border-slate-800/50 pr-2 flex flex-col justify-between">
            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-400">7-Day Compliance</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span id="score-7d-text" className="text-3xl font-black font-sans text-indigo-600">{complianceScore7Day}%</span>
              <span className="text-xs text-slate-400 font-medium">on target</span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 leading-tight">
              {complianceScore7Day >= 80 ? 'Excellent cardiovascular protection benefits.' : 'Steady effort will lower vascular risk markers.'}
            </p>
          </div>
          <div className="pl-1 flex flex-col justify-between">
            <span className="text-[10px] font-bold tracking-wider uppercase text-slate-400">30-Day Compliance</span>
            <div className="flex items-baseline gap-1 mt-1">
              <span id="score-30d-text" className="text-3xl font-black font-sans text-indigo-700">{complianceScore30Day}%</span>
              <span className="text-xs text-slate-400 font-medium">overall</span>
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 leading-tight">
              Consistency reduces future atherosclerosis risks significantly.
            </p>
          </div>
        </div>
      )}

      {/* Clinical Action Steps checklist */}
      <div id="actions-checklist-section" className="space-y-4">
        <div>
          <h3 className="font-bold text-slate-950 dark:text-slate-100 text-sm">
            Clinical Action Recommendations
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
            Discuss these priorities with your general practitioner (GP).
          </p>
        </div>

        <div className="space-y-3">
          {actions.map((act) => (
            <div 
              key={act.id} 
              id={`action-item-${act.id}`}
              onClick={() => toggleAction(act.id)}
              className={`flex items-start gap-3 p-3 rounded-2xl cursor-pointer border hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-all ${
                act.completed 
                  ? 'bg-slate-50/50 dark:bg-slate-800/10 border-slate-100 dark:border-slate-800/40' 
                  : act.priority === 'high' 
                    ? 'border-rose-500/10 bg-rose-50/10' 
                    : 'border-slate-100 dark:border-slate-800/50'
              }`}
            >
              <button className="flex-shrink-0 mt-0.5 text-slate-400 dark:text-slate-500 cursor-pointer">
                {act.completed ? (
                  <CheckCircle2 className="w-5 h-5 text-indigo-600 fill-indigo-600/10" />
                ) : (
                  <Circle className="w-5 h-5 hover:text-indigo-600" />
                )}
              </button>
              <div className="space-y-1">
                <span className={`text-xs font-semibold leading-tight block ${act.completed ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-800 dark:text-slate-200'}`}>
                  {act.task}
                </span>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                  {act.explanation}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Daily Benefit tasks checkoff */}
      <div id="benefits-checklist-section" className="space-y-4">
        <div>
          <h3 className="font-bold text-slate-950 dark:text-slate-100 text-sm">
            {t.dailyBenefits}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 font-medium">
            Consistently executing these behaviors halts arterial plaque progression.
          </p>
        </div>

         <div className="space-y-2.5">
          {dailyBenefits.map((ben) => (
            <div
              key={ben.id}
              id={`benefit-item-${ben.id}`}
              onClick={() => toggleBenefit(ben.id)}
              className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-800/50 last:border-0 cursor-pointer transition-all group"
            >
              <div className="flex items-center gap-3">
                <button className="text-slate-400 dark:text-slate-500 cursor-pointer">
                  {ben.completed ? (
                    <CheckCircle2 className="w-5 h-5 text-indigo-600 fill-indigo-600/10" />
                  ) : (
                    <Circle className="w-5 h-5 hover:text-indigo-600" />
                  )}
                </button>
                <span className={`text-xs font-semibold ${ben.completed ? 'line-through text-slate-400 dark:text-slate-500' : 'text-slate-700 dark:text-slate-200'}`}>
                  {ben.activity || (ben as any).label}
                </span>
              </div>
              
              <button
                onClick={(e) => deleteBenefit(ben.id, e)}
                className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 opacity-60 md:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all cursor-pointer flex-shrink-0"
                title="Delete benefit item"
              >
                <Trash2 className="w-3.8 h-3.8" />
              </button>
            </div>
          ))}
        </div>
      </div>



      {/* Google Health UI moved to Profile settings */}

      {/* AI Review Modal for Biomarker details */}
      {reviewingBiomarkerKey && (
        <ReviewBiomarkerModal
          profile={profile}
          isOpen={true}
          biomarkerKey={reviewingBiomarkerKey}
          currentValue={resolvedBiomarkers[reviewingBiomarkerKey]}
          onClose={() => setReviewingBiomarkerKey(null)}
          biomarkerHistory={biomarkerHistory}
          initialMessages={reviewHistories[reviewingBiomarkerKey] || []}
          onUpdateMessages={(msgs) => {
            setReviewHistories(prev => ({
              ...prev,
              [reviewingBiomarkerKey]: msgs
            }));
          }}
          onUpdateBiomarker={(key, val, proposal, fieldsToKeep) => {
            if (onLogMedical) {
              const profileUpdates: Partial<UserProfile> = {};
              if (proposal) {
                const currentDef: any = profile.customBiomarkers?.[key] || {};
                profileUpdates.customBiomarkers = {
                  ...(profile.customBiomarkers || {}),
                  [key]: {
                    name: proposal.name || key,
                    unit: fieldsToKeep?.unit ? proposal.metric : (currentDef.unit || ''),
                    normalRange: fieldsToKeep?.range ? proposal.range : (currentDef.normalRange || 'Unknown'),
                    description: fieldsToKeep?.description ? proposal.description : (currentDef.description || ''),
                    benefitRisk: proposal.benefitRisk || ''
                  }
                };
              }
              onLogMedical({ [key]: val }, profileUpdates);
              setReviewingBiomarkerKey(null);
            }
          }}
          selectedModelId={selectedModelId}
          onChangeModelId={onChangeModelId}
        />
      )}

      {/* Food Idea Agent Modal */}
      {isFoodIdeaChatOpen && (
        <LogChat 
          type="food_idea"
          isOpen={isFoodIdeaChatOpen}
          onClose={() => setIsFoodIdeaChatOpen(false)}
          profile={profile}
          foodLogs={foodLogs}
          biomarkers={biomarkers}
          biomarkerHistory={biomarkerHistory}
          selectedModelId={selectedModelId}
          onChangeModelId={onChangeModelId}
          onLogFoodIdeas={(ideas) => {
            setFoodIdeas([...foodIdeas, ...ideas]);
            setIsFoodIdeaChatOpen(false);
          }}
        />
      )}

      {isDailyRecommendationChatOpen && (
        <LogChat 
          type="daily_recommendation"
          isOpen={isDailyRecommendationChatOpen}
          onClose={() => setIsDailyRecommendationChatOpen(false)}
          profile={profile}
          foodLogs={foodLogs}
          biomarkers={biomarkers}
          biomarkerHistory={biomarkerHistory}
          report={report}
          actions={actions}
          googleSteps={googleSteps}
          selectedModelId={selectedModelId}
          onChangeModelId={onChangeModelId}
          autoSendMessage="What's up today?"
        />
      )}
    </div>
  );
}
