# Stumblr launch-readiness checklist (private prep)

Status date: 2026-11-08  
Domain note: `stumblr.dev` is registered in Cloudflare (zone id recorded operationally) with **no DNS records** and **no public app deployment**. Origin/Cloud Agent VM preview is **not** production hosting.

This checklist is preparation-only. It does **not** authorize spend, DNS changes, public deploy, GitHub mirroring, or HTTPS verification claims.

## Compatible hosting recommendation (based on implemented app)

Implemented app is Next.js App Router + Node runtime with:
- static/SSR web UI
- `/api/suggestions` Route Handler writing the local ops SQLite database (`STUMBLR_DB_PATH`, default `data/stumblr-ops.sqlite`)
- no paid third-party APIs required for core loop

**Recommended compatible target:** a Node-capable host with persistent disk for the ops SQLite database (or swap storage adapter first), e.g. a small VPS / Fly.io / Render / Railway-style Node service.
**Not sufficient as-is without changes:** pure static CDN hosting, or ephemeral serverless without shared durable storage (suggestions would be lost across instances).

## Checklist

### A. Runtime & persistence
- [ ] Production Node process for `next start` (or equivalent) with pinned Node version
- [x] Local durable ops SQLite (`data/stumblr-ops.sqlite` / `STUMBLR_DB_PATH`) for community suggestions + discovery candidates/runs (**local proof only**)
- [ ] **Hosted shared** durable DB (smallest decision): keep Node + persistent disk SQLite volume **or** approve Cloudflare D1 + Worker/Pages binding (app is Node today; D1 binding is not live yet)
- [ ] Documented backup/restore for ops DB + catalogue manifests
- [x] Local guest state remains device-local (history/saves/prefs/samplerSeed); no false sync claims
- [ ] Explicit production durability story verified on shared hosted storage (do not claim production-durable from local SQLite alone)

### B. Secrets & config
- [ ] No secrets required for guest discovery loop today
- [ ] If moderation/auth is added later: secret manager, not committed env files
- [ ] `STUMBLR_DB_PATH` set to a durable mounted path (recommended packaging default: `/app/data/stumblr-ops.sqlite`)
- [ ] CSP/frame allowlist continues to derive from reviewed catalogue domains only

### C. Public host / custom domain (apex + www) / HTTPS
- [ ] Choose hosting endpoint first (do not point DNS yet unless intentionally launching)
- [ ] Plan apex + `www` records for `stumblr.dev` (and redirects)
- [ ] TLS termination plan (platform cert or Cloudflare proxy) — **not verified yet**
- [ ] Confirm preview URL vs production URL separation; VM `127.0.0.1` is private only

### D. Abuse protections already present / still needed
Present in private draft:
- [x] HTTPS-only URL canonicalization for submissions
- [x] DNS/IP SSRF guards (no localhost/private targets)
- [x] Dedupe against catalogue + pending queue
- [x] In-memory rate limit (per submitter token)
- [x] No synchronous fetch of submitted URLs on intake
- [x] Suggestions stay `pending_review` (never auto-publish)

Still needed before public intake:
- [ ] Shared/durable rate limiting across instances
- [ ] Moderation workflow + access control for queue review
- [ ] Stronger bot/abuse controls if traffic is public
- [ ] Logging/alerting that does not capture destination page content/cookies

### E. Remaining actual launch gates
- [ ] Real iPhone/Android QA (current mobile proof is browser emulation)
- [ ] Publisher permission / terms evidence for any `launch_approved` entries (currently **0**)
- [ ] Name/trademark clearance for “Stumblr” / `stumblr.dev`
- [ ] Expanded technically verified + rights-cleared catalogue
- [ ] Security review of sandbox, Permissions-Policy, and CSP frame allowlist
- [ ] Honest public copy for privacy, framing limits, and local-only guest data
- [ ] Production monitoring for app health (not per-Next destination analytics)
- [ ] Decision: keep reports local-only vs real moderation endpoint

## Explicit non-claims
- Cloudflare Free DNS zone ownership ≠ live site.
- Passing fixture/emulation tests ≠ device launch-ready.
- Header absence ≠ publisher framing permission.
- VM-local suggestion durability ≠ multi-region production durability.
