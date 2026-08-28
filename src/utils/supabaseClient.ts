/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';

const getEnvVar = (key: string): string | undefined => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[key]) {
    return import.meta.env[key];
  }
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key];
  }
  return undefined;
};

const rawUrl = getEnvVar('VITE_SUPABASE_URL') || getEnvVar('SUPABASE_URL') || 'https://placeholder.supabase.co';
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const supabaseAnonKey = getEnvVar('VITE_SUPABASE_ANON_KEY') || getEnvVar('SUPABASE_ANON_KEY') || 'placeholder-key';

export const isSupabaseConfigured = Boolean(
  supabaseUrl && 
  !supabaseUrl.includes('placeholder.supabase.co') && 
  supabaseAnonKey && 
  supabaseAnonKey !== 'placeholder-key'
);

/**
 * Returns the exact origin of the running application (e.g. Cloud Run preview URL or localhost)
 * with no trailing path or slash, ensuring Supabase email confirmation, magic links, and OAuth
 * redirects return directly to the active environment instead of defaulting to Site URL (localhost).
 */
export const getAuthRedirectTo = (): string => {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost:3000';
};

/**
 * Cleans up Supabase token hashes and PKCE codes from the address bar after session exchange.
 */
export const cleanupAuthUrlParams = (): void => {
  if (typeof window === 'undefined') return;
  const hash = window.location.hash || '';
  const search = window.location.search || '';
  if (
    hash.includes('access_token=') ||
    hash.includes('refresh_token=') ||
    hash.includes('error_description=') ||
    search.includes('code=') ||
    search.includes('token_hash=') ||
    search.includes('type=') ||
    search.includes('error=')
  ) {
    const cleanUrl = window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);
  }
};

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});

