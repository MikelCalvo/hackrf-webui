import { Dashboard } from "@/components/dashboard";
import manifest from "@/data/catalog/manifest.json";
import type { CatalogManifest } from "@/lib/types";

export default function MaritimePage() {
  return <Dashboard activeModule="maritime" manifest={manifest as CatalogManifest} />;
}
