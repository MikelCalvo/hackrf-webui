import { APP_MODULES, type AppModuleId } from "@/lib/modules";

export const SETTINGS_SECTION_KEYS = Object.freeze(["general", "sidebar", "ai"] as const);
export type SettingsSectionKey = (typeof SETTINGS_SECTION_KEYS)[number];

export const SETTINGS_STORAGE_KEYS: Record<SettingsSectionKey, string> = {
  general: "settings.general.v1",
  sidebar: "settings.sidebar.v1",
  ai: "settings.ai.v1",
};

export const AI_ANALYSIS_MODULES = Object.freeze(["pmr", "airband", "maritime"] as const);
export type AiAnalysisModule = (typeof AI_ANALYSIS_MODULES)[number];

export type GeneralSettings = {
  version: 1;
  restoreLastModule: boolean;
  defaultModule: AppModuleId | null;
};

export type SidebarSettings = {
  version: 1;
  compact: boolean;
  visibleModules: AppModuleId[];
};

export type AiSettings = {
  version: 1;
  enabled: boolean;
  cpuThreads: number;
  hotwords: string;
  modules: AiAnalysisModule[];
};

export type AppSettings = {
  general: GeneralSettings;
  sidebar: SidebarSettings;
  ai: AiSettings;
};

export type GeneralSettingsPatch = Partial<Omit<GeneralSettings, "version">>;
export type SidebarSettingsPatch = Partial<Omit<SidebarSettings, "version">>;
export type AiSettingsPatch = Partial<Omit<AiSettings, "version">>;

export type AppSettingsPatch = {
  general?: GeneralSettingsPatch;
  sidebar?: SidebarSettingsPatch;
  ai?: AiSettingsPatch;
};

const OPERATIONAL_MODULES = APP_MODULES.filter((module) => module.live).map((module) => module.id) as AppModuleId[];
const OPERATIONAL_MODULE_SET = new Set<string>(OPERATIONAL_MODULES);
const AI_MODULE_SET = new Set<string>(AI_ANALYSIS_MODULES);
const MAX_PATCH_JSON_BYTES = 64 * 1024;
const MAX_HOTWORDS_LENGTH = 1_000;

export const DEFAULT_APP_SETTINGS: AppSettings = {
  general: {
    version: 1,
    restoreLastModule: true,
    defaultModule: null,
  },
  sidebar: {
    version: 1,
    compact: false,
    visibleModules: [...OPERATIONAL_MODULES],
  },
  ai: {
    version: 1,
    enabled: true,
    cpuThreads: 4,
    hotwords: "",
    modules: [...AI_ANALYSIS_MODULES],
  },
};

function cloneSection<K extends SettingsSectionKey>(section: K, value: AppSettings[K]): AppSettings[K] {
  if (section === "sidebar") {
    return { ...value, visibleModules: [...(value as SidebarSettings).visibleModules] } as AppSettings[K];
  }
  if (section === "ai") {
    return { ...value, modules: [...(value as AiSettings).modules] } as AppSettings[K];
  }
  return { ...value } as AppSettings[K];
}

export function cloneAppSettings(settings: AppSettings = DEFAULT_APP_SETTINGS): AppSettings {
  return {
    general: cloneSection("general", settings.general),
    sidebar: cloneSection("sidebar", settings.sidebar),
    ai: cloneSection("ai", settings.ai),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.prototype.toString.call(value) === "[object Object]";
}

function assertJsonBudget(value: unknown): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error("Settings payload must be JSON serializable.");
  }
  if (serialized !== undefined && Buffer.byteLength(serialized, "utf8") > MAX_PATCH_JSON_BYTES) {
    throw new Error("Settings payload is too large.");
  }
}

function assertKnownKeys(record: Record<string, unknown>, allowed: readonly string[], context: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      throw new Error(`Unknown ${context} setting: ${key}`);
    }
  }
}

function requireBoolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${context} must be a boolean.`);
  }
  return value;
}

function requireCpuThreads(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error("ai.cpuThreads must be an integer between 1 and 8.");
  }
  if (value < 1 || value > 8) {
    throw new Error("ai.cpuThreads must be between 1 and 8.");
  }
  return value;
}

function requireHotwords(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("ai.hotwords must be a string.");
  }
  const normalized = value.trim();
  if (normalized.length > MAX_HOTWORDS_LENGTH) {
    throw new Error(`ai.hotwords must be at most ${MAX_HOTWORDS_LENGTH} characters.`);
  }
  return normalized;
}

function requireOperationalModule(value: unknown, context: string): AppModuleId {
  if (typeof value !== "string" || !OPERATIONAL_MODULE_SET.has(value)) {
    throw new Error(`Unknown module for ${context}: ${String(value)}`);
  }
  return value as AppModuleId;
}

function requireUniqueOperationalModules(value: unknown): AppModuleId[] {
  if (!Array.isArray(value)) {
    throw new Error("sidebar.visibleModules must be an array of module identifiers.");
  }
  if (value.length === 0) {
    throw new Error("sidebar.visibleModules must keep at least one operational module visible.");
  }
  const modules = value.map((entry) => requireOperationalModule(entry, "sidebar.visibleModules"));
  if (new Set(modules).size !== modules.length) {
    throw new Error("sidebar.visibleModules must contain unique modules.");
  }
  return modules;
}

function requireUniqueAiModules(value: unknown): AiAnalysisModule[] {
  if (!Array.isArray(value)) {
    throw new Error("ai.modules must be an array of AI module identifiers.");
  }
  const modules = value.map((entry) => {
    if (typeof entry !== "string" || !AI_MODULE_SET.has(entry)) {
      throw new Error(`Unknown AI module: ${String(entry)}`);
    }
    return entry as AiAnalysisModule;
  });
  if (new Set(modules).size !== modules.length) {
    throw new Error("ai.modules must contain unique modules.");
  }
  return modules;
}

function parseGeneralPatch(value: unknown): GeneralSettingsPatch {
  if (!isRecord(value)) {
    throw new Error("general settings must be an object.");
  }
  assertKnownKeys(value, ["restoreLastModule", "defaultModule"], "general");
  if (Object.keys(value).length === 0) {
    throw new Error("Provide at least one general setting.");
  }
  const patch: GeneralSettingsPatch = {};
  if (Object.hasOwn(value, "restoreLastModule")) {
    patch.restoreLastModule = requireBoolean(value.restoreLastModule, "general.restoreLastModule");
  }
  if (Object.hasOwn(value, "defaultModule")) {
    patch.defaultModule = value.defaultModule === null
      ? null
      : requireOperationalModule(value.defaultModule, "general.defaultModule");
  }
  return patch;
}

function parseSidebarPatch(value: unknown): SidebarSettingsPatch {
  if (!isRecord(value)) {
    throw new Error("sidebar settings must be an object.");
  }
  assertKnownKeys(value, ["compact", "visibleModules"], "sidebar");
  if (Object.keys(value).length === 0) {
    throw new Error("Provide at least one sidebar setting.");
  }
  const patch: SidebarSettingsPatch = {};
  if (Object.hasOwn(value, "compact")) {
    patch.compact = requireBoolean(value.compact, "sidebar.compact");
  }
  if (Object.hasOwn(value, "visibleModules")) {
    patch.visibleModules = requireUniqueOperationalModules(value.visibleModules);
  }
  return patch;
}

function parseAiPatch(value: unknown): AiSettingsPatch {
  if (!isRecord(value)) {
    throw new Error("ai settings must be an object.");
  }
  assertKnownKeys(value, ["enabled", "cpuThreads", "hotwords", "modules"], "ai");
  if (Object.keys(value).length === 0) {
    throw new Error("Provide at least one ai setting.");
  }
  const patch: AiSettingsPatch = {};
  if (Object.hasOwn(value, "enabled")) {
    patch.enabled = requireBoolean(value.enabled, "ai.enabled");
  }
  if (Object.hasOwn(value, "cpuThreads")) {
    patch.cpuThreads = requireCpuThreads(value.cpuThreads);
  }
  if (Object.hasOwn(value, "hotwords")) {
    patch.hotwords = requireHotwords(value.hotwords);
  }
  if (Object.hasOwn(value, "modules")) {
    patch.modules = requireUniqueAiModules(value.modules);
  }
  return patch;
}

export function parseSettingsPatch(value: unknown): AppSettingsPatch {
  assertJsonBudget(value);
  if (!isRecord(value)) {
    throw new Error("Settings patch must be an object.");
  }
  const sectionKeys = Object.keys(value);
  if (sectionKeys.length === 0) {
    throw new Error("Provide at least one settings section.");
  }
  for (const key of sectionKeys) {
    if (!(SETTINGS_SECTION_KEYS as readonly string[]).includes(key)) {
      throw new Error(`Unknown settings section: ${key}`);
    }
  }
  const patch: AppSettingsPatch = {};
  if (Object.hasOwn(value, "general")) patch.general = parseGeneralPatch(value.general);
  if (Object.hasOwn(value, "sidebar")) patch.sidebar = parseSidebarPatch(value.sidebar);
  if (Object.hasOwn(value, "ai")) patch.ai = parseAiPatch(value.ai);
  return patch;
}

function parseStoredGeneral(value: Record<string, unknown>): GeneralSettings {
  assertKnownKeys(value, ["version", "restoreLastModule", "defaultModule"], "general");
  if (value.version !== 1) throw new Error("Unsupported general settings version.");
  const patch: GeneralSettingsPatch = {};
  if (Object.hasOwn(value, "restoreLastModule")) patch.restoreLastModule = requireBoolean(value.restoreLastModule, "general.restoreLastModule");
  if (Object.hasOwn(value, "defaultModule")) patch.defaultModule = value.defaultModule === null ? null : requireOperationalModule(value.defaultModule, "general.defaultModule");
  return { ...DEFAULT_APP_SETTINGS.general, ...patch };
}

function parseStoredSidebar(value: Record<string, unknown>): SidebarSettings {
  assertKnownKeys(value, ["version", "compact", "visibleModules"], "sidebar");
  if (value.version !== 1) throw new Error("Unsupported sidebar settings version.");
  const patch: SidebarSettingsPatch = {};
  if (Object.hasOwn(value, "compact")) patch.compact = requireBoolean(value.compact, "sidebar.compact");
  if (Object.hasOwn(value, "visibleModules")) patch.visibleModules = requireUniqueOperationalModules(value.visibleModules);
  return { ...DEFAULT_APP_SETTINGS.sidebar, ...patch, visibleModules: patch.visibleModules ?? [...DEFAULT_APP_SETTINGS.sidebar.visibleModules] };
}

function parseStoredAi(value: Record<string, unknown>): AiSettings {
  assertKnownKeys(value, ["version", "enabled", "cpuThreads", "hotwords", "modules"], "ai");
  if (value.version !== 1) throw new Error("Unsupported ai settings version.");
  const patch: AiSettingsPatch = {};
  if (Object.hasOwn(value, "enabled")) patch.enabled = requireBoolean(value.enabled, "ai.enabled");
  if (Object.hasOwn(value, "cpuThreads")) patch.cpuThreads = requireCpuThreads(value.cpuThreads);
  if (Object.hasOwn(value, "hotwords")) patch.hotwords = requireHotwords(value.hotwords);
  if (Object.hasOwn(value, "modules")) patch.modules = requireUniqueAiModules(value.modules);
  return { ...DEFAULT_APP_SETTINGS.ai, ...patch, modules: patch.modules ?? [...DEFAULT_APP_SETTINGS.ai.modules] };
}

export function parseStoredSettingsSection<K extends SettingsSectionKey>(section: K, raw: string): AppSettings[K] {
  try {
    const value = JSON.parse(raw) as unknown;
    if (!isRecord(value)) throw new Error("Stored settings must be an object.");
    if (section === "general") return parseStoredGeneral(value) as AppSettings[K];
    if (section === "sidebar") return parseStoredSidebar(value) as AppSettings[K];
    return parseStoredAi(value) as AppSettings[K];
  } catch {
    return cloneSection(section, DEFAULT_APP_SETTINGS[section]);
  }
}

export function mergeSettingsPatch(current: AppSettings, patch: AppSettingsPatch): AppSettings {
  return {
    general: { ...current.general, ...patch.general },
    sidebar: {
      ...current.sidebar,
      ...patch.sidebar,
      visibleModules: patch.sidebar?.visibleModules
        ? [...patch.sidebar.visibleModules]
        : [...current.sidebar.visibleModules],
    },
    ai: {
      ...current.ai,
      ...patch.ai,
      modules: patch.ai?.modules ? [...patch.ai.modules] : [...current.ai.modules],
    },
  };
}
