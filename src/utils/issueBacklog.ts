export type IssueType =
  | 'incorrect_answer'
  | 'wrong_item'
  | 'missing_link'
  | 'link_unfetchable'
  | 'low_confidence'
  | 'other';

export type IssueStatus = 'to_fix' | 'in_progress' | 'fixed' | 'ignored';

export const ISSUE_TYPE_LABELS: Record<IssueType, string> = {
  incorrect_answer: 'Incorrect answer / nutrients',
  wrong_item: 'Wrong food or dish matched',
  missing_link: 'Missing official menu / nutrition link',
  link_unfetchable: 'Link exists but could not be fetched/parsed',
  low_confidence: 'Low confidence result',
  other: 'Other',
};

export type BugCategory = 'foodcart' | 'biomarker' | 'database' | 'Home' | 'Other';

export interface FlagIssueRequest {
  issue_type: IssueType;
  custom_issue_type?: string;
  category?: BugCategory;
  tag_id?: string;
  severity?: 'low' | 'medium' | 'high';
  country_code?: string;
  chain_key?: string;
  dish_query?: string;
  context?: string;
  source_url?: string;
  user_note?: string;
  firebase_uid?: string;
  payload: Record<string, unknown>;
  /** If user pastes a better brand menu URL, also register it */
  register_source_url?: string;
  register_display_name?: string;
  register_source_kind?: string;
}

export interface FlagIssueResponse {
  success: boolean;
  id?: string;
  status?: IssueStatus;
  error?: string;
}

const MAX_PAYLOAD_CHARS = 900_000;

/** Cap payload size so Supabase jsonb stays healthy (strip huge base64 images). */
export function sanitizeIssuePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const clone: Record<string, unknown> = { ...payload };

  const stripImages = (obj: any): any => {
    if (obj == null) return obj;
    if (typeof obj === 'string') {
      if (obj.startsWith('data:image') && obj.length > 500) {
        return `[omitted_base64_image length=${obj.length}]`;
      }
      if (obj.length > 200_000) return obj.slice(0, 200_000) + '\n…[truncated]';
      return obj;
    }
    if (Array.isArray(obj)) return obj.map(stripImages);
    if (typeof obj === 'object') {
      const out: any = {};
      for (const [k, v] of Object.entries(obj)) {
        if (/image|photo|base64|thumbnail/i.test(k) && typeof v === 'string' && v.length > 500) {
          out[k] = `[omitted ${k} length=${v.length}]`;
        } else if (Array.isArray(v) && /image/i.test(k)) {
          out[k] = { count: v.length, note: 'image array omitted' };
        } else {
          out[k] = stripImages(v);
        }
      }
      return out;
    }
    return obj;
  };

  let cleaned = stripImages(clone);
  let json = JSON.stringify(cleaned);
  if (json.length > MAX_PAYLOAD_CHARS) {
    if (cleaned.debugLogText && typeof cleaned.debugLogText === 'string') {
      cleaned = {
        ...cleaned,
        debugLogText: (cleaned.debugLogText as string).slice(-Math.floor(MAX_PAYLOAD_CHARS * 0.6)),
        debugLogTruncated: true,
      };
    }
    json = JSON.stringify(cleaned);
    if (json.length > MAX_PAYLOAD_CHARS) {
      cleaned = {
        summary: 'payload_truncated',
        keys: Object.keys(clone),
        debugLogText: typeof clone.debugLogText === 'string'
          ? (clone.debugLogText as string).slice(-100_000)
          : undefined,
        answerPreview: clone.answer
          ? JSON.stringify(clone.answer).slice(0, 50_000)
          : undefined,
      };
    }
  }
  return cleaned as Record<string, unknown>;
}

export async function flagIssueToServer(
  body: FlagIssueRequest,
  sessionId?: string
): Promise<FlagIssueResponse> {
  try {
    const res = await fetch('/api/issues/flag', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionId ? { 'X-Session-ID': sessionId } : {}),
      },
      body: JSON.stringify({
        ...body,
        payload: sanitizeIssuePayload(body.payload || {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { success: false, error: data.error || `HTTP ${res.status}` };
    }
    return {
      success: true,
      id: data.id,
      status: data.status || 'to_fix',
    };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Network error' };
  }
}

/** Heuristic brand key from dish / meal name for backlog + registry. */
export function guessChainKey(text?: string | null): string | undefined {
  if (!text) return undefined;
  const t = text.toLowerCase();
  const map: [RegExp, string][] = [
    [/\byolk\b/, 'yolk'],
    [/mcdonald|maccas|麦当劳/, 'mcdonalds'],
    [/\bkfc\b|kentucky/, 'kfc'],
    [/coco\s*di\s*mama|cocodimama/, 'coco_di_mama'],
    [/\bcosta\b/, 'costa'],
    [/\bwasabi\b/, 'wasabi'],
    [/\bitsu\b/, 'itsu'],
    [/honi\s*poke|honipoke/, 'honi_poke'],
    [/\bpret\b/, 'pret'],
    [/starbucks/, 'starbucks'],
  ];
  for (const [re, key] of map) {
    if (re.test(t)) return key;
  }
  return undefined;
}
