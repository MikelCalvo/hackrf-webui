"use client";

import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/api-client";
import { CLS_BTN_GHOST, Spinner, cx } from "@/components/module-ui";

type Probe = {
  path: string;
  exists: boolean;
  writable: boolean;
};

type DiagnosticsPayload = {
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
  paths: Record<string, Probe>;
  hardware: { state: string; label: string; message: string; serial: string; binaryPath: string };
  services: {
    ais: { state: string; message: string; updatedAt: string | null };
    adsb: { state: string; message: string; updatedAt: string | null };
    radio: { liveSessionCount: number; listenerCount: number; stats: Record<string, number> };
  };
  warnings: string[];
};

type LoadState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: DiagnosticsPayload; error: null }
  | { status: "error"; data: null; error: string };

function BoolBadge({ active, label }: { active: boolean; label: string }) {
  return (
    <span
      className={cx(
        "rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
        active
          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
          : "border-white/10 bg-white/[0.03] text-[var(--muted)]",
      )}
    >
      {label}: {active ? "on" : "off"}
    </span>
  );
}

function StatusBadge({ value }: { value: string }) {
  const tone = value === "connected" || value === "running" || value === "ready"
    ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
    : value === "error"
      ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
      : "border-amber-300/30 bg-amber-300/10 text-amber-100";
  return <span className={cx("rounded-full border px-2 py-0.5 text-xs font-semibold uppercase", tone)}>{value}</span>;
}

function ProbeRow({ name, probe }: { name: string; probe: Probe }) {
  return (
    <div className="grid gap-2 rounded-2xl border border-white/10 bg-black/20 p-3 sm:grid-cols-[minmax(8rem,12rem)_1fr_auto] sm:items-center">
      <div className="text-sm font-semibold text-white">{name}</div>
      <code className="break-all rounded-lg bg-black/30 px-2 py-1 text-xs text-[var(--muted)]">{probe.path}</code>
      <div className="flex gap-2 text-xs">
        <span className={probe.exists ? "text-emerald-200" : "text-rose-200"}>{probe.exists ? "exists" : "missing"}</span>
        <span className={probe.writable ? "text-emerald-200" : "text-amber-100"}>{probe.writable ? "writable" : "read-only"}</span>
      </div>
    </div>
  );
}

export function RuntimeDiagnosticsPanel() {
  const [state, setState] = useState<LoadState>({ status: "loading", data: null, error: null });

  async function loadDiagnostics(signal?: AbortSignal) {
    setState((current) => current.status === "ready" ? current : { status: "loading", data: null, error: null });
    try {
      const response = await apiFetch("/api/runtime/diagnostics", { cache: "no-store", signal });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(typeof body.message === "string" ? body.message : `Diagnostics failed with ${response.status}`);
      }
      const data = await response.json() as DiagnosticsPayload;
      setState({ status: "ready", data, error: null });
    } catch (error) {
      if ((error as DOMException).name === "AbortError") {
        return;
      }
      setState({ status: "error", data: null, error: error instanceof Error ? error.message : "Diagnostics failed." });
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    void loadDiagnostics(controller.signal);
    return () => controller.abort();
  }, []);

  const pathEntries = useMemo(() => {
    if (state.status !== "ready") {
      return [];
    }
    return Object.entries(state.data.paths);
  }, [state]);

  return (
    <main className="min-h-screen bg-[var(--background)] px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <header className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-200/80">Runtime</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">Runtime diagnostics</h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--muted)]">
                Redacted support view for the local HackRF WebUI runtime: modes, paths, services and warnings without exposing tokens or device serials.
              </p>
            </div>
            <button type="button" className={CLS_BTN_GHOST} onClick={() => void loadDiagnostics()}>
              Refresh diagnostics
            </button>
          </div>
        </header>

        {state.status === "loading" ? (
          <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-8 text-center text-[var(--muted)]">
            <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.03]"><Spinner /></div>
            Loading runtime diagnostics...
          </section>
        ) : null}

        {state.status === "error" ? (
          <section className="rounded-3xl border border-rose-400/20 bg-rose-500/10 p-6 text-rose-100">
            <h2 className="text-lg font-semibold">Diagnostics unavailable</h2>
            <p className="mt-2 text-sm">{state.error}</p>
          </section>
        ) : null}

        {state.status === "ready" ? (
          <>
            <section className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">App</p>
                <p className="mt-2 text-2xl font-bold">{state.data.app.name}</p>
                <p className="text-sm text-[var(--muted)]">v{state.data.app.version}</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">System</p>
                <p className="mt-2 text-2xl font-bold">{state.data.system.node}</p>
                <p className="text-sm text-[var(--muted)]">{state.data.system.platform} / {state.data.system.arch} / {state.data.system.cpus} CPU</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Generated</p>
                <p className="mt-2 text-lg font-semibold">{new Date(state.data.generatedAt).toLocaleString()}</p>
                <p className="text-sm text-[var(--muted)]">no-store API response</p>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="text-lg font-semibold">Modes</h2>
              <div className="mt-4 flex flex-wrap gap-2">
                <BoolBadge active={state.data.modes.simulator} label="Simulator" />
                <BoolBadge active={state.data.modes.replay} label="Replay" />
                <BoolBadge active={state.data.modes.authTokenConfigured} label="API token" />
                <BoolBadge active={state.data.modes.publicTokenConfigured} label="Browser token" />
                <BoolBadge active={state.data.modes.allowedOriginsConfigured} label="Origins" />
              </div>
            </section>

            {state.data.warnings.length > 0 ? (
              <section className="rounded-3xl border border-amber-300/20 bg-amber-300/10 p-5 text-amber-50">
                <h2 className="text-lg font-semibold">Warnings</h2>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
                  {state.data.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                </ul>
              </section>
            ) : (
              <section className="rounded-3xl border border-emerald-400/20 bg-emerald-400/10 p-5 text-emerald-50">
                <h2 className="text-lg font-semibold">No runtime warnings</h2>
                <p className="mt-1 text-sm text-emerald-100/80">Diagnostics did not report missing or failing runtime dependencies.</p>
              </section>
            )}

            <section className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <h2 className="text-lg font-semibold">Hardware</h2>
                <div className="mt-3 flex items-center gap-2"><StatusBadge value={state.data.hardware.state} /><span className="text-sm text-[var(--muted)]">{state.data.hardware.label}</span></div>
                <p className="mt-3 text-sm text-[var(--muted)]">{state.data.hardware.message}</p>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <h2 className="text-lg font-semibold">AIS</h2>
                <div className="mt-3 flex items-center gap-2"><StatusBadge value={state.data.services.ais.state} /><span className="text-sm text-[var(--muted)]">{state.data.services.ais.message}</span></div>
              </div>
              <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
                <h2 className="text-lg font-semibold">ADS-B</h2>
                <div className="mt-3 flex items-center gap-2"><StatusBadge value={state.data.services.adsb.state} /><span className="text-sm text-[var(--muted)]">{state.data.services.adsb.message}</span></div>
              </div>
            </section>

            <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <h2 className="text-lg font-semibold">Runtime paths</h2>
              <div className="mt-4 grid gap-3">
                {pathEntries.map(([name, probe]) => <ProbeRow key={name} name={name} probe={probe} />)}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
