import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initGlobalBreadcrumbListeners } from './utils/breadcrumbTracker';
import { initNetworkDiagnosticInterceptor } from './utils/networkDiagnosticInterceptor';

// Initialize global breadcrumb and network diagnostic tracking
initGlobalBreadcrumbListeners();
initNetworkDiagnosticInterceptor();

// Global diagnostic trackers
declare global {
  interface Window {
    __clientConsoleLogs?: string[];
    __clientNetworkErrors?: string[];
    __lastUserAction?: { action: string; prompt?: string; timestamp: string; details?: any };
  }
}

window.__clientConsoleLogs = window.__clientConsoleLogs || [];
window.__clientNetworkErrors = window.__clientNetworkErrors || [];

const origError = console.error;
const origWarn = console.warn;

console.error = (...args: any[]) => {
  try {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    if (window.__clientConsoleLogs) {
      window.__clientConsoleLogs.push(`[ERROR ${new Date().toISOString()}] ${msg}`);
      if (window.__clientConsoleLogs.length > 100) window.__clientConsoleLogs.shift();
    }
  } catch (_) {}
  origError.apply(console, args);
};

console.warn = (...args: any[]) => {
  try {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    if (window.__clientConsoleLogs) {
      window.__clientConsoleLogs.push(`[WARN ${new Date().toISOString()}] ${msg}`);
      if (window.__clientConsoleLogs.length > 100) window.__clientConsoleLogs.shift();
    }
  } catch (_) {}
  origWarn.apply(console, args);
};

window.addEventListener('unhandledrejection', (event) => {
  try {
    if (window.__clientConsoleLogs) {
      window.__clientConsoleLogs.push(`[UNHANDLED PROMISE ${new Date().toISOString()}] ${event.reason?.message || event.reason}`);
    }
  } catch (_) {}
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
