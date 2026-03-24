import { Dashboard } from "@/components/dashboard";
import { EMPTY_CATALOG_MANIFEST } from "@/lib/empty-catalog";

export default function AisPage() {
  return <Dashboard activeModule="ais" manifest={EMPTY_CATALOG_MANIFEST} />;
}
