import React from 'react';
import { Plus, Pin, Trash2, Camera } from 'lucide-react';
import { RemainingBugRow } from './RemainingBugRow';
import { AutoSpotList } from './AutoSpotList';
import type { AutoSpotHit } from '../../utils/bugAutoSpot';

export type BugSnapRowItem = {
  id: string;
  text: string;
  comment: string;
  photos: string[];
  checked: boolean;
  source: 'user' | 'auto';
  classLabel?: string;
  parked?: boolean;
};

export type BugSnapRemainingSectionProps = {
  rows: BugSnapRowItem[];
  selectedRowId: string;
  selectedShotUrl?: string | null;
  autoSpotHits: AutoSpotHit[];
  checkedAutoSpotIds: Set<string>;
  onSelectRow: (id: string) => void;
  onAddRow: () => void;
  onToggleRow: (id: string, checked: boolean) => void;
  onTextChange: (id: string, text: string) => void;
  onCommentChange: (id: string, comment: string) => void;
  onPinShot: (id: string) => void;
  onClearPhoto: (id: string) => void;
  onToggleAutoSpot: (hit: AutoSpotHit, checked: boolean) => void;
  className?: string;
};

/**
 * BugSnapRemainingSection — checklist rows + film pin toolbar + AutoSpotList (Q-6.4 G1-1, G1-2).
 * Allows user to add multiple bug items, pin selected film shots, and review auto-spotted items.
 */
export const BugSnapRemainingSection: React.FC<BugSnapRemainingSectionProps> = ({
  rows,
  selectedRowId,
  selectedShotUrl,
  autoSpotHits,
  checkedAutoSpotIds,
  onSelectRow,
  onAddRow,
  onToggleRow,
  onTextChange,
  onCommentChange,
  onPinShot,
  onClearPhoto,
  onToggleAutoSpot,
  className = '',
}) => {
  const selectedRow = rows.find((r) => r.id === selectedRowId) || rows[0];

  return (
    <div className={`space-y-3 ${className}`} data-testid="bug-snap-remaining-section">
      <div className="flex items-center justify-between gap-2">
        <div>
          <label className="font-bold text-white/95 text-xs block">Bugs on this meal / page</label>
          <p className="text-[10px] text-white/50">
            Select a film shot (blue ring), select a bug row (blue border), then <strong>Pin shot</strong>.
          </p>
        </div>
      </div>

      {/* Action Toolbar */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <button
          type="button"
          onClick={onAddRow}
          className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center gap-1 shadow-xs cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add bug</span>
        </button>

        <button
          type="button"
          disabled={!selectedShotUrl || !selectedRow}
          onClick={() => selectedRow && onPinShot(selectedRow.id)}
          className="px-2.5 py-1 text-[11px] font-bold rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-500/40 text-indigo-200 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
          title="Pin selected film shot to selected bug row"
        >
          <Pin className="w-3 h-3" />
          <span>Pin selected shot to bug</span>
        </button>

        <button
          type="button"
          disabled={!selectedRow || !selectedRow.photos || selectedRow.photos.length === 0}
          onClick={() => selectedRow && onClearPhoto(selectedRow.id)}
          className="px-2 py-1 text-[11px] font-semibold rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-white/10 disabled:opacity-30 flex items-center gap-1 cursor-pointer"
          title="Clear attached photo from selected row"
        >
          <Trash2 className="w-3 h-3" />
          <span>Clear photo</span>
        </button>
      </div>

      {/* User Bug Rows */}
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="space-y-1">
            <RemainingBugRow
              id={row.id}
              text={row.text || '(New bug description...)'}
              checked={row.checked}
              photos={row.photos}
              comment={row.comment}
              source={row.source}
              classLabel={row.classLabel}
              parked={row.parked}
              selected={row.id === selectedRowId}
              onToggle={onToggleRow}
              onComment={onCommentChange}
              onSelect={onSelectRow}
              onPinShot={onPinShot}
              onClearPhoto={onClearPhoto}
            />
            {/* Inline text editor when selected */}
            {row.id === selectedRowId && (
              <div className="pl-2 pr-1 pt-0.5">
                <input
                  type="text"
                  value={row.text}
                  onChange={(e) => onTextChange(row.id, e.target.value)}
                  placeholder="Describe the bug (e.g. 2 butter croissants parsed as 6 multipack)..."
                  className="w-full text-xs rounded-lg px-2.5 py-1.5 bg-black/60 border border-indigo-500/40 text-white placeholder:text-white/40 focus:outline-none"
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Auto-Spotted List */}
      {autoSpotHits && autoSpotHits.length > 0 && (
        <div className="pt-2 border-t border-white/10">
          <AutoSpotList
            hits={autoSpotHits}
            checkedIds={checkedAutoSpotIds}
            selectedId={selectedRowId}
            onToggle={onToggleAutoSpot}
            onSelect={onSelectRow}
          />
        </div>
      )}
    </div>
  );
};
