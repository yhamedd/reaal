import { all, get, run, type DB } from './db.js';

export interface AppSettings {
  company: {
    name: string;
    phone: string;
    email: string;
    website: string;
    address: string;
    logo_file_id: number | null;
  };
  security: {
    inactivity_minutes: number;
    max_login_attempts: number;
    lockout_minutes: number;
    session_hours: number;
    remember_days: number;
    min_password_length: number;
  };
  verification: {
    attention_days: number;
    outdated_days: number;
    notify_agents: boolean;
  };
  pdf: {
    show_owner: boolean;
    show_price: boolean;
    show_unit_number: boolean;
    show_images: boolean;
    show_floor_plan: boolean;
    show_master_plan: boolean;
    show_agent_contact: boolean;
    accent_color: string;
    footer_text: string;
  };
  general: {
    currency: string;
    export_log_threshold: number;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  company: {
    name: 'Reaal Properties',
    phone: '',
    email: '',
    website: '',
    address: '',
    logo_file_id: null,
  },
  security: {
    inactivity_minutes: 60,
    max_login_attempts: 5,
    lockout_minutes: 15,
    session_hours: 12,
    remember_days: 30,
    min_password_length: 8,
  },
  verification: {
    attention_days: 15,
    outdated_days: 30,
    notify_agents: true,
  },
  pdf: {
    show_owner: false,
    show_price: true,
    show_unit_number: false,
    show_images: true,
    show_floor_plan: true,
    show_master_plan: true,
    show_agent_contact: true,
    accent_color: '#1f4b99',
    footer_text: 'All information is subject to change and final confirmation.',
  },
  general: {
    currency: 'EGP',
    export_log_threshold: 0,
  },
};

type Section = keyof AppSettings;

export async function getSettings(db: DB): Promise<AppSettings> {
  const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
  const stored: Record<string, any> = {};
  for (const r of rows) {
    try {
      stored[r.key] = JSON.parse(r.value);
    } catch {
      /* ignore corrupt values, defaults apply */
    }
  }
  const out: any = {};
  for (const section of Object.keys(DEFAULT_SETTINGS) as Section[]) {
    out[section] = { ...DEFAULT_SETTINGS[section], ...(stored[section] ?? {}) };
  }
  return out as AppSettings;
}

export async function updateSettings(db: DB, patch: Partial<{ [K in Section]: Partial<AppSettings[K]> }>): Promise<AppSettings> {
  const current = await getSettings(db);
  for (const section of Object.keys(patch) as Section[]) {
    if (!(section in DEFAULT_SETTINGS)) continue;
    const defaults = DEFAULT_SETTINGS[section] as Record<string, unknown>;
    const merged: Record<string, unknown> = { ...current[section] };
    for (const [k, v] of Object.entries(patch[section] ?? {})) {
      if (!(k in defaults)) continue;
      const expected = typeof defaults[k];
      if (defaults[k] === null || expected === typeof v) merged[k] = v;
      else if (expected === 'number' && v !== '' && !Number.isNaN(Number(v))) merged[k] = Number(v);
      else if (expected === 'boolean') merged[k] = Boolean(v);
      else if (expected === 'string') merged[k] = String(v ?? '');
    }
    await run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [
      section,
      JSON.stringify(merged),
    ]);
  }
  return await getSettings(db);
}

export async function settingExists(db: DB, key: string): Promise<boolean> {
  return !!await get(db, 'SELECT 1 FROM settings WHERE key = ?', [key]);
}
