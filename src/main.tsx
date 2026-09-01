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

const isBenignError = (message?: string): boolean => {
  if (!message) return false;
  const msg = String(message).toLowerCase();
  return (
    msg.includes('websocket closed without opened') ||
    msg.includes('failed to connect to websocket') ||
    msg.includes('[vite] failed to connect') ||
    msg.includes('resizeobserver loop') ||
    msg.includes('aborterror') ||
    msg.includes('the user aborted a request') ||
    msg.includes('the operation was aborted')
  );
};

window.addEventListener('error', (e) => {
  try {
    const rawMsg = e.message || e.error?.message || '';
    if (isBenignError(rawMsg)) return;
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: rawMsg, stack: e.error?.stack })
    }).catch(() => null);
  } catch (err) {}
});
window.addEventListener('unhandledrejection', (e) => {
  try {
    const rawMsg = e.reason?.message || String(e.reason) || '';
    if (isBenignError(rawMsg)) return;
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: rawMsg, stack: e.reason?.stack })
    }).catch(() => null);
  } catch (err) {}
});
const origError = console.error;
const origWarn = console.warn;
const origLog = console.log;
const origInfo = console.info;

console.error = (...args: any[]) => {
  try {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    if (window.__clientConsoleLogs) {
      window.__clientConsoleLogs.push(`[ERROR ${new Date().toISOString()}] ${msg}`);
      if (window.__clientConsoleLogs.length > 200) window.__clientConsoleLogs.shift();
    }
  } catch (_) {}
  origError.apply(console, args);
};

console.warn = (...args: any[]) => {
  try {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    if (window.__clientConsoleLogs) {
      window.__clientConsoleLogs.push(`[WARN ${new Date().toISOString()}] ${msg}`);
      if (window.__clientConsoleLogs.length > 200) window.__clientConsoleLogs.shift();
    }
  } catch (_) {}
  origWarn.apply(console, args);
};

console.log = (...args: any[]) => {
  try {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    if (window.__clientConsoleLogs) {
      window.__clientConsoleLogs.push(`[LOG ${new Date().toISOString()}] ${msg}`);
      if (window.__clientConsoleLogs.length > 200) window.__clientConsoleLogs.shift();
    }
  } catch (_) {}
  origLog.apply(console, args);
};

console.info = (...args: any[]) => {
  try {
    const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    if (window.__clientConsoleLogs) {
      window.__clientConsoleLogs.push(`[INFO ${new Date().toISOString()}] ${msg}`);
      if (window.__clientConsoleLogs.length > 200) window.__clientConsoleLogs.shift();
    }
  } catch (_) {}
  origInfo.apply(console, args);
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
