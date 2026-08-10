import * as React from 'react';
import { AgentCardProps } from './types';
import { InteractivePlacesMap } from '../InteractivePlacesMap';

export const FoodIdeaCard: React.FC<AgentCardProps> = ({
  msg,
  onLogFoodIdeas,
  setLoggedMessageIds,
  loggedMessageIds
}) => {
  if (msg.agentType !== 'food_idea') return null;

  return (
    <>
      {msg.data?.pendingFoodIdeas && (
                    <InteractivePlacesMap
                      ideas={msg.data?.pendingFoodIdeas}
                      onSaveSelected={(selectedIdeas) => {
                        if (onLogFoodIdeas) {
                          onLogFoodIdeas(selectedIdeas);
                          setLoggedMessageIds?.(prev => [...prev, msg.id]);
                        }
                      }}
                      isLogged={(loggedMessageIds || []).includes(msg.id)}
                    />
                  )}
    </>
  );
};
