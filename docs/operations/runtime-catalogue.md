# Runtime catalogue delivery

The deployed adapter reads atomic SQLite snapshots from the existing persistent disk. Browser refreshes fetch `/api/catalogue`; the sampler merges reviewed evaluation entries with the bundled baseline, deduping ID, URL and domain. Failed/invalid snapshots fall back to the preceding valid snapshot and ultimately the bundled baseline. Dynamic frame CSP contains only bundled and explicitly reviewed active destinations. Reload the page after an import to receive its matching CSP; no application build/deploy is needed for catalogue-only publication.

## Zero-secret identities

GitHub documents short-lived workflow OIDC at https://docs.github.com/en/actions/concepts/security/openid-connect. The server verifies RS256 signatures against the fixed GitHub issuer/JWKS, audience, expiry, immutable repository ID1450399070, repository, main ref, workflow path and event. No long-lived token is generated/copied/configured.

- `discovery-manual-review.yml`: collector audience; only import pending/quarantined rows, read known URLs and flag safety rechecks. Cannot publish.
- `catalogue-publish.yml`: separate manual-only publisher audience; reads committed `docs/catalogue/reviewed-runtime.json`. Only accepts schema-validated evaluation entries with recorded rendered evidence/reviewer. Cannot assert publisher permissions or launch approval.
- Unauthorized ingest/read requests401; no public review dashboard or approval endpoint.

## Scheduled supply

Standard Ubuntu/Python discovery runs hourly at minute 17 UTC with a 15-minute job cap and 24 newly selected candidates maximum. A separate disjoint six-hour cron performs the bounded 24-destination runtime safety recheck without duplicating collection. Manual bootstrap mode fans out larger source-family shards while preserving the same review-only queue and browser evidence gates. Shared authenticated known URLs avoid selecting the same pending destinations every run. Results dedupe into persistent SQLite. Three-day private artifacts are supplemental, not the durable queue. Community suggestions mirror into the same pending-review table using a SQLite trigger; submitter hashes remain solely in community storage.

Safety rechecks use the crawler's robots, public IP and redirect guards and a browser running the Stumblr frame sandbox. The observer job has no OIDC authority. Separate collector jobs load private targets and persist bounded evidence artifacts from the same workflow attempt. Confirmed candidate frame denial or an unsafe destination can quarantine immediately. Ordinary hard failures require two checks; slow loads and optional resource failures do not count. Quarantined entries stay available to private rechecks and return to the public catalogue after two clean checks or a newer explicit manual review. Health rechecks never approve unpublished candidates.

Pending candidates with a qualifying pair older than 48 hours are eligible for another bounded qualification job, including candidates previously deferred by a release cap. The desktop and mobile observations must still belong to the same qualifier run, attempt and version.

## Reviewed changes without app deployment

1. Inspect pending candidates; verify actual sandbox rendering, purpose/category, redirects and duplicates. No header absence is treated as permission.
2. Record provenance and browser evidence; include only reviewed `evaluation_only` entries in `docs/catalogue/reviewed-runtime.json`. This file is a complete additional-entry snapshot, not an append command.
3. Commit/push the reviewed manifest privately and dispatch `catalogue-publish.yml` on main.
4. Verify publication result revision/imported count and canonical `/api/catalogue`; refresh a browser and exercise Stumbl. No Render deploy is needed.

Existing snapshots and audit history remain on `/var/data`. Backup with SQLite backupAPI, not raw WAL copies. No new vendor/service/secrets/plan are required. Existing Actions billing limits still apply.

## Autonomous catalogue publisher

`.github/workflows/catalogue-auto-publish.yml` requests a server-side proposal each day at 17:37 UTC. The server, not the workflow, computes eligibility, rollout stage, cap, candidate health and exact snapshot. Workflow artifacts contain `preview.json`, `decision.json`, `proof.json`, and `rollback.json`; inspect these before treating a run as healthy. The preview includes the evidence-retention counts (`eligible`, `deleted`, and `remaining`). Collection reports and these artifacts are operational evidence; SQLite proposals, latest candidate state, runtime snapshots and publication audits are durable state.

### Rollout

1. Dispatch the workflow with `mode=report` to inspect its output without publishing. The workflow default is `report`.
2. The first three distinct scheduled runs stay `report_only`; they produce proposals and do not commit snapshots.
3. After those reports, scheduled runs enter `limited` with a maximum of five additions. Three distinct scheduled runs must each publish, pass browser proof, pass the live public check, and remain unrolled-back before the server advances to `full` (maximum twenty additions). No-op runs do not count as releases.
4. `workflow_dispatch` with `mode=publish` can request the server's current non-report-only proposal. Review its artifact and the expected live revision. The workflow always commits the exact server proposal, proves the release, and checks the public catalogue; failures trigger selective rollback and a fresh readback.

Every generated entry remains `evaluation_only`; this automation does not set an active/public status or claim publisher permission. Preview, proof and public verification use the same visible entries. The stored release also retains entries hidden by runtime health so rechecks can restore them. The queue's canonical candidate ID links health to both manual and automatic snapshots, even when a reviewed manifest uses a different public ID.

### Dry-run inspection and operations

- In Actions, open `catalogue-auto-publish`, select **Run workflow**, and choose `report`. Inspect the preview and decision artifact: rollout stage/cap, expected revision, additions/removals, reason counts, and retention counts. A report-only result must have no commit/release.
- For a scheduled run, inspect all four JSON artifacts. Confirm the pre-commit live revision matches `expectedRevision`; on success, compare the proof's observed revision with the release and canonical `GET /api/catalogue` readback. A `no_op` must leave the revision unchanged.
- To disable automatic publication, edit `.github/workflows/catalogue-auto-publish.yml` and remove or comment out only its `on.schedule` cron entry, then commit the change. Manual report dispatch remains available. Re-enable by restoring the cron after review.
- To roll back, use the workflow's authenticated rollback path for the failed release. It removes only the affected additions, records a durable rollback audit, and verifies the public readback; do not delete snapshots or audit rows by hand. Confirm the resulting revision from `GET /api/catalogue` and the workflow artifact.
- If a workflow stops between commit, proof, or public check, re-run the same GitHub run attempt/recovery path and inspect the resulting preview before starting a new run. The server returns recorded release/proof/rollback state idempotently. For a stuck pending public check, verify the canonical endpoint and allow the documented 300-second check window to settle before dispatching another publication.
- For an unexpected entry, inspect its runtime health state and quarantine reason in the private SQLite operations database; confirm it is absent from `GET /api/catalogue`. Correct the underlying destination/review evidence, run the safety recheck, then follow the explicit reviewed-manifest publication path. Never clear quarantine or edit durable audit history directly.

### Evidence retention

On the first preview for each scheduled run, the server transactionally removes at most 500 superseded raw observations across qualification, runtime browser and runtime HTTP evidence. Only rows strictly older than 30 days can be deleted. The latest qualification observation per candidate/device and the latest browser and HTTP observations per runtime candidate are retained even when older. Compact health state, append-only `runtime_health_transitions`, proposals, snapshots, and publication and rollback audits remain durable. `remaining` reports eligible old observations left for later daily batches.
