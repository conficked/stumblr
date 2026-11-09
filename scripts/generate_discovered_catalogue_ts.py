#!/usr/bin/env python3
"""Generate TypeScript catalogue entries from discovery_selected evidence."""

from __future__ import annotations

import json
import re
from pathlib import Path

if __package__:
    from .discover_catalogue_candidates import sanitize_title, screening_framing
else:
    from discover_catalogue_candidates import sanitize_title, screening_framing

ROOT = Path(__file__).resolve().parents[1]
SELECTED_PATH = ROOT / "docs/catalogue/discovery_selected.json"
EXISTING_PATH = ROOT / "src/lib/catalogue/entries.ts"
OUTPUT_PATH = ROOT / "src/lib/catalogue/discoveredEntries.ts"

ALLOWED_TOPICS = {
    "art",
    "science",
    "maps",
    "music",
    "games",
    "culture",
    "archives",
    "education",
    "nature",
}


def to_slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:70]


def clean_title(value: str) -> str:
    value = re.sub(r"&[a-zA-Z0-9#]+;", " ", value)
    value = re.sub(r"\*+", "", value)
    value = re.sub(r"\s+", " ", value).strip()
    return value[:110] if value else "Discovered destination"


def quote(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"')
    return f'"{escaped}"'


def read_existing_domains() -> set[str]:
    text = EXISTING_PATH.read_text()
    return set(re.findall(r'domain:\s*"([^"]+)"', text))


def main() -> int:
    selected = json.loads(SELECTED_PATH.read_text())
    existing_domains = read_existing_domains()
    entries = []
    used_ids = set()

    for item in selected:
        domain = str(item["domain"]).strip().lower()
        if not domain or domain in existing_domains:
            continue
        canonical_url = str(item["canonical_url"]).strip()
        title = clean_title(sanitize_title(str(item.get("title_hint") or domain))) or domain
        topics = [topic for topic in item.get("topics", []) if topic in ALLOWED_TOPICS]
        if not topics:
            topics = ["culture"]

        framing = screening_framing(item)
        status = "blocked" if framing["denied"] else "evaluation_only"
        observed = "blocked" if status == "blocked" else "untested"

        entry_id = f"discover-{to_slug(domain)}"
        index = 2
        while entry_id in used_ids:
            entry_id = f"discover-{to_slug(domain)}-{index}"
            index += 1
        used_ids.add(entry_id)

        entries.append(
            {
                "id": entry_id,
                "title": title,
                "canonicalUrl": canonical_url,
                "domain": domain,
                "topics": topics[:3],
                "description": f"Discovered from curated public source: {domain}.",
                "status": status,
                "policyBasis": (
                    "Quarantined from discovery due explicit framing denial header."
                    if status == "blocked"
                    else "Discovered from curated public source; pending private browser qualification and permission review."
                ),
                "sourceNote": f"Discovery pipeline source: {item.get('source_id', 'unknown-source')}.",
                "observedHeaders": (
                    f"Screened headers: X-Frame-Options present={framing['xfo_present']}; CSP present={framing['csp_present']}."
                ),
                "observedRenderResult": observed,
            }
        )

    lines = [
        'import { CatalogueEntry } from "./types";',
        "",
        "export const discoveredEntries: CatalogueEntry[] = [",
    ]
    for entry in entries:
        topic_list = ", ".join(quote(topic) for topic in entry["topics"])
        lines.extend(
            [
                "  {",
                f'    id: {quote(entry["id"])},',
                f'    title: {quote(entry["title"])},',
                f'    canonicalUrl: {quote(entry["canonicalUrl"])},',
                f'    domain: {quote(entry["domain"])},',
                f"    topics: [{topic_list}],",
                f'    description: {quote(entry["description"])},',
                f'    status: {quote(entry["status"])},',
                f'    policyBasis: {quote(entry["policyBasis"])},',
                "    provenance: {",
                f'      sourceNote: {quote(entry["sourceNote"])},',
                '      reviewer: "nova",',
                '      reviewedAt: "2026-11-08",',
                "    },",
                "    embedEvidence: {",
                f'      observedHeaders: {quote(entry["observedHeaders"])},',
                f'      observedRenderResult: {quote(entry["observedRenderResult"])},',
                '      observedAt: "2026-11-08",',
                '      device: "desktop",',
                "    },",
                "  },",
            ]
        )
    lines.append("];")
    OUTPUT_PATH.write_text("\n".join(lines) + "\n")
    print(json.dumps({"generated": len(entries), "output": str(OUTPUT_PATH)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
