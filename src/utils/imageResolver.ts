import { FoodLog } from '../types';
import { normalizeMealImageUrl } from './foodImageSources';
/**
 * Resolves a potentially referenced image string.
 * Supports data:image/ URIs, HTTP URLs, and ref:ID cross-references.
 * Fallbacks to parentLog.imageUrls[0] if img is missing.
 */
export function resolveFoodImage(img: string | undefined | null, foodLogs: FoodLog[], parentLog?: FoodLog): string | undefined {
  const targetImg = img || (parentLog?.imageUrls && parentLog.imageUrls.length > 0 ? parentLog.imageUrls[0] : undefined);
  if (!targetImg || targetImg === '[image_removed_for_snapshot]') return undefined;
  
  let result: string | undefined = undefined;
  if (typeof targetImg !== 'string' || !targetImg.startsWith('ref:')) {
    result = targetImg;
  } else {
    const primaryId = targetImg.replace('ref:', '');
    const primaryLog = foodLogs.find(f => f.id === primaryId);
    if (primaryLog) {
      const baseImg = primaryLog.imageUrl || primaryLog.imageUrls?.[0];
      if (baseImg) {
        if (typeof baseImg === 'string' && !baseImg.startsWith('ref:')) {
          result = baseImg;
        } else if (typeof baseImg === 'string') {
          const nextId = baseImg.replace('ref:', '');
          const nextLog = foodLogs.find(f => f.id === nextId);
          const nextImg = nextLog?.imageUrl || nextLog?.imageUrls?.[0];
          if (typeof nextImg === 'string' && !nextImg.startsWith('ref:')) {
            result = nextImg;
          }
        }
      }
    }
  }

  if (result) {
    return normalizeMealImageUrl(result) || result;
  }
  return undefined;
}
/**
 * Resolves an array of potentially referenced image strings.
 */
export function resolveFoodImages(imgs: string[] | undefined | null, foodLogs: FoodLog[], parentLog?: FoodLog): string[] {
  let list = imgs && imgs.length > 0 ? [...imgs] : [];
  if (list.length === 0 && parentLog?.imageUrl && parentLog.imageUrl !== '[image_removed_for_snapshot]') {
    list = [parentLog.imageUrl];
  }
  if (list.length === 0) return [];
  
  const resolved = list.map(img => resolveFoodImage(img, foodLogs, parentLog)).filter((u): u is string => !!u);
  return resolved;
}

/* isUsableImageUrl normalizeMealImageUrl */
