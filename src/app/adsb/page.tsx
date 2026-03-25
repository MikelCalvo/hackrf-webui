import { Dashboard } from "@/components/dashboard";
import manifest from "@/data/catalog/manifest.json";
import type { CatalogManifest } from "@/lib/types";

export default function AdsbPage() {
  return <Dashboard activeModule="adsb" manifest={manifest as CatalogManifest} />;
}
