export * from './types';
export * from './FoodIdeaCard';
export * from './FoodCard';
export * from './BiomarkerCard';
export * from './WelcomeCard';
export * from './HealthBaselineCard';
export * from './BiomarkerReviewCard';
export * from './ReceptionistCard';

import { FoodIdeaCard } from './FoodIdeaCard';
import { FoodCard } from './FoodCard';
import { BiomarkerCard } from './BiomarkerCard';
import { WelcomeCard } from './WelcomeCard';
import { HealthBaselineCard } from './HealthBaselineCard';
import { BiomarkerReviewCard } from './BiomarkerReviewCard';
import { ReceptionistCard } from './ReceptionistCard';
import { AgentType } from '../../utils/agentConfig';

export const agentCardRegistry: Record<string, React.FC<any>> = {
  health_baseline: HealthBaselineCard,
  food_idea: FoodIdeaCard,
  food: FoodCard,
  food_log: FoodCard,
  food_analyze: FoodCard,
  food_compare: FoodCard,
  front_desk: ReceptionistCard,
  new_log: FoodCard,
  modify: FoodCard,
  review: FoodCard,
  agent1: BiomarkerCard,
  agent1_step1: BiomarkerCard,
  agent1_step2: BiomarkerCard,
  agent1_step3: BiomarkerCard,
  agent2: BiomarkerCard,
  agent3: BiomarkerCard,
  agent4: BiomarkerCard,
  agent5: BiomarkerCard,
  agent6: BiomarkerCard,
  agent7: BiomarkerCard,
  data_review: BiomarkerCard,
  medical: BiomarkerCard,
  medical_extract: BiomarkerCard,
  welcome: WelcomeCard,
  biomarker_review: BiomarkerCard
};
