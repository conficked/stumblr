/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { getQualificationUrlIdentity, type QualificationSet } from "./qualificationEvidence";
import {
  evaluateAutoPublishCandidate, rankAutoPublishBatch,
  type AutoPublishInput, type AutoPublishReason, type EligibleDecision,
} from "./autoPublishPolicy";

const now = "2026-11-08T20:00:00.000Z";
const canonicalUrl = "https://thoughts.example/articles/chromatic-memory";
const observedAt = "2026-11-08T06:00:00.000Z";

function fixture(): AutoPublishInput {
  const desktop: QualificationSet["desktop"] = {
    device: "desktop", observed_at: observedAt, ...getQualificationUrlIdentity(canonicalUrl),
    document_http_status: 200, render_result: "text_observed", functionality_result: "not_demonstrated",
    meaningful_text_length: 810, interaction_evidence: { attempted: false, visible_state_changed: false },
    network_failure_reasons: [], frame_failure_reasons: [], console_failure_count: 0, commercial_signal: false, documentation_signal: false,
  };
  return {
    now,
    candidate: {
      id: "chromatic-memory", canonicalUrl, domain: "thoughts.example", status: "pending_review",
      sourceId: "lobsters-rss", sourceFamily: "community-feed", sourceUrl: "https://lobste.rs/rss",
      topics: ["art", "culture"], title: "A field guide to chromatic memory", previouslyRejected: false,
    },
    qualification: {
      candidate_id: "chromatic-memory", canonical_url: canonicalUrl, run_id: "70", run_attempt: 1,
      qualifier_version: "browser-qualification-v4", desktop, mobile: { ...desktop, device: "mobile" },
    },
    repositories: [], bundled: [], runtime: [],
  };
}

function github(): AutoPublishInput {
  const input = fixture();
  Object.assign(input.candidate, {
    sourceId: "github-live-demo", sourceFamily: "github-live-demo",
    sourceUrl: "https://api.github.com/search/repositories",
  });
  input.repositories = [{
    id: "1001", fullName: "experimental/chromatic-memory", url: "https://github.com/experimental/chromatic-memory",
    demoUrl: canonicalUrl, archived: false, stars: 3, pushedAt: "2026-11-01T00:00:00Z",
  }];
  Object.assign(input.qualification!.desktop, {
    render_result: "interaction_observed", functionality_result: "demonstrated",
    interaction_evidence: { attempted: true, visible_state_changed: true },
  });
  return input;
}

function retarget(input: AutoPublishInput, url: string) {
  input.candidate.canonicalUrl = url;
  input.candidate.domain = new URL(url).hostname;
  input.qualification!.canonical_url = url;
  for (const device of ["desktop", "mobile"] as const) {
    Object.assign(input.qualification![device], getQualificationUrlIdentity(url));
  }
}

function denied(input: AutoPublishInput, reason: AutoPublishReason) {
  const result = evaluateAutoPublishCandidate(input);
  expect(result).toMatchObject({ eligible: false, score: 0 });
  expect(result.reasons).toContain(reason);
}

describe("universal publication gates", () => {
  const gates: [string, AutoPublishReason, (input: AutoPublishInput) => void][] = [
    ["current status", "status_not_pending", x => { x.candidate.status = "quarantined"; }],
    ["manual rejection", "previously_rejected", x => { x.candidate.previouslyRejected = true; }],
    ["no same-run pair", "qualification_missing", x => { x.qualification = null; }],
    ["candidate identity", "qualification_mismatch", x => { x.qualification!.candidate_id = "another"; }],
    ["canonical identity", "qualification_mismatch", x => { x.qualification!.canonical_url += "?other"; }],
    ["device identity", "qualification_mismatch", x => { x.qualification!.mobile.device = "desktop"; }],
    ["unsupported qualifier", "qualifier_version_unsupported", x => { x.qualification!.qualifier_version = "browser-qualification-v1"; }],
    ["stale mobile evidence", "qualification_stale", x => { x.qualification!.mobile.observed_at = "2026-11-05T06:00:00.000Z"; }],
    ["future evidence", "qualification_stale", x => { x.qualification!.mobile.observed_at = "2026-11-09T06:00:00.000Z"; }],
    ["non-200 2xx terminal status", "terminal_http_status", x => { x.qualification!.mobile.document_http_status = 204; }],
    ["redirect terminal status", "terminal_http_status", x => { x.qualification!.desktop.document_http_status = 302; }],
    ["unknown terminal status", "terminal_http_status", x => { x.qualification!.desktop.document_http_status = null; }],
    ["HTTP error", "terminal_http_status", x => { x.qualification!.desktop.document_http_status = 404; x.qualification!.desktop.render_result = "http_error"; }],
    ["same-origin redirect outside screen", "redirect_mismatch", x => {
      Object.assign(x.qualification!.mobile, getQualificationUrlIdentity("https://thoughts.example/different"));
    }],
    ["candidate network guard", "network_guard_failure", x => { x.qualification!.desktop.render_result = "network_blocked"; }],
    ["candidate network guard", "network_guard_failure", x => { x.qualification!.desktop.network_failure_reasons = ["candidate_network_failure"]; }],
    ["frame denial", "frame_denied", x => { x.qualification!.mobile.frame_failure_reasons = ["candidate_frame_denied"]; }],
    ["login despite clean HTTP", "login_only", x => { x.qualification!.mobile.render_result = "login_only"; }],
    ["blank despite clean HTTP", "blank", x => { x.qualification!.desktop.render_result = "blank"; }],
    ["inconclusive", "render_inconclusive", x => { x.qualification!.desktop.render_result = "inconclusive"; }],
    ["timed out", "render_inconclusive", x => { x.qualification!.mobile.render_result = "timeout"; }],
    ["unknown topics", "topic_disallowed", x => { x.candidate.topics = ["marketing"]; }],
    ["disallowed family", "source_disallowed", x => { x.candidate.sourceFamily = "community"; }],
    ["impersonated curated source", "source_disallowed", x => { x.candidate.sourceUrl = "https://lobste.rs/elsewhere"; }],
    ["credentials in canonical URL", "destination_unsafe", x => { retarget(x, "https://user@thoughts.example/articles/chromatic-memory"); }],
    ["local destination", "destination_unsafe", x => { retarget(x, "https://example.internal/articles/chromatic-memory"); }],
    ["generic title", "title_quality", x => { x.candidate.title = "Welcome to my website"; }],
    ["placeholder title", "title_missing", x => { x.candidate.title = "Website at thoughts.example"; }],
    ["product landing page", "commercial_landing", x => { x.qualification!.mobile.commercial_signal = true; }],
    ["generated documentation", "documentation_site", x => { x.qualification!.desktop.documentation_signal = true; }],
    ["thin placeholder title", "title_quality", x => { x.candidate.title = "Welcome"; }],
    ["raw unsafe metadata", "metadata_denied", x => { x.candidate.title = "A field guide\u0000 to chromatic memory"; }],
    ["insufficient article text", "reading_text_insufficient", x => { x.qualification!.mobile.meaningful_text_length = 190; }],
  ];
  it.each(gates)("rejects %s", (_name, reason, change) => {
    const input = fixture();
    change(input);
    denied(input, reason);
  });

  it("accepts a rendered page whose third-party subresources and embeds were blocked by the sandbox", () => {
    const input = fixture();
    for (const device of ["desktop", "mobile"] as const) {
      Object.assign(input.qualification![device], {
        network_failure_reasons: ["resource_network_failure", "nested_network_failure"],
        frame_failure_reasons: ["nested_frame_failure", "nested_frame_denied"],
      });
    }
    expect(evaluateAutoPublishCandidate(input)).toMatchObject({ eligible: true });
  });

  it("matches a repository demo whose stored URL differs from the page only by a trailing slash", () => {
    const input = github();
    retarget(input, "https://experimental.example/chromatic-memory/");
    input.repositories[0].demoUrl = "https://experimental.example/chromatic-memory";
    expect(evaluateAutoPublishCandidate(input).reasons).not.toContain("repository_identity_invalid");
  });

  it("accepts a screened redirect only when both devices match its exact terminal URL", () => {
    const input = fixture();
    const screenedFinalUrl = "https://thoughts.example/essays/chromatic-memory";
    input.candidate.screenedDestination = { ...getQualificationUrlIdentity(screenedFinalUrl), metadata_denied: false };
    Object.assign(input.qualification!.desktop, getQualificationUrlIdentity(screenedFinalUrl));
    denied(input, "redirect_mismatch");
    Object.assign(input.qualification!.mobile, getQualificationUrlIdentity(screenedFinalUrl));
    const decision = evaluateAutoPublishCandidate(input);
    expect(decision).toMatchObject({ eligible: true, effectiveDestination: getQualificationUrlIdentity(screenedFinalUrl) });
    expect(JSON.stringify(decision)).not.toContain("/essays/chromatic-memory");
  });

  it("rejects screened redirects that would leave the production frame allowlist", () => {
    const input = fixture();
    const terminal = "https://writer.example/essays/chromatic-memory";
    input.candidate.screenedDestination = { ...getQualificationUrlIdentity(terminal), metadata_denied: false };
    for (const device of ["desktop", "mobile"] as const) {
      Object.assign(input.qualification![device], getQualificationUrlIdentity(terminal));
    }
    denied(input, "redirect_mismatch");
  });

  it("does not let a screened redirect bypass editorial denial", () => {
    const input = fixture();
    const terminal = "https://thoughts.example/sign_in";
    input.candidate.screenedDestination = { ...getQualificationUrlIdentity(terminal), metadata_denied: true };
    for (const device of ["desktop", "mobile"] as const) {
      Object.assign(input.qualification![device], getQualificationUrlIdentity(terminal));
    }
    denied(input, "metadata_denied");
  });

  it("checks runtime and bundled identity independently", () => {
    const input = fixture();
    input.bundled = [{ canonicalUrl: `${canonicalUrl}#reader`, domain: "thoughts.example", title: "Unrelated title" }];
    denied(input, "duplicate_url");
    input.bundled = [];
    input.runtime = [{ canonicalUrl: "https://www.thoughts.example/other", domain: "www.thoughts.example", title: "Unrelated title" }];
    denied(input, "duplicate_domain");
    input.runtime = [{ canonicalUrl: "https://elsewhere.example/", domain: "elsewhere.example", title: "A Field Guide to Chromatic Memory — Part II" }];
    denied(input, "duplicate_title");
    input.runtime = [{ id: "chromatic-memory", canonicalUrl: "https://elsewhere.example/", domain: "elsewhere.example", title: "Unrelated title" }];
    denied(input, "duplicate_id");
  });

  it("rejects a duplicate effective destination on another canonical domain", () => {
    const input = fixture();
    input.runtime = [{
      canonicalUrl: "https://elsewhere.example/", domain: "elsewhere.example",
      title: "Other writing", effectiveDestination: getQualificationUrlIdentity(canonicalUrl),
    }];
    denied(input, "duplicate_destination");
  });
});

describe("source quality", () => {
  it.each([
    ["community-feed", "lobsters-rss", "https://lobste.rs/rss", "article"],
    ["blog-directory", "ooh-directory", "https://ooh.directory/", "article"],
    ["archives", "public-domain-review-rss", "https://publicdomainreview.org/feed/", "archive"],
    ["educational", "nrich-maths", "https://nrich.maths.org/", "education"],
    ["webring", "webring-fediring", "https://fediring.net/", "independent"],
    ["indie-directory", "personalsites-directory", "https://personalsit.es/", "independent"],
    ["small-web-directory", "one-mb-club", "https://1mb.club/", "independent"],
    ["tilde", "tildeverse", "https://tildeverse.org/", "independent"],
    ["community", "community-suggestions", "https://stumblr.dev/", "independent"],
  ])("admits rendered %s content without a forced interaction", (sourceFamily, sourceId, sourceUrl, sourceClass) => {
    const input = fixture();
    Object.assign(input.candidate, { sourceFamily, sourceId, sourceUrl });
    if (sourceClass === "independent") retarget(input, "https://thoughts.example/");
    expect(evaluateAutoPublishCandidate(input)).toMatchObject({ eligible: true, sourceClass, reasons: ["eligible_reading"] });
  });

  it.each([
    ["creative-coding", "p5js-examples", "https://p5js.org/examples/"],
    ["novelty-list", "useless-web-sites-page", "https://theuselessweb.com/sites/"],
  ])("requires a verified repository for %s experiments", (sourceFamily, sourceId, sourceUrl) => {
    const input = github();
    Object.assign(input.candidate, { sourceFamily, sourceId, sourceUrl });
    expect(evaluateAutoPublishCandidate(input)).toMatchObject({ eligible: true, sourceClass: "interactive" });
    input.repositories = [];
    denied(input, "repository_identity_invalid");
  });

  it("applies interactive rules when a reading source has an exact normalized repository demo", () => {
    const input = fixture();
    input.repositories = github().repositories;
    input.repositories[0].demoUrl = "https://THOUGHTS.example:443/articles/chromatic-memory#demo";
    denied(input, "interaction_missing");
    input.qualification!.desktop = github().qualification!.desktop;
    expect(evaluateAutoPublishCandidate(input)).toMatchObject({
      eligible: true, reasons: ["eligible_interactive"], sourceClass: "github",
      sourceFamily: "community-feed", sourceId: "lobsters-rss",
    });
  });

  it("applies interactive rules when a repository demo matches the screened terminal URL", () => {
    const input = fixture();
    const terminal = "https://thoughts.example/interactive/chromatic-memory";
    input.candidate.screenedDestination = { ...getQualificationUrlIdentity(terminal), metadata_denied: false };
    input.repositories = github().repositories;
    input.repositories[0].demoUrl = terminal;
    for (const device of ["desktop", "mobile"] as const) {
      Object.assign(input.qualification![device], getQualificationUrlIdentity(terminal));
    }
    denied(input, "interaction_missing");
  });

  it("keeps reading eligibility when an associated repository only matches the domain", () => {
    const input = fixture();
    input.repositories = github().repositories;
    input.repositories[0].demoUrl = "https://thoughts.example/another-demo";
    expect(evaluateAutoPublishCandidate(input)).toMatchObject({
      eligible: true, sourceClass: "article", reasons: ["eligible_reading"],
    });
  });

  it.each([
    ["Museum Print Store", "https://store.example/"],
    ["Monthly membership pricing", "https://example.org/pricing"],
    ["Geometric experiments", "https://example.org/careers/engineers"],
    ["Typescript API Reference", "https://example.org/docs/getting-started"],
    ["Experimental project", "https://github.com/owner/repo"],
    ["Support our project", "https://example.org/donate"],
    ["Wordle Clone", "https://example.org/play"],
    ["Wordle Clone Game", "https://example.org/play"],
    ["Digital experiences for everyone", "https://example.org/agency"],
    ["A new collection", "https://example.org/coming-soon"],
  ])("denies low-fit metadata: %s", (title, url) => {
    const input = fixture();
    retarget(input, url);
    input.candidate.title = title;
    denied(input, "metadata_denied");
  });

  it("requires real browser interaction on at least one GitHub demo device even with stars", () => {
    const input = github();
    expect(evaluateAutoPublishCandidate(input)).toMatchObject({ eligible: true, reasons: ["eligible_interactive"] });
    input.repositories[0].stars = 10000;
    input.qualification!.desktop.interaction_evidence.visible_state_changed = false;
    denied(input, "interaction_missing");
  });

  it("requires meaningful rendering on both interactive devices", () => {
    const input = github();
    input.qualification!.mobile.meaningful_text_length = 10;
    denied(input, "interactive_content_insufficient");
  });

  it("requires a matching, non-archived, non-clone repository with recent maintenance", () => {
    const input = github();
    const repository = input.repositories[0];
    repository.demoUrl = "https://different.example/";
    denied(input, "repository_identity_invalid");
    repository.demoUrl = canonicalUrl;
    repository.archived = true;
    denied(input, "repository_archived");
    repository.archived = false;
    repository.description = "A faithful clone of a popular app";
    denied(input, "metadata_denied");
    repository.description = "An optical color experiment";
    repository.pushedAt = "2025-01-01T00:00:00Z";
    denied(input, "repository_activity_insufficient");
    repository.stars = 100;
    denied(input, "repository_activity_insufficient");
    repository.pushedAt = "2026-11-01T00:00:00Z";
    expect(evaluateAutoPublishCandidate(input).eligible).toBe(true);
  });

  it("does not accept popularity without credible maintenance history", () => {
    const input = github();
    input.repositories[0].stars = 10_000;
    input.repositories[0].pushedAt = "2020-01-01T00:00:00Z";
    denied(input, "repository_activity_insufficient");
  });

  it("uses stars to raise the score of a demo that already qualifies", () => {
    const input = github();
    const baseline = evaluateAutoPublishCandidate(input);
    input.repositories[0].stars = 100;
    const popular = evaluateAutoPublishCandidate(input);
    expect(baseline.eligible).toBe(true);
    expect(popular.eligible).toBe(true);
    expect(popular.score).toBeGreaterThan(baseline.score);
  });

  it("checks repository IDs and full names against existing identities", () => {
    const input = github();
    const existing = { canonicalUrl: "https://other.example/", domain: "other.example", title: "Different optical work" };
    input.bundled = [{ ...existing, repositoryIds: ["1001"] }];
    denied(input, "duplicate_repository");
    input.bundled = [];
    input.runtime = [{ ...existing, repositoryFullNames: ["EXPERIMENTAL/CHROMATIC-MEMORY"] }];
    denied(input, "duplicate_repository");
  });

  it("scores stronger interaction and independent corroboration higher", () => {
    const input = github();
    const baseline = evaluateAutoPublishCandidate(input);
    Object.assign(input.qualification!.mobile, {
      render_result: "interaction_observed", functionality_result: "demonstrated",
      interaction_evidence: { attempted: true, visible_state_changed: true },
    });
    input.corroboratingSourceIds = ["github-live-demo", "webring-fediring", "webring-fediring", "unknown"];
    const stronger = evaluateAutoPublishCandidate(input);
    expect(stronger.score).toBeGreaterThan(baseline.score);
    expect(stronger.scoreBreakdown).toMatchObject({ interaction: 24, corroboration: 5 });
    expect(Object.values(stronger.scoreBreakdown).reduce((a, b) => a + b, 0)).toBe(stronger.score);
  });
});

describe("batch ranking", () => {
  function eligible(id: string, group = 0): EligibleDecision {
    const sources = [
      ["community-feed", "lobsters-rss", "https://lobste.rs/rss", "art"],
      ["archives", "public-domain-review-rss", "https://publicdomainreview.org/feed/", "archives"],
      ["webring", "webring-fediring", "https://fediring.net/", "culture"],
      ["educational", "nrich-maths", "https://nrich.maths.org/", "education"],
    ];
    const [sourceFamily, sourceId, sourceUrl, topic] = sources[group];
    const input = fixture();
    retarget(input, `https://${id}.example/`);
    Object.assign(input.candidate, { id, sourceFamily, sourceId, sourceUrl, topics: [topic], title: `Focal portrait ${id}` });
    input.qualification!.candidate_id = id;
    const result = evaluateAutoPublishCandidate(input);
    if (!result.eligible) throw new Error(`Invalid eligible fixture: ${result.reasons.join(", ")}`);
    return result;
  }

  it("has no minimum and rejects invalid caps", () => {
    expect(rankAutoPublishBatch([], 20)).toEqual({ admitted: [], deferred: [], rejected: [] });
    expect(rankAutoPublishBatch([eligible("only")], 20).admitted).toHaveLength(1);
    for (const cap of [0, 21, 1.5, NaN]) expect(() => rankAutoPublishBatch([], cap)).toThrow(RangeError);
  });

  it("orders by descending score, ascending evidence time and ascending ID without mutating the input", () => {
    const a = eligible("amber");
    const b = eligible("blue");
    const c = { ...eligible("cyan"), observedAt: "2026-11-07T20:00:00.000Z" };
    const d = { ...eligible("denim"), score: a.score + 1 };
    const decisions = [b, a, d, c];
    const ranked = rankAutoPublishBatch(decisions, 3);
    expect(ranked.admitted.map(row => row.candidateId)).toEqual(["denim", "cyan", "amber"]);
    expect(ranked.deferred).toEqual([{ decision: b, reason: "batch_cap" }]);
    expect(decisions).toEqual([b, a, d, c]);
  });

  it("enforces the total 20, family 8, and primary topic 6 limits", () => {
    const decisions = Array.from({ length: 24 }, (_, n) => eligible(`specimen-${String(n).padStart(3, "0")}`, n % 4));
    expect(rankAutoPublishBatch(decisions, 20).admitted).toHaveLength(20);
    const mix = Array.from({ length: 12 }, (_, n) => {
      const decision = eligible(`sample-${String(n).padStart(3, "0")}`);
      return { ...decision, topics: [n < 7 ? "art" : "maps", "science"] } satisfies EligibleDecision;
    });
    const ranked = rankAutoPublishBatch(mix, 20);
    expect(ranked.admitted).toHaveLength(8);
    expect(ranked.admitted.filter(row => row.topics[0] === "art")).toHaveLength(6);
    expect(ranked.deferred.map(row => row.reason)).toEqual(["topic_cap", "family_cap", "family_cap", "family_cap"]);
  });

  it("defers a same-release duplicate and continues past it", () => {
    const a = eligible("amber");
    const b = { ...eligible("blue"), effectiveDestination: a.effectiveDestination };
    const c = eligible("cyan");
    const bad = fixture();
    bad.candidate.status = "quarantined";
    const rejected = evaluateAutoPublishCandidate(bad);
    const ranked = rankAutoPublishBatch([a, b, c, rejected], 2);
    expect(ranked.admitted.map(row => row.candidateId)).toEqual(["amber", "cyan"]);
    expect(ranked.deferred).toEqual([{ decision: b, reason: "batch_duplicate" }]);
    expect(ranked.rejected).toEqual([rejected]);
  });
});
