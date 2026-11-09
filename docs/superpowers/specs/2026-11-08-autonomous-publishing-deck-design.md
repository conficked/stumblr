# Autonomous Publishing and Fresh Discovery Deck Design

## Intent

Stumblr should continuously grow without requiring the owner to inspect GitHub Actions artifacts or manually publish every safe candidate. Hourly discovery remains broad and review-only. A separate daily process may publish only high-confidence destinations that match Stumblr's established character: interactive web experiments, creative coding, maps, games, digital art, archives, science, music, education, nature, and distinctive independent sites.

The browsing experience should also favor genuine discovery. A person should see every eligible destination in their current browsing scope before Stumblr repeats one, while a small topic pool must remain usable after it is exhausted.

## Goals

- Discover and technically qualify candidates hourly as today.
- Automatically publish a diverse daily batch of genuinely high-confidence candidates.
- Apply automatic publication to every allowlisted Stumblr source class, including individual blog/feed articles; no class requires routine human approval.
- Prefer 10–20 additions when that many candidates clear the bar, with no minimum quota and a hard cap of 20 per release.
- Make GitHub live demos a first-class source without treating repository popularity or an HTTP 200 as sufficient quality evidence.
- Preserve zero-secret GitHub OIDC boundaries and keep collection, qualification, and publication as separate authorities.
- Automatically remove only hard failures that would produce a blank, blocked, unsafe, dead, or login-trapped Stumblr experience.
- Give each device a persistent shuffled deck: unseen content first, automatic reshuffle only after exhaustion, and no immediate cross-cycle repeats.
- Keep History, Saves, exclusions, and reset behavior understandable and local to the device.
- Make every automatic decision auditable and reversible.

## Non-goals

- User accounts or cross-device history synchronization.
- Social or collaborative filtering, behavioral profiling, or opaque personalized ranking.
- AI-generated descriptions, AI editorial judgments, or a quota that forces weak content into rotation.
- Automatically broadening a user's selected topic when its pool is exhausted.
- Treating minor resource failures, slow loading, or one inconclusive observation as grounds for removal.
- Replacing the manual publisher; maintainers retain a manual reviewed-snapshot path and emergency rollback authority.

## Anti-goals

The design fails even if it is technically automated when it publishes routine corporate pages, storefronts, recruiting pages, login walls, generic documentation, thin SEO pages, clones, repository pages instead of demos, or pages that merely load without a rewarding result. It also fails if a transient check silently removes working content, if automatic publication can overwrite a newer reviewed snapshot, or if users begin seeing the same small group of destinations repeatedly while unseen entries remain.

## Current system

- `discovery-manual-review.yml` discovers hourly, imports candidates into the private SQLite queue, and produces desktop/mobile browser evidence.
- Candidate qualification is evidence-only. Evidence currently lives in short-retention artifacts and is not durable queue state.
- `catalogue-publish.yml` is manual-only and publishes the committed complete snapshot through a distinct OIDC audience.
- Runtime publication marks included candidate URLs `reviewed_exportable`; runtime rechecks can quarantine hard failures, and quarantined URLs are filtered from `/api/catalogue` immediately.
- The client stores history locally. The sampler cycles using history length modulo pool length, but it does not persist an explicit deck per preference scope or reliably prioritize newly added IDs when the pool changes.

## Approaches considered

### Selected: daily high-confidence release

Hourly runs continue to collect and qualify. Qualification evidence is persisted durably. A separate scheduled publisher chooses the strongest diverse candidates once daily, merges them into the current runtime snapshot, and publishes one auditable revision.

This provides a full day of candidates for diversity ranking, one rollback point, bounded churn, and a clear separation between collector and publisher authority.

### Rejected: immediate hourly publication

Publishing after every qualifying run would surface content faster, but each decision would have less comparative context, releases would be noisy, and rollback/audit history would fragment across as many as 24 revisions per day. It also couples discovery failures more closely to public state.

### Deferred: account-backed personalization

Accounts could synchronize seen history and learn from likes/dislikes, similar to historical collaborative discovery systems. They are unnecessary for the requested no-repeat behavior and would introduce identity, privacy, deletion, abuse, and migration work. Device-local state is the appropriate current boundary.

## Durable qualification evidence

The qualifier continues to run with no publication authority. After creating its private artifact, the discovery workflow sends a bounded evidence batch to the collector-authenticated API. The server validates and stores observations against an existing candidate:

- canonical candidate URL and immutable candidate ID;
- discovery run ID and attempt;
- desktop/mobile device;
- final URL and document status;
- render and functionality result;
- meaningful-text count only, never destination body text;
- safe-interaction attempted and visible-state-changed flags;
- bounded failure classifications;
- observation timestamp and qualifier version.

Evidence ingestion is idempotent by candidate, run, attempt, device, and qualifier version. It cannot change candidate status to publishable. It may only add evidence or quarantine an explicitly hard-failed candidate under the existing collector authority.

Evidence and candidate rows live in SQLite on the persistent disk. GitHub artifacts remain short-lived diagnostic supplements.

## Deterministic high-confidence policy

Automatic publication uses a versioned, tested policy. A candidate must satisfy every universal gate and its source-specific gate.

### Universal gates

- Current status is `pending_review`, not rejected, quarantined, or already published.
- Canonical URL is HTTPS and remains on the validated public destination plan.
- Latest desktop and mobile observations come from the same successful qualifier version and are recent enough for the daily release.
- Both devices return a terminal document status below 300 and a final URL consistent with the screened canonical redirect chain.
- Neither observation is blank, login-only, frame-denied, HTTP-error, timeout, network-blocked, or inconclusive.
- No candidate or subresource safety guard failed.
- URL, domain, repository identity, and effective demo destination do not duplicate bundled or runtime catalogue entries.
- Candidate belongs to an allowed Stumblr topic and source family.
- Title, hostname, source metadata, and repository metadata do not match deterministic deny patterns for stores, pricing, authentication, recruiting, agencies, generic documentation, donation-only pages, repository pages, or known thin-content patterns.
- The candidate has not been manually rejected previously.

### Interactive candidates

GitHub live demos and candidates classified as interactive must render meaningful content on desktop and mobile and demonstrate a safe visible state change on at least one device. Their repository must be non-archived, identify the same demo URL, and show either recent maintenance or credible adoption. Popularity is supporting evidence, never a standalone pass.

### Reading and reference candidates

Articles, archives, educational references, and independent personal sites may qualify through meaningful rendered text on both devices without forced interaction. They must come from an allowlisted curated source and pass stricter deny-pattern, duplicate, title-quality, recency, and source-reputation checks. Individual blog/feed articles are eligible for automatic publication; they do not require a routine human pass.

The system deliberately accepts the limitation that deterministic metadata and rendering checks cannot understand prose as deeply as a human editor. It manages that risk through curated source allowlists, deny patterns, diversity caps, production proof, public reporting controls, and rapid quarantine—not by silently reintroducing a manual approval requirement.

### Quality score and diversity

After hard gates, a transparent score orders the daily batch using:

- stronger interaction evidence;
- independent source corroboration;
- GitHub repository/demo identity quality;
- recent maintenance or stable long-lived provenance;
- topic and source-family novelty relative to the current catalogue and the same release;
- penalties for repeated domains, near-duplicate titles, generic titles, and overrepresented source families.

The release has no minimum. It publishes at most 20 candidates, with per-family and per-primary-topic caps so a productive GitHub query cannot crowd out the rest of the web. Candidates beyond the cap remain pending for a later day and are rescored against the next release.

The policy output records a reason code and score breakdown for every admitted or deferred candidate. It does not retain destination body content.

## Daily publisher and authority boundaries

Add a dedicated `catalogue-auto-publish.yml` scheduled once daily and manually dispatchable for recovery. It receives its own OIDC workflow identity and a dedicated auto-publication audience. The server accepts that identity only from the immutable repository, `main`, the exact workflow path, and `schedule` or `workflow_dispatch` events.

The automatic publisher requests an atomic server-side preview containing:

- the current validated runtime snapshot;
- the ranked additions and their decision evidence;
- hard-failure removals already quarantined by rechecks;
- the proposed complete next snapshot;
- counts by source, topic, evidence class, and decision reason;
- a content hash and expected prior revision.

The workflow publishes that exact preview with a second authenticated request. The server rejects stale expected revisions, changed preview hashes, invalid schemas, duplicate keys, cap violations, or a policy-version mismatch. Selection and installation occur transactionally against one database state, preventing a workflow from assembling a stale snapshot client-side.

Automatic revisions use trusted OIDC run identity (`sha`, `run_id`, and `run_attempt`) so multiple daily releases from the same application commit cannot collide. Manual reviewed publications remain supported and supersede older automatic proposals through issued-at and expected-revision checks.

Every release writes an audit record with the prior revision, new revision, policy version, additions, removals, score/reason data, workflow run identity, and timestamp. The existing previous snapshots remain rollback material.

Auto-published entries retain the existing `evaluation_only` catalogue status and public evaluation-pool disclosure because technical confidence is not publisher permission. Their provenance uses deterministic source-specific templates and an explicit automatic-policy actor containing the policy version and workflow run identity.

## Removal and recovery policy

Runtime rechecks may automatically quarantine a published destination only for a repeated hard failure that would materially break Stumblr:

- DNS or public-network safety failure;
- dead domain or repeated terminal HTTP error;
- explicit frame denial;
- blank frame after the bounded hydration allowance;
- redirect to authentication or an unrelated unsafe destination;
- login-only result;
- repeated browser-enforced network failure.

Except for security and explicit framing denial, one failed observation creates a suspect flag and schedules confirmation; a second independent failed observation is required before quarantine. Slow loads, missing optional resources, console noise, or an inconclusive result do not remove content.

A candidate that fails the immediate production proof for the release that first published it is rolled back from that release without waiting for a second failure. The two-observation rule applies after an entry has passed its initial production proof and become established.

Quarantine excludes the URL immediately at catalogue read time. Restoration is never automatic from one success: it requires two later clean rechecks or a manual reviewed publication newer than the quarantine evidence. Audit history records both transitions.

## Persistent discovery deck

Replace implicit history-modulo cycling with explicit, versioned device-local deck state.

### Scope

A deck is keyed by normalized browsing scope: sampler mode, sorted selected topics, and evaluation-pool preference. The browser retains a bounded least-recently-used set of scope decks.

Each deck stores:

- shuffled remaining eligible IDs for the current cycle;
- IDs already shown in the current cycle;
- a short recent tail used for cross-cycle separation;
- catalogue membership fingerprint;
- cycle number and last-used timestamp.

### Selection behavior

- Draw only from remaining eligible IDs; therefore no destination repeats within a cycle.
- When runtime publication adds IDs, inject unseen IDs into the remaining deck ahead of recycled content while preserving randomized order and diversity penalties.
- When entries are quarantined, excluded, or removed, discard their IDs from the deck without resetting the cycle.
- On exhaustion, create a newly shuffled cycle for the same scope.
- Exclude the previous cycle's last 10 IDs from the next cycle's first 10 positions, reduced proportionally for small pools.
- Continue applying topic relevance, domain separation, structural-type diversity, and source-cluster diversity while drawing from the deck.
- Do not silently broaden selected topics. On a topic cycle boundary, continue with a fresh topic-scoped cycle and offer a non-blocking “Broaden topics” action.
- History and Saves always permit deliberate revisits and do not alter deck eligibility.

### Storage and migration

Move client state to a backward-compatible version 2. Existing preferences, saves, reports, exclusions, and history migrate without loss. Initial deck state is derived from eligible catalogue membership and recent history so migration does not immediately repeat the active destination.

History remains user-visible and bounded independently from deck state to avoid localStorage growth. Deck state stores IDs, not full entries. If local storage is unavailable or corrupt, Stumblr falls back to an in-memory deck for the session.

“Reset discovery history” clears history and all scope decks but preserves preferences, Saves, exclusions, and reports. Exported local data includes the deck version and state.

Deleting one visible History item does not make it unseen or change deck progress. Only “Reset discovery history” resets scope decks and permits the catalogue to begin again from a fresh first cycle.

## User experience

The normal interface remains one-button discovery. No account or mandatory setup is introduced.

- History explains that Stumblr shows unseen destinations first on this device.
- Reset wording makes clear that resetting allows repeats again.
- At a topic cycle boundary, Stumblr continues working and may show a subtle “New cycle · Broaden topics” notice.
- Automatic publication requires no user action. Newly released destinations become eligible on the next catalogue refresh and are prioritized as unseen.
- No internal confidence score, GitHub popularity number, or operational queue state is exposed in the public browsing interface.

## Observability and operations

Each hourly discovery run reports discovered, selected, evidence-persisted, hard-failed, and inconclusive counts separately. Each daily publisher reports considered, admitted, deferred, rejected, duplicate, capped, and published counts by family and topic.

The automatic workflow fails closed: if evidence retrieval, preview creation, schema validation, publication, or post-publication verification fails, the current runtime snapshot remains active. Zero qualifying candidates is a successful no-op release, not a red workflow.

After publication, the workflow verifies the exact revision and entry count through `/api/catalogue`, samples newly published destinations through the Stumblr sandbox, and immediately rolls back only the failing fresh additions if the proof detects a hard failure. Rollback uses a dedicated authenticated server operation referencing the audited prior revision and failed addition IDs; it cannot install arbitrary caller-supplied content.

Runtime hard-failure confirmation includes the browser sandbox in addition to the existing HTTP/header rechecker. Network/header evidence alone may immediately quarantine only security failures and explicit framing denial.

Operational documentation includes manual dispatch, dry-run preview, audit inspection, rollback, policy-version changes, and disabling the schedule without disabling discovery.

Qualification observations and detailed decision evidence use bounded retention with compact latest-state summaries retained per candidate. Release audit records and snapshot revision metadata remain durable; superseded raw observations are pruned on a documented schedule so SQLite growth is bounded.

## Testing and acceptance

### Automatic publication

- Unit tests cover every universal/source-specific gate and reason code.
- Fixture candidates prove that stores, docs, login walls, clones, blank frames, frame denial, HTTP errors, stale evidence, and mismatched desktop/mobile runs cannot publish.
- Positive fixtures cover an interactive GitHub demo and a rendered independent reading site.
- Diversity tests prove the 20-entry cap and per-family/topic caps.
- OIDC tests prove the collector cannot publish, the auto publisher cannot collect, feature refs cannot publish, and only the exact scheduled/manual auto workflow is trusted.
- Transaction tests prove stale previews, duplicate revisions, changed hashes, and concurrent manual publication fail safely.
- A zero-candidate day completes successfully without changing the live revision.

### Removal

- Security and explicit frame-denial fixtures quarantine immediately.
- Other hard failures require two independent observations.
- Inconclusive, slow, and optional-resource failures remain live but flagged.
- Quarantine immediately disappears from `/api/catalogue`; restoration follows the two-success/manual-newer rule.

### Discovery deck

- Every eligible ID appears once before any repeat within a scope.
- New catalogue IDs are shown before recycled entries.
- Topic scopes remain isolated and do not silently broaden.
- Small pools reshuffle indefinitely without immediate boundary repeats.
- Catalogue additions/removals and exclusions update a deck without losing valid progress.
- Version-1 local state migrates without losing user-visible data.
- Reset clears history/decks but preserves Saves, exclusions, reports, and preferences.
- Desktop and mobile production tests exercise multiple cycles and a newly auto-published destination.

## Rollout

1. Add durable evidence storage and dry-run policy evaluation while manual publication remains authoritative.
2. Run the daily workflow in report-only mode for at least three complete daily releases and compare its choices with the existing reviewed catalogue style.
3. Enable automatic publication with a temporary cap of 5, verify audit/rollback behavior, then raise the cap to 20.
4. Enable repeated-hard-failure quarantine after confirmation fixtures and production proof.
5. Ship client-state migration and persistent decks independently; it does not depend on auto publication.

At every stage, disabling the automatic publisher leaves hourly discovery, manual publication, and the current live snapshot intact.

## Decisions made

- Daily releases rather than immediate hourly publication.
- A target of 10–20 only when quality supports it; hard cap 20, no minimum.
- Deterministic, explainable quality policy; no AI editorial layer.
- All allowlisted source classes, including individual blog/feed articles, are eligible for automation; quality risk is handled by deterministic gates and rollback rather than routine manual review.
- Separate OIDC authority and server-side atomic preview/publish.
- Device-local persistent decks; no accounts.
- Selected topics never broaden silently.
- Automatic removal only for detrimental hard failures, usually after confirmation.
- Fresh additions that fail their own release proof roll back immediately; established entries use confirmation.
- Auto-published entries remain `evaluation_only` and retain the public disclosure.

## Builder discretion

The implementation plan may choose exact migration numbers, table/index names, score weights, per-family/topic diversity caps, history length, number of retained scope decks, daily UTC schedule, evidence-retention duration, and report artifact layout. Those choices must preserve the authority boundaries, deterministic reason codes, hard cap, auditability, and user-visible behavior described above.
