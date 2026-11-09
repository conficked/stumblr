"""Write deterministic, review-only queue import lists and a replay manifest."""

import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--ceiling", type=int, default=220)
    args = parser.parse_args()
    if not 1 <= args.ceiling <= 220:
        parser.error("invalid ceiling: expected 1 through 220")
    rows = json.loads(args.input.read_text())
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        parser.error("invalid candidate batch: expected a list of objects")
    if len(rows) > args.ceiling:
        parser.error("candidate batch exceeds configured ceiling")

    # A fresh directory prevents stale imports from an earlier larger batch.
    args.output_dir.mkdir(parents=True, exist_ok=False)
    manifest = []
    for start in range(0, len(rows), 24):
        chunk = rows[start:start + 24]
        body = json.dumps(chunk, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
        replay_key = hashlib.sha256(body.encode("utf-8")).hexdigest()
        filename = f"chunk-{start // 24 + 1:04d}.json"
        (args.output_dir / filename).write_text(body, encoding="utf-8")
        manifest.append({"file": filename, "replay_key": replay_key, "count": len(chunk)})
    (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
