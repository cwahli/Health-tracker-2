const fs = require('fs');
let code = fs.readFileSync('src/components/BiomarkerDictionaryModal.tsx', 'utf8');

const biomarkerRowStart = code.indexOf('const BiomarkerRow = ({');
const isEditingStart = code.indexOf('  const [isEditing, setIsEditing] = useState(false);', biomarkerRowStart);

const newHeader = `const DictionaryItem = ({
  approvalReason,
  itemKey,
  builtInDef,
  customDef,
  logsCount,
  isSelected,
  allGroupings,
  allRisks,
  allConditions,
  itemLogs,
  onToggleSelect,
  onSave,
  onRouteAgent,
  isProcessing
}: {
  approvalReason?: string;
  itemKey: string;
  builtInDef?: any;
  customDef?: any;
  logsCount: number;
  isSelected: boolean;
  allGroupings: string[];
  allRisks: string[];
  allConditions: string[];
  itemLogs?: any[];
  onToggleSelect: () => void;
  onSave: (updates: any) => void;
  onRouteAgent?: () => void;
  isProcessing?: boolean;
}) => {
  const def = { ...builtInDef, ...customDef };
  const initialName = def.name || itemKey;
  const initialUnit = def.unit || '';
  const initialNormalRange = def.normalRange || '';
  const initialGrouping = def.standardMedicalGrouping || '';
  const initialRisk = def.riskCategories ? def.riskCategories.join(', ') : '';
  const initialConditions = def.potentialMedicalConditions ? def.potentialMedicalConditions.join(', ') : '';
`;

code = code.substring(0, biomarkerRowStart) + newHeader + code.substring(isEditingStart);
fs.writeFileSync('src/components/BiomarkerDictionaryModal.tsx', code);
