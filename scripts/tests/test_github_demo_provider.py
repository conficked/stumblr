"""Bounded API discovery and guarded demo integration contracts."""
import contextlib
from email.message import Message
import io
import json
import os
from pathlib import Path
import sys
import subprocess
import tempfile
import unittest
import urllib.error
import urllib.parse
import urllib.response
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import github_demo_provider as provider
import discover_catalogue_candidates as disc


def repository(identity=1, homepage="https://demo.example/play", **overrides):
    return {"id": identity, "full_name": f"Owner/Toy{identity}",
            "html_url": f"https://github.com/Owner/Toy{identity}", "homepage": homepage,
            "description": "Interactive art toy", "topics": ["Art", "interactive"],
            "stargazers_count": 12, "pushed_at": "2026-11-01T00:00:00Z",
            "archived": False, **overrides}


def response(items, total=None, incomplete=False):
    payload = {"items": items, "total_count": len(items) if total is None else total,
               "incomplete_results": incomplete}
    result = mock.MagicMock()
    result.__enter__.return_value = result
    result.read.return_value = json.dumps(payload).encode()
    return result


def collect_fixture(homepages, known_url=None, available=True, *, repository_start=1):
    """Run the real collector with a bounded provider fixture; return its import artifacts."""
    import stumblr_db
    with tempfile.TemporaryDirectory() as tmp, contextlib.ExitStack() as stack:
        root = Path(tmp)
        db_path = root / "ops.sqlite"
        if known_url:
            conn = stumblr_db.connect(db_path)
            stumblr_db.upsert_candidate(conn, canonical_url=known_url, domain=urllib.parse.urlparse(known_url).hostname,
                source_id="directory", source_family="directory", source_url="https://source.example/", status="reviewed_exportable")
            conn.close()
        leads = [{"repository_id": identity, "repository_full_name": f"owner/toy{identity}",
            "repository_url": f"https://github.com/owner/toy{identity}", "demo_url": homepage,
            "description": "Interactive toy", "topics": ["art"], "stars": identity,
            "pushed_at": "2026-11-01T00:00:00Z", "archived": False, "source_query": "fixture"}
            for identity, homepage in enumerate(homepages, repository_start)]
        stack.enter_context(mock.patch.object(disc, "SOURCE_CONFIG", [{"id": "github-live-demo", "kind": "github_repositories",
            "url": "https://api.github.com/search/repositories", "topic_hint": "art", "source_family": "github-live-demo"}]))
        stack.enter_context(mock.patch.object(provider, "collect_github_demo_leads", return_value=(leads, {"error": None})))
        stack.enter_context(mock.patch.object(disc, "load_existing_catalogue_keys", return_value=({known_url} if known_url else set(), set())))
        stack.enter_context(mock.patch.object(disc, "resolve_public_ip", return_value=(True, "ok")))
        stack.enter_context(mock.patch.object(disc, "screen_url", return_value={"available": available, "status": 200,
            "x_frame_options": None, "content_security_policy": None, "title_hint": "Toy"}))
        stack.enter_context(mock.patch.object(sys, "argv", ["discover", "--db-path", str(db_path), "--output-dir", tmp]))
        stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
        if disc.main() != 0:
            raise AssertionError("collector failed")
        conn = stumblr_db.connect(db_path)
        try:
            local_ids = sorted(stumblr_db.discovery_identity_snapshot(conn)["known_repository_ids"])
        finally:
            conn.close()
        associations = root / "discovery_associations.json"
        return {"selected": json.loads((root / "discovery_selected.json").read_text()),
            "associations": json.loads(associations.read_text()) if associations.exists() else [], "local_ids": local_ids,
            "rejected": json.loads((root / "discovery_rejected.json").read_text()),
            "summary": json.loads((root / "discovery_summary.json").read_text())}


def collect_homepage_correction_fixture():
    """Produce unchanged repository metadata across a path correction and a fresh replay."""
    old = collect_fixture(["https://demo.example/old-play"])
    corrected = collect_fixture(["https://demo.example/play"])
    replay = collect_fixture(["https://demo.example/play"])
    # Two harvests stay below the collector's per-topic selection cap. Put the
    # corrected row last in a full import chunk to catch rollback of its peers.
    peers = [f"https://peer{index}.example/play" for index in range(23)]
    first = collect_fixture(peers[:12], repository_start=2)
    second = collect_fixture(peers[12:], repository_start=14)
    return {"old": old, "corrected": corrected, "replay": replay,
        "chunk": first["selected"] + second["selected"] + corrected["selected"]}


UNSUITABLE_HOMEPAGES = [
    "https://demo.example:8443/", "https://127.0.0.1/", "https://[::1]/", "https://demo.example./",
    "http://demo.example/", "https://user:sentinel-secret@demo.example/", "https://@demo.example/",
    "https://bad_host.example/", "https://bad..example/", "https://-bad.example/",
    "https://demo.example:/", "https://demo.example/\\evil", "https://demo.example/\nsecret",
    "https://demo.example/%0Asecret", "https://demo.example/%zz", "https://demo%2eexample/",
]

class GitHubProviderTests(unittest.TestCase):
    def test_provider_rejects_unsafe_homepage_forms_and_normalizes_default_https_port(self):
        with mock.patch.object(provider.urllib.request.OpenerDirector, "open", return_value=response(
            [repository(index + 1, homepage) for index, homepage in enumerate(UNSUITABLE_HOMEPAGES)]
            + [repository(100, "https://Demo.Example:443/play")]
        )):
            leads, stats = provider.collect_github_demo_leads("fixture", ["q"], 25)
        self.assertEqual([lead["demo_url"] for lead in leads], ["https://demo.example/play"])
        self.assertEqual(leads[0]["raw_homepage"], "https://Demo.Example:443/play")
        self.assertEqual(stats["rejected_homepages"], len(UNSUITABLE_HOMEPAGES))
        self.assertNotIn("sentinel-secret", json.dumps(stats))

    def test_authenticated_api_redirects_never_make_a_second_request(self):
        real_build_opener = provider.urllib.request.build_opener
        for code in [301, 302, 303, 307, 308]:
            for destination in ["https://other.example/token-sink", "http://api.github.com/token-sink"]:
                with self.subTest(code=code, destination=destination):
                    requested_urls = []

                    class Transport(provider.urllib.request.BaseHandler):
                        handler_order = 100

                        def https_open(self, request):
                            requested_urls.append(request.full_url)
                            headers = Message()
                            headers["Location"] = destination
                            status = code if len(requested_urls) == 1 else 200
                            body = json.dumps({"items": [], "total_count": 0, "incomplete_results": False}).encode()
                            reply = urllib.response.addinfourl(io.BytesIO(body), headers, request.full_url, status)
                            reply.msg = "fixture response"
                            return reply

                        http_open = https_open

                    transport = Transport()
                    def build_opener(*handlers):
                        return real_build_opener(transport, *handlers)

                    with (
                        mock.patch.object(provider.urllib.request, "_opener", None),
                        mock.patch.object(provider.urllib.request, "build_opener", side_effect=build_opener),
                    ):
                        leads, stats = provider.collect_github_demo_leads("fixture-token", ["q"], 25)
                    self.assertEqual(len(requested_urls), 1, requested_urls)
                    self.assertEqual(leads, [])
                    self.assertEqual(stats["error"], f"http_error:{code}")
                    self.assertNotIn("fixture-token", json.dumps(stats))

    def test_authenticated_pagination_respects_repository_and_query_bounds(self):
        requests = []
        def api(request, timeout):
            params = urllib.parse.parse_qs(urllib.parse.urlsplit(request.full_url).query)
            requests.append(params)
            self.assertEqual(request.get_header("Authorization"), "Bearer fixture-token")
            self.assertEqual(request.get_header("Accept"), "application/vnd.github+json")
            self.assertEqual(request.get_header("X-github-api-version"), "2022-11-28")
            self.assertEqual(timeout, 8)
            # Simulate short pages to exercise the per-query result ceiling.
            return response([repository(len(requests))], total=100)
        with mock.patch.object(provider.urllib.request.OpenerDirector, "open", side_effect=api):
            leads, stats = provider.collect_github_demo_leads("fixture-token", ["q1", "q2", "q3", "q4", "q5"], 200)
        self.assertEqual(len(requests), 100)
        self.assertEqual({p["q"][0] for p in requests}, {"q1", "q2", "q3", "q4"})
        self.assertEqual(len(leads), 100)
        self.assertEqual(stats["repositories_inspected"], 100)
        self.assertTrue(all(int(p["per_page"][0]) <= 25 for p in requests))
        with mock.patch.object(provider.urllib.request.OpenerDirector, "open", return_value=response([repository(1), repository(2), repository(3)])) as api:
            leads, stats = provider.collect_github_demo_leads("fixture-token", ["q1", "q2"], 2)
        self.assertEqual(len(leads), 2)
        self.assertEqual(stats["repositories_inspected"], 2)
        self.assertEqual(api.call_count, 1)

    def test_normalizes_identity_and_deduplicates_repositories(self):
        with mock.patch.object(provider.urllib.request.OpenerDirector, "open", side_effect=[
            response([repository("42", full_name=" Owner/Toy ")]),
            response([repository(42, full_name="OWNER/TOY")]),
        ]):
            leads, stats = provider.collect_github_demo_leads("token", ["first", "second"], 25)
        self.assertEqual(leads, [{"repository_id": 42, "repository_full_name": "owner/toy",
            "repository_url": "https://github.com/owner/toy", "demo_url": "https://demo.example/play",
            "raw_homepage": "https://demo.example/play", "description": "Interactive art toy", "topics": ["art", "interactive"], "stars": 12,
            "pushed_at": "2026-11-01T00:00:00Z", "archived": False, "source_query": "first"}])
        self.assertEqual(stats["repository_leads"], 1)
        self.assertEqual(stats["distinct_demo_domains"], 1)

    def test_rejects_missing_repository_store_donation_and_docs_homepages(self):
        invalid = [None, "", "https://github.com/owner/repo", "https://www.github.com/owner/repo",
            "https://apps.apple.com/app/toy", "https://play.google.com/store/apps/toy",
            "https://store.steampowered.com/app/42", "https://ko-fi.com/toy", "https://patreon.com/toy",
            "https://buymeacoffee.com/toy", "https://opencollective.com/toy", "https://toy.readthedocs.io/",
            "https://docs.toy.example/", "https://toy.example/docs/intro", "https://toy.example/documentation",
            "https://toy.example/shop", "javascript:alert(1)"]
        with mock.patch.object(provider.urllib.request.OpenerDirector, "open", return_value=response(
            [repository(i+1, url) for i, url in enumerate(invalid)] + [repository(100, "https://owner.github.io/toy/")]
        )):
            leads, stats = provider.collect_github_demo_leads("token", ["q"], 25)
        self.assertEqual([lead["demo_url"] for lead in leads], ["https://owner.github.io/toy/"])
        self.assertEqual(stats["rejected_homepages"], len(invalid))

    def test_incomplete_or_malformed_search_discards_partial_leads(self):
        malformed = mock.MagicMock()
        malformed.__enter__.return_value = malformed
        malformed.read.return_value = b'{not json'
        for bad, reason in [(response([], incomplete=True), "incomplete_results"), (malformed, "invalid_response")]:
            with self.subTest(reason=reason), mock.patch.object(provider.urllib.request.OpenerDirector, "open", side_effect=[response([repository()]), bad]):
                leads, stats = provider.collect_github_demo_leads("token", ["first", "second"], 25)
            self.assertEqual(leads, [])
            self.assertEqual(stats["error"], reason)
            self.assertEqual(stats["repository_leads"], 0)

    def test_rate_limits_fail_closed_without_token_or_error_body(self):
        for code in [403, 429]:
            error = urllib.error.HTTPError("https://api.github.com/search/repositories", code, "secret-token", {}, None)
            with mock.patch.object(provider.urllib.request.OpenerDirector, "open", side_effect=[response([repository()]), error]) as api:
                leads, stats = provider.collect_github_demo_leads("secret-token", ["a", "b", "c"], 25)
            self.assertEqual(leads, [])
            self.assertEqual(stats["error"], f"http_error:{code}")
            self.assertNotIn("secret-token", json.dumps(stats))
            self.assertEqual(api.call_count, 2)

    def test_missing_token_and_zero_budget_never_request(self):
        with mock.patch.object(provider.urllib.request.OpenerDirector, "open") as api:
            self.assertEqual(provider.collect_github_demo_leads("", ["a"], 25)[0], [])
            self.assertEqual(provider.collect_github_demo_leads("token", ["a"], 0)[0], [])
        api.assert_not_called()


class GitHubCollectorTests(unittest.TestCase):
    def test_corrected_homepage_artifacts_keep_quarantine_and_replay_identity_in_python(self):
        import catalogue_review_queue
        import stumblr_db
        artifacts = collect_homepage_correction_fixture()
        old = artifacts["old"]["selected"][0]
        corrected = artifacts["corrected"]["selected"][0]
        replay = artifacts["replay"]["selected"][0]
        self.assertEqual(len(artifacts["chunk"]), 24)
        def metadata(row):
            return {key: value for key, value in row["provenance"].items()
                if key not in {"demo_url", "raw_homepage"}}
        self.assertEqual(metadata(old), metadata(corrected))
        with tempfile.TemporaryDirectory() as tmp:
            conn = stumblr_db.connect(Path(tmp) / "import.sqlite")
            def ingest(name, rows):
                artifact = Path(tmp) / f"{name}.json"
                artifact.write_text(json.dumps(rows))
                return catalogue_review_queue.ingest_selected_artifact(conn, artifact)
            try:
                self.assertEqual(ingest("old", artifacts["old"]["selected"])["inserted"], 1)
                ingest("old-associations", artifacts["old"]["associations"])
                old_id = conn.execute("SELECT id FROM discovery_candidates").fetchone()[0]
                conn.execute("UPDATE discovery_candidates SET status='quarantined' WHERE id=?", (old_id,))
                old_row = dict(conn.execute("SELECT * FROM discovery_candidates WHERE id=?", (old_id,)).fetchone())
                old_association = dict(conn.execute("SELECT * FROM discovery_candidate_repositories WHERE candidate_id=?", (old_id,)).fetchone())
                self.assertEqual(stumblr_db.discovery_identity_snapshot(conn)["known_repository_ids"], set())
                self.assertEqual(ingest("chunk", artifacts["chunk"]), {"inserted": 24, "existing": 0})
                ingest("corrected-associations", artifacts["corrected"]["associations"])
                corrected_id = conn.execute("SELECT id FROM discovery_candidates WHERE canonical_url=?", (corrected["canonical_url"],)).fetchone()[0]
                associations = [dict(row) for row in conn.execute("SELECT * FROM discovery_candidate_repositories ORDER BY candidate_id, repository_id")]
                self.assertEqual(ingest("chunk", artifacts["chunk"]), {"inserted": 0, "existing": 24})
                self.assertEqual(ingest("chunk", artifacts["replay"]["selected"]), {"inserted": 0, "existing": 1})
                ingest("corrected-associations", artifacts["replay"]["associations"])
                self.assertEqual(conn.execute("SELECT COUNT(*) FROM discovery_candidates").fetchone()[0], 25)
                rows = [tuple(row) for row in conn.execute("SELECT id, canonical_url, status FROM discovery_candidates WHERE domain='demo.example' ORDER BY canonical_url")]
                self.assertEqual(rows, [(old_id, "https://demo.example/old-play", "quarantined"),
                    (corrected_id, "https://demo.example/play", "pending_review")])
                self.assertNotEqual(old_id, corrected_id)
                self.assertEqual(dict(conn.execute("SELECT * FROM discovery_candidates WHERE id=?", (old_id,)).fetchone()), old_row)
                self.assertEqual(dict(conn.execute("SELECT * FROM discovery_candidate_repositories WHERE candidate_id=?", (old_id,)).fetchone()), old_association)
                self.assertEqual([dict(row) for row in conn.execute("SELECT * FROM discovery_candidate_repositories ORDER BY candidate_id, repository_id")], associations)
                identity_rows = conn.execute("SELECT candidate_id, provenance_json FROM discovery_candidate_repositories WHERE repository_id='1' ORDER BY candidate_id").fetchall()
                self.assertEqual({row["candidate_id"]: json.loads(row["provenance_json"])["demo_url"] for row in identity_rows},
                    {old_id: "https://demo.example/old-play", corrected_id: "https://demo.example/play"})
                # Python already derives URL-sensitive IDs itself; the artifact
                # must carry that distinction through to the shared importer too.
                self.assertNotEqual(old["id"], corrected["id"])
                self.assertEqual(corrected["id"], replay["id"])
            finally:
                conn.close()

    def test_unsuitable_associations_never_abort_selected_known_or_screened_out_batches(self):
        import catalogue_review_queue
        import stumblr_db
        for known, available in [(None, True), ("https://demo.example/play", True), (None, False)]:
            with self.subTest(known=known, available=available), tempfile.TemporaryDirectory() as tmp:
                artifacts = collect_fixture(UNSUITABLE_HOMEPAGES + ["https://Demo.Example:443/play"], known, available)
                associations = [item for update in artifacts["associations"] for item in update["repository_associations"]]
                self.assertEqual([item["repository_id"] for item in associations], [17])
                self.assertEqual(associations[0]["demo_url"], "https://demo.example/play")
                self.assertEqual(associations[0]["raw_homepage"], "https://Demo.Example:443/play")
                if not known and available:
                    self.assertEqual([row["canonical_url"] for row in artifacts["selected"]], ["https://demo.example/play"])
                else:
                    self.assertEqual(artifacts["selected"], [])
                rejected = [row for row in artifacts["rejected"] if row["reason"] == "invalid_github_association"]
                self.assertEqual(len(rejected), len(UNSUITABLE_HOMEPAGES))
                self.assertNotIn("sentinel-secret", json.dumps(artifacts["rejected"]) + json.dumps(artifacts["summary"]))
                conn = stumblr_db.connect(Path(tmp) / "import.sqlite")
                try:
                    if known:
                        stumblr_db.upsert_candidate(conn, canonical_url=known, domain="demo.example", source_id="fixture",
                            source_family="fixture", source_url="https://source.example/", status="reviewed_exportable")
                    for name in ("selected", "associations"):
                        target = Path(tmp) / (name + ".json")
                        target.write_text(json.dumps(artifacts[name]))
                        catalogue_review_queue.ingest_selected_artifact(conn, target)
                    self.assertEqual(stumblr_db.discovery_identity_snapshot(conn)["known_repository_ids"], {"17"} if available else set())
                    if known:
                        self.assertEqual(conn.execute("SELECT status FROM discovery_candidates").fetchone()[0], "reviewed_exportable")
                finally:
                    conn.close()

    def test_association_artifact_is_bounded_and_emitted_for_an_empty_harvest(self):
        self.assertEqual(collect_fixture([])["associations"], [])
        artifacts = collect_fixture([f"https://demo{index}.example/" for index in range(101)])
        associations = [record for update in artifacts["associations"] for record in update["repository_associations"]]
        self.assertEqual(len(associations), 100)
        self.assertEqual({record["repository_id"] for record in associations}, set(range(1, 101)))

    def test_collector_preserves_shared_url_domain_and_known_destination_associations(self):
        import catalogue_review_queue
        import stumblr_db
        cases = [(["https://demo.example/play"] * 2, None),
            (["https://demo.example/one", "https://demo.example/two"], None),
            (["https://demo.example/play"] * 2, "https://demo.example/play")]
        for homepages, known in cases:
            with self.subTest(homepages=homepages, known=known), tempfile.TemporaryDirectory() as tmp:
                artifacts = collect_fixture(homepages, known)
                self.assertEqual(artifacts["local_ids"], ["1", "2"])
                conn = stumblr_db.connect(Path(tmp) / "shared.sqlite")
                try:
                    if known:
                        stumblr_db.upsert_candidate(conn, canonical_url=known, domain="demo.example", source_id="directory",
                            source_family="directory", source_url="https://source.example/", status="reviewed_exportable")
                    for name in ("selected", "associations"):
                        path = Path(tmp) / (name + ".json")
                        path.write_text(json.dumps(artifacts[name]))
                        catalogue_review_queue.ingest_selected_artifact(conn, path)
                        if name == "selected" and not known:
                            self.assertEqual(stumblr_db.discovery_identity_snapshot(conn)["known_repository_ids"], {"1", "2"})
                    self.assertEqual(stumblr_db.discovery_identity_snapshot(conn)["known_repository_ids"], {"1", "2"})
                    self.assertEqual(conn.execute("SELECT COUNT(*) FROM discovery_candidates").fetchone()[0], 1)
                    if known:
                        self.assertEqual(conn.execute("SELECT status FROM discovery_candidates").fetchone()[0], "reviewed_exportable")
                finally:
                    conn.close()

    def test_collector_can_still_be_invoked_as_a_python_module(self):
        result = subprocess.run([sys.executable, "-m", "scripts.discover_catalogue_candidates", "--help"],
            cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True, timeout=8)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--max-candidates", result.stdout)

    def test_demo_is_guarded_and_repository_metadata_survives_db_provenance(self):
        lead = {"repository_id": 42, "repository_full_name": "owner/toy", "repository_url": "https://github.com/owner/toy",
                "demo_url": "https://demo.example/play", "description": "Interactive toy", "topics": ["art"],
                "stars": 12, "pushed_at": "2026-11-01T00:00:00Z", "archived": False, "source_query": "fixture"}
        with tempfile.TemporaryDirectory() as tmp, contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(disc, "SOURCE_CONFIG", [{"id": "github-live-demo", "kind": "github_repositories",
                "url": "https://api.github.com/search/repositories", "topic_hint": "art", "source_family": "github-live-demo"}]))
            stack.enter_context(mock.patch.dict(os.environ, {"GITHUB_TOKEN": "fixture-token"}))
            stack.enter_context(mock.patch.object(provider, "collect_github_demo_leads", return_value=([lead, {**lead, "repository_id": 43}],
                {"repository_leads": 2, "repositories_inspected": 2, "distinct_demo_domains": 1, "error": None})))
            stack.enter_context(mock.patch.object(disc, "load_existing_catalogue_keys", return_value=(set(), set())))
            dns = stack.enter_context(mock.patch.object(disc, "resolve_public_ip", return_value=(True, "ok")))
            screen = stack.enter_context(mock.patch.object(disc, "screen_url", return_value={"available": True, "status": 200,
                "x_frame_options": "DENY", "content_security_policy": None, "title_hint": "Toy"}))
            stack.enter_context(mock.patch.object(sys, "argv", ["discover", "--db-path", str(Path(tmp)/"ops.sqlite"), "--output-dir", tmp]))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            self.assertEqual(disc.main(), 0)
            screen.assert_called_once_with("https://demo.example/play")
            dns.assert_called_with("demo.example")
            candidates = json.loads((Path(tmp)/"discovery_candidates.json").read_text())
            self.assertEqual(candidates[0]["provenance"]["repository_id"], 42)
            import sqlite3
            with sqlite3.connect(Path(tmp)/"ops.sqlite") as conn:
                row = conn.execute("SELECT provenance_json, status FROM discovery_candidates").fetchone()
            self.assertEqual(json.loads(row[0])["repository_url"], "https://github.com/owner/toy")
            self.assertEqual(row[1], "quarantined")
            selected = json.loads((Path(tmp)/"discovery_selected.json").read_text())
            self.assertEqual(selected[0]["provenance"]["repository_id"], 42)
            summary = json.loads((Path(tmp)/"discovery_summary.json").read_text())
            self.assertEqual(summary["github"]["repository_leads"], 2)
            self.assertEqual(summary["distinct_discovered_domains"], 1)
