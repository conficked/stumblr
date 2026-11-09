# Durable ops DB + discovery batches + freshness sampler

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace VM JSON-only fake-production durability with a local SQLite ops database (D1-compatible SQL), wire community submissions + discovery review/runstate into it, then ship bounded resumable Python discovery batches and production-fresh sampler randomness — without public deploy/GitHub/spend.

**Architecture:** Node `node:sqlite` (Node 22) + Python `sqlite3` share one file DB and migration SQL. App suggestion intake writes pending rows only (no public approval API). Discovery CLI uses leases/checkpoints in the same DB and never auto-promotes into live catalogue rotation. Sampler gains per-session entropy + diversity penalties; fixed seeds only in tests.

**Tech Stack:** Next.js Route Handlers, Vitest, Python 3 stdlib sqlite3, POSIX-friendly SQL (SQLite / future Cloudflare D1 dialect).

## Global Constraints

- Private Origin SoT; ordinary commit/push only; no GitHub publish/mirror
- No DNS/deploy/paid provisioning; if hosted DB needed, finish local proof and return smallest decision
- No public suggestion approval endpoint
- Harvested URLs never auto-enter live rotation
- No infinite unattended crawl; bounded batches only
- Preserve iframe host, charcoal symbol toolbar, Stumbl label, brand assets, mobile dock
- HackerTube/HackerBooks stay desired+frameblocked; no bypass/substitution claims
- Distinguish local DB proof from hosted shared durability

## File map

| Path | Responsibility |
| --- | --- |
| `db/migrations/001_init.sql` | Schema: suggestions, candidates, runs, events, review_history, meta |
| `src/lib/db/paths.ts` | `STUMBLR_DB_PATH` resolution |
| `src/lib/db/migrate.ts` | Apply migrations idempotently |
| `src/lib/db/client.ts` | Open `node:sqlite` DatabaseSync with busy_timeout |
| `src/lib/db/suggestionsRepo.ts` | Insert/list suggestions with UNIQUE race handling |
| `src/lib/db/discoveryRepo.ts` | Candidates, runs, leases, events |
| `src/lib/submissions/storage.ts` | Delegate to DB (JSON fallback removed for primary path) |
| `scripts/stumblr_db.py` | Python open/migrate/upsert/lease helpers |
| `scripts/discover_catalogue_candidates.py` | Family-aware bounded batch + DB ingest + redirect-hop SSRF |
| `.github/workflows/discovery-batch.yml` | Prepared schedule/workflow_dispatch; documented disabled until GitHub release |
| `src/lib/sampler/createSampler.ts` | Session RNG + diversity; test seed injection |
| `docs/launch/...` | Checklist updates for hosted DB proof vs local |

---

### Task 1: SQLite schema + JS migrate/open + suggestion repo tests

**Files:**
- Create: `db/migrations/001_init.sql`
- Create: `src/lib/db/paths.ts`, `migrate.ts`, `client.ts`, `suggestionsRepo.ts`
- Create: `src/lib/db/suggestionsRepo.test.ts`
- Modify: `src/lib/submissions/storage.ts`, `service.ts`, `service.test.ts`
- Create: `scripts/stumblr_db.py`
- Create: `src/lib/db/discoveryRepo.ts` + `discoveryRepo.test.ts` (restart + overlap)

**Interfaces:**
- Produces: `openDb(path?: string)`, `migrate(db)`, `insertSuggestion(row)`, `getSuggestionByCanonicalUrl(url)`, `upsertCandidate(row)`, `tryAcquireRunLease(runId, owner, ttlSec)`, `checkpointRun(runId, checkpoint)`

- [ ] **Step 1: Write failing repo tests** (persistence across reopen; unique canonical race)

- [ ] **Step 2: Implement migration SQL + JS client + wire submissions**

- [ ] **Step 3: Python `stumblr_db.py` same migrations**

- [ ] **Step 4: Run `npm test` for db + submissions; fix**

- [ ] **Step 5: Commit**

---

### Task 2: Bounded discovery batch → DB (review-only) + redirect-hop safety + leases

**Files:**
- Modify: `scripts/discover_catalogue_candidates.py`
- Create: `scripts/tests/test_stumblr_db_discovery.py` (or pytest-free unittest)
- Create: `.github/workflows/discovery-batch.yml` (prepared, not connected as production)
- Modify: research/launch docs noting local proof

- [ ] **Step 1: Add source_family config for measured sources; budgets unchanged**

- [ ] **Step 2: Per-redirect-hop IP checks; durable checkpoint/lease; write candidates status≠approved-for-rotation**

- [ ] **Step 3: Idempotent replay test + overlapping lease test**

- [ ] **Step 4: Commit**

---

### Task 3: Production-fresh sampler

**Files:**
- Modify: `src/lib/sampler/createSampler.ts`, `createSampler.test.ts`, `ExplorerApp.tsx`
- Keep fixed seed only via explicit test/`createSampler({ rng })` injection

- [ ] **Step 1: Failing tests for divergence, no short repeats, domain spacing, type/source spacing**

- [ ] **Step 2: Implement weighted random among eligible + penalties; session seed in client state**

- [ ] **Step 3: Commit**

---

### Task 4: Launch checklist + evidence + report

- [ ] Update launch readiness: local SQLite proof vs hosted D1/disk decision
- [ ] Push Origin; report exact complete/remaining
