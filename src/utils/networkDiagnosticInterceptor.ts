/**
 * Global Network Diagnostic Interceptor
 * Intercepts window.fetch calls to record network latency, HTTP errors, drops, and status codes.
 */

import { recordBreadcrumb } from './breadcrumbTracker';

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
