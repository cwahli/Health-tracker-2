import React, { useState } from 'react';

export type RemainingBugRowProps = {
  id: string;
  text: string;
  checked: boolean; // kept in series
  photos: string[]; // display URLs; may be empty
  comment: string;
  source: 'user' | 'auto';
  classLabel?: string;
  parked?: boolean;
  selected?: boolean;
  strikethroughWhenChecked?: boolean;
  onToggle?: (id: string, checked: boolean) => void;
  onTextChange?: (id: string, text: string) => void;
  onInputPaste?: (e: React.ClipboardEvent<HTMLInputElement>, id: string) => void;
  onComment?: (id: string, comment: string) => void;
  onSelect?: (id: string) => void;
  onPinShot?: (id: string) => void; // parent already knows selected film shot
  onClearPhoto?: (id: string) => void;
  onDelete?: (id: string) => void;
};

/**
 * RemainingBugRow — presentational row for a single remaining bug item.
 * Props-only view component matching mockup .bugrow specs (Q-6.4 G0-1).
 */
export const RemainingBugRow: React.FC<RemainingBugRowProps> = ({
  id,
  text,
  checked,
  photos = [],
  comment = '',
  source = 'user',
  classLabel,
  parked = false,
  selected = false,
  strikethroughWhenChecked = false,
  onToggle,
  onTextChange,
  onInputPaste,
  onComment,
  onSelect,
  onPinShot,
  onClearPhoto,
  onDelete,
}) => {
  const [isEditingComment, setIsEditingComment] = useState(false);
  const [commentDraft, setCommentDraft] = useState(comment);

  const hasPhoto = photos && photos.length > 0;
  const isAuto = source === 'auto';
  const isEditable = !isAuto && Boolean(onTextChange);

  return (
    <div
      data-testid={`remaining-bug-row-${id}`}
      onClick={() => onSelect?.(id)}
      className={`relative p-2.5 rounded-xl border transition-all text-xs ${
        selected
          ? 'bg-[#131d31] border-indigo-400 ring-1 ring-indigo-400/50'
          : isAuto
          ? 'bg-[#0f172a] border-emerald-500/35 hover:border-emerald-500/50'
          : 'bg-[#0f172a] border-slate-700/80 hover:border-slate-600'
      } ${parked ? 'opacity-70' : ''}`}
    >
      <div className="grid grid-cols-[80px_1fr] gap-2.5 items-start">
        {/* Photo / Thumbnail Thumbnail Slot */}
        <div className="relative group shrink-0">
          {hasPhoto ? (
            <div className="relative w-20 h-[60px] rounded-lg overflow-hidden border border-white/10 bg-black/40">
              <img
                src={photos[0]}
                alt="Bug attachment"
                className="w-full h-full object-cover"
              />
              {photos.length > 1 && (
                <span className="absolute bottom-1 right-1 bg-black/80 text-[9px] font-bold text-white px-1 rounded">
                  +{photos.length - 1}
                </span>
              )}
            </div>
          ) : (
            <div className="w-20 h-[60px] rounded-lg border border-dashed border-white/20 bg-slate-800/60 flex flex-col items-center justify-center text-[10px] text-slate-400 font-medium text-center p-1">
              <span>no photo</span>
            </div>
          )}

          {/* Photo Actions overlay */}
          <div className="mt-1 flex flex-col gap-0.5">
            {onPinShot && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPinShot(id);
                }}
                className="w-full text-[9px] font-bold py-0.5 px-1 rounded bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-500/40 text-indigo-200 transition-colors text-center cursor-pointer"
                title="Pin active film shot to this bug"
              >
                Pin shot
              </button>
            )}
            {hasPhoto && onClearPhoto && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClearPhoto(id);
                }}
                className="w-full text-[9px] font-semibold py-0.5 px-1 rounded bg-rose-950/60 hover:bg-rose-900 border border-rose-500/30 text-rose-300 transition-colors text-center cursor-pointer"
                title="Clear attached photo"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Content Column */}
        <div className="min-w-0 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-2 min-w-0 flex-1">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onToggle?.(id, e.target.checked)}
                onClick={(e) => e.stopPropagation()}
                className="mt-1 rounded border-slate-700 bg-slate-900 text-indigo-600 focus:ring-indigo-500 cursor-pointer h-3.5 w-3.5 shrink-0"
              />
              {isEditable ? (
                <input
                  type="text"
                  value={text}
                  onChange={(e) => onTextChange?.(id, e.target.value)}
                  onFocus={() => onSelect?.(id)}
                  onClick={(e) => e.stopPropagation()}
                  onPaste={(e) => onInputPaste?.(e, id)}
                  placeholder="Describe bug or paste multiple bugs (auto-splits)..."
                  className="w-full text-xs font-semibold rounded-lg px-2.5 py-1 bg-black/60 border border-indigo-500/40 text-white placeholder:text-white/40 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400/50"
                  autoFocus={selected && !text}
                />
              ) : (
                <span
                  onClick={() => onSelect?.(id)}
                  className={`font-semibold leading-tight cursor-pointer ${
                    strikethroughWhenChecked && checked ? 'line-through text-slate-400' : 'text-white'
                  }`}
                >
                  {text || '(New bug description...)'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {classLabel && (
                <span className="px-2 py-0.5 text-[9px] font-extrabold uppercase rounded-full bg-slate-900 border border-slate-700 text-indigo-300">
                  {classLabel}
                </span>
              )}
              {onDelete && !isAuto && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(id);
                  }}
                  className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                  title="Remove this bug"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                </button>
              )}
            </div>
          </div>

          {/* Metadata / Source / Parked tag */}
          <div className="text-[10px] text-slate-400 flex items-center gap-1.5 flex-wrap">
            {isAuto ? (
              <span className="text-emerald-400/90 font-medium">
                Auto {classLabel ? `· ${classLabel}` : ''}
              </span>
            ) : (
              <span className="text-slate-400 font-medium">User specified</span>
            )}
            {parked && (
              <span className="text-amber-400/90 font-semibold">
                · parked (off) · not your named series
              </span>
            )}
          </div>

          {/* Comment line */}
          <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
            {isEditingComment ? (
              <div className="flex items-center gap-1 mt-1">
                <input
                  type="text"
                  value={commentDraft}
                  onChange={(e) => setCommentDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      onComment?.(id, commentDraft);
                      setIsEditingComment(false);
                    } else if (e.key === 'Escape') {
                      setCommentDraft(comment);
                      setIsEditingComment(false);
                    }
                  }}
                  placeholder="Add a comment..."
                  className="w-full text-[11px] px-2 py-0.5 rounded bg-black/60 border border-indigo-500/40 text-white focus:outline-none"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => {
                    onComment?.(id, commentDraft);
                    setIsEditingComment(false);
                  }}
                  className="px-2 py-0.5 text-[10px] font-bold rounded bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer"
                >
                  Save
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group/cmt">
                {comment ? (
                  <p className="text-[11px] text-amber-200/90 italic bg-black/30 px-2 py-0.5 rounded border border-white/5">
                    "{comment}"
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditingComment(true)}
                    className="text-[10px] text-slate-500 hover:text-slate-300 font-medium cursor-pointer"
                  >
                    + Add comment
                  </button>
                )}
                {comment && onComment && (
                  <button
                    type="button"
                    onClick={() => setIsEditingComment(true)}
                    className="text-[9px] text-slate-400 hover:text-white opacity-0 group-hover/cmt:opacity-100 transition-opacity cursor-pointer"
                  >
                    edit
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
