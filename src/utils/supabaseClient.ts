import { createClient, SupabaseClient } from '@supabase/supabase-js';

const getEnvVar = (name: string): string => {
  if (typeof process !== 'undefined' && process.env && process.env[name]) {
    return process.env[name] as string;
  }
  return '';
};

// Cloudflare D1 & R2 are the primary database and storage infrastructure.
// Supabase direct browser client is disabled to prevent egress quota errors.
export const isSupabaseConfigured: boolean = false;

export const supabase: SupabaseClient | null = null;

export const getAuthRedirectTo = (): string => {
  if (typeof window === 'undefined') return '';
  return `${window.location.origin}${window.location.pathname}`;
};

export const cleanupAuthUrlParams = (): void => {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('access_token') || url.searchParams.has('refresh_token') || url.hash.includes('access_token=')) {
      url.searchParams.delete('access_token');
      url.searchParams.delete('refresh_token');
      url.searchParams.delete('expires_in');
      url.searchParams.delete('token_type');
      url.searchParams.delete('type');
      url.hash = '';
      window.history.replaceState({}, document.title, url.toString());
    }
  } catch (err) {
    console.warn('[supabaseClient] Failed to cleanup auth URL params:', err);
  }
};
