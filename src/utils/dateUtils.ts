import { getMappedBiomarkerKey } from './biomarkers';

export function dedupeDelimitedText(existingText: string | undefined, newText: string | undefined, separator: string = '; '): string {
  const parts: string[] = [];
  if (existingText) {
    parts.push(...existingText.split(/[;|\n]/).map(s => s.trim()).filter(Boolean));
  }
  if (newText) {
    parts.push(...newText.split(/[;|\n]/).map(s => s.trim()).filter(Boolean));
  }
  const unique = Array.from(new Set(parts));
  return unique.join(separator);
}

export const getCurrentDateInTimezone = (timezone?: string): string => {
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    // output format: YYYY-MM-DD
    return formatter.format(new Date());
  } catch (e) {
    console.error("Invalid timezone:", tz, e);
    return new Date().toISOString().split('T')[0];
  }
};

export function formatToDDMMYYYY(dateStr: string): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  
  // 1. Check if already DD-MM-YYYY (e.g. 02-04-2024)
  const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (ddmmyyyyMatch) {
    const day = ddmmyyyyMatch[1].padStart(2, '0');
    const month = ddmmyyyyMatch[2].padStart(2, '0');
    const year = ddmmyyyyMatch[3];
    return `${day}-${month}-${year}`;
  }

  // 2. Check YYYY-MM-DD (e.g. 2026-06-01)
  const yyyymmddMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (yyyymmddMatch) {
    const year = yyyymmddMatch[1];
    const month = yyyymmddMatch[2].padStart(2, '0');
    const day = yyyymmddMatch[3].padStart(2, '0');
    return `${day}-${month}-${year}`;
  }

  // 3. Check DD-MMM-YYYY (e.g. 02-Apr-2024 or 02-April-2024)
  const ddMmmYyyyMatch = trimmed.match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})$/);
  if (ddMmmYyyyMatch) {
    const day = ddMmmYyyyMatch[1].padStart(2, '0');
    const monthStr = ddMmmYyyyMatch[2].toLowerCase();
    const year = ddMmmYyyyMatch[3];
    
    const months: { [key: string]: string } = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
      january: '01', february: '02', march: '03', april: '04', june: '06',
      july: '07', august: '08', september: '09', october: '10', november: '11', december: '12'
    };
    const month = months[monthStr] || '01';
    return `${day}-${month}-${year}`;
  }

  // Fallback: try parsing with Date
  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      const day = String(d.getUTCDate()).padStart(2, '0');
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const year = String(d.getUTCFullYear());
      return `${day}-${month}-${year}`;
    }
  } catch (e) {}

  return trimmed;
}

export interface MinimalBiomarkerLog {
  id: string;
  date: string;
  biomarkers: { [key: string]: any };
  note?: string;
  summary?: string;
}

export function normalizeBiomarkerHistory<T extends MinimalBiomarkerLog>(history: T[]): T[] {
  const seenDates = new Map<string, T>();
  const results: T[] = [];

  const toYmd = (d: any) => {
    if (!d) return '';
    const str = String(d).trim();
    if (!str) return '';
    const pts = str.split('-');
    if (pts.length === 3) {
      // If it looks like dd-mm-yyyy or yyyy-mm-dd
      if (pts[0].length === 4) return str;
      return `${pts[2]}-${pts[1]}-${pts[0]}`;
    }
    return str;
  };

  // Sort chronologically to ensure consistency when merging/deduplicating
  const sorted = [...(history || [])].filter(Boolean).sort((a, b) => {
    return toYmd(a?.date).localeCompare(toYmd(b?.date));
  });

  for (const log of sorted) {
    if (!log) continue;
    const rawDate = log.date || new Date().toISOString().split('T')[0];
    const normalizedDate = formatToDDMMYYYY(rawDate);
    const reportId = (log as any).sourceReportId;
    // Only merge rows that share an explicit, matching sourceReportId.
    // Do NOT fall back to date-only merging: rows without a sourceReportId
    // (the vast majority of historical data) may be genuinely distinct
    // Supabase rows for the same date, and silently collapsing them here
    // hides real duplicate data from the UI, which makes it impossible to
    // review or delete — this was causing "deleted" outlier biomarkers to
    // silently reappear from a hidden duplicate row on the next sync.
    const sourceKey = reportId ? `${normalizedDate}::${reportId}` : null;

    if (sourceKey && seenDates.has(sourceKey)) {
      // Same calendar day AND same source extract: merge keys (last write wins, never average).
      const existing = seenDates.get(sourceKey)!;
      
      const newBiomarkers = { ...existing.biomarkers };
      Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
        newBiomarkers[getMappedBiomarkerKey(k)] = v;
      });
      existing.biomarkers = newBiomarkers;

      if (log.note) {
        existing.note = dedupeDelimitedText(existing.note, log.note, '; ');
      }
      if (log.summary) {
        existing.summary = dedupeDelimitedText(existing.summary, log.summary, '; ');
      }
    } else {
      const mappedBiomarkers: Record<string, any> = {};
      Object.entries(log.biomarkers || {}).forEach(([k, v]) => {
        mappedBiomarkers[getMappedBiomarkerKey(k)] = v;
      });
      const copy = {
        ...log,
        date: normalizedDate,
        biomarkers: mappedBiomarkers,
        note: log.note ? dedupeDelimitedText('', log.note, '; ') : log.note,
        summary: log.summary ? dedupeDelimitedText('', log.summary, '; ') : log.summary
      };
      
      if (sourceKey) seenDates.set(sourceKey, copy);
      results.push(copy);
    }
  }

  // Sort reverse-chronologically so newest logs are first
  return results.sort((a, b) => {
    const toYmd = (d: string) => {
      const pts = d.split('-');
      if (pts.length === 3) {
        if (pts[0].length === 4) return d;
        return `${pts[2]}-${pts[1]}-${pts[0]}`;
      }
      return d;
    };
    return toYmd(b.date).localeCompare(toYmd(a.date));
  });
}

export function toYYYYMMDD(dateStr: string | undefined | null): string {
  if (!dateStr) return new Date().toISOString().split('T')[0];
  const trimmed = String(dateStr).trim();
  if (!trimmed) return new Date().toISOString().split('T')[0];

  // 1. Check YYYY-MM-DD
  const yyyymmddMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (yyyymmddMatch) {
    const year = yyyymmddMatch[1];
    const month = yyyymmddMatch[2].padStart(2, '0');
    const day = yyyymmddMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 2. Check DD-MM-YYYY
  const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})/);
  if (ddmmyyyyMatch) {
    const day = ddmmyyyyMatch[1].padStart(2, '0');
    const month = ddmmyyyyMatch[2].padStart(2, '0');
    const year = ddmmyyyyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // 3. Fallback to formatToDDMMYYYY
  const ddmmyyyy = formatToDDMMYYYY(trimmed);
  const match = ddmmyyyy.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (match) {
    const day = match[1].padStart(2, '0');
    const month = match[2].padStart(2, '0');
    const year = match[3];
    return `${year}-${month}-${day}`;
  }

  // 4. Try JS Date parser
  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return d.toISOString().split('T')[0];
    }
  } catch {}

  return new Date().toISOString().split('T')[0];
}

export function extractMostRecentImageDate(imageDates?: any[]): string | null {
  if (!imageDates || !Array.isArray(imageDates) || imageDates.length === 0) {
    return null;
  }
  let maxTime = -Infinity;
  let bestDateStr: string | null = null;

  for (const raw of imageDates) {
    if (!raw) continue;
    let parsedTime = NaN;
    let ymdCandidate: string | null = null;

    if (typeof raw === 'number' && !isNaN(raw)) {
      parsedTime = raw;
      const d = new Date(raw);
      if (!isNaN(d.getTime())) {
        const yr = d.getFullYear();
        const mo = String(d.getMonth() + 1).padStart(2, '0');
        const dy = String(d.getDate()).padStart(2, '0');
        ymdCandidate = `${yr}-${mo}-${dy}`;
      }
    } else if (typeof raw === 'string') {
      const str = raw.trim();
      // Handle EXIF format "YYYY:MM:DD HH:MM:SS"
      const exifMatch = str.match(/^(\d{4}):(\d{2}):(\d{2})/);
      if (exifMatch) {
        ymdCandidate = `${exifMatch[1]}-${exifMatch[2]}-${exifMatch[3]}`;
        const d = new Date(`${ymdCandidate}T12:00:00Z`);
        parsedTime = d.getTime();
      } else {
        const d = new Date(str);
        if (!isNaN(d.getTime())) {
          parsedTime = d.getTime();
          const yr = d.getFullYear();
          const mo = String(d.getMonth() + 1).padStart(2, '0');
          const dy = String(d.getDate()).padStart(2, '0');
          ymdCandidate = `${yr}-${mo}-${dy}`;
        }
      }
    } else if (raw instanceof Date && !isNaN(raw.getTime())) {
      parsedTime = raw.getTime();
      const yr = raw.getFullYear();
      const mo = String(raw.getMonth() + 1).padStart(2, '0');
      const dy = String(raw.getDate()).padStart(2, '0');
      ymdCandidate = `${yr}-${mo}-${dy}`;
    }

    if (!isNaN(parsedTime) && ymdCandidate && parsedTime > maxTime) {
      maxTime = parsedTime;
      bestDateStr = ymdCandidate;
    }
  }

  return bestDateStr;
}

export function formatTimelineDate(dateStr: string): string {
  if (!dateStr) return '';
  const ymd = toYYYYMMDD(dateStr);
  const parts = ymd.split('-');
  if (parts.length === 3) {
    const month = parts[1];
    const day = parts[2];
    return `${day}-${month}`;
  }
  return dateStr;
}

