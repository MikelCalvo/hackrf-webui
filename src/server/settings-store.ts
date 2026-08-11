import type Database from "better-sqlite3";

import type { SettingsSnapshot } from "@/lib/settings-runtime";
import {
  DEFAULT_APP_SETTINGS,
  SETTINGS_SECTION_KEYS,
  SETTINGS_STORAGE_KEYS,
  cloneAppSettings,
  mergeSettingsPatch,
  parseStoredSettingsSection,
  type AppSettings,
  type AppSettingsPatch,
  type SettingsSectionKey,
} from "@/lib/settings";

type SettingsRow = {
  key: string;
  valueJson: string;
  updatedAtMs: number;
};

export type SettingsStore = {
  getAll(): AppSettings;
  getSection<K extends SettingsSectionKey>(section: K): AppSettings[K];
  getSnapshot(): SettingsSnapshot;
  patch(patch: AppSettingsPatch): AppSettings;
};

function cloneSnapshot(snapshot: SettingsSnapshot): SettingsSnapshot {
  return {
    values: cloneAppSettings(snapshot.values),
    sections: {
      general: { ...snapshot.sections.general },
      sidebar: { ...snapshot.sections.sidebar },
      ai: { ...snapshot.sections.ai },
    },
  };
}

function rowIsValid<K extends SettingsSectionKey>(section: K, row: SettingsRow): boolean {
  try {
    const parsedJson = JSON.parse(row.valueJson) as unknown;
    const parsed = parseStoredSettingsSection(section, row.valueJson);
    if (parsedJson === null || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
      return false;
    }
    return JSON.stringify(parsed) !== JSON.stringify(DEFAULT_APP_SETTINGS[section])
      || JSON.stringify(parsedJson) === JSON.stringify(DEFAULT_APP_SETTINGS[section])
      || (parsedJson as { version?: unknown }).version === 1
        && Object.keys(parsedJson as Record<string, unknown>).every((key) => Object.hasOwn(parsed, key));
  } catch {
    return false;
  }
}

export function createSettingsStore(sqlite: Database.Database, now: () => number = Date.now): SettingsStore {
  const selectRow = sqlite.prepare(`
    SELECT key, value_json AS valueJson, updated_at_ms AS updatedAtMs
    FROM app_settings
    WHERE key = ?
    LIMIT 1
  `);
  const upsertRow = sqlite.prepare(`
    INSERT INTO app_settings (key, value_json, updated_at_ms)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at_ms = excluded.updated_at_ms
  `);

  function getSnapshot(): SettingsSnapshot {
    const values = cloneAppSettings();
    const sections: SettingsSnapshot["sections"] = {
      general: { source: "default", updatedAtMs: null },
      sidebar: { source: "default", updatedAtMs: null },
      ai: { source: "default", updatedAtMs: null },
    };

    for (const section of SETTINGS_SECTION_KEYS) {
      const row = selectRow.get(SETTINGS_STORAGE_KEYS[section]) as SettingsRow | undefined;
      if (!row) continue;
      values[section] = parseStoredSettingsSection(section, row.valueJson) as never;
      sections[section] = {
        source: rowIsValid(section, row) ? "database" : "database-invalid",
        updatedAtMs: row.updatedAtMs,
      };
    }

    return cloneSnapshot({ values, sections });
  }

  function getAll(): AppSettings {
    return getSnapshot().values;
  }

  function getSection<K extends SettingsSectionKey>(section: K): AppSettings[K] {
    const values = getAll();
    if (section === "sidebar") {
      return { ...values.sidebar, visibleModules: [...values.sidebar.visibleModules] } as AppSettings[K];
    }
    if (section === "ai") {
      return { ...values.ai, modules: [...values.ai.modules] } as AppSettings[K];
    }
    return { ...values.general } as AppSettings[K];
  }

  const applyPatch = sqlite.transaction((patch: AppSettingsPatch): AppSettings => {
    const next = mergeSettingsPatch(getAll(), patch);
    for (const section of SETTINGS_SECTION_KEYS) {
      if (!Object.hasOwn(patch, section)) continue;
      upsertRow.run(
        SETTINGS_STORAGE_KEYS[section],
        JSON.stringify(next[section]),
        now(),
      );
    }
    return cloneAppSettings(next);
  });

  function patch(patch: AppSettingsPatch): AppSettings {
    return applyPatch.immediate(patch);
  }

  return { getAll, getSection, getSnapshot, patch };
}

let appSettingsStore: SettingsStore | null = null;

export async function getAppSettingsStore(): Promise<SettingsStore> {
  if (appSettingsStore) return appSettingsStore;
  const { sqliteDb } = await import("@/server/db/client");
  appSettingsStore = createSettingsStore(sqliteDb);
  return appSettingsStore;
}

export async function readAppSettings(): Promise<AppSettings> {
  return (await getAppSettingsStore()).getAll();
}

export async function readAiSettings(): Promise<AppSettings["ai"]> {
  return (await getAppSettingsStore()).getSection("ai");
}

export async function patchAppSettings(patch: AppSettingsPatch): Promise<AppSettings> {
  return (await getAppSettingsStore()).patch(patch);
}

export function resetSettingsStoreForTests(): void {
  appSettingsStore = null;
}
