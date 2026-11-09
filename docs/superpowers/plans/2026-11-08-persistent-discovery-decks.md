# Persistent Discovery Decks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Stumblr show every eligible destination in a browsing scope before repeating, while remaining usable after small pools are exhausted.

**Architecture:** Replace implicit history-modulo cycling with a versioned, device-local deck per normalized preference scope. The sampler reconciles each deck with catalogue changes, draws unseen IDs with existing diversity weighting, reshuffles on exhaustion, and keeps History/Saves separate from deck progress.

**Tech Stack:** TypeScript, React 19, Next.js 16, localStorage, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-autonomous-publishing-deck-design.md`

## Global Constraints

- No accounts or cross-device synchronization.
- Never repeat within one scope cycle.
- New eligible catalogue IDs enter the remaining current cycle before recycled content.
- Selected topics never broaden silently.
- Small pools reshuffle indefinitely with bounded cross-cycle separation.
- Reset clears history and decks but preserves preferences, Saves, exclusions, and reports.
- Deleting one visible History item does not change deck progress.
- Corrupt or unavailable localStorage falls back to an in-memory session deck.

## Review Focus

- A catalogue addition during an active cycle must not reset progress or strand the new ID behind recycled entries; Task 2 tests reconciliation.
- Switching topics/modes and returning must resume the correct independent scope; Task 2 tests normalized scope keys and LRU retention.
- A one-entry or two-entry pool cannot satisfy a ten-item boundary rule and must still work forever; Task 2 tests proportional separation.
- Migrating a long version-1 history must not overflow localStorage or cause an immediate repeat; Task 1 tests bounded migration.
- Reset and single-history deletion must have different effects on deck state; Task 3 tests both UI paths.

---

### Task 1: Version-2 local state and migration

**Files:**
- Modify: `src/lib/storage/schema.ts`
- Modify: `src/lib/storage/localStore.ts`
- Modify: `src/lib/storage/localStore.test.ts`

**Interfaces:**
- Produces `ClientStateV2` with `version: 2`, existing user data, bounded visible history, and `discoveryDecks: DiscoveryDeckStore`.
- Produces `migrateClientState(input: unknown): ClientStateV2`.
- Produces `resetDiscoveryState(state: ClientStateV2): ClientStateV2` preserving preferences, Saves, exclusions, and reports.

- [ ] **Step 1: Write failing migration tests**

Cover empty/corrupt input, complete version-1 migration, bounded long history, existing preferences/Saves/reports/exclusions, invalid deck removal, unavailable storage, and the Review Focus immediate-repeat seed from recent history.

- [ ] **Step 2: Write failing reset tests**

Assert history/decks clear while preferences, Saves, exclusions, reports, and sampler entropy remain.

- [ ] **Step 3: Run tests to verify RED**

Run: `npx vitest run src/lib/storage/localStore.test.ts`

- [ ] **Step 4: Implement schema, migration, bounds, and fallback**

Bounds: visible history 1,000 snapshots; at most 20 scope decks; deck state stores IDs only. Version-1 reads migrate once and write version 2 on the next state change.

- [ ] **Step 5: Run GREEN verification and commit**

Run: command from Step 3; expected PASS.

```bash
git add src/lib/storage/schema.ts src/lib/storage/localStore.ts src/lib/storage/localStore.test.ts
git commit -m "feat: migrate local discovery state to version two"
```

### Task 2: Scope-aware persistent deck engine

**Files:**
- Create: `src/lib/sampler/discoveryDeck.ts`
- Create: `src/lib/sampler/discoveryDeck.test.ts`
- Modify: `src/lib/sampler/createSampler.ts`
- Modify: `src/lib/sampler/createSampler.test.ts`

**Interfaces:**
- Produces `normalizeDeckScope(options: DeckScopeOptions): string` from mode, sorted topics, and evaluation preference.
- Produces `reconcileDeck(deck, eligibleEntries, recentHistory, rng): DiscoveryDeck`.
- Produces `drawFromDeck(deck, entriesById, samplerOptions, rng): DeckDrawResult`.
- `DeckDrawResult` contains selected entry, updated deck, `newCycle`, and `cycleNumber`.

- [ ] **Step 1: Write failing scope and reconciliation tests**

Assert normalized topic ordering, independent scopes, LRU timestamps, removals/exclusions, active-cycle preservation, new-ID injection before recycling, and Review Focus catalogue-addition behavior.

- [ ] **Step 2: Write failing cycle tests**

Assert every eligible ID appears exactly once before repeat; last/first boundary separation is 10 for pools of at least 20 and `floor(pool/2)` for smaller pools; one/two-entry pools continue forever; deterministic RNG fixtures remain stable.

- [ ] **Step 3: Write failing diversity tests**

Within the remaining deck, preserve direct/adjacent/wildcard weights, avoid consecutive domains when alternatives exist, and retain structural-type/source-cluster penalties without reintroducing seen IDs.

- [ ] **Step 4: Run tests to verify RED**

Run: `npx vitest run src/lib/sampler/discoveryDeck.test.ts src/lib/sampler/createSampler.test.ts`

- [ ] **Step 5: Implement deck reconciliation and drawing**

Use Fisher-Yates with injected RNG for deck creation. Newly eligible IDs are shuffled into the first half of remaining positions, never ahead of the currently displayed entry because selection occurs only on the next Stumbl.

- [ ] **Step 6: Run GREEN verification and commit**

Run: command from Step 4; expected PASS.

```bash
git add src/lib/sampler/discoveryDeck* src/lib/sampler/createSampler*
git commit -m "feat: add persistent scope-aware discovery decks"
```

### Task 3: Explorer integration, reset semantics, and cycle notice

**Files:**
- Modify: `src/components/explorer/ExplorerApp.tsx`
- Modify: `src/components/explorer/ExplorerApp.test.tsx`
- Modify: `src/components/explorer/HistoryDrawer.tsx`
- Modify: `src/components/explorer/PreferencesDrawer.tsx`

**Interfaces:**
- Explorer reads/writes the active scope deck through Task 1 state and Task 2 engine.
- Produces UI notice `New cycle` with action `Broaden topics` only when selected-topic scope begins a later cycle.

- [ ] **Step 1: Write failing integration tests**

Assert repeated Stumbl exhausts unseen entries before a repeat, runtime additions enter the active cycle, preference changes resume their decks, exclusions disappear, and history remains bounded.

- [ ] **Step 2: Write failing history/reset tests**

Assert removing one History row leaves deck state unchanged; Reset discovery history clears all decks/history but preserves preferences, Saves, exclusions, and reports; exported state is version 2.

- [ ] **Step 3: Write failing topic-cycle UI tests**

Assert no exhausted dead end, a new selected-topic cycle starts automatically, the notice is non-blocking, and `Broaden topics` changes preferences only after explicit activation.

- [ ] **Step 4: Run tests to verify RED**

Run: `npx vitest run src/components/explorer/ExplorerApp.test.tsx src/lib/storage/localStore.test.ts src/lib/sampler/discoveryDeck.test.ts`

- [ ] **Step 5: Integrate deck state and update copy**

Keep Saves and History revisit behavior unchanged. Remove implicit history-derived sampler state only after all integration tests use the explicit deck.

- [ ] **Step 6: Run GREEN verification and commit**

Run: command from Step 4; expected PASS.

```bash
git add src/components/explorer src/lib/storage src/lib/sampler
git commit -m "feat: persist unseen-first Stumblr cycles"
```

### Task 4: Desktop/mobile cycle proof and production rollout

**Files:**
- Create: `tests/e2e/discovery-deck.spec.ts`
- Modify: `docs/testing/stumblr-evidence.md`
- Modify: `README.md`

**Interfaces:**
- E2E fixtures expose a small deterministic catalogue and a runtime addition endpoint/intercept for cycle testing.

- [ ] **Step 1: Write failing Playwright tests**

On desktop and mobile, exercise two complete cycles, verify no within-cycle repeats, verify boundary separation, inject a new runtime entry mid-cycle, verify it appears before recycled entries, reload, and verify deck persistence.

- [ ] **Step 2: Run tests to verify RED**

Run: `npx playwright test tests/e2e/discovery-deck.spec.ts`

- [ ] **Step 3: Add only the fixture support required by the test**

Do not add production debug routes or expose internal deck state in the UI.

- [ ] **Step 4: Run GREEN and full verification**

Run: `npx playwright test tests/e2e/discovery-deck.spec.ts`

Run: `npm test`

Run: `npm run lint`

Run: `npm run typecheck`

Run: `npm run build`

- [ ] **Step 5: Document and commit**

```bash
git add tests/e2e/discovery-deck.spec.ts docs/testing/stumblr-evidence.md README.md
git commit -m "test: prove persistent discovery cycles"
```

After fresh review, push `main`, deploy the application server, and run the production desktop/mobile proof against the live runtime catalogue. Confirm version-1 local data migrates in a controlled browser fixture and a newly published runtime ID is treated as unseen.

## Self-review

- Spec coverage: device-local state, migration, scopes, unseen-first behavior, catalogue changes, boundary separation, topic behavior, reset, fallback, and production proof each have an owning task.
- Step scan: state migration, pure deck engine, React integration, and E2E proof are independently reviewable boundaries.
- Type consistency: Task 1 owns `DiscoveryDeckStore`; Task 2 consumes/produces its individual decks; Task 3 persists those exact results; Task 4 tests the public behavior only.
- Review Focus: catalogue mutation, scope switching, tiny pools, migration bounds, and reset/delete semantics each have explicit tests.
- Proportion: the plan fixes values and interfaces without prescribing component bodies.
