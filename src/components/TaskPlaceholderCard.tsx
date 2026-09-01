import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, Trash2, XCircle, CheckCircle2, AlertTriangle, Eye, Save, RotateCcw, Sliders, HelpCircle } from 'lucide-react';
import { AgentJob, JobStatus } from '../jobs/types';
import { ImageStore } from '../jobs/ImageStore';
import { JobStore } from '../jobs/JobStore';
import { previewStatus, previewStatusLabel, isEditJob, isTurnInFlight } from '../jobs/jobPreview';
import { useJob } from '../hooks/useJob';
import { JobQueueRunner } from '../jobs/JobQueueRunner';
import { FoodLog } from '../types';
import { humanizeJobFailure } from '../utils/jobFailure';
import { isJobSafeToLeave } from '../jobs/jobUploadState';
import { toPendingFoodLog } from '../mealBuild/adapters';

interface TaskPlaceholderCardProps {
  job: AgentJob;
  onView: (jobId: string) => void;
  onDelete: (jobId: string) => void;
  onCancel: (jobId: string) => void;
  onSave: (foodLog: FoodLog) => void;
  profileLanguage?: string;
}

export default function TaskPlaceholderCard({
  job: jobProp,
  onView,
  onDelete,
  onCancel,
  onSave,
  profileLanguage = 'en'
}: TaskPlaceholderCardProps) {
  const live = useJob(jobProp.id).job;
  const job = live || jobProp;
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [nowTs, setNowTs] = useState(() => Date.now());

  // Tick once per second while this job is actively in-flight, so the
  // "elapsed" readout below stays live. Cleared automatically once the job
  // leaves an active state (effect re-runs and the old interval is cleared).
  useEffect(() => {
    const isActive = isTurnInFlight(job);
    if (!isActive) return;
    const interval = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [job.status, job.inFlightTurnAt, job.finishedAt]);

  const elapsedSeconds = job.createdAt ? Math.max(0, Math.floor((nowTs - new Date(job.createdAt).getTime()) / 1000)) : null;
  const elapsedLabel = elapsedSeconds !== null
    ? `${Math.floor(elapsedSeconds / 60)}:${String(elapsedSeconds % 60).padStart(2, '0')}`
    : null;
  const elapsedIsLong = (elapsedSeconds ?? 0) >= 180; // 3 minutes

  const handleLocalSave = async () => {
    if (!pendingFoodLog || isSaving) return;
    setIsSaving(true);
    
    // Create a deep copy of pendingFoodLog to avoid mutating state directly
    const logToSave = JSON.parse(JSON.stringify(pendingFoodLog));
    
    try {
      let finalImageUrl = '';
      let finalImageUrls: string[] = [];

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
          finalImageUrls = validUrls;
        }
      }

      // 2. FALLBACK: If ImageStore didn't yield a valid URL but we have an active, visible preview image or (job as any).photoUrl
      const remotePhoto =
        (job as any).photoUrl ||
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

      const remotePhotos = 
        job.result?.clean_result?.pendingFoodLog?.imageUrls ||
        job.result?.clean_result?.imageUrls ||
        job.result?.imageUrls ||
        (remotePhoto ? [remotePhoto] : []);

      if (remotePhotos.length > 0) {
        finalImageUrls = remotePhotos;
        finalImageUrl = remotePhotos[0];
      } else if (finalImageUrls.length === 0 && remotePhoto) {
        finalImageUrl = remotePhoto;
      }

      // Apply the resolved image URL(s) if found
      if (finalImageUrl) {
        logToSave.imageUrl = finalImageUrl;
        logToSave.imageUrls = finalImageUrls.length > 0 ? finalImageUrls : [finalImageUrl];
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
    job.result?.foodData ||
    job.result?.mealBuild?.content ||
    job.mealBuild?.content ||
    job.result?.foodData ||
          job.messages?.slice().reverse().find((m: any) => m.pendingFoodLog)?.pendingFoodLog ||
          job.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog;

        // 2. Direct photoUrl or pendingFoodLog.imageUrl / imageUrls
        const directPhoto =
          (job as any).photoUrl ||
          ((job as any).remotePhotos && (job as any).remotePhotos.length > 0 && (job as any).remotePhotos[0]) ||
          ((job as any).imageUrls && (job as any).imageUrls.length > 0 && (job as any).imageUrls[0]) ||
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
        const userMsgWithImg = job.messages?.slice().reverse().find(
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
  }, [job.id, (job as any).photoUrl, job.result, job.messages]);

  const lastMsgContent = (job.messages && job.messages.length > 0) ? job.messages[job.messages.length - 1]?.content : '';
  const pendingLog =
    job.result?.pendingFoodLog ||
    job.result?.raw?.data ||
    job.result?.data ||
    job.result?.foodData ||
    job.result?.mealBuild?.content ||
    job.mealBuild?.content ||
    job.messages?.slice().reverse().find((m: any) => m.pendingFoodLog)?.pendingFoodLog ||
    job.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog;

  const hasResults = !!(
    pendingLog?.name ||
    pendingLog?.foodName ||
    (pendingLog?.itemsBreakdown && pendingLog.itemsBreakdown.length > 0) ||
    (job.result?.scoutItems && job.result.scoutItems.length > 0) ||
    (job.mealBuild?.items && job.mealBuild.items.length > 0)
  );

  const turnInFlight = isTurnInFlight(job);
  const effectiveStatus: AgentJob['status'] = previewStatus(job);

  const isFailedOrTimedOut =
    effectiveStatus === 'failed' ||
    effectiveStatus === 'cancelled' ||
    effectiveStatus === 'cancel_requested' ||
    (effectiveStatus !== 'succeeded' && (
      !!job.error ||
      (typeof job.statusMessage === 'string' && /(?:timed out|analysis failed|server error)/i.test(job.statusMessage) && !/analysis complete/i.test(job.statusMessage)) ||
      (typeof job.result?.message === 'string' && /(?:timed out|analysis failed)/i.test(job.result.message)) ||
      (typeof job.result?.error === 'string' && !!job.result.error) ||
      (typeof lastMsgContent === 'string' && /(?:timed out|analysis failed|server error)/i.test(lastMsgContent) && !job.result?.pendingFoodLog && !job.result?.modificationCommand && !job.result?.extractedData)
    ));

  const isEditMode = isEditJob(job);

  const getStatusLabel = () => {
    const queue = JobStore.getAllJobs().filter(j => j.status === 'queued' || j.status === 'running');
    const myIndex = queue.findIndex(j => j.id === job.id);
    const ahead = myIndex > 0 ? myIndex : 0;
    return previewStatusLabel(job, { queuedAhead: ahead, lastMsgContent });
  };

  const getStatusColorClass = () => {
    if (effectiveStatus === 'succeeded' && Array.isArray(job.result?.degradedStages) && job.result.degradedStages.includes('dietitian')) {
      return 'text-amber-600 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700';
    }
    if (isFailedOrTimedOut) {
      return 'text-rose-600 bg-rose-50 dark:bg-rose-950/40';
    }
    const statusKey = effectiveStatus as JobStatus;
    switch (statusKey) {
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
    (job.result?.mealBuild ? toPendingFoodLog(job.result.mealBuild) : null) ||
    job.result?.clean_result?.pendingFoodLog ||
    (job.result?.clean_result?.mealBuild ? toPendingFoodLog(job.result.clean_result.mealBuild) : null) ||
    job.result?.clean_result?.data ||
    (job.mealBuild ? toPendingFoodLog(job.mealBuild) : null) ||
    job.result?.raw?.data ||
    job.result?.data ||
    job.result?.foodData ||
    job.messages?.slice().reverse().find((m: any) => m.pendingFoodLog)?.pendingFoodLog ||
    job.messages?.slice().reverse().find((m: any) => m.data?.pendingFoodLog)?.data?.pendingFoodLog ||
    (job as any).clean_result?.pendingFoodLog ||
    (job as any).clean_result?.data;

  const extractMealName = (): string | null => {
    if (job.result?.clean_result?.foodData?.name && job.result.clean_result.foodData.name !== 'Meal') return job.result.clean_result.foodData.name;
    if (job.result?.foodData?.name && job.result.foodData.name !== 'Meal') return job.result.foodData.name;
    if (job.result?.mealBuild?.content?.name && job.result.mealBuild.content.name !== 'Meal') return job.result.mealBuild.content.name;
    if (job.result?.clean_result?.mealBuild?.content?.name && job.result.clean_result.mealBuild.content.name !== 'Meal') return job.result.clean_result.mealBuild.content.name;
    if (pendingFoodLog?.name && pendingFoodLog.name !== 'Meal') return pendingFoodLog.name;
    if (pendingFoodLog?.title && pendingFoodLog.title !== 'Meal') return pendingFoodLog.title;
    if (pendingFoodLog?.content?.name && pendingFoodLog.content.name !== 'Meal') return pendingFoodLog.content.name;
    if (job.mealBuild?.content?.name && job.mealBuild.content.name !== 'Meal') return job.mealBuild.content.name;
    if (job.result?.data?.name && job.result.data.name !== 'Meal') return job.result.data.name;

    const items =
      job.result?.itemsBreakdown ||
      job.result?.clean_result?.itemsBreakdown ||
      job.result?.foodData?.itemsBreakdown ||
      job.result?.mealBuild?.items ||
      job.result?.clean_result?.mealBuild?.items ||
      pendingFoodLog?.itemsBreakdown ||
      pendingFoodLog?.items ||
      job.result?.items ||
      job.result?.scoutItems ||
      job.result?.clean_result?.scoutItems ||
      job.mealBuild?.items ||
      (job as any).scoutItems ||
      (job as any).clean_result?.scoutItems;

    if (Array.isArray(items) && items.length > 0) {
      const names = items
        .map((it: any) => typeof it === 'string' ? it : (it?.name || it?.originalName || it?.keyword || it?.canonicalDbName))
        .filter(Boolean);
      if (names.length > 0) {
        return names.join(', ');
      }
    }

    const textContent = job.result?.text || job.result?.message || job.result?.clean_result?.text || job.result?.clean_result?.message;
    if (typeof textContent === 'string') {
      const boldMatch = textContent.match(/\*\*([^*]+)\*\*/);
      if (boldMatch && boldMatch[1]) {
        return boldMatch[1].trim();
      }
    }

    return null;
  };

  const detectedName = extractMealName();
  const rawInputText = job.inputSnapshot?.text?.trim() || '';
  const displayTitle =
    job.status === 'awaiting_user'
      ? (detectedName
          ? `${detectedName} — Portion Selection Needed`
          : job.result?.portionClarify?.promptMessage ||
            job.result?.clean_result?.portionClarify?.promptMessage ||
            (job as any).clean_result?.portionClarify?.promptMessage ||
            'Portion Choice Needed')
      : (detectedName ||
        (rawInputText && rawInputText !== 'Analyze this meal photo.'
          ? rawInputText
          : job.kind === 'food_compare'
          ? 'Meal Comparison Request'
          : job.kind === 'medical'
          ? 'Medical Data Request'
          : (job.status === 'succeeded' ? 'Meal Analysis Complete' : job.status === 'failed' ? 'Analysis failed' : 'Analyzing Meal Photo...')));

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
          {(effectiveStatus === 'queued' || effectiveStatus === 'running' || effectiveStatus === 'processing') && (
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
              {!isEditMode && effectiveStatus !== 'running' && effectiveStatus !== 'processing' && (
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                  Attempt {job.attemptCount || 1} of {job.maxAttempts || 3}
                </span>
              )}
              {(effectiveStatus === 'running' || effectiveStatus === 'queued' || effectiveStatus === 'processing') && job.progressPercent > 0 && (
                <span className="text-[10px] font-mono text-slate-400 font-bold">
                  {job.progressPercent}%
                </span>
              )}
            </div>

            <h4 className="text-sm font-bold text-theme-text-primary truncate">
              {displayTitle}
            </h4>

            {(effectiveStatus === 'running' || effectiveStatus === 'processing' || effectiveStatus === 'queued') && (
              <div className="mt-1 space-y-1">
                {job.statusMessage && !job.statusMessage.toLowerCase().includes('uploading to server') ? (
                  <p className="text-xs text-theme-text-secondary font-medium">
                    {job.statusMessage}
                  </p>
                ) : !job.statusMessage ? (
                  <p className="text-xs text-theme-text-secondary font-medium">
                    {job.kind === 'medical' ? 'Analyzing medical data...' : 'Analyzing your meal...'}
                  </p>
                ) : null}
                {isJobSafeToLeave(job) ? (
                  <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200/60 dark:border-emerald-800/60">
                    <CheckCircle2 className="w-3 h-3 text-emerald-500 flex-shrink-0" />
                    <span>Uploaded to server • Safe to close browser & check back later</span>
                  </div>
                ) : (
                  <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[10px] font-semibold border ${elapsedIsLong ? 'text-red-800 dark:text-red-200 bg-red-50 dark:bg-red-950/40 border-red-200/60 dark:border-red-800/60' : 'text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border-amber-200/60 dark:border-amber-800/60'}`}>
                    <AlertTriangle className={`w-3 h-3 flex-shrink-0 ${elapsedIsLong ? 'text-red-500' : 'text-amber-500'}`} />
                    <span>Uploading to server… Keep this tab open</span>
                  </div>
                )}
                {elapsedLabel && (
                  <div className={`text-[10px] font-mono ${elapsedIsLong ? 'text-red-500 font-bold' : 'text-slate-400'}`}>
                    {elapsedIsLong ? `Stuck for ${elapsedLabel} — this is longer than normal` : `${elapsedLabel} elapsed`}
                  </div>
                )}
              </div>
            )}
            
            {(effectiveStatus === 'running' || effectiveStatus === 'processing' || effectiveStatus === 'queued') && (
              <div className="w-full bg-slate-100 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden mt-1.5">
                <motion.div
                  className={`h-full rounded-full ${effectiveStatus === 'queued' ? 'bg-indigo-400 animate-pulse' : 'bg-indigo-600'}`}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(job.progressPercent || 0, effectiveStatus === 'queued' ? 10 : 20)}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}

            {job.status === 'awaiting_user' && (
              <p className="text-xs text-purple-700 dark:text-purple-300 font-medium mt-1">
                👉 Please confirm portion size to finish logging your meal.
              </p>
            )}

            {isFailedOrTimedOut && (() => {
              const raw =
                job.error?.message ||
                (job.statusMessage && !['Analyzing on server...', 'Analyzing your meal...'].includes(job.statusMessage) ? job.statusMessage : null) ||
                (typeof job.result?.message === 'string' && job.result.message ? job.result.message : null) ||
                (typeof lastMsgContent === 'string' ? lastMsgContent : '') ||
                '';
              const failureReason = humanizeJobFailure(raw);
              return (
                <div className="mt-1 space-y-1">
                  <p className="text-xs text-rose-600 dark:text-rose-400 font-medium line-clamp-4">
                    ⚠️ {failureReason}
                  </p>
                  <p className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                    Attempt {job.attemptCount || 1} of {job.maxAttempts || 3} failed • Tap "Retry" to try again
                  </p>
                </div>
              );
            })()}

            {effectiveStatus === 'succeeded' && pendingFoodLog && (
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

            {/* Comparison Options Summary Row with Calories */}
            {(() => {
              const compGroups = job.result?.comparisonSet?.optionMeals || job.result?.comparison?.options || job.result?.comparison?.groups || job.result?.clean_result?.comparison?.groups || (job as any).clean_result?.comparison?.groups;
              const scoutItems =
                job.result?.itemsBreakdown ||
                job.result?.clean_result?.itemsBreakdown ||
                job.result?.foodData?.itemsBreakdown ||
                job.result?.mealBuild?.items ||
                job.result?.clean_result?.mealBuild?.items ||
                pendingFoodLog?.itemsBreakdown ||
                pendingFoodLog?.items ||
                job.result?.items ||
                job.result?.meal?.items ||
                job.result?.scoutItems ||
                job.result?.clean_result?.scoutItems ||
                (job as any).scoutItems;

              if (compGroups && Array.isArray(compGroups) && compGroups.length > 0) {
                return (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    {compGroups.map((opt: any, idx: number) => {
                      const name = opt.groupName || opt.content?.name || opt.name || opt.title || `Option ${idx + 1}`;
                      let numericCals = NaN;
                      const directCal = opt.averageNutrients?.calories ?? opt.nutrients?.calories ?? opt.calories ?? opt.totalCalories;
                      if (directCal != null) {
                        const parsed = parseFloat(String(directCal).replace(/[^\d.]/g, ''));
                        if (!isNaN(parsed) && parsed > 0) numericCals = parsed;
                      }
                      if (isNaN(numericCals) && (opt.averageNutrients || opt.nutrients)) {
                        const n = opt.averageNutrients || opt.nutrients;
                        const p = Number(n.protein) || 0;
                        const c = Number(n.carbohydrates ?? n.carbs) || 0;
                        const f = Number(n.totalFat ?? n.fat) || 0;
                        const macroSum = Math.round(4 * p + 4 * c + 9 * f);
                        if (macroSum > 0) numericCals = macroSum;
                      }
                      return (
                        <span key={idx} className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-lg border border-indigo-100 dark:border-indigo-900/50 text-[11px] font-semibold flex items-center gap-1">
                          <span>{name}:</span>
                          <span className="font-bold text-indigo-800 dark:text-indigo-200">{!isNaN(numericCals) && numericCals > 0 ? `${Math.round(numericCals)} kcal` : 'Calculating...'}</span>
                        </span>
                      );
                    })}
                  </div>
                );
              } else if (effectiveStatus === 'succeeded' && scoutItems && Array.isArray(scoutItems) && scoutItems.length > 1) {
                return (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                    {scoutItems.map((item: any, idx: number) => {
                      const name = item.canonicalDbName || item.originalName || item.name || item.keyword || `Option ${idx + 1}`;
                      let numericCals = NaN;
                      const directCal = item.nutrients?.calories ?? item.calories ?? item.estimatedCalories ?? item.rawNutritionLabel?.calories ?? item.preCalcNutrients?.calories;
                      if (directCal != null) {
                        const parsed = parseFloat(String(directCal).replace(/[^\d.]/g, ''));
                        if (!isNaN(parsed)) numericCals = parsed;
                      }
                      if (isNaN(numericCals) && item.nutrients) {
                        const p = Number(item.nutrients.protein) || 0;
                        const c = Number(item.nutrients.carbohydrates ?? item.nutrients.carbs) || 0;
                        const f = Number(item.nutrients.totalFat ?? item.nutrients.fat) || 0;
                        const macroSum = Math.round(4 * p + 4 * c + 9 * f);
                        if (macroSum >= 0) numericCals = macroSum;
                      }
                      return (
                        <span key={idx} className="bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 px-2 py-1 rounded-lg border border-indigo-100 dark:border-indigo-900/50 text-[11px] font-semibold flex items-center gap-1">
                          <span>{name}:</span>
                          <span className="font-bold text-indigo-800 dark:text-indigo-200">{!isNaN(numericCals) && numericCals >= 0 ? `${Math.round(numericCals)} kcal` : 'Calculating...'}</span>
                        </span>
                      );
                    })}
                  </div>
                );
              }
              return null;
            })()}
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
                {effectiveStatus === 'succeeded' && !isFailedOrTimedOut ? 'View Analysis' : 'View Status'}
              </button>
            )}

            {/* Save Log Button for Succeeded Jobs */}
            {effectiveStatus === 'succeeded' && !isFailedOrTimedOut && ((job.status === 'succeeded') || job.result?.savable || job.result?.mealBuild?.savable || job.mealBuild?.savable) && !!pendingFoodLog && (
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

            {/* Retry Button for Failed, Cancelled, or Timed-out Jobs */}
            {(isFailedOrTimedOut || job.status === 'failed' || job.status === 'cancelled' || job.status === 'cancel_requested' || (Array.isArray(job.result?.degradedStages) && job.result.degradedStages.includes('dietitian'))) && (
              <button
                type="button"
                onClick={() => {
                  const isDegraded = Array.isArray(job.result?.degradedStages) && job.result.degradedStages.includes('dietitian');
                  const nextAttempt = (job.attemptCount || 1) + 1;
                  JobStore.updateJob(job.id, {
                    status: 'queued',
                    attemptCount: nextAttempt,
                    retryNotBefore: undefined,
                    error: undefined,
                    clientSubmitPending: false,
                    statusMessage: isDegraded ? `Retrying AI advice (Attempt ${nextAttempt})...` : `Retrying analysis (Attempt ${nextAttempt})...`,
                    resumeStage: isDegraded ? 'dietitian' : undefined
                  });
                  JobQueueRunner.wake();
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

            {/* Delete (Trash) Button: Always available for all jobs to cancel/discard */}
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
