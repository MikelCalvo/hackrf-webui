"use client";

import { CLS_BTN_GHOST, CLS_BTN_PRIMARY, Spinner, cx } from "@/components/module-ui";
import type { AudioControls, RadioChannel } from "@/lib/radio";
import type { ActivityCaptureRequestMeta, ResolvedAppLocation } from "@/lib/types";
import { buildCatalogScopeLabel } from "@/lib/location";

export { CLS_BTN_GHOST, CLS_BTN_PRIMARY, Spinner, cx };

export function buildActivityCaptureMeta(
  base: Pick<ActivityCaptureRequestMeta, "module" | "mode"> & Partial<ActivityCaptureRequestMeta>,
  options: {
    location: ResolvedAppLocation | null;
    squelch?: number | null;
    channelNotes?: string | null;
  },
): ActivityCaptureRequestMeta {
  const location = options.location;
  return {
    ...base,
    channelNotes: options.channelNotes ?? base.channelNotes ?? null,
    squelch: options.squelch ?? base.squelch ?? null,
    sourceMode: location?.sourceMode ?? null,
    gpsdFallbackMode: location?.gpsdFallbackMode ?? null,
    sourceStatus: location?.sourceStatus ?? null,
    sourceDetail:
      location?.sourceMode === "catalog"
        ? buildCatalogScopeLabel(location.catalogScope)
        : location?.sourceDetail ?? null,
    regionId: location?.catalogScope.regionId ?? null,
    regionName: location?.catalogScope.regionName ?? null,
    countryId: location?.catalogScope.countryId ?? null,
    countryCode: location?.catalogScope.countryCode ?? null,
    countryName: location?.catalogScope.countryName ?? null,
    cityId: location?.catalogScope.cityId ?? null,
    cityName: location?.catalogScope.cityName ?? null,
    resolvedLatitude: location?.resolvedPosition?.latitude ?? null,
    resolvedLongitude: location?.resolvedPosition?.longitude ?? null,
  };
}

export function buildRadioStreamUrl(
  pathname: string,
  channel: Pick<RadioChannel, "label" | "freqMhz"> & Partial<Pick<RadioChannel, "id" | "bandId" | "number">>,
  controls: AudioControls,
  activityCapture?: Partial<ActivityCaptureRequestMeta> | null,
): string {
  const params = new URLSearchParams({
    label: channel.label,
    freqMHz: String(channel.freqMhz),
    lna: String(controls.lna),
    vga: String(controls.vga),
    audioGain: String(controls.audioGain),
    t: String(Date.now()),
  });

  if (activityCapture?.module) {
    params.set("module", activityCapture.module);
  }
  if (activityCapture?.mode) {
    params.set("activityMode", activityCapture.mode);
  }

  const bandId = activityCapture?.bandId ?? channel.bandId ?? null;
  const channelId = activityCapture?.channelId ?? channel.id ?? null;
  const channelNumber = activityCapture?.channelNumber ?? channel.number ?? null;

  if (bandId) {
    params.set("bandId", bandId);
  }
  if (channelId) {
    params.set("channelId", channelId);
  }
  if (Number.isFinite(channelNumber)) {
    params.set("channelNumber", String(channelNumber));
  }
  if (activityCapture?.channelNotes) {
    params.set("channelNotes", activityCapture.channelNotes);
  }
  if (Number.isFinite(activityCapture?.squelch)) {
    params.set("squelch", String(activityCapture?.squelch));
  }
  if (activityCapture?.sourceMode) {
    params.set("sourceMode", activityCapture.sourceMode);
  }
  if (activityCapture?.gpsdFallbackMode) {
    params.set("gpsdFallbackMode", activityCapture.gpsdFallbackMode);
  }
  if (activityCapture?.sourceStatus) {
    params.set("sourceStatus", activityCapture.sourceStatus);
  }
  if (activityCapture?.sourceDetail) {
    params.set("sourceDetail", activityCapture.sourceDetail);
  }
  if (activityCapture?.regionId) {
    params.set("regionId", activityCapture.regionId);
  }
  if (activityCapture?.regionName) {
    params.set("regionName", activityCapture.regionName);
  }
  if (activityCapture?.countryId) {
    params.set("countryId", activityCapture.countryId);
  }
  if (activityCapture?.countryCode) {
    params.set("countryCode", activityCapture.countryCode);
  }
  if (activityCapture?.countryName) {
    params.set("countryName", activityCapture.countryName);
  }
  if (activityCapture?.cityId) {
    params.set("cityId", activityCapture.cityId);
  }
  if (activityCapture?.cityName) {
    params.set("cityName", activityCapture.cityName);
  }
  if (Number.isFinite(activityCapture?.resolvedLatitude)) {
    params.set("resolvedLatitude", String(activityCapture?.resolvedLatitude));
  }
  if (Number.isFinite(activityCapture?.resolvedLongitude)) {
    params.set("resolvedLongitude", String(activityCapture?.resolvedLongitude));
  }

  return `${pathname}?${params.toString()}`;
}

export function buildRadioRetuneUrl(
  pathname: string,
  channel: Pick<RadioChannel, "label" | "freqMhz"> & Partial<Pick<RadioChannel, "id" | "bandId" | "number">>,
  activityCapture?: Partial<ActivityCaptureRequestMeta> | null,
): string {
  const params = new URLSearchParams({
    label: channel.label,
    freqMHz: String(channel.freqMhz),
  });

  if (activityCapture?.module) {
    params.set("module", activityCapture.module);
  }
  if (activityCapture?.mode) {
    params.set("activityMode", activityCapture.mode);
  }

  const bandId = activityCapture?.bandId ?? channel.bandId ?? null;
  const channelId = activityCapture?.channelId ?? channel.id ?? null;
  const channelNumber = activityCapture?.channelNumber ?? channel.number ?? null;

  if (bandId) {
    params.set("bandId", bandId);
  }
  if (channelId) {
    params.set("channelId", channelId);
  }
  if (Number.isFinite(channelNumber)) {
    params.set("channelNumber", String(channelNumber));
  }
  if (activityCapture?.channelNotes) {
    params.set("channelNotes", activityCapture.channelNotes);
  }
  if (Number.isFinite(activityCapture?.squelch)) {
    params.set("squelch", String(activityCapture?.squelch));
  }
  if (activityCapture?.sourceMode) {
    params.set("sourceMode", activityCapture.sourceMode);
  }
  if (activityCapture?.gpsdFallbackMode) {
    params.set("gpsdFallbackMode", activityCapture.gpsdFallbackMode);
  }
  if (activityCapture?.sourceStatus) {
    params.set("sourceStatus", activityCapture.sourceStatus);
  }
  if (activityCapture?.sourceDetail) {
    params.set("sourceDetail", activityCapture.sourceDetail);
  }
  if (activityCapture?.regionId) {
    params.set("regionId", activityCapture.regionId);
  }
  if (activityCapture?.regionName) {
    params.set("regionName", activityCapture.regionName);
  }
  if (activityCapture?.countryId) {
    params.set("countryId", activityCapture.countryId);
  }
  if (activityCapture?.countryCode) {
    params.set("countryCode", activityCapture.countryCode);
  }
  if (activityCapture?.countryName) {
    params.set("countryName", activityCapture.countryName);
  }
  if (activityCapture?.cityId) {
    params.set("cityId", activityCapture.cityId);
  }
  if (activityCapture?.cityName) {
    params.set("cityName", activityCapture.cityName);
  }
  if (Number.isFinite(activityCapture?.resolvedLatitude)) {
    params.set("resolvedLatitude", String(activityCapture?.resolvedLatitude));
  }
  if (Number.isFinite(activityCapture?.resolvedLongitude)) {
    params.set("resolvedLongitude", String(activityCapture?.resolvedLongitude));
  }

  return `${pathname}?${params.toString()}`;
}

export function formatAdaptiveFrequency(freqMhz: number): string {
  return freqMhz.toFixed(freqMhz < 200 ? 3 : 5);
}

export function formatFixedFrequency(freqMhz: number, digits: number): string {
  return freqMhz.toFixed(digits);
}

export function RfControlsPanel({
  controls,
  onControlsChange,
}: {
  controls: AudioControls;
  onControlsChange: (controls: AudioControls) => void;
}) {
  return (
    <div className="border-t border-white/[0.07]">
      <div className="border-b border-white/[0.07] px-4 py-2.5">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">RF Controls</p>
      </div>
      <div className="space-y-4 px-4 py-3">
        <label className="block space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">LNA</span>
            <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{controls.lna} dB</span>
          </div>
          <input
            className="rf-slider w-full"
            max={40}
            min={0}
            step={8}
            type="range"
            value={controls.lna}
            onChange={(event) =>
              onControlsChange({
                ...controls,
                lna: Number.parseInt(event.target.value, 10),
              })
            }
          />
        </label>

        <label className="block space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">VGA</span>
            <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{controls.vga} dB</span>
          </div>
          <input
            className="rf-slider w-full"
            max={62}
            min={0}
            step={2}
            type="range"
            value={controls.vga}
            onChange={(event) =>
              onControlsChange({
                ...controls,
                vga: Number.parseInt(event.target.value, 10),
              })
            }
          />
        </label>

        <label className="block space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)]">Volume</span>
            <span className="font-mono text-[11px] tabular-nums text-[var(--foreground)]">{controls.audioGain.toFixed(1)}×</span>
          </div>
          <input
            className="rf-slider w-full"
            max={8}
            min={0.2}
            step={0.1}
            type="range"
            value={controls.audioGain}
            onChange={(event) =>
              onControlsChange({
                ...controls,
                audioGain: Number.parseFloat(event.target.value),
              })
            }
          />
        </label>
      </div>
    </div>
  );
}
