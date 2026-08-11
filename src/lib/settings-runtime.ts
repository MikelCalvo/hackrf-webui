import type { AiSettings, AppSettings, SettingsSectionKey } from "@/lib/settings";

type RuntimeEnvironment = Record<string, string | undefined>;

function isTruthyRuntimeFlag(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes" || value?.toLowerCase() === "on";
}

export function applyAiEnvironmentDefaults(saved: AiSettings, env: RuntimeEnvironment): AiSettings {
  const threads = Number.parseInt(env.HACKRF_WEBUI_AI_CPU_THREADS?.trim() ?? "", 10);
  const hotwords = env.HACKRF_WEBUI_AI_HOTWORDS?.trim() ?? "";
  return {
    ...saved,
    cpuThreads: Number.isInteger(threads) && threads >= 1 && threads <= 8 ? threads : saved.cpuThreads,
    hotwords: hotwords.length <= 1000 ? hotwords : saved.hotwords,
    modules: [...saved.modules],
  };
}

export function resolveSavedAiSettings(
  saved: AiSettings,
  source: SettingsSectionSource,
  env: RuntimeEnvironment,
): AiSettings {
  return source === "default"
    ? applyAiEnvironmentDefaults(saved, env)
    : { ...saved, modules: [...saved.modules] };
}

export function runtimeAiDisableReason(env: RuntimeEnvironment): string | null {
  if (isTruthyRuntimeFlag(env.HACKRF_WEBUI_SKIP_AI)) {
    return "Disabled by HACKRF_WEBUI_SKIP_AI runtime policy.";
  }
  if (isTruthyRuntimeFlag(env.SKIP_AI)) {
    return "Disabled by SKIP_AI runtime policy.";
  }
  return null;
}

export function resolveEffectiveAiSettings(saved: AiSettings, env: RuntimeEnvironment): AiSettings {
  return runtimeAiDisableReason(env)
    ? { ...saved, enabled: false, modules: [...saved.modules] }
    : { ...saved, modules: [...saved.modules] };
}

export type SettingsSectionSource = "default" | "database" | "database-invalid";

export type SettingsSnapshot = {
  values: AppSettings;
  sections: Record<SettingsSectionKey, {
    source: SettingsSectionSource;
    updatedAtMs: number | null;
  }>;
};

export type AnalysisWorkerStatus = {
  enabled: boolean;
  savedEnabled: boolean;
  lockedByRuntime: boolean;
  runtimePolicyReason: string | null;
  runtimeInstalled: boolean;
  runtimeHealthy: boolean | null;
  runtimeError: string;
  workerRunning: boolean;
  processing: boolean;
  queuedJobs: number;
  heldQueuedJobs: number;
  runningJobs: number;
  currentJob: { id: string; captureSessionId: string } | null;
  lastResult: { status: "completed" | "failed"; endedAtMs: number; errorText: string | null } | null;
};
