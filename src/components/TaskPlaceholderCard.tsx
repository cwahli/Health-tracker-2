import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, Trash2, XCircle, CheckCircle2, AlertTriangle, Eye, Save, RotateCcw, Sliders, HelpCircle } from 'lucide-react';
import { AgentJob } from '../jobs/types';
import { ImageStore } from '../jobs/ImageStore';
import { JobStore } from '../jobs/JobStore';
import { FoodLog } from '../types';

interface TaskPlaceholderCardProps {
  job: AgentJob;
  onView: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  onCancel: (jobId: string) => void;
  onSave: (foodLog: FoodLog) => void;
  profileLanguage?: string;
}

export default function TaskPlaceholderCard({
  job,
  onView,
  onDelete,
  onCancel,
  onSave,
  profileLanguage = 'en'
}: TaskPlaceholderCardProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleLocalSave = async () => {
    if (!pendingFoodLog || isSaving) return;
    setIsSaving(true);
    
    // Create a deep copy of pendingFoodLog to avoid mutating state directly
    const logToSave = JSON.parse(JSON.stringify(pendingFoodLog));
    
    try {
      let finalImageUrl = '';

      // 1. Try fetching and converting raw images from ImageStore
      const images = await ImageStore.getImages(job.id);
      if (images && images.length > 0) {
        const dataUrls = await Promise.all(
          images.map(async (img) => {
            if (typeof img === 'string') {
              if (img.startsWith('data:image/') || img.startsWith('http')) {
                return img;
              }
              if (img.startsWith('blob:')) {
                try {
                  const res = await fetch(img);
                  const b = await res.blob();
                  return new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(b);
                  });
                } catch {
                  // Fall through
                }
              }
              return img;
            }
            if (img && typeof img === 'object') {
              const imgAny = img as any;
              const blob = imgAny instanceof Blob ? imgAny : new Blob([imgAny], { type: imgAny.type || 'image/jpeg' });
              return new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
            }
            return '';
          })
        );
        
        const validUrls = dataUrls.filter(url => url && (url.startsWith('data:image/') || url.startsWith('http')));
        if (validUrls.length > 0) {
          finalImageUrl = validUrls[0];
        }
      }

      // 2. FALLBACK: If ImageStore didn't yield a valid URL but we have an active, visible preview image or job photoUrl
      const remotePhoto =
        job.photoUrl ||
        job.result?.photoUrl ||
        job.result?.clean_result?.photoUrl ||
        (job.result as any)?.data?.photoUrl ||
        (job as any).clean_result?.photoUrl ||
        (job as any).photo_url;

      if (!finalImageUrl && imageUrl) {
        if (imageUrl.startsWith('data:image/') || imageUrl.startsWith('http')) {
          finalImageUrl = imageUrl;
        } else if (imageUrl.startsWith('blob:')) {
          try {
            const res = await fetch(imageUrl);
            const b = await res.blob();
            finalImageUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(b);
            });
          } catch (e) {
            console.warn('[TaskPlaceholderCard] Failed to convert active preview imageUrl state to base64:', e);
          }
        }
      }
      if (!finalImageUrl && remotePhoto) {
        finalImageUrl = remotePhoto;
      }

      // Apply the resolved image URL if found
      if (finalImageUrl) {
        logToSave.imageUrl = finalImageUrl;
        logToSave.imageUrls = [finalImageUrl];
      }
    } catch (e) {
      console.warn('[TaskPlaceholderCard] Failed to convert ImageStore images to base64 for saving:', e);
    } finally {
      onSave(logToSave);
      setIsSaving(false);
    }
  };

  // Load image preview: check ImageStore first for raw bytes, then fallback to photoUrl / pendingFoodLog / messages
  useEffect(() => {
    let active = true;
    let createdObjectUrl: string | null = null;

    const loadPreview = async () => {
      try {
        // 1. Try ImageStore first for local raw image bytes (most reliable for active/queued/running jobs)
        const images = await ImageStore.getImages(job.id);
        if (images && images.length > 0 && active) {
          const firstImg: any = images[0];
          if (firstImg) {
            if (typeof firstImg === 'string' && (firstImg.startsWith('data:image/') || firstImg.startsWith('http'))) {
              setImageUrl(firstImg);
              return;
            }
            if (firstImg instanceof Blob || (typeof firstImg === 'object' && ('size' in firstImg || 'type' in firstImg))) {
              try {
                const blob = firstImg instanceof Blob ? firstImg : new Blob([firstImg], { type: firstImg.type || 'image/jpeg' });
                createdObjectUrl = URL.createObjectURL(blob);
                setImageUrl(createdObjectUrl);
                return;
              } catch (e) {}
            }
          }
        }

        const pendingFoodLog =
          job.result?.pendingFoodLog ||
          job.result?.raw?.data ||
          job.result?.data ||
          job.messages?.find((m: any) => m.pendingFoodLog)?.pendingFoodLog ||
          job.messages?.find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog;

        // 2. Direct photoUrl or pendingFoodLog.imageUrl / imageUrls
        const directPhoto =
          job.photoUrl ||
          job.result?.photoUrl ||
          job.result?.clean_result?.photoUrl ||
          (job.result as any)?.data?.photoUrl ||
          (job as any).clean_result?.photoUrl ||
          (job as any).photo_url ||
          pendingFoodLog?.imageUrl ||
          (pendingFoodLog?.imageUrls && pendingFoodLog.imageUrls[0]);

        if (directPhoto && typeof directPhoto === 'string' && (directPhoto.startsWith('http') || directPhoto.startsWith('data:image/') || directPhoto.startsWith('blob:')) && active) {
          setImageUrl(directPhoto);
          return;
        }

        // 3. Check user messages for valid imageUrl
        const userMsgWithImg = job.messages?.find(
          (m: any) => m.imageUrl && typeof m.imageUrl === 'string' && (m.imageUrl.startsWith('data:image/') || m.imageUrl.startsWith('http') || m.imageUrl.startsWith('blob:'))
        );
        if (userMsgWithImg?.imageUrl && active) {
          setImageUrl(userMsgWithImg.imageUrl);
          return;
        }
      } catch (err) {
        console.warn('Failed to load image preview for task placeholder:', err);
      }
    };
    loadPreview();
    return () => {
      active = false;
      if (createdObjectUrl) {
        URL.revokeObjectURL(createdObjectUrl);
      }
    };
  }, [job.id, job.photoUrl, job.result, job.messages]);

  const getStatusLabel = () => {
    if (job.status === 'succeeded' && Array.isArray(job.result?.degradedStages) && job.result.degradedStages.includes('dietitian')) {
      return 'AI advice pending';
    }
    switch (job.status) {
      case 'queued': {
        const queue = JobStore.getAllJobs().filter(j => j.status === 'queued' || j.status === 'running');
        const myIndex = queue.findIndex(j => j.id === job.id);
        const ahead = myIndex > 0 ? myIndex : 0;
        return ahead > 0 ? `Waiting — ${ahead} ahead` : 'Waiting to start...';
      }
      case 'running':
      case 'processing':
        return job.statusMessage || (job.kind === 'medical' ? 'Analyzing medical data...' : 'Analyzing your meal...');
      case 'failed':
        return 'Analysis failed';
      case 'cancelled':
      case 'cancel_requested':
        return 'Analysis cancelled';
      case 'awaiting_user':
        return 'Action required';
      case 'succeeded':
        return 'Analysis completed';
      default:
        return 'Processing...';
    }
  };

  const getStatusColorClass = () => {
    if (job.status === 'succeeded' && Array.isArray(job.result?.degradedStages) && job.result.degradedStages.includes('dietitian')) {
      return 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700';
    }
    switch (job.status) {
      case 'queued':
        return 'text-slate-500 bg-slate-100 dark:bg-slate-900/60';
      case 'running':
      case 'processing':
        return 'text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40';
      case 'failed':
        return 'text-rose-600 bg-rose-50 dark:bg-rose-950/40';
      case 'cancelled':
      case 'cancel_requested':
        return 'text-amber-600 bg-amber-50 dark:bg-amber-950/40';
      case 'awaiting_user':
        return 'text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/60 font-bold border border-purple-300 dark:border-purple-700 animate-pulse';
      case 'succeeded':
        return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/40';
      default:
        return 'text-slate-500 bg-slate-100 dark:bg-slate-900/60';
    }
  };

  const pendingFoodLog =
    job.result?.pendingFoodLog ||
    job.result?.raw?.data ||
    job.result?.data ||
    job.messages?.find((m: any) => m.pendingFoodLog)?.pendingFoodLog ||
    job.messages?.find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog;

  const rawInputText = job.inputSnapshot?.text?.trim() || '';
  const displayTitle =
    job.status === 'awaiting_user'
      ? (pendingFoodLog?.name
          ? `${pendingFoodLog.name} — Portion Selection Needed`
          : job.result?.portionClarify?.promptMessage ||
            job.result?.clean_result?.portionClarify?.promptMessage ||
            (job as any).clean_result?.portionClarify?.promptMessage ||
            'Portion Choice Needed')
      : (pendingFoodLog?.name ||
        (rawInputText && rawInputText !== 'Analyze this meal photo.'
          ? rawInputText
          : job.kind === 'food_compare'
          ? 'Meal Comparison Request'
          : job.kind === 'medical'
          ? 'Medical Data Request'
          : 'Analyzing Meal Photo...'));

  return (
    <div className={`bg-theme-bg-card border rounded-3xl py-4 pl-0 pr-4 shadow-sm mx-0 mb-4 w-full transition-all hover:shadow-md overflow-hidden ${
      job.status === 'awaiting_user'
        ? 'border-purple-300 dark:border-purple-700 bg-purple-50/30 dark:bg-purple-950/20'
        : 'border-theme-border'
    }`}>
      <div className="flex gap-4">
        {/* Preview Image / Fallback Icon */}
        <div className="w-20 h-20 rounded-r-2xl overflow-hidden bg-slate-100 dark:bg-slate-900 flex-shrink-0 relative flex items-center justify-center border border-theme-border/50 border-l-0">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="Meal Preview"
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
              onError={() => setImageUrl(null)}
            />
          ) : (
            <div className="p-2 text-slate-400 font-mono text-[10px] text-center uppercase">
              No Image
            </div>
          )}
          {/* Progress / Action Overlay */}
          {(job.status === 'queued' || job.status === 'running' || job.status === 'processing') && (
            <div className="absolute inset-0 bg-slate-950/20 backdrop-blur-[1px] flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            </div>
          )}
          {job.status === 'awaiting_user' && (
            <div className="absolute inset-0 bg-purple-950/40 backdrop-blur-[1px] flex flex-col items-center justify-center p-1 text-center">
              <Sliders className="w-5 h-5 text-purple-200 animate-bounce mb-0.5" />
              <span className="text-[9px] font-bold text-white leading-tight">Pick Portion</span>
            </div>
          )}
        </div>

        {/* Content details */}
        <div className="flex-grow min-w-0 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${getStatusColorClass()}`}>
                {getStatusLabel()}
              </span>
              {(job.status === 'running' || job.status === 'queued' || job.status === 'processing') && job.progressPercent > 0 && (
                <span className="text-[10px] font-mono text-slate-400 font-bold">
                  {job.progressPercent}%
                </span>
              )}
            </div>

            <h4 className="text-sm font-bold text-theme-text-primary truncate">
              {displayTitle}
            </h4>

            {(job.status === 'running' || job.status === 'processing' || job.status === 'queued') && (
              <p className="text-xs text-theme-text-secondary font-medium mt-1">
                {job.statusMessage || 'Analyzing your meal...'}
              </p>
            )}
            
            {(job.status === 'running' || job.status === 'processing') && (
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-1 rounded-full overflow-hidden mt-1.5">
                <motion.div
                  className="bg-indigo-600 h-full rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${job.progressPercent || 20}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}

            {job.status === 'awaiting_user' && (
              <p className="text-xs text-purple-700 dark:text-purple-300 font-medium mt-1">
                👉 Please confirm portion size to finish logging your meal.
              </p>
            )}

            {job.status === 'failed' && (
              <p className="text-xs text-rose-500 font-medium line-clamp-2 mt-1">
                ⚠️ {job.error?.message || 'Something went wrong during the analysis.'}
              </p>
            )}

            {job.status === 'succeeded' && pendingFoodLog && (
              <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-theme-text-secondary">
                <span>🔥 {pendingFoodLog.nutrients?.calories || 0} kcal</span>
                <span>•</span>
                <span>💪 {pendingFoodLog.nutrients?.protein || 0}g protein</span>
                {pendingFoodLog.recommendation && (
                  <>
                    <span>•</span>
                    <span className="capitalize font-semibold text-emerald-600 dark:text-emerald-400">
                      {pendingFoodLog.recommendation}
                    </span>
                  </>
                )}
              </div>
            )}

            {(job.result?.mealBuild?.staleDietitianNarrative || (job as any).mealBuild?.staleDietitianNarrative) && (
              <div className="text-amber-700 dark:text-amber-400 text-xs mt-1 bg-amber-50 dark:bg-amber-950/40 px-2 py-1 rounded border border-amber-200 dark:border-amber-800">
                Macros updated — coaching may reflect a previous portion. Use Retry Advice to refresh.
              </div>
            )}

            {job.status === 'succeeded' && (job.result?.comparisonSet?.optionMeals || job.result?.comparison?.options || job.result?.comparison?.groups) && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                {(job.result?.comparisonSet?.optionMeals || job.result?.comparison?.options || job.result?.comparison?.groups || []).slice(0, 3).map((opt: any, idx: number) => (
                  <span key={idx} className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 px-2 py-0.5 rounded-lg border border-indigo-100 dark:border-indigo-900/50 text-[11px] font-medium">
                    {opt.groupName || opt.content?.name || opt.name || opt.title || `Option ${idx + 1}`}: {opt.nutrients?.calories || opt.calories || 0} kcal
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 mt-3 pt-2 border-t border-theme-border/40">
            {/* View / Select Portion Button */}
            {job.status === 'awaiting_user' ? (
              <button
                type="button"
                onClick={() => onView(job.id)}
                className="px-3.5 py-1.5 text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-xl shadow transition-all flex items-center gap-1.5 cursor-pointer animate-pulse"
              >
                <Sliders className="w-3.5 h-3.5" />
                Select Portion
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onView(job.id)}
                className="px-3 py-1.5 text-xs font-bold text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 rounded-xl transition-all flex items-center gap-1 cursor-pointer"
              >
                <Eye className="w-3.5 h-3.5" />
                {job.status === 'succeeded' ? 'View Result' : 'View Status'}
              </button>
            )}

            {/* Save Log Button for Succeeded Jobs */}
            {((job.status === 'succeeded' || job.result?.savable || job.result?.mealBuild?.savable || job.mealBuild?.savable) && !!pendingFoodLog) && (
              <button
                type="button"
                onClick={handleLocalSave}
                disabled={isSaving}
                className="px-3 py-1.5 text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-indigo-400 rounded-xl shadow-sm hover:shadow transition-all flex items-center gap-1 cursor-pointer disabled:cursor-not-allowed"
              >
                {isSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                {isSaving ? 'Saving...' : 'Save Log'}
              </button>
            )}

            {/* Retry Button for Failed or Cancelled Jobs */}
            {((job.status === 'failed' || job.status === 'cancelled' || job.status === 'cancel_requested') || (Array.isArray(job.result?.degradedStages) && job.result.degradedStages.includes('dietitian'))) && (
              <button
                type="button"
                onClick={() => {
                  const isDegraded = Array.isArray(job.result?.degradedStages) && job.result.degradedStages.includes('dietitian');
                  JobStore.updateJob(job.id, {
                    status: 'queued',
                    retryNotBefore: undefined,
                    error: undefined,
                    statusMessage: isDegraded ? 'Retrying AI advice...' : 'Retrying analysis...',
                    resumeStage: isDegraded ? 'dietitian' : undefined
                  });
                }}
                className={`px-3 py-1.5 text-xs font-bold rounded-xl transition-all flex items-center gap-1 cursor-pointer ${
                  (Array.isArray(job.result?.degradedStages) && job.result.degradedStages.includes('dietitian'))
                    ? 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20'
                    : 'text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/20'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                {(Array.isArray(job.result?.degradedStages) && job.result.degradedStages.includes('dietitian')) ? 'Retry Advice' : 'Retry'}
              </button>
            )}

            {/* Cancel Button for Active Jobs */}
            {(job.status === 'queued' || job.status === 'running' || job.status === 'processing' || job.status === 'awaiting_user') && (
              <button
                type="button"
                onClick={() => onCancel(job.id)}
                className="px-3 py-1.5 text-xs font-bold text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/20 rounded-xl transition-all flex items-center gap-1 cursor-pointer"
              >
                <XCircle className="w-3.5 h-3.5" />
                Cancel
              </button>
            )}

            {/* Delete (Trash) Button: Always available for all jobs */}
            <button
              type="button"
              onClick={() => onDelete(job.id)}
              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-full transition-all cursor-pointer"
              title="Delete task"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
