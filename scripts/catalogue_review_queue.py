#!/usr/bin/env python3
"""Operate Stumblr's durable, review-only discovery queue."""

from __future__ import annotations

import argparse
import hashlib
import json
import urllib.parse
from pathlib import Path

import stumblr_db
from discover_catalogue_candidates import classify_title, read_title_signals, safe_domain_title, screening_framing


def queue_counts(conn) -> dict[str, int]:  # noqa: ANN001
    return {
        row["status"]: row["count"]
        for row in conn.execute(
            "SELECT status, COUNT(*) AS count FROM discovery_candidates GROUP BY status ORDER BY status"
        )
    }


def ingest_selected_artifact(conn, artifact_path: str | Path) -> dict[str, int]:  # noqa: ANN001
    rows = json.loads(Path(artifact_path).read_text(encoding="utf-8"))
    if not isinstance(rows, list):
        raise ValueError("selected artifact must be a JSON list")
    result = {"inserted": 0, "existing": 0}
    for row in rows:
        if row.get("association_update") is True:
            parsed = urllib.parse.urlparse(row["canonical_url"])
            if (parsed.scheme != "https" or parsed.hostname != row["domain"] or parsed.username or parsed.password
                    or ":" in parsed.netloc):
                raise ValueError("invalid association destination")
            stumblr_db.update_existing_repository_associations(conn, row["canonical_url"], row["domain"], row["repository_associations"])
            result["existing"] += 1
            continue
        selection_status = row.get("selection_status")
        if selection_status not in {"evaluation_candidate", "blocked"}:
            raise ValueError(f"unsafe selection status: {selection_status}")
        queue_status = "quarantined" if selection_status == "blocked" else "pending_review"
        title = row.get("title_hint") or ""
        observed = classify_title(title)
        bounded = read_title_signals(row.get("title_signals"))
        terminal = row.get("screened_destination")
        parsed = urllib.parse.urlsplit(row["canonical_url"])
        canonical_digest = hashlib.sha256(parsed._replace(path=parsed.path or "/", fragment="").geturl().encode()).hexdigest()
        redirected = row.get("redirected") is True or (
            isinstance(terminal, dict) and terminal.get("final_url_sha256") != canonical_digest
        )
        synthetic_title = title == safe_domain_title(row["domain"])
        needs_bounded_title = redirected or synthetic_title
        signals = {
            **(bounded if needs_bounded_title else observed),
            "quality": (synthetic_title or observed["quality"]) and (
                bounded["quality"] if needs_bounded_title or "title_signals" in row else True
            ),
            "denied": bounded["denied"] or observed["denied"],
        }
        if row.get("source_family") == "runtime-recheck":
            existing = conn.execute("SELECT screen_json, status FROM discovery_candidates WHERE canonical_url = ?",
                                    (row["canonical_url"],)).fetchone()
            if existing:
                screen = json.loads(existing["screen_json"] or "{}")
                prior = read_title_signals(screen.get("title_signals"))
                screen.update(status=row.get("availability_status"), framing=screening_framing(row), title_signals={
                    **prior,
                    "quality": prior["quality"] and (synthetic_title or observed["quality"])
                    and ("title_signals" not in row or bounded["quality"]),
                    "denied": prior["denied"] or signals["denied"],
                })
                conn.execute("UPDATE discovery_candidates SET screen_json = ?, status = ? WHERE canonical_url = ?",
                             (json.dumps(screen), "quarantined" if queue_status == "quarantined" else existing["status"],
                              row["canonical_url"]))
                result["existing"] += 1
                continue
            signals = {"quality": False, "denied": signals["denied"]}
            terminal = None
        kind, _candidate_id = stumblr_db.upsert_candidate(
            conn,
            canonical_url=row["canonical_url"],
            domain=row["domain"],
            source_id=row["source_id"],
            source_family=row.get("source_family") or "unknown",
            source_url=row["source_url"],
            status=queue_status,
            topic_hint=(row.get("topics") or [None])[0],
            topics=row.get("topics") or [],
            link_text=safe_domain_title(row["domain"]),
            screen={
                "status": row.get("availability_status"),
                "framing": screening_framing(row),
                "title_signals": signals,
                **({"screened_destination": terminal} if terminal is not None else {}),
            },
            repository_associations=row.get("repository_associations", []),
            provenance={
                **(row.get("provenance") or {}),
                "artifact": str(Path(artifact_path).resolve()),
                "review_only": True,
                "auto_rotation": False,
            },
        )
        result[kind] += 1
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db-path", required=True, help="Runtime SQLite path outside the repository.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("counts")
    ingest = subparsers.add_parser("ingest-selected")
    ingest.add_argument("artifact")
    review = subparsers.add_parser("review")
    review.add_argument("candidate_id")
    review.add_argument("status", choices=sorted(stumblr_db.REVIEW_STATUSES))
    review.add_argument("--actor", required=True)
    review.add_argument("--note")
    export = subparsers.add_parser("export-reviewed")
    export.add_argument("output")
    reload_parser = subparsers.add_parser("reload-reviewed")
    reload_parser.add_argument("input")
    args = parser.parse_args()

    conn = stumblr_db.connect(args.db_path)
    try:
        if args.command == "counts":
            payload = {"counts": queue_counts(conn), "active": False}
        elif args.command == "ingest-selected":
            payload = {
                **ingest_selected_artifact(conn, args.artifact),
                "counts": queue_counts(conn),
                "active": False,
            }
        elif args.command == "review":
            stumblr_db.transition_candidate_review(
                conn,
                args.candidate_id,
                args.status,
                actor=args.actor,
                note=args.note,
            )
            payload = {"updated": 1, "counts": queue_counts(conn), "active": False}
        elif args.command == "export-reviewed":
            payload = {
                "exported": stumblr_db.export_reviewed_candidates(conn, args.output),
                "output": str(Path(args.output).resolve()),
                "active": False,
            }
        else:
            payload = {
                "reloaded": stumblr_db.reload_reviewed_export(conn, args.input),
                "counts": queue_counts(conn),
                "active": False,
            }
        print(json.dumps(payload, sort_keys=True))
        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
