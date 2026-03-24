import { Dashboard } from "@/components/dashboard";
import { EMPTY_CATALOG_MANIFEST } from "@/lib/empty-catalog";

export default function AdsbPage() {
  return <Dashboard activeModule="adsb" manifest={EMPTY_CATALOG_MANIFEST} />;
}
