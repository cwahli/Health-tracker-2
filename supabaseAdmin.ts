import 'dotenv/config';
import WebSocket from 'ws';

if (typeof globalThis.WebSocket === 'undefined') {
  (globalThis as any).WebSocket = WebSocket;
}

import { createClient } from '@supabase/supabase-js';

const rawUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseUrl = rawUrl.replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || 'placeholder-key';

export const isSupabaseConfigured = Boolean(
  supabaseUrl && 
  !supabaseUrl.includes('placeholder.supabase.co') && 
  supabaseServiceRoleKey && 
  supabaseServiceRoleKey !== 'placeholder-key'
);

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

