const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const regexInstructions = /      <FullScreenInstructionViewer\n        isOpen=\{showDataAccuracyInstructions\}\n        onClose=\{\(\) => setShowDataAccuracyInstructions\(false\)\}\n        instructionKey="data_accuracy"\n        profile=\{profile\}\n      \/>/g;

code = code.replace(regexInstructions, `      <FullScreenInstructionViewer
        isOpen={showDataAccuracyInstructions}
        onClose={() => setShowDataAccuracyInstructions(false)}
        instructionKey="data_accuracy"
        profile={profile}
      />
      <FullScreenInstructionViewer
        isOpen={showConsolidationInstructions}
        onClose={() => setShowConsolidationInstructions(false)}
        instructionKey="consolidate_names"
        profile={profile}
      />`);

fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
