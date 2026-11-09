import type { z } from "zod";
import { AUTO_POLICY_VERSION, sanitizeAutoPublishTitle, type AutoPublishSourceClass, type EligibleDecision } from "./autoPublishPolicy";
import { reviewedEntrySchema } from "./runtimeSchema";

export type AutoPublishActor = {
  /** Run ID of the authenticated publisher, not the qualifier. */
  runId: string;
  reviewedAt: string;
};

export type ReviewedRuntimeEntry = z.infer<typeof reviewedEntrySchema>;

const DESCRIPTIONS: Readonly<Record<AutoPublishSourceClass, string>> = {
  article: "An article from a curated reading source.",
  archive: "A page from a curated archive or collection.",
  education: "An educational page from a curated reference source.",
  independent: "An independent website from a curated small-web source.",
  interactive: "An interactive web experiment from a curated source.",
  github: "An interactive web demo with a verified GitHub repository.",
};

export function buildAutoPublishedEntry(decision: EligibleDecision, actor: AutoPublishActor): ReviewedRuntimeEntry {
  if (!/^[1-9][0-9]{0,19}$/.test(actor.runId)) throw new Error("Invalid auto-publish run ID");
  return reviewedEntrySchema.parse({
    id: decision.candidateId,
    title: sanitizeAutoPublishTitle(decision.title),
    canonicalUrl: decision.canonicalUrl,
    domain: decision.domain,
    topics: decision.topics,
    description: DESCRIPTIONS[decision.sourceClass],
    status: "evaluation_only",
    policyBasis: null,
    provenance: {
      sourceNote: `Automatic evaluation from curated source ${decision.sourceId}.`,
      reviewer: `stumblr-auto-policy/${AUTO_POLICY_VERSION} run/${actor.runId}`,
      reviewedAt: actor.reviewedAt,
    },
    embedEvidence: {
      observedHeaders: "Terminal HTTP 200 with no observed browser frame denial on desktop or mobile.",
      observedRenderResult: "rendered",
      observedAt: decision.observedAt,
      device: "desktop",
    },
  });
}
