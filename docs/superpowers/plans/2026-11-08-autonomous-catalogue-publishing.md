# Autonomous Catalogue Publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist browser evidence and automatically publish a safe, diverse daily catalogue release across every allowlisted Stumblr source class.

**Architecture:** Keep hourly collection, browser qualification, and daily publication as separate OIDC authorities. Persist bounded qualification observations in SQLite, evaluate candidates with a deterministic versioned policy, and let a dedicated daily workflow atomically preview, commit, prove, and if necessary roll back a complete runtime snapshot.

**Tech Stack:** Next.js 16 route handlers, Node 22, TypeScript, Zod, SQLite, GitHub Actions OIDC, Playwright, Vitest, Python 3.12.

**Spec:** `docs/superpowers/specs/2026-11-08-autonomous-publishing-deck-design.md`

## Global Constraints

- Hourly discovery remains review-only and cannot publish.
- Daily automatic releases have no minimum, a canary cap of 5, and a full hard cap of 20.
- Every allowlisted source class, including individual blog/feed articles, is eligible.
- No AI classification or generated destination-body summaries.
- Auto-published entries remain `evaluation_only` with the existing disclosure.
- Only exact `main` workflow identities may collect or publish; no stored integration secret.
- Publication selection and snapshot installation are server-side, atomic, auditable, and stale-revision protected.
- Fresh additions that fail their release proof roll back immediately; established entries use two independent hard-failure observations except security/framing failures.
- Zero qualifying candidates is a successful no-op.

## Review Focus

- Evidence for two different qualifier runs/devices must not be combined into a false desktop/mobile pair; Task 1 adds a mismatched-run test.
- A generic blog article with a clean HTTP response but a denied/login/blank browser result must not publish; Task 2 adds source-class fixtures.
- Replaying or racing preview/commit requests must not create two snapshots or overwrite a newer manual revision; Task 3 adds transaction tests.
- A newly published destination that fails production proof must be removed without reverting unrelated additions; Task 4 adds selective rollback tests.
- Transient or inconclusive established-entry checks must not quarantine a working site; Task 5 adds two-strike state tests.

---

### Task 1: Durable browser qualification evidence

**Files:**
- Create: `db/migrations/006_candidate_qualification_evidence.sql`
- Create: `src/lib/catalogue/qualificationEvidence.ts`
- Create: `src/lib/catalogue/qualificationEvidence.test.ts`
- Create: `src/app/api/catalogue/evidence/route.ts`
- Modify: `.github/workflows/discovery-manual-review.yml`
- Modify: `scripts/tests/test_discovery_workflow_qualification.py`

**Interfaces:**
- Consumes qualifier JSON rows produced by `scripts/qualify_review_candidates.mjs`.
- Produces `importQualificationEvidence(input: unknown, actor: CollectionActor): QualificationImportResult`.
- Produces `getLatestQualificationSet(candidateId: string): QualificationSet | null`, returning only a same-run, same-attempt, same-version desktop/mobile pair.

- [ ] **Step 1: Write failing migration and evidence-import tests**

Cover valid two-device import, idempotent replay, unknown candidate rejection, mismatched canonical URL rejection, bounded failure arrays, body-text rejection, and the Review Focus mismatched-run case.

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run src/lib/catalogue/qualificationEvidence.test.ts --environment node`

Expected: FAIL because the migration/module do not exist.

- [ ] **Step 3: Implement evidence storage and query interfaces**

Use a composite uniqueness key of candidate ID, GitHub run ID, run attempt, qualifier version, and device. Retain counts/classifications only; never retain destination body text.

- [ ] **Step 4: Add the collector-authenticated evidence route**

`POST /api/catalogue/evidence` accepts at most 48 observations and 1 MiB, authenticates with purpose `collect`, and calls `importQualificationEvidence` without changing publication status.

- [ ] **Step 5: Wire qualifier artifacts into durable ingestion**

After browser qualification succeeds, post the exact artifact with `run_id`, `run_attempt`, and a pinned qualifier version. Add structural workflow tests proving no publisher token reaches the qualifier.

- [ ] **Step 6: Run GREEN verification**

Run: `npx vitest run src/lib/catalogue/qualificationEvidence.test.ts src/lib/catalogue/candidateQueue.test.ts --environment node`

Run: `python3 -m unittest scripts.tests.test_discovery_workflow_qualification -v`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add db/migrations/006_candidate_qualification_evidence.sql src/lib/catalogue/qualificationEvidence* src/app/api/catalogue/evidence .github/workflows/discovery-manual-review.yml scripts/tests/test_discovery_workflow_qualification.py
git commit -m "feat: persist bounded candidate qualification evidence"
```

### Task 2: Deterministic high-confidence policy and entry builder

**Files:**
- Create: `src/lib/catalogue/autoPublishPolicy.ts`
- Create: `src/lib/catalogue/autoPublishPolicy.test.ts`
- Create: `src/lib/catalogue/autoPublishEntry.ts`
- Create: `src/lib/catalogue/autoPublishEntry.test.ts`

**Interfaces:**
- Consumes `QualificationSet` from Task 1 plus candidate, repository, bundled, and runtime identity snapshots.
- Produces `evaluateAutoPublishCandidate(input: AutoPublishInput): AutoPublishDecision` with `eligible`, numeric `score`, and stable reason codes.
- Produces `buildAutoPublishedEntry(decision: EligibleDecision, actor: AutoPublishActor): ReviewedRuntimeEntry`.
- Produces `rankAutoPublishBatch(decisions: AutoPublishDecision[], cap: number): RankedBatch` with cap `1..20`.

- [ ] **Step 1: Write failing universal-gate tests**

Cover stale/mismatched evidence, non-200 terminal status, redirect mismatch, network guard failure, frame denial, login-only, blank, inconclusive, duplicates, prior rejection, disallowed source, unsafe metadata, and near-duplicate titles.

- [ ] **Step 2: Write failing source-class tests**

Positive fixtures: interactive GitHub demo with one demonstrated interaction; rendered curated blog article; stable educational/archive page; small-web/webring homepage. Negative fixtures: store, pricing, recruiting, generic docs, repository page, donation-only page, clone, and the Review Focus clean-HTTP login/blank article.

- [ ] **Step 3: Write failing ranking and entry-building tests**

Assert no minimum, cap 20, deterministic tie-breaking, family/topic diversity, deferred overflow, sanitized titles, deterministic source-specific descriptions, `evaluation_only`, null `policyBasis`, and provenance actor `stumblr-auto-policy/<version> run/<run-id>`.

- [ ] **Step 4: Run tests to verify RED**

Run: `npx vitest run src/lib/catalogue/autoPublishPolicy.test.ts src/lib/catalogue/autoPublishEntry.test.ts --environment node`

- [ ] **Step 5: Implement versioned policy `AUTO_POLICY_VERSION = "1"`**

Use explicit allow/deny tables and reason-code enums. GitHub interaction/identity rules and reading/reference render rules remain separate. Popularity may increase score but cannot satisfy a hard gate.

- [ ] **Step 6: Implement deterministic descriptions and diversity ranking**

Default caps: maximum 8 per source family and 6 per primary topic inside the overall cap. Ties sort by score descending, observed time ascending, then candidate ID.

- [ ] **Step 7: Run GREEN verification and commit**

Run: command from Step 4; expected PASS.

```bash
git add src/lib/catalogue/autoPublishPolicy* src/lib/catalogue/autoPublishEntry*
git commit -m "feat: score high-confidence catalogue candidates"
```

### Task 3: Atomic preview, publication, audit, and rollback

**Files:**
- Create: `db/migrations/007_auto_publication_audit.sql`
- Create: `src/lib/catalogue/autoPublisher.ts`
- Create: `src/lib/catalogue/autoPublisher.test.ts`
- Create: `src/app/api/catalogue/auto/preview/route.ts`
- Create: `src/app/api/catalogue/auto/commit/route.ts`
- Create: `src/app/api/catalogue/auto/rollback/route.ts`
- Modify: `src/lib/security/cataloguePublisher.ts`
- Modify: `src/lib/security/cataloguePublisher.test.ts`
- Modify: `src/lib/catalogue/runtimeStore.ts`
- Modify: `src/lib/catalogue/runtimeStore.test.ts`

**Interfaces:**
- Produces publisher purpose `auto_publish` for exact workflow `catalogue-auto-publish.yml`, audience `https://stumblr.dev/catalogue-auto-publish`, events `schedule|workflow_dispatch`, and unique revision `${sha}:${run_id}:${run_attempt}`.
- Produces `createAutoPublicationPreview(actor, requestedCap): AutoPublicationPreview`.
- Produces `commitAutoPublicationPreview(actor, proposalId, expectedRevision, contentHash): CommitResult`.
- Produces `rollbackFreshAdditions(actor, releaseRevision, failedIds): RollbackResult`.

- [ ] **Step 1: Write failing OIDC boundary tests**

Prove collector/manual tokens cannot call auto routes, auto tokens cannot call collection/manual routes, feature refs fail, wrong workflows/events/audiences fail, and run identity makes revisions unique on one SHA.

- [ ] **Step 2: Write failing preview/commit transaction tests**

Cover complete-snapshot union, duplicates, expected prior revision, content hash, idempotent retry, stale preview, changed policy version, concurrent manual publication, zero-candidate no-op, and Review Focus race/replay cases.

- [ ] **Step 3: Write failing selective rollback tests**

Assert only fresh failed IDs are removed, unrelated additions remain, arbitrary caller payloads are impossible, and rollback links to prior/new audit revisions.

- [ ] **Step 4: Run tests to verify RED**

Run: `npx vitest run src/lib/security/cataloguePublisher.test.ts src/lib/catalogue/autoPublisher.test.ts src/lib/catalogue/runtimeStore.test.ts --environment node`

- [ ] **Step 5: Implement audit schema and server-side proposal state**

Store proposal ID/hash, expected revision, policy version, counts, decision JSON, status, actor identity, and timestamps. Keep snapshots as complete validated payloads.

- [ ] **Step 6: Implement auto OIDC, preview, commit, and rollback routes**

Each route enforces JSON/content-size bounds and no-store responses. Preview is read/record only; commit installs only its unchanged server-side proposal in one transaction.

- [ ] **Step 7: Run GREEN verification and commit**

Run: command from Step 4; expected PASS.

```bash
git add db/migrations/007_auto_publication_audit.sql src/lib/security src/lib/catalogue/autoPublisher* src/lib/catalogue/runtimeStore* src/app/api/catalogue/auto
git commit -m "feat: publish atomic audited catalogue proposals"
```

### Task 4: Daily workflow, staged rollout, and production proof

**Files:**
- Create: `.github/workflows/catalogue-auto-publish.yml`
- Create: `scripts/verify_auto_publication.mjs`
- Create: `scripts/tests/test_auto_publish_workflow.py`
- Create: `tests/e2e/auto-published-candidate-fixtures.spec.ts`
- Modify: `src/lib/catalogue/autoPublisher.ts`
- Modify: `src/lib/catalogue/autoPublisher.test.ts`
- Modify: `playwright.config.ts`

**Interfaces:**
- Workflow schedule: once daily at `37 17 * * *`; manual input `mode=report|publish`, default `report`.
- Server rollout stage: first 3 distinct scheduled evaluations are report-only; next 3 successful scheduled releases use cap 5; later scheduled releases use cap 20. Manual report runs never advance the stage.
- Produces `getAutoPublicationRolloutStage(actor: AutoPublishActor): AutoPublicationRolloutStage` and includes the stage/cap in every preview response.
- `verify_auto_publication.mjs --base-url --revision --candidate-ids --output` returns failing fresh IDs using desktop/mobile Stumblr sandbox checks.

- [ ] **Step 1: Write failing workflow-structure tests**

Assert exact schedule, main checkout without credentials, dedicated OIDC audience, preview-before-commit, report-only branch, cap-stage response, proof-after-commit, selective rollback, concurrency, timeouts, artifacts, and no collector/manual audience.

- [ ] **Step 2: Write failing production-proof fixtures**

Cover a good interactive addition, good reading addition, blank fresh addition, frame-denied fresh addition, and selective rollback payload generation.

- [ ] **Step 3: Run tests to verify RED**

Run: `python3 -m unittest scripts.tests.test_auto_publish_workflow -v`

Run: `npx playwright test tests/e2e/auto-published-candidate-fixtures.spec.ts --project=chromium`

- [ ] **Step 4: Implement workflow and proof script**

The workflow uploads preview, decision, proof, and rollback reports for three days. A zero-addition release exits successfully after verifying the live revision remains unchanged.

- [ ] **Step 5: Run GREEN verification and commit**

Run the commands from Step 3; expected PASS.

```bash
git add .github/workflows/catalogue-auto-publish.yml scripts/verify_auto_publication.mjs scripts/tests/test_auto_publish_workflow.py tests/e2e/auto-published-candidate-fixtures.spec.ts playwright.config.ts
git commit -m "feat: schedule staged autonomous catalogue releases"
```

### Task 5: Established-entry browser health and two-strike quarantine

**Files:**
- Create: `src/lib/catalogue/runtimeHealth.ts`
- Create: `src/lib/catalogue/runtimeHealth.test.ts`
- Modify: `src/lib/catalogue/qualificationEvidence.ts`
- Modify: `src/app/api/catalogue/evidence/route.ts`
- Modify: `.github/workflows/discovery-manual-review.yml`
- Modify: `scripts/recheck_runtime_catalogue.py`
- Modify: `scripts/tests/test_discovery_workflow_schedule.py`

**Interfaces:**
- Produces `applyRuntimeHealthEvidence(candidateId, observationPair): HealthTransition`.
- Produces transitions `healthy|suspect|quarantined|recovery_pending|restored` with stable reason codes.

- [ ] **Step 1: Write failing transition tests**

Assert immediate security/frame-denial quarantine, first ordinary hard failure becomes suspect, second independent failure quarantines, inconclusive/slow/optional-resource failures remain live, and two later clean pairs restore while one creates `recovery_pending`.

- [ ] **Step 2: Write failing workflow tests**

Assert the six-hour recheck creates bounded runtime browser inputs, persists HTTP/header evidence first, then browser evidence, and never grants publication authority.

- [ ] **Step 3: Run tests to verify RED**

Run: `npx vitest run src/lib/catalogue/runtimeHealth.test.ts --environment node`

Run: `python3 -m unittest scripts.tests.test_discovery_workflow_schedule -v`

- [ ] **Step 4: Implement state transitions and bounded browser rechecks**

Reuse the qualifier's public-origin pinning and sandbox. Cap established runtime browser rechecks at 24 per six-hour run.

- [ ] **Step 5: Run GREEN verification and commit**

Run the commands from Step 3; expected PASS.

```bash
git add src/lib/catalogue/runtimeHealth* src/lib/catalogue/qualificationEvidence* src/app/api/catalogue/evidence .github/workflows/discovery-manual-review.yml scripts/recheck_runtime_catalogue.py scripts/tests/test_discovery_workflow_schedule.py
git commit -m "feat: quarantine repeated runtime browser failures"
```

### Task 6: Evidence retention, operations, deployment, and live dry run

**Files:**
- Create: `src/lib/catalogue/evidenceRetention.ts`
- Create: `src/lib/catalogue/evidenceRetention.test.ts`
- Modify: `src/lib/catalogue/autoPublisher.ts`
- Modify: `src/lib/catalogue/autoPublisher.test.ts`
- Modify: `docs/operations/runtime-catalogue.md`
- Modify: `README.md`

**Interfaces:**
- Produces `pruneQualificationEvidence(now: Date): RetentionResult`, retaining latest state per candidate, durable release audits, and 30 days of superseded raw observations.

- [ ] **Step 1: Write failing retention tests**

Assert latest candidate state and all release audits remain, raw observations newer than 30 days remain, and only superseded older observations are pruned.

- [ ] **Step 2: Implement retention and call it after daily preview**

Keep deletion transactional and bounded; record counts in the daily report.

- [ ] **Step 3: Document policy, dry-run inspection, rollback, and schedule disablement**

Document all rollout stages and that `evaluation_only` remains the public status.

- [ ] **Step 4: Run complete local verification**

Run: `npm test`

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npm run build`

Run: `python3 -m unittest discover -s scripts/tests -p 'test_*.py'`

- [ ] **Step 5: Commit, review, promote, and deploy**

```bash
git add src/lib/catalogue/evidenceRetention* docs/operations/runtime-catalogue.md README.md
git commit -m "docs: operate autonomous catalogue publication"
```

After fresh review, push `main`, deploy the application server, manually dispatch one `mode=report` workflow, and verify its proposal/audit/artifacts and unchanged live revision. Leave the automatic stage machine to require three distinct scheduled report-only evaluations before its first cap-5 release.

## Self-review

- Spec coverage: durable evidence, all-source deterministic policy, daily release, caps, OIDC separation, atomicity, audit, rollback, hard-failure confirmation, retention, rollout, and live proof each have an owning task.
- Step scan: each task has one RED/GREEN boundary and one independently reviewable deliverable.
- Type consistency: Task 1 `QualificationSet` feeds Task 2; Task 2 decisions feed Task 3; Task 3 proposal/rollback interfaces feed Task 4; Task 1 evidence feeds Task 5 health transitions.
- Review Focus: mismatched evidence, deceptive reading pages, races, selective rollback, and transient failures have explicit tests.
- Proportion: implementation bodies remain with implementers; the plan fixes interfaces, security boundaries, values, tests, and commands.

