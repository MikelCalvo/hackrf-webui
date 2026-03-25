import { Dashboard } from "@/components/dashboard";
import manifest from "@/data/catalog/manifest.json";
import type { CatalogManifest } from "@/lib/types";

export default function SigintPage() {
  return <Dashboard activeModule="sigint" manifest={manifest as CatalogManifest} />;
}
