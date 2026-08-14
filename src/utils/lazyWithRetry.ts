import React from 'react';

/**
 * Wraps React.lazy with automatic reload/retry behavior when dynamic module imports fail
 * (e.g. after a dev server restart, build deployment, or stale asset hash in browser cache).
 */
export function lazyWithRetry<T extends React.ComponentType<any>>(
  componentImport: () => Promise<{ default: T }>
): React.LazyExoticComponent<T> {
  return React.lazy(async () => {
    const pageHasBeenReloadedKey = 'vite_dynamic_import_reloaded';
    try {
      const component = await componentImport();
      window.sessionStorage.removeItem(pageHasBeenReloadedKey);
      return component;
    } catch (error: any) {
      const isImportError =
        error?.message?.includes('Failed to fetch dynamically imported module') ||
        error?.message?.includes('Importing a module script failed') ||
        error?.name === 'TypeError';

      const hasReloaded = window.sessionStorage.getItem(pageHasBeenReloadedKey);

      if (isImportError && !hasReloaded) {
        window.sessionStorage.setItem(pageHasBeenReloadedKey, 'true');
        window.location.reload();
        return new Promise(() => {}); // Wait for page reload
      }

      window.sessionStorage.removeItem(pageHasBeenReloadedKey);
      throw error;
    }
  });
}
