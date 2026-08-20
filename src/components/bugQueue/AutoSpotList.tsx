import React from 'react';
import type { AutoSpotHit } from '../../utils/bugAutoSpot';
import { RemainingBugRow } from './RemainingBugRow';

export type AutoSpotListProps = {
  hits: AutoSpotHit[];
  checkedIds?: Set<string> | string[];
  selectedId?: string;
  onToggle?: (hit: AutoSpotHit, checked: boolean) => void;
  onSelect?: (id: string) => void;
  onComment?: (id: string, comment: string) => void;
  comments?: Record<string, string>;
  className?: string;
};

/**
 * AutoSpotList — presentational list rendering Grok's AutoSpotHit[] (Q-6.4 G0-2).
 * - Heading: "Also spotted on tape — uncheck to drop"
 * - Parked hits render unchecked by default with meta "parked · not your named series"
 * - Strictly ignores / drops any hit whose text matches /scouted only/i
 */
export const AutoSpotList: React.FC<AutoSpotListProps> = ({
  hits = [],
  checkedIds,
  selectedId,
  onToggle,
  onSelect,
  onComment,
  comments = {},
  className = '',
}) => {
  // Filter out any hit whose text matches /scouted only/i
  const validHits = (hits || []).filter(
    (hit) => hit && hit.text && !/scouted only/i.test(hit.text)
  );

  if (validHits.length === 0) {
    return null;
  }

  const isHitChecked = (hit: AutoSpotHit): boolean => {
    if (checkedIds) {
      if (checkedIds instanceof Set) {
        return checkedIds.has(hit.id);
      }
      if (Array.isArray(checkedIds)) {
        return checkedIds.includes(hit.id);
      }
    }
    // Default rule: non-parked hits are checked, parked hits are unchecked
    return !hit.parked;
  };

  return (
    <div className={`space-y-2 ${className}`} data-testid="auto-spot-list">
      <div className="text-[10px] font-extrabold tracking-wider uppercase text-emerald-400 flex items-center justify-between">
        <span>Also spotted on tape — uncheck to drop</span>
        <span className="text-[9px] text-white/40 lowercase font-normal">
          {validHits.length} {validHits.length === 1 ? 'suggestion' : 'suggestions'}
        </span>
      </div>

      <div className="space-y-1.5">
        {validHits.map((hit) => {
          const checked = isHitChecked(hit);
          return (
            <RemainingBugRow
              key={hit.id}
              id={hit.id}
              text={hit.text}
              checked={checked}
              photos={[]}
              comment={comments[hit.id] || ''}
              source="auto"
              classLabel={hit.class || hit.code}
              parked={Boolean(hit.parked)}
              selected={selectedId === hit.id}
              onToggle={(id, nextChecked) => onToggle?.(hit, nextChecked)}
              onSelect={onSelect}
              onComment={onComment}
            />
          );
        })}
      </div>
    </div>
  );
};
