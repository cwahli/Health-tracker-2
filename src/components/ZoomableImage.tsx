import { trackApiCall } from '../utils/apiTracker';
import React, { useRef, useEffect, useState } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
interface ZoomableImageProps {

  src: string;
  boundingBox?: number[] | null;
  onClose: () => void;
  foodName?: string;
  onNext?: () => void;
  onPrev?: () => void;
  hasNext?: boolean;
  hasPrev?: boolean;
  sourceUrl?: string;
}
export const ZoomableImage: React.FC<ZoomableImageProps> = ({ 
  src, 
  boundingBox, 
  onClose,
  foodName,
  onNext,
  onPrev,
  hasNext,
  hasPrev,
  sourceUrl
}) => {
  const targetRef = useRef<HTMLDivElement>(null);
  const isFirstRef = useRef(true);
  const { zoomToElement } = React.useContext(React.createContext({ zoomToElement: (el: any, scale: any, time: any) => {} })); // Just a placeholder, we'll get it from render props
  const [highlight, setHighlight] = useState(true);
  // Reset highlight state and trigger smooth transitions when the bounding box coordinates change
  useEffect(() => {
    setHighlight(true);
    const timer = setTimeout(() => setHighlight(false), 1000);
    return () => {
      clearTimeout(timer);
      isFirstRef.current = false; // Mark first mount completed
    };
  }, [boundingBox]);
  return (
    <div 
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95 backdrop-blur-md transition-all duration-300"
      onClick={onClose}
    >
      <div 
        className="relative max-w-[100vw] max-h-[100vh] w-full h-full flex flex-col items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Floating Title Bubble at the top */}
        {foodName && (
          <div 
            className="absolute top-6 left-1/2 -translate-x-1/2 px-6 py-2.5 bg-slate-900/90 hover:bg-slate-800 text-white rounded-full font-semibold text-sm tracking-wide border border-slate-700/80 shadow-2xl z-[10000] text-center max-w-[80vw] truncate cursor-pointer transition-colors flex items-center gap-1.5"
            onClick={(e) => {
              e.stopPropagation();
              window.open('https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(foodName), '_blank', 'noopener,noreferrer');
            }}
            title="Search Google Images"
          >
            <span>{foodName}</span>
            <span className="opacity-50 text-[10px]">↗</span>
          </div>
        )}
        <TransformWrapper
          initialScale={1}
          minScale={0.5}
          maxScale={40}
          centerOnInit={true}
        >
          {({ zoomToElement }) => {
            return (
              <>
                <TransformComponent wrapperClass="!w-full !h-full" contentClass="!w-full !h-full flex items-center justify-center">
                  <div className="relative inline-block max-w-[95vw] max-h-[85vh]">
                      <img 
                        src={src} 
                        alt={foodName || "Full screen preview"} 
                        className={`max-w-[95vw] max-h-[85vh] rounded-xl object-contain shadow-2xl animate-fade-in ${sourceUrl ? 'cursor-pointer hover:opacity-90 transition-opacity' : ''}`}
                        referrerPolicy="no-referrer"
                        onClick={sourceUrl ? (e) => { e.stopPropagation(); window.open(sourceUrl, '_blank', 'noopener,noreferrer'); } : undefined}
                      />
                    {boundingBox && boundingBox.length === 4 && (
                      <ZoomTrigger boundingBox={boundingBox} zoomToElement={zoomToElement} isFirst={isFirstRef.current} />
                    )}
                    {boundingBox && boundingBox.length === 4 && (
                      <div 
                        id="zoom-target-bbox"
                        className={`absolute pointer-events-none transition-opacity duration-500 bg-emerald-400/25 border border-emerald-400/40 shadow-[0_0_20px_rgba(52,211,153,0.35)] rounded-md ${
                          highlight ? 'opacity-100' : 'opacity-0'
                        }`}
                        style={{
                          top: `${boundingBox[0] / 10}%`,
                          left: `${boundingBox[1] / 10}%`,
                          height: `${(boundingBox[2] - boundingBox[0]) / 10}%`,
                          width: `${(boundingBox[3] - boundingBox[1]) / 10}%`,
                        }}
                      />
                    )}
                  </div>
                </TransformComponent>
                {/* Left Navigation Chevron */}
                {hasPrev && onPrev && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); onPrev(); }}
                    className="absolute left-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center bg-slate-900/80 hover:bg-slate-800 text-white rounded-full font-bold shadow-2xl border border-slate-700/60 cursor-pointer transition-all active:scale-95 z-[10000] text-xl"
                    aria-label="Previous item"
                  >
                    ‹
                  </button>
                )}
                {/* Right Navigation Chevron */}
                {hasNext && onNext && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); onNext(); }}
                    className="absolute right-6 top-1/2 -translate-y-1/2 w-12 h-12 flex items-center justify-center bg-slate-900/80 hover:bg-slate-800 text-white rounded-full font-bold shadow-2xl border border-slate-700/60 cursor-pointer transition-all active:scale-95 z-[10000] text-xl"
                    aria-label="Next item"
                  >
                    ›
                  </button>
                )}
                <button 
                  onClick={onClose}
                  className="absolute bottom-8 left-1/2 -translate-x-1/2 px-8 py-3 bg-slate-900/90 hover:bg-slate-800 text-white rounded-full font-bold text-sm border border-slate-700 shadow-xl transition-all cursor-pointer z-[10000]"
                >
                  Close Preview
                </button>
              </>
            );
          }}
        </TransformWrapper>
      </div>
    </div>
  );
};
const ZoomTrigger = ({ boundingBox, zoomToElement, isFirst }: { boundingBox: number[], zoomToElement: any, isFirst: boolean }) => {
  React.useEffect(() => {
    if (boundingBox && boundingBox.length === 4) {
      const bboxWidth = (boundingBox[3] - boundingBox[1]) / 1000;
      const bboxHeight = (boundingBox[2] - boundingBox[0]) / 1000;
      const maxBboxSize = Math.max(bboxWidth, bboxHeight);
      const targetScale = Math.min(0.95 / (maxBboxSize || 1), 40);
      
      const duration = isFirst ? 0 : 500;
      const delay = isFirst ? 0 : 150;
      
      const timer = setTimeout(() => {
        const el = document.getElementById('zoom-target-bbox');
        if (el) zoomToElement(el, targetScale, duration);
      }, delay);
      return () => clearTimeout(timer);
    }
  }, [boundingBox, zoomToElement, isFirst]);
  return null;
};
