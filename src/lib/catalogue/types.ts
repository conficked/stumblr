export type CatalogueStatus =
  | "launch_approved"
  | "evaluation_only"
  | "blocked"
  | "unverified";

export type Topic =
  | "art"
  | "science"
  | "maps"
  | "music"
  | "games"
  | "culture"
  | "archives"
  | "education"
  | "nature";

export type EmbedEvidence = {
  observedHeaders: string;
  observedRenderResult: "rendered" | "blocked" | "timeout" | "untested";
  observedAt: string;
  device: "desktop" | "mobile-emulation";
};

export type CatalogueEntry = {
  id: string;
  title: string;
  canonicalUrl: string;
  domain: string;
  topics: Topic[];
  description: string;
  status: CatalogueStatus;
  policyBasis: string | null;
  provenance: {
    sourceNote: string;
    reviewer: string;
    reviewedAt: string;
  };
  embedEvidence: EmbedEvidence;
  fixtureOutcome?: "timeout" | "error";
};
