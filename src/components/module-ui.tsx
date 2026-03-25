"use client";

import { useEffect } from "react";

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

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  busy = false,
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        onCancel();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [busy, onCancel, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-[rgba(2,6,12,0.72)] px-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-[rgba(10,16,28,0.96)] shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
        <div className="border-b border-white/[0.07] px-5 py-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-amber-200">Confirm Action</p>
          <h3 className="mt-2 text-xl font-semibold text-[var(--foreground)]">{title}</h3>
          <p className="mt-2 text-sm leading-6 text-[var(--muted-strong)]">{description}</p>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4">
          <button
            className={CLS_BTN_GHOST}
            disabled={busy}
            onClick={onCancel}
            type="button"
          >
            {cancelLabel}
          </button>
          <button
            className="inline-flex items-center justify-center gap-2 rounded border border-rose-400/25 bg-rose-400/[0.1] px-4 py-2 text-sm font-semibold text-rose-200 transition hover:border-rose-400/45 hover:bg-rose-400/[0.14] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={busy}
            onClick={onConfirm}
            type="button"
          >
            {busy ? <Spinner /> : null}
            {busy ? "Clearing…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
