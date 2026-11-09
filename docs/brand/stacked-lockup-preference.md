# Preferred stacked brand lockup (design handoff)

Recorded 2026-11-08 from the owner’s direction + supplied asset pack + old StumbleUpon **layout** reference (structure only). Corrected preview proportions use **opaque artwork bounds**, not SVG canvas boxes.

## Preferred composition
- **Own** orange circular symbol SVG centered **above**
- **Own** black `stumblr.dev` wordmark SVG
- Clean centered lockup on white / light backing
- Circle visual width ≈ **0.75×** wordmark visual width (measured alpha bounds)
- Tight vertical gap between symbol and wordmark (reference-like; ~5–6% of circle art width)
- Reasonable outer padding; **no** developer caption baked into artwork exports
- No StumbleUpon logo, lettering, “su” monogram, or asset reuse

## Delivered preview assets
- `public/brand/stumblr-stacked-lockup.svg` — clean stacked SVG (no caption)
- `public/brand/stumblr-stacked-lockup.png` — transparent PNG
- `public/brand/stumblr-stacked-lockup@2x.png` — 2× transparent PNG
- `public/brand/stumblr-stacked-lockup-review.png` — white-backed screenshot for parent review
- `public/brand/stumblr-stacked-lockup.measurements.json` — measured art bounds / ratio / gap / padding

### Measured export (opaque bounds)
- Circle art width: **480px**
- Wordmark art width: **640px**
- Ratio: **0.75**
- Gap: **26px**
- Padding: **51px**
- Canvas: **742×695** (1× PNG)

## Where it belongs
- Welcome / about / branding surfaces
- **Not** an enormous active-exploration header
- Live discovery toolbar must stay compact; destination iframe keeps majority viewport

## Toolbar rule (current engineering)
- Charcoal exploration bar: **symbol-only** (orange monogram roundel)
- Do **not** place the black wordmark on charcoal (illegible per asset README / contact sheet)
- Black wordmark only on light/white backing when a branding surface is designed later

## Assets already staged
- `public/brand/` — faithful SVG/PNG/WebP/favicons + contact sheet + verification notes + stacked lockup pack
- `public/favicon.ico`, `public/favicon.svg`, `public/apple-touch-icon.png`
- Source guidance: `public/brand/README.md`

## Explicit non-work for this note
- No broad page redesign / welcome-page redesign in this pass
- No live toolbar lockup swap; compact symbol toolbar preserved
- No glyph shape changes
- No imitation of StumbleUpon proprietary artwork
- Layout reference was provided in chat as stacked symbol-above-wordmark precedent; opaque-bound ratio correction supersedes the earlier ~70/240 (~0.29) canvas-sized preview mistake
