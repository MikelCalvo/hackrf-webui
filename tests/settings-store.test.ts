import assert from "node:assert/strict";
import test from "node:test";

import Database from "better-sqlite3";

import { DEFAULT_APP_SETTINGS } from "@/lib/settings";
import { createSettingsStore } from "@/server/settings-store";

function createDb(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value_json TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);
  return sqlite;
}

test("settings store reads defaults from an empty database", () => {
  const sqlite = createDb();
  try {
    const store = createSettingsStore(sqlite);
    assert.deepEqual(store.getAll(), DEFAULT_APP_SETTINGS);
  } finally {
    sqlite.close();
  }
});

test("settings store transactionally upserts patched sections and preserves other values", () => {
  const sqlite = createDb();
  try {
    let now = 100;
    const store = createSettingsStore(sqlite, () => ++now);
    const saved = store.patch({
      sidebar: { compact: true, visibleModules: ["sigint", "morse"] },
      ai: { enabled: false, cpuThreads: 2 },
    });

    assert.equal(saved.sidebar.compact, true);
    assert.deepEqual(saved.sidebar.visibleModules, ["sigint", "morse"]);
    assert.equal(saved.ai.enabled, false);
    assert.equal(saved.ai.cpuThreads, 2);
    assert.deepEqual(saved.general, DEFAULT_APP_SETTINGS.general);

    const rows = sqlite.prepare("SELECT key, value_json, updated_at_ms FROM app_settings ORDER BY key").all() as Array<{
      key: string;
      value_json: string;
      updated_at_ms: number;
    }>;
    assert.deepEqual(rows.map((row) => row.key), ["settings.ai.v1", "settings.sidebar.v1"]);
    assert.ok(rows.every((row) => JSON.parse(row.value_json).version === 1));
    assert.deepEqual(rows.map((row) => row.updated_at_ms), [102, 101]);
  } finally {
    sqlite.close();
  }
});

test("settings store falls back per corrupt section without rewriting evidence database", () => {
  const sqlite = createDb();
  try {
    sqlite.prepare("INSERT INTO app_settings (key, value_json, updated_at_ms) VALUES (?, ?, ?)")
      .run("settings.ai.v1", "not-json", 5);
    sqlite.prepare("INSERT INTO app_settings (key, value_json, updated_at_ms) VALUES (?, ?, ?)")
      .run("unrelated.setting", JSON.stringify({ keep: true }), 6);

    const store = createSettingsStore(sqlite);
    assert.deepEqual(store.getSection("ai"), DEFAULT_APP_SETTINGS.ai);
    assert.deepEqual(
      sqlite.prepare("SELECT value_json FROM app_settings WHERE key = ?").get("unrelated.setting"),
      { value_json: JSON.stringify({ keep: true }) },
    );
  } finally {
    sqlite.close();
  }
});

test("settings store returns clones rather than mutable singleton arrays", () => {
  const sqlite = createDb();
  try {
    const store = createSettingsStore(sqlite);
    const first = store.getAll();
    first.sidebar.visibleModules.pop();
    first.ai.modules.pop();
    const second = store.getAll();
    assert.equal(second.sidebar.visibleModules.length, 8);
    assert.equal(second.ai.modules.length, 3);
  } finally {
    sqlite.close();
  }
});

test("settings store records section metadata without exposing raw database paths", () => {
  const sqlite = createDb();
  try {
    const store = createSettingsStore(sqlite, () => 1234);
    store.patch({ ai: { enabled: false } });
    const snapshot = store.getSnapshot();
    assert.equal(snapshot.sections.ai.updatedAtMs, 1234);
    assert.equal(snapshot.sections.ai.source, "database");
    assert.equal(snapshot.sections.general.source, "default");
    assert.doesNotMatch(JSON.stringify(snapshot), /\/home\/|app\.sqlite/);
  } finally {
    sqlite.close();
  }
});

test("settings store does not write a section when it is absent from the patch", () => {
  const sqlite = createDb();
  try {
    const store = createSettingsStore(sqlite);
    store.patch({ general: { restoreLastModule: false } });
    const count = sqlite.prepare("SELECT COUNT(*) AS count FROM app_settings").get() as { count: number };
    assert.equal(count.count, 1);
    assert.equal(store.getAll().ai.enabled, true);
  } finally {
    sqlite.close();
  }
});

test("settings store updates a prior row without duplicates", () => {
  const sqlite = createDb();
  try {
    const store = createSettingsStore(sqlite);
    store.patch({ ai: { enabled: false } });
    store.patch({ ai: { enabled: true, hotwords: "mayday" } });
    const rows = sqlite.prepare("SELECT value_json FROM app_settings WHERE key = ?").all("settings.ai.v1") as Array<{ value_json: string }>;
    assert.equal(rows.length, 1);
    assert.deepEqual(JSON.parse(rows[0].value_json), {
      ...DEFAULT_APP_SETTINGS.ai,
      enabled: true,
      hotwords: "mayday",
    });
  } finally {
    sqlite.close();
  }
});

test("settings store rolls back all sections if one database write fails", () => {
  const sqlite = createDb();
  try {
    sqlite.exec(`
      CREATE TRIGGER fail_ai_setting
      BEFORE INSERT ON app_settings
      WHEN NEW.key = 'settings.ai.v1'
      BEGIN
        SELECT RAISE(ABORT, 'blocked');
      END;
    `);
    const store = createSettingsStore(sqlite);
    assert.throws(
      () => store.patch({ general: { restoreLastModule: false }, ai: { enabled: false } }),
      /blocked/,
    );
    const count = sqlite.prepare("SELECT COUNT(*) AS count FROM app_settings").get() as { count: number };
    assert.equal(count.count, 0);
  } finally {
    sqlite.close();
  }
});

test("settings store ignores legacy and unknown keys in snapshots", () => {
  const sqlite = createDb();
  try {
    sqlite.prepare("INSERT INTO app_settings VALUES (?, ?, ?)").run("settings.future.v99", "{}", 9);
    const store = createSettingsStore(sqlite);
    assert.deepEqual(store.getAll(), DEFAULT_APP_SETTINGS);
    assert.deepEqual(Object.keys(store.getSnapshot().sections), ["general", "sidebar", "ai"]);
  } finally {
    sqlite.close();
  }
});

test("settings store persists explicit empty AI module allowlist", () => {
  const sqlite = createDb();
  try {
    const store = createSettingsStore(sqlite);
    assert.deepEqual(store.patch({ ai: { modules: [] } }).ai.modules, []);
    assert.deepEqual(store.getAll().ai.modules, []);
  } finally {
    sqlite.close();
  }
});

test("settings store supports user-defined sidebar order", () => {
  const sqlite = createDb();
  try {
    const store = createSettingsStore(sqlite);
    store.patch({ sidebar: { visibleModules: ["morse", "sigint", "fm"] } });
    assert.deepEqual(store.getAll().sidebar.visibleModules, ["morse", "sigint", "fm"]);
  } finally {
    sqlite.close();
  }
});

test("settings store preserves versions on every write", () => {
  const sqlite = createDb();
  try {
    const store = createSettingsStore(sqlite);
    store.patch({ general: { defaultModule: "morse" }, sidebar: { compact: true }, ai: { cpuThreads: 8 } });
    const rows = sqlite.prepare("SELECT value_json FROM app_settings").all() as Array<{ value_json: string }>;
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => JSON.parse(row.value_json).version === 1));
  } finally {
    sqlite.close();
  }
});

test("settings store snapshot values and metadata agree", () => {
  const sqlite = createDb();
  try {
    const store = createSettingsStore(sqlite, () => 88);
    store.patch({ sidebar: { compact: true } });
    const snapshot = store.getSnapshot();
    assert.equal(snapshot.values.sidebar.compact, true);
    assert.equal(snapshot.sections.sidebar.updatedAtMs, 88);
  } finally {
    sqlite.close();
  }
});

test("settings store parses existing valid rows", () => {
  const sqlite = createDb();
  try {
    sqlite.prepare("INSERT INTO app_settings VALUES (?, ?, ?)").run(
      "settings.general.v1",
      JSON.stringify({ version: 1, restoreLastModule: false, defaultModule: "morse" }),
      7,
    );
    const store = createSettingsStore(sqlite);
    assert.deepEqual(store.getAll().general, { version: 1, restoreLastModule: false, defaultModule: "morse" });
    assert.equal(store.getSnapshot().sections.general.updatedAtMs, 7);
  } finally {
    sqlite.close();
  }
});

test("settings store uses one timestamp per changed section", () => {
  const sqlite = createDb();
  try {
    let now = 0;
    const store = createSettingsStore(sqlite, () => ++now);
    store.patch({ general: { restoreLastModule: false }, sidebar: { compact: true }, ai: { enabled: false } });
    assert.equal(now, 3);
  } finally {
    sqlite.close();
  }
});

test("settings store never deletes unrelated app_settings records", () => {
  const sqlite = createDb();
  try {
    sqlite.prepare("INSERT INTO app_settings VALUES (?, ?, ?)").run("custom.keep", JSON.stringify({ value: 1 }), 1);
    const store = createSettingsStore(sqlite);
    store.patch({ ai: { enabled: false } });
    const kept = sqlite.prepare("SELECT value_json FROM app_settings WHERE key = ?").get("custom.keep") as { value_json: string };
    assert.equal(kept.value_json, JSON.stringify({ value: 1 }));
  } finally {
    sqlite.close();
  }
});

test("settings store methods can be called repeatedly", () => {
  const sqlite = createDb();
  try {
    const store = createSettingsStore(sqlite);
    assert.deepEqual(store.getAll(), store.getAll());
    assert.deepEqual(store.getSnapshot().values, store.getAll());
  } finally {
    sqlite.close();
  }
});

test("settings store patch output is independent from stored arrays", () => {
  const sqlite = createDb();
  try {
    const store = createSettingsStore(sqlite);
    const saved = store.patch({ ai: { modules: ["pmr"] } });
    saved.ai.modules.push("airband");
    assert.deepEqual(store.getAll().ai.modules, ["pmr"]);
  } finally {
    sqlite.close();
  }
});

test("settings store defaults source has null updated timestamp", () => {
  const sqlite = createDb();
  try {
    const snapshot = createSettingsStore(sqlite).getSnapshot();
    assert.equal(snapshot.sections.general.updatedAtMs, null);
    assert.equal(snapshot.sections.sidebar.updatedAtMs, null);
    assert.equal(snapshot.sections.ai.updatedAtMs, null);
  } finally {
    sqlite.close();
  }
});

test("settings store uses database source even when a persisted row is corrupt", () => {
  const sqlite = createDb();
  try {
    sqlite.prepare("INSERT INTO app_settings VALUES (?, ?, ?)").run("settings.ai.v1", "bad", 5);
    const snapshot = createSettingsStore(sqlite).getSnapshot();
    assert.equal(snapshot.sections.ai.source, "database-invalid");
    assert.equal(snapshot.sections.ai.updatedAtMs, 5);
    assert.deepEqual(snapshot.values.ai, DEFAULT_APP_SETTINGS.ai);
  } finally {
    sqlite.close();
  }
});

test("settings store applies a patch over safe defaults after a corrupt row", () => {
  const sqlite = createDb();
  try {
    sqlite.prepare("INSERT INTO app_settings VALUES (?, ?, ?)").run("settings.ai.v1", "bad", 5);
    const store = createSettingsStore(sqlite);
    const saved = store.patch({ ai: { enabled: false } });
    assert.equal(saved.ai.enabled, false);
    assert.equal(saved.ai.cpuThreads, DEFAULT_APP_SETTINGS.ai.cpuThreads);
    assert.doesNotThrow(() => JSON.parse((sqlite.prepare("SELECT value_json FROM app_settings WHERE key = ?").get("settings.ai.v1") as { value_json: string }).value_json));
  } finally {
    sqlite.close();
  }
});

test("settings store leaves database open for the application owner", () => {
  const sqlite = createDb();
  const store = createSettingsStore(sqlite);
  store.getAll();
  assert.equal((sqlite.prepare("SELECT 1 AS value").get() as { value: number }).value, 1);
  sqlite.close();
});

test("settings store only queries allowlisted settings keys", () => {
  const sqlite = createDb();
  try {
    sqlite.prepare("INSERT INTO app_settings VALUES (?, ?, ?)").run("settings.ai.v1.extra", JSON.stringify({ enabled: false }), 1);
    assert.equal(createSettingsStore(sqlite).getAll().ai.enabled, true);
  } finally {
    sqlite.close();
  }
});

test("settings store supports null default module", () => {
  const sqlite = createDb();
  try {
    const store = createSettingsStore(sqlite);
    store.patch({ general: { defaultModule: "morse" } });
    assert.equal(store.patch({ general: { defaultModule: null } }).general.defaultModule, null);
  } finally {
    sqlite.close();
  }
});

test("settings store can hide SIGINT if another operational module remains", () => {
  const sqlite = createDb();
  try {
    const result = createSettingsStore(sqlite).patch({ sidebar: { visibleModules: ["fm"] } });
    assert.deepEqual(result.sidebar.visibleModules, ["fm"]);
  } finally {
    sqlite.close();
  }
});

test("settings store returns stable section source strings", () => {
  const sqlite = createDb();
  try {
    const source = createSettingsStore(sqlite).getSnapshot().sections.ai.source;
    assert.ok(["default", "database", "database-invalid"].includes(source));
  } finally {
    sqlite.close();
  }
});

test("settings store JSON rows contain no secret-like values by default", () => {
  const sqlite = createDb();
  try {
    createSettingsStore(sqlite).patch({ ai: { enabled: false } });
    const json = JSON.stringify(sqlite.prepare("SELECT * FROM app_settings").all());
    assert.doesNotMatch(json, /Bearer|token|password|api[_-]?key/i);
  } finally {
    sqlite.close();
  }
});

test("settings store has no side effects before patch", () => {
  const sqlite = createDb();
  try {
    const store = createSettingsStore(sqlite);
    store.getAll();
    store.getSnapshot();
    const count = sqlite.prepare("SELECT COUNT(*) AS count FROM app_settings").get() as { count: number };
    assert.equal(count.count, 0);
  } finally {
    sqlite.close();
  }
});

test("settings store exposes all three section metadata records", () => {
  const sqlite = createDb();
  try {
    assert.deepEqual(Object.keys(createSettingsStore(sqlite).getSnapshot().sections), ["general", "sidebar", "ai"]);
  } finally {
    sqlite.close();
  }
});

test("settings store test sentinel", () => assert.equal(true, true));
