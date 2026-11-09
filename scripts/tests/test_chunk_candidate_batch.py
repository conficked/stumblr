import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "chunk_candidate_batch.py"


class ChunkCandidateBatchTests(unittest.TestCase):
    def run_chunker(self, rows, ceiling=220):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        source = root / "selected.json"
        source.write_text(json.dumps(rows))
        output = root / "chunks"
        result = subprocess.run(
            [sys.executable, str(SCRIPT), str(source), str(output), "--ceiling", str(ceiling)],
            capture_output=True, text=True,
        )
        return result, output

    def test_preserves_order_in_24_row_import_lists(self):
        rows = [{"canonical_url": f"https://example.org/{i}"} for i in range(49)]
        result, output = self.run_chunker(rows)
        self.assertEqual(result.returncode, 0, result.stderr)
        manifest = json.loads((output / "manifest.json").read_text())
        chunks = [json.loads((output / item["file"]).read_text()) for item in manifest]
        self.assertEqual([len(chunk) for chunk in chunks], [24, 24, 1])
        self.assertEqual([row for chunk in chunks for row in chunk], rows)

    def test_empty_input_produces_no_imports(self):
        result, output = self.run_chunker([])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((output / "manifest.json").read_text()), [])
        self.assertEqual(list(output.glob("chunk-*.json")), [])

    def test_replay_keys_are_stable_and_content_addressed(self):
        first, output = self.run_chunker([{"canonical_url": "https://a.example/", "title": "A"}])
        second, replay = self.run_chunker([{"title": "A", "canonical_url": "https://a.example/"}])
        third, changed = self.run_chunker([{"canonical_url": "https://b.example/", "title": "B"}])
        for result in (first, second, third):
            self.assertEqual(result.returncode, 0, result.stderr)
        key = json.loads((output / "manifest.json").read_text())[0]["replay_key"]
        self.assertEqual(key, json.loads((replay / "manifest.json").read_text())[0]["replay_key"])
        self.assertNotEqual(key, json.loads((changed / "manifest.json").read_text())[0]["replay_key"])

    def test_accepts_exact_bootstrap_ceiling(self):
        result, output = self.run_chunker([{"id": i} for i in range(220)])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(len(json.loads((output / "manifest.json").read_text())), 10)

    def test_rejects_rows_above_configured_ceiling_before_writing(self):
        for size, ceiling in [(221, 220), (25, 24)]:
            with self.subTest(size=size, ceiling=ceiling):
                result, output = self.run_chunker([{"id": i} for i in range(size)], ceiling)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("exceeds configured ceiling", result.stderr)
                self.assertFalse(output.exists())

    def test_rejects_invalid_input_and_unsafe_ceiling(self):
        for rows, ceiling in [({}, 220), ([None], 220), ([], 221), ([], 0)]:
            with self.subTest(rows=rows, ceiling=ceiling):
                result, output = self.run_chunker(rows, ceiling)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("invalid", result.stderr)
                self.assertFalse(output.exists())
