import { Dashboard } from "@/components/dashboard";
import manifest from "@/data/catalog/manifest.json";
import type { CatalogManifest } from "@/lib/types";

export default function PmrPage() {
  return <Dashboard activeModule="pmr" manifest={manifest as CatalogManifest} />;
}
