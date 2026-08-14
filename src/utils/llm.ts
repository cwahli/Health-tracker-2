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
    description: 'Default. Free-tier 15 req/min — switch away if you hit 429.',
    isDefault: true
  },
  {
    id: 'gemini-3.1-flash-lite',
    name: 'Gemini 3.1 Flash Lite',
    provider: 'Google',
    description: 'Separate free-tier quota from 3.5 Lite. Use when 3.5 is exhausted.'
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
