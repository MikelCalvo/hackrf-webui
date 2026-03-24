import Link from "next/link";

import { CoverageStatusPanel } from "@/components/coverage-status-panel";
import manifest from "@/data/catalog/manifest.json";
import type { CatalogManifest } from "@/lib/types";

export default function FmCoveragePage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,rgba(43,67,111,0.24),transparent_34%),linear-gradient(180deg,#05080f,#0a1220_55%,#05080f)] px-4 py-8 text-[var(--foreground)] sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4 rounded-[28px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,15,25,0.96),rgba(7,11,19,0.92))] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
          <div className="max-w-3xl">
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-[var(--accent)]">
              FM Coverage
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white">
              Global catalog coverage
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--muted)]">
              Review country-by-country FM quality, source mix, and blocker notes without mixing
              it into the live tuner workflow.
            </p>
          </div>

          <Link
            className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--muted-strong)] transition hover:bg-white/[0.08]"
            href="/"
          >
            Back to dashboard
          </Link>
        </div>

        <CoverageStatusPanel manifest={manifest as CatalogManifest} />
      </div>
    </main>
  );
}
