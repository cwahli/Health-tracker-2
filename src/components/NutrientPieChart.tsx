import React from 'react';

interface NutrientPieChartProps {
  allowance: number;       // Daily allowance (e.g. 1500)
  alreadyConsumed: number; // Amount consumed BEFORE this meal/log (e.g. 750)
  mealValue: number;       // Amount in this meal/log (e.g. 500)
  nutrientKey: 'calories' | 'saturatedFat' | 'sodium' | string;
  size?: 'sm' | 'md' | 'lg';
}

export const NutrientPieChart: React.FC<NutrientPieChartProps> = ({
  allowance,
  alreadyConsumed,
  mealValue,
  nutrientKey,
  size = 'md'
}) => {
  // Safe bounds
  const A = Math.max(1, allowance);
  const C = Math.max(0, alreadyConsumed);
  const M = Math.max(0, mealValue);

  // Map nutrient keys to colors
  const getHighlightColorInfo = (key: string) => {
    const k = key.toLowerCase();
    if (k.includes('calor')) {
      return {
        bright: 'rgb(249, 115, 22)', // Orange
        light: 'rgba(249, 115, 22, 0.2)',
      };
    }
    if (k.includes('sat') || k.includes('fat')) {
      return {
        bright: 'rgb(234, 179, 8)', // Yellow
        light: 'rgba(234, 179, 8, 0.2)',
      };
    }
    if (k.includes('sodium') || k.includes('salt')) {
      return {
        bright: 'rgb(34, 197, 94)', // Green
        light: 'rgba(34, 197, 94, 0.2)',
      };
    }
    return {
      bright: 'rgb(99, 102, 241)', // Default Indigo
      light: 'rgba(99, 102, 241, 0.2)',
    };
  };

  const { bright: highlightColor, light: consumedColor } = getHighlightColorInfo(nutrientKey);

  const pctC = (C / A) * 100;
  const pctM = (M / A) * 100;
  const pctTotal = pctC + pctM;

  let pieGradient = '';

  if (pctTotal <= 100) {
    // Under/equal to allowance
    // segment 1: 0% to pctC -> consumedColor (20% opacity of bright color)
    // segment 2: pctC to pctTotal -> highlightColor (full bright color)
    // segment 3: pctTotal to 100% -> Transparent
    pieGradient = `conic-gradient(
      ${consumedColor} 0% ${pctC}%, 
      ${highlightColor} ${pctC}% ${pctTotal}%, 
      transparent ${pctTotal}% 100%
    )`;
  } else {
    // Over allowance
    if (C < A) {
      // Consumption exceeded limit, but alreadyConsumed was under limit.
      // Part of meal filled up to 100%, remaining is excess (Red).
      // Excess percent = pctTotal - 100
      const pctExcess = Math.min(pctTotal - 100, 100);
      // Red from 0% to pctExcess (the wrapped-around excess)
      // consumedColor from pctExcess to pctC
      // highlightColor from pctC to 100% (the meal filling the rest of the allowance)
      pieGradient = `conic-gradient(
        #ef4444 0% ${pctExcess}%,
        ${consumedColor} ${pctExcess}% ${pctC}%,
        ${highlightColor} ${pctC}% 100%
      )`;
    } else {
      // alreadyConsumed was ALREADY over or equal to limit.
      // The entire meal value is excess (Red).
      // We show the meal's excess in Red, and the rest as consumedColor.
      const pctExcess = Math.min(pctM, 100);
      pieGradient = `conic-gradient(
        #ef4444 0% ${pctExcess}%,
        ${consumedColor} ${pctExcess}% 100%
      )`;
    }
  }

  // Determine size classes
  const sizeClasses = {
    sm: 'w-4.5 h-4.5',
    md: 'w-5 h-5',
    lg: 'w-6 h-6'
  };

  const tooltipText = `Allowance: ${A.toFixed(0)}, Already Consumed: ${C.toFixed(0)}, This Meal: ${M.toFixed(0)}`;

  return (
    <div 
      className={`${sizeClasses[size]} rounded-full bg-transparent overflow-hidden flex-shrink-0 relative border`}
      style={{ borderColor: consumedColor }}
      title={tooltipText}
    >
      <div 
        className="absolute inset-0 transition-all duration-500" 
        style={{ background: pieGradient }} 
      />
    </div>
  );
};
