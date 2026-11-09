/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { buildAutoPublishedEntry } from "./autoPublishEntry";
import type { EligibleDecision } from "./autoPublishPolicy";
import { getQualificationUrlIdentity } from "./qualificationEvidence";
import { reviewedEntrySchema } from "./runtimeSchema";

function decision(): EligibleDecision {
  return {
    eligible: true, score: 68, scoreBreakdown: { curatedSource: 60, novelty: 8 },
    reasons: ["eligible_reading"], candidateId: "how-color-travels", sourceClass: "article",
    canonicalUrl: "https://writer.example/how-color-travels", effectiveDestination: getQualificationUrlIdentity("https://writer.example/how-color-travels"),
    domain: "writer.example", topics: ["science"], title: "How color travels",
    sourceId: "lobsters-rss", sourceFamily: "community-feed", repositoryIds: [], repositoryFullNames: [],
    observedAt: "2026-11-08T06:00:00.000Z",
  };
}

const actor = { runId: "7654321", reviewedAt: "2026-11-08T20:00:00.000Z" };

describe("automatically published runtime entries", () => {
  it("emits the reviewed schema and records the publisher run without claiming permission", () => {
    const result = buildAutoPublishedEntry(decision(), actor);
    expect(reviewedEntrySchema.parse(result)).toEqual(result);
    expect(result).toMatchObject({
      id: "how-color-travels", status: "evaluation_only", policyBasis: null, title: "How color travels",
      provenance: {
        reviewer: "stumblr-auto-policy/6 run/7654321", reviewedAt: actor.reviewedAt,
        sourceNote: "Automatic evaluation from curated source lobsters-rss.",
      },
      embedEvidence: { observedRenderResult: "rendered", observedAt: "2026-11-08T06:00:00.000Z", device: "desktop" },
    });
  });

  it("normalizes whitespace, strips markup and direction controls, and omits script contents", () => {
    const entry = buildAutoPublishedEntry({
      ...decision(), title: "  How <em>color</em>\n  travels\u202e <script>alert(1)</script> ",
    }, actor);
    expect(entry.title).toBe("How color travels");
  });

  it.each([
    ["article", "An article from a curated reading source."],
    ["archive", "A page from a curated archive or collection."],
    ["education", "An educational page from a curated reference source."],
    ["independent", "An independent website from a curated small-web source."],
    ["interactive", "An interactive web experiment from a curated source."],
    ["github", "An interactive web demo with a verified GitHub repository."],
  ] as const)("uses the deterministic %s description", (sourceClass, description) => {
    const input = { ...decision(), sourceClass };
    expect(buildAutoPublishedEntry(input, actor).description).toBe(description);
    expect(buildAutoPublishedEntry(input, actor)).toEqual(buildAutoPublishedEntry(input, actor));
  });

  it("rejects malformed actor identity", () => {
    expect(() => buildAutoPublishedEntry(decision(), { ...actor, runId: "123 extra" })).toThrow();
  });
});
