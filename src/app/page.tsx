import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import {
  DEFAULT_APP_MODULE,
  getAppModulePath,
  LAST_MODULE_COOKIE_KEY,
  isAppModuleId,
} from "@/lib/modules";
import { readAppSettings } from "@/server/settings-store";

export default async function Home() {
  const settings = await readAppSettings();
  const cookieStore = await cookies();
  const rawModule = cookieStore.get(LAST_MODULE_COOKIE_KEY)?.value ?? "";
  const configuredDefault = settings.general.defaultModule ?? DEFAULT_APP_MODULE;
  const fallbackModule = settings.general.restoreLastModule && isAppModuleId(rawModule)
    ? rawModule
    : configuredDefault;

  redirect(getAppModulePath(fallbackModule));
}
