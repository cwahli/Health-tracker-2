const fs = require('fs');
let code = fs.readFileSync('src/components/MedicalHistoryTab.tsx', 'utf8');

const oldModalProps = `        <BiomarkerDictionaryModal
          profile={profile}
          biomarkers={biomarkers}
          biomarkerHistory={biomarkerHistory}
          onClose={() => setShowDictionaryModal(false)}
          onUpdateProfile={onUpdateProfile ? (updates) => onUpdateProfile(updates) : (updates) => onLogMedical({}, updates, undefined, undefined, undefined, true)}
          onCombineBiomarkers={onCombineBiomarkers!}
          onBatchConsolidate={onBatchConsolidate}
          onStandardizeUnits={onStandardizeUnits}
          onLogMedical={onLogMedical}
          onAgentAnalysisSaved={onAgentAnalysisSaved}
          onDeleteAnalysis={onDeleteAnalysis}
        />`;

const newModalProps = `        <BiomarkerDictionaryModal
          profile={profile}
          biomarkers={biomarkers}
          biomarkerHistory={biomarkerHistory}
          onClose={() => setShowDictionaryModal(false)}
          onUpdateProfile={onUpdateProfile ? (updates) => onUpdateProfile(updates) : (updates) => onLogMedical({}, updates, undefined, undefined, undefined, true)}
          onCombineBiomarkers={onCombineBiomarkers!}
          onBatchCombineBiomarkers={onBatchCombineBiomarkers}
          onBatchConsolidate={onBatchConsolidate}
          onStandardizeUnits={onStandardizeUnits}
          onLogMedical={onLogMedical}
          onAgentAnalysisSaved={onAgentAnalysisSaved}
          onDeleteAnalysis={onDeleteAnalysis}
        />`;

if (code.includes(oldModalProps)) {
  code = code.replace(oldModalProps, newModalProps);
  fs.writeFileSync('src/components/MedicalHistoryTab.tsx', code);
  console.log('Fixed MedicalHistoryTab.tsx');
} else {
  console.log('Could not find oldModalProps in MedicalHistoryTab.tsx');
}
