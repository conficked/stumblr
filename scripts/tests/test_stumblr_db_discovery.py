#!/usr/bin/env python3
"""Local unit tests for ops DB discovery helpers + redirect SSRF guard."""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
import urllib.error
import hashlib
import json
import sqlite3
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import discover_catalogue_candidates as disc  # noqa: E402
import stumblr_db  # noqa: E402
import catalogue_review_queue as review_queue  # noqa: E402


class DiscoveryDbTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.db_path = str(Path(self.tmp.name) / "ops.sqlite")
        os.environ["STUMBLR_DB_PATH"] = self.db_path
        self.conn = stumblr_db.connect(self.db_path)

    def tearDown(self) -> None:
        self.conn.close()
        self.tmp.cleanup()
        os.environ.pop("STUMBLR_DB_PATH", None)

    def test_interrupted_identity_migrations_rollback_and_reopen_from_populated_legacy_db(self):
        for interrupted_name in ("004_github_candidate_identity.sql", "005_candidate_repository_associations.sql"):
            with self.subTest(migration=interrupted_name):
                db_path = Path(self.tmp.name) / interrupted_name.replace(".sql", ".sqlite")
                legacy = sqlite3.connect(db_path, isolation_level=None)
                for migration in sorted(stumblr_db.MIGRATIONS_DIR.glob("00[1-3]*.sql")):
                    legacy.executescript(migration.read_text())
                    legacy.execute("INSERT INTO schema_migrations(name, applied_at) VALUES (?, 'fixture')", (migration.name,))
                provenance = json.dumps({"repository_id": 123, "stars": 42})
                legacy.execute("INSERT INTO discovery_candidates(id,canonical_url,domain,source_id,source_family,source_url,discovered_at,status,provenance_json,updated_at) VALUES ('legacy','https://legacy.example/','legacy.example','github','github','https://github.com/','fixture','reviewed_exportable',?,'fixture')", (provenance,))
                legacy.close()

                class InterruptedConnection(sqlite3.Connection):
                    def execute(self, sql, parameters=()):
                        if "INSERT INTO schema_migrations" in sql and parameters[0] == interrupted_name:
                            raise KeyboardInterrupt("interrupted after DDL before migration marker")
                        return super().execute(sql, parameters)

                interrupted = sqlite3.connect(db_path, isolation_level=None, factory=InterruptedConnection)
                interrupted.row_factory = sqlite3.Row
                with self.assertRaises(KeyboardInterrupt):
                    stumblr_db.migrate(interrupted)
                self.assertFalse(interrupted.in_transaction)
                self.assertIsNone(interrupted.execute("SELECT name FROM schema_migrations WHERE name=?", (interrupted_name,)).fetchone())
                if interrupted_name.startswith("004"):
                    self.assertNotIn("repository_id", [row["name"] for row in interrupted.execute("PRAGMA table_info(discovery_candidates)")])
                else:
                    self.assertIsNone(interrupted.execute("SELECT name FROM sqlite_master WHERE name='discovery_candidate_repositories'").fetchone())
                interrupted.close()
                reopened = stumblr_db.connect(db_path)
                try:
                    self.assertEqual(stumblr_db.discovery_identity_snapshot(reopened)["known_repository_ids"], {"123"})
                    row = reopened.execute("SELECT status, provenance_json FROM discovery_candidates").fetchone()
                    self.assertEqual(tuple(row), ("reviewed_exportable", provenance))
                finally:
                    reopened.close()

    def test_association_artifacts_validate_metadata_without_creating_or_reclassifying_destinations(self):
        artifact = Path(self.tmp.name) / "associations.json"
        provenance = {"repository_id": 456, "repository_full_name": "owner/other", "repository_url": "https://github.com/owner/other", "demo_url": "https://demo.example/"}
        update = {"association_update": True, "canonical_url": "https://demo.example/", "domain": "demo.example", "repository_associations": [provenance]}
        artifact.write_text(json.dumps([update]))
        review_queue.ingest_selected_artifact(self.conn, artifact)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM discovery_candidates").fetchone()[0], 0)
        self.github_candidate("https://demo.example/", status="quarantined")
        review_queue.ingest_selected_artifact(self.conn, artifact)
        self.assertEqual(self.conn.execute("SELECT status FROM discovery_candidates").fetchone()[0], "quarantined")
        invalid = [{**update, "repository_associations": {}}, {**update, "repository_associations": []},
            {**update, "repository_associations": [{**provenance, "demo_url": "http://demo.example/"}]},
            {**update, "repository_associations": [{**provenance, "repository_url": "javascript:bad"}]},
            {**update, "canonical_url": "https://demo.example:8443/"}]
        for payload in invalid:
            with self.subTest(payload=payload):
                artifact.write_text(json.dumps([payload]))
                with self.assertRaises(ValueError):
                    review_queue.ingest_selected_artifact(self.conn, artifact)

    def test_primary_github_metadata_rejects_unsafe_demo_forms_before_persistence(self):
        invalid = ["https://bad_host.example/", "https://bad..example/", "https://-bad.example/", "https://demo.example:/", "https://demo%2eexample/", "https://demo.example/%0Asecret", "https://demo.example/%zz"]
        for demo_url in invalid:
            with self.subTest(demo_url=demo_url), self.assertRaises(ValueError):
                self.github_candidate("https://demo.example/", demo_url=demo_url)
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM discovery_candidates").fetchone()[0], 0)

    def github_candidate(self, url, repository_id="123", status="pending_review", **metadata):
        return stumblr_db.upsert_candidate(
            self.conn, canonical_url=url, domain=urllib.parse.urlparse(url).hostname,
            source_id="github-fixture", source_family="github", source_url="https://github.com/",
            status=status, provenance={
                "repository_id": repository_id, "repository_full_name": "owner/demo",
                "repository_url": "https://github.com/owner/demo", "demo_url": url,
                "description": "Interactive demo", "topics": ["art"], "stars": 42,
                "pushed_at": "2026-11-01T00:00:00Z", "archived": False, "source_query": "topic:art",
                **metadata,
            },
        )

    def test_github_repository_replay_dedupes_across_urls_without_overriding_review(self):
        _, cid = self.github_candidate("https://demo.example/", repository_id=123)
        stumblr_db.transition_candidate_review(self.conn, cid, "reviewed_exportable", actor="reviewer")
        self.assertEqual(self.github_candidate("https://renamed.example/"), ("existing", cid))
        self.assertEqual(self.github_candidate("https://demo.example/"), ("existing", cid))
        self.assertEqual(self.conn.execute("SELECT status FROM discovery_candidates").fetchone()[0], "reviewed_exportable")
        snapshot = stumblr_db.discovery_identity_snapshot(self.conn)
        self.assertEqual(snapshot, {"occupied_demo_domains": {"demo.example"}, "known_repository_ids": {"123"}})

    def test_github_evidence_enriches_existing_destination_without_losing_review(self):
        _, cid = stumblr_db.upsert_candidate(self.conn, canonical_url="https://demo.example/", domain="demo.example", source_id="directory", source_family="directory", source_url="https://source.example/", status="reviewed_exportable")
        self.assertEqual(self.github_candidate("https://demo.example/", 123), ("existing", cid))
        row = self.conn.execute("SELECT * FROM discovery_candidates").fetchone()
        self.assertEqual(row["repository_id"], "123")
        self.assertEqual(json.loads(row["provenance_json"])["repository_id"], 123)
        self.assertEqual(row["status"], "reviewed_exportable")

    def test_shared_destination_retains_both_repository_identities_across_domain_changes(self):
        for second_url in ("https://demo.example/two", "https://demo.example/one"):
            with self.subTest(second_url=second_url):
                self.conn.execute("DELETE FROM discovery_candidates")
                _, cid = self.github_candidate("https://demo.example/one")
                self.assertEqual(self.github_candidate(second_url, "456", repository_full_name="owner/other"), ("existing", cid))
                self.assertEqual(stumblr_db.discovery_identity_snapshot(self.conn)["known_repository_ids"], {"123", "456"})
                primary = self.conn.execute("SELECT repository_id, provenance_json FROM discovery_candidates").fetchone()
                self.assertEqual(primary["repository_id"], "123")
                self.assertEqual(json.loads(primary["provenance_json"])["repository_full_name"], "owner/demo")
                for identity in ("123", "456"):
                    self.assertEqual(self.github_candidate("https://changed.example/", identity), ("existing", cid))
                self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM discovery_candidates").fetchone()[0], 1)
                associations = self.conn.execute("SELECT repository_id, provenance_json FROM discovery_candidate_repositories ORDER BY repository_id").fetchall()
                self.assertEqual([row["repository_id"] for row in associations], ["123", "456"])

    def test_all_repository_associations_survive_reviewed_export_reload(self):
        _, cid = self.github_candidate("https://demo.example/one")
        self.github_candidate("https://demo.example/two", "456", repository_full_name="owner/other")
        stumblr_db.transition_candidate_review(self.conn, cid, "reviewed_exportable", actor="reviewer")
        target = Path(self.tmp.name) / "multi-repository.json"
        stumblr_db.export_reviewed_candidates(self.conn, target)
        reloaded = stumblr_db.connect(Path(self.tmp.name) / "multi-repository.sqlite")
        try:
            stumblr_db.reload_reviewed_export(reloaded, target)
            self.assertEqual(stumblr_db.discovery_identity_snapshot(reloaded)["known_repository_ids"], {"123", "456"})
            association = reloaded.execute("SELECT provenance_json FROM discovery_candidate_repositories WHERE repository_id = '456'").fetchone()
            self.assertEqual(json.loads(association[0])["repository_full_name"], "owner/other")
            self.assertEqual(json.loads(association[0])["demo_url"], "https://demo.example/two")
        finally:
            reloaded.close()

    def test_raw_metadata_refresh_wins_over_previous_grouped_evidence(self):
        self.github_candidate("https://demo.example/", github_evidence={"stars": 42, "review_note": "retained"})
        self.github_candidate("https://demo.example/", stars=99, github_evidence={"stars": 42})
        row = self.conn.execute("SELECT provenance_json FROM discovery_candidates").fetchone()
        provenance = json.loads(row[0])
        self.assertEqual(provenance["stars"], 99)
        self.assertEqual(provenance["github_evidence"], {"description": "Interactive demo", "topics": ["art"], "stars": 99, "pushed_at": "2026-11-01T00:00:00Z", "archived": False, "source_query": "topic:art", "review_note": "retained"})
        association = self.conn.execute("SELECT provenance_json FROM discovery_candidate_repositories").fetchone()
        self.assertEqual(json.loads(association[0])["github_evidence"]["stars"], 99)

    def test_github_shared_demo_domain_has_one_reviewable_destination(self):
        _, cid = self.github_candidate("https://demo.example/one")
        self.assertEqual(self.github_candidate("https://demo.example/two", "456"), ("existing", cid))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM discovery_candidates").fetchone()[0], 1)

    def test_quarantined_github_identity_does_not_block_corrected_homepage(self):
        for suffix in ("feed.xml", "docs"):
            self.github_candidate("https://demo.example/" + suffix, status="quarantined")
        self.assertEqual(stumblr_db.discovery_identity_snapshot(self.conn), {"occupied_demo_domains": set(), "known_repository_ids": set()})
        self.assertEqual(self.github_candidate("https://demo.example/")[0], "inserted")

    def test_selected_github_evidence_survives_review_export_reload(self):
        artifact = Path(self.tmp.name) / "github.json"
        provenance = {"repository_id": 123, "repository_full_name": "owner/demo", "repository_url": "https://github.com/owner/demo", "demo_url": "https://demo.example/", "description": "Demo", "topics": ["art"], "stars": 42, "archived": False, "pushed_at": "2026-11-01T00:00:00Z", "source_query": "topic:art"}
        artifact.write_text(json.dumps([{"canonical_url": "https://demo.example/", "domain": "demo.example", "source_id": "github", "source_family": "github", "source_url": "https://github.com/", "selection_status": "evaluation_candidate", "provenance": provenance}]))
        self.assertEqual(review_queue.ingest_selected_artifact(self.conn, artifact)["inserted"], 1)
        row = self.conn.execute("SELECT * FROM discovery_candidates").fetchone()
        stored = json.loads(row["provenance_json"])
        self.assertEqual(stored["repository_id"], 123)
        self.assertEqual(stored["github_evidence"]["stars"], 42)
        self.assertEqual(stored["source_query"], "topic:art")
        stumblr_db.transition_candidate_review(self.conn, row["id"], "reviewed_exportable", actor="reviewer")
        target = Path(self.tmp.name) / "reviewed-github.json"
        stumblr_db.export_reviewed_candidates(self.conn, target)
        reloaded = stumblr_db.connect(Path(self.tmp.name) / "reload.sqlite")
        try:
            stumblr_db.reload_reviewed_export(reloaded, target)
            self.assertEqual(stumblr_db.discovery_identity_snapshot(reloaded)["known_repository_ids"], {"123"})
        finally:
            reloaded.close()

    def test_upsert_idempotent_replay(self) -> None:
        kind1, cid1 = stumblr_db.upsert_candidate(
            self.conn,
            canonical_url="https://repeat.example.org/page",
            domain="repeat.example.org",
            source_id="webring-xxiivv",
            source_family="webring",
            source_url="https://webring.xxiivv.com/",
            status="discovered",
        )
        kind2, cid2 = stumblr_db.upsert_candidate(
            self.conn,
            canonical_url="https://repeat.example.org/page",
            domain="repeat.example.org",
            source_id="webring-xxiivv",
            source_family="webring",
            source_url="https://webring.xxiivv.com/",
            status="screened",
        )
        self.assertEqual(kind1, "inserted")
        self.assertEqual(kind2, "existing")
        self.assertEqual(cid1, cid2)
        count = self.conn.execute("SELECT COUNT(*) AS n FROM discovery_candidates").fetchone()["n"]
        self.assertEqual(count, 1)

    def test_reviewed_export_and_reload_never_qualifies_for_launch(self) -> None:
        _kind, candidate_id = stumblr_db.upsert_candidate(
            self.conn,
            canonical_url="https://review.example.org/page",
            domain="review.example.org",
            source_id="fixture",
            source_family="test",
            source_url="https://source.example.org/",
            status="pending_review",
            topics=["art"],
            link_text="Review fixture",
        )
        stumblr_db.transition_candidate_review(
            self.conn,
            candidate_id,
            "reviewed_exportable",
            actor="human-reviewer",
            note="Browser checked",
        )
        export_path = Path(self.tmp.name) / "reviewed.json"
        exported = stumblr_db.export_reviewed_candidates(self.conn, export_path)
        self.assertEqual(exported, 1)
        payload = json.loads(export_path.read_text())
        self.assertEqual(payload["candidates"][0]["catalogue_status"], "evaluation_only")
        self.assertNotIn("launch_approved", export_path.read_text())

        reload_path = Path(self.tmp.name) / "reloaded.sqlite"
        reloaded = stumblr_db.connect(reload_path)
        try:
            self.assertEqual(stumblr_db.reload_reviewed_export(reloaded, export_path), 1)
            row = reloaded.execute(
                "SELECT status FROM discovery_candidates WHERE canonical_url = ?",
                ("https://review.example.org/page",),
            ).fetchone()
            self.assertEqual(row["status"], "reviewed_exportable")
        finally:
            reloaded.close()

        history = self.conn.execute(
            "SELECT from_status, to_status, actor FROM review_history WHERE entity_id = ?",
            (candidate_id,),
        ).fetchone()
        self.assertEqual(dict(history), {
            "from_status": "pending_review",
            "to_status": "reviewed_exportable",
            "actor": "human-reviewer",
        })

    def test_selected_artifact_ingest_creates_review_queue_without_qualification(self) -> None:
        artifact = Path(self.tmp.name) / "selected.json"
        artifact.write_text(json.dumps([
            {
                "canonical_url": "https://queued.example.org/play",
                "domain": "queued.example.org",
                "source_id": "fixture-source",
                "source_family": "fixture-family",
                "source_url": "https://source.example.org/",
                "title_hint": "Queued example",
                "topics": ["games"],
                "selection_status": "evaluation_candidate",
                "availability_status": 200,
                "x_frame_options": None,
                "content_security_policy": None,
            },
            {
                "canonical_url": "https://blocked.example.org/",
                "domain": "blocked.example.org",
                "source_id": "fixture-source",
                "source_family": "fixture-family",
                "source_url": "https://source.example.org/",
                "title_hint": "Blocked example",
                "topics": ["games"],
                "selection_status": "blocked",
                "availability_status": 200,
                "x_frame_options": "DENY",
                "content_security_policy": None,
            },
        ]))
        result = review_queue.ingest_selected_artifact(self.conn, artifact)
        self.assertEqual(result, {"inserted": 2, "existing": 0})
        counts = review_queue.queue_counts(self.conn)
        self.assertEqual(counts, {"pending_review": 1, "quarantined": 1})

    def test_lease_overlap_and_checkpoint_resume(self) -> None:
        run_id = stumblr_db.start_run(self.conn, "worker-a", lease_ttl_sec=120)
        self.assertTrue(stumblr_db.try_acquire_lease(self.conn, run_id, "worker-a"))
        self.assertFalse(stumblr_db.try_acquire_lease(self.conn, run_id, "worker-b"))
        stumblr_db.checkpoint_run(self.conn, run_id, {"source_index": 3}, {"accepted": 5})
        self.assertEqual(stumblr_db.get_checkpoint(self.conn, run_id)["source_index"], 3)
        stumblr_db.finish_run(self.conn, run_id, "succeeded", {"accepted": 5})
        row = self.conn.execute("SELECT status, lease_owner FROM discovery_runs WHERE id = ?", (run_id,)).fetchone()
        self.assertEqual(row["status"], "succeeded")
        self.assertIsNone(row["lease_owner"])

    def test_redirect_hop_rejects_private_target(self) -> None:
        with self.assertRaises(Exception):
            disc.assert_url_public_https("http://example.org/")
        with mock.patch.object(disc, "resolve_public_ip", return_value=(False, "disallowed_ip:127.0.0.1")):
            with self.assertRaises(Exception):
                disc.assert_url_public_https("https://evil.example/")

    def test_guarded_dns_diagnostic_is_preserved_in_screening_telemetry(self) -> None:
        with mock.patch.object(
            disc,
            "resolve_public_ip",
            return_value=(False, "disallowed_ip:198.18.0.1"),
        ):
            result = disc.screen_url("https://ordinary-source.example/page")
        self.assertIn("disallowed_ip:198.18.0.1", result["error"])

    def test_configured_sources_never_contradict_host_denylist(self) -> None:
        configured = list(disc.SOURCE_CONFIG)
        configured.extend(
            json.loads((REPO_ROOT / "docs/catalogue/discovery_sources.json").read_text())
        )
        incompatible = [
            source["url"]
            for source in configured
            if disc.host_is_disallowed(urllib.parse.urlparse(source["url"]).hostname or "")
        ]
        self.assertEqual(incompatible, [])

    def test_interleave_prevents_leading_family_monopoly_order(self) -> None:
        sources = [
            {"id": "w1", "source_family": "webring"},
            {"id": "w2", "source_family": "webring"},
            {"id": "w3", "source_family": "webring"},
            {"id": "e1", "source_family": "educational"},
            {"id": "a1", "source_family": "archives"},
            {"id": "n1", "source_family": "novelty-list"},
        ]
        ordered = disc.interleave_sources_by_family(sources)
        families = [item[1]["source_family"] for item in ordered]
        # First three slots should cover three distinct families, not three webrings.
        self.assertEqual(len(set(families[:3])), 3)
        self.assertIn("educational", families[:3])
        self.assertIn("archives", families[:3])

    def test_directory_parser_filters_navigation_before_outbound_candidate_budgeting(self) -> None:
        html = "".join(
            [f'<a href="/category/{index}">category {index}</a>' for index in range(20)]
            + [
                '<a href="https://first.example/">first site</a>',
                '<a href="https://second.example/">second site</a>',
            ]
        )
        self.assertEqual(
            disc.parse_external_html_links(html, "https://directory.example/"),
            [
                ("first site", "https://first.example/"),
                ("second site", "https://second.example/"),
            ],
        )

    def test_robots_parser_enforces_disallow_and_high_crawl_delay(self) -> None:
        parsed = disc.parse_robots_txt(
            "User-agent: *\nDisallow: /private\nCrawl-delay: 1000\n"
        )
        self.assertEqual(
            parsed["groups"],
            [
                {
                    "agents": ["*"],
                    "rules": [{"kind": "disallow", "path": "/private"}],
                    "crawl_delay": 1000.0,
                }
            ],
        )
        with mock.patch.object(
            disc,
            "fetch_robots_record",
            return_value={"fetched": True, "disallows": ["/api/"], "crawl_delay": None},
        ):
            ok, reason = disc.robots_allows("https://example.org/api/secret")
            self.assertFalse(ok)
            self.assertIn("robots_disallow:/api/", reason)
        with mock.patch.object(
            disc,
            "fetch_robots_record",
            return_value={"fetched": True, "disallows": [], "crawl_delay": 1000},
        ):
            ok, reason = disc.robots_allows("https://curlie.example.org/")
            self.assertFalse(ok)
            self.assertIn("robots_crawl_delay_too_high", reason)

    def test_robots_prefers_bot_specific_group_and_longest_allow_rule(self) -> None:
        parsed = disc.parse_robots_txt(
            "User-agent: *\n"
            "Disallow:\n"
            "User-agent: StumblrDiscoveryBot\n"
            "Disallow: /private\n"
            "Allow: /private/public\n"
        )
        with mock.patch.object(disc, "fetch_robots_record", return_value=parsed):
            self.assertEqual(
                disc.robots_allows("https://example.org/private/public/page"),
                (True, "ok"),
            )
            allowed, reason = disc.robots_allows("https://example.org/private/secret")
            self.assertFalse(allowed)
            self.assertIn("robots_disallow", reason)

    def test_robots_fetch_failure_is_closed(self) -> None:
        with mock.patch.object(
            disc,
            "fetch_robots_record",
            return_value={
                "fetched": False,
                "groups": [],
                "error": "URLError:timeout",
            },
        ):
            self.assertEqual(
                disc.robots_allows("https://example.org/page")[0],
                False,
            )

    def test_robots_404_is_absent_policy_but_5xx_is_fail_closed(self) -> None:
        def response(code: int):
            return urllib.error.HTTPError(
                "https://example.org/robots.txt", code, "fixture", {}, None
            )

        opener = mock.Mock()
        with (
            mock.patch.object(disc, "build_opener", return_value=opener),
            mock.patch.object(disc, "assert_url_public_https"),
        ):
            disc._robots_cache.clear()
            opener.open.side_effect = response(404)
            record = disc.fetch_robots_record("example.org")
            self.assertTrue(record["fetched"])
            self.assertTrue(record["absent"])
            self.assertEqual(disc.robots_allows("https://example.org/page"), (True, "ok"))

            disc._robots_cache.clear()
            opener.open.side_effect = response(503)
            record = disc.fetch_robots_record("example.org")
            self.assertFalse(record["fetched"])
            allowed, reason = disc.robots_allows("https://example.org/page")
            self.assertFalse(allowed)
            self.assertIn("http_error:503", reason)

    def test_unexpected_robots_programming_errors_surface(self) -> None:
        opener = mock.Mock()
        opener.open.side_effect = ValueError("programming defect")
        with (
            mock.patch.object(disc, "build_opener", return_value=opener),
            mock.patch.object(disc, "assert_url_public_https"),
        ):
            disc._robots_cache.clear()
            with self.assertRaisesRegex(ValueError, "programming defect"):
                disc.fetch_robots_record("example.org")
            with mock.patch.object(
                disc, "fetch_robots_record", side_effect=ValueError("screening defect")
            ):
                with self.assertRaisesRegex(ValueError, "screening defect"):
                    disc.screen_url("https://example.org/page")

    def test_candidate_screening_stops_before_fetch_when_robots_denies(self) -> None:
        with (
            mock.patch.object(disc, "robots_allows", return_value=(False, "robots_disallow:/")),
            mock.patch.object(disc, "build_opener") as build_opener,
        ):
            result = disc.screen_url("https://example.org/private")
        self.assertFalse(result["available"])
        self.assertEqual(result["error"], "robots_disallow")
        build_opener.assert_not_called()

    def test_screening_refuses_overlong_and_malformed_terminal_urls(self) -> None:
        base = "https://example.org/"
        response = mock.Mock(status=200, headers={"content-type": "text/html"})
        response.read.return_value = b"<title>Example page</title>"
        opener = mock.MagicMock()
        opener.open.return_value.__enter__.return_value = response
        with (
            mock.patch.object(disc, "robots_allows", return_value=(True, "ok")),
            mock.patch.object(disc, "resolve_public_ip", return_value=(True, "ok")),
            mock.patch.object(disc, "build_opener", return_value=opener),
        ):
            response.geturl.return_value = base.ljust(16_384, "q")
            self.assertTrue(disc.screen_url(base)["available"])
            terminal = "https://Example.ORG:443/a/%2e%2e/landing?key=secret-query&note='text'#private-fragment"
            response.geturl.return_value = terminal
            screen = disc.screen_url(base)
            self.assertEqual(screen["screened_destination"], {
                "final_url_origin": "https://example.org",
                "final_url_sha256": hashlib.sha256(b"https://example.org/landing?key=secret-query&note=%27text%27").hexdigest(),
                "metadata_denied": False,
            })
            self.assertNotIn("secret-query", json.dumps(screen))
            self.assertNotIn("private-fragment", json.dumps(screen))
            response.geturl.return_value = "https://example.org/sign_in?return=hidden"
            self.assertTrue(disc.screen_url(base)["screened_destination"]["metadata_denied"])
            for terminal in (base.ljust(16_385, "q"), "https://user@example.org/", "https://example.org:8080/"):
                with self.subTest(terminal=terminal[:50]):
                    response.geturl.return_value = terminal
                    self.assertFalse(disc.screen_url(base)["available"])

    def test_reflected_title_url_forms_are_removed_without_losing_title(self) -> None:
        for value in ("https://new.example/private?token=fixture#fragment", "/private-path", "?token=fixture", "#fragment", "archive/private", "archive?token=fixture", "archive#fragment"):
            with self.subTest(value=value):
                self.assertEqual(disc.sanitize_title(f"Forgotten tramways atlas [{value}]"), "Forgotten tramways atlas")

    def test_reflected_terminal_url_does_not_reach_collector_artifacts_or_queue(self) -> None:
        canonical = "https://new.example/start"
        terminal = "https://new.example/private-path?token=fixture#fragment"
        source = {"id": "fixture-directory", "kind": "html", "url": "https://source.example/",
                  "topic_hint": "culture", "source_family": "indie-directory"}
        response = mock.Mock(status=200, headers={
            "content-type": "text/html",
            "content-security-policy": f"report-uri {terminal}",
            "x-frame-options": f"unsupported {terminal}",
        })
        response.geturl.return_value = terminal
        response.read.return_value = b"<title>Forgotten tramways atlas [/private-path?token=fixture#fragment]</title>"
        opener = mock.MagicMock()
        opener.open.return_value.__enter__.return_value = response
        with (
            tempfile.TemporaryDirectory() as output_dir,
            mock.patch.object(disc, "SOURCE_CONFIG", [source]),
            mock.patch.object(disc, "load_existing_catalogue_keys", return_value=(set(), set())),
            mock.patch.object(disc, "robots_allows", return_value=(True, "ok")),
            mock.patch.object(disc, "fetch_text", return_value=f'<a href="{canonical}">Atlas</a>'),
            mock.patch.object(disc, "resolve_public_ip", return_value=(True, "ok")),
            mock.patch.object(disc, "build_opener", return_value=opener),
            mock.patch.object(sys, "argv", ["discover", "--max-candidates", "4", "--output-dir", output_dir]),
        ):
            self.assertEqual(disc.main(), 0)
            for artifact in Path(output_dir).glob("*.json"):
                self.assertNotIn("/private-path?token=fixture#fragment", artifact.read_text(), artifact.name)
            selected = json.loads((Path(output_dir) / "discovery_selected.json").read_text())
            self.assertEqual(selected[0]["title_hint"], "Website at new.example")
            self.assertFalse(selected[0]["framing"]["denied"])
            self.assertTrue(selected[0]["framing"]["csp_present"])
            stored = self.conn.execute("SELECT link_text, screen_json FROM discovery_candidates WHERE canonical_url=?", (canonical,)).fetchone()
            self.assertNotIn("/private-path?token=fixture#fragment", json.dumps(dict(stored)))

    def test_parenthesized_redirect_components_never_reach_artifacts_or_queue(self) -> None:
        canonical = "https://new.example/start"
        source = {"id": "fixture-directory", "kind": "html", "url": "https://source.example/",
                  "topic_hint": "culture", "source_family": "indie-directory"}
        for suffix, secret in (("/(fixture-private-path)", "fixture-private-path"),
                               ("?(fixture-private-query)", "fixture-private-query"),
                               ("#(fixture-private-fragment)", "fixture-private-fragment")):
            with self.subTest(suffix=suffix), tempfile.TemporaryDirectory() as output_dir:
                response = mock.Mock(status=200, headers={"content-type": "text/html"})
                response.geturl.return_value = "https://new.example" + suffix
                response.read.return_value = f"<title>Forgotten tramways atlas {suffix}</title>".encode()
                opener = mock.MagicMock()
                opener.open.return_value.__enter__.return_value = response
                with (mock.patch.object(disc, "SOURCE_CONFIG", [source]),
                      mock.patch.object(disc, "load_existing_catalogue_keys", return_value=(set(), set())),
                      mock.patch.object(disc, "robots_allows", return_value=(True, "ok")),
                      mock.patch.object(disc, "fetch_text", return_value=f'<a href="{canonical}">Atlas {suffix}</a>'),
                      mock.patch.object(disc, "resolve_public_ip", return_value=(True, "ok")),
                      mock.patch.object(disc, "build_opener", return_value=opener),
                      mock.patch.object(sys, "argv", ["discover", "--max-candidates", "4", "--output-dir", output_dir])):
                    self.assertEqual(disc.main(), 0)
                for artifact in Path(output_dir).glob("*.json"):
                    self.assertNotIn(secret, artifact.read_text(), artifact.name)
                selected = json.loads((Path(output_dir) / "discovery_selected.json").read_text())
                self.assertTrue(selected[0]["title_signals"]["quality"])
                self.assertFalse(selected[0]["title_signals"]["denied"])
                self.assertRegex(selected[0]["title_signals"]["digest"], r"^[0-9a-f]{64}$")
                self.assertEqual(selected[0]["title_hint"], "Website at new.example")
                stored = self.conn.execute("SELECT link_text, screen_json FROM discovery_candidates WHERE canonical_url=?", (canonical,)).fetchone()
                self.assertNotIn(secret, json.dumps(dict(stored)))
                self.conn.execute("DELETE FROM discovery_candidates WHERE canonical_url=?", (canonical,))

    def test_redirect_title_editorial_classification_is_bounded(self) -> None:
        url = "https://new.example/start"
        response = mock.Mock(status=200, headers={"content-type": "text/html"})
        response.geturl.return_value = "https://new.example/?(fixture-private-query)"
        response.read.return_value = b"<title>Online store buy now ?(fixture-private-query)</title>"
        opener = mock.MagicMock()
        opener.open.return_value.__enter__.return_value = response
        with (mock.patch.object(disc, "robots_allows", return_value=(True, "ok")),
              mock.patch.object(disc, "resolve_public_ip", return_value=(True, "ok")),
              mock.patch.object(disc, "build_opener", return_value=opener)):
            screen = disc.screen_url(url)
        self.assertEqual(screen["title_signals"], {"quality": True, "denied": True})
        self.assertNotIn("fixture-private-query", json.dumps(screen))

    def test_unredirected_screen_keeps_safe_title(self) -> None:
        url = "https://new.example/start"
        response = mock.Mock(status=200, headers={"content-type": "text/html"})
        response.geturl.return_value = url
        response.read.return_value = b"<title>Forgotten tramways atlas</title>"
        opener = mock.MagicMock()
        opener.open.return_value.__enter__.return_value = response
        with (mock.patch.object(disc, "robots_allows", return_value=(True, "ok")),
              mock.patch.object(disc, "resolve_public_ip", return_value=(True, "ok")),
              mock.patch.object(disc, "build_opener", return_value=opener)):
            self.assertEqual(disc.screen_url(url)["title_hint"], "Forgotten tramways atlas")

    def _screen_redirect(self, final: str) -> dict:
        response = mock.Mock(status=200, headers={"content-type": "text/html"})
        response.geturl.return_value = final
        response.read.return_value = b"<title>Forgotten tramways atlas</title>"
        opener = mock.MagicMock()
        opener.open.return_value.__enter__.return_value = response
        with (mock.patch.object(disc, "robots_allows", return_value=(True, "ok")),
              mock.patch.object(disc, "resolve_public_ip", return_value=(True, "ok")),
              mock.patch.object(disc, "build_opener", return_value=opener)):
            return disc.screen_url("https://new.example/start")

    def test_plain_same_site_redirect_is_adopted_with_its_title(self) -> None:
        for final in ("https://new.example/en/", "https://www.new.example/", "https://new.example/atlas/tramways"):
            with self.subTest(final=final):
                screen = self._screen_redirect(final)
                self.assertEqual(screen["adopted_url"], final)
                self.assertFalse(screen["redirected"])
                self.assertEqual(screen["title_hint"], "Forgotten tramways atlas")

    def test_opaque_redirects_are_not_adopted(self) -> None:
        for final in ("https://new.example/en/?session=abc", "https://new.example/#private", "https://other.example/",
                      "https://new.example/reset/9f8e7d6c5b4a39281716", "https://new.example/a/b/c/d",
                      "https://new.example:8443/", "https://new.example/(private)"):
            with self.subTest(final=final):
                screen = self._screen_redirect(final)
                self.assertNotIn("adopted_url", screen)
                self.assertIsNone(screen["title_hint"])
                if screen["error"] is None:
                    self.assertTrue(screen["redirected"])

    def test_redirect_handler_rechecks_destination_robots(self) -> None:
        handler = disc.SafeRedirectHandler(enforce_robots=True)
        with mock.patch.object(disc, "robots_allows", return_value=(False, "robots_disallow:/sink")):
            with self.assertRaises(urllib.error.URLError):
                handler.redirect_request(
                    mock.Mock(),
                    mock.Mock(),
                    302,
                    "Found",
                    {},
                    "https://example.org/sink",
                )

    def test_sources_cover_requested_intents_families_and_categories(self) -> None:
        source_ids = {source["id"] for source in disc.SOURCE_CONFIG}
        source_urls = {source["url"] for source in disc.SOURCE_CONFIG}
        families = {source["source_family"] for source in disc.SOURCE_CONFIG}
        topic_hints = {source["topic_hint"] for source in disc.SOURCE_CONFIG}

        self.assertIn("https://theuselessweb.com/sites/", source_urls)
        self.assertIn("bored-button-random", source_ids)
        self.assertTrue(
            {
                "https://1mb.club/",
                "https://10kb.club/",
                "https://ooh.directory/",
                "https://theindex.fyi/",
            }.issubset(source_urls)
        )
        self.assertGreaterEqual(len(families), 8)
        self.assertTrue(
            {"art", "science", "games", "culture", "archives", "education"}.issubset(topic_hints)
        )

    def test_category_inference_keeps_source_hint_and_detects_content(self) -> None:
        topics = disc.infer_topics(
            ["Interactive astronomy map and museum archive"],
            "education",
        )
        self.assertIn("science", topics)
        self.assertIn("maps", topics)
        self.assertIn("education", topics)

    def test_discovery_selection_status_is_never_launch_approved(self) -> None:
        self.assertEqual(disc.selection_status_for_screening({}), "evaluation_candidate")
        self.assertEqual(
            disc.selection_status_for_screening({"x_frame_options": "DENY"}),
            "blocked",
        )
        self.assertNotEqual(disc.selection_status_for_screening({}), "launch_approved")
        self.assertEqual(disc.queue_status_for_screening({"available": True}), "pending_review")
        self.assertEqual(
            disc.queue_status_for_screening({"available": True, "x_frame_options": "DENY"}),
            "quarantined",
        )

    def test_feed_seen_before_homepage_does_not_suppress_usable_domain_candidate(self) -> None:
        source = {
            "id": "fixture-directory",
            "kind": "html",
            "url": "https://source.example/",
            "topic_hint": "culture",
            "source_family": "indie-directory",
        }
        html = (
            '<a href="https://new.example/feed.xml">feed</a>'
            '<a href="https://new.example/">homepage</a>'
        )
        with tempfile.TemporaryDirectory() as output_dir:
            with (
                mock.patch.object(disc, "SOURCE_CONFIG", [source]),
                mock.patch.object(disc, "load_existing_catalogue_keys", return_value=(set(), set())),
                mock.patch.object(disc, "robots_allows", return_value=(True, "ok")),
                mock.patch.object(disc, "fetch_text", return_value=html),
                mock.patch.object(disc, "resolve_public_ip", return_value=(True, "ok")),
                mock.patch.object(
                    disc,
                    "screen_url",
                    return_value={
                        "available": True,
                        "status": 200,
                        "screened_destination": {
                            "final_url_origin": "https://new.example",
                            "final_url_sha256": "a" * 64,
                            "metadata_denied": False,
                        },
                        "elapsed_ms": 1,
                        "x_frame_options": None,
                        "content_security_policy": None,
                        "content_type": "text/html",
                        "server": None,
                        "title_hint": "New example",
                        "error": None,
                    },
                ) as screen,
                mock.patch.object(
                    sys,
                    "argv",
                    ["discover", "--skip-db", "--max-candidates", "4", "--output-dir", output_dir],
                ),
            ):
                self.assertEqual(disc.main(), 0)

            selected = json.loads((Path(output_dir) / "discovery_selected.json").read_text())
            self.assertEqual([row["canonical_url"] for row in selected], ["https://new.example/"])
            self.assertEqual(selected[0]["screened_destination"], {
                "final_url_origin": "https://new.example", "final_url_sha256": "a" * 64, "metadata_denied": False,
            })
            self.assertNotIn("screened_final_url", selected[0])
            screen.assert_called_once_with("https://new.example/")

    def test_known_feed_url_does_not_block_a_distinct_homepage_on_the_same_unpublished_domain(self) -> None:
        source = {
            "id": "fixture-directory",
            "kind": "html",
            "url": "https://source.example/",
            "topic_hint": "culture",
            "source_family": "indie-directory",
        }
        with tempfile.TemporaryDirectory() as output_dir:
            known_path = Path(output_dir) / "known.json"
            known_path.write_text(json.dumps(["https://new.example/feed.xml"]))
            with (
                mock.patch.object(disc, "SOURCE_CONFIG", [source]),
                mock.patch.object(disc, "load_existing_catalogue_keys", return_value=(set(), set())),
                mock.patch.object(disc, "robots_allows", return_value=(True, "ok")),
                mock.patch.object(
                    disc,
                    "fetch_text",
                    return_value='<a href="https://new.example/">homepage</a>',
                ),
                mock.patch.object(disc, "resolve_public_ip", return_value=(True, "ok")),
                mock.patch.object(
                    disc,
                    "screen_url",
                    return_value={
                        "available": True,
                        "status": 200,
                        "final_url": "https://new.example/",
                        "elapsed_ms": 1,
                        "x_frame_options": None,
                        "content_security_policy": None,
                        "content_type": "text/html",
                        "server": None,
                        "title_hint": "New example",
                        "error": None,
                    },
                ),
                mock.patch.object(
                    sys,
                    "argv",
                    [
                        "discover",
                        "--skip-db",
                        "--max-candidates",
                        "4",
                        "--known-urls",
                        str(known_path),
                        "--output-dir",
                        output_dir,
                    ],
                ),
            ):
                self.assertEqual(disc.main(), 0)

            selected = json.loads((Path(output_dir) / "discovery_selected.json").read_text())
            self.assertEqual([row["canonical_url"] for row in selected], ["https://new.example/"])

    def test_explicit_feed_content_is_quarantined_instead_of_queued_for_review(self) -> None:
        feed = {
            "available": True,
            "status": 200,
            "content_type": "application/rss+xml; charset=utf-8",
        }
        html = {
            "available": True,
            "status": 200,
            "content_type": "text/html; charset=utf-8",
        }
        self.assertFalse(disc.screening_content_is_playable(feed))
        self.assertEqual(disc.queue_status_for_screening(feed), "quarantined")
        self.assertTrue(disc.screening_content_is_playable(html))
        self.assertEqual(disc.queue_status_for_screening(html), "pending_review")

    def test_family_quota_uses_ceiling_so_new_source_families_do_not_reduce_batch_capacity(self) -> None:
        self.assertEqual(disc.family_batch_quota("blog-directory", 24, 10), 3)


if __name__ == "__main__":
    unittest.main()
