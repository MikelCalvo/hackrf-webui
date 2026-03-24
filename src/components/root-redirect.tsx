"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import {
  DEFAULT_APP_MODULE,
  getAppModulePath,
  isAppModuleId,
  readStoredAppModule,
  type AppModuleId,
} from "@/lib/modules";

export function RootRedirect({
  fallbackModule,
}: {
  fallbackModule: AppModuleId;
}) {
  const router = useRouter();

  useEffect(() => {
    const storedModule = readStoredAppModule();
    const nextModule =
      storedModule
      ?? (isAppModuleId(fallbackModule) ? fallbackModule : DEFAULT_APP_MODULE);

    router.replace(getAppModulePath(nextModule));
  }, [fallbackModule, router]);

  return (
    <div className="flex h-screen items-center justify-center bg-[var(--background)] p-8 text-center">
      <div className="space-y-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-[var(--accent)]">
          HackRF WebUI
        </p>
        <p className="text-sm text-[var(--muted)]">Opening your last module...</p>
      </div>
    </div>
  );
}
