import type { CSSProperties, ReactNode } from "react";

type MapOverlayCardProps = {
  badge?: ReactNode;
  children: ReactNode;
  eyebrow: string;
  footer?: ReactNode;
  maxWidth?: string;
  onClose?: () => void;
  position?: "top-left" | "top-right" | "bottom-center";
  subtitle?: ReactNode;
  title: ReactNode;
};

export function MapOverlayCard({
  badge,
  children,
  eyebrow,
  footer,
  maxWidth,
  onClose,
  position = "top-right",
  subtitle,
  title,
}: MapOverlayCardProps) {
  const outerStyle: CSSProperties = position === "bottom-center"
    ? {
      bottom: "1.25rem",
      display: "flex",
      justifyContent: "center",
      left: 0,
      paddingLeft: "1rem",
      paddingRight: "1rem",
      right: 0,
      zIndex: 1600,
    }
    : position === "top-left"
      ? {
        left: "1.5rem",
        top: "1.25rem",
        width: "min(30rem, calc(100% - 3rem))",
        zIndex: 1600,
      }
      : {
        right: "1rem",
        top: "1rem",
        width: "min(29rem, calc(100% - 2rem))",
        zIndex: 1600,
      };
  const innerStyle: CSSProperties = position === "bottom-center"
    ? {
      backdropFilter: "blur(16px)",
      background: "rgba(6, 12, 20, 0.84)",
      boxShadow: "0 24px 80px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(255, 255, 255, 0.06)",
      maxHeight: "calc(100% - 2rem)",
      maxWidth: maxWidth ?? "42rem",
      width: "100%",
      zIndex: 1601,
    }
    : {
      backdropFilter: "blur(16px)",
      background: "rgba(6, 12, 20, 0.84)",
      boxShadow: "0 24px 80px rgba(0, 0, 0, 0.42), 0 0 0 1px rgba(255, 255, 255, 0.06)",
      maxHeight: "calc(100% - 2rem)",
      maxWidth: maxWidth,
      width: "100%",
      zIndex: 1601,
    };

  return (
    <div
      className="pointer-events-auto absolute"
      style={outerStyle}
    >
      <div
        className="pointer-events-auto relative"
        style={innerStyle}
      >
        <div className="overflow-hidden rounded-2xl bg-[rgba(6,12,20,0.84)]">
          <div className="border-b border-white/[0.08] px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--accent)]">
                  {eyebrow}
                </p>
                <p className="mt-1 truncate text-lg font-semibold text-[var(--foreground)]">
                  {title}
                </p>
                {subtitle ? (
                  <div className="mt-1 font-mono text-[11px] text-[var(--muted)]">
                    {subtitle}
                  </div>
                ) : null}
                {badge ? (
                  <div className="mt-2">
                    {badge}
                  </div>
                ) : null}
              </div>
              {onClose ? (
                <button
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/12 bg-[rgba(255,255,255,0.04)] text-[var(--foreground)] shadow-[0_10px_24px_rgba(0,0,0,0.24)] transition hover:border-white/20 hover:bg-[rgba(255,255,255,0.08)]"
                  aria-label="Clear selection"
                  onClick={onClose}
                  type="button"
                >
                  <svg aria-hidden="true" className="h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>

          <div className="max-h-[26rem] overflow-y-auto px-4 py-3">
            {children}
          </div>

          {footer ? (
            <div className="border-t border-white/[0.08] px-4 py-3">
              {footer}
            </div>
          ) : null}
          </div>
      </div>
    </div>
  );
}
