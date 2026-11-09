#!/usr/bin/env python3
"""Shared SQLite helpers for Stumblr discovery (local ops DB).

SQL dialect is intentionally D1-compatible. This module proves local durability only;
hosted shared deployment requires a separate approved infra decision.
"""

from __future__ import annotations

import json
import os
import sqlite3
import hashlib
import time
import uuid
import re
from pathlib import Path
from typing import Any

if __package__:
    from .github_demo_provider import canonical_https_url
else:
    from github_demo_provider import canonical_https_url

REPO_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = REPO_ROOT / "db" / "migrations"
DEFAULT_DB_PATH = REPO_ROOT / "data" / "stumblr-ops.sqlite"


def resolve_db_path(override: str | None = None) -> Path:
    if override:
        return Path(override).resolve()
    env = os.environ.get("STUMBLR_DB_PATH")
    if env:
        return Path(env).resolve()
    return DEFAULT_DB_PATH.resolve()


def connect(db_path: str | Path | None = None) -> sqlite3.Connection:
    path = resolve_db_path(str(db_path) if db_path else None)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=5.0, isolation_level=None)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    conn.execute("PRAGMA journal_mode = WAL;")
    try:
        migrate(conn)
    except BaseException:
        conn.close()
        raise
    return conn


def migrate(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          applied_at TEXT NOT NULL
        );
        """
    )
    applied = {row["name"] for row in conn.execute("SELECT name FROM schema_migrations")}
    if not MIGRATIONS_DIR.exists():
        return
    for sql_file in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if sql_file.name in applied:
            continue
        sql = sql_file.read_text(encoding="utf-8")
        # executescript commits any earlier transaction, so start this transaction
        # inside the script and leave it open through the migration marker.
        try:
            conn.executescript("BEGIN IMMEDIATE;\n" + sql)
            conn.execute(
                "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
                (sql_file.name, _now()),
            )
            conn.execute("COMMIT")
        except BaseException:
            if conn.in_transaction:
                conn.execute("ROLLBACK")
            raise


    # Keep this marker until the rewritten main file is checkpointed and the WAL truncated.
    pending_table = conn.execute("SELECT 1 FROM sqlite_master WHERE name = 'ops_privacy_scrub_pending'").fetchone()
    if pending_table and conn.execute("SELECT 1 FROM ops_privacy_scrub_pending").fetchone():
        conn.execute("VACUUM")
        busy, *_ = conn.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone()
        if busy:
            raise RuntimeError("Privacy scrub WAL checkpoint could not complete")
        conn.execute("DELETE FROM ops_privacy_scrub_pending")


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def candidate_id(canonical_url: str, domain: str) -> str:
    digest = hashlib.sha1(canonical_url.encode("utf-8")).hexdigest()[:12]
    slug = "".join(ch if ch.isalnum() else "-" for ch in domain.lower()).strip("-")
    return f"{slug}-{digest}"


def normalize_candidate_provenance(provenance: dict[str, Any] | None) -> dict[str, Any]:
    """Preserve raw provider metadata and add the optional review evidence object."""
    result = dict(provenance or {})
    repository_id = result.get("repository_id")
    if repository_id is not None:
        if "demo_url" in result:
            result.setdefault("raw_homepage", result["demo_url"])
        for field in ("repository_url", "demo_url"):
            if field in result:
                result[field] = canonical_https_url(result[field])
                if result[field] is None:
                    raise ValueError("invalid repository/demo URL")
        evidence = {key: result[key] for key in (
            "description", "topics", "stars", "pushed_at", "archived", "source_query"
        ) if key in result}
        # Fresh raw provider values take precedence over retained grouped evidence.
        result["github_evidence"] = {**(result.get("github_evidence") or {}), **evidence}
    return result


def merge_candidate_provenance(previous: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = {**previous, **incoming}
    if "github_evidence" in previous or "github_evidence" in incoming:
        merged["github_evidence"] = {
            **(previous.get("github_evidence") or {}), **(incoming.get("github_evidence") or {}),
        }
    return normalize_candidate_provenance(merged)


def record_repository_association(conn: sqlite3.Connection, cid: str, provenance: dict[str, Any]) -> None:
    if provenance.get("repository_id") is None:
        return
    identity = str(provenance["repository_id"])
    previous = conn.execute(
        "SELECT provenance_json FROM discovery_candidate_repositories WHERE candidate_id = ? AND repository_id = ?",
        (cid, identity),
    ).fetchone()
    merged = merge_candidate_provenance(json.loads(previous[0]) if previous else {}, provenance)
    conn.execute(
        """INSERT INTO discovery_candidate_repositories(candidate_id, repository_id, provenance_json)
           VALUES (?, ?, ?) ON CONFLICT(candidate_id, repository_id)
           DO UPDATE SET provenance_json = excluded.provenance_json""",
        (cid, identity, json.dumps(merged)),
    )


def validate_repository_associations(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) > 100:
        raise ValueError("repository associations must be a list of at most 100 records")
    validated = []
    for provenance in value:
        if not isinstance(provenance, dict):
            raise ValueError("invalid repository association")
        identity = provenance.get("repository_id")
        if isinstance(identity, bool) or not isinstance(identity, (int, str)) or not re.fullmatch(r"[1-9][0-9]{0,99}", str(identity)):
            raise ValueError("invalid repository identity")
        name = provenance.get("repository_full_name")
        if not isinstance(name, str) or not 1 <= len(name) <= 300:
            raise ValueError("invalid repository name")
        normalized = dict(provenance)
        for field in ("repository_url", "demo_url"):
            normalized[field] = canonical_https_url(provenance.get(field))
            if normalized[field] is None:
                raise ValueError("invalid repository/demo URL")
        normalized.setdefault("raw_homepage", provenance["demo_url"])
        if "github_evidence" in provenance and not isinstance(provenance["github_evidence"], dict):
            raise ValueError("invalid GitHub evidence")
        validated.append(normalized)
    return validated


def record_candidate_repositories(conn, cid, provenance, associations):
    record_repository_association(conn, cid, provenance)
    for association in associations:
        record_repository_association(conn, cid, association)


def update_existing_repository_associations(conn, canonical_url, domain, associations):
    """Attach attribution only; never create a destination or alter its review state."""
    associations = validate_repository_associations(associations)
    if not associations:
        raise ValueError("association update must contain at least one repository")
    row = conn.execute(
        """SELECT id FROM discovery_candidates WHERE canonical_url = ? OR domain = ?
           ORDER BY (status = 'quarantined'), (canonical_url = ?) DESC, id LIMIT 1""",
        (canonical_url, domain, canonical_url),
    ).fetchone()
    if row:
        for association in associations:
            record_repository_association(conn, row["id"], association)
    return row is not None


def discovery_identity_snapshot(conn: sqlite3.Connection) -> dict[str, set[str]]:
    """Cross-run identities; quarantined demos may be corrected and rediscovered."""
    rows = conn.execute(
        """SELECT d.domain, r.repository_id FROM discovery_candidates d
           LEFT JOIN discovery_candidate_repositories r ON r.candidate_id = d.id
           WHERE d.status != 'quarantined'"""
    ).fetchall()
    return {
        "occupied_demo_domains": {row["domain"] for row in rows},
        "known_repository_ids": {row["repository_id"] for row in rows if row["repository_id"]},
    }


def upsert_candidate(
    conn: sqlite3.Connection,
    *,
    canonical_url: str,
    domain: str,
    source_id: str,
    source_family: str,
    source_url: str,
    status: str = "discovered",
    topic_hint: str | None = None,
    topics: list[str] | None = None,
    link_text: str | None = None,
    screen: dict[str, Any] | None = None,
    provenance: dict[str, Any] | None = None,
    repository_associations: list[dict[str, Any]] | None = None,
) -> tuple[str, str]:
    """Returns (kind, id) where kind is inserted|existing."""
    associations = validate_repository_associations(repository_associations if repository_associations is not None else [])
    provenance = normalize_candidate_provenance(provenance)
    repository_id = str(provenance["repository_id"]) if provenance.get("repository_id") is not None else None
    repository_ids = sorted({str(item["repository_id"]) for item in associations} | ({repository_id} if repository_id is not None else set()))
    if repository_ids:
        placeholders = ",".join("?" for _ in repository_ids)
        duplicate = conn.execute(
            f"""SELECT d.id, d.canonical_url FROM discovery_candidates d
               LEFT JOIN discovery_candidate_repositories r ON r.candidate_id = d.id
               WHERE d.status != 'quarantined' AND (r.repository_id IN ({placeholders}) OR d.domain = ?)
               ORDER BY CASE WHEN r.repository_id IN ({placeholders}) THEN 0 ELSE 1 END, d.id LIMIT 1""",
            (*repository_ids, domain, *repository_ids),
        ).fetchone()
        if duplicate:
            record_candidate_repositories(conn, duplicate["id"], provenance, associations)
            if duplicate["canonical_url"] != canonical_url:
                return "existing", duplicate["id"]
    existing = conn.execute(
        "SELECT id, status, repository_id, provenance_json FROM discovery_candidates WHERE canonical_url = ? LIMIT 1",
        (canonical_url,),
    ).fetchone()
    topics_json = json.dumps(topics or [])
    provenance_json = json.dumps(provenance or {})
    screen_json = json.dumps(screen) if screen is not None else None
    updated_at = _now()
    if existing:
        record_candidate_repositories(conn, existing["id"], provenance, associations)
        if repository_id is not None and existing["repository_id"] not in (None, repository_id):
            return "existing", existing["id"]
        provenance = merge_candidate_provenance(json.loads(existing["provenance_json"] or "{}"), provenance)
        provenance_json = json.dumps(provenance)
        repository_id = str(provenance["repository_id"]) if provenance.get("repository_id") is not None else None
        if existing["status"] in REVIEW_STATUSES:
            status = existing["status"]
        conn.execute(
            """
            UPDATE discovery_candidates SET
              source_id = ?, source_family = ?, source_url = ?, status = ?,
              topic_hint = ?, topics_json = ?, link_text = ?,
              screen_json = COALESCE(?, screen_json),
              provenance_json = ?, repository_id = ?, updated_at = ?
            WHERE canonical_url = ?
            """,
            (
                source_id,
                source_family,
                source_url,
                status,
                topic_hint,
                topics_json,
                link_text,
                screen_json,
                provenance_json,
                repository_id,
                updated_at,
                canonical_url,
            ),
        )
        return "existing", existing["id"]

    cid = candidate_id(canonical_url, domain)
    try:
        conn.execute(
            """
            INSERT INTO discovery_candidates (
              id, canonical_url, domain, source_id, source_family, source_url,
              discovered_at, status, topic_hint, topics_json, link_text, screen_json, provenance_json, repository_id, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                cid,
                canonical_url,
                domain,
                source_id,
                source_family,
                source_url,
                updated_at,
                status,
                topic_hint,
                topics_json,
                link_text,
                screen_json,
                provenance_json,
                repository_id,
                updated_at,
            ),
        )
        record_candidate_repositories(conn, cid, provenance, associations)
        return "inserted", cid
    except sqlite3.IntegrityError:
        row = conn.execute(
            "SELECT id FROM discovery_candidates WHERE canonical_url = ? LIMIT 1",
            (canonical_url,),
        ).fetchone()
        if not row:
            raise
        record_candidate_repositories(conn, row["id"], provenance, associations)
        return "existing", row["id"]


REVIEW_STATUSES = {"pending_review", "reviewed_exportable", "rejected", "quarantined"}


def transition_candidate_review(
    conn: sqlite3.Connection,
    candidate_id_value: str,
    to_status: str,
    *,
    actor: str,
    note: str | None = None,
) -> None:
    """Apply an explicit review decision; launch qualification is intentionally impossible."""
    if to_status not in REVIEW_STATUSES:
        raise ValueError(f"unsupported review status: {to_status}")
    row = conn.execute(
        "SELECT status FROM discovery_candidates WHERE id = ?",
        (candidate_id_value,),
    ).fetchone()
    if not row:
        raise KeyError(f"unknown discovery candidate: {candidate_id_value}")
    now = _now()
    conn.execute("BEGIN IMMEDIATE")
    try:
        conn.execute(
            "UPDATE discovery_candidates SET status = ?, updated_at = ? WHERE id = ?",
            (to_status, now, candidate_id_value),
        )
        conn.execute(
            """
            INSERT INTO review_history (
              entity_type, entity_id, from_status, to_status, actor, note, at
            ) VALUES ('discovery_candidate', ?, ?, ?, ?, ?, ?)
            """,
            (candidate_id_value, row["status"], to_status, actor, note, now),
        )
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def export_reviewed_candidates(conn: sqlite3.Connection, output_path: str | Path) -> int:
    rows = conn.execute(
        """
        SELECT id, canonical_url, domain, source_id, source_family, source_url,
               discovered_at, topic_hint, topics_json, link_text, screen_json,
               provenance_json, updated_at
        FROM discovery_candidates
        WHERE status = 'reviewed_exportable'
        ORDER BY domain, canonical_url
        """
    ).fetchall()
    candidates = []
    for row in rows:
        item = dict(row)
        item["topics"] = json.loads(item.pop("topics_json") or "[]")
        item["screen"] = json.loads(item.pop("screen_json") or "null")
        item["provenance"] = json.loads(item.pop("provenance_json") or "{}")
        item["repository_associations"] = [json.loads(association[0]) for association in conn.execute(
            "SELECT provenance_json FROM discovery_candidate_repositories WHERE candidate_id = ? ORDER BY repository_id",
            (row["id"],),
        )]
        item["review_status"] = "reviewed_exportable"
        item["catalogue_status"] = "evaluation_only"
        candidates.append(item)
    payload = {
        "schema_version": 1,
        "exported_at": _now(),
        "auto_rotation": False,
        "candidates": candidates,
    }
    target = Path(output_path).resolve()
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_name(f".{target.name}.{uuid.uuid4().hex}.tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, target)
    return len(candidates)


def reload_reviewed_export(conn: sqlite3.Connection, input_path: str | Path) -> int:
    payload = json.loads(Path(input_path).read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1 or payload.get("auto_rotation") is not False:
        raise ValueError("unsupported or unsafe reviewed export")
    candidates = payload.get("candidates")
    if not isinstance(candidates, list):
        raise ValueError("reviewed export candidates must be a list")
    loaded = 0
    for item in candidates:
        if item.get("review_status") != "reviewed_exportable":
            raise ValueError("export contains a non-reviewed candidate")
        if item.get("catalogue_status") != "evaluation_only":
            raise ValueError("export attempts unsupported catalogue qualification")
        _kind, cid = upsert_candidate(
            conn,
            canonical_url=item["canonical_url"],
            domain=item["domain"],
            source_id=item["source_id"],
            source_family=item["source_family"],
            source_url=item["source_url"],
            status="reviewed_exportable",
            topic_hint=item.get("topic_hint"),
            topics=item.get("topics") or [],
            link_text=item.get("link_text"),
            screen=item.get("screen"),
            provenance=item.get("provenance") or {},
        )
        for association in item.get("repository_associations") or []:
            record_repository_association(conn, cid, association)
        loaded += 1
    return loaded


def start_run(conn: sqlite3.Connection, owner: str, lease_ttl_sec: int = 300) -> str:
    run_id = f"run-{uuid.uuid4().hex[:16]}"
    lease_until = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ",
        time.gmtime(time.time() + lease_ttl_sec),
    )
    conn.execute(
        """
        INSERT INTO discovery_runs (id, started_at, status, checkpoint_json, stats_json, lease_owner, lease_until)
        VALUES (?, ?, 'running', '{}', '{}', ?, ?)
        """,
        (run_id, _now(), owner, lease_until),
    )
    append_event(conn, run_id, "started", {"owner": owner})
    return run_id


def try_acquire_lease(
    conn: sqlite3.Connection, run_id: str, owner: str, lease_ttl_sec: int = 300
) -> bool:
    now = _now()
    lease_until = time.strftime(
        "%Y-%m-%dT%H:%M:%SZ",
        time.gmtime(time.time() + lease_ttl_sec),
    )
    cur = conn.execute(
        """
        UPDATE discovery_runs
        SET lease_owner = ?, lease_until = ?
        WHERE id = ?
          AND status = 'running'
          AND (lease_owner IS NULL OR lease_owner = ? OR lease_until IS NULL OR lease_until < ?)
        """,
        (owner, lease_until, run_id, owner, now),
    )
    return cur.rowcount == 1


def checkpoint_run(
    conn: sqlite3.Connection,
    run_id: str,
    checkpoint: dict[str, Any],
    stats: dict[str, Any] | None = None,
) -> None:
    conn.execute(
        """
        UPDATE discovery_runs
        SET checkpoint_json = ?, stats_json = COALESCE(?, stats_json)
        WHERE id = ?
        """,
        (json.dumps(checkpoint), json.dumps(stats) if stats is not None else None, run_id),
    )
    append_event(conn, run_id, "checkpoint", checkpoint)


def finish_run(
    conn: sqlite3.Connection,
    run_id: str,
    status: str,
    stats: dict[str, Any] | None = None,
    error: str | None = None,
) -> None:
    conn.execute(
        """
        UPDATE discovery_runs
        SET status = ?, finished_at = ?, stats_json = COALESCE(?, stats_json), error = ?,
            lease_owner = NULL, lease_until = NULL
        WHERE id = ?
        """,
        (status, _now(), json.dumps(stats) if stats is not None else None, error, run_id),
    )
    append_event(conn, run_id, "finished", {"status": status, "error": error})


def append_event(
    conn: sqlite3.Connection, run_id: str, kind: str, payload: dict[str, Any]
) -> None:
    conn.execute(
        """
        INSERT INTO discovery_run_events (run_id, at, kind, payload_json)
        VALUES (?, ?, ?, ?)
        """,
        (run_id, _now(), kind, json.dumps(payload)),
    )


def get_checkpoint(conn: sqlite3.Connection, run_id: str) -> dict[str, Any]:
    row = conn.execute(
        "SELECT checkpoint_json FROM discovery_runs WHERE id = ?",
        (run_id,),
    ).fetchone()
    if not row:
        return {}
    try:
        return json.loads(row["checkpoint_json"] or "{}")
    except json.JSONDecodeError:
        return {}
