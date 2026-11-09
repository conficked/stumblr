import { classifyCollectorTitle, deniedText, titleDigest, titleKey } from "./titleClassification.mjs";
import { collectorDomainTitle, redactTitleUrls } from "./collectorMetadata";
import { deniedUrl, getQualificationUrlIdentity, publicHttpsUrl } from "./destinationIdentity.mjs";
import { MAX_QUALIFICATION_EVIDENCE_AGE_MS, QUALIFIER_VERSION } from "./qualificationLimits";
import type { QualificationSet } from "./qualificationEvidence";
import type { ScreenedDestination } from "./screenedDestination";
import type { Topic } from "./types";

export const AUTO_POLICY_VERSION = "6";
const DAY_MS = 86_400_000;
const MAINTENANCE_AGE_MS = 180 * DAY_MS;
const POPULARITY_STARS_STEP = 50;
const FAMILY_CAP = 8;
const TOPIC_CAP = 6;

const TOPICS: ReadonlySet<string> = new Set<Topic>([
  "art", "science", "maps", "music", "games", "culture", "archives", "education", "nature",
]);

export type AutoPublishSourceClass = "github" | "interactive" | "article" | "archive" | "education" | "independent";

// Bind each collector's source ID to its configured family and URL. An
// allowlisted family alone does not establish where a lead was curated.
const SOURCES: ReadonlyMap<string, readonly [family: string, url: string, kind: AutoPublishSourceClass]> = new Map([
  ["webring-xxiivv", ["webring", "https://webring.xxiivv.com/", "independent"]],
  ["webring-fediring", ["webring", "https://fediring.net/", "independent"]],
  ["webring-hotline", ["webring", "https://hotlinewebring.club/", "independent"]],
  ["personalsites-directory", ["indie-directory", "https://personalsit.es/", "independent"]],
  ["one-mb-club", ["small-web-directory", "https://1mb.club/", "independent"]],
  ["ten-kb-club", ["small-web-directory", "https://10kb.club/", "independent"]],
  ["ooh-directory", ["blog-directory", "https://ooh.directory/", "article"]],
  ["indie-web-index", ["indie-directory", "https://theindex.fyi/", "independent"]],
  ["tildeverse", ["tilde", "https://tildeverse.org/", "independent"]],
  ["lobsters-rss", ["community-feed", "https://lobste.rs/rss", "article"]],
  ["nrich-maths", ["educational", "https://nrich.maths.org/", "education"]],
  ["exploratorium-explore", ["educational", "https://www.exploratorium.edu/explore", "education"]],
  ["p5js-examples", ["creative-coding", "https://p5js.org/examples/", "interactive"]],
  ["ia-blog-feed", ["archives", "https://blog.archive.org/feed/", "archive"]],
  ["useless-web-sites-index", ["novelty-list", "https://theuselessweb.com/sites/index.xml", "interactive"]],
  ["useless-web-sites-page", ["novelty-list", "https://theuselessweb.com/sites/", "interactive"]],
  ["bored-button-random", ["novelty-list", "https://www.boredbutton.com/random", "interactive"]],
  ["open-culture-rss", ["archives", "https://www.openculture.com/feed", "archive"]],
  ["nasa-breaking-rss", ["archives", "https://www.nasa.gov/rss/dyn/breaking_news.rss", "archive"]],
  ["public-domain-review-rss", ["archives", "https://publicdomainreview.org/feed/", "archive"]],
  ["wikimedia-glam-rss", ["archives", "https://diff.wikimedia.org/feed/", "archive"]],
  ["github-live-demo", ["github-live-demo", "https://api.github.com/search/repositories", "github"]],
]);

const MINIMUM_READING_TEXT = { article: 240, archive: 200, education: 200, independent: 160 };
const SOURCE_WEIGHT: Readonly<Record<AutoPublishSourceClass, number>> = {
  github: 48, interactive: 46, article: 45, archive: 52, education: 52, independent: 48,
};

export type AutoPublishReason =
  | "eligible_reading" | "eligible_interactive"
  | "status_not_pending" | "previously_rejected" | "destination_unsafe" | "qualification_missing"
  | "qualification_mismatch" | "qualifier_version_unsupported" | "qualification_stale"
  | "terminal_http_status" | "redirect_mismatch" | "network_guard_failure" | "frame_denied"
  | "login_only" | "blank" | "render_inconclusive" | "source_disallowed" | "topic_disallowed"
  | "metadata_denied" | "title_quality" | "title_missing" | "commercial_landing" | "documentation_site" | "title_digest_missing" | "duplicate_id" | "duplicate_url" | "duplicate_domain"
  | "duplicate_repository" | "duplicate_destination" | "duplicate_title" | "reading_text_insufficient"
  | "interaction_missing" | "interactive_content_insufficient" | "repository_identity_invalid"
  | "repository_archived" | "repository_activity_insufficient";

export type AutoPublishCandidate = {
  id: string;
  canonicalUrl: string;
  domain: string;
  status: string;
  sourceId: string;
  sourceFamily: string;
  sourceUrl: string;
  title: string;
  topics: readonly string[];
  previouslyRejected: boolean;
  /** Terminal identity from independent screening. Omit for a direct destination. */
  screenedDestination?: ScreenedDestination;
  titleSignals?: { quality: boolean; denied: boolean; digest?: string };
};

export type AutoPublishRepository = {
  id: string;
  fullName: string;
  url: string;
  demoUrl: string;
  archived: boolean;
  stars: number;
  pushedAt: string;
  fork?: boolean;
  description?: string;
  topics?: readonly string[];
};

type DestinationIdentity = ReturnType<typeof getQualificationUrlIdentity>;

export type AutoPublishIdentity = {
  id?: string;
  canonicalUrl: string;
  effectiveDestination?: DestinationIdentity;
  domain: string;
  title: string;
  titleDigest?: string;
  topics?: readonly string[];
  sourceFamily?: string;
  repositoryIds?: readonly string[];
  repositoryFullNames?: readonly string[];
};

export type AutoPublishInput = {
  now: string;
  candidate: AutoPublishCandidate;
  /** From getLatestQualificationSet; it returns null if the latest pair cannot be joined. */
  qualification: QualificationSet | null;
  repositories: readonly AutoPublishRepository[];
  bundled: readonly AutoPublishIdentity[];
  runtime: readonly AutoPublishIdentity[];
  /** Additional independent, persisted collector observations of this candidate. */
  corroboratingSourceIds?: readonly string[];
};

type ScoreComponent =
  | "curatedSource" | "interaction" | "repositoryIdentity" | "maintenance" | "popularity"
  | "corroboration" | "novelty" | "domainPenalty" | "titlePenalty" | "familyPenalty";

type Decision = {
  candidateId: string;
  score: number;
  scoreBreakdown: Partial<Record<ScoreComponent, number>>;
  reasons: AutoPublishReason[];
};
export type EligibleDecision = Decision & {
  eligible: true;
  canonicalUrl: string;
  effectiveDestination: DestinationIdentity;
  domain: string;
  title: string;
  titleDigest?: string;
  topics: [Topic, ...Topic[]];
  sourceId: string;
  sourceFamily: string;
  sourceClass: AutoPublishSourceClass;
  repositoryIds: string[];
  repositoryFullNames: string[];
  /** Desktop observation time; the mobile observation must independently pass freshness. */
  observedAt: string;
};
type IneligibleDecision = Decision & { eligible: false };
export type AutoPublishDecision = EligibleDecision | IneligibleDecision;
export type AutoPublishDeferral = "batch_cap" | "family_cap" | "topic_cap" | "batch_duplicate";
export type RankedBatch = {
  admitted: EligibleDecision[];
  deferred: { decision: EligibleDecision; reason: AutoPublishDeferral }[];
  rejected: IneligibleDecision[];
};

export function sanitizeAutoPublishTitle(title: string) {
  const cleaned = redactTitleUrls(title.normalize("NFKC")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<!--[^]*?-->|<[^>]*>/g, "")
    .replace(/[\p{Cc}\p{Cf}]/gu, character => /\s/u.test(character) ? " " : "")
    .replace(/\s+/gu, " ").trim());
  // The runtime schema bounds UTF-16 length; retain whole code points.
  return cleaned.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, "").trimEnd();
}

function documentDigest(value: string) {
  try {
    return getQualificationUrlIdentity(value).final_url_sha256;
  } catch {
    return null;
  }
}

function domainKey(domain: string) {
  return domain.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function urlDomain(value: string) {
  try {
    return domainKey(new URL(value).hostname);
  } catch {
    return "";
  }
}

function identityDomains(identity: AutoPublishIdentity) {
  return new Set([domainKey(identity.domain), urlDomain(identity.canonicalUrl), urlDomain(identity.effectiveDestination?.final_url_origin ?? "")].filter(Boolean));
}

function titleSimilarity(left: string, right: string) {
  const a = titleKey(sanitizeAutoPublishTitle(left));
  const b = titleKey(sanitizeAutoPublishTitle(right));
  if (!a || !b) return 0;
  if (a === b) return 1;
  const words = (title: string) => new Set(title.split(" ").filter(word => word.length > 2));
  const first = words(a);
  const second = words(b);
  const shared = [...first].filter(word => second.has(word)).length;
  return shared >= 3 ? shared / (first.size + second.size - shared) : 0;
}

function editorialTitle(identity: AutoPublishIdentity) {
  return identity.title === collectorDomainTitle(identity.domain) ? "" : identity.title;
}

function duplicateReasons(candidate: AutoPublishIdentity, other: AutoPublishIdentity) {
  const reasons: AutoPublishReason[] = [];
  if (candidate.id && candidate.id === other.id) reasons.push("duplicate_id");
  const candidateUrl = documentDigest(candidate.canonicalUrl);
  const otherUrl = documentDigest(other.canonicalUrl);
  const candidateDestination = candidate.effectiveDestination?.final_url_sha256 ?? candidateUrl;
  const otherDestination = other.effectiveDestination?.final_url_sha256 ?? otherUrl;
  if (candidateUrl && candidateUrl === otherUrl) reasons.push("duplicate_url");
  else if ((candidateDestination && (candidateDestination === otherDestination || candidateDestination === otherUrl)) ||
    (otherDestination && otherDestination === candidateUrl)) reasons.push("duplicate_destination");
  const otherDomains = identityDomains(other);
  if ([...identityDomains(candidate)].some(domain => otherDomains.has(domain))) reasons.push("duplicate_domain");
  if (candidate.repositoryIds?.some(id => other.repositoryIds?.includes(id)) ||
    candidate.repositoryFullNames?.some(name => other.repositoryFullNames?.some(value => value.toLowerCase() === name.toLowerCase()))) {
    reasons.push("duplicate_repository");
  }
  const candidateTitle = editorialTitle(candidate);
  const otherTitle = editorialTitle(other);
  const candidateDigest = candidate.titleDigest ?? titleDigest(sanitizeAutoPublishTitle(candidateTitle));
  const otherDigest = other.titleDigest ?? titleDigest(sanitizeAutoPublishTitle(otherTitle));
  if ((candidateDigest && candidateDigest === otherDigest) || titleSimilarity(candidateTitle, otherTitle) >= 0.8) {
    reasons.push("duplicate_title");
  }
  return reasons;
}

function validTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ? Date.parse(value) : NaN;
}

type BrowserObservation = QualificationSet["desktop"];
const THIRD_PARTY_NETWORK_REASONS: ReadonlySet<string> = new Set(["nested_network_failure", "resource_network_failure"]);
const IGNORED_FRAME_REASONS: ReadonlySet<string> = new Set([
  "interaction_unavailable", "candidate_frame_denied", "nested_frame_denied", "nested_frame_failure",
]);
const demonstrated = (observation: BrowserObservation) => observation.render_result === "interaction_observed" &&
  observation.functionality_result === "demonstrated" && observation.interaction_evidence.attempted &&
  observation.interaction_evidence.visible_state_changed;

function checkObservation(
  row: BrowserObservation,
  now: number,
  destination: DestinationIdentity | null,
  reasons: Set<AutoPublishReason>,
) {
  const age = now - validTime(row.observed_at);
  if (!(age >= 0 && age <= MAX_QUALIFICATION_EVIDENCE_AGE_MS)) reasons.add("qualification_stale");
  if (row.document_http_status !== 200 || row.render_result === "http_error") reasons.add("terminal_http_status");
  if (!destination || row.final_url_origin !== destination.final_url_origin ||
    row.final_url_sha256 !== destination.final_url_sha256) reasons.add("redirect_mismatch");
  // The qualification sandbox blocks unvalidated third-party subresources and
  // embeds; those are not failures of the candidate document itself.
  if (row.render_result === "network_blocked" ||
    row.network_failure_reasons.some(reason => !THIRD_PARTY_NETWORK_REASONS.has(reason))) reasons.add("network_guard_failure");
  if (row.render_result === "frame_denied" || row.frame_failure_reasons.includes("candidate_frame_denied")) reasons.add("frame_denied");
  if (row.render_result === "login_only") reasons.add("login_only");
  if (row.commercial_signal) reasons.add("commercial_landing");
  if (row.documentation_signal) reasons.add("documentation_site");
  if (row.render_result === "blank") reasons.add("blank");
  if (["inconclusive", "error", "timeout", "budget_exhausted"].includes(row.render_result) ||
    row.functionality_result === "inconclusive" ||
    row.frame_failure_reasons.some(reason => !IGNORED_FRAME_REASONS.has(reason))) {
    reasons.add("render_inconclusive");
  }
}

function validRepositoryIdentity(repository: AutoPublishRepository) {
  const { id, fullName } = repository;
  const url = publicHttpsUrl(repository.url);
  return /^[1-9][0-9]{0,99}$/.test(id) && /^[\w.-]+\/[\w.-]+$/.test(fullName) && url?.origin === "https://github.com" &&
    url.pathname.replace(/\/$/, "").toLowerCase() === `/${fullName.toLowerCase()}` && !url.search && !url.hash;
}

function repositoryDemoMatches(repository: AutoPublishRepository, documentDigests: ReadonlySet<string>) {
  const demo = publicHttpsUrl(repository.demoUrl);
  if (demo === null) return false;
  // Collector URLs drop a trailing slash; the screened page often keeps it.
  const alternate = new URL(demo.href);
  alternate.pathname = alternate.pathname.endsWith("/") ? alternate.pathname.replace(/\/+$/, "") || "/" : `${alternate.pathname}/`;
  return [demo.href, alternate.href].some(href => documentDigests.has(getQualificationUrlIdentity(href).final_url_sha256));
}

export function evaluateAutoPublishCandidate(input: AutoPublishInput): AutoPublishDecision {
  const { candidate, qualification, repositories } = input;
  const reasons = new Set<AutoPublishReason>();
  if (candidate.status !== "pending_review") reasons.add("status_not_pending");
  if (candidate.previouslyRejected || candidate.status === "rejected") reasons.add("previously_rejected");
  const canonical = publicHttpsUrl(candidate.canonicalUrl);
  const screened = candidate.screenedDestination;
  const screenedOrigin = screened ? publicHttpsUrl(screened.final_url_origin) : null;
  const canonicalIdentity = canonical ? getQualificationUrlIdentity(canonical.href) : null;
  const terminal = screened
    ? { final_url_origin: screened.final_url_origin, final_url_sha256: screened.final_url_sha256 }
    : canonicalIdentity;
  if (!canonical || !terminal || canonical.hostname !== candidate.domain || !candidate.id || candidate.id.length > 200 ||
    (screened && (screenedOrigin?.origin !== screened.final_url_origin || !/^[a-f0-9]{64}$/.test(screened.final_url_sha256)))) {
    reasons.add("destination_unsafe");
  }

  // A published entry contributes only its canonical origin to frame-src.
  if (canonical && terminal && canonical.origin !== terminal.final_url_origin) reasons.add("redirect_mismatch");

  const documentDigests = new Set([canonicalIdentity, terminal].flatMap(identity => identity ? [identity.final_url_sha256] : []));
  const matchingRepositories = repositories.filter(row => repositoryDemoMatches(row, documentDigests));
  const source = SOURCES.get(candidate.sourceId);
  const curatedClass = source?.[2];
  // The original collector source remains authoritative for attribution. A
  // later exact demo association still changes which safety gates apply.
  const sourceClass = curatedClass && curatedClass !== "interactive" && matchingRepositories.length ? "github" : curatedClass;
  const interactive = sourceClass === "interactive" || sourceClass === "github";
  if (!source || source[0] !== candidate.sourceFamily || source[1] !== candidate.sourceUrl) reasons.add("source_disallowed");
  const topics = [...new Set(candidate.topics)];
  if (!topics.length || topics.some(topic => !TOPICS.has(topic))) reasons.add("topic_disallowed");
  const title = sanitizeAutoPublishTitle(candidate.title);
  const titleSignals = candidate.titleSignals ??
    classifyCollectorTitle(candidate.title, title === collectorDomainTitle(candidate.domain) ? "" : title);
  // Never publish the "Website at <domain>" placeholder as a visible title.
  if (title === collectorDomainTitle(candidate.domain)) reasons.add("title_missing");
  if (!titleSignals.quality) reasons.add("title_quality");
  else if (!titleSignals.denied && !titleSignals.digest) reasons.add("title_digest_missing");
  if (titleSignals.denied || (canonical && deniedUrl(canonical)) || screened?.metadata_denied || (screenedOrigin && deniedUrl(screenedOrigin)) ||
    repositories.some(row => row.fork === true || [row.fullName, row.description ?? "", ...(row.topics ?? [])].some(deniedText))) {
    reasons.add("metadata_denied");
  }

  const now = validTime(input.now);
  let interactionCount = 0;
  if (!qualification) reasons.add("qualification_missing");
  else {
    if (qualification.candidate_id !== candidate.id || qualification.canonical_url !== candidate.canonicalUrl ||
      qualification.desktop.device !== "desktop" || qualification.mobile.device !== "mobile" ||
      !/^[1-9][0-9]{0,19}$/.test(qualification.run_id) || !Number.isSafeInteger(qualification.run_attempt) || qualification.run_attempt < 1) {
      reasons.add("qualification_mismatch");
    }
    if (qualification.qualifier_version !== QUALIFIER_VERSION) reasons.add("qualifier_version_unsupported");
    const observations = [qualification.desktop, qualification.mobile];
    for (const row of observations) checkObservation(row, now, terminal, reasons);

    if (interactive) {
      interactionCount = observations.filter(demonstrated).length;
      if (!interactionCount) reasons.add("interaction_missing");
      if (observations.some(row => !demonstrated(row) && !(row.render_result === "text_observed" && row.meaningful_text_length >= 40))) {
        reasons.add("interactive_content_insufficient");
      }
    } else if (sourceClass && observations.some(row => !(
      ["text_observed", "interaction_observed"].includes(row.render_result) &&
      row.meaningful_text_length >= MINIMUM_READING_TEXT[sourceClass]
    ))) reasons.add("reading_text_insufficient");
  }

  let maintained = false;
  let popularity = 0;
  if (interactive) {
    const identified = matchingRepositories.filter(validRepositoryIdentity);
    const active = identified.filter(row => row.archived === false);
    if (!identified.length) reasons.add("repository_identity_invalid");
    else if (!active.length) reasons.add("repository_archived");
    else {
      for (const repository of active) {
        const pushedAge = now - validTime(repository.pushedAt);
        if (!(pushedAge >= 0 && pushedAge <= MAINTENANCE_AGE_MS)) continue;
        maintained = true;
        if (Number.isSafeInteger(repository.stars) && repository.stars >= POPULARITY_STARS_STEP) {
          popularity = Math.max(popularity, Math.min(10, Math.floor(repository.stars / POPULARITY_STARS_STEP) + 2));
        }
      }
      // The collector records a push timestamp but no independent adoption
      // evidence. Use maintenance for eligibility and stars for ranking.
      if (!maintained) reasons.add("repository_activity_insufficient");
    }
  }

  const repositoryIds = [...new Set(repositories.map(row => row.id))].sort();
  const repositoryFullNames = [...new Set(repositories.map(row => row.fullName.toLowerCase()))].sort();
  const identity = {
    id: candidate.id, canonicalUrl: candidate.canonicalUrl, effectiveDestination: terminal ?? undefined,
    domain: candidate.domain, title, titleDigest: titleSignals.digest, repositoryIds, repositoryFullNames,
  };
  const catalogue = [...input.bundled, ...input.runtime];
  for (const other of catalogue) for (const reason of duplicateReasons(identity, other)) reasons.add(reason);

  if (reasons.size || !sourceClass || !qualification || !terminal) {
    return { eligible: false, candidateId: candidate.id, score: 0, scoreBreakdown: {}, reasons: [...reasons] };
  }

  const familyCount = catalogue.filter(other => other.sourceFamily === candidate.sourceFamily).length;
  const topicCount = catalogue.filter(other => other.topics?.[0] === topics[0]).length;
  const sourceDomains = new Set([urlDomain(candidate.sourceUrl)]);
  for (const id of input.corroboratingSourceIds ?? []) {
    const corroborating = SOURCES.get(id);
    if (corroborating) sourceDomains.add(urlDomain(corroborating[1]));
  }
  const domains = identityDomains(identity);
  const scoreBreakdown = {
    curatedSource: SOURCE_WEIGHT[sourceClass],
    interaction: interactionCount * 12,
    repositoryIdentity: interactive ? 12 : 0,
    maintenance: maintained ? 8 : 0,
    popularity,
    corroboration: Math.min(15, (sourceDomains.size - 1) * 5),
    novelty: Math.max(0, 8 - topicCount),
    domainPenalty: catalogue.some(other => [...identityDomains(other)].some(related =>
      [...domains].some(domain => domain.endsWith(`.${related}`) || related.endsWith(`.${domain}`)))) ? -4 : 0,
    titlePenalty: catalogue.some(other => titleSimilarity(title, other.title) >= 0.55) ? -6 : title.length < 12 ? -3 : 0,
    familyPenalty: -Math.min(8, familyCount),
  };
  return {
    eligible: true, candidateId: candidate.id, score: Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0),
    scoreBreakdown, reasons: [interactionCount ? "eligible_interactive" : "eligible_reading"],
    canonicalUrl: candidate.canonicalUrl, effectiveDestination: terminal, domain: candidate.domain, title,
    topics: topics as [Topic, ...Topic[]], sourceId: candidate.sourceId, sourceFamily: candidate.sourceFamily, sourceClass,
    titleDigest: identity.titleDigest, repositoryIds, repositoryFullNames, observedAt: qualification.desktop.observed_at,
  };
}

const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

export function rankAutoPublishBatch(decisions: readonly AutoPublishDecision[], cap: number): RankedBatch {
  if (!Number.isInteger(cap) || cap < 1 || cap > 20) throw new RangeError("Auto-publish cap must be 1–20");
  const ordered = decisions.filter(row => row.eligible).sort((left, right) => right.score - left.score ||
    validTime(left.observedAt) - validTime(right.observedAt) || compareText(left.candidateId, right.candidateId));
  const ranked: RankedBatch = {
    admitted: [], deferred: [],
    rejected: decisions.filter(row => !row.eligible).sort((left, right) => compareText(left.candidateId, right.candidateId)),
  };
  const families = new Map<string, number>();
  const topics = new Map<Topic, number>();
  for (const decision of ordered) {
    const familyCount = families.get(decision.sourceFamily) ?? 0;
    const topicCount = topics.get(decision.topics[0]) ?? 0;
    const identity = { ...decision, id: decision.candidateId };
    let reason: AutoPublishDeferral | undefined;
    if (ranked.admitted.some(other => duplicateReasons(identity, { ...other, id: other.candidateId }).length > 0)) reason = "batch_duplicate";
    else if (ranked.admitted.length >= cap) reason = "batch_cap";
    else if (familyCount >= FAMILY_CAP) reason = "family_cap";
    else if (topicCount >= TOPIC_CAP) reason = "topic_cap";
    if (reason) ranked.deferred.push({ decision, reason });
    else {
      ranked.admitted.push(decision);
      families.set(decision.sourceFamily, familyCount + 1);
      topics.set(decision.topics[0], topicCount + 1);
    }
  }
  return ranked;
}
