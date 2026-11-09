# Codex CLI resume handoff (Origin checkpoint → private GitHub)

Recorded 2026-11-08. **No secrets, tokens, or session caches.**

## Migration status

The owner **explicitly approved** moving Stumblr to a **private GitHub repo** after this verified checkpoint, then continuing with ChatGPT-backed **Codex CLI** on his machine.

- This cloud Auto agent **does not** create/push the GitHub remote (unsupported / parent-owned path).
- Transfer artifact: git **bundle** + SHA256 manifest in Agent Store `github-handoff/` (see paths below).
- **Origin remote stays intact** as recovery SoT until GitHub import is confirmed. No force-push, reset, or deletion of Origin history.

## Project-specific model routing

The owner explicitly approved this routing policy: prefer **GPT-5.3 Codex** if it becomes available; otherwise use **GPT-5.6-Sol** for smaller or tedious tasks and **GPT-6.1-Sol** for broader user-facing work.

Current evidence: a prior `gpt-5.3-codex` request returned HTTP 400 `model_not_found` because Codex with a ChatGPT account does not support it; the installed nonsecret catalogue lists `gpt-5.6-sol` and `gpt-6.1-sol`, with no 5.3 alias. A read-only inference smoke passed on `gpt-5.6-sol`, while the completed validation session actually ran on `gpt-6.1-sol`. The previous sole writer finished with a clean tree. Dependency installation remains blocked by `registry.npmjs.org` `EAI_AGAIN`; do not attempt network changes or dependency work as part of this handoff.

## Source of truth at freeze

| Item | Value |
| --- | --- |
| Pre-migration forge | Private **Origin** (`origin.cursor.com`) |
| Branch | `main` |
| Remote name | `origin` |
| Checkpoint HEAD | _filled at freeze — see Agent Store `CHECKPOINT.txt` / `manifest.json`_ |
| Bundle | `stumblr-main.bundle` (full `main` history, tracked tree only) |

Auth tokens may appear in local `git remote -v` — **never** copy credentialized remotes into GitHub remotes, docs, or the bundle side-car.

## Runtime / versions

| Runtime | Requirement |
| --- | --- |
| Node | **≥ 22** (`node:sqlite` / `DatabaseSync`) |
| npm | lockfile in repo |
| Python | **3.12+** (stdlib `sqlite3` for discovery/db helpers) |
| Playwright | from `package.json` |
| Ops DB file | `data/stumblr-ops.sqlite` or `STUMBLR_DB_PATH` (**local only; not in git**) |
| Migrations | `db/migrations/*.sql` via JS `migrateOpsDb` / Python `stumblr_db.migrate` |

`node:sqlite` is **Node runtime**, not Cloudflare Workers. SQL is D1-*compatible*; app does **not** use D1 bindings today.

## Commands to resume after GitHub checkout

```bash
node -v   # expect v22.x
npm ci
npm run lint
npm run typecheck
npm test
python3 scripts/tests/test_stumblr_db_discovery.py
npm run build
export STUMBLR_DB_PATH="$PWD/data/stumblr-ops.sqlite"
npm run dev -- --hostname 127.0.0.1 --port 43123
# optional discovery (review-only; never auto-rotates catalogue)
python3 scripts/discover_catalogue_candidates.py --max-candidates 24 --db-path "$STUMBLR_DB_PATH" --output-dir /tmp/stumblr-discovery-out
npm run test:e2e
```

### Import bundle on the box (parent/Codex)

```bash
git clone stumblr-main.bundle stumblr
cd stumblr
git checkout main
git rev-parse HEAD   # must match CHECKPOINT.txt
# then: git remote add origin <private-github-url>
# git push -u origin main
```

## Verified at this checkpoint

- Branding: Stumbl control + stacked lockup; Agent Store `branding-review/`
- Local SQLite ops DB + submissions path (`src/lib/db/*`, vitest `opsDb.test.ts`)
- Discovery anti-starvation: family interleave, per-family batch quotas, robots disallow / high crawl-delay skip, attempted/skipped/fetched telemetry; Python unit tests green (5)
- Diversity proof: `/opt/cursor/artifacts/discovery-diversity-proof-summary.json` (tilde/webring/archives; not webring monopoly)
- Sampler unit tests: `src/lib/sampler/createSampler.test.ts` (seed divergence / no premature repeats)
- Desktop multi-session browser sampler: 3 contexts → `uniqueSeeds=3`, `uniqueSequences=3`, no within-session id repeats, no consecutive same-domain clones (`/opt/cursor/artifacts/sampler-multisession-proof.json`, `desktopCorePass=true`)
- `npm run typecheck` green at freeze
- Scoped vitest (opsDb + createSampler) green at freeze

## Unverified / remaining for Codex (narrow)

1. Full `npm run lint` + `npm run build` + `npm run test:e2e` after last discovery edits (scoped units only re-run at freeze)
2. Mobile Save UI copy visibility in Playwright (`mobileSaveUi=unverified`; desktop Save path covered by component tests)
3. Hosted Node + durable SQLite volume packaging (recommended over D1-without-rewrite) — **no spend from cloud agent**
4. Real-device QA; DNS/HTTPS; `launch_approved` still 0; no public OSS/license/DNS decisions
5. GitHub private repo creation + first push (parent path); keep Origin until verified

## Key paths

| Path | Role |
| --- | --- |
| `db/migrations/001_init.sql` | Ops schema |
| `src/lib/db/*` | Node sqlite client/repos |
| `scripts/stumblr_db.py` | Python DB helpers |
| `scripts/discover_catalogue_candidates.py` | Bounded discovery batch |
| `.github/workflows/discovery-batch.yml` | Prepared, `if: false` |
| `docs/handoff/2026-11-08-codex-cli-resume.md` | This file |
| `docs/handoff/MIGRATION-CHECKPOINT.md` | Freeze + remaining work |

## Explicit non-goals of this freeze

No public launch, DNS, spend, publisher outreach, frame bypass, license selection, or GitHub create/push from this Auto agent. Cloud edits stop at export so Codex is the sole writer after import.
