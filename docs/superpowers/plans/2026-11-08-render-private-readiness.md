# Render Private Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. This request requires a sole writer and explicitly forbids commits, dispatch, and external changes.

**Goal:** Add deny-by-default HTTP Basic protection, a non-revealing readiness endpoint, an offline Render Blueprint, a production HTTP verification harness, and bounded setup evidence.

**Architecture:** Next 16 `src/proxy.ts` guards every route and host except exact `/healthz`, using runtime-only username and SHA-256 password verifier configuration with constant-time comparisons. The submission route additionally requires same-origin JSON. Render runs one Docker web service with a 1 GB `/var/data` disk and runtime SQLite migrations.

**Tech Stack:** Next.js 16.4.5 Proxy/Route Handlers, TypeScript, Vitest, Node HTTP harness, Docker, Render Blueprint YAML.

**Spec:** User request dated 2026-11-08 (design already established; no separate spec file requested).

## Global Constraints

- Local writes only; no commit, push, provisioning, deployment, spend, dispatch, cron, DNS, or secret upload.
- Preserve PID 298512, port 43125, and existing data; coordinator harness uses isolated port 43127 and a temp DB outside git.
- No trusted-host bypass, public/disable mode, real credentials, credential logging, browser-bundled secret, or blocking `frame-src` policy.
- Render: one Docker web service, `plan: starter`, `region: oregon`, `numInstances: 1`, `autoDeployTrigger: off`, preview generation off, 1 GB disk at `/var/data`, runtime DB path `/var/data/stumblr-ops.sqlite`.

## Review Focus

- Missing/malformed auth config denies app/API/assets and makes health fail.
- Malformed Basic headers, encoded paths, and arbitrary/direct-origin hosts do not bypass.
- Authorized app/API/assets retain normal behavior.
- Cross-origin or non-JSON submission is denied before mutation.
- Build/package output contains no runtime database, environment files, secrets, or verification artifacts.

---

### Task 1: Authentication boundary and readiness

**Files:** Create `src/lib/security/privateAccess.ts`, `src/lib/security/privateAccess.test.ts`, `src/proxy.ts`, `src/proxy.test.ts`, `src/app/healthz/route.ts`, `src/app/healthz/route.test.ts`.

**Interfaces:** `readPrivateAccessConfig(env)`, `authorizeBasicHeader(header, config)`, Proxy response boundary, health process/config readiness.

- [ ] Write failing unit tests for missing/malformed config, unauthorized/malformed/authorized Basic headers, arbitrary hosts, assets, encoded paths, and exact health exception.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement minimal runtime-only config parsing, constant-time verification, Proxy guard, and health response.
- [ ] Run focused and full JS tests.

### Task 2: Submission request guard

**Files:** Create `src/lib/security/requestOrigin.ts`, `src/lib/security/requestOrigin.test.ts`; modify `src/app/api/suggestions/route.ts`.

**Interfaces:** `validateSameOriginJson(request)` returns a narrow rejection or null.

- [ ] Write failing tests for cross-origin, missing-origin, and non-JSON requests plus allowed same-origin JSON.
- [ ] Run focused tests and confirm expected failures.
- [ ] Implement and apply the guard before body parsing/database work.
- [ ] Run focused and full JS tests.

### Task 3: Blueprint, production harness, and package hygiene

**Files:** Create `render.yaml`, `scripts/render-private-http-check.mjs`; modify `package.json`, `scripts/verify-standalone-package.mjs`, `.gitignore`, `.dockerignore`, `docs/operations/private-node-sqlite-hosting.md`.

**Interfaces:** `npm run test:render-private-http`; offline package verifier and documented Blueprint checklist.

- [ ] Add an executable production HTTP harness using port 43127, temp DB, and dummy credentials without printing values.
- [ ] Add Blueprint and packaging exclusions/checks.
- [ ] Document process-vs-DB readiness, secret generation/setup, permissions, autosync/previews, provisional Oregon region, and cost/approval boundaries.
- [ ] Build and run the production HTTP harness plus package hygiene.

### Task 4: Verification evidence

**Files:** Create `/workspace/stumblr-run/verification/render-private-prep-details.md` and `/workspace/stumblr-run/render-private-prep-result.txt`.

- [ ] Run lint, typecheck, full JS, Python, build/package hygiene, and production HTTP checks.
- [ ] Record commands and exact outcomes without secret values; include coordinator commands.
- [ ] Audit git/build/package exclusions and scope, then write final summary.
