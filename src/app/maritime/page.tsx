import { Dashboard } from "@/components/dashboard";
import { EMPTY_CATALOG_MANIFEST } from "@/lib/empty-catalog";

export default function MaritimePage() {
  return <Dashboard activeModule="maritime" manifest={EMPTY_CATALOG_MANIFEST} />;
}
