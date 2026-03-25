import { Dashboard } from "@/components/dashboard";
import { EMPTY_CATALOG_MANIFEST } from "@/lib/empty-catalog";

export default function AirbandPage() {
  return <Dashboard activeModule="airband" manifest={EMPTY_CATALOG_MANIFEST} />;
}
