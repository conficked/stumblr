import { CatalogueEntry } from "./types";
import { discoveredEntries } from "./discoveredEntries";

const curatedCatalogueEntries: CatalogueEntry[] = [
  {
    id: "earth-nullschool",
    title: "Earth Nullschool",
    canonicalUrl: "https://earth.nullschool.net/",
    domain: "earth.nullschool.net",
    topics: ["science", "maps", "nature"],
    description:
      "A living weather map that turns global wind and pressure models into flowing visual streams.",
    status: "evaluation_only",
    policyBasis: null,
    provenance: {
      sourceNote: "Seeded from REAbot candidate set for manual review.",
      reviewer: "agent",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Header-only precheck pending full render verification.",
      observedRenderResult: "untested",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "radio-garden",
    title: "Radio Garden",
    canonicalUrl: "https://radio.garden/",
    domain: "radio.garden",
    topics: ["music", "culture", "maps"],
    description:
      "A spinning globe for tuning into live radio stations by wandering place to place.",
    status: "blocked",
    policyBasis:
      "Quarantined from discovery: destination content explicitly states embedding is not permitted.",
    provenance: {
      sourceNote: "Seeded from REAbot candidate set for manual review.",
      reviewer: "agent",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Header checks did not indicate denial, but runtime frame content states denial.",
      observedRenderResult: "blocked",
      observedAt: "2026-11-08",
      device: "mobile-emulation",
    },
  },
  {
    id: "zoomquilt",
    title: "Zoomquilt",
    canonicalUrl: "https://zoomquilt.org/",
    domain: "zoomquilt.org",
    topics: ["art", "culture"],
    description:
      "An endlessly zooming illustrated dreamscape with surreal transitions and old-web wonder.",
    status: "evaluation_only",
    policyBasis:
      "No documented publisher permission/terms basis captured for framing approval; private evaluation only.",
    provenance: {
      sourceNote: "Independent curation and private render checks.",
      reviewer: "agent",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Sandbox probe showed content visible; qualification remains evaluation-only pending permission basis.",
      observedRenderResult: "rendered",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "patatap",
    title: "Patatap",
    canonicalUrl: "https://patatap.com/",
    domain: "patatap.com",
    topics: ["art", "music", "games"],
    description:
      "Tap keys to generate audiovisual bursts; part instrument, part abstract toy.",
    status: "evaluation_only",
    policyBasis:
      "No documented publisher permission/terms basis captured for framing approval; private evaluation only.",
    provenance: {
      sourceNote: "Independent curation and private render checks.",
      reviewer: "agent",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Sandbox probe showed content visible; qualification remains evaluation-only pending permission basis.",
      observedRenderResult: "rendered",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "little-alchemy-2",
    title: "Little Alchemy 2",
    canonicalUrl: "https://littlealchemy2.com/",
    domain: "littlealchemy2.com",
    topics: ["games", "education"],
    description: "A combinational sandbox where small elements snowball into odd discoveries.",
    status: "evaluation_only",
    policyBasis: null,
    provenance: {
      sourceNote: "Seeded from REAbot candidate set for manual review.",
      reviewer: "agent",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Header-only precheck pending full render verification.",
      observedRenderResult: "untested",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "silk",
    title: "Silk",
    canonicalUrl: "https://weavesilk.com/",
    domain: "weavesilk.com",
    topics: ["art", "culture"],
    description:
      "A meditative mirrored drawing tool with glimmering symmetry and tactile momentum.",
    status: "evaluation_only",
    policyBasis:
      "No documented publisher permission/terms basis captured for framing approval; private evaluation only.",
    provenance: {
      sourceNote: "Independent curation and private render checks.",
      reviewer: "agent",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Sandbox probe showed content visible; qualification remains evaluation-only pending permission basis.",
      observedRenderResult: "rendered",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "openstreetmap-embed",
    title: "OpenStreetMap (Embed View)",
    canonicalUrl:
      "https://www.openstreetmap.org/export/embed.html?bbox=-0.13%2C51.49%2C-0.09%2C51.52&layer=mapnik",
    domain: "www.openstreetmap.org",
    topics: ["maps", "education", "culture"],
    description:
      "An embeddable map view for browsing geographic context with attribution and zoom controls.",
    status: "evaluation_only",
    policyBasis:
      "No documented publisher permission/terms basis captured for framing approval; private evaluation only.",
    provenance: {
      sourceNote: "Independent candidate added via sandbox qualification pass.",
      reviewer: "agent",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders:
        "Sandbox probe showed visible map UI and attribution text in-frame; no denial observed during check.",
      observedRenderResult: "rendered",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "desmos-calculator",
    title: "Desmos Calculator",
    canonicalUrl: "https://www.desmos.com/calculator",
    domain: "www.desmos.com",
    topics: ["education", "science", "games"],
    description:
      "A graphing calculator interface with visible expressions and controls suitable for exploratory math.",
    status: "evaluation_only",
    policyBasis:
      "No documented publisher permission/terms basis captured for framing approval; private evaluation only.",
    provenance: {
      sourceNote: "Independent candidate added via sandbox qualification pass.",
      reviewer: "agent",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders:
        "Sandbox probe showed visible calculator UI and interactive controls in-frame; no denial observed during check.",
      observedRenderResult: "rendered",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "stellarium-web",
    title: "Stellarium Web",
    canonicalUrl: "https://stellarium-web.org/",
    domain: "stellarium-web.org",
    topics: ["science", "nature", "education"],
    description:
      "A sky exploration interface with star-map style controls and observation tools.",
    status: "evaluation_only",
    policyBasis:
      "No documented publisher permission/terms basis captured for framing approval; private evaluation only.",
    provenance: {
      sourceNote: "Independent candidate added via sandbox qualification pass.",
      reviewer: "agent",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders:
        "Sandbox probe showed visible astronomy UI with menus and map content in-frame; no denial observed during check.",
      observedRenderResult: "rendered",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "matrix-animation",
    title: "Matrix Animation",
    canonicalUrl: "https://matrix.dotglitch.dev/",
    domain: "matrix.dotglitch.dev",
    topics: ["art", "games"],
    description: "A minimalist matrix-style visual toy with configurable glitch aesthetics.",
    status: "evaluation_only",
    policyBasis:
      "Discovered from public curated list; no documented publisher permission basis for launch.",
    provenance: {
      sourceNote: "Source: awesome-canvas public link collection.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened 200 with no X-Frame-Options header.",
      observedRenderResult: "untested",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "trigonoparty",
    title: "Trigonoparty",
    canonicalUrl: "https://ramesaliyev.com/trigonoparty",
    domain: "ramesaliyev.com",
    topics: ["games", "art", "education"],
    description: "An interactive trigonometry playground with geometric motion and controls.",
    status: "evaluation_only",
    policyBasis:
      "Discovered from public curated list; no documented publisher permission basis for launch.",
    provenance: {
      sourceNote: "Source: awesome-canvas public link collection.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened 200 with no X-Frame-Options header.",
      observedRenderResult: "untested",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "coolors",
    title: "Coolors Palette Generator",
    canonicalUrl: "https://coolors.co/",
    domain: "coolors.co",
    topics: ["art", "culture"],
    description: "A fast palette generator useful for visual exploration and color studies.",
    status: "evaluation_only",
    policyBasis:
      "Discovered from public curated list; no documented publisher permission basis for launch.",
    provenance: {
      sourceNote: "Source: awesome-web-design public link collection.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened 200 with no X-Frame-Options header.",
      observedRenderResult: "untested",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "colordot",
    title: "Colordot",
    canonicalUrl: "https://color.hailpixel.com/",
    domain: "color.hailpixel.com",
    topics: ["art", "games"],
    description: "A playful color picker where motion drives hue and saturation discovery.",
    status: "evaluation_only",
    policyBasis:
      "Discovered from public curated list; no documented publisher permission basis for launch.",
    provenance: {
      sourceNote: "Source: awesome-web-design public link collection.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened 200 with no X-Frame-Options header.",
      observedRenderResult: "untested",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "brandcolors",
    title: "BrandColors",
    canonicalUrl: "https://brandcolors.net/",
    domain: "brandcolors.net",
    topics: ["culture", "art"],
    description: "A public index of brand color systems useful for design and media context.",
    status: "evaluation_only",
    policyBasis:
      "Discovered from public curated list; no documented publisher permission basis for launch.",
    provenance: {
      sourceNote: "Source: awesome-web-design public link collection.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened 200 with no X-Frame-Options header.",
      observedRenderResult: "untested",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "openculture-ithaca",
    title: "Open Culture: Homer’s Ithaca",
    canonicalUrl: "https://www.openculture.com/2026/11/was-homers-ithaca-really-an-island.html",
    domain: "www.openculture.com",
    topics: ["culture", "archives"],
    description: "A humanities-oriented long-form article from a public culture publication.",
    status: "evaluation_only",
    policyBasis:
      "Feed-discovered editorial page; no documented publisher permission basis for launch.",
    provenance: {
      sourceNote: "Source: Open Culture public RSS feed.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened 200 with no X-Frame-Options header.",
      observedRenderResult: "untested",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "archive-web-page",
    title: "ArchiveWeb.page",
    canonicalUrl: "https://webrecorder.net/archivewebpage",
    domain: "webrecorder.net",
    topics: ["archives", "education", "culture"],
    description: "A preservation-oriented web capture tool landing page and documentation hub.",
    status: "evaluation_only",
    policyBasis:
      "Discovered from public archival resources; no documented publisher permission basis for launch.",
    provenance: {
      sourceNote: "Source: awesome-web-archiving public link collection.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened 200 with no X-Frame-Options header.",
      observedRenderResult: "untested",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "wayback-machine",
    title: "Wayback Machine",
    canonicalUrl: "https://web.archive.org/",
    domain: "web.archive.org",
    topics: ["archives", "culture"],
    description: "A major public archive portal for historical snapshots of the web.",
    status: "evaluation_only",
    policyBasis:
      "Discovered from public archival resources; no documented publisher permission basis for launch.",
    provenance: {
      sourceNote: "Source: awesome-web-archiving public link collection.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened 200 with no X-Frame-Options header.",
      observedRenderResult: "untested",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "archive-org",
    title: "Internet Archive",
    canonicalUrl: "https://archive.org/",
    domain: "archive.org",
    topics: ["archives", "education", "culture"],
    description: "A large public digital library spanning books, audio, software, and web data.",
    status: "evaluation_only",
    policyBasis:
      "Discovered from public archival resources; no documented publisher permission basis for launch.",
    provenance: {
      sourceNote: "Source: awesome-web-archiving public link collection.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened 200 with no X-Frame-Options header.",
      observedRenderResult: "untested",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "nullhandle-archivability",
    title: "Web Archivability",
    canonicalUrl: "https://nullhandle.org/web-archivability/index.html",
    domain: "nullhandle.org",
    topics: ["archives", "education"],
    description: "A practical guide on making websites archivable and preservation-friendly.",
    status: "evaluation_only",
    policyBasis:
      "Discovered from public archival resources; no documented publisher permission basis for launch.",
    provenance: {
      sourceNote: "Source: awesome-web-archiving public link collection.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened 200 with no X-Frame-Options header.",
      observedRenderResult: "untested",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "netpreserve-training",
    title: "IIPC Training Materials",
    canonicalUrl: "https://netpreserve.org/web-archiving/training-materials",
    domain: "netpreserve.org",
    topics: ["archives", "education"],
    description: "An educational collection of web archiving training materials and modules.",
    status: "evaluation_only",
    policyBasis:
      "Discovered from public archival resources; no documented publisher permission basis for launch.",
    provenance: {
      sourceNote: "Source: awesome-web-archiving public link collection.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened 200 with no X-Frame-Options header.",
      observedRenderResult: "untested",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "archives-unleashed-toolkit",
    title: "Archives Unleashed Toolkit",
    canonicalUrl: "https://aut.docs.archivesunleashed.org/",
    domain: "aut.docs.archivesunleashed.org",
    topics: ["archives", "education", "science"],
    description: "Open-source toolkit docs for analysis of archived web collections.",
    status: "evaluation_only",
    policyBasis:
      "Discovered from public archival resources; no documented publisher permission basis for launch.",
    provenance: {
      sourceNote: "Source: awesome-web-archiving public link collection.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened 200 with no X-Frame-Options header.",
      observedRenderResult: "untested",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "bellingcat-auto-archiver",
    title: "Bellingcat Auto Archiver",
    canonicalUrl:
      "https://www.bellingcat.com/resources/2022/09/22/preserve-vital-online-content-with-bellingcats-auto-archiver-tool",
    domain: "www.bellingcat.com",
    topics: ["archives", "culture"],
    description: "An OSINT-focused guide for preserving online material in volatile contexts.",
    status: "evaluation_only",
    policyBasis:
      "Discovered from public archival resources; no documented publisher permission basis for launch.",
    provenance: {
      sourceNote: "Source: awesome-web-archiving public link collection.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened 200 with no X-Frame-Options header.",
      observedRenderResult: "blocked",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "nasa-apod-fireball",
    title: "NASA APOD: Major Fireball Meteor",
    canonicalUrl: "https://science.nasa.gov/image-article/apod-2026-november-8-major-fireball-meteor",
    domain: "science.nasa.gov",
    topics: ["science", "nature"],
    description: "NASA astronomy image article documenting a major fireball meteor event.",
    status: "blocked",
    policyBasis: "Quarantined from discovery due explicit X-Frame-Options SAMEORIGIN policy.",
    provenance: {
      sourceNote: "Source: NASA public RSS feed.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened response includes X-Frame-Options: SAMEORIGIN.",
      observedRenderResult: "blocked",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "public-domain-review-marian",
    title: "Public Domain Review Collection",
    canonicalUrl: "https://publicdomainreview.org/collection/marian-wawrzeniecki",
    domain: "publicdomainreview.org",
    topics: ["archives", "culture", "art"],
    description: "A curated public-domain collection page from a cultural archive publication.",
    status: "blocked",
    policyBasis: "Quarantined from discovery due explicit X-Frame-Options DENY policy.",
    provenance: {
      sourceNote: "Source: Public Domain Review RSS feed.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened response includes X-Frame-Options: DENY.",
      observedRenderResult: "blocked",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "wikimedia-diff-article",
    title: "Wikimedia Diff Article",
    canonicalUrl:
      "https://diff.wikimedia.org/2026/11/08/enthusiasm-was-never-the-problem-the-case-of-western-armenian-wikipedia",
    domain: "diff.wikimedia.org",
    topics: ["culture", "archives"],
    description: "A Wikimedia community article from the Diff publication feed.",
    status: "blocked",
    policyBasis: "Quarantined from discovery due explicit X-Frame-Options SAMEORIGIN policy.",
    provenance: {
      sourceNote: "Source: Wikimedia Diff public RSS feed.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened response includes X-Frame-Options: SAMEORIGIN.",
      observedRenderResult: "blocked",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
  {
    id: "community-archive",
    title: "Community Archive",
    canonicalUrl: "https://www.community-archive.org/",
    domain: "www.community-archive.org",
    topics: ["archives", "culture"],
    description: "A community-centric digital archive project and participation portal.",
    status: "blocked",
    policyBasis: "Quarantined from discovery due explicit X-Frame-Options DENY policy.",
    provenance: {
      sourceNote: "Source: awesome-web-archiving public link collection.",
      reviewer: "nova",
      reviewedAt: "2026-11-08",
    },
    embedEvidence: {
      observedHeaders: "Screened response includes X-Frame-Options: DENY.",
      observedRenderResult: "blocked",
      observedAt: "2026-11-08",
      device: "desktop",
    },
  },
];

export const catalogueEntries: CatalogueEntry[] = [
  ...curatedCatalogueEntries,
  ...discoveredEntries,
];
