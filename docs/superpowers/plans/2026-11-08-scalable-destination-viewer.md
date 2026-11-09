# Scalable Per-Destination Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the all-domains CSP with a catalogue-ID viewer and server-selected next-destination API so Stumblr can safely support thousands of reviewed destinations.

**Architecture:** The explorer frames a same-origin `/view/[id]` wrapper instead of a publisher URL. The wrapper resolves only reviewed catalogue IDs and emits a destination-specific `frame-src`; server-side selection returns one eligible entry at a time, avoiding a full catalogue download and oversized CSP headers.

**Tech Stack:** Next.js 16 App Router, TypeScript, Node SQLite, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/plans/2026-11-07-stumblr-mvp.md` shared publication/safety requirements and `docs/superpowers/specs/2026-11-08-discovery-freshness-and-must-have-candidates.md` freshness requirements.

## Global Constraints

- Never accept an arbitrary URL from the viewer request; resolve a reviewed catalogue ID server-side.
- Blocked, quarantined, unverified, missing, or stale entries return a non-embeddable not-found state.
- The top-level app CSP permits only `'self'` frames; the viewer CSP permits only its resolved destination origin.
- Preserve exact frame sandbox, permissions policy, referrer policy, Open original link, timeout/error states, and continuous no-reset cycling.
- Preserve last-known-good runtime catalogue fallback.
- No new database/service/spend; use the existing SQLite disk.
- Guest history, saves, reports, interests, and recent-repeat state remain local.

## Review Focus

- Encoded IDs, traversal strings, URL-shaped IDs, and duplicate IDs must never select an arbitrary destination; Task 1 adds lookup tests.
- A catalogue entry quarantined after the viewer URL was issued must stop rendering on the next request; Task 1 adds stale/quarantine tests.
- Nested-frame load/error messages from another origin/window must not mark a destination ready; Task 2 adds postMessage origin/source tests.
- Concurrent Stumbl requests arriving out of order must not replace the newest destination; Task 3 retains token/race tests.
- Empty filters, exhausted recent windows, and storage failures must recover without the removed manual reset dead end; Task 4 adds API fallback tests.

---

### Task 1: Reviewed catalogue lookup by ID

**Files:**
- Create: `src/lib/catalogue/catalogueLookup.ts`
- Create: `src/lib/catalogue/catalogueLookup.test.ts`
- Modify: `src/lib/catalogue/runtimeStore.ts`

**Interfaces:**
- Produces: `getReviewedEntryById(id: string): CatalogueEntry | null`
- Lookup merges bundled and latest valid runtime entries, applies quarantine, and never accepts URL input.

- [ ] Write failing lookup tests for valid bundled/runtime IDs, malformed IDs, duplicates, quarantine, invalid latest snapshot fallback, and missing DB.
- [ ] Run `npx vitest run src/lib/catalogue/catalogueLookup.test.ts --environment node`; expect RED.
- [ ] Implement the lookup with the existing runtime schema and last-known-good traversal.
- [ ] Re-run the command; expect PASS.
- [ ] Commit as `feat: add reviewed catalogue lookup by id`.

### Task 2: Destination-specific viewer route

**Files:**
- Create: `src/app/view/[id]/page.tsx`
- Create: `src/app/view/[id]/routeHeaders.ts`
- Create: `src/app/view/[id]/routeHeaders.test.ts`
- Create: `src/components/frame-host/DestinationViewer.tsx`
- Modify: `src/lib/security/headers.ts`

**Interfaces:**
- Route consumes a catalogue ID and `getReviewedEntryById`.
- Produces a same-origin wrapper with `frame-src <destination-origin>` and `frame-ancestors 'self'`.
- Wrapper posts `{ type: "stumblr:destination-load", id }` or `{ type: "stumblr:destination-error", id }` to its same-origin parent.

- [ ] Write failing tests asserting one-origin CSP, rejection of missing/blocked IDs, exact sandbox/permissions, and strict parent message target.
- [ ] Run the route/component tests; expect RED.
- [ ] Implement route headers and wrapper without proxying destination bytes.
- [ ] Re-run tests; expect PASS.
- [ ] Commit as `feat: add per-destination frame viewer`.

### Task 3: Explorer integration and race safety

**Files:**
- Modify: `src/components/frame-host/FrameHost.tsx`
- Modify: `src/components/frame-host/useFrameCycle.ts`
- Modify: `src/components/frame-host/useFrameCycle.test.ts`
- Modify: `src/components/explorer/ExplorerApp.tsx`
- Modify: `src/components/explorer/ExplorerApp.test.tsx`

**Interfaces:**
- `FrameHost` frames `/view/${encodeURIComponent(entry.id)}`.
- Ready/error events require matching window source, same Stumblr origin, entry ID, and active load token.

- [ ] Write failing tests for viewer URLs, spoofed messages, stale messages, rapid Stumbl clicks, Open original, and mobile Save visibility.
- [ ] Run component tests; expect RED.
- [ ] Implement viewer messaging while preserving existing timeout behavior.
- [ ] Run component tests and the full 96-test split-environment suite; expect PASS.
- [ ] Commit as `feat: route explorer frames through secure viewers`.

### Task 4: Server-selected next destination

**Files:**
- Create: `src/app/api/discovery/next/route.ts`
- Create: `src/app/api/discovery/next/route.test.ts`
- Create: `src/lib/sampler/serverSampler.ts`
- Create: `src/lib/sampler/serverSampler.test.ts`
- Modify: `src/components/explorer/ExplorerApp.tsx`

**Interfaces:**
- POST body: `{ topics: Topic[], mode: SamplerMode, recentIds: string[], recentDomains: string[], recentSourceClusters: string[] }` with strict bounded arrays.
- Response: one reviewed `CatalogueEntry` or a typed empty-filter recovery result.
- Selection uses cryptographic entropy, no immediate ID/domain repeat when alternatives exist, and source-cluster diversity.

- [ ] Write failing schema, no-repeat, diversity, quarantine, oversized-input, corrupt-DB, and empty-filter tests.
- [ ] Run route/sampler tests; expect RED.
- [ ] Implement server selection over bundled plus latest valid runtime entries.
- [ ] Re-run tests; expect PASS.
- [ ] Commit as `feat: select reviewed destinations server side`.

### Task 5: Remove global domain CSP and raise catalogue scale ceiling

**Files:**
- Modify: `src/proxy.ts`
- Modify: `src/proxy.test.ts`
- Modify: `src/lib/security/headers.ts`
- Modify: `src/lib/security/headers.test.ts`
- Modify: `src/lib/catalogue/runtimeSchema.ts`
- Modify: `src/lib/catalogue/runtimeStore.test.ts`

**Interfaces:**
- Top-level response uses `frame-src 'self'` only.
- Viewer response owns its single destination origin.
- Runtime snapshot limit increases from 1,000 to 25,000 entries with payload-size and unique-key validation retained.

- [ ] Write failing tests proving top-level headers contain no publisher domains and viewer headers contain exactly one.
- [ ] Write failing 25,000-entry schema/storage tests and a payload-too-large rejection test.
- [ ] Implement limits without weakening ingest authentication or last-known-good behavior.
- [ ] Run security, proxy, schema, store, typecheck, and production build checks; expect PASS.
- [ ] Commit as `feat: scale reviewed catalogue delivery`.

### Task 6: Browser regression and production migration

**Files:**
- Modify: `tests/e2e/explorer.spec.ts`
- Modify: `tests/e2e/fixtures.spec.ts`
- Modify: `scripts/catalogue-soak.mjs`

**Interfaces:**
- Verifies desktop/mobile viewer rendering, outbound original links, continuous cycling, reload, local saves/history, and quarantine after publication.

- [ ] Add failing Playwright tests for viewer CSP, nested render, blocked entry, rapid cycling, and mobile controls.
- [ ] Implement only migration fixes exposed by those tests.
- [ ] Run unit, Python, lint, typecheck, production build, HTTP security/package, browser, and 111-selection soak checks.
- [ ] Deploy the existing Render service without new resources and verify the live revision plus runtime data-only publication.
- [ ] Commit migration evidence and report actual live counts.

## Self-review

- Spec coverage: arbitrary-URL rejection, quarantine, last-known-good, per-destination CSP, server-side random selection, continuous cycling, local state, security, scale, and production migration are assigned.
- Step scan: catalogue lookup, viewer, client integration, selection, scale ceiling, and migration are independently reviewable tasks.
- Type consistency: viewer and API use `CatalogueEntry.id`; no task accepts destination URLs from clients.
- Review focus: all five high-risk inputs have owning tests.
- Proportion: repository/research content types and outbound GitHub repository cards remain outside this infrastructure plan.
