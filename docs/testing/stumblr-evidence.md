# Stumblr MVP Evidence Log

## Scope
This document tracks private-draft verification evidence for the Stumblr MVP. It is not a launch-readiness declaration.
Latest production proof run target: `http://127.0.0.1:43124` (fresh `next start` after build).

## 2026-11-09 persistent discovery deck browser proof
- Focused command: `npx playwright test tests/e2e/discovery-deck.spec.ts`
- Result: **10 passed** — 5 cases each on `chromium-desktop` and `chromium-mobile` (Pixel 7 emulation).
- Public behavior verified: two full six-entry fixture cycles without within-cycle repeats; half-pool boundary separation; deck continuation after reload; selected three-entry science-topic cycles; history removal does not restart the deck; reset clears the visible history; controlled v1 history migrates on the first draw.
- Runtime catalogue test: `/api/catalogue` is intercepted with an empty initial catalogue, then one schema-valid evaluation entry is added after three picks. On both projects it appears before any seen entry is recycled.
- Fixture design: existing `/fixtures-lab` with six deterministic entries (three tagged science for the selected-topic cycle); no production debug routes, deck-state UI, or production code added. The root app uses only a Playwright network intercept for runtime catalogue changes.
- Mobile harness note: Next.js 16's development indicator portal overlaps the fixed mobile dock and intercepts pointer events. The E2E helper targets the visible dock button and disables pointer events on that dev-only portal before input; production UI behavior is unaffected.
- Migration harness note: Playwright init scripts also run in same-origin destination frames. The controlled v1 storage initializer is restricted to the top frame so the fixture iframe cannot overwrite the migrated state.
- Focused Vitest command: `npx vitest run src/lib/sampler/discoveryDeck.test.ts src/lib/sampler/createSampler.test.ts src/lib/storage/localStore.test.ts src/components/explorer/ExplorerApp.test.tsx` — **4 files, 35 tests passed**.
- `npm run typecheck` — passed.
- `npx eslint tests/e2e/discovery-deck.spec.ts playwright.config.ts src/lib/catalogue/fixtureEntries.ts` — passed.
- RED history: the initial exact Playwright command could not reach the app because the dev proxy correctly returned 503 in private mode. The Playwright-owned dev server now sets `STUMBLR_ACCESS_MODE=public`; subsequent RED runs exposed and corrected E2E setup issues (missing-frame wait, dev-indicator hit testing, iframe init-script overwrite). No production behavior fix was needed.
- Limitations: mobile is browser emulation, not device hardware. The runtime addition is an API response intercept, not an actual catalogue publication. Production desktop/mobile proof remains assigned to the controller; no build, deploy, or push was run here.
- Concerns observed during local dev: Next emitted existing route instant-shell warnings for `/fixtures/[slug]` and hydration warnings when client preferences differ from server defaults. The focused behavior proof is green despite those development warnings.

## 2026-11-08 catalogue milestone evidence
- Discovery pipeline command: `npm run catalogue:discover`
- Script: `scripts/discover_catalogue_candidates.py`
- Generated artifacts:
  - `docs/catalogue/discovery_sources.json`
  - `docs/catalogue/discovery_candidates.json`
  - `docs/catalogue/discovery_screened.json`
  - `docs/catalogue/discovery_selected.json`
  - `docs/catalogue/discovery_rejected.json`
  - `docs/catalogue/discovery_summary.json`
- Latest summary counts:
  - discovered: `109`
  - screened: `109`
  - editorially selected (private evaluation shortlist): `22`
  - rejected during safety/quality screening: `166`
  - distinct discovered domains: `38`
  - distinct shortlisted domains: `22`
- Launch-qualified count remains `0`; uncertain candidates remain `evaluation_only`.

## Command verification
- `npm run lint`
- `npm run typecheck`
- `npm run test`
- `npm run build`
- `npm run test:e2e`
- `npm run test:external`

Record command output snapshots in the completion report for each run.

## Fixture vs external checks
- Fixture routes (`/fixtures/*`) are deterministic local states for UI/control verification.
- External site checks are required separately and must be described with observed outcomes.
- Header checks (`scripts/check-catalogue-health.mjs`) are supportive only; they do not prove embed render success.

## External candidate observations (private draft)
### 2026-11-08 header checks (`node scripts/check-catalogue-health.mjs`)
- earth.nullschool.net: `200`, no XFO header seen, no `frame-ancestors` directive seen.
- radio.garden: `200`, no XFO header seen, no `frame-ancestors` directive seen.
- zoomquilt.org: `200`, no XFO header seen, no `frame-ancestors` directive seen.
- patatap.com: `200`, no XFO header seen, no `frame-ancestors` directive seen.
- weavesilk.com: `200`, no XFO header seen, no `frame-ancestors` directive seen.
- littlealchemy2.com: `200`, no XFO header seen, no `frame-ancestors` directive seen.

### 2026-11-08 app-sandbox external qualification smoke (strict)
- Runner: `npm run test:external` (`scripts/external-qualification-smoke.mjs`)
- Full structured results: `docs/testing/external-qualification-results.json`
- Strict acceptance pool (must pass on desktop + mobile emulation or command exits nonzero):
  - `weavesilk.com`: drag gesture + before/after visual delta
  - `www.desmos.com`: expression entry (`x^2+1`) + typed expression visible (`x2+1` normalized in frame text) + before/after visual delta
  - `stellarium-web.org`: search focus + typed `mars` verified in search input value + before/after visual delta
- Strict result from latest run:
  - desktop verified: `3/3`
  - mobile-emulated verified: `3/3`
  - `strictPass: true`
- Diagnostics captured per observation:
  - iframe/host bounding boxes + frame area ratio
  - blocked/refusal heuristic
  - interaction proof string
  - before/after iframe screenshots + host screenshot paths under `/opt/cursor/artifacts`
- Known failure recorded honestly in same run family:
  - `www.openstreetmap.org` observed but interaction proof failed (`interaction-timeout`), so excluded from strict verified pool.
- Radio Garden is intentionally absent from selection due quarantine.

### 2026-11-08 bounded 20-step discovery soak
- Runner: `STUMBLR_BASE_URL=http://127.0.0.1:43124 npm run test:soak`
- Script: `scripts/catalogue-soak.mjs`
- Guardrails:
  - per-step timeout budget
  - whole-run budget
  - per-step progress checkpoint logging
  - partial JSON persistence to `docs/testing/catalogue-soak-results.json`
  - nonzero exit on acceptance failure
- Latest result:
  - desktop: `20/20` completed, `20` unique domains, `0` blocked steps, `0` failed steps
  - mobile emulation: `20/20` completed, `20` unique domains, `0` blocked steps, `0` failed steps
  - minimum iframe/viewport ratio in soak:
    - desktop: `0.802`
    - mobile emulation: `0.702`

### 2026-11-08 catalogue qualification correction
- `radio.garden` is set to `blocked` and excluded from selectors due explicit in-frame denial copy.
- Previous `launch_approved` labels were downgraded to `evaluation_only` for `zoomquilt.org`, `patatap.com`, and `weavesilk.com`.
- Reason: no documented publisher permission/terms basis was recorded that establishes launch qualification for framing.
- UI defaults to evaluation pool and explicitly indicates launch-only qualification is not yet established.

### 2026-11-08 production geometry + interaction proof
- Runner: `STUMBLR_BASE_URL=http://127.0.0.1:43124 npm run test:proof`
- Structured output: `docs/testing/production-proof-results.json`
- Required absolute geometry thresholds pass on desktop and mobile emulation for fixture + external desmos:
  - desktop iframe/viewport ratio: `0.802`
  - mobile iframe/viewport ratio: `0.718`
  - desktop unused area below footer: `13px`
  - mobile footer-to-dock gap: `32px`
- Post-interaction desktop/mobile desmos host captures:
  - `/opt/cursor/artifacts/stumblr-working-desktop-desmos-final.png`
  - `/opt/cursor/artifacts/stumblr-working-mobile-desmos-final.png`
- Fixture full-height proof captures:
  - `/opt/cursor/artifacts/proof-desktop-fixture-canvas.png`
  - `/opt/cursor/artifacts/proof-mobile-fixture-canvas.png`

## Current e2e skip inventory (intentional)
- `[chromium-desktop] tests/e2e/explorer.spec.ts:13` mobile dock reachability  
  Reason: desktop project.
- `[chromium-mobile] tests/e2e/explorer.spec.ts:3` desktop loop load/save/history  
  Reason: desktop-only toolbar/drawer path.
- `[chromium-mobile] tests/e2e/explorer.spec.ts:25` desktop utility-row uniqueness  
  Reason: desktop-only control bar.
- `[chromium-mobile] tests/e2e/fixtures.spec.ts:15` blocked skip/recover fixture path  
  Reason: desktop fixture path currently owns blocked-flow assertion.
- `[chromium-mobile] tests/e2e/fixtures.spec.ts:27` timeout/error recovery fixture path  
  Reason: desktop fixture path currently owns timeout/error assertion.
- `[chromium-mobile] tests/e2e/fixtures.spec.ts:41` no-repeat-until-exhaustion fixture path  
  Reason: desktop fixture path currently owns full pool-exhaustion assertion.

## Known caveats
- Browser emulation is not real iOS/Android hardware validation.
- Publisher framing policy can change after evidence capture.
- Internal cross-origin page transitions are not observable with full fidelity from parent app state.


## 2026-11-08 community / categories / Useless Web + Bored Button increment

### Discovery stage counts (not inflated by source list size)
- sources configured: 14
- discovered unique candidates this run: 61 (distinct domains 47)
- screened: 61
- selected (merged prior+latest editorial shortlist): 50 / distinct domains 50
- rejected log rows: 447
- source yields recorded in `docs/catalogue/discovery_summary.json` (`source_yields`)
  - Useless Web sites page accepted candidates: 9
  - Bored Button random accepted candidates: 30
  - Useless Web index feed destinations were mostly self-links to theuselessweb.com editorial pages (rejected as `source_self_link`); destination URLs harvested from `/sites/` HTML

### Official Bored Button URL resolved
- `https://boredbutton.com/` → `https://www.boredbutton.com/`
- Random lead endpoint used: `https://www.boredbutton.com/random`
- The owner's "canned list / no randomization" note treated as product feedback, not verified technical claim

### Browser qualification (new playful leads)
- configured targets: 12
- unique observed desktop/mobile: 9 / 9
- load-qualified distinct: 9
- interaction-qualified distinct: 9
- blocked in this probe: 0
- artifact: `docs/testing/new-candidate-qualification-results.json`
- screenshots under `/opt/cursor/artifacts/newcand-*` and `stumblr-newdest-*`

### Production proof / soak
- production proof pass: True (`docs/testing/production-proof-results.json`)
- soak pass: True with desktop unique 20 and mobile unique 20 (`docs/testing/catalogue-soak-results.json`)
- failed soak destinations were quarantined (`status: blocked`) then soak re-run to green

### Catalogue honesty
- publisher launch-qualified count remains **0**
- community suggestions: pending-review VM file store only; no auto-publish
- private launch prep doc: `docs/launch/2026-11-08-stumblr-dev-launch-readiness.md`


## 2026-11-08 Stellarium external omission root cause + brand staging
- Cause: default wildcard seed `97` places `stellarium-web.org` at **Next #27** after eligible pool grew to 46; `test:external` previously capped at **24** clicks, so Silk (#15) and Desmos (#16) verified while Stellarium never appeared. Not a Stellarium embed failure and not an assertion weaken.
- Fix: raise bounded `MAX_NEXT_CLICKS` to cover full eligible pool (default 64) while keeping the same acceptance assertions (interaction + visual delta + frame ratio).
- Brand: The owner asset pack staged under `public/brand/` with favicon metadata; charcoal toolbar uses **symbol-only**. Preferred stacked lockup (symbol above `stumblr.dev` wordmark on white) recorded in `docs/brand/stacked-lockup-preference.md` for a later branding surface, not the live exploration header.

## 2026-11-08 stacked lockup proportion fix + Stumbl control label
- Stacked lockup exports sized by opaque artwork bounds: circle art **480px** / wordmark art **640px** = **0.75**; gap **26px**; pad **51px**; canvas **742×695**.
- Paths: `public/brand/stumblr-stacked-lockup.svg`, `.png`, `@2x.png`, `stumblr-stacked-lockup-review.png`, `stumblr-stacked-lockup.measurements.json` (no developer caption in artwork).
- Primary discovery control visible label / aria-label / title: **Stumbl** (desktop + mobile); empty/history/timeout copy updated; e2e + soak selectors updated. Internal `onNext` semantics unchanged.
- Research-only appendices (no sampler/DB/GitHub publish): freshness+MUST-HAVE probes, post-launch Actions/DB/D1 ops, and vast procurement source-family notes under `docs/superpowers/specs/2026-11-08-*.md`.

## 2026-11-08 durable ops DB + discovery batch + freshness sampler implementation
- Local SQLite ops DB (`db/migrations/001_init.sql`, `src/lib/db/*`, `scripts/stumblr_db.py`) replaces JSON-only suggestion durability for **local proof**.
- Vitest: `src/lib/db/opsDb.test.ts` (restart + UNIQUE race + lease); submissions service uses DB.
- Python: `scripts/tests/test_stumblr_db_discovery.py` OK; bounded batch wrote review-only candidates (`auto_rotation: false`).
- Proof artifacts: `/opt/cursor/artifacts/discovery-batch-local-proof-summary.json`, `discovery-batch-local-proof-selected.json`.
- Sampler: per-browser `samplerSeed` + weighted diversity; fixed seed only via explicit test RNG/seed.
- Actions workflow prepared at `.github/workflows/discovery-batch.yml` with `if: false` (not running/connected).
- **Not claimed:** hosted shared durability, launch-ready, public GitHub release.
