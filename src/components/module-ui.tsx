"use client";

export function cx(...args: Array<string | false | null | undefined>): string {
  return args.filter(Boolean).join(" ");
}

export function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path fill="currentColor" d="M12 2a10 10 0 0 1 10 10h-3a7 7 0 0 0-7-7V2z" />
    </svg>
  );
}

export const CLS_INPUT =
  "w-full rounded border border-white/[0.1] bg-white/[0.04] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition placeholder:text-[var(--muted)] focus:border-[var(--accent)]/50 focus:bg-white/[0.06] disabled:cursor-not-allowed disabled:opacity-50";

export const CLS_BTN_PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded border border-[var(--accent)]/40 bg-[var(--accent)]/12 px-4 py-2 text-sm font-semibold transition hover:border-[var(--accent)]/70 hover:bg-[var(--accent)]/20 disabled:cursor-not-allowed disabled:opacity-40";

export const CLS_BTN_GHOST =
  "inline-flex items-center justify-center gap-2 rounded border border-white/10 bg-white/[0.04] px-4 py-2 text-sm font-semibold text-[var(--muted-strong)] transition hover:border-white/18 hover:bg-white/[0.07] disabled:cursor-not-allowed disabled:opacity-40";
