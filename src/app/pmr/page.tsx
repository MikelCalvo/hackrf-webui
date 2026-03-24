import { Dashboard } from "@/components/dashboard";
import { EMPTY_CATALOG_MANIFEST } from "@/lib/empty-catalog";

export default function PmrPage() {
  return <Dashboard activeModule="pmr" manifest={EMPTY_CATALOG_MANIFEST} />;
}
