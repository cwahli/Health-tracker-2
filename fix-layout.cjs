const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

// Data Accuracy Mode Layout
const dataAccuracyRegex = /        \{isDataAccuracyMode \? \(\n          <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-slate-50 dark:bg-slate-950">\n            \{\/\* Left side: Chat agent thread \*\/\}\n            <div className={`flex-1 flex flex-col overflow-hidden \$\{accuracyComparisonResults \? 'md:w-5\/12 md:border-r md:border-slate-200 dark:md:border-slate-800' : 'w-full'\}`\}>/g;

code = code.replace(dataAccuracyRegex, `        {isDataAccuracyMode ? (
          <div className="flex-1 flex flex-col overflow-y-auto bg-slate-50 dark:bg-slate-950">
            {/* Top side: Chat agent thread */}
            <div className={\`flex flex-col shrink-0 \${accuracyComparisonResults ? 'h-[400px] border-b border-slate-200 dark:border-slate-800' : 'h-full'}\`}>`);

const dataAccuracyRightSideRegex = /            \{\/\* Right side: Interactive Comparison Panel \*\/\}\n            \{accuracyComparisonResults && \(\n              <div className="md:w-7\/12 flex flex-col bg-white dark:bg-slate-900 overflow-y-auto">/g;

code = code.replace(dataAccuracyRightSideRegex, `            {/* Bottom side: Interactive Comparison Panel */}
            {accuracyComparisonResults && (
              <div className="w-full flex flex-col bg-white dark:bg-slate-900 shrink-0 min-h-[500px]">`);

// Name Consolidation Mode Layout
const nameConsolidationRegex = /        \) : isNameConsolidationMode \? \(\n          <div className="flex-1 flex flex-col md:flex-row overflow-hidden bg-slate-50 dark:bg-slate-950">\n            \{\/\* Left side: Chat thread \*\/\}\n            <div className=\{`flex-1 flex flex-col overflow-hidden \$\{consolidationGroups \? 'md:w-5\/12 md:border-r md:border-slate-200 dark:md:border-slate-800' : 'w-full'\}`\}>/g;

code = code.replace(nameConsolidationRegex, `        ) : isNameConsolidationMode ? (
          <div className="flex-1 flex flex-col overflow-y-auto bg-slate-50 dark:bg-slate-950">
            {/* Top side: Chat thread */}
            <div className={\`flex flex-col shrink-0 \${consolidationGroups ? 'h-[400px] border-b border-slate-200 dark:border-slate-800' : 'h-full'}\`}>`);

const nameConsolidationRightSideRegex = /            \{\/\* Right side: Consolidation Data \*\/\}\n            \{consolidationGroups && \(\n              <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-950\/20 md:border-l md:border-slate-200 dark:md:border-slate-800 relative shadow-inner">/g;

code = code.replace(nameConsolidationRightSideRegex, `            {/* Bottom side: Consolidation Data */}
            {consolidationGroups && (
              <div className="w-full flex flex-col bg-slate-50 dark:bg-slate-950/20 relative shadow-inner shrink-0 min-h-[500px]">`);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
