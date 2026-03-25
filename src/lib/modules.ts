export const LAST_MODULE_STORAGE_KEY = "hackrf-webui.active-module.v1";
export const LAST_MODULE_COOKIE_KEY = "hackrf_webui_module";

export const APP_MODULES = [
  { id: "sigint", label: "SIGINT", band: "review", path: "/sigint", live: true, section: "intel" },
  { id: "fm", label: "FM", band: "87.5-108", path: "/fm", live: true },
  { id: "pmr", label: "PMR", band: "446 MHz", path: "/pmr", live: true },
  { id: "airband", label: "Airband", band: "118-137", path: "/airband", live: true },
  { id: "maritime", label: "Maritime", band: "156-162", path: "/maritime", live: true },
  { id: "adsb", label: "ADS-B", band: "1090 MHz", path: "/adsb", live: true },
  { id: "ais", label: "AIS", band: "162 MHz", path: "/ais", live: true },
] as const;

export type AppModuleId = Extract<(typeof APP_MODULES)[number], { live: true }>["id"];

export const DEFAULT_APP_MODULE: AppModuleId = "fm";

export function isAppModuleId(value: string): value is AppModuleId {
  return APP_MODULES.some((module) => module.live && module.id === value);
}

export function getAppModulePath(moduleId: AppModuleId): string {
  return APP_MODULES.find((module) => module.id === moduleId)?.path ?? "/fm";
}

export function getCookieHeaderForModule(moduleId: AppModuleId): string {
  return `${LAST_MODULE_COOKIE_KEY}=${moduleId}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function readStoredAppModule(): AppModuleId | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(LAST_MODULE_STORAGE_KEY);
    return raw && isAppModuleId(raw) ? raw : null;
  } catch {
    return null;
  }
}
