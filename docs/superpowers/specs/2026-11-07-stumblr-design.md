# Stumblr MVP Design Spec

## 1. Product intent
Stumblr is a guest-first, modern web discovery experience that keeps the user inside one persistent exploration surface while rotating through a curated set of embeddable public sites. It emphasizes strange, overlooked, scholarly, and civic-print flavored parts of the web without copying StumbleUpon or Cloudhiker assets, branding, or catalogues.

This spec defines one bounded MVP slice suitable for private draft evaluation.

## 2. Goals and non-goals
### Goals
- Instant exploration with no signup gate.
- Persistent in-app controls while destinations load in an embedded host.
- Equal desktop/mobile core loop with top controls (desktop) and bottom dock (mobile).
- Deterministic no-repeat sampler (until pool exhaustion) with topic, adjacent, and wildcard behavior.
- Explicitly separate actions: `Stumbl` (neutral next destination), `Not for me`, and `Save`.
- Local history, local saves, local reports/broken-site feedback with truthful labels.
- Honest catalogue curation state and eligibility evidence.

### Non-goals (MVP)
- No accounts, social graph, recommendations ML, or analytics pipeline.
- No backend moderation queue or publisher outreach automation.
- No arbitrary public URL proxy/fetch endpoint.
- No claim of universal iframe compatibility.
- No launch-readiness claim from emulator-only evidence.

## 3. Core user experience
### Primary loop
1. User lands on Stumblr and can immediately press `Stumbl`.
2. Stumblr selects a catalogue entry via deterministic sampler.
3. Destination loads in iframe host area with resilient loading/error states.
4. User can:
   - `Stumbl`: neutral skip / next destination.
   - `Not for me`: explicit negative preference signal in local state.
   - `Save`: local bookmark only; never interpreted as like/positive for ranking.
5. User can open `History` and `Saves` drawers to revisit/remove/export/reset local records.

### Interest model
- Optional topic interests.
- If none selected: full pool available.
- Sampler modes:
  - `topic`: weighted to selected topics.
  - `adjacent`: includes nearby topics and partial overlap.
  - `wildcard`: broad pool injection for serendipity.

### Mobile ergonomics
- Bottom dock for thumb reach, safe-area aware.
- Controls remain usable with virtual keyboard/viewport shifts.
- Minimum touch target size 44px.

## 4. Visual and brand direction
- Original identity: deep ink + parchment + oxidized teal + rust accents.
- Small engraved/mythological details in chrome and drawers only.
- Destination content receives dominant screen area.
- Typography uses clear capitalization and readable contrast.
- Motion is subtle and reduced-motion aware.
- Avoid generic dashboard hero/card-grid as primary journey.

## 5. Technical architecture (MVP)
### Stack
- Next.js (App Router), TypeScript, React.
- Tailwind CSS for styling.
- shadcn/ui for core controls/drawers/forms.
- Vitest + Testing Library for unit/component behavior.
- Playwright for smoke/integration at desktop/mobile emulation.

### Modules
- `catalogue/`: typed catalogue entries + review metadata + status.
- `sampler/`: deterministic selection engine with no-repeat and diversity constraints.
- `storage/`: versioned local persistence wrapper (safe parse/fallback/migration).
- `frame-host/`: iframe sandbox/policy + loading/error/exhaustion state orchestration.
- `feedback/`: local report capture and visibility.
- `ui/`: desktop top controls, mobile dock, history/saves/preferences/report drawers.

## 6. Data model (MVP)
### Catalogue entry
- `id`, `title`, `canonicalUrl`, `domain`, `topics[]`, `description`
- `status`: `launch_approved | evaluation_only | blocked | unverified`
- `provenance`: `sourceNote`, `reviewer`, `reviewedAt`
- `embedEvidence`: observed headers + observed render result + timestamp + device note
- `policyBasis`: terms/permission notes when known (nullable)

### Local user data
- Preferences: selected topics, sampler mode default, reduced-motion preference override.
- Session state: recent shown IDs/domains, negative feedback IDs.
- Saves/history: timestamped records with catalogue ID and canonical URL snapshot.
- Reports: local-only records labeled as local unless moderation endpoint exists.

## 7. Security and privacy boundaries
- Only `https://` catalogue URLs accepted.
- No arbitrary user URL input for loading in iframe.
- Respect publisher X-Frame-Options/CSP; do not bypass via proxy rewriting.
- Strict iframe `sandbox` and Permissions Policy baseline:
  - no camera/mic/geolocation/payment by default
  - no top navigation/popup escape unless explicitly and narrowly allowed.
- App CSP frame allowlist restricted to reviewed domains.
- Local storage only for preferences/history/saves/reports; no backend per-Next telemetry.
- Clear notice: destination sites may independently track visitors.

## 8. Reliability and state handling requirements
- Loading, timeout, blocked, error, empty-pool, and exhausted-pool states are explicit.
- `Stumbl` remains usable during in-flight load and cancels stale state updates.
- Race-safe request tokening to prevent old loads clobbering new selection.
- Iframe cleanup on transition to avoid leaked content/state.
- Do not treat iframe `onLoad` as guaranteed successful destination render.
- Show loaded catalogue domain and message that internal cross-origin navigation/deep URL cannot be guaranteed.

## 9. Catalogue strategy for MVP
- Include small independently-sourced pool with honest status labels.
- Seed evaluation candidates based on provided list as `evaluation_only` until validated.
- Maintain launch-approved subset for default production-like mode.
- Add admin-facing private evaluation view to inspect non-approved entries.
- Provide manual review manifest process; no always-on scheduler required.

## 10. Testing strategy
- Unit tests:
  - deterministic sampler, no-repeat logic, exhaustion behavior, topic filtering.
  - local storage parse/migration/corruption handling.
  - URL safety validation and status labeling.
- Component tests:
  - controls behavior, drawer interactions, state transitions.
  - race handling for rapid `Stumbl` spam.
- Playwright:
  - desktop and mobile viewport smoke.
  - loading/error/blocked states using deterministic local fixtures.
  - save/history export/reset loop.
- External verification run:
  - manually attempt rendering several real candidates and record observed results.
  - treat header checks as supportive, not sufficient.

## 11. Key tradeoffs
- Curated embeddable pool over arbitrary-web guarantee for safety and UX integrity.
- Local-only reports in MVP over fake moderation pipeline.
- Deterministic rule-based discovery over opaque recommendation algorithm.
- Smaller qualified catalogue with higher confidence over inflated but unreliable pool size.

## 12. Known MVP limitations
- No real-device iOS/Android proof yet (emulation only).
- No publisher permission workflow completion for broad public release.
- No account sync across devices.
- iframe-hosted destinations remain constrained by publisher framing policies.

## 13. Public launch gates (not part of this private draft milestone)
- Real phone testing (iOS + Android) for dock/input/viewport behavior.
- Expanded publisher-qualified launch-approved catalogue and review evidence.
- Legal/name/domain/trademark clearance for "Stumblr" and `stumblr.org`.
- Moderation and abuse process decision if/when public reporting is server-backed.
- Security review of CSP/frame allowlist and sandbox exceptions before production.

## 14. 2026-11-08 redesign rationale (Hallmark-informed)
The owner rejected the previous look as generic and requested a StumbleUpon-inspired utility aesthetic without copying branding/assets/layout verbatim. This addendum overrides the prior scholarly/civic-print direction.

### Guidance sources reviewed
- `https://github.com/Nutlope/hallmark` README at commit `407fa689f4a276f2fd389208d271d0fef08f5058`
- `/tmp/hallmark/skills/hallmark/SKILL.md` (same commit)
- `/tmp/hallmark/skills/hallmark/references/direction.md` (same commit)
- `/tmp/hallmark/skills/hallmark/references/gates.md` (same commit)

### Principles applied to this redesign
- **Task-first UI, not decorative framing:** the destination and primary action must dominate screen utility (Hallmark emphasis on “built from the job” and avoiding template anatomy).
- **No AI-tell chrome patterns:** remove eyebrow-like labels, oversized ornamental hero/card stacks, and repetitive dashboard framing.
- **Compact action posture:** concise desktop toolbar and compact mobile dock with clear primary action hierarchy.
- **Copy and control restraint:** standard capitalization, practical wording, avoid decorative punctuation/tells.
- **Viewport discipline:** first screen keeps core action and context visible without large intro block.

### Stumblr-specific interpretation
- Keep original Stumblr identity and playful utility tone (early social-web charm), but avoid direct StumbleUpon cloning.
- Frame host is the product center; controls should feel like browser utility chrome.
- Mobile uses drawer-driven secondary controls to prevent duplicate heavy rows and viewport waste.
- Preserve all current functional/security guardrails unchanged.

## 15. 2026-11-08 catalogue discovery milestone decisions
- Curation ownership remains with Nova (no manual per-site approval queue for the owner in private draft).
- Add a reproducible, bounded Python discovery/screening tool that:
  - ingests from documented public link collections/permitted feeds only,
  - performs URL safety validation (https-only, no private/reserved/local targets after DNS resolution),
  - canonicalizes and deduplicates candidates,
  - records provenance, basic metadata, availability, redirect chain, and framing-policy headers.
- Keep evidence split into separate artifacts:
  - discovered candidates,
  - screened candidates,
  - editorially selected shortlist,
  - rejected/quarantined log with explicit reasons.
- Preserve strict honesty boundaries:
  - technical embeddability is not publisher permission,
  - missing XFO/CSP headers are never treated as approval,
  - uncertain entries remain `evaluation_only`,
  - explicit denials are `blocked`.
- Extend production-frame verification to measure:
  - absolute iframe/viewport occupancy,
  - candidate interaction proof quality,
  - consecutive discovery soak outcomes and failure causes.

## 16. 2026-11-08 category + community sourcing increment decisions
- Add a clearer persistent category control surface in toolbar/mobile flow:
  - explicit `All topics` reset,
  - explicit sampler mode controls (`topic`, `adjacent`, `wildcard`),
  - fast path into multi-interest selector without relying on deep drawer navigation.
- Keep category behavior honest:
  - selected interests and mode are guest-local and persisted,
  - exhaustion/empty outcomes explain how to recover (`All topics`, mode change, evaluation pool).
- Implement community URL suggestion intake as pending-review queue:
  - suggestions are validated/canonicalized and deduped before queueing,
  - pending submissions are not auto-published into discovery rotation,
  - private-draft storage is VM-local and bounded, not global production durability.
- Submission safety boundaries:
  - strict URL validation (`https` only),
  - reject local/private/reserved hosts,
  - rate-limit submissions per client identifier,
  - no synchronous fetch/probe of submitted URLs on submit path.


## 17. 2026-11-08 Useless Web / Bored Button source leads + launch prep
- Add documented public source leads:
  - The Useless Web (`https://theuselessweb.com/sites/` + Atom index)
  - Bored Button official host `https://www.boredbutton.com/` with `/random` sampling lead
- Directory inclusion is provenance only; never publisher permission.
- Keep Stumblr category-aware shuffled no-repeat sampler; do not adopt canned-list behavior.
- Community suggestions remain pending-review with honest VM durability labeling.
- `stumblr.dev` ownership enables private launch prep docs only; no DNS/public deploy in this milestone.

## 18. 2026-11-08 discovery freshness + post-launch ops research pointers
- Freshness / anti-repeat / MUST-HAVE candidate probes (hackertube.org, hackerbooks.org frame-blocked): `docs/superpowers/specs/2026-11-08-discovery-freshness-and-must-have-candidates.md`
- Post-launch GitHub Actions scheduled Python vs dedicated cron, JSON vs DB, optional Cloudflare D1, OSS release gate: `docs/superpowers/specs/2026-11-08-post-launch-discovery-ops-research.md`
- Vast multi-family procurement (reuse existing Python pipeline; webrings/indie/search/museums; hypothesized vs measured): `docs/superpowers/specs/2026-11-08-vast-discovery-procurement-research.md`
- Research/design only in that increment: no GitHub publication, no continuous scraper, no production DB writes, private Origin remains SoT.
