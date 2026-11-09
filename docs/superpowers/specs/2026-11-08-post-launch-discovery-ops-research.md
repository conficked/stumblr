# Post-launch discovery ops research (design only)

Recorded 2026-11-08 from the owner’s follow-up (“GitHub worker py script that constantly scrapes & adds to the database… database necessary?”) plus parent guidance. **Research/design only.**

## Explicit non-approval / source-of-truth gate

The owner’s preference for **open-source GitHub after launch** is a **future direction**, not approval to:

- mirror or publish this private Origin draft now,
- choose a license,
- migrate remotes,
- expose credentials,
- write production infra,
- spend on paid runners/D1 Paid/Workers Paid,
- or auto-push harvested URLs into the live app catalogue.

**Current source of truth remains the private Origin repository.** Any public release requires a separate controlled plan covering license choice, security audit, secret hygiene, and what stays private (rejected/raw submissions, personal metadata, probe credentials). **No move until that release plan is approved.**

Companion design: `docs/superpowers/specs/2026-11-08-discovery-freshness-and-must-have-candidates.md` (freshness sampler + MUST-HAVE frame blockers). Existing bounded pipeline to reuse later: `scripts/discover_catalogue_candidates.py` (not a daemon).

---

## 1. Direct answers

### Is a nonstop “constantly scraping” GitHub worker viable?
**No as a continuous daemon inside GitHub Actions.** GitHub Actions supports **scheduled** workflows (`on.schedule` cron), not an infinite always-on scraper process. Parent recommendation stands: **scheduled, bounded Python batches** that resume from checkpoints, tolerate missed runs, and stop within job limits.

### Is a database necessary?
**Not for a small curated launch catalogue.** Checked-in JSON (or generated TS modules, as today) is enough for a finite approved rotation set.

**Recommend a small durable store for long-term ops** once candidate volume, review queues, community submissions, and health rechecks grow — then **optionally export** an approved slice into the app’s static catalogue artifact. Do **not** make the live app read raw scrape rows directly, and do **not** auto git-commit harvested entries into `main`.

---

## 2. Priority comparison: GitHub Actions scheduled Python + persistent DB vs dedicated Python cron worker

| Dimension | **A. GitHub Actions scheduled Python + persistent DB** (priority path to evaluate for public OSS) | **B. Dedicated Python cron worker** (VPS / Cloudflare Cron Trigger calling a worker / other host cron) |
| --- | --- | --- |
| Fit for “always scraping” | **Batch / periodic only** — not continuous | Can run more frequently or as supervised loop, still should be **bounded batches** for safety |
| Ops simplicity | High if repo already on GitHub; workflow YAML + secrets | Needs host, process supervisor, deploy path |
| Timing guarantees | **Best-effort**; delays & possible dropped queued runs under load | Host cron usually more predictable; still not magical |
| Public-repo caveats | **60-day inactivity auto-disables schedules**; forks disable schedules by default | Independent of GitHub inactivity rules |
| Cost shape | Public standard GitHub-hosted runners: Actions usage free per GitHub billing docs; private repos consume included/paid minutes. DB/storage separate | Host + bandwidth + DB; may be steadier for private heavy jobs |
| Secrets | Repo/org Actions secrets; forks don’t get secrets on PR runs | Host env / secret manager |
| Overlap control | `concurrency:` groups + DB leases/checkpoints | flock / lease row / single-runner |
| Alignment with the owner's OSS intent | Strong once release plan approved | Still useful as private ops even if app is OSS |

**Recommendation (design):** Prefer **A for the future public/open-source story** (scheduled bounded discovery jobs writing to a **private** candidates DB, exporting approved catalogue separately). Keep **B** as the fallback when schedules must be reliable, private, or denser than Actions’ best-effort queue — or run B privately while A is documentation/demo-only. **Neither** should be an unbounded infinite scrape loop.

Hybrid that remains honest: Actions (or external cron) triggers `workflow_dispatch` / HTTP kick → same Python batch entrypoint → durable queue/DB. One codebase; two triggers.

---

## 3. Verified GitHub Actions scheduling caveats (official docs)

Primary references (verify again before implementation; docs can change):

- [Events that trigger workflows — `schedule`](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [Workflow syntax — `on.schedule`](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onschedule)
- [Disabling and enabling a workflow](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow)
- [Billing and usage](https://docs.github.com/en/actions/concepts/billing-and-usage)

### Documented behaviors to design around
1. **Best-effort timing:** Scheduled events **can be delayed** during high load; high load includes the **start of every hour**. If load is high enough, **some queued jobs may be dropped**. Prefer odd minutes (not `:00`). **Do not** imply instant or guaranteed continuous schedule.
2. **Minimum interval:** Shortest schedule is **once every 5 minutes**. Still not a substitute for a daemon.
3. **Default branch only:** Scheduled workflows run from the **latest commit on the default branch**.
4. **Public repo 60-day inactivity:** In a **public** repository, scheduled workflows are **automatically disabled** when **no repository activity** has occurred in **60 days**. Re-enable via UI/CLI/API. Quiet catalogue-only repos are especially exposed.
5. **Forks:** When a **public repository is forked**, **scheduled workflows are disabled by default**. Workflows in forks generally don’t run until Actions is enabled; secrets are not passed to forks (except `GITHUB_TOKEN` with restricted perms on fork PRs).
6. **Actor / deactivation:** Scheduled workflow `actor` issues (suspended/deleted account) can stop schedules even when manual `workflow_dispatch` still works; a write-capable user changing the cron can reactivate.
7. **Cost / plan caveats:** GitHub documents Actions usage as **free for standard GitHub-hosted runners in public repositories** and for self-hosted runners; **private** repositories draw from plan-included compute and may incur charges for additional usage. **This research does not authorize spending.** Exact minute prices depend on account plan at the time — treat as **unknown until the owner’s GitHub org plan is confirmed**. No free external “keep-alive” SaaS is assumed or recommended here.
8. **Runtime limits (plan for them):** GitHub-hosted jobs have finite max duration (commonly cited 6 hours on hosted runners in Actions limits docs — re-check `Actions limits` before shipping). Batches must checkpoint and exit cleanly.

**Design implication:** Discovery jobs must be **idempotent, resumable, and tolerant of missed intervals**. Derive work from **last successful checkpoint**, not “now minus one hour.”

---

## 4. JSON / git commits vs database

| Store | Good for | Weak for |
| --- | --- | --- |
| **JSON / generated TS in git** (current pattern) | Small approved catalogue; reviewable diffs; offline apps; no infra | Concurrent writers; large candidate history; PII; high-churn health probes; merge conflicts |
| **Small DB** | Candidates, review states, community queue, health timestamps, quarantine reasons, provenance, dedupe keys | Becomes a second source of truth if app reads it without export discipline |

**Recommended split**
1. **Private ops DB** (or private artifact bucket) for: raw/rejected candidates, review workflow, community submissions, probe health, source yield metrics.
2. **Exported approved catalogue** (JSON/TS) consumed by the app — produced by an explicit, reviewed export step.
3. **Never** auto git-push harvested rows into the app’s main catalogue branch.
4. **Public OSS code** must not publish rejected/raw user submissions or personal metadata. Keep those in private storage even if the app is open source.

Concurrency / write safety for DB path: single-writer lease per job, upsert on canonical URL, transactional status transitions (`discovered → screened → shortlisted → approved|rejected|quarantined`), and immutable provenance fields.

---

## 5. Cloudflare D1 as one candidate (optional, not mandatory)

The owner has a Cloudflare account; D1 is a **reasonable option to evaluate**, not a required choice.

### Documented access paths
1. **Inside Cloudflare Workers (incl. Python Workers):** bind D1 via Wrangler `d1_databases` and query `env.DB` / `self.env.DB`. Docs: [Query D1 from Python Workers](https://developers.cloudflare.com/d1/examples/query-d1-from-python-workers/).
2. **External Python (e.g. GitHub Actions job):** Cloudflare documents that to access D1 **outside** a Worker, you should **build a proxy Worker API** with auth; D1’s built-in REST API is **best suited for administrative use** and is subject to the **global Cloudflare API rate limit**. Tutorial: [Build an API to access D1 using a proxy Worker](https://developers.cloudflare.com/d1/tutorials/build-an-api-to-access-d1/).
3. **Official Cloudflare Python API library** also exposes D1 admin/query endpoints under account tokens ([Cloudflare API — D1](https://developers.cloudflare.com/api/resources/d1/), [Python client](https://developers.cloudflare.com/api/python/)). Prefer **minimal scoped credentials**; prefer a **narrow Worker proxy** over a broad account token for routine ingest. **Do not request or store secrets in this research increment.**

### Credential scoping (design stance)
- Prefer Worker secret `API_KEY` (bearer) scoped to allowlisted prepared statements / tables (candidates write, no DROP).
- If using API tokens temporarily for admin: least privilege, account-scoped, rotatable; never commit; never expose to public workflow logs.
- No secrets requested in this pass.

### Cost caveats (documented; verify at decision time)
Per [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) (as of docs fetch 2026-11-08):
- Workers **Free** includes limited daily rows read/written and storage; exceeding Free daily limits causes query errors until reset/upgrade.
- Workers **Paid** includes larger monthly quotas then overage rates; additional databases beyond included count have a monthly per-database fee on Paid.
- D1 scale-to-zero for idle compute; storage still counts; Workers invoking D1 bill separately under Workers pricing.
- **This note does not authorize enabling Paid plans or spending.** Treat dollar figures as documentation snapshots that can change.

### Alternatives (names only for open decision)
SQLite file in private object storage, Postgres (hosted), Turso/libsql, etc. Choice deferred until release/infra plan.

---

## 6. Proposed future architecture sketch (not implementing)

```
Public OSS app repo (after approved release plan)
  └─ GitHub Actions cron (bounded) OR workflow_dispatch
        └─ python scripts/discover_catalogue_candidates.py --batch ...
              └─ writes candidates/review/health → private DB (e.g. D1 via scoped Worker API)
                    └─ human/automation review gates
                          └─ export job → approved catalogue artifact for app build
                                └─ app ships finite catalogue; sampler stays per-user random (see freshness spec)

Private ops remain private: raw/rejected submissions, personal metadata, probe secrets.
Private Origin remains SoT until release plan approved.
```

Honest automation evidence (simple, not a dashboard project): last successful run timestamp, candidates discovered vs screened vs approved counts, failure reason counters — emit as job summary / private metrics row.

---

## 7. Open decisions for the owner (before any infra write)

1. Approve a **controlled open-source release plan** (license, audit, private vs public data split) — required before GitHub publication.
2. Prefer **Actions-scheduled batches + private DB** for OSS narrative, **dedicated cron** for private reliability, or hybrid?
3. Accept **D1 + scoped Worker proxy** as the first DB candidate given existing Cloudflare account, or pick another store?
4. Confirm app continues to consume **exported approved catalogue only** (recommended).
5. Confirm no auto-merge of scrape results to production catalogue without review.

---

## 8. What this increment did / did not do

**Did:** Document options, cite primary GitHub/Cloudflare behaviors, answer “database necessary?”, bind to existing freshness + MUST-HAVE research, reinforce Origin SoT and release gate.

**Did not:** Publish to GitHub, create Actions workflows, create D1 databases, request secrets, spend, scrape continuously, change sampler/catalogue implementation beyond already-authorized branding/label edits.

## 9. Procurement companion
Vast multi-category source-family research (what to reuse from `discover_catalogue_candidates.py`, measured vs hypothesized yields, balancing): `docs/superpowers/specs/2026-11-08-vast-discovery-procurement-research.md`.
