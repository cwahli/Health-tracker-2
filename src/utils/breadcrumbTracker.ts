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
    if (window.__userActionBreadcrumbs.length > 50) {
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
