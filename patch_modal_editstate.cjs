const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const oldState = `    normalRange: initialNormalRange,
    structuredRanges: customDef?.structuredRanges || [],
    standardMedicalGrouping: initialGrouping,`;

const newState = `    normalRange: initialNormalRange,
    rangeConfig: customDef?.rangeConfig,
    customRanges: customDef?.customRanges || [],
    standardMedicalGrouping: initialGrouping,`;

code = code.replace(oldState, newState);

const oldReset = `                      normalRange: initialNormalRange,
                      structuredRanges: customDef?.structuredRanges || builtInDef?.structuredRanges || [],
                      standardMedicalGrouping: initialGrouping,`;

const newReset = `                      normalRange: initialNormalRange,
                      rangeConfig: customDef?.rangeConfig || builtInDef?.rangeConfig,
                      customRanges: customDef?.customRanges || builtInDef?.customRanges || [],
                      standardMedicalGrouping: initialGrouping,`;

code = code.replace(oldReset, newReset);

code = code.replace(
  "import { X, CheckCircle, AlertCircle, Edit2, Loader, Save, ArrowRight, CheckSquare, Square, MessageSquare, Send, ChevronLeft, ChevronDown, FileCode, Merge, Copy } from 'lucide-react';",
  "import { X, CheckCircle, AlertCircle, Edit2, Loader, Save, ArrowRight, CheckSquare, Square, MessageSquare, Send, ChevronLeft, ChevronDown, FileCode, Merge, Copy } from 'lucide-react';\nimport BiomarkerRangeBuilder from './BiomarkerRangeBuilder';"
);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
console.log("Patched BiomarkerDictionaryModal editState");
