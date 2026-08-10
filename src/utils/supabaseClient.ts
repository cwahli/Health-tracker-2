/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js';
import { getAuth } from 'firebase/auth';
import { getApp } from 'firebase/app';

const rawUrl = (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_URL : undefined) || (typeof process !== 'undefined' && (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL)) || 'https://placeholder.supabase.co';
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const supabaseAnonKey = (typeof process !== 'undefined' ? process.env.VITE_SUPABASE_ANON_KEY : undefined) || (typeof process !== 'undefined' && (process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY)) || 'placeholder-key';

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

