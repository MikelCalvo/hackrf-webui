"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/api-client";
import { APP_MODULES, type AppModuleId } from "@/lib/modules";
import type { AiSettings, AppSettings, AppSettingsPatch } from "@/lib/settings";
import type { AnalysisWorkerStatus } from "@/lib/settings-runtime";
import type { SettingsSnapshot } from "@/lib/settings-runtime";
import { CLS_BTN_GHOST, CLS_BTN_PRIMARY, CLS_INPUT, Spinner, cx } from "@/components/module-ui";

type SettingsResponse = {
  snapshot: SettingsSnapshot;
  analysis: AnalysisWorkerStatus;
};

type SectionId = "general" | "sidebar" | "ai" | "diagnostics";

const SECTIONS: Array<{ id: SectionId; label: string; detail: string }> = [
  { id: "general", label: "General", detail: "Startup behavior" },
  { id: "sidebar", label: "Sidebar", detail: "Visible modules" },
  { id: "ai", label: "AI & Analysis", detail: "Local SIGINT worker" },
  { id: "diagnostics", label: "Diagnostics", detail: "Safe runtime status" },
];

function Toggle({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={cx(
        "relative h-7 w-12 rounded-full border transition",
        checked ? "border-cyan-300/40 bg-cyan-300/20" : "border-white/12 bg-black/30",
        disabled && "cursor-not-allowed opacity-50",
      )}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span className={cx("absolute top-1 h-[18px] w-[18px] rounded-full transition", checked ? "left-6 bg-cyan-200" : "left-1 bg-slate-500")} />
    </button>
  );
}

function StatusPill({ label, tone = "muted" }: { label: string; tone?: "good" | "warn" | "bad" | "muted" }) {
  return <span className={cx(
    "rounded-full border px-2.5 py-1 font-mono text-[9px] font-semibold uppercase tracking-[0.14em]",
    tone === "good" && "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
    tone === "warn" && "border-amber-400/25 bg-amber-400/10 text-amber-200",
    tone === "bad" && "border-rose-400/25 bg-rose-400/10 text-rose-200",
    tone === "muted" && "border-white/10 bg-white/[0.03] text-[var(--muted-strong)]",
  )}>{label}</span>;
}

function SettingRow({ title, detail, badge, children }: { title: string; detail: string; badge?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-20 items-center justify-between gap-6 border-b border-white/[0.06] px-5 py-4 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>
          {badge ? <StatusPill label={badge} tone={badge === "LIVE" ? "good" : "muted"} /> : null}
        </div>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--muted)]">{detail}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

async function readSettings(refreshRuntime = false): Promise<SettingsResponse> {
  const response = await apiFetch(`/api/settings${refreshRuntime ? "?refreshRuntime=1" : ""}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Settings request failed with HTTP ${response.status}.`);
  return await response.json() as SettingsResponse;
}

export function SettingsModule({ onSettingsChanged }: { onSettingsChanged: (settings: AppSettings) => void }) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("general");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");

  const load = useCallback(async (refreshRuntime = false) => {
    setBusy(true);
    setError("");
    try {
      const next = await readSettings(refreshRuntime);
      setData(next);
      onSettingsChanged(next.snapshot.values);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not read settings.");
    } finally {
      setBusy(false);
    }
  }, [onSettingsChanged]);

  useEffect(() => { void load(); }, [load]);

  async function save(patch: AppSettingsPatch): Promise<void> {
    setBusy(true);
    setError("");
    setSavedMessage("");
    try {
      const response = await apiFetch("/api/settings", {
        method: "PATCH",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const payload = await response.json() as SettingsResponse & { message?: string };
      if (!response.ok) throw new Error(payload.message || `Settings update failed with HTTP ${response.status}.`);
      setData(payload);
      onSettingsChanged(payload.snapshot.values);
      setSavedMessage("Saved on this receiver");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save settings.");
    } finally {
      setBusy(false);
    }
  }

  async function processBacklog(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/api/settings/ai/backfill", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 48 }),
      });
      const result = await response.json() as { queued?: number; enabled?: boolean; message?: string };
      if (!response.ok) throw new Error(result.message || "Backfill request failed.");
      setSavedMessage(result.enabled ? `Queued ${result.queued ?? 0} captures for analysis` : "Enable AI before processing the queue");
      await load();
    } catch (backfillError) {
      setError(backfillError instanceof Error ? backfillError.message : "Could not queue captures.");
      setBusy(false);
    }
  }

  const values = data?.snapshot.values;
  const analysis = data?.analysis;
  const visibleSet = useMemo(() => new Set(values?.sidebar.visibleModules ?? []), [values?.sidebar.visibleModules]);

  function toggleVisibleModule(moduleId: AppModuleId): void {
    if (!values) return;
    const next = visibleSet.has(moduleId)
      ? values.sidebar.visibleModules.filter((id) => id !== moduleId)
      : [...values.sidebar.visibleModules, moduleId];
    if (next.length === 0) return;
    void save({ sidebar: { visibleModules: next } });
  }

  function updateAi<K extends keyof Omit<AiSettings, "version">>(key: K, value: AiSettings[K]): void {
    void save({ ai: { [key]: value } });
  }

  function toggleAiModule(moduleId: AiSettings["modules"][number]): void {
    if (!values) return;
    const next: AiSettings["modules"] = values.ai.modules.includes(moduleId)
      ? values.ai.modules.filter((id: AiSettings["modules"][number]) => id !== moduleId)
      : [...values.ai.modules, moduleId];
    updateAi("modules", next);
  }

  if (!data && busy) {
    return <div className="flex flex-1 items-center justify-center"><Spinner /></div>;
  }

  return (
    <main className="flex min-w-0 flex-1 overflow-hidden bg-[radial-gradient(circle_at_top_right,rgba(34,211,238,0.06),transparent_34%)]">
      <aside className="w-64 shrink-0 border-r border-white/8 bg-black/10 p-4">
        <div className="mb-6 px-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-cyan-300">Receiver control</p>
          <h1 className="mt-2 text-xl font-semibold text-[var(--foreground)]">Settings</h1>
          <p className="mt-2 text-xs leading-5 text-[var(--muted)]">Persistent preferences for this receiver. Opening this page never acquires or changes the HackRF.</p>
        </div>
        <nav className="space-y-1" aria-label="Settings sections">
          {SECTIONS.map((section) => <button key={section.id} className={cx("w-full rounded-xl border px-3 py-3 text-left transition", activeSection === section.id ? "border-cyan-300/25 bg-cyan-300/8" : "border-transparent hover:border-white/8 hover:bg-white/[0.025]")} onClick={() => setActiveSection(section.id)} type="button"><span className="block text-sm font-medium">{section.label}</span><span className="mt-1 block text-[10px] text-[var(--muted)]">{section.detail}</span></button>)}
        </nav>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div><p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">Settings V1</p><h2 className="mt-1 text-2xl font-semibold">{SECTIONS.find((item) => item.id === activeSection)?.label}</h2></div>
            <div className="flex items-center gap-2">{savedMessage ? <StatusPill label={savedMessage} tone="good" /> : null}{busy ? <Spinner /> : null}</div>
          </div>
          {error ? <div className="mb-4 rounded-xl border border-rose-400/25 bg-rose-400/8 px-4 py-3 text-sm text-rose-100">{error}</div> : null}

          {activeSection === "general" && values ? <div className="overflow-hidden rounded-2xl border border-white/8 bg-black/15">
            <SettingRow title="Restore last operational module" detail="Return to the last RF or SIGINT module on the next browser run. Settings itself is never remembered as the startup page." badge="NEXT RUN"><Toggle checked={values.general.restoreLastModule} disabled={busy} label="Restore last operational module" onChange={(checked) => void save({ general: { restoreLastModule: checked } })} /></SettingRow>
            <SettingRow title="Default module" detail="Used when restore-last is disabled or no previous module is available." badge="NEXT RUN"><select className={CLS_INPUT} disabled={busy} value={values.general.defaultModule ?? ""} onChange={(event) => void save({ general: { defaultModule: event.target.value ? event.target.value as AppModuleId : null } })}><option value="">Built-in default</option>{APP_MODULES.map((module) => <option key={module.id} value={module.id}>{module.label}</option>)}</select></SettingRow>
          </div> : null}

          {activeSection === "sidebar" && values ? <div className="overflow-hidden rounded-2xl border border-white/8 bg-black/15">
            <SettingRow title="Compact sidebar" detail="Reduce the navigation width and hide frequency subtitles. The Settings control remains pinned at the bottom." badge="LIVE"><Toggle checked={values.sidebar.compact} disabled={busy} label="Compact sidebar" onChange={(checked) => void save({ sidebar: { compact: checked } })} /></SettingRow>
            <div className="p-5"><h3 className="text-sm font-semibold">Visible operational modules</h3><p className="mt-1 text-xs text-[var(--muted)]">At least one module must remain visible. This does not stop running sessions or delete data.</p><div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">{APP_MODULES.map((module) => <button key={module.id} aria-pressed={visibleSet.has(module.id)} className={cx("rounded-xl border px-3 py-3 text-left transition", visibleSet.has(module.id) ? "border-cyan-300/25 bg-cyan-300/8 text-cyan-100" : "border-white/8 bg-white/[0.02] text-[var(--muted)]")} disabled={busy || (visibleSet.has(module.id) && visibleSet.size === 1)} onClick={() => toggleVisibleModule(module.id)} type="button"><span className="block text-xs font-semibold uppercase">{module.label}</span><span className="mt-1 block font-mono text-[9px] opacity-65">{module.band}</span></button>)}</div></div>
          </div> : null}

          {activeSection === "ai" && values && analysis ? <div className="overflow-hidden rounded-2xl border border-white/8 bg-black/15">
            <SettingRow title="Enable local AI analysis" detail={analysis.lockedByRuntime ? analysis.runtimePolicyReason ?? "Disabled by runtime policy." : "LIVE. When disabled, new jobs are not queued and queued jobs are not claimed. A job already running is allowed to finish."} badge="LIVE"><Toggle checked={analysis.lockedByRuntime ? false : values.ai.enabled} disabled={busy || analysis.lockedByRuntime} label="Enable local AI analysis" onChange={(checked) => updateAi("enabled", checked)} /></SettingRow>
            <SettingRow title="CPU threads" detail="Applied to the next analysis job. This never restarts an RF session." badge="NEXT JOB"><input aria-label="AI CPU threads" className={`${CLS_INPUT} w-24`} disabled={busy || analysis.lockedByRuntime} max={8} min={1} type="number" value={values.ai.cpuThreads} onChange={(event) => updateAi("cpuThreads", Number(event.target.value))} /></SettingRow>
            <SettingRow title="Hotwords" detail="Optional receiver-specific vocabulary for the next transcription job. No model or network download is triggered." badge="NEXT JOB"><input aria-label="AI hotwords" className={`${CLS_INPUT} w-72`} disabled={busy || analysis.lockedByRuntime} maxLength={1000} placeholder="mayday, coast guard" value={values.ai.hotwords} onChange={(event) => updateAi("hotwords", event.target.value)} /></SettingRow>
            <div className="border-b border-white/[0.06] p-5">
              <h3 className="text-sm font-semibold">Analysis modules</h3>
              <p className="mt-1 text-xs leading-5 text-[var(--muted)]">Choose which speech-oriented capture modules can create local AI jobs. MORSE is intentionally excluded.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {(["pmr", "airband", "maritime"] as const).map((moduleId) => (
                  <button
                    aria-pressed={values.ai.modules.includes(moduleId)}
                    className={cx(
                      "rounded-xl border px-4 py-2 text-xs font-semibold uppercase transition",
                      values.ai.modules.includes(moduleId)
                        ? "border-cyan-300/25 bg-cyan-300/8 text-cyan-100"
                        : "border-white/8 bg-white/[0.02] text-[var(--muted)]",
                    )}
                    disabled={busy || analysis.lockedByRuntime}
                    key={moduleId}
                    onClick={() => toggleAiModule(moduleId)}
                    type="button"
                  >
                    {moduleId}
                  </button>
                ))}
              </div>
            </div>
            <div className="p-5"><div className="flex flex-wrap gap-2"><StatusPill label={analysis.lockedByRuntime ? "Runtime locked" : analysis.enabled ? "Enabled" : "Paused"} tone={analysis.enabled ? "good" : "warn"} /><StatusPill label={analysis.runtimeInstalled ? "Runtime installed" : "Runtime missing"} tone={analysis.runtimeInstalled ? "good" : "bad"} /><StatusPill label={`${analysis.queuedJobs} queued`} /><StatusPill label={`${analysis.heldQueuedJobs} held`} /><StatusPill label={analysis.processing ? "Processing" : "Idle"} tone={analysis.processing ? "good" : "muted"} /></div><p className="mt-4 text-xs leading-5 text-[var(--muted)]">Enabling AI handles new captures only. Existing queued or historical captures remain held until you explicitly request processing.</p><button className={`${CLS_BTN_PRIMARY} mt-4`} disabled={busy || !analysis.enabled || analysis.lockedByRuntime} onClick={() => void processBacklog()} type="button">Process queued captures</button></div>
          </div> : null}

          {activeSection === "diagnostics" && analysis ? <div className="overflow-hidden rounded-2xl border border-white/8 bg-black/15"><div className="grid grid-cols-2 gap-px bg-white/[0.06] md:grid-cols-3">{[
            ["AI policy", analysis.enabled ? "Enabled" : "Paused"], ["Runtime", analysis.runtimeInstalled ? (analysis.runtimeHealthy === false ? "Error" : "Installed") : "Missing"], ["Worker", analysis.processing ? "Processing" : analysis.workerRunning ? "Ready" : "Idle"], ["Queued", String(analysis.queuedJobs)], ["Held queue", String(analysis.heldQueuedJobs)], ["Running jobs", String(analysis.runningJobs)],
          ].map(([label, value]) => <div className="bg-[var(--background)]/85 p-5" key={label}><p className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">{label}</p><p className="mt-2 text-lg font-semibold">{value}</p></div>)}</div><div className="flex items-center justify-between gap-4 p-5"><p className="text-xs leading-5 text-[var(--muted)]">Diagnostics expose status only. They do not include credentials, private paths or receiver serials.</p><button className={CLS_BTN_GHOST} disabled={busy} onClick={() => void load(true)} type="button">Refresh diagnostics · refreshRuntime=1</button></div></div> : null}
        </div>
      </section>
    </main>
  );
}
