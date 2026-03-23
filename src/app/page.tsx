import { Dashboard } from "@/components/dashboard";
import { seedCatalog } from "@/lib/catalog";

export default function Home() {
  return <Dashboard catalog={seedCatalog} />;
}
