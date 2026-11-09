# Vast discovery procurement research (design only)

Recorded 2026-11-08 from the owner’s ask: consistently procure vast obscure multi-category destinations after launch with Python automation — **research/design only**.

**Not claimed / not done this increment:** new running service, production scheduler, expanded catalogue publish, GitHub mirror, DNS, deploy, spend, credentials/signup/paid search, large crawl, or “script running after launch.”

**Source of truth:** private Origin repo. Related:
- Freshness sampler / MUST-HAVEs: `2026-11-08-discovery-freshness-and-must-have-candidates.md`
- Actions vs cron / JSON vs DB / D1 / OSS gate: `2026-11-08-post-launch-discovery-ops-research.md`

---

## Parent-facing verdict (read this first)

The owner’s “constantly scraping in the background” goal maps to **scheduled, resumable, bounded Python batches** that grow a **private candidate store**, not an infinite daemon and not auto-merging into the live app catalogue.

**Reuse** `scripts/discover_catalogue_candidates.py` (+ `generate_discovered_catalogue_ts.py`) as the batch brain. Extend source families beyond novelty lists, add `source_family` balancing, harden redirect/DNS checks, and hang the same CLI off a scheduler.

**Recommended production shape:** Option **A** (or **C** hybrid) below — bounded cron/Actions job → durable queue/checkpoints → human/automation review → **export approved catalogue** into the app. Keep novelty sources capped. Deterministic Python fetch/screen stays free of AI; AI editorial is optional and separate.

---

## 1. Existing Python pipeline — what to reuse

| Piece | Location / behavior | Keep / extend |
| --- | --- | --- |
| Documented leads | `SOURCE_CONFIG` (feeds, HTML, markdown, Bored Button `random_html`) | Add diverse families + `source_family` tag |
| Bounds | `REQUEST_TIMEOUT_S=8`, `MAX_SOURCE_BYTES`, `MAX_CANDIDATES=220`, per-source link caps, random-fetch delay | Keep; never remove caps for “continuous” |
| HTTPS-only canonicalize | `canonicalize_url` | Keep |
| Domain denylist | GitHub/social/CDN noise hosts | Keep; expand carefully |
| DNS public-IP check | `resolve_public_ip` before accept | Keep; **extend to every redirect hop** (gap today: initial host checked; `urlopen` may follow redirects — design must re-resolve `final_url` / hop chain) |
| Provenance | `Candidate` dataclass (`source_id`, `source_url`, `discovered_at`, …) | Keep immutable |
| Screening | `screen_url` → status, XFO, CSP, title hint | Keep; record ≠ permission |
| Yield counters | `source_yields` per source | Extend with family/topic underrepresentation metrics |
| Artifacts | JSON under `docs/catalogue` + TS generator | Approved export only; no auto git-push of raw harvests |

Deterministic Python runtime for fetch/parse/screen. **No AI bot cron per scrape.** Optional AI editorial (later, costed separately) only on shortlisted rows.

---

## 2. Diverse source families — hypothesized vs measured

Legend: **H** hypothesized · **M** measured this research (bounded curl/read-only) · **Q** still needs full qualification (robots/ToS/framing/editorial).

### 2.1 Measured leads (this pass)

| Family | Source URL(s) | Measured | Extraction note |
| --- | --- | --- | --- |
| Indie directories | `https://personalsit.es/` | **M** 200; ~9k URL-like / ~1200 hosts | High yield; needs NSFW/quality filters + budgets |
| Webrings | `https://webring.xxiivv.com/`, `https://fediring.net/`, `https://hotlinewebring.club/` | **M** 200; hundreds of external hosts each | Excellent member-list HTML; ring etiquette; still not frame OK |
| Indie search API | `https://wiby.me/json/?q=…` | **M** JSON 200; ToS requires linking wiby.me | Query batches; attribution; lead-gen not dump |
| Indie search UX | `https://search.marginalia.nu/` | **M** 200; landing low outbound | Don’t scrape results until API/docs path clear |
| Neocities browse | `https://neocities.org/browse` | **M** 200; ~100 hosts; `/api/list` **403** | HTML sample only; no credentials requested |
| Web directory | `https://curlie.org/` | **M** robots **Crawl-delay: 1000** | Skip aggressive harvest |
| Creative coding | `https://p5js.org/examples/` | **M** 200; OpenProcessing browse **403** | Prefer first-party indexes |
| Science tools | Desmos, Stellarium, GeoGebra materials | **M** 200 | Category fill; not obscurity alone |
| Museums | V&A collections **M** 200; MoMA **403**; Met HTML **429**; Met collection API **M** 200 | Prefer documented APIs; object IDs ≠ embeddable destinations until page+headers checked |
| Open cultural API | Europeana demo search `api.europeana.eu` | **M** 200 | API key demo path — production key policy **unknown**; no signup this pass |
| Archives / feeds | IA blog feed, NASA APOD RSS | **M** 200 | Good provenance; many on-domain links |
| Community feeds | `https://hnrss.org/newest`, `https://lobste.rs/rss` | **M** 200 | Skews GitHub/tech; denylist + family caps |
| Tilde / pubnix | `https://tildeverse.org/` | **M** 200; ~39 hosts | Good indie/obscure flavor |
| Educational | MIT OCW **M** 200; NRICH **M** 200; Exploratorium **M** 200; Khan exercises shell **M** 200 low links; Smithsonian Open Access **403** | Prefer stable open indexes/APIs over JS shells |
| Obscure/indie games | Godot asset lib **M** 200 (GitHub-heavy); Scratch explore **M** thin shell; Philome **M** thin; freearcade **M** 200 Wix-heavy | Treat as **H→weak M**; need better curated game-demo indexes before counting on yield |
| Common Crawl index UI | `https://index.commoncrawl.org/` | **M** 200 | Meta-index; not a destination catalogue; out of scope for direct Stumbl URLs |
| Awesome lists | already in pipeline; selfhosted raw **M** huge but GitHub-dominated | Cap + denylist |

### 2.2 Still hypothesized (not validated here)

Multilingual personal-site directories, additional museum SPARQL/APIs, academic interactive demo portals, non-English webrings, FLOSS game jam permanent demos. Mark **unknown** until bounded probes exist.

### 2.3 Qualification stages (do not collapse)

1. Lead documented (URL, family, why)  
2. Access probe (HTTPS, status, robots)  
3. Extraction feasibility (selectors/API, host diversity)  
4. Safety (SSRF incl. **redirect hop DNS**, size/time, content-type)  
5. Screen (availability, XFO / `frame-ancestors`)  
6. Editorial shortlist (topic, obscurity, anti-clone feel)  
7. Approved export → app catalogue  

**Technical embeddability never implies publisher permission.** Missing headers ≠ approval. Community suggestions stay pending-review (poison control).

---

## 3. Balancing & safety recommendations

| Concern | Recommendation |
| --- | --- |
| Source/category balance | Persist per-family and per-topic yield; scheduler prefers **underrepresented** families/topics |
| Novelty domination | Hard cap share of `novelty-list` / Bored Button–like sources in approved pool **and** recent Stumbl window |
| Dedupe | Canonical URL + registrable domain; optional fuzzy title |
| Provenance | Immutable source fields + evidence artifact path |
| Multilingual | Keep non-English candidates; don’t drop for English-only NLP failure |
| Poisoned submissions | Never auto-rotate; quarantine + rate limits |
| SSRF | HTTPS only; resolve DNS on **each** redirect hop; block private/reserved/link-local |
| Budgets | Existing caps + backoff on 429/403; honor robots (Curlie ⇒ avoid) |
| Stale / quarantine | Periodic re-screen; store reason; re-check MUST-HAVEs when headers change |

---

## 4. Production Python execution options (2–3)

Compatible with likely hosting and **private Origin as current SoT** (public GitHub only after separate release plan — see ops doc).

| Option | Trigger | Store | Pros | Cons |
| --- | --- | --- | --- | --- |
| **A. Scheduled bounded batches (recommended)** | GitHub Actions `schedule` *after* OSS release plan **or** private host cron calling same CLI now | Checkpoint file / small DB (candidates, review, health) | Resumable; overlap-safe; showcases automation; matches “background” *without* infinite loop | Actions: best-effort timing, 5‑min min interval, public 60‑day inactivity disable, fork schedules off — see [GitHub `schedule` docs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) |
| **B. Dedicated always-on worker loop** | Supervised process `while true` | Same DB | Feels “constant” | Fragile; harder overlap control; easy to violate budgets/robots; **not recommended** as primary |
| **C. Hybrid** | External/cron tick or Actions → `workflow_dispatch` / HTTP → **same** `discover_catalogue_candidates.py --batch` | Shared durable queue + lease row | One codebase; private reliability + optional public OSS narrative | Slightly more wiring |

**Recommend A (private cron today / Actions later) or C; reject fragile infinite B.**  
Always: durable checkpoints, lease/concurrency overlap prevention, monitor source yield + category diversity + failures.

**Honest automation evidence (not a dashboard):** last successful run ISO time; counts discovered / screened / shortlisted / approved / quarantined; top failure reasons; per-family yield. Emit as job log + one JSON summary artifact.

**Costs:** GitHub public standard hosted runners documented free for Actions usage; private repos use plan minutes ([billing docs](https://docs.github.com/en/actions/concepts/billing-and-usage)) — **exact $ unknown** until the owner’s plan confirmed. Cloudflare D1 optional — pricing snapshot in ops doc; **no spend authorized**. Host cron cost **unknown** until host chosen.

---

## 5. Proposed architecture sketch

```
[ Scheduler: private cron now | Actions schedule after OSS plan | hybrid tick ]
        │
        ▼
scripts/discover_catalogue_candidates.py  (bounded batch, family-aware)
        │
        ├─► durable candidates/review/health store (JSON files early → small DB later)
        │      raw/rejected stay private even if app is OSS
        │
        ├─► editorial gate (human; optional AI later, not required)
        │
        └─► export approved catalogue artifact → app build
                 sampler = per-user random + diversity (freshness spec)
```

Supply growth ≠ randomized ordering. Vast procurement fills the pool; freshness design governs Stumbl picks.

---

## 6. Open decisions for the owner / parent (before implementation)

1. Prioritize first non-novelty families? **Recommendation:** webrings + personalsit.es + Wiby query batches + tildeverse + lobsters/HN with caps.  
2. Novelty-family max share in approved pool (e.g. 15–25%)?  
3. Private cron **now** vs wait for GitHub OSS release plan for Actions?  
4. JSON artifacts vs small DB timing (D1 candidate optional)?  
5. Wiby attribution / Europeana API key policy before deeper use?  
6. Confirm Reddit out-of-scope until ToS-safe path exists?

---

## 7. Non-work checklist

- [x] Research notes saved to private repo  
- [ ] No new running service / production scheduler  
- [ ] No catalogue expansion implementation this increment  
- [ ] No publish/deploy/DNS/GitHub/spend  
- [ ] No claim that background scraping is running post-launch  
