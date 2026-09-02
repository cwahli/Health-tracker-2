import React, { useState, useEffect } from 'react';
import { translations } from '../../utils/translations';

interface PortionDropdownProps {
  baseWeight: number;
  currentWeight: number;
  onScale: (ratio: number) => void;
  className?: string;
  darkTheme?: boolean;
  language?: string;
}

const PRESET_RATIOS = [0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0];

export const PortionDropdown: React.FC<PortionDropdownProps> = ({
  baseWeight,
  currentWeight,
  onScale,
  className = '',
  darkTheme = false,
  language = 'en',
}) => {
  const t = translations[language || 'en'] || translations.en;
  const safeBaseWeight = baseWeight > 0 ? baseWeight : 100;
  const safeCurrentWeight = currentWeight > 0 ? currentWeight : safeBaseWeight;

  const matchedRatio = PRESET_RATIOS.find((r) => {
    const targetGrams = Math.round(safeBaseWeight * r);
    return Math.abs(safeCurrentWeight - targetGrams) <= 2;
  });

  const [isCustomOpen, setIsCustomOpen] = useState(false);
  const [customInputGrams, setCustomInputGrams] = useState(String(safeCurrentWeight));

  useEffect(() => {
    setCustomInputGrams(String(safeCurrentWeight));
  }, [safeCurrentWeight]);

  const handleApplyCustom = () => {
    const g = parseFloat(customInputGrams);
    if (!isNaN(g) && g > 0 && safeBaseWeight > 0) {
      const ratio = Math.round((g / safeBaseWeight) * 1000) / 1000;
      onScale(ratio);
    }
    setIsCustomOpen(false);
  };

  if (isCustomOpen) {
    return (
      <div className={`inline-flex items-center gap-1 ${className}`}>
        <input
          type="number"
          min="1"
          step="1"
          autoFocus
          value={customInputGrams}
          onChange={(e) => setCustomInputGrams(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleApplyCustom();
            } else if (e.key === 'Escape') {
              setIsCustomOpen(false);
            }
          }}
          placeholder="g"
          className={`w-16 px-1.5 py-0.5 text-[11px] font-mono font-bold rounded border focus:outline-none focus:ring-1 ${
            darkTheme
              ? 'bg-slate-900 text-white border-indigo-500 focus:ring-indigo-400'
              : 'bg-white text-slate-900 border-indigo-500 focus:ring-indigo-500'
          }`}
        />
        <span className={`text-[10px] font-medium ${darkTheme ? 'text-slate-400' : 'text-slate-500'}`}>g</span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            handleApplyCustom();
          }}
          className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm cursor-pointer"
        >
          ✓
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsCustomOpen(false);
          }}
          className={`px-1 py-0.5 rounded text-[10px] font-bold ${
            darkTheme ? 'text-slate-400 hover:text-white' : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          ✕
        </button>
      </div>
    );
  }

  const selectValue = matchedRatio !== undefined ? String(matchedRatio) : 'custom';

  return (
    <div className={`inline-flex items-center ${className}`}>
      <select
        value={selectValue}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          e.stopPropagation();
          const val = e.target.value;
          if (val === 'custom') {
            setCustomInputGrams(String(safeCurrentWeight));
            setIsCustomOpen(true);
          } else {
            const ratio = parseFloat(val);
            if (!isNaN(ratio)) {
              onScale(ratio);
            }
          }
        }}
        className={`px-2 py-0.5 rounded-md text-[11px] font-bold cursor-pointer transition-colors border shadow-sm focus:outline-none focus:ring-1 ${
          darkTheme
            ? 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 focus:ring-indigo-400'
            : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600 hover:border-indigo-400 focus:ring-indigo-500'
        }`}
      >
        {PRESET_RATIOS.map((ratio) => {
          const grams = Math.round(safeBaseWeight * ratio);
          return (
            <option key={ratio} value={ratio}>
              {grams}g ({ratio}x)
            </option>
          );
        })}
        <option value="custom">
          {matchedRatio === undefined
            ? (t.customWithWeight ? t.customWithWeight.replace('{weight}', String(safeCurrentWeight)) : `Custom (${safeCurrentWeight}g)`)
            : (t.customGramsEllipsis || 'Custom (g)...')}
        </option>
      </select>
    </div>
  );
};
