# Discovery freshness + MUST-HAVE candidate research (design only)

Recorded 2026-11-08 from the owner’s explicit requirements. **Research/design only** — no sampler rewrite, catalogue publish, proxy, publisher outreach, DNS, deploy, or GitHub in this increment.

Companion branding work (Stumbl control label + stacked lockup exports) continues separately and does not expand this design into implementation.

## 1. MUST-HAVE desired destinations (exact URLs)

The owner named these as desired destinations. They are recorded as **high-priority candidates**, not silently substituted, and **not** promoted to `launch_approved` without evidence.

| Candidate | URL | In catalogue today |
| --- | --- | --- |
| HackerTube | `https://hackertube.org/` | **No** |
| HackerBooks | `https://hackerbooks.org/` | **No** |

### 1.1 Read-only probe summary (2026-11-08)

Method: HTTPS GET/HEAD from private VM; Playwright iframe smoke; robots/about page text extraction. No framing bypass, no proxy, no publisher contact.

#### Shared safety/HTTPS
- Both serve **HTTPS** with valid public certs and `Strict-Transport-Security`.
- No private/reserved IP target observed on the public hostnames used.
- Homepage HTTP status **200** for both.

#### Live-frame headers / load feasibility
| Site | `X-Frame-Options` | CSP `frame-ancestors` | In-app iframe feasibility |
| --- | --- | --- | --- |
| hackertube.org | `DENY` | `'none'` (plus restrictive CSP) | **Blocked** — browser must refuse embedding |
| hackerbooks.org | `DENY` | `'none'` | **Blocked** — browser must refuse embedding |

Playwright iframe probe: outer `src` set correctly; document access behaves as cross-origin/blocked. **Do not** strip headers, reverse-proxy, or nest via third-party viewer to “fix” framing.

#### Interaction feasibility (honest)
- Sites are interactive in a **top-level tab** (browse, search, open items).
- Inside Stumblr’s sandboxed destination iframe they are **not** usable destinations under current publisher framing policy.
- Honest product options later (design only, not implemented here):
  1. Keep as **priority external / Open original** candidates with clear UI that framing is blocked.
  2. Re-probe periodically; only change status if publishers change headers.
  3. Never auto-swap to a different site and claim the MUST-HAVE was included.

#### Publisher terms / about notes (public page text only)
**HackerTube**
- About/settings copy: no accounts; likes/history local to browser; videos via YouTube privacy-enhanced embed.
- States independence from YouTube/Google/HN/Y Combinator.
- Public data export references **ODC-By 1.0** for dataset files — **not** a license to iframe the site UI.
- `robots.txt`: disallows `/api/` and `/download/` for `User-agent: *`.

**HackerBooks**
- About: HN-comment bookshelf (2007–2026), Open Library resolution, local privacy section present in page structure; no public `/terms` or `/privacy` routes (404).
- `robots.txt`: allows `/`, disallows `/search` and `/foryou`; sitemap present.
- No statement found granting third-party framing or embedding of the site chrome.

#### Structural / feel note (diversity)
Both are **HN-derived catalogue browsers** (video mentions vs book mentions). Even after any future framing change, consecutive presentation would risk the same “type-of-site” feel the owner rejects when novelty lists dominate. Diversity policy must treat source-family / structural type as a soft anti-clone signal, not only eTLD+1.

#### Blockers (do not paper over)
1. **Hard frame block** on both URLs today → cannot guarantee in-frame inclusion.
2. **No publisher permission evidence** for embedding even if headers were absent.
3. **Not in catalogue** yet; recording priority ≠ shipping as launch-approved.
4. Substituting alternate “similar HN tool” sites would violate “don’t silently substitute.”

## 2. The owner’s freshness goal vs current production sampler

### User goal
- Totally randomized & fresh like old StumbleUpon.
- Reject recurring **same sequence** and same **structural/type-of-site** feel (Bored Button / Cloudhiker-like novelty loops).
- Unpredictable **per-user** exploration.
- No globally fixed catalogue order or shared production seed.
- No repeats within short history while pool permits.
- Domain / type / source diversity to avoid consecutive clones.
- Avoid novelty-source domination.
- Respect selected interests but keep broad adjacent/wildcard discovery.
- Distinguish **new-site supply growth** from **randomized ordering of a finite pool**.

### Current implementation gap (evidence, not a silent fix)
- `createSampler(seed, …)` uses Mulberry32 and builds a **once-ordered weighted list**, then walks it with a domain-diversity guard (`createSampler.ts`).
- Production seed is **`seedFromPreferences(topics, includeEvaluationPool)`** — a deterministic function of preference inputs (`ExplorerApp.tsx`).
- Consequence: users with the same topics + evaluation-pool toggle get the **same relative order** (history only advances the cursor). This matches the owner’s “recurring same sequence” complaint and explains fixed-seed external probe ordering (e.g. Stellarium at Next #27 under seed 97).
- Domain diversity exists as “prefer unseen domain,” but there is **no** source-family / structural-type anti-clone window, and novelty-source share is not capped at selection time.

## 3. Tradeoff: literal uniform independent RNG vs fresh anti-repeat sampling

| Approach | Pros | Cons vs the owner’s goal |
| --- | --- | --- |
| **A. IID uniform RNG each Stumbl** | Maximally “random” feeling draw | High short-horizon repeats; can spam same domain/type; ignores interests; fails anti-repeat |
| **B. Fixed global seed / fixed catalogue file order** | Easy ops, easy tests | Shared predictable journey across users; fails freshness |
| **C. Preference-derived seed + weighted sort (today)** | Reproducible; topic bias | Same prefs ⇒ same sequence; still novelty-dominated if pool is |
| **D. Per-session cryptographic entropy + diversity-aware anti-repeat (recommended)** | Unpredictable per user/session; no short repeats; soft topic bias; type/source spacing; tests stay injectable | Slightly more logic; not “pure” IID; needs careful empty-pool/exhaustion UX |

**Recommendation:** **D** — randomized, diversity-aware selection without fixed category cycles, without hardcoded source order, and without a production-global seed. Prefer weighted random among **eligible** candidates after hard filters, not a pre-shuffled static tape.

## 4. Proposed selection architecture (design only)

### 4.1 Separate concerns
1. **Supply growth** (Python discovery / editorial / community review) expands the finite pool over time.
2. **Ordering / pick** (client sampler) chooses the next destination from the **current** eligible pool.
Growing supply does not by itself create freshness if ordering remains preference-seeded.

### 4.2 Entropy
- Production: per browser session (or per install) random seed from `crypto.getRandomValues` stored in local state; optional reseed on explicit “reset cycle.”
- Never derive production seed solely from topic list.
- Tests: inject RNG / fixed seed **only** via fixtures or test overrides.

### 4.3 Eligibility filters (hard)
- Status eligible for mode (evaluation vs launch pool as today).
- Not in short-history no-repeat window (IDs) while alternatives remain.
- HTTPS / not excluded / not blocked.

### 4.4 Soft diversity penalties (not fixed cycles)
Score or reject-on-draw candidates that would create:
- same domain as last N picks,
- same `sourceFamily` / structural type as last M picks (e.g. `novelty-list`, `hn-derived-index`, `museum`, `game`, `science-tool`),
- over-quota share from a single provenance source in the recent window (anti novelty-source domination).

No round-robin category wheel; no hardcoded source precedence list.

### 4.5 Interest modes (keep, but broaden)
- `topic`: weight direct topic matches heavily; if empty, honest empty/exhaustion messaging (existing).
- `adjacent`: allow adjacent topics with lower weight.
- `wildcard`: allow all eligible with mild preference for selected interests if any, still drawing broadly.

Picks remain random among the high-weight eligible set (softmax / weighted choice), not “sort then walk.”

### 4.6 Exhaustion
When no unseen eligible remain under current filters: existing recovery (`All topics`, mode change, reset seen/history) — do not secretly repeat earlier than disclosed.

## 5. Regression acceptance scenarios (proposed)

These are design acceptance criteria for a future implementation PR; not implemented in this increment.

1. **Per-user divergence:** two fresh clients with identical topic prefs and same catalogue build produce different Stumbl sequences with high probability (seed injection disabled).
2. **No short repeats:** within a window of size `min(K, poolSize)` consecutive Stumbl presses, no catalogue ID repeats while pool permits.
3. **Domain spacing:** no two consecutive picks share a domain when ≥1 alternative domain exists in eligible unseen set.
4. **Type/source spacing:** no three consecutive picks share the same `sourceFamily` when alternatives exist.
5. **Interest respect:** in `topic` mode with non-empty topics, every pick intersects selected topics until that subset is exhausted.
6. **Wildcard breadth:** in `wildcard` with selected topics, over 30 picks the sequence includes both on-topic and off-topic entries when both exist (statistical bound, not a fixed pattern).
7. **No novelty domination:** if provenance tags mark ≥40% of pool as `novelty-list`, a 20-pick window still includes ≤ ceiling share from that family when other families exist.
8. **MUST-HAVE honesty:** hackertube.org / hackerbooks.org remain documented high-priority candidates; if still frame-blocked, Stumbl rotation **must not** claim them as successful in-frame destinations; Open original / blocked handling stays honest.
9. **Test isolation:** unit/e2e with injected RNG/seed remain deterministic; production path never uses the preference-hash seed helper.
10. **Supply ≠ order:** adding new catalogue entries changes pool membership but does not reintroduce a global fixed order; sequence entropy still comes from per-session RNG + diversity rules.

## 6. Explicit non-work this increment
- No sampler rewrite or seed-helper removal in app code yet.
- No catalogue insertion of hackertube/hackerbooks as launch-approved.
- No proxy/bypass of `X-Frame-Options` / `frame-ancestors`.
- No publisher emails or ToS negotiation.
- No public launch / DNS / spend / GitHub.
- Branding corrections (Stumbl label, stacked lockup assets) may ship in parallel without expanding discovery implementation.

## 7. Open decisions for the owner
1. Accept **Open original / blocked-frame card** as the honest path for MUST-HAVEs while headers deny framing, vs hold them out of rotation entirely until headers change?
2. Confirm structural-type taxonomy fields for diversity (`sourceFamily`, etc.) ownership (editorial vs discovery pipeline).
3. Short-history window sizes (N domain, M type) defaults.
4. Whether session seed persists across reloads (recommended: yes, in local state) or reshuffles every cold start.

## 8. Related post-launch ops research (appended 2026-11-08)
The owner also asked whether a post-launch GitHub Python worker could constantly scrape into a database, and whether a DB is necessary. Parent/research answer is captured in:

`docs/superpowers/specs/2026-11-08-post-launch-discovery-ops-research.md`

Summary binding to this freshness design:
- Prefer **scheduled bounded Python batches** (GitHub Actions cron is viable but **best-effort**, not a nonstop daemon) over infinite scrapers.
- **JSON is enough** for a small approved catalogue; recommend a **small durable DB** for long-term candidates/review/community/health, with **exported** approved catalogue for the app.
- **No auto git-push** of harvested entries into the live catalogue; public OSS code stays separate from rejected/raw submissions and personal metadata.
- Open-source GitHub is a **future launch direction**, not approval to publish/mirror now; **private Origin remains source of truth** until a controlled release/license/security-audit plan is approved.
- Cloudflare **D1** is one optional store candidate (Worker binding and/or scoped proxy API; admin REST rate-limited); no secrets requested and no infra spending in this research pass.
- Supply growth (ops/DB) remains distinct from **per-user randomized diversity-aware ordering** of the finite approved pool (sections 2–5 above).
