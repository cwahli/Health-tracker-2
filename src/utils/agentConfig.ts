import { ChatMessage } from '../types';

export type AgentType = 'food' | 'medical' | 'food_idea' | 'daily_recommendation' | 'medical_extract' | 'agent1' | 'agent2' | 'agent3' | 'agent4' | 'agent5' | 'agent7' | 'data_review' | 'health_baseline' | 'front_desk' | 'biomarker_review';

export interface AgentConfig {
  id: AgentType;
  category: 'food' | 'medical' | 'system' | 'insights';
  displayName: string;
  description?: string;
  capabilities: string[];
  allowedModes?: string[];
  systemPrompt?: string;
  welcomeMessage?: string | ((context?: any) => string);
  rolloutStatus: 'legacy' | 'flagged' | 'unified';
}

export const AGENT_REGISTRY: Record<AgentType, AgentConfig> = {
  food: {
    id: 'food',
    category: 'food',
    displayName: 'Food & Nutrition Agent',
    description: 'Logs and analyzes meals, evaluates nutritional content.',
    capabilities: ['vision', 'nutrition_analysis', 'food_logging'],
    allowedModes: ['new_log', 'modify', 'discussion', 'evaluation'],
    welcomeMessage: 'Hello! Tell me or upload a photo of what you are planning to eat, and I will analyze its health benefits, risk factors, and full 30 nutrient breakdown based on your profile.',
    rolloutStatus: 'unified',
  },
  medical: {
    id: 'medical',
    category: 'medical',
    displayName: 'Medical Diagnostics Agent',
    description: 'Discusses symptoms, medical history, and suggests diagnostic ideas.',
    capabilities: ['diagnostic', 'biomarker_analysis'],
    welcomeMessage: 'Hello! I can help you parse blood report photos, medical test charts, or manual body logs to build a comprehensive profile of your biomarkers. What information would you like to enter today?',
    rolloutStatus: 'unified',
  },
  food_idea: {
    id: 'food_idea',
    category: 'food',
    displayName: 'Culinary Ideation Agent',
    description: 'Suggests recipes and meals tailored to health goals.',
    capabilities: ['recipe_generation', 'meal_planning'],
    welcomeMessage: 'Hello! Do you have any specific food preferences or cravings today? I will need your location to find the best dining options matching your biomarker goals.',
    rolloutStatus: 'unified',
  },
  daily_recommendation: {
    id: 'daily_recommendation',
    category: 'insights',
    displayName: 'Daily Actions Agent',
    description: 'Generates daily action plans and tracks progress.',
    capabilities: ['action_planning', 'insight_card_view'],
    welcomeMessage: 'Hello! I am your AI Health Coach. Let me look at your clinical biomarkers, daily steps, and latest dietary intake to give you a customized, comprehensive health recommendation today.',
    rolloutStatus: 'unified',
  },
  medical_extract: {
    id: 'medical_extract',
    category: 'medical',
    displayName: 'Clinical Data Parser',
    description: 'Extracts biomarkers from raw text or reports into a structured format.',
    capabilities: ['vision', 'medical_extraction'],
    welcomeMessage: 'Hello! I am the Clinical Data Parser. I extract biomarkers and readings from raw text or reports into a structured format.',
    rolloutStatus: 'legacy',
  },
  data_review: {
    id: 'data_review',
    category: 'medical',
    displayName: 'Data Accuracy Agent',
    description: 'Reviews and corrects biomarker extraction data.',
    capabilities: ['data_validation', 'biomarker_table_view'],
    welcomeMessage: (ctx: any) => `Hello! I am your Clinical Calibration Agent. Here is what is about to happen: I will analyze ${ctx?.dataReviewBatchIdx === 'custom' ? 'Custom Test Batch' : 'Batch ' + (ctx?.dataReviewBatchIdx !== null && ctx?.dataReviewBatchIdx !== undefined ? (ctx?.dataReviewBatchIdx as number) + 1 : 1)} containing your raw biomarker readings. I will automatically recognize your demographic parameters (age, gender, ethnicity) and calibrate all reference ranges precisely to your profile. I will then map each biomarker to its standard physiological grouping, potential medical conditions, and break down each medical range clinically (such as Borderline High or Optimal zones) with clear, actionable insights—all without repeating boilerplate demographic lines. Let's start the calibration!`,
    rolloutStatus: 'unified',
  },
  agent1: {
    id: 'agent1',
    category: 'medical',
    displayName: 'Clinical Calibration Agent',
    description: 'Standardizes extracted clinical terminology to a master dictionary.',
    capabilities: ['data_standardization', 'biomarker_table_view'],
    welcomeMessage: 'Hello! I am the Clinical Calibration Agent. I standardize extracted clinical terminology against a master dictionary to ensure accuracy and consistency across your medical profile.',
    rolloutStatus: 'unified',
  },
  agent2: {
    id: 'agent2',
    category: 'medical',
    displayName: 'Clinical Assessment Agent',
    description: 'Adds clinical context like standard medical groupings and risk categories.',
    capabilities: ['clinical_context', 'biomarker_table_view'],
    welcomeMessage: 'Hello! I am the Clinical Ontologist. I map extracted biomarkers to clinical conditions and physiological risk categories.',
    rolloutStatus: 'unified',
  },
  agent3: {
    id: 'agent3',
    category: 'medical',
    displayName: 'Clinical Harmonization Agent',
    description: 'Consolidates overlapping and synonymous terminology.',
    capabilities: ['terminology_consolidation', 'biomarker_table_view'],
    welcomeMessage: 'Hello! I am the Clinical Data Coordinator. I assemble mapped data into clean physiological buckets.',
    rolloutStatus: 'unified',
  },
  agent4: {
    id: 'agent4',
    category: 'medical',
    displayName: 'Health Planning Agent',
    description: 'Audits testing accuracy, identifies retest timelines, and uncovers short & long-term testing gaps.',
    capabilities: ['health_planning', 'biomarker_table_view'],
    welcomeMessage: 'Hello! I am the Health Planning Agent. I audit your biomarker test data for external confounding factors (e.g. dehydration, exertion), identify retest timelines, and uncover diagnostic testing gaps.',
    rolloutStatus: 'unified',
  },
  agent5: {
    id: 'agent5',
    category: 'insights',
    displayName: 'Holistic Review Agent',
    description: 'Reviews profile holistically to generate broad insights.',
    capabilities: ['holistic_analysis', 'insight_card_view'],
    welcomeMessage: 'Hello! I am the Personalized Reference Ranges agent. I calibrate normal biomarker reference ranges to your exact demographics.',
    rolloutStatus: 'unified',
  },
  agent7: {
    id: 'agent7',
    category: 'insights',
    displayName: 'Health Report Agent',
    description: 'Formats insights and action plans into a cohesive report.',
    capabilities: ['report_generation', 'insight_card_view'],
    welcomeMessage: 'Hello! I am the Medical Literature Consensus agent. I scan PubMed and clinical trials to bring recent scientific debate to your context.',
    rolloutStatus: 'unified',
  },
  front_desk: {
    id: 'front_desk',
    category: 'system',
    displayName: 'Health Preparation Agent',
    description: 'Answers general questions, routes users, and updates health data.',
    capabilities: ['general_qa', 'routing', 'profile_update', 'biomarker_logging'],
    welcomeMessage: 'Hello! I am your Health Preparation Agent. How can I help you today? You can ask me about your health data, or I can help you update your profile. I can also direct you to one of our specialized agents.',
    rolloutStatus: 'unified',
  },
  biomarker_review: {
    id: 'biomarker_review',
    category: 'medical',
    displayName: 'Biomarker Review Agent',
    description: 'Reviews specific biomarker entries.',
    capabilities: ['biomarker_analysis'],
    welcomeMessage: 'Let us review your biomarker.',
    rolloutStatus: 'unified',
  },
  health_baseline: {
    id: 'health_baseline',
    category: 'insights',
    displayName: 'Health Coach',
    description: 'An evidence-based, pragmatic health coach to translate complex health science into sustainable habits.',
    capabilities: ['health_baseline_view'],
    welcomeMessage: 'Hello! I am your Health Coach. I am here to help translate complex health and longevity science into sustainable, low-friction daily habits. Let us focus on food quality, portion awareness, and building realistic routines.',
    rolloutStatus: 'unified',
  }
};

export function getAgentRolloutStatus(agentType: AgentType): 'legacy' | 'flagged' | 'unified' {
  return AGENT_REGISTRY[agentType]?.rolloutStatus || 'legacy';
}
