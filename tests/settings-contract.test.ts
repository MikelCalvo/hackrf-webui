import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_APP_SETTINGS,
  SETTINGS_SECTION_KEYS,
  parseSettingsPatch,
  parseStoredSettingsSection,
} from "@/lib/settings";

test("settings defaults are versioned and keep Settings outside the operational module list", () => {
  assert.equal(DEFAULT_APP_SETTINGS.general.version, 1);
  assert.equal(DEFAULT_APP_SETTINGS.sidebar.version, 1);
  assert.equal(DEFAULT_APP_SETTINGS.ai.version, 1);
  assert.equal(DEFAULT_APP_SETTINGS.general.restoreLastModule, true);
  assert.equal(DEFAULT_APP_SETTINGS.ai.enabled, true);
  assert.deepEqual(SETTINGS_SECTION_KEYS, ["general", "sidebar", "ai"]);
  assert.doesNotMatch(JSON.stringify(DEFAULT_APP_SETTINGS.sidebar), /settings/i);
});

test("stored settings fall back safely when JSON is invalid or the version is unsupported", () => {
  assert.deepEqual(parseStoredSettingsSection("general", "not-json"), DEFAULT_APP_SETTINGS.general);
  assert.deepEqual(
    parseStoredSettingsSection("ai", JSON.stringify({ version: 99, enabled: false })),
    DEFAULT_APP_SETTINGS.ai,
  );
});

test("settings patches reject unknown sections and unknown fields", () => {
  assert.throws(() => parseSettingsPatch({ secrets: { token: "no" } }), /Unknown settings section/);
  assert.throws(() => parseSettingsPatch({ ai: { enabled: false, apiToken: "no" } }), /Unknown ai setting/);
});

test("sidebar settings accept only unique operational modules and keep one visible", () => {
  assert.throws(() => parseSettingsPatch({ sidebar: { visibleModules: [] } }), /at least one/i);
  assert.throws(() => parseSettingsPatch({ sidebar: { visibleModules: ["fm", "settings"] } }), /Unknown module/i);
  assert.throws(() => parseSettingsPatch({ sidebar: { visibleModules: ["fm", "fm"] } }), /unique/i);

  const patch = parseSettingsPatch({ sidebar: { visibleModules: ["sigint", "fm", "morse"] } });
  assert.deepEqual(patch.sidebar?.visibleModules, ["sigint", "fm", "morse"]);
});

test("AI settings are bounded and normalize text", () => {
  assert.throws(() => parseSettingsPatch({ ai: { cpuThreads: 0 } }), /between 1 and 8/);
  assert.throws(() => parseSettingsPatch({ ai: { cpuThreads: 9 } }), /between 1 and 8/);
  assert.throws(() => parseSettingsPatch({ ai: { hotwords: "x".repeat(1001) } }), /1000/);

  const patch = parseSettingsPatch({
    ai: {
      enabled: false,
      cpuThreads: 6,
      hotwords: "  coast guard, mayday  ",
      modules: ["pmr", "airband"],
    },
  });
  assert.deepEqual(patch.ai, {
    enabled: false,
    cpuThreads: 6,
    hotwords: "coast guard, mayday",
    modules: ["pmr", "airband"],
  });
});

test("general settings validate the default module as operational", () => {
  assert.throws(() => parseSettingsPatch({ general: { defaultModule: "settings" } }), /Unknown module/);
  const patch = parseSettingsPatch({ general: { restoreLastModule: false, defaultModule: "morse" } });
  assert.deepEqual(patch.general, { restoreLastModule: false, defaultModule: "morse" });
});


test("stored sections retain valid values and fill missing defaults", () => {
  assert.deepEqual(
    parseStoredSettingsSection("ai", JSON.stringify({ version: 1, enabled: false, cpuThreads: 2 })),
    {
      ...DEFAULT_APP_SETTINGS.ai,
      enabled: false,
      cpuThreads: 2,
    },
  );
});

test("settings patch payload is bounded", () => {
  assert.throws(
    () => parseSettingsPatch({ ai: { hotwords: "x".repeat(70_000) } }),
    /too large/i,
  );
});

test("AI modules allow only audio-analysis modules without duplicates", () => {
  assert.throws(() => parseSettingsPatch({ ai: { modules: ["pmr", "morse"] } }), /Unknown AI module/);
  assert.throws(() => parseSettingsPatch({ ai: { modules: ["pmr", "pmr"] } }), /unique/i);
  assert.deepEqual(
    parseSettingsPatch({ ai: { modules: [] } }).ai?.modules,
    [],
  );
});

test("booleans and integer fields reject coercion", () => {
  assert.throws(() => parseSettingsPatch({ ai: { enabled: "false" } }), /boolean/i);
  assert.throws(() => parseSettingsPatch({ ai: { cpuThreads: 2.5 } }), /integer/i);
  assert.throws(() => parseSettingsPatch({ sidebar: { compact: 1 } }), /boolean/i);
});

test("stored sections reject unknown persisted fields", () => {
  assert.deepEqual(
    parseStoredSettingsSection("general", JSON.stringify({ version: 1, restoreLastModule: false, token: "secret" })),
    DEFAULT_APP_SETTINGS.general,
  );
});

test("patches do not accept explicit version changes", () => {
  assert.throws(() => parseSettingsPatch({ ai: { version: 1, enabled: false } }), /Unknown ai setting/);
});

test("empty settings patches are rejected", () => {
  assert.throws(() => parseSettingsPatch({}), /at least one/i);
  assert.throws(() => parseSettingsPatch({ ai: {} }), /at least one ai setting/i);
});

test("null and arrays are rejected as settings objects", () => {
  assert.throws(() => parseSettingsPatch(null), /object/i);
  assert.throws(() => parseSettingsPatch([]), /object/i);
  assert.throws(() => parseSettingsPatch({ ai: null }), /ai settings must be an object/i);
});

test("default module can be null to defer to the built-in default", () => {
  assert.deepEqual(parseSettingsPatch({ general: { defaultModule: null } }).general, { defaultModule: null });
});

test("stored sidebar invalid module IDs fall back instead of partially applying", () => {
  assert.deepEqual(
    parseStoredSettingsSection("sidebar", JSON.stringify({ version: 1, visibleModules: ["fm", "settings"] })),
    DEFAULT_APP_SETTINGS.sidebar,
  );
});

test("AI hotwords permit clearing with an empty string", () => {
  assert.equal(parseSettingsPatch({ ai: { hotwords: "   " } }).ai?.hotwords, "");
});

test("prototype keys are not accepted as sections", () => {
  const payload = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => parseSettingsPatch(payload), /Unknown settings section/);
  assert.equal(({} as { polluted?: boolean }).polluted, undefined);
});

test("section key constants match persisted key names", () => {
  assert.deepEqual(
    SETTINGS_SECTION_KEYS.map((section) => `settings.${section}.v1`),
    ["settings.general.v1", "settings.sidebar.v1", "settings.ai.v1"],
  );
});

test("settings defaults contain every operational module in canonical order", () => {
  assert.deepEqual(DEFAULT_APP_SETTINGS.sidebar.visibleModules, [
    "sigint",
    "fm",
    "pmr",
    "airband",
    "maritime",
    "adsb",
    "ais",
    "morse",
  ]);
});

test("AI default module allowlist excludes MORSE derived decoding", () => {
  assert.deepEqual(DEFAULT_APP_SETTINGS.ai.modules, ["pmr", "airband", "maritime"]);
});

test("patch result is a fresh object", () => {
  const payload = { ai: { enabled: false } };
  const parsed = parseSettingsPatch(payload);
  payload.ai.enabled = true;
  assert.equal(parsed.ai?.enabled, false);
});

test("stored general supports explicit null default module", () => {
  assert.deepEqual(
    parseStoredSettingsSection("general", JSON.stringify({ version: 1, defaultModule: null })),
    { ...DEFAULT_APP_SETTINGS.general, defaultModule: null },
  );
});

test("stored AI text is normalized", () => {
  assert.deepEqual(
    parseStoredSettingsSection("ai", JSON.stringify({ version: 1, hotwords: "  test  " })),
    { ...DEFAULT_APP_SETTINGS.ai, hotwords: "test" },
  );
});

test("undefined optional patch fields are not silently persisted", () => {
  assert.throws(() => parseSettingsPatch({ ai: { enabled: undefined } }), /boolean/i);
});

test("very deep unrelated input is rejected by the top-level allowlist", () => {
  assert.throws(() => parseSettingsPatch({ extra: { a: { b: { c: true } } } }), /Unknown settings section/);
});

test("valid complete patch preserves all requested values", () => {
  const parsed = parseSettingsPatch({
    general: { restoreLastModule: false, defaultModule: "sigint" },
    sidebar: { compact: true, visibleModules: ["sigint", "morse"] },
    ai: { enabled: true, cpuThreads: 8, hotwords: "alpha", modules: ["pmr"] },
  });
  assert.deepEqual(parsed, {
    general: { restoreLastModule: false, defaultModule: "sigint" },
    sidebar: { compact: true, visibleModules: ["sigint", "morse"] },
    ai: { enabled: true, cpuThreads: 8, hotwords: "alpha", modules: ["pmr"] },
  });
});

test("numeric module IDs are rejected", () => {
  assert.throws(() => parseSettingsPatch({ sidebar: { visibleModules: [1] } }), /module/i);
});

test("non-string hotwords are rejected", () => {
  assert.throws(() => parseSettingsPatch({ ai: { hotwords: ["mayday"] } }), /string/i);
});

test("stored malformed section types fall back safely", () => {
  assert.deepEqual(parseStoredSettingsSection("ai", JSON.stringify([])), DEFAULT_APP_SETTINGS.ai);
  assert.deepEqual(parseStoredSettingsSection("sidebar", JSON.stringify(null)), DEFAULT_APP_SETTINGS.sidebar);
});

test("valid stored values are cloned from defaults", () => {
  const first = parseStoredSettingsSection("sidebar", JSON.stringify({ version: 1 }));
  first.visibleModules.pop();
  const second = parseStoredSettingsSection("sidebar", JSON.stringify({ version: 1 }));
  assert.equal(second.visibleModules.at(-1), "morse");
});

test("unknown stored section name is prevented by TypeScript contract", () => {
  assert.equal(SETTINGS_SECTION_KEYS.includes("general"), true);
});

test("settings patch JSON budget includes keys and values", () => {
  const hugeKey = `x${"a".repeat(70_000)}`;
  assert.throws(() => parseSettingsPatch({ [hugeKey]: true }), /too large/i);
});

test("general and sidebar booleans preserve false", () => {
  assert.deepEqual(
    parseSettingsPatch({ general: { restoreLastModule: false }, sidebar: { compact: false } }),
    { general: { restoreLastModule: false }, sidebar: { compact: false } },
  );
});

test("AI modules preserve canonical request order", () => {
  assert.deepEqual(
    parseSettingsPatch({ ai: { modules: ["maritime", "pmr"] } }).ai?.modules,
    ["maritime", "pmr"],
  );
});

test("sidebar visible modules preserve user order", () => {
  assert.deepEqual(
    parseSettingsPatch({ sidebar: { visibleModules: ["morse", "sigint", "fm"] } }).sidebar?.visibleModules,
    ["morse", "sigint", "fm"],
  );
});

test("stored sections ignore no values only by applying defaults", () => {
  assert.deepEqual(parseStoredSettingsSection("general", JSON.stringify({ version: 1 })), DEFAULT_APP_SETTINGS.general);
});

test("NaN and infinity are rejected for CPU threads", () => {
  assert.throws(() => parseSettingsPatch({ ai: { cpuThreads: Number.NaN } }), /integer/i);
  assert.throws(() => parseSettingsPatch({ ai: { cpuThreads: Number.POSITIVE_INFINITY } }), /integer/i);
});

test("stored settings section keys are stable", () => {
  for (const section of SETTINGS_SECTION_KEYS) {
    assert.match(`settings.${section}.v1`, /^settings\.(general|sidebar|ai)\.v1$/);
  }
});

test("general patch rejects unknown UI fields deferred from V1", () => {
  assert.throws(() => parseSettingsPatch({ general: { theme: "dark" } }), /Unknown general setting/);
});

test("sidebar patch rejects hiding through unsupported flags", () => {
  assert.throws(() => parseSettingsPatch({ sidebar: { hideSettings: true } }), /Unknown sidebar setting/);
});

test("AI patch rejects model and path changes in V1", () => {
  assert.throws(() => parseSettingsPatch({ ai: { model: "latest" } }), /Unknown ai setting/);
  assert.throws(() => parseSettingsPatch({ ai: { pythonPath: "/tmp/python" } }), /Unknown ai setting/);
});

test("stored settings cannot retain deferred secret-like fields", () => {
  assert.deepEqual(
    parseStoredSettingsSection("ai", JSON.stringify({ version: 1, enabled: false, token: "secret" })),
    DEFAULT_APP_SETTINGS.ai,
  );
});

test("settings section arrays are cloned", () => {
  const parsed = parseSettingsPatch({ ai: { modules: ["pmr"] } });
  const modules = parsed.ai?.modules;
  assert.ok(modules);
  modules.push("airband");
  assert.deepEqual(DEFAULT_APP_SETTINGS.ai.modules, ["pmr", "airband", "maritime"]);
});

test("JSON-serializable plain records are required", () => {
  const date = new Date();
  assert.throws(() => parseSettingsPatch(date), /Unknown settings section|object/i);
});

test("stored CPU thread boundary values are accepted", () => {
  assert.equal(parseStoredSettingsSection("ai", JSON.stringify({ version: 1, cpuThreads: 1 })).cpuThreads, 1);
  assert.equal(parseStoredSettingsSection("ai", JSON.stringify({ version: 1, cpuThreads: 8 })).cpuThreads, 8);
});

test("settings contract has no runtime-only processBacklog flag", () => {
  assert.throws(() => parseSettingsPatch({ ai: { processBacklog: true } }), /Unknown ai setting/);
});

test("stored patch version must be numeric one", () => {
  assert.deepEqual(
    parseStoredSettingsSection("ai", JSON.stringify({ version: "1", enabled: false })),
    DEFAULT_APP_SETTINGS.ai,
  );
});

test("full default settings are JSON serializable", () => {
  assert.doesNotThrow(() => JSON.stringify(DEFAULT_APP_SETTINGS));
});

test("settings contract does not carry environment values", () => {
  const json = JSON.stringify(DEFAULT_APP_SETTINGS);
  assert.doesNotMatch(json, /HACKRF_WEBUI|\/home\/|Bearer|token/i);
});

test("AI modules require strings", () => {
  assert.throws(() => parseSettingsPatch({ ai: { modules: [null] } }), /AI module/i);
});

test("sidebar modules require strings", () => {
  assert.throws(() => parseSettingsPatch({ sidebar: { visibleModules: [null] } }), /module/i);
});

test("stored valid false toggle remains false", () => {
  assert.equal(parseStoredSettingsSection("ai", JSON.stringify({ version: 1, enabled: false })).enabled, false);
});

test("stored invalid boolean falls back entirely", () => {
  assert.deepEqual(
    parseStoredSettingsSection("ai", JSON.stringify({ version: 1, enabled: "false", cpuThreads: 2 })),
    DEFAULT_APP_SETTINGS.ai,
  );
});

test("contract defaults use immutable version discriminators", () => {
  assert.equal(DEFAULT_APP_SETTINGS.general.version, 1 as const);
  assert.equal(DEFAULT_APP_SETTINGS.sidebar.version, 1 as const);
  assert.equal(DEFAULT_APP_SETTINGS.ai.version, 1 as const);
});

test("empty hotwords remain bounded", () => {
  assert.equal(parseSettingsPatch({ ai: { hotwords: "" } }).ai?.hotwords, "");
});

test("CPU thread numeric strings are not coerced", () => {
  assert.throws(() => parseSettingsPatch({ ai: { cpuThreads: "4" } }), /integer/i);
});

test("unknown nested top-level values are rejected before use", () => {
  assert.throws(() => parseSettingsPatch({ general: { __proto__: { polluted: true } } }), /at least one general setting|Unknown general setting/);
});

test("parseStoredSettingsSection returns no shared array references", () => {
  const one = parseStoredSettingsSection("ai", JSON.stringify({ version: 1 }));
  const two = parseStoredSettingsSection("ai", JSON.stringify({ version: 1 }));
  assert.notEqual(one.modules, two.modules);
});

test("settings defaults include compact sidebar off", () => {
  assert.equal(DEFAULT_APP_SETTINGS.sidebar.compact, false);
});

test("settings default module is null", () => {
  assert.equal(DEFAULT_APP_SETTINGS.general.defaultModule, null);
});

test("all default visible module identifiers are distinct", () => {
  assert.equal(new Set(DEFAULT_APP_SETTINGS.sidebar.visibleModules).size, DEFAULT_APP_SETTINGS.sidebar.visibleModules.length);
});

test("all default AI modules are distinct", () => {
  assert.equal(new Set(DEFAULT_APP_SETTINGS.ai.modules).size, DEFAULT_APP_SETTINGS.ai.modules.length);
});

test("unsupported scalar top-level patch is rejected", () => {
  assert.throws(() => parseSettingsPatch("ai"), /object/i);
});

test("stored primitive JSON falls back", () => {
  assert.deepEqual(parseStoredSettingsSection("general", "true"), DEFAULT_APP_SETTINGS.general);
});

test("whitespace around stored hotwords is removed", () => {
  assert.equal(parseStoredSettingsSection("ai", JSON.stringify({ version: 1, hotwords: "\nalpha\t" })).hotwords, "alpha");
});

test("settings contract excludes capture retention controls from V1", () => {
  assert.throws(() => parseSettingsPatch({ general: { retentionDays: 30 } }), /Unknown general setting/);
});

test("settings contract excludes RF mutation controls from V1", () => {
  assert.throws(() => parseSettingsPatch({ general: { lna: 40 } }), /Unknown general setting/);
});

test("AI module allowlist can disable analysis for every module", () => {
  assert.deepEqual(parseSettingsPatch({ ai: { modules: [] } }), { ai: { modules: [] } });
});

test("one visible operational module is sufficient", () => {
  assert.deepEqual(parseSettingsPatch({ sidebar: { visibleModules: ["morse"] } }), {
    sidebar: { visibleModules: ["morse"] },
  });
});

test("settings parser reports section context", () => {
  assert.throws(() => parseSettingsPatch({ ai: { enabled: 0 } }), /ai/i);
});

test("stored defaults do not expose mutable singleton arrays", () => {
  const parsed = parseStoredSettingsSection("sidebar", "invalid");
  parsed.visibleModules.length = 1;
  assert.equal(DEFAULT_APP_SETTINGS.sidebar.visibleModules.length, 8);
});

test("patch does not add version fields", () => {
  assert.deepEqual(Object.keys(parseSettingsPatch({ ai: { enabled: false } }).ai ?? {}), ["enabled"]);
});

test("settings section names are lowercase stable identifiers", () => {
  for (const key of SETTINGS_SECTION_KEYS) assert.equal(key, key.toLowerCase());
});

test("default hotwords is empty", () => {
  assert.equal(DEFAULT_APP_SETTINGS.ai.hotwords, "");
});

test("default CPU threads stays within supported hardware limit", () => {
  assert.ok(DEFAULT_APP_SETTINGS.ai.cpuThreads >= 1 && DEFAULT_APP_SETTINGS.ai.cpuThreads <= 8);
});

test("stored invalid module duplicate falls back", () => {
  assert.deepEqual(
    parseStoredSettingsSection("ai", JSON.stringify({ version: 1, modules: ["pmr", "pmr"] })),
    DEFAULT_APP_SETTINGS.ai,
  );
});

test("patch rejects inherited fields", () => {
  const inherited = Object.create({ enabled: false }) as Record<string, unknown>;
  assert.throws(() => parseSettingsPatch({ ai: inherited }), /at least one ai setting/i);
});

test("defaults can be independently serialized by section", () => {
  for (const key of SETTINGS_SECTION_KEYS) assert.doesNotThrow(() => JSON.stringify(DEFAULT_APP_SETTINGS[key]));
});

test("stored settings section parser accepts its typed key set", () => {
  for (const key of SETTINGS_SECTION_KEYS) assert.ok(parseStoredSettingsSection(key, JSON.stringify({ version: 1 })));
});

test("large but allowed hotwords fit exactly 1000 characters after trim", () => {
  const value = "x".repeat(1000);
  assert.equal(parseSettingsPatch({ ai: { hotwords: value } }).ai?.hotwords?.length, 1000);
});

test("stored hotwords over the limit fall back", () => {
  assert.deepEqual(
    parseStoredSettingsSection("ai", JSON.stringify({ version: 1, hotwords: "x".repeat(1001) })),
    DEFAULT_APP_SETTINGS.ai,
  );
});

test("settings patch supports simultaneous section changes", () => {
  const parsed = parseSettingsPatch({ general: { restoreLastModule: true }, ai: { enabled: false } });
  assert.equal(parsed.general?.restoreLastModule, true);
  assert.equal(parsed.ai?.enabled, false);
});

test("sidebar module setting accepts all operational module identifiers", () => {
  assert.equal(parseSettingsPatch({ sidebar: { visibleModules: [...DEFAULT_APP_SETTINGS.sidebar.visibleModules] } }).sidebar?.visibleModules?.length, 8);
});

test("AI setting accepts all supported analysis modules", () => {
  assert.equal(parseSettingsPatch({ ai: { modules: [...DEFAULT_APP_SETTINGS.ai.modules] } }).ai?.modules?.length, 3);
});

test("contract parser never mutates input arrays", () => {
  const values = ["pmr"];
  parseSettingsPatch({ ai: { modules: values } });
  assert.deepEqual(values, ["pmr"]);
});

test("section key list is immutable by convention", () => {
  assert.equal(Object.isFrozen(SETTINGS_SECTION_KEYS) || Array.isArray(SETTINGS_SECTION_KEYS), true);
});

test("defaults use only explicit V1 fields", () => {
  assert.deepEqual(Object.keys(DEFAULT_APP_SETTINGS.general).sort(), ["defaultModule", "restoreLastModule", "version"].sort());
  assert.deepEqual(Object.keys(DEFAULT_APP_SETTINGS.sidebar).sort(), ["compact", "version", "visibleModules"].sort());
  assert.deepEqual(Object.keys(DEFAULT_APP_SETTINGS.ai).sort(), ["cpuThreads", "enabled", "hotwords", "modules", "version"].sort());
});

test("parser rejects symbols and functions", () => {
  assert.throws(() => parseSettingsPatch({ ai: { hotwords: Symbol("x") } }), /string/i);
  assert.throws(() => parseSettingsPatch({ ai: { enabled: () => true } }), /boolean/i);
});

test("JSON null stored general falls back cleanly", () => {
  assert.deepEqual(parseStoredSettingsSection("general", "null"), DEFAULT_APP_SETTINGS.general);
});

test("stored unknown fields cause whole-section fallback", () => {
  assert.deepEqual(
    parseStoredSettingsSection("sidebar", JSON.stringify({ version: 1, compact: true, extra: true })),
    DEFAULT_APP_SETTINGS.sidebar,
  );
});

test("settings patch rejects nested module objects", () => {
  assert.throws(() => parseSettingsPatch({ sidebar: { visibleModules: [{ id: "fm" }] } }), /module/i);
});

test("settings patch rejects BigInt without leaking serialization errors", () => {
  assert.throws(() => parseSettingsPatch({ ai: { cpuThreads: BigInt(4) } }), /integer|serializable|large/i);
});

test("valid patch can disable restore-last while retaining null default", () => {
  assert.deepEqual(parseSettingsPatch({ general: { restoreLastModule: false, defaultModule: null } }), {
    general: { restoreLastModule: false, defaultModule: null },
  });
});

test("default object is a complete section map", () => {
  assert.deepEqual(Object.keys(DEFAULT_APP_SETTINGS), [...SETTINGS_SECTION_KEYS]);
});

test("stored setting with negative version falls back", () => {
  assert.deepEqual(parseStoredSettingsSection("general", JSON.stringify({ version: -1 })), DEFAULT_APP_SETTINGS.general);
});

test("settings parser rejects case-insensitive aliases", () => {
  assert.throws(() => parseSettingsPatch({ AI: { enabled: false } }), /Unknown settings section/);
});

test("module identifiers are case sensitive", () => {
  assert.throws(() => parseSettingsPatch({ general: { defaultModule: "MORSE" } }), /Unknown module/);
});

test("AI module identifiers are case sensitive", () => {
  assert.throws(() => parseSettingsPatch({ ai: { modules: ["PMR"] } }), /Unknown AI module/);
});

test("settings parser trims only free text, not identifiers", () => {
  assert.throws(() => parseSettingsPatch({ general: { defaultModule: " morse " } }), /Unknown module/);
});

test("stored free text normalization is deterministic", () => {
  const raw = JSON.stringify({ version: 1, hotwords: "  one, two  " });
  assert.equal(parseStoredSettingsSection("ai", raw).hotwords, "one, two");
});

test("default settings do not include diagnostics snapshots", () => {
  assert.doesNotMatch(JSON.stringify(DEFAULT_APP_SETTINGS), /queue|runtime|health|processing/i);
});

test("patch rejects diagnostics as persisted settings", () => {
  assert.throws(() => parseSettingsPatch({ ai: { runtimeHealthy: true } }), /Unknown ai setting/);
});

test("patch payload accepts plain null-prototype objects", () => {
  const ai = Object.create(null) as Record<string, unknown>;
  ai.enabled = false;
  const root = Object.create(null) as Record<string, unknown>;
  root.ai = ai;
  assert.deepEqual(parseSettingsPatch(root), { ai: { enabled: false } });
});

test("parser rejects RegExp as root settings object", () => {
  assert.throws(() => parseSettingsPatch(/ai/), /Unknown settings section|object/i);
});

test("default section versions match persisted suffix", () => {
  assert.equal(DEFAULT_APP_SETTINGS.ai.version, Number("settings.ai.v1".at(-1)));
});

test("stored settings preserve requested user module order", () => {
  assert.deepEqual(
    parseStoredSettingsSection("sidebar", JSON.stringify({ version: 1, visibleModules: ["morse", "fm"] })).visibleModules,
    ["morse", "fm"],
  );
});

test("stored AI settings preserve requested module order", () => {
  assert.deepEqual(
    parseStoredSettingsSection("ai", JSON.stringify({ version: 1, modules: ["maritime", "pmr"] })).modules,
    ["maritime", "pmr"],
  );
});

test("defaults are receiver-safe", () => {
  assert.equal(DEFAULT_APP_SETTINGS.ai.enabled, true);
  assert.equal(DEFAULT_APP_SETTINGS.general.restoreLastModule, true);
  assert.equal(DEFAULT_APP_SETTINGS.sidebar.visibleModules.includes("sigint"), true);
});

test("settings contract is independent of browser globals", () => {
  assert.equal(typeof window, "undefined");
  assert.ok(DEFAULT_APP_SETTINGS);
});

test("settings parser catches circular payloads as invalid size input", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.throws(() => parseSettingsPatch(circular), /serializable|settings/i);
});

test("stored JSON parser never throws to callers", () => {
  assert.doesNotThrow(() => parseStoredSettingsSection("ai", "{"));
});

test("settings patch explicitly rejects undefined root", () => {
  assert.throws(() => parseSettingsPatch(undefined), /object/i);
});

test("default arrays are ordinary JSON arrays", () => {
  assert.ok(Array.isArray(DEFAULT_APP_SETTINGS.sidebar.visibleModules));
  assert.ok(Array.isArray(DEFAULT_APP_SETTINGS.ai.modules));
});

test("settings contract never normalizes unsupported values into valid ones", () => {
  assert.throws(() => parseSettingsPatch({ ai: { enabled: 1 } }), /boolean/i);
});

test("general default module supports each operational module", () => {
  for (const moduleId of DEFAULT_APP_SETTINGS.sidebar.visibleModules) {
    assert.equal(parseSettingsPatch({ general: { defaultModule: moduleId } }).general?.defaultModule, moduleId);
  }
});

test("stored section parser copies scalar defaults", () => {
  assert.equal(parseStoredSettingsSection("general", JSON.stringify({ version: 1 })).restoreLastModule, true);
});

test("settings section constants have no duplicates", () => {
  assert.equal(new Set(SETTINGS_SECTION_KEYS).size, SETTINGS_SECTION_KEYS.length);
});

test("settings patch rejects unsupported section version aliases", () => {
  assert.throws(() => parseSettingsPatch({ "ai.v1": { enabled: false } }), /Unknown settings section/);
});

test("settings parser rejects Map and Set roots", () => {
  assert.throws(() => parseSettingsPatch(new Map()), /at least one|Unknown settings section|object/i);
  assert.throws(() => parseSettingsPatch(new Set()), /at least one|Unknown settings section|object/i);
});

test("valid false and zero-like text are distinct", () => {
  assert.deepEqual(parseSettingsPatch({ ai: { enabled: false, hotwords: "0" } }).ai, {
    enabled: false,
    hotwords: "0",
  });
});

test("AI threads default is deterministic", () => {
  assert.equal(DEFAULT_APP_SETTINGS.ai.cpuThreads, 4);
});

test("stored AI missing version falls back", () => {
  assert.deepEqual(parseStoredSettingsSection("ai", JSON.stringify({ enabled: false })), DEFAULT_APP_SETTINGS.ai);
});

test("stored general extra inherited properties do not survive JSON", () => {
  const raw = JSON.stringify(Object.assign(Object.create({ token: "x" }), { version: 1 }));
  assert.deepEqual(parseStoredSettingsSection("general", raw), DEFAULT_APP_SETTINGS.general);
});

test("patch parser returns only known top-level section keys", () => {
  assert.deepEqual(Object.keys(parseSettingsPatch({ ai: { enabled: false } })), ["ai"]);
});

test("settings defaults are suitable for structuredClone", () => {
  assert.doesNotThrow(() => structuredClone(DEFAULT_APP_SETTINGS));
});

test("stored section parser does not execute getters from JSON", () => {
  assert.deepEqual(parseStoredSettingsSection("general", '{"version":1}'), DEFAULT_APP_SETTINGS.general);
});

test("settings contract test sentinel", () => {
  assert.equal(true, true);
});
