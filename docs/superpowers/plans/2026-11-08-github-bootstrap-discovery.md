# GitHub Demo Discovery and Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reviewed GitHub live-demo discovery, run a high-volume one-time catalogue bootstrap, and maintain new supply hourly without adding paid infrastructure or weakening publication safeguards.

**Architecture:** Extend the bounded Python collector with a GitHub REST provider that emits repository-linked demo candidates into the existing SQLite review queue. Keep collection and publication separate: scheduled runs collect hourly, a manual bootstrap can process larger source shards, browser qualification produces evidence, and only explicitly reviewed snapshots reach the runtime catalogue.

**Tech Stack:** Python 3.12 standard library, GitHub REST API, GitHub Actions, SQLite, Node 22, Playwright, Next.js route handlers, Vitest.

**Spec:** `docs/superpowers/plans/2026-11-07-stumblr-mvp.md` (Upcoming Phase 1 and Shared collection path), with source/safety constraints from `docs/superpowers/specs/2026-11-08-vast-discovery-procurement-research.md`.

## Global Constraints

- No new paid resource, runner class, service, or stored integration secret.
- GitHub live demos are required; a repository page is not a playable iframe destination.
- A README claim, homepage field, HTTP 200, or star count is not proof that an app works.
- Preserve HTTPS-only, redirect-hop DNS/SSRF, robots, response-size, content-type, framing, origin, and timeout protections.
- Collection remains review-only; no harvested record auto-enters the live rotation.
- Keep canonical repository identity related to its demo URL and dedupe both identities.
- Record sources attempted, repositories inspected, demo URLs, distinct domains, pending, quarantined, rendered, reviewed, and published as separate counts.
- Standard GitHub-hosted Ubuntu jobs only; retain concurrency and bounded workload limits.
- Hourly schedule uses minute 17; bootstrap remains manual-only.

## Review Focus

- Repository homepages that point to docs, donation pages, stores, or another repository must not be counted as working demos; Task 1 adds classification tests.
- Multiple repositories pointing to one demo domain must not inflate distinct-app growth; Task 2 adds identity/dedupe tests.
- GitHub API rate exhaustion, incomplete search results, or malformed JSON must fail closed with telemetry and leave the last queue intact; Task 1 adds provider failure tests.
- Bootstrap chunks replayed after a retry must remain idempotent and must not exceed the 24-row ingest boundary; Task 3 adds chunk/replay tests.
- Browser `load` without meaningful rendered content must not become review evidence; Task 4 adds blank/error/login-shell qualification fixtures.

---

### Task 1: Bounded GitHub repository provider

**Files:**
- Create: `scripts/github_demo_provider.py`
- Create: `scripts/tests/test_github_demo_provider.py`
- Modify: `scripts/discover_catalogue_candidates.py`

**Interfaces:**
- Produces: `collect_github_demo_leads(token: str, queries: list[str], max_repositories: int) -> tuple[list[dict], dict]`
- Each lead contains `repository_id`, `repository_full_name`, `repository_url`, `demo_url`, `description`, `topics`, `stars`, `pushed_at`, `archived`, and `source_query`.
- Collector consumes leads as source family `github-live-demo` and subjects `demo_url` to the existing guarded screening path.

- [ ] **Step 1: Write failing provider tests**

Test authenticated pagination bounds, repository ID/full-name normalization, homepage rejection for GitHub/store/donation/docs-only URLs, incomplete results, 403/429 handling, and missing homepages.

- [ ] **Step 2: Run tests to verify RED**

Run: `python3 -m unittest scripts.tests.test_github_demo_provider -v`

Expected: FAIL because `github_demo_provider` does not exist.

- [ ] **Step 3: Implement the provider**

Use at most four configured repository-search queries, at most 25 results per query, explicit GitHub API version/accept headers, the workflow token from the environment, and the existing 8-second request timeout. Never log the token.

- [ ] **Step 4: Integrate provider leads with guarded screening**

Preserve repository metadata in candidate provenance and count repository leads separately from demo domains.

- [ ] **Step 5: Run GREEN verification**

Run: `python3 -m unittest scripts.tests.test_github_demo_provider scripts.tests.test_stumblr_db_discovery -v`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/github_demo_provider.py scripts/discover_catalogue_candidates.py scripts/tests
git commit -m "feat: collect bounded GitHub live-demo candidates"
```

### Task 2: Repository/demo identity and review evidence

**Files:**
- Modify: `db/migrations/001_init.sql` or add the next numbered migration
- Modify: `scripts/stumblr_db.py`
- Modify: `scripts/catalogue_review_queue.py`
- Modify: `src/lib/catalogue/candidateQueue.ts`
- Modify: `src/lib/catalogue/candidateQueue.test.ts`
- Modify: `scripts/tests/test_stumblr_db_discovery.py`

**Interfaces:**
- Produces optional candidate provenance fields `repository_id`, `repository_full_name`, `repository_url`, `demo_url`, and `github_evidence`.
- Produces `occupied_demo_domains` and `known_repository_ids` for cross-run deduplication; quarantined identities do not permanently block a later corrected demo URL.

- [ ] **Step 1: Write failing JS and Python identity tests**

Assert replay by repository ID is idempotent, two repositories sharing a demo domain produce one reviewable destination, and a quarantined feed/docs URL does not suppress a later valid homepage.

- [ ] **Step 2: Run tests to verify RED**

Run: `python3 -m unittest scripts.tests.test_stumblr_db_discovery -v`

Run: `npx vitest run src/lib/catalogue/candidateQueue.test.ts --environment node`

- [ ] **Step 3: Add the migration and persistence fields**

Keep raw GitHub metadata in `provenance_json`; add indexed canonical repository identity only where needed for dedupe.

- [ ] **Step 4: Run GREEN verification**

Run the two commands from Step 2; both must pass.

- [ ] **Step 5: Commit**

```bash
git add db scripts src/lib/catalogue
git commit -m "feat: preserve GitHub demo identity through review"
```

### Task 3: Hourly maintenance and manual bootstrap orchestration

**Files:**
- Modify: `.github/workflows/discovery-manual-review.yml`
- Create: `scripts/chunk_candidate_batch.py`
- Create: `scripts/tests/test_chunk_candidate_batch.py`

**Interfaces:**
- Workflow input: `mode` with values `maintenance` (default) or `bootstrap` (manual dispatch only).
- Maintenance: hourly at cron `17 * * * *`, 15-minute timeout, current 24-row import limit.
- Bootstrap: manual-only, source-family matrix shards, maximum 220 screened URLs per shard, chunks imports into lists of at most 24.

- [ ] **Step 1: Write failing chunk tests**

Assert stable 24-row chunks, empty input behavior, idempotent replay keys, and rejection of more than the configured bootstrap ceiling.

- [ ] **Step 2: Run tests to verify RED**

Run: `python3 -m unittest scripts.tests.test_chunk_candidate_batch -v`

- [ ] **Step 3: Implement chunking and workflow modes**

Pass `${{ github.token }}` to the GitHub provider only. Keep OIDC for the Stumblr queue, `persist-credentials: false`, the existing concurrency group, and three-day private artifacts.

- [ ] **Step 4: Validate workflow and tests**

Run: `python3 -m unittest discover -s scripts/tests -p 'test_*.py'`

Run: `ruby -e "require 'yaml'; YAML.load_file('.github/workflows/discovery-manual-review.yml')"`

Expected: all tests pass and YAML parses.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/discovery-manual-review.yml scripts
git commit -m "feat: add hourly discovery and bounded bootstrap mode"
```

### Task 4: Same-sandbox browser qualification artifacts

**Files:**
- Create: `scripts/qualify_review_candidates.mjs`
- Create: `tests/e2e/review-candidate-fixtures.spec.ts`
- Modify: `.github/workflows/discovery-manual-review.yml`

**Interfaces:**
- Consumes a candidate artifact and maximum count.
- Produces JSON rows with `canonical_url`, `render_result`, `meaningful_text_length`, `interaction_evidence`, `observed_at`, `device`, and console/frame failure reasons.
- Qualification never changes review status or publishes.

- [ ] **Step 1: Write failing Playwright fixtures**

Cover meaningful render, blank page, login-only shell, explicit frame denial, timeout, and an interactive control that changes visible state.

- [ ] **Step 2: Run tests to verify RED**

Run: `npx playwright test tests/e2e/review-candidate-fixtures.spec.ts --project=chromium`

- [ ] **Step 3: Implement the bounded qualifier**

Reuse the exact `FRAME_SANDBOX` and `FRAME_PERMISSIONS_POLICY` values. Do not bypass XFO/CSP or proxy destination content.

- [ ] **Step 4: Run GREEN verification**

Run the command from Step 2; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/qualify_review_candidates.mjs tests/e2e .github/workflows/discovery-manual-review.yml
git commit -m "test: qualify review candidates in the Stumblr sandbox"
```

### Task 5: Execute bootstrap, review, and publish verified growth

**Files:**
- Modify: `docs/catalogue/reviewed-runtime.json`

**Interfaces:**
- Consumes private bootstrap artifacts and browser evidence.
- Produces a complete reviewed runtime snapshot; no append semantics.

- [ ] **Step 1: Dispatch bounded bootstrap shards**

Run the manual workflow in `bootstrap` mode and retain run IDs and family-level yields.

- [ ] **Step 2: Review distinct rendered destinations**

Reject clones, stores, docs-only pages, unsafe/blocked pages, and demos without meaningful functionality. Preserve repository/demo attribution.

- [ ] **Step 3: Validate the reviewed manifest**

Run the runtime Zod schema against the JSON and assert unique IDs, URLs, and domains.

- [ ] **Step 4: Commit and run `catalogue-publish.yml`**

The publication run must report the committed revision and imported count.

- [ ] **Step 5: Verify production**

Confirm `/api/catalogue` revision/counts and exercise desktop/mobile Stumbl paths through newly added GitHub demos.

## Self-review

- Spec coverage: GitHub demos, source attribution, bounded collection, dedupe, browser evidence, hourly maintenance, bootstrap, review-only publication, and actual live-growth verification are assigned.
- Step scan: each task owns one independently testable boundary.
- Type consistency: repository identity fields remain optional provenance through collection and review; `demo_url` is the only playable URL.
- Review focus: each listed failure mode has a corresponding task test.
- Proportion: repository outbound cards, research ingestion, content-type controls, and per-destination CSP are intentionally excluded into later plans.
