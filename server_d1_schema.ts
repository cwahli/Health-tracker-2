/**
 * Cloudflare D1 Database Schema Definitions & Initializer.
 * Provides SQLite DDL for Health-tracker tables.
 */
import { d1Exec, d1Query, isD1Configured } from './server_d1.js';

export const D1_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'review',
  status TEXT NOT NULL DEFAULT 'queued',
  progress_percent INTEGER DEFAULT 0,
  status_message TEXT,
  photo_url TEXT,
  debug_url TEXT,
  clean_result TEXT,
  current_turn INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_jobs_user_updated ON agent_jobs(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS food_logs (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL,
  date TEXT NOT NULL,
  name TEXT NOT NULL,
  composition TEXT DEFAULT '',
  weight_grams REAL DEFAULT 0,
  quantity TEXT DEFAULT '',
  consumed_amount REAL DEFAULT 1,
  benefits TEXT DEFAULT '',
  risks TEXT DEFAULT '',
  health_impact TEXT DEFAULT '',
  recommendation TEXT DEFAULT 'good',
  verdict TEXT,
  description TEXT DEFAULT '',
  message TEXT DEFAULT '',
  debug_url TEXT DEFAULT '',
  calories REAL DEFAULT 0,
  saturated_fat REAL DEFAULT 0,
  sodium REAL DEFAULT 0,
  added_sugar REAL DEFAULT 0,
  nutrients TEXT DEFAULT '{}',
  items_breakdown TEXT DEFAULT '[]',
  scout_items TEXT DEFAULT '[]',
  image_urls TEXT DEFAULT '[]',
  chat_transcript TEXT DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_food_logs_uid_updated ON food_logs(firebase_uid, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_food_logs_uid_date ON food_logs(firebase_uid, date DESC);

CREATE TABLE IF NOT EXISTS biomarker_logs (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL,
  date TEXT NOT NULL,
  biomarkers TEXT DEFAULT '{}',
  note TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  tests TEXT DEFAULT '[]',
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_biomarker_logs_uid_updated ON biomarker_logs(firebase_uid, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_biomarker_logs_uid_date ON biomarker_logs(firebase_uid, date DESC);

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  firebase_uid TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_profiles_uid ON profiles(firebase_uid);

CREATE TABLE IF NOT EXISTS issue_tags (
  id TEXT PRIMARY KEY,
  title TEXT,
  status TEXT DEFAULT 'open',
  comments TEXT,
  work_item TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_backlog (
  id TEXT PRIMARY KEY,
  tag_id TEXT,
  payload TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS issue_tag_links (
  id TEXT PRIMARY KEY,
  tag_id TEXT,
  backlog_id TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  nickname TEXT DEFAULT '',
  user_type TEXT DEFAULT 'Standard',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_app_users_email ON app_users(email);
`;

let schemaEnsured = false;

export async function ensureD1Schema(): Promise<{ success: boolean; error?: string }> {
  if (schemaEnsured) return { success: true };
  if (!isD1Configured()) {
    return { success: false, error: 'D1 not configured' };
  }

  try {
    const res = await d1Exec(D1_SCHEMA_SQL);
    if (!res.success) {
      console.error('[D1 Schema] Failed to ensure schema:', res.error);
      return { success: false, error: res.error };
    }
    schemaEnsured = true;
    console.log('[D1 Schema] Successfully verified/created D1 tables.');
    return { success: true };
  } catch (err: any) {
    console.error('[D1 Schema] Error ensuring schema:', err);
    return { success: false, error: err?.message || String(err) };
  }
}
