export interface LLMModel {
  id: string;
  name: string;
  provider: 'Google' | 'Anthropic' | 'OpenAI';
  description: string;
  isDefault?: boolean;
}

export const AVAILABLE_LLMS: LLMModel[] = [
  {
    id: 'gemini-3.5-flash-lite',
    name: 'Gemini 3.5 Flash Lite',
    provider: 'Google',
    description: 'Fast and cost-effective model for general multimodal tasks.',
    isDefault: true
  },
  {
    id: 'gemini-2.5-flash',
    name: 'Gemini 2.5 Flash',
    provider: 'Google',
    description: 'Fast, high-accuracy multimodal model for nutrition and clinical evaluation.'
  },
  {
    id: 'gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    provider: 'Google',
    description: 'Fast and reliable flash model.'
  }
];
