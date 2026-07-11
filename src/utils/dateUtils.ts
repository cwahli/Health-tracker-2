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

  // Sort chronologically to ensure consistency when merging/deduplicating
  const sorted = [...history].sort((a, b) => {
    const toYmd = (d: string) => {
      const pts = d.split('-');
      if (pts.length === 3) {
        // If it looks like dd-mm-yyyy or yyyy-mm-dd
        if (pts[0].length === 4) return d;
        return `${pts[2]}-${pts[1]}-${pts[0]}`;
      }
      return d;
    };
    return toYmd(a.date).localeCompare(toYmd(b.date));
  });

  for (const log of sorted) {
    const normalizedDate = formatToDDMMYYYY(log.date);
    if (seenDates.has(normalizedDate)) {
      // Merge biomarkers, notes, and summaries
      const existing = seenDates.get(normalizedDate)!;
      existing.biomarkers = {
        ...existing.biomarkers,
        ...log.biomarkers
      };
      if (log.note) {
        existing.note = existing.note ? `${existing.note}; ${log.note}` : log.note;
      }
      if (log.summary) {
        existing.summary = existing.summary ? `${existing.summary}; ${log.summary}` : log.summary;
      }
    } else {
      const copy = {
        ...log,
        date: normalizedDate
      };
      seenDates.set(normalizedDate, copy);
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

export function toYYYYMMDD(dateStr: string): string {
  if (!dateStr) return '';
  const trimmed = dateStr.trim();
  
  // 1. If already YYYY-MM-DD (e.g. 2026-07-04)
  const yyyymmddMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (yyyymmddMatch) {
    const year = yyyymmddMatch[1];
    const month = yyyymmddMatch[2].padStart(2, '0');
    const day = yyyymmddMatch[3].padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  // 2. If DD-MM-YYYY (e.g. 04-07-2026)
  const ddmmyyyyMatch = trimmed.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (ddmmyyyyMatch) {
    const day = ddmmyyyyMatch[1].padStart(2, '0');
    const month = ddmmyyyyMatch[2].padStart(2, '0');
    const year = ddmmyyyyMatch[3];
    return `${year}-${month}-${day}`;
  }

  // Fallback: try parsing with Date
  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      const year = String(d.getUTCFullYear());
      const month = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }
  } catch (e) {}

  return trimmed;
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

