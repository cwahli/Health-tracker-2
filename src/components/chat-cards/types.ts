import { ChatMessage } from '../../types';

export interface AgentCardProps {
  language?: string;
  msg: ChatMessage;
  messages: ChatMessage[];
  idx: number;
  report?: any;
  foodLogs?: any[];
  t?: any;
  formatNutrientValue?: (val: number, unit: string) => string;
  onLogFood?: (food: any) => void;
  onLogFoodIdeas?: (ideas: any[]) => void;
  onLogMedical?: any;
  onAgentFinish?: (agentType: string, data: any, acceptedActions?: any) => Promise<void>;
  profile?: any;
  biomarkerHistory?: any[];
  handleAgent1Step?: (step: string, msg: ChatMessage) => Promise<void>;
  handleContinueExtractionChunk?: (msg: ChatMessage) => Promise<void>;
  setLoggedMessageIds?: (fn: (prev: string[]) => string[]) => void;
  loggedMessageIds?: string[];
  handleSend?: (msg: string | any) => void;
  setActiveInstructionAgentType?: (type: string) => void;
  setActiveInstructionPrompt?: (prompt: string | null) => void;
  onDeleteMessage?: (id: string) => void;
  setInputText?: (val: string) => void;
  fileInputRef?: React.MutableRefObject<HTMLInputElement | null>;
  isAnalyzing?: boolean;
  globalLiveLogs?: string;
}
