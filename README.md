# Stumblr (Private Draft MVP)

Stumblr is a modern, guest-first public-web discovery experience inspired by the "stumble" interaction pattern: one persistent interface, one destination at a time, and explicit controls for `Stumbl` (neutral next destination), `Not for me`, `Save`, local history, and local reports.

This repository currently contains a private-draft MVP focused on:
- curated embeddable catalogue entries
- deterministic no-repeat sampling
- race-safe frame loading and fallback states
- local-only persistence for preferences/history/saves/reports
- desktop + mobile-first control surfaces

## Tech stack
- Next.js (App Router) + TypeScript
- Tailwind CSS
- Radix UI primitives (drawer/dialog)
- Vitest + Testing Library
- Playwright

## Run locally
```bash
npm install
npm run dev -- --hostname 127.0.0.1 --port 43123
```

Open: `http://127.0.0.1:43123`

## Verification commands
```bash
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:e2e
npx playwright test tests/e2e/discovery-deck.spec.ts
STUMBLR_BASE_URL=http://127.0.0.1:43124 npm run test:proof
STUMBLR_BASE_URL=http://127.0.0.1:43124 npm run test:external
STUMBLR_BASE_URL=http://127.0.0.1:43124 npm run test:newcand
STUMBLR_BASE_URL=http://127.0.0.1:43124 npm run test:soak
npm run catalogue:discover
npm run catalogue:generate
node scripts/check-catalogue-health.mjs
```

The focused discovery-deck proof covers two persistent no-repeat cycles and their boundary, mid-cycle runtime additions, v1 local-state migration, selected-topic cycles, and the difference between removing a history row and resetting discovery. It runs in desktop Chrome and Pixel 7 mobile emulation; current evidence is in [`docs/testing/stumblr-evidence.md`](docs/testing/stumblr-evidence.md).

## Product notes
- This MVP intentionally uses a bounded curated pool; it does not claim arbitrary web embedding support.
- Reports are local-only records in this milestone (no moderation backend).
- Destination sites may track visitors independently.
- Framing behavior is subject to publisher XFO/CSP policies and can change over time.

## Planning docs
- `docs/superpowers/specs/2026-11-07-stumblr-design.md`
- `docs/superpowers/plans/2026-11-07-stumblr-mvp.md`
- [Upcoming discovery: indie apps, overlooked repositories, and research](docs/superpowers/plans/2026-11-07-stumblr-mvp.md#upcoming-indie-apps-overlooked-repositories-and-research) — planned, not shipped.
- `docs/testing/stumblr-evidence.md`

## Private launch prep
- `docs/launch/2026-11-08-stumblr-dev-launch-readiness.md` (no DNS/public deploy performed)

## Catalogue operations
- Autonomous publisher rollout, report-only inspection, rollback/recovery, health quarantine, and evidence retention: [`docs/operations/runtime-catalogue.md`](docs/operations/runtime-catalogue.md#autonomous-catalogue-publisher).
- Automated entries remain `evaluation_only`; the workflow does not grant public status.
