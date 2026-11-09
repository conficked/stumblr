# Stumblr MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private-draft Stumblr MVP with a polished discovery loop, deterministic curated sampling, secure iframe hosting, local persistence, and honest compatibility/reporting states.

**Architecture:** A Next.js App Router client app owns the exploration state machine while pure TypeScript modules handle catalogue typing, deterministic selection, and storage safety. UI controls and drawers interact through explicit action handlers; frame hosting is isolated behind a dedicated component with race-safe transition logic. Verification combines deterministic unit tests, component tests, and Playwright smoke flows with desktop/mobile emulation and fixture pages.

**Tech Stack:** Next.js, TypeScript, Tailwind CSS, shadcn/ui, Vitest, React Testing Library, Playwright.

## Global Constraints
- Guest-first flow; no signup gate.
- Persistent in-app controls with no browser-back/tab-pile core loop.
- Distinct semantics: `Stumbl` (neutral next destination), `Not for me` (negative), `Save` (bookmark only).
- Deterministic no-repeat sampling until pool exhaustion with domain diversity.
- Curated embeddable pool with honest status labels; no fake approval claims.
- Respect framing policy boundaries; no XFO/CSP bypassing, no arbitrary URL fetcher.
- localStorage is best-effort and resilient to unavailable/corrupt/versioned data.
- Explicit loading/timeout/error/blocked/exhaustion states and race-safe transitions.
- No backend analytics/reporting illusion; local-only labels where applicable.

---

### Task 1: Scaffold app foundation and design system

**Files:**
- Create: `package.json` and Next.js scaffold files
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`
- Create: `tailwind.config.ts`, `postcss.config.js`, `tsconfig.json`
- Create/Modify: shadcn component files under `src/components/ui/`
- Test: `src/app/page.test.tsx`

**Interfaces:**
- Consumes: none
- Produces:
  - `AppShell` layout with regions: `TopControls`, `FrameHost`, `DrawerRail`, `BottomDock`
  - Theme tokens for ink/parchment/teal/rust palette via CSS variables

- [ ] **Step 1: Write the failing test**
```tsx
import { render, screen } from "@testing-library/react";
import HomePage from "./page";

test("renders core exploration landmarks", () => {
  render(<HomePage />);
  expect(screen.getByRole("main", { name: /stumblr explorer/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run test -- src/app/page.test.tsx`
Expected: FAIL because Next app/components are not scaffolded yet.

- [ ] **Step 3: Write minimal implementation**
```tsx
export default function HomePage() {
  return (
    <main aria-label="Stumblr Explorer">
      <button type="button">Stumbl</button>
    </main>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm run test -- src/app/page.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add .
git commit -m "feat: scaffold next app with stumblr shell"
```

### Task 2: Implement typed catalogue and policy metadata

**Files:**
- Create: `src/lib/catalogue/types.ts`
- Create: `src/lib/catalogue/entries.ts`
- Create: `src/lib/catalogue/index.ts`
- Test: `src/lib/catalogue/entries.test.ts`

**Interfaces:**
- Consumes: none
- Produces:
  - `type CatalogueStatus = "launch_approved" | "evaluation_only" | "blocked" | "unverified"`
  - `type CatalogueEntry` with canonical URL, domain, topics, embed evidence, policy basis
  - `getCatalogue({ includeEvaluation }: { includeEvaluation: boolean }): CatalogueEntry[]`

- [ ] **Step 1: Write the failing test**
```ts
import { getCatalogue } from "./index";

test("default catalogue excludes evaluation-only entries", () => {
  const entries = getCatalogue({ includeEvaluation: false });
  expect(entries.every((entry) => entry.status === "launch_approved")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run test -- src/lib/catalogue/entries.test.ts`
Expected: FAIL because catalogue module does not exist yet.

- [ ] **Step 3: Write minimal implementation**
```ts
export function getCatalogue({ includeEvaluation }: { includeEvaluation: boolean }) {
  const all = [/* typed entries */];
  return includeEvaluation ? all : all.filter((entry) => entry.status === "launch_approved");
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm run test -- src/lib/catalogue/entries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/catalogue
git commit -m "feat: add typed curated catalogue with review metadata"
```

### Task 3: Build deterministic sampler with no-repeat and domain diversity

**Files:**
- Create: `src/lib/sampler/types.ts`
- Create: `src/lib/sampler/createSampler.ts`
- Test: `src/lib/sampler/createSampler.test.ts`

**Interfaces:**
- Consumes: `CatalogueEntry`
- Produces:
  - `createSampler(seed: number, entries: CatalogueEntry[], opts: SamplerOptions): Sampler`
  - `Sampler.next(state: SamplerState): SamplerPickResult`
  - `SamplerState` includes seen IDs, seen domains, and exhausted flag

- [ ] **Step 1: Write the failing test**
```ts
test("sampler does not repeat entries before exhaustion", () => {
  const sampler = createSampler(42, entries, { mode: "wildcard", topics: [] });
  const seen = new Set<string>();
  for (let i = 0; i < entries.length; i += 1) {
    const result = sampler.next();
    expect(seen.has(result.entry.id)).toBe(false);
    seen.add(result.entry.id);
  }
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run test -- src/lib/sampler/createSampler.test.ts`
Expected: FAIL because sampler module does not exist yet.

- [ ] **Step 3: Write minimal implementation**
```ts
export function createSampler(seed: number, entries: CatalogueEntry[], opts: SamplerOptions): Sampler {
  // deterministic PRNG + round-robin with domain diversity guard
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm run test -- src/lib/sampler/createSampler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/sampler
git commit -m "feat: add deterministic no-repeat sampler"
```

### Task 4: Implement resilient local storage and export/reset flows

**Files:**
- Create: `src/lib/storage/schema.ts`
- Create: `src/lib/storage/localStore.ts`
- Test: `src/lib/storage/localStore.test.ts`

**Interfaces:**
- Consumes: browser `localStorage` (or unavailable fallback)
- Produces:
  - `loadClientState(): ClientState`
  - `saveClientState(patch: Partial<ClientState>): void`
  - `exportClientState(): string`
  - `resetClientState(): void`

- [ ] **Step 1: Write the failing test**
```ts
test("loadClientState recovers from corrupt json", () => {
  window.localStorage.setItem("stumblr:v1", "{broken");
  expect(loadClientState().history).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run test -- src/lib/storage/localStore.test.ts`
Expected: FAIL because storage module does not exist yet.

- [ ] **Step 3: Write minimal implementation**
```ts
export function loadClientState(): ClientState {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? decodeState(raw) : DEFAULT_STATE;
  } catch {
    return DEFAULT_STATE;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm run test -- src/lib/storage/localStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/lib/storage
git commit -m "feat: add resilient local client storage with export reset"
```

### Task 5: Build frame host state machine and race-safe transitions

**Files:**
- Create: `src/components/frame-host/FrameHost.tsx`
- Create: `src/components/frame-host/useFrameCycle.ts`
- Create: `src/components/frame-host/framePolicies.ts`
- Test: `src/components/frame-host/useFrameCycle.test.ts`

**Interfaces:**
- Consumes: sampler picks and user actions
- Produces:
  - `FramePhase = "idle" | "loading" | "ready" | "timeout" | "blocked" | "error" | "exhausted"`
  - `startLoad(entry: CatalogueEntry): LoadToken`
  - `resolveLoad(token: LoadToken, outcome: LoadOutcome): void`
  - stale token outcomes are ignored

- [ ] **Step 1: Write the failing test**
```ts
test("ignores stale load completion when newer Next request started", () => {
  const cycle = createFrameCycle();
  const first = cycle.startLoad(entryA);
  const second = cycle.startLoad(entryB);
  cycle.resolveLoad(first, { kind: "ready" });
  expect(cycle.getState().activeEntry?.id).toBe(entryB.id);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run test -- src/components/frame-host/useFrameCycle.test.ts`
Expected: FAIL because frame cycle module does not exist yet.

- [ ] **Step 3: Write minimal implementation**
```ts
if (token !== state.activeToken) return state;
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm run test -- src/components/frame-host/useFrameCycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/frame-host
git commit -m "feat: implement secure frame host lifecycle and race handling"
```

### Task 6: Ship exploration UI controls, drawers, and mobile dock

**Files:**
- Create: `src/components/explorer/ExplorerApp.tsx`
- Create: `src/components/explorer/TopControls.tsx`
- Create: `src/components/explorer/BottomDock.tsx`
- Create: `src/components/explorer/HistoryDrawer.tsx`
- Create: `src/components/explorer/SavesDrawer.tsx`
- Create: `src/components/explorer/ReportDrawer.tsx`
- Modify: `src/app/page.tsx`
- Test: `src/components/explorer/ExplorerApp.test.tsx`

**Interfaces:**
- Consumes: catalogue, sampler, frame cycle, local store
- Produces:
  - Buttons: `Stumbl`, `Not for me`, `Save`, `History`, `Saves`, `Report`
  - Drawers with revisit/remove/export/reset actions
  - Accessibility labels and keyboard navigation path

- [ ] **Step 1: Write the failing test**
```tsx
test("Save stores entry without marking notForMe signal", async () => {
  render(<ExplorerApp />);
  await user.click(screen.getByRole("button", { name: /next/i }));
  await user.click(screen.getByRole("button", { name: /^save$/i }));
  expect(screen.getByText(/saved locally/i)).toBeInTheDocument();
  expect(screen.queryByText(/not for me recorded/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run test -- src/components/explorer/ExplorerApp.test.tsx`
Expected: FAIL because explorer controls and storage wiring are missing.

- [ ] **Step 3: Write minimal implementation**
```tsx
<button aria-label="Save current site" onClick={handleSave}>Save</button>
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm run test -- src/components/explorer/ExplorerApp.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add src/components/explorer src/app/page.tsx
git commit -m "feat: add explorer controls drawers and mobile dock"
```

### Task 7: Add fixture pages, browser smoke tests, and external evidence logging

**Files:**
- Create: `src/app/fixtures/[slug]/page.tsx`
- Create: `playwright.config.ts`
- Create: `tests/e2e/explorer.spec.ts`
- Create: `scripts/check-catalogue-health.ts`
- Create/Modify: `docs/testing/stumblr-evidence.md`

**Interfaces:**
- Consumes: running app and catalogue URLs
- Produces:
  - deterministic fixture cases for loading/timeout/blocked/error states
  - desktop + mobile smoke tests for core loop
  - script output summarizing candidate health checks

- [ ] **Step 1: Write the failing test**
```ts
test("mobile dock remains reachable during next spam", async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 985 });
  await page.goto("/");
  await page.getByRole("button", { name: "Stumbl" }).click({ clickCount: 3 });
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npx playwright test tests/e2e/explorer.spec.ts --project=chromium`
Expected: FAIL until fixture routes and dock behavior exist.

- [ ] **Step 3: Write minimal implementation**
```ts
test.use({ viewport: { width: 400, height: 985 } });
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npx playwright test tests/e2e/explorer.spec.ts --project=chromium`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add tests/e2e src/app/fixtures scripts docs/testing/stumblr-evidence.md
git commit -m "test: add fixture-driven smoke tests and catalogue health evidence"
```

### Task 8: Harden security headers, docs, and final verification bundle

**Files:**
- Modify: `next.config.ts`
- Modify: `src/middleware.ts` (if used for headers)
- Modify: `README.md`
- Modify: `docs/testing/stumblr-evidence.md`

**Interfaces:**
- Consumes: frame allowlist from catalogue domains
- Produces:
  - app-level CSP and permissions policy headers
  - clear privacy/disclaimer copy in UI/docs
  - final command evidence for lint/typecheck/unit/build/e2e

- [ ] **Step 1: Write the failing test**
```ts
test("security headers include frame-src allowlist and restrictive permissions policy", async () => {
  const headers = buildSecurityHeaders(["https://example.org"]);
  expect(headers["Content-Security-Policy"]).toContain("frame-src 'self' https://example.org");
  expect(headers["Permissions-Policy"]).toContain("camera=()");
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `npm run test -- src/lib/security/headers.test.ts`
Expected: FAIL because header helper does not exist yet.

- [ ] **Step 3: Write minimal implementation**
```ts
Permissions-Policy: "camera=(), microphone=(), geolocation=()"
```

- [ ] **Step 4: Run test to verify it passes**
Run: `npm run test -- src/lib/security/headers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add next.config.ts README.md docs/testing/stumblr-evidence.md src/lib/security
git commit -m "chore: apply security headers and finalize MVP verification docs"
```

## Plan self-review
- Spec coverage check: all required areas are mapped (catalogue, sampler, persistent controls, local state, race handling, security, tests, evidence).
- Placeholder scan: no TODO/TBD placeholders in task steps.
- Type consistency: shared interfaces are named consistently across tasks (`CatalogueEntry`, `Sampler`, `ClientState`, `FramePhase`).

## 2026-11-08 redesign implementation addendum

### Goal delta
Revamp the visual system and layout posture to a compact StumbleUpon-inspired utility experience (without copying assets/branding/layout), while preserving all behavior/security/privacy functionality.

### Hallmark-informed acceptance checks
- Remove large dashboard-card framing around controls; destination viewport must visually dominate.
- Replace decorative thematic styling with compact utility chrome and clear hierarchy (`Stumbl` strongest, others understated).
- Ensure mobile control surface is compact, safe-area aware, non-duplicative, and accessible.
- Eliminate AI-tell patterns called out by Hallmark guidance (eyebrow-like labels, template punctuation/chrome excess).
- Keep honest readiness/reporting language: no implication that iframe `onLoad` proves full destination success.

### Catalogue qualification correction
- Re-check current launch-only entries for documented permission/terms + render evidence.
- If permission/terms evidence is not established, downgrade to `evaluation_only`.
- Default to private evaluation posture in UI when no launch-approved pool exists.

## 2026-11-08 catalogue milestone execution addendum

### Scope for this iteration
1. Ship Python discovery/screening CLI with bounded network/time behavior and SSRF-safe URL validation.
2. Generate evidence artifacts for discovered/screened/selected/rejected candidates.
3. Expand private evaluation catalogue with broader topic/domain variety from screened results.
4. Run production-frame browser verification with meaningful interactions and geometry assertions.
5. Add/complete missing mobile fixture flows currently skipped where feasible.

### Non-goals for this iteration
- No publisher outreach, legal clearance, or launch approval automation.
- No backend moderation/admin service.
- No public deployment changes.

### Acceptance checks for this iteration
- Discovery tool reproducible from checked-in command and sources.
- Separate counts reported for discovered, screened, editorially selected, technically verified, launch-qualified.
- Production frame geometry guard (`iframe.height / viewport.height >= 0.65`) remains enforced.
- Consecutive discovery soak executed with honest unique/pass/fail reporting and no fabricated pass.

## 2026-11-08 category + submission execution addendum

### Scope for this iteration
1. Add compact persistent category controls in top chrome plus mobile-accessible path.
2. Implement VM-durable pending submission intake endpoint with validation/dedupe/rate-limit.
3. Add tests for category persistence/filtering/exhaustion and submission valid/invalid/duplicate/abuse paths.
4. Expand private evaluation catalogue and reconcile discovery stage counts in evidence docs.

### Explicit non-goals
- No public moderation/admin queue UI.
- No immediate auto-publication of suggested URLs.
- No claim of globally durable shared backend without external infra.


## 2026-11-08 Useless Web / Bored Button + launch-prep addendum
1. Extend discovery pipeline with Useless Web + Bored Button leads, source yields, and catalogue dedupe.
2. Editorially select diverse private evaluation entries; quarantine framing denials and soak failures.
3. Qualify new candidates with bounded desktop/mobile frame+interaction proofs.
4. Keep category controls + suggestion intake; document production durability gate.
5. Add private `docs/launch/...-launch-readiness.md` without deploying or changing DNS.


## Upcoming: indie apps, overlooked repositories, and research

**Status (2026-11-08): planned, not implemented.** This addendum records the requested next discovery features, not a claim that these content types or controls are live. Continuous expansion of useful, working sites remains the first priority; this work must not displace it. Historical iteration restrictions above describe their original scope, not current deployment status. The existing runtime catalogue and pipeline are documented in [runtime catalogue operations](../../operations/runtime-catalogue.md).

### Phase 1 — working indie web apps first

- [ ] Discover quality indie web apps through GitHub project information, prioritizing working live demos over repository pages alone.
- [ ] Review actual usefulness, originality, accessible interaction, and working evidence; record source attribution and the relationship between each repository and its live demo. A README claim or HTTP200 alone is not proof of a functional app.
- [ ] Prefer a safe, reviewed live demo as the randomizer destination when it genuinely works inside the existing frame sandbox. Keep an explicit outbound option where embedding is disallowed; never bypass CSP/X-Frame-Options or loosen transport/SSRF protections.
- [ ] Measure genuinely new usable destinations and distinct apps/domains separately from discovered URLs, variants, and rejected or pending candidates.

### Phase 2 — worthwhile overlooked repositories

- [ ] Add discovery of worthwhile overlooked repositories, rather than simply reproducing stars or trending lists. Assess usefulness, originality, documentation, working demos/tests/releases when available, and evidence of functionality.
- [ ] Keep ranking signals transparent: show the observed evidence, its source/date, and uncertainty. Popularity can be context, not the quality verdict; do not fabricate ratings, test results, or a claim that a project has been independently validated.
- [ ] Treat GitHub repository pages as intentional outbound destinations with **Open on GitHub**. GitHub itself is not iframeable; do not attempt a proxy, framing bypass, or misleading embedded-success state.

### Phase 3 — research across disciplines

- [ ] Include papers from independent researchers, universities, and labs across disciplines. AI/ML is included, not the boundary of the research catalogue.
- [ ] Prefer accessible canonical landing pages; record the canonical identifier/link, source, publication or posting date, authors, and affiliations only when verified. Distinguish inaccessible full text from an accessible abstract or landing page.
- [ ] Clearly label **preprint**, **peer-reviewed**, or **unknown**, based on verified evidence rather than repository membership, institutional affiliation, or an invented quality rating.
- [ ] Provide concise plain-language summaries grounded in the source, retaining attribution and important limitations. Do not infer findings from a title or mandate paid AI; source-grounded editorial or non-AI summaries remain valid.

### Optional interests and content-type controls

- [ ] Let people include/exclude apps, repositories, and research in the random mix without losing their existing topic interests, saves, or history. Content type and topic are separate filters.
- [ ] Make the controls optional, persistent, accessible, and usable on desktop/mobile without redesigning the current toolbar or sacrificing existing controls.
- [ ] Preserve continuous Stumbl cycling and recent-repeat avoidance. Empty combinations should offer friendly filter recovery, never a pool-exhausted/reset-cycle dead end.
- [ ] Apply fair, diverse exposure across eligible sources, creators, disciplines, and content types; do not allow popularity or one source family to monopolize the mix. Record the sampling/ranking signals without inventing a quality score.

### Shared collection, review, and publication path

- [ ] Extend the existing bounded GitHub scheduled Python pipeline and durable review queue; reuse source attribution, overlap protection, and workload limits rather than adding another service or parallel scheduler. Preserve the current UI and cron while this remains a plan.
- [ ] Canonicalize and dedupe apps, repositories, demos, papers, and versions: relate app/demo URLs to repository identity; use canonical repository identity and verified paper identifiers such as DOI or repository-specific IDs where available. Group versions and aliases without treating every URL or paper revision as a new playable destination; retain meaningful version provenance.
- [ ] Apply existing public-IP/redirect/robots/input safeguards plus accessibility, embedding, and content-type checks. Quarantine failures; outbound-only records must not be counted as successfully playable iframe entries.
- [ ] Send all harvested and community-suggested records through the same untrusted pending-review boundary. Publish only reviewed outputs through the existing authenticated runtime catalogue bridge, with last-known-good fallback and no app deployment required for data-only updates.
- [ ] Keep counts separate: sources attempted/fetched, candidate URLs, distinct identities/domains, pending/quarantined records, reviewed records, iframe-playable entries, and outbound-only entries. Do not manufacture publisher permissions or promote candidates automatically.
- [ ] Test identity/version dedupe, grounded labels and summaries, review-only collection, publication/reload, outbound navigation, fair exposure, filter persistence, continuous cycling, and desktop/mobile accessibility before shipping each phase.

### Proposed sources — not selected integrations

GitHub repository metadata and project-maintained demo links are proposed app/repository inputs. Possible research inputs include Crossref, OpenAlex, arXiv, institutional repositories, and researcher/lab publication pages. These are **candidates only**, not selected providers or approved integrations. Verify each provider's API availability, terms, robots/access rules, attribution requirements, rate limits, and any cost before adopting it. No paid provider, new service, workflow change, or implementation is authorized by this documentation update alone.
