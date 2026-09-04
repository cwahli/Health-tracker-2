/**
 * Global User Action Breadcrumb & Network Diagnostic Tracker
 * Captures user interactions, network responses, and console diagnostics.
 */

export interface UserActionBreadcrumb {
  timestamp: string;
  action: string;
  target?: string;
  details?: any;
}

declare global {
  interface Window {
    __userActionBreadcrumbs?: UserActionBreadcrumb[];
    __clientConsoleLogs?: string[];
    __clientNetworkErrors?: string[];
    __lastUserAction?: { action: string; prompt?: string; timestamp: string; details?: any };
  }
}

if (typeof window !== 'undefined') {
  window.__userActionBreadcrumbs = window.__userActionBreadcrumbs || [];
  window.__clientConsoleLogs = window.__clientConsoleLogs || [];
  window.__clientNetworkErrors = window.__clientNetworkErrors || [];
}

/** Record a user interaction breadcrumb */
export function recordBreadcrumb(action: string, target?: string, details?: any) {
  try {
    if (typeof window === 'undefined') return;
    window.__userActionBreadcrumbs = window.__userActionBreadcrumbs || [];
    const entry: UserActionBreadcrumb = {
      timestamp: new Date().toISOString(),
      action,
      target,
      details
    };
    window.__userActionBreadcrumbs.push(entry);
    if (window.__userActionBreadcrumbs.length > 100) {
      window.__userActionBreadcrumbs.shift();
    }
    const promptText = typeof details === 'string' ? details : (details?.prompt || details?.text || details?.label);
    window.__lastUserAction = {
      action,
      prompt: promptText,
      timestamp: entry.timestamp,
      details
    };
  } catch (_) {}
}

/** Clear the breadcrumb ring-buffer before a new chat turn so that
 *  per-turn logs are not contaminated by stale interactions from
 *  previous turns in a continuous session. */
export function clearBreadcrumbs() {
  try {
    if (typeof window === 'undefined') return;
    window.__userActionBreadcrumbs = [];
  } catch (_) {}
}

export function initNetworkDiagnosticInterceptor() {
  if (typeof window === 'undefined' || !(window as any).fetch) return;

  const originalFetch = window.fetch;

  const customFetch = async function (...args: Parameters<typeof fetch>) {
    const start = Date.now();
    let url = 'unknown';
    let method = 'GET';

    try {
      if (typeof args[0] === 'string') {
        url = args[0];
      } else if (args[0] instanceof Request) {
        url = args[0].url;
        method = args[0].method || 'GET';
      } else if (args[0] && typeof args[0] === 'object' && 'url' in args[0]) {
        url = String((args[0] as any).url);
      }

      if (args[1] && typeof args[1] === 'object' && args[1].method) {
        method = String(args[1].method).toUpperCase();
      }
    } catch (_) {}

    const cleanUrl = url.split('?')[0];

    try {
      const response = await originalFetch.apply(window, args);
      const duration = Date.now() - start;

      // Track non-2xx responses or API endpoints or slow requests (> 2500ms)
      if (!response.ok || duration > 2500 || cleanUrl.includes('/api/')) {
        const statusText = `[NET ${method} ${response.status}] ${cleanUrl} (${duration}ms)`;
        if (!response.ok) {
          window.__clientNetworkErrors = window.__clientNetworkErrors || [];
          window.__clientNetworkErrors.push(`[${new Date().toISOString()}] ${statusText} - ${response.statusText || 'HTTP Error'}`);
          if (window.__clientNetworkErrors.length > 50) window.__clientNetworkErrors.shift();
          recordBreadcrumb('network_error', cleanUrl, { status: response.status, duration, method });
        } else if (duration > 2500) {
          window.__clientNetworkErrors = window.__clientNetworkErrors || [];
          window.__clientNetworkErrors.push(`[${new Date().toISOString()}] [NET LATENCY WARNING ${method}] ${cleanUrl} (${duration}ms)`);
          if (window.__clientNetworkErrors.length > 50) window.__clientNetworkErrors.shift();
          recordBreadcrumb('network_slow', cleanUrl, { duration, method });
        }
      }

      return response;
    } catch (err: any) {
      const duration = Date.now() - start;
      const errMsg = err?.message || String(err);
      const isAbort = err?.name === 'AbortError' || errMsg.toLowerCase().includes('abort');
      const logMsg = `[${new Date().toISOString()}] [${isAbort ? 'NET ABORT' : 'NET DROP'} ${method}] ${cleanUrl} (${duration}ms) - ${errMsg}`;

      window.__clientNetworkErrors = window.__clientNetworkErrors || [];
      window.__clientNetworkErrors.push(logMsg);
      if (window.__clientNetworkErrors.length > 50) window.__clientNetworkErrors.shift();

      recordBreadcrumb(isAbort ? 'network_abort' : 'network_drop', cleanUrl, { error: errMsg, duration, method });
      throw err;
    }
  };

  try {
    Object.defineProperty(window, 'fetch', {
      value: customFetch,
      writable: true,
      configurable: true,
      enumerable: true
    });
  } catch (_e1) {
    try {
      (window as any).fetch = customFetch;
    } catch (e2) {
      console.warn('[NetworkInterceptor] Could not patch window.fetch:', e2);
    }
  }
}

/** Initialize automatic UI event listeners for breadcrumb tracking */
export function initGlobalBreadcrumbListeners() {
  if (typeof window === 'undefined') return;

  // Listen for clicks on buttons, links, inputs
  document.addEventListener('click', (e) => {
    try {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const btn = target.closest('button, a, input[type="button"], input[type="submit"], [role="button"], [data-action]');
      if (btn) {
        const label = btn.getAttribute('aria-label') ||
          (btn as HTMLElement).innerText?.slice(0, 40) ||
          btn.id ||
          btn.className?.slice(0, 30) ||
          'button';
        recordBreadcrumb('click', btn.tagName.toLowerCase(), { id: btn.id || undefined, label: label.trim() });
      }
    } catch (_) {}
  }, { capture: true, passive: true });

  // Listen for input changes in form fields
  document.addEventListener('change', (e) => {
    try {
      const target = e.target as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
      if (!target) return;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        const placeholder = 'placeholder' in target ? target.placeholder : '';
        const name = target.name || target.id || placeholder || 'input';
        recordBreadcrumb('input_change', target.tagName.toLowerCase(), { name, valueLength: target.value?.length || 0 });
      }
    } catch (_) {}
  }, { capture: true, passive: true });
}
