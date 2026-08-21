import React, { useState } from 'react';
import { Plus, Pin, Trash2, ClipboardPaste, ListPlus, X, Check, FileText } from 'lucide-react';
import { RemainingBugRow } from './RemainingBugRow';
import { AutoSpotList } from './AutoSpotList';
import type { AutoSpotHit } from '../../utils/bugAutoSpot';
import { parseBatchBugs } from '../../utils/bugBatchParser';

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
  onBatchAdd?: (bugTexts: string[], replace?: boolean) => void;
  onBatchInsert?: (targetRowId: string, bugTexts: string[]) => void;
  onRemoveRow?: (id: string) => void;
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
 * Allows user to add multiple bug items, paste sets of bugs at once, pin selected film shots, and review auto-spotted items.
 */
export const BugSnapRemainingSection: React.FC<BugSnapRemainingSectionProps> = ({
  rows,
  selectedRowId,
  selectedShotUrl,
  autoSpotHits,
  checkedAutoSpotIds,
  onSelectRow,
  onAddRow,
  onBatchAdd,
  onBatchInsert,
  onRemoveRow,
  onToggleRow,
  onTextChange,
  onCommentChange,
  onPinShot,
  onClearPhoto,
  onToggleAutoSpot,
  className = '',
}) => {
  const [showBatchModal, setShowBatchModal] = useState(false);
  const [batchRawText, setBatchRawText] = useState('');
  const [batchReplace, setBatchReplace] = useState(false);

  const selectedRow = rows.find((r) => r.id === selectedRowId) || rows[0];
  const parsedBatchItems = parseBatchBugs(batchRawText);

  const handleApplyBatch = () => {
    if (parsedBatchItems.length === 0) return;
    if (onBatchAdd) {
      onBatchAdd(parsedBatchItems, batchReplace);
    } else {
      for (const text of parsedBatchItems) {
        onAddRow();
      }
    }
    setBatchRawText('');
    setShowBatchModal(false);
  };

  const handleInputPaste = (e: React.ClipboardEvent<HTMLInputElement>, rowId: string) => {
    const text = e.clipboardData.getData('text');
    if (!text) return;
    const parsed = parseBatchBugs(text);
    if (parsed.length > 1) {
      e.preventDefault();
      if (onBatchInsert) {
        onBatchInsert(rowId, parsed);
      } else if (onBatchAdd) {
        onBatchAdd(parsed);
      } else {
        onTextChange(rowId, parsed[0]);
      }
    }
  };

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
          onClick={() => setShowBatchModal((prev) => !prev)}
          className={`px-2.5 py-1 text-[11px] font-bold rounded-lg border transition-colors flex items-center gap-1 cursor-pointer ${
            showBatchModal
              ? 'bg-indigo-500 text-white border-indigo-400'
              : 'bg-indigo-950/70 hover:bg-indigo-900 border-indigo-500/40 text-indigo-200'
          }`}
          title="Paste multiple bugs at once (bullet points, lines, or paragraphs)"
        >
          <ClipboardPaste className="w-3.5 h-3.5" />
          <span>Paste bugs</span>
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

      {/* Batch Paste Box */}
      {showBatchModal && (
        <div className="p-3 rounded-xl border border-indigo-500/40 bg-[#0d1424] space-y-2.5 animate-in fade-in-50 duration-150">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-indigo-300 font-bold text-xs">
              <ListPlus className="w-4 h-4 text-indigo-400" />
              <span>Paste set of bugs at once</span>
            </div>
            <button
              type="button"
              onClick={() => setShowBatchModal(false)}
              className="text-slate-400 hover:text-white p-0.5 rounded-md hover:bg-white/10 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="text-[11px] text-white/70 leading-relaxed">
            Paste any list of bugs (lines, bullet points, numbers, or concatenated topic paragraphs). Each item will be added as an individual bug in the tracker.
          </p>

          <textarea
            rows={4}
            value={batchRawText}
            onChange={(e) => setBatchRawText(e.target.value)}
            placeholder={"Paste bugs here, for example:\n• Micronutrient null handling: Differentiate zero-values\n• Cheddar cheese profile: Correct database macros\n• Totals synchronization: Propagate post-analysis rules"}
            className="w-full text-xs rounded-lg px-2.5 py-2 bg-black/60 border border-indigo-500/30 text-white placeholder:text-white/35 focus:outline-none focus:border-indigo-400 transition-colors font-mono"
            autoFocus
          />

          {/* Live parsed preview badge */}
          {parsedBatchItems.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="text-emerald-400 font-semibold flex items-center gap-1">
                  <Check className="w-3 h-3" /> {parsedBatchItems.length} individual bug{parsedBatchItems.length === 1 ? '' : 's'} identified:
                </span>
                <label className="text-[10px] text-white/60 flex items-center gap-1 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={batchReplace}
                    onChange={(e) => setBatchReplace(e.target.checked)}
                    className="rounded border-slate-700 bg-slate-900 text-indigo-600 h-3 w-3"
                  />
                  <span>Replace current empty rows</span>
                </label>
              </div>

              <div className="max-h-28 overflow-y-auto space-y-1 p-2 rounded-lg bg-black/40 border border-white/10 text-[11px]">
                {parsedBatchItems.map((item, idx) => (
                  <div key={idx} className="flex items-start gap-1.5 text-white/80">
                    <span className="font-mono text-indigo-400 shrink-0 text-[10px] pt-0.5">{idx + 1}.</span>
                    <span className="line-clamp-2">{item}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setBatchRawText('');
                setShowBatchModal(false);
              }}
              className="px-2.5 py-1 text-xs text-slate-300 hover:text-white rounded-lg hover:bg-slate-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={parsedBatchItems.length === 0}
              onClick={handleApplyBatch}
              className="px-3 py-1 text-xs font-bold rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white flex items-center gap-1.5 shadow-xs cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add {parsedBatchItems.length > 0 ? `${parsedBatchItems.length} bugs` : 'bugs'}</span>
            </button>
          </div>
        </div>
      )}

      {/* User Bug Rows */}
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="space-y-1">
            <RemainingBugRow
              id={row.id}
              text={row.text || ''}
              checked={row.checked}
              photos={row.photos}
              comment={row.comment}
              source={row.source}
              classLabel={row.classLabel}
              parked={row.parked}
              selected={row.id === selectedRowId}
              onToggle={onToggleRow}
              onTextChange={onTextChange}
              onInputPaste={handleInputPaste}
              onComment={onCommentChange}
              onSelect={onSelectRow}
              onPinShot={onPinShot}
              onClearPhoto={onClearPhoto}
              onDelete={onRemoveRow}
            />
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
