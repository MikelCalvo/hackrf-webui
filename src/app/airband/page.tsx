import { Dashboard } from "@/components/dashboard";
import manifest from "@/data/catalog/manifest.json";
import type { CatalogManifest } from "@/lib/types";

export default function AirbandPage() {
  return <Dashboard activeModule="airband" manifest={manifest as CatalogManifest} />;
}
