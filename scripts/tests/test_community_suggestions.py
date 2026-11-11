#!/usr/bin/env python3
"""Suggest-form URLs enter the collector as an ordinary screened source."""

from __future__ import annotations

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "scripts"))

import discover_catalogue_candidates as disc  # noqa: E402

COMMUNITY_SOURCE = next(source for source in disc.SOURCE_CONFIG if source["id"] == "community-suggestions")


class CommunitySuggestionTests(unittest.TestCase):
    def run_collector(self, suggestions, tmp: str):
        path = Path(tmp) / "community.json"
        path.write_text(json.dumps(suggestions))
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.object(disc, "SOURCE_CONFIG", [COMMUNITY_SOURCE]))
            stack.enter_context(mock.patch.object(disc, "load_existing_catalogue_keys", return_value=(set(), set())))
            stack.enter_context(mock.patch.object(disc, "robots_allows", side_effect=AssertionError("own site is not crawled")))
            stack.enter_context(mock.patch.object(disc, "resolve_public_ip", return_value=(True, "ok")))
            screen = stack.enter_context(mock.patch.object(disc, "screen_url", return_value={"available": True, "status": 200,
                "x_frame_options": None, "content_security_policy": None, "title_hint": "Pixel Garden"}))
            stack.enter_context(mock.patch.object(sys, "argv", ["discover", "--db-path", str(Path(tmp) / "ops.sqlite"),
                "--output-dir", tmp, "--community-urls", str(path)]))
            stack.enter_context(contextlib.redirect_stdout(io.StringIO()))
            self.assertEqual(disc.main(), 0)
        return screen, json.loads((Path(tmp) / "discovery_candidates.json").read_text())

    def test_suggestions_are_screened_with_submitted_topic_hint_and_no_submitted_title(self):
        with tempfile.TemporaryDirectory() as tmp:
            screen, candidates = self.run_collector([
                {"canonical_url": "https://pixel.example/", "topics": ["games", "bogus"]},
                {"canonical_url": "https://stumblr.dev/elsewhere", "topics": []},
            ], tmp)
        screen.assert_called_once_with("https://pixel.example/")
        self.assertEqual(len(candidates), 1)
        candidate = candidates[0]
        self.assertEqual((candidate["source_id"], candidate["source_family"], candidate["source_url"]),
            ("community-suggestions", "community", "https://stumblr.dev/"))
        self.assertIn("games", candidate["inferred_topics"])
        self.assertEqual(candidate["link_text"], "Website at pixel.example")

    def test_malformed_snapshot_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "community.json"
            for payload in ({"canonical_url": "https://x.example/"}, [{"canonical_url": 7}], [{}] * 25):
                path.write_text(json.dumps(payload))
                with self.assertRaises(ValueError):
                    disc.load_community_suggestions(str(path))


if __name__ == "__main__":
    unittest.main()
