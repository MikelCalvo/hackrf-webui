import { Dashboard } from "@/components/dashboard";
import manifest from "@/data/catalog/manifest.json";
import type { CatalogManifest } from "@/lib/types";

export default function AisPage() {
  return <Dashboard activeModule="ais" manifest={manifest as CatalogManifest} />;
}
