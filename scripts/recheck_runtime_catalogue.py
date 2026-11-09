#!/usr/bin/env python3
"""Bounded guarded rechecks of reviewed runtime destinations; never approves a URL."""
import json
import sys
from pathlib import Path
from discover_catalogue_candidates import screen_url, screening_framing

MAX_RUNTIME_RECHECKS = 24


def main():
    if len(sys.argv) != 3:
        raise ValueError("usage: recheck_runtime_catalogue.py TARGETS OUTPUT")
    targets_path, output_path = map(Path, sys.argv[1:])
    data = json.loads(targets_path.read_text())
    if not isinstance(data, list) or len(data) > MAX_RUNTIME_RECHECKS:
        raise ValueError("invalid bounded runtime health targets")
    selected = []
    for entry in data:
        if not isinstance(entry, dict) or not isinstance(entry.get("id"), str) or not isinstance(entry.get("canonicalUrl"), str):
            raise ValueError("invalid runtime health target")
        selected.append(entry)
    results = []
    for entry in selected:
        screen = screen_url(entry["canonicalUrl"])
        framing = screening_framing(screen)
        results.append({
            "id": entry["id"], "canonical_url": entry["canonicalUrl"],
            "availability_status": screen.get("status"), "framing": framing,
        })
    output_path.write_text(json.dumps(results, indent=2) + "\n")
    output_path.with_name("runtime-browser-inputs.json").write_text(
        json.dumps([{"id": entry["id"], "canonical_url": entry["canonicalUrl"]} for entry in selected], indent=2) + "\n"
    )
    print(json.dumps({"rechecked": len(results)}))


if __name__ == "__main__":
    main()
