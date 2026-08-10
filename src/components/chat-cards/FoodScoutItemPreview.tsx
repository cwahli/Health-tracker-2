import * as React from 'react';
import { CroppedFoodImage } from './FoodCard';
const onlineImageCache = new Map<string, string>();
export const OnlineFoodImage: React.FC<{ 
  foodName: string; 
  fallbackSrc: string; 
  className?: string;
  searchMode?: "light" | "complete";
  prefetchedSrc?: string;
}> = ({ 
  foodName, 
  fallbackSrc, 
  className,
  searchMode = "complete",
  prefetchedSrc
}) => {
  const [src, setSrc] = React.useState<string>(prefetchedSrc || "");
  const [loading, setLoading] = React.useState(!prefetchedSrc);
  React.useEffect(() => {
    if (prefetchedSrc) {
      setSrc(prefetchedSrc);
      setLoading(false);
      return;
    }
    
    const baseFoodName = foodName.replace(/\s*\(.*?\)\s*/g, '').trim();
    const cacheKey = `${searchMode}_${baseFoodName}`;
    if (onlineImageCache.has(cacheKey)) {
      setSrc(onlineImageCache.get(cacheKey)!);
      setLoading(false);
      return;
    }
    
    let active = true;
    const fetchImage = async () => {
      try {
        const res = await fetch("/api/gemini/food-image-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: foodName, mode: searchMode }),
        });
        const data = await res.json();
        if (active && data.images && data.images.length > 0) {
          const fetchedUrl = data.images[0].imageUrl;
          onlineImageCache.set(cacheKey, fetchedUrl);
          setSrc(fetchedUrl);
        }
      } catch (err) {
        console.warn("Online search failed for", foodName, err);
      } finally {
        if (active) setLoading(false);
      }
    };
    fetchImage();
    return () => { active = false; };
  }, [foodName, searchMode, prefetchedSrc]);
  return (
    <img 
      src={src || fallbackSrc} 
      alt={foodName} 
      className={`${className} ${loading ? 'animate-pulse bg-slate-100 dark:bg-slate-800' : ''}`}
      referrerPolicy="no-referrer"
      onError={(e) => {
        (e.target as HTMLImageElement).src = fallbackSrc;
      }}
    />
  );
};
interface FoodScoutItemPreviewProps {
  name: string;
  src: string;
  boundingBox: [number, number, number, number] | null;
  imgIdx?: number | null;
  messageImages: string[];
  onClick: () => void;
  aspectClassName?: string;
  isActive?: boolean;
  isSearchMode?: boolean;
  searchMode?: "light" | "complete";
  prefetchedSrc?: string;
  clinicalThreat?: string;
}
export const FoodScoutItemPreview: React.FC<FoodScoutItemPreviewProps> = ({
  name,
  src,
  boundingBox,
  imgIdx,
  messageImages,
  onClick,
  aspectClassName = "aspect-square",
  isActive = false,
  isSearchMode = false,
  searchMode = "light",
  prefetchedSrc,
  clinicalThreat
}) => {
  return (
    <div className="flex flex-col items-center gap-1.5 w-full text-center">
      <div 
        className={`w-full ${aspectClassName} rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-855 cursor-pointer shadow-sm transition-all duration-200 shrink-0 ${
          isActive 
            ? "ring-4 ring-indigo-500 scale-[1.03] shadow-md" 
            : isSearchMode 
              ? "hover:ring-2 ring-indigo-400/50 hover:scale-[1.01]" 
              : "hover:ring-2 ring-indigo-500/30"
        }`}
        onClick={onClick}
      >
        {(boundingBox && !prefetchedSrc) ? (
          <CroppedFoodImage 
            src={src} 
            boundingBox={boundingBox} 
            alt={name} 
            className="w-full h-full object-cover"
            imageUrls={messageImages}
            sourceImageIndex={imgIdx}
          />
        ) : (
          <OnlineFoodImage 
            foodName={name} 
            fallbackSrc={src} 
            className="w-full h-full object-cover"
            searchMode={searchMode}
            prefetchedSrc={prefetchedSrc}
          />
        )}
      </div>
      <span className={`text-[10px] text-center font-medium leading-tight break-words w-full lowercase ${
        isActive ? "text-indigo-600 dark:text-indigo-400 font-bold underline" : "text-theme-neutral"
      }`}>
        {name}
      </span>
      {clinicalThreat && clinicalThreat.toLowerCase() !== 'none' && (() => {
        const t = clinicalThreat.toLowerCase();
        let bg = "bg-rose-50 dark:bg-rose-950/25 border border-rose-200/30";
        let text = "text-rose-700 dark:text-rose-400";
        let icon = "⚠️";
        if (t.includes('safe') || t.includes('no threat') || t.includes('healthy')) {
          bg = "bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200/30";
          text = "text-emerald-700 dark:text-emerald-400";
          icon = "✓";
        } else if (t.includes('caution') || t.includes('moderate') || t.includes('medium')) {
          bg = "bg-amber-50 dark:bg-amber-950/20 border border-amber-200/30";
          text = "text-amber-700 dark:text-amber-400";
          icon = "⚠️";
        }
        return (
          <div className={`px-1.5 py-0.5 rounded text-[8.5px] font-bold inline-block max-w-full truncate ${bg} ${text}`} title={clinicalThreat}>
            {icon} {clinicalThreat}
          </div>
        );
      })()}
    </div>
  );
};
