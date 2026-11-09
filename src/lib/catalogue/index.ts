import { catalogueEntries } from "./entries";
import { CatalogueEntry } from "./types";

export function getCatalogue({
  includeEvaluation,
}: {
  includeEvaluation: boolean;
}): CatalogueEntry[] {
  const eligible = catalogueEntries.filter((entry) => entry.status !== "blocked");
  return includeEvaluation
    ? [...eligible]
    : eligible.filter((entry) => entry.status === "launch_approved");
}

export function getFrameAllowlist(entries: CatalogueEntry[]): string[] {
  return Array.from(new Set(entries.map((entry) => `https://${entry.domain}`))).sort();
}
