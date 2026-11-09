import { ExplorerApp } from "@/components/explorer/ExplorerApp";
import { fixtureEntries } from "@/lib/catalogue/fixtureEntries";

export default function FixturesLabPage() {
  return <ExplorerApp catalogueOverride={fixtureEntries} modeLabel="Fixture lab mode" />;
}
