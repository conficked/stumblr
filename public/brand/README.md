# Stumblr supplied-brand web assets

Faithful raster contour traces, not a font recreation or a redesigned logo. Letterforms, spacing, irregular roundel contour, and interior white monogram follow the supplied images. All SVG artwork consists of paths with fixed fills, with no raster images, fonts, external links, scripts, or background rectangle.

## Use
- `stumblr-symbol.svg`: preferred scalable symbol; transparent outside, white monogram stays white (not punched through). The monogram counter exposes orange, not transparency.
- `stumblr-wordmark.svg`: preferred wordmark; transparent background and transparent letter counters, black letters and orange dot. Use on a light surface. The dark proof deliberately shows the existing black wordmark losing contrast: no unauthorized white/dark-mode redesign is included.
- Symbol PNGs: 512, 192, 180, 32, 16 px, transparent RGBA.
- Wordmark PNG and lossless WebP: 500 px wide (1x), 1000 px wide (2x). Suggested CSS width 500px max, height auto; the 1000px export is 2x for that display width. SVG is preferable at other sizes.
- `favicon.svg`, `favicon.ico` (16/32/48/64/128/256 px).
- Example HTML: `<link rel="icon" href="/favicon.svg" type="image/svg+xml">`, `<link rel="icon" href="/favicon.ico" sizes="any">`, `<link rel="apple-touch-icon" href="/stumblr-symbol-180.png">`.
- `contact-sheet.png`: compact source/trace and light/dark toolbar proof. `proof-*-source-size-*.png` show the cropped traces rendered at source-coordinate resolution on checkerboards. Proofs are opaque inspection images, not production logo assets.
- Stacked lockup (symbol above wordmark): `stumblr-stacked-lockup.svg`, transparent `stumblr-stacked-lockup.png` / `@2x.png`, white review `stumblr-stacked-lockup-review.png`, and `stumblr-stacked-lockup.measurements.json`. Composition sizes by **opaque artwork bounds** so the circle is ≈0.75× the wordmark width, with a tight gap and padding. No developer caption in the artwork. Branding surfaces only — not the live charcoal toolbar.

## Source and crop
Actual decoded source dimensions: symbol PNG 1254 x 1254, wordmark JPEG 1455 x 724. Supplied chat thumbnails may have different dimensions. Symbol SVG viewBox `6.5 10 1225 1225`; wordmark SVG viewBox `8 253 1419 204`. Roughly 12 source pixels of padding around symbol and 8 around wordmark remove the large white canvas without clipping contours. Scaling changes apparent padding proportionally.

## Palette and approximation
Flat orange `#e6350b` (230,53,11), opaque white `#ffffff`, black `#000000`. Orange is the per-channel median of the source symbol's interior orange region after five-pixel mask erosion. This replaces source color variation with a coherent flat web color; it is a sampled approximation, not an official brand specification. The JPEG dot's own sampled median was approximately `#d94a27`; the exported dot intentionally uses the shared symbol orange. No gradient or JPEG texture retained.

Masks use color/brightness separation, reject tiny disconnected speckles, and apply subpixel-scale smoothing before local VTracer short-segment spline tracing. Boundaries are traced approximations, not recovered original vector masters; minor edge differences and raster antialiasing changes remain. Nothing was retyped or replaced with a lookalike font.

## Verification and limitations
See `verification.json` for source-coordinate binary-mask intersection-over-union (IoU): roundel 99.62%, white monogram 99.60%, combined wordmark silhouette 98.40%. These compare vector renders to thresholded source masks, not subjective fidelity scores. Visual inspection of contact sheet and source-size wordmark proof confirms recognizable supplied forms, open b/d/e counters, orange icon counter, white monogram, and removed outer background. Tiny raster noise is excluded.

16px version is supplied for compatibility, but the two-letter monogram loses detail there. Prefer at least 32px for brand recognition. No special small-size redraw was introduced. Black wordmark is not legible on dark backgrounds; place it on a light surface. Apple touch icon is transparent as requested; platforms may add their own backing.

Assets only: no repository edits, deployment, publication, or trademark/legal clearance implied.
