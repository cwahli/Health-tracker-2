/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';
import { getAuth } from 'firebase/auth';
import { getApp } from 'firebase/app';

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

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  accessToken: async () => {
    try { getApp(); } catch (e) { return null; }
    const user = getAuth().currentUser;
    if (!user) return null;
    return await user.getIdToken();
  }
});

