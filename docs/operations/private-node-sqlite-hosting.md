# Current deployment mode: public, explicitly approved

The Blueprint sets `STUMBLR_ACCESS_MODE=public`. No username/password is required. Missing or unknown access mode retains the private fail-closed behavior below. Suggestions retain exact-origin JSON enforcement, URL validation, rate limiting and pending-review storage; this does not approve or publish contributed destinations. No admin or review HTTP endpoints are added. The Blueprint sets canonical `STUMBLR_EXPECTED_ORIGIN=https://stumblr.dev` and declares `domains: [stumblr.dev]`; Render automatically adds the www redirect. Direct Render-origin GET remains available, but submissions require the canonical origin. Render supplies `RENDER_EXTERNAL_URL` as a validated fallback if the explicit override is removed. No manual environment entries are required for this Blueprint. The private-mode instructions below apply only if deliberately returning to restricted access; do not enter auth secrets for the public deployment.

Automatic deployments off means Git pushes do not trigger a new deploy; an already-running service stays available. Initial/manual deployment is separate.

# Private Render preview preparation

Status: local preparation only. This does not authorize provisioning, a Blueprint apply, spend, DNS, credentials, or deployment. No resource has been created by this work.

## Runtime boundary

Every app, API, Next asset, and public-file route is protected by HTTP Basic at the Next 16 server Proxy. Protection is independent of hostname, so the direct `onrender.com` origin is not a bypass. There is no public/disable mode. Missing or malformed `STUMBLR_BASIC_AUTH_USERNAME` or `STUMBLR_BASIC_AUTH_PASSWORD_SHA256` produces HTTP 503 for protected paths. Invalid or absent credentials produce HTTP 401 and a Basic challenge. Both outcomes are non-cacheable.

`STUMBLR_BASIC_AUTH_PASSWORD_SHA256` is the canonical base64 encoding of the 32-byte SHA-256 digest of the password, not the password itself. Username and password-verifier comparisons are constant-time after hashing fixed-length values. These runtime-only variables are not `NEXT_PUBLIC_`, Docker build arguments, or committed values. HTTP Basic credentials are transport credentials, not encryption; Render terminates public TLS before forwarding to the container.

The existing suggestion POST additionally requires `Content-Type: application/json` and an exact allowed `Origin`. An explicit `STUMBLR_EXPECTED_ORIGIN` has first priority and is optional; use it for a later approved custom hostname. Without that override on Render, the server reads Render's runtime `RENDER_EXTERNAL_URL`. Render documents that `RENDER=true` and that a web service receives its full `https://…onrender.com` URL automatically at build and runtime ([Default Environment Variables](https://render.com/docs/environment-variables)). The automatic value is accepted only as a canonical HTTPS origin on a real `*.onrender.com` hostname, with no credentials, port, path, query, or fragment. A present malformed explicit override never falls back. A Render runtime with a missing or malformed automatic value fails closed and never derives trust from request headers. The check does not trust `Host`, `X-Forwarded-Host`, or `X-Forwarded-Proto`; cross-origin and missing-`Origin` requests remain denied. Outside Render with no explicit override, local behavior continues to use Next's request origin. This blocks ambient browser Basic credentials from authorizing cross-origin form/fetch submissions while preserving authenticated same-origin interactions. The existing CSP `frame-src` behavior is unchanged.

## Readiness semantics

`GET /healthz` is the only unauthenticated route. A 204 means only:

- the Node process can answer HTTP; and
- both required auth variables are present and structurally valid; and
- the origin policy is valid for the runtime (including Render's automatic external URL when no explicit override is set).

It returns no body and uses `Cache-Control: no-store`. It intentionally does **not** open, migrate, read, or write SQLite and therefore does not prove that `/var/data` is mounted/writable, migrations succeed, the database is healthy, or app data is available. A missing/malformed auth configuration returns 503. Database migrations remain runtime-lazy: `openOpsDb` creates/migrates the file when a database-backed app operation first opens it. Render disks are unavailable during image build and pre-deploy commands, so no build/pre-deploy database step is configured.

## Blueprint contract

[`render.yaml`](../../render.yaml) declares exactly one Docker `web` service:

- `plan: starter` (0.5 CPU / 512 MB), `region: oregon`, `numInstances: 1`;
- `autoDeployTrigger: off` and Blueprint preview generation off;
- one 1 GB persistent disk mounted at `/var/data`;
- `STUMBLR_DB_PATH=/var/data/stumblr-ops.sqlite`;
- the two required auth variables, username and password verifier, with `sync: false`;
- `/healthz` as the health check path.

There are no databases, cron jobs, custom domains, pre-deploy commands, or secret build arguments. Oregon is provisional pending workspace/region confirmation. Blueprint autosync is a dashboard/control-plane setting and has no supported YAML field: it must be turned off during setup. Render supplies external TLS. The planning baseline is USD 7/month for the web service plus USD 0.25/month for 1 GB disk; tax and usage extras are additional. This estimate is not purchase approval.

## Exact approval and setup checklist (do not execute without approval)

1. Obtain explicit approval for the Render workspace, provisional Oregon region, recurring baseline spend, service creation, and the two people/roles allowed to administer the private preview.
2. Confirm the selected workspace supports the declared `starter` plan and Oregon region. Stop if either differs; update and re-review the local Blueprint rather than improvising in the dashboard.
3. In a password manager, generate a unique high-entropy preview password and a non-identifying username. Do not reuse personal, production, or Render credentials.
4. Locally derive the password verifier without putting the password in shell history:

   ```bash
   read -r -s -p 'Preview password: ' STUMBLR_INPUT_PASSWORD
   printf '\n'
   printf '%s' "$STUMBLR_INPUT_PASSWORD" | openssl dgst -sha256 -binary | openssl base64 -A
   printf '\n'
   unset STUMBLR_INPUT_PASSWORD
   ```

   Treat the displayed verifier as a secret. Never paste it into a report, ticket, commit, build argument, or browser-side variable.
5. Review `render.yaml` locally. If remote creation is separately approved, set `STUMBLR_BASIC_AUTH_USERNAME` and `STUMBLR_BASIC_AUTH_PASSWORD_SHA256`. Do not guess or reserve a service hostname before start: Render supplies `RENDER_EXTERNAL_URL` automatically to the web-service runtime, and startup/readiness fail closed if that value is missing or malformed. `STUMBLR_EXPECTED_ORIGIN` remains an optional explicit override for a later approved custom hostname; if used, set it to the exact canonical HTTPS origin (scheme and hostname only) and re-run the same checks.
6. In Render settings, explicitly disable Blueprint autosync. Confirm preview environments remain disabled, auto-deploy remains off, no custom domain exists, and no unrequested service/database was created.
7. Restrict Render service/environment access to the approved roles. Share the browser credentials only through the approved password manager, with least-privilege membership and an owner for rotation/revocation.
8. Before any exposure, verify Render reports `/healthz` healthy, then run the real HTTP checks below against the configured `onrender.com` origin. A later separately approved hostname requires an explicit `STUMBLR_EXPECTED_ORIGIN` update and the same checks. Do not record credentials in command output or reports.
9. Exercise one authenticated suggestion using non-sensitive test data, then confirm `/var/data/stumblr-ops.sqlite` and its WAL/SHM sidecars are on the disk and survive a separately approved restart. This is the DB-readiness/persistence check that `/healthz` intentionally does not perform.
10. Define a SQLite-consistent backup/recovery owner and rehearsal before launch approval. Keep `numInstances: 1`; multi-instance SQLite requires a separately approved shared-data design.

## Local and coordinator verification

The automated production harness uses port 43127 and a temporary database under the OS temp directory, starts first without auth config and then with dummy test credentials, suppresses credential values, and cleans up the temp directory:

```bash
npm run build
npm run test:render-private-http
```

If the coordinator sandbox cannot bind a port, run these exact commands outside that sandbox from `/workspace/stumblr`; they do not touch port 43125 or the existing database. Do not substitute the existing review server:

```bash
cd /workspace/stumblr
npm run build
npm run test:render-private-http
```

For a later approved real Render origin, use password-manager-injected `STUMBLR_PREVIEW_URL`, `STUMBLR_PREVIEW_USERNAME`, and `STUMBLR_PREVIEW_PASSWORD`; keep shell tracing off and do not paste command output containing headers:

```bash
test "$(curl -sS -o /dev/null -w '%{http_code}' "$STUMBLR_PREVIEW_URL/")" = 401
test "$(curl -sS -o /dev/null -w '%{http_code}' "$STUMBLR_PREVIEW_URL/healthz")" = 204
test "$(curl -sS -u "$STUMBLR_PREVIEW_USERNAME:$STUMBLR_PREVIEW_PASSWORD" -o /dev/null -w '%{http_code}' "$STUMBLR_PREVIEW_URL/")" = 200
test "$(curl -sS -u "$STUMBLR_PREVIEW_USERNAME:$STUMBLR_PREVIEW_PASSWORD" -H 'Origin: https://attacker.invalid' -H 'Content-Type: application/json' --data '{}' -o /dev/null -w '%{http_code}' "$STUMBLR_PREVIEW_URL/api/suggestions")" = 403
```

## Persistence and recovery

SQLite WAL and shared-memory sidecars live beside the database on `/var/data`. Backups must use SQLite's backup API or a coordinated stop/checkpoint, not copy only the main file during writes. Before hosting approval: make a consistent backup, restore into a new local volume, start the same image, verify migrations/pending suggestions/discovery records, and retain the original until the restored copy is verified.
