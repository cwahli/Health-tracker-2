export function setupErrorLogger() {
  window.addEventListener('error', (event) => {
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: event.message, stack: event.error?.stack })
    }).catch(() => {});
  });
  window.addEventListener('unhandledrejection', (event) => {
    fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: event.reason?.message || 'Unhandled Rejection', stack: event.reason?.stack })
    }).catch(() => {});
  });
}
