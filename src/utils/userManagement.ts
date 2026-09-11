import { UserProfile } from '../types';

export interface AdminSettings {
  defaultCredits: number;
  maintenanceMode: boolean;
  allowGuestMode: boolean;
  modelOverrides?: Record<string, string>;
  apiBudgetLimit?: number;
  [key: string]: any;
}

const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  defaultCredits: 100,
  maintenanceMode: false,
  allowGuestMode: true,
  modelOverrides: {},
  apiBudgetLimit: 50,
};

const USERS_STORAGE_KEY = 'health_app_all_users';
const SETTINGS_STORAGE_KEY = 'health_app_admin_settings';

export function getAllLocalUsers(): UserProfile[] {
  try {
    const raw = localStorage.getItem(USERS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('[userManagement] Failed to read local users:', err);
  }
  return [];
}

export async function updateUserProfile(profile: UserProfile): Promise<void> {
  if (!profile || !profile.email) return;
  const users = getAllLocalUsers();
  const existingIdx = users.findIndex(u => u.email.toLowerCase() === profile.email.toLowerCase());
  if (existingIdx >= 0) {
    users[existingIdx] = { ...users[existingIdx], ...profile };
  } else {
    users.push(profile);
  }
  try {
    localStorage.setItem(USERS_STORAGE_KEY, JSON.stringify(users));
  } catch (err) {
    console.warn('[userManagement] Failed to save updated user profile:', err);
  }
}

export function getAdminSettings(): AdminSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_ADMIN_SETTINGS, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.warn('[userManagement] Failed to read admin settings:', err);
  }
  return { ...DEFAULT_ADMIN_SETTINGS };
}

export function saveAdminSettings(settings: AdminSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('[userManagement] Failed to save admin settings:', err);
  }
}
