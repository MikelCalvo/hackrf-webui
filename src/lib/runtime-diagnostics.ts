import type { AdsbRuntimeStatus, AisRuntimeStatus, HardwareStatus } from "@/lib/types";

type PathProbe = {
  exists: boolean;
  writable: boolean;
};

type RuntimeServiceStatus = Pick<AisRuntimeStatus | AdsbRuntimeStatus, "state" | "message">;

export type RuntimeDiagnostics = {
  generatedAt: string;
  app: { name: string; version: string };
  system: { node: string; platform: string; arch: string; cpus: number };
  modes: {
    simulator: boolean;
    replay: boolean;
    authTokenConfigured: boolean;
    publicTokenConfigured: boolean;
    allowedOriginsConfigured: boolean;
  };
  env: Record<string, "configured" | "enabled" | "disabled" | "unset">;
  paths: Record<string, PathProbe & { path: string }>;
  hardware: Omit<HardwareStatus, "serial" | "binaryPath"> & { serial: string; binaryPath: string };
  services: {
    ais: AisRuntimeStatus;
    adsb: AdsbRuntimeStatus;
    radio: {
      stats: Record<string, number>;
      liveSessionCount: number;
      listenerCount: number;
    };
  };
  warnings: string[];
};

export type RuntimeSummary = {
  label: "Healthy" | "Warnings" | "Error";
  tone: "healthy" | "warnings" | "error";
};

export function deriveRuntimeSummary(diagnostics: {
  warnings: string[];
  services: {
    ais: Pick<AisRuntimeStatus, "state">;
    adsb: Pick<AdsbRuntimeStatus, "state">;
  };
}): RuntimeSummary {
  const services: Array<Pick<RuntimeServiceStatus, "state">> = [diagnostics.services.ais, diagnostics.services.adsb];
  if (services.some((service) => service.state === "error")) {
    return { label: "Error", tone: "error" };
  }
  if (diagnostics.warnings.length > 0) {
    return { label: "Warnings", tone: "warnings" };
  }
  return { label: "Healthy", tone: "healthy" };
}
