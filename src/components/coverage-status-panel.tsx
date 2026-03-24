"use client";

import { useMemo } from "react";

import { compareText } from "@/lib/catalog";
import type { CatalogCountrySummary, CatalogManifest } from "@/lib/types";

type CoverageTone = {
  badge: string;
  bar: string;
  dot: string;
};

function cx(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(" ");
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}

function formatLabel(value: string): string {
  return value
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function toneForCountry(country: CatalogCountrySummary): CoverageTone {
  if (country.coverageStatus === "blocked" || country.coverageTier === "blocked") {
    return {
      badge: "border-rose-400/25 bg-rose-400/10 text-rose-200",
      bar: "bg-rose-300",
      dot: "bg-rose-300",
    };
  }

  if (country.coverageStatus === "manual" || country.coverageTier === "manual-seed") {
    return {
      badge: "border-fuchsia-400/20 bg-fuchsia-400/8 text-fuchsia-200",
      bar: "bg-fuchsia-300",
      dot: "bg-fuchsia-300",
    };
  }

  if (country.coverageStatus === "partial" || country.coverageTier === "official-partial") {
    return {
      badge: "border-amber-400/25 bg-amber-400/10 text-amber-200",
      bar: "bg-amber-300",
      dot: "bg-amber-300",
    };
  }

  return {
    badge: "border-emerald-400/25 bg-emerald-400/10 text-emerald-200",
    bar: "bg-emerald-300",
    dot: "bg-emerald-300",
  };
}

export function CoverageStatusPanel({ manifest }: { manifest: CatalogManifest }) {
  const countries = useMemo(() => {
    return [...manifest.countries].sort((left, right) => {
      if (right.coverageScore !== left.coverageScore) {
        return right.coverageScore - left.coverageScore;
      }

      if (right.stationCount !== left.stationCount) {
        return right.stationCount - left.stationCount;
      }

      return compareText(left.name, right.name);
    });
  }, [manifest.countries]);

  const statusCounts = manifest.stats.byCoverageStatus;
  const maxScore = Math.max(1, ...countries.map((country) => country.coverageScore));

  return (
    <section className="rounded-2xl border border-white/8 bg-[linear-gradient(180deg,rgba(12,18,31,0.95),rgba(8,12,22,0.9))] p-4 shadow-[0_20px_50px_rgba(0,0,0,0.35)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-[9px] uppercase tracking-[0.26em] text-[var(--accent)]">
            Coverage status
          </p>
          <h3 className="mt-1 text-sm font-semibold text-[var(--foreground)]">
            Per-country FM quality
          </h3>
          <p className="mt-1 text-xs leading-5 text-[var(--muted)]">
            Runtime metadata now marks each country as active, partial, or manual and keeps the
            source story visible before you load a shard.
          </p>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-2.5 py-2 text-right">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--muted)]">
            Catalog
          </p>
          <p className="mt-0.5 font-mono text-sm text-[var(--foreground)]">
            {formatCount(manifest.stats.totalCountries)}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
            Active
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
            {formatCount(statusCounts.active ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
            Partial
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
            {formatCount(statusCounts.partial ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
            Manual
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
            {formatCount(statusCounts.manual ?? 0)}
          </p>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2">
          <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[var(--muted)]">
            Stations
          </p>
          <p className="mt-1 text-sm font-semibold text-[var(--foreground)]">
            {formatCount(manifest.stats.totalStations)}
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-white/8 bg-black/20 p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--muted)]">
            Countries
          </span>
          <span className="font-mono text-[9px] text-[var(--muted)]">
            Sorted by quality score
          </span>
        </div>

        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {countries.map((country) => {
            const tone = toneForCountry(country);
            const width = Math.max(6, Math.round((country.coverageScore / maxScore) * 100));

            return (
              <article
                key={country.id}
                className="rounded-xl border border-white/8 bg-white/[0.03] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="truncate text-sm font-medium text-[var(--foreground)]">
                        {country.name}
                      </h4>
                      <span
                        className={cx(
                          "rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em]",
                          tone.badge,
                        )}
                      >
                        <span
                          className={cx(
                            "mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle",
                            tone.dot,
                          )}
                        />
                        {formatLabel(country.coverageStatus)}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                      {country.code} · {formatCount(country.stationCount)} presets ·{" "}
                      {formatCount(country.cityCount)} cities
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-[10px] text-[var(--foreground)]">
                      {country.coverageScore}%
                    </p>
                    <p className="font-mono text-[10px] text-[var(--muted)]">quality</p>
                  </div>
                </div>

                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                  <div
                    className={cx("h-full rounded-full", tone.bar)}
                    style={{ width: `${width}%` }}
                  />
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  <span className="rounded-full border border-white/8 bg-black/20 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                    {formatLabel(country.sourceQuality)}
                  </span>
                  <span className="rounded-full border border-white/8 bg-black/20 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                    {formatLabel(country.coverageTier)}
                  </span>
                  <span className="rounded-full border border-white/8 bg-black/20 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                    {formatLabel(country.coverageScope)}
                  </span>
                  <span className="rounded-full border border-white/8 bg-black/20 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[var(--muted-strong)]">
                    {formatCount(country.sourceCount)} sources
                  </span>
                  {country.cachedFallbackUsed ? (
                    <span className="rounded-full border border-amber-400/20 bg-amber-400/8 px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-amber-200">
                      cached fallback
                    </span>
                  ) : null}
                </div>

                {country.sources.length > 0 ? (
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                    Sources:{" "}
                    {country.sources
                      .slice(0, 3)
                      .map((source) => source.name)
                      .join(" · ")}
                    {country.sources.length > 3 ? ` +${country.sources.length - 3} more` : ""}
                  </p>
                ) : null}

                {country.lastImportedAt ? (
                  <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                    Last imported: {country.lastImportedAt}
                  </p>
                ) : null}

                {country.coverageNotes ? (
                  <p className="mt-2 text-xs leading-5 text-[var(--muted)]">
                    {country.coverageNotes}
                  </p>
                ) : null}

                {country.notesPath ? (
                  <p className="mt-1 font-mono text-[10px] text-[var(--muted)]">
                    Notes: {country.notesPath}
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
