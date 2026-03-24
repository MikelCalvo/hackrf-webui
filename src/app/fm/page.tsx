import { Dashboard } from "@/components/dashboard";
import manifest from "@/data/catalog/manifest.json";
import type { CatalogManifest } from "@/lib/types";

export default function FmPage() {
  return <Dashboard activeModule="fm" manifest={manifest as CatalogManifest} />;
}
