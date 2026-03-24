import { cookies } from "next/headers";

import { RootRedirect } from "@/components/root-redirect";
import {
  DEFAULT_APP_MODULE,
  LAST_MODULE_COOKIE_KEY,
  isAppModuleId,
} from "@/lib/modules";

export default async function Home() {
  const cookieStore = await cookies();
  const rawModule = cookieStore.get(LAST_MODULE_COOKIE_KEY)?.value ?? "";
  const fallbackModule = isAppModuleId(rawModule) ? rawModule : DEFAULT_APP_MODULE;

  return <RootRedirect fallbackModule={fallbackModule} />;
}
