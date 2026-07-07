const fs = require('fs');
let code = fs.readFileSync('src/components/HomeTab.tsx', 'utf8');

const target1 = '  const getAdjustedTarget = React.useCallback((key: string, baseTarget: number): number => {';
const target2 = '  }, [rollingEnabled, rollingDays, rollingAllowance, todayStr, foodLogs]);';
const startIndex = code.indexOf(target1);
const endIndex = code.indexOf(target2, startIndex) + target2.length;

const replacement1 = `  const getRollingBreakdown = React.useCallback((key: string, baseTarget: number) => {
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
      const targetDateStr = \`\${yyyy}-\${mm}-\${dd}\`;
      
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
  }, [getRollingBreakdown]);`;

code = code.substring(0, startIndex) + replacement1 + code.substring(endIndex);
fs.writeFileSync('src/components/HomeTab.tsx', code);
console.log("Patched getAdjustedTarget");
