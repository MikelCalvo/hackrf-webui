import { Dashboard } from "@/components/dashboard";
import manifest from "@/data/catalog/manifest.json";
import type { CatalogManifest } from "@/lib/types";

export default function SettingsPage() {
  return <Dashboard activeModule="settings" manifest={manifest as CatalogManifest} />;
}
