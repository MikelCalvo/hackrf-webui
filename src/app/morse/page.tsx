import { Dashboard } from "@/components/dashboard";
import manifest from "@/data/catalog/manifest.json";
import type { CatalogManifest } from "@/lib/types";

export default function MorsePage() {
  return <Dashboard activeModule="morse" manifest={manifest as CatalogManifest} />;
}
