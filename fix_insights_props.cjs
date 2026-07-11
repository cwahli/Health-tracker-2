const fs = require('fs');
let code = fs.readFileSync('src/components/InsightsTab.tsx', 'utf8');

const target1 = `  onDeleteAnalysis: (id: string) => Promise<void>;
  isLoadingReview?: boolean;
}`;

const replace1 = `  onDeleteAnalysis: (id: string) => Promise<void>;
  isLoadingReview?: boolean;
  onDeleteBiomarker?: (key: string) => void;
  onDeleteMultipleBiomarkers?: (keys: string[]) => void;
  onCombineBiomarkers?: (sourceKeys: string[], targetKey: string) => void;
}`;

const target2 = `  onDeleteAnalysis,
  isLoadingReview = false
}: InsightsTabProps) {`;

const replace2 = `  onDeleteAnalysis,
  isLoadingReview = false,
  onDeleteBiomarker,
  onDeleteMultipleBiomarkers,
  onCombineBiomarkers
}: InsightsTabProps) {`;

if (code.includes(target1) && code.includes(target2)) {
  code = code.split(target1).join(replace1);
  code = code.split(target2).join(replace2);
  fs.writeFileSync('src/components/InsightsTab.tsx', code);
  console.log("Updated InsightsTab.tsx successfully.");
} else {
  console.log("Targets not found in InsightsTab.tsx!");
}
