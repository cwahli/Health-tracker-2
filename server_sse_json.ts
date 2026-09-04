/**
 * SSE food/medical analyze: Express res.json after text/event-stream headers
 * must emit `data: {"final":true,"result":...}` or serverJobs never persistSucceeded.
 */
export function attachSseJsonResponder(res: {
  headersSent?: boolean;
  status?: (code: number) => any;
  write: (chunk: string) => any;
  end: () => any;
  flush?: () => void;
}): void {
  const originalStatus = typeof res.status === 'function' ? res.status.bind(res) : null;
  if (originalStatus) {
    res.status = (code: number) => {
      if (!res.headersSent) originalStatus(code);
      return res;
    };
  }
  (res as any).json = (body: any) => {
    res.write(`data: ${JSON.stringify({ final: true, result: body })}\n\n`);
    if (typeof res.flush === 'function') res.flush();
    res.end();
    return res;
  };
}

export function parseSseFinalResult(chunk: string): any | null {
  const line = String(chunk || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith('data: '));
  if (!line) return null;
  try {
    const parsed = JSON.parse(line.slice(6));
    if ((parsed.final === true || parsed.type === 'done') && parsed.result) return parsed.result;
  } catch {
    return null;
  }
  return null;
}
