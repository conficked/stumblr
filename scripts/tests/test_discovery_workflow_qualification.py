"""Offline regression checks for mixed-result discovery matrix qualification."""

import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class DiscoveryQualificationWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = json.loads(subprocess.check_output([
            "ruby", "-ryaml", "-rjson", "-e",
            "puts JSON.generate(YAML.load_file('.github/workflows/discovery-manual-review.yml'))",
        ], cwd=ROOT))

    def qualifier_eligible(self, plan_result, discovery_result, cancelled=False):
        # Evaluate the job's actual status expression against mixed matrix results.
        expression = self.workflow["jobs"]["qualify-review-candidates"].get("if", "success()")
        expression = expression.removeprefix("${{").removesuffix("}}").strip()
        expression = expression.replace("&&", " and ").replace("||", " or ")
        expression = re.sub(r"!(?!=)", " not ", expression)
        expression = expression.replace("needs.plan-discovery.result", repr(plan_result))
        expression = expression.replace("needs.bounded-discovery.result", repr(discovery_result))
        return eval(expression, {"__builtins__": {}}, {
            "always": lambda: True,
            "cancelled": lambda: cancelled,
            "success": lambda: plan_result == discovery_result == "success",
        })

    def test_successful_shard_remains_eligible_after_sibling_zero_yield(self):
        self.assertTrue(self.qualifier_eligible("success", "failure"))

    def test_failed_plan_and_cancelled_runs_do_not_start_qualification(self):
        self.assertFalse(self.qualifier_eligible("failure", "failure"))
        self.assertFalse(self.qualifier_eligible("success", "failure", cancelled=True))

    def test_only_import_complete_shard_enters_browser_stage(self):
        steps = self.workflow["jobs"]["qualify-review-candidates"]["steps"]
        readiness = next((step for step in steps if step.get("id") == "eligibility"), None)
        self.assertIsNotNone(readiness, "each downloaded shard must establish eligibility")
        for imported, selected, expected in [(True, True, "true"), (False, True, "false"), (True, False, "false")]:
            with self.subTest(imported=imported, selected=selected), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                candidate_dir = root / "discovery-output"
                candidate_dir.mkdir()
                if selected:
                    (candidate_dir / "discovery_selected.json").write_text(json.dumps([
                        {"canonical_url": "https://suppressed.example/"}
                    ]))
                if imported and selected:
                    (candidate_dir / "qualification-candidates.json").write_text(json.dumps([
                        {"canonical_url": "https://confirmed.example/"}
                    ]))
                output = root / "output"
                result = subprocess.run(["bash", "-e", "-c", readiness["run"]], env={
                    **os.environ, "INPUT_DIR": temporary, "GITHUB_OUTPUT": str(output),
                }, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(output.read_text().strip(), f"eligible={expected}")

    def test_missing_artifact_fails_only_its_shard_before_browser_setup(self):
        job = self.workflow["jobs"]["qualify-review-candidates"]
        self.assertFalse(job["strategy"]["fail-fast"])
        steps = job["steps"]
        download = next(step for step in steps if step.get("uses", "").startswith("actions/download-artifact@"))
        self.assertFalse(download.get("continue-on-error", False))
        npm = next(step for step in steps if step.get("run") == "npm ci")
        self.assertLess(steps.index(download), steps.index(npm))
        browser = next(step for step in steps if "qualify_review_candidates.mjs" in step.get("run", ""))
        self.assertIn("qualification-candidates.json", browser["run"])
        self.assertNotIn("discovery_selected.json", browser["run"])
        browser_steps = [step for step in steps if step.get("run") in {
            "npm ci", "npx playwright install chromium",
        } or "qualify_review_candidates.mjs" in step.get("run", "")]
        self.assertEqual(len(browser_steps), 3)
        for step in browser_steps:
            for eligible in ("true", "false"):
                expression = step.get("if", "True").removeprefix("${{").removesuffix("}}").strip()
                expression = expression.replace("steps.eligibility.outputs.eligible", repr(eligible))
                self.assertEqual(eval(expression, {"__builtins__": {}}), eligible == "true")

    def test_only_the_separate_ingestion_job_can_mint_a_collector_token(self):
        jobs = self.workflow["jobs"]
        qualifier = jobs["qualify-review-candidates"]
        self.assertEqual(qualifier["permissions"], {"contents": "read"})
        self.assertNotRegex(json.dumps(qualifier), r"getIDToken|secrets\.|GITHUB_TOKEN|ACTIONS_ID_TOKEN|catalogue-ingest")

        ingestion = jobs["persist-qualification-evidence"]
        self.assertEqual(ingestion["permissions"], {"actions": "read", "id-token": "write"})
        self.assertIn("qualify-review-candidates", ingestion["needs"])
        self.assertNotIn("catalogue-ingest", json.dumps(self.workflow))
        self.assertNotIn("/api/catalogue/ingest", json.dumps(self.workflow))
        audiences = re.findall(r"getIDToken\('([^']+)'\)", json.dumps(self.workflow))
        self.assertTrue(audiences)
        self.assertEqual(set(audiences), {"https://stumblr.dev/catalogue-collect"})

    def test_ingestion_posts_the_same_qualified_artifact_with_pinned_run_metadata(self):
        jobs = self.workflow["jobs"]
        upload = next(step for step in jobs["qualify-review-candidates"]["steps"]
                      if step.get("uses", "").startswith("actions/upload-artifact@"))
        self.assertIn("success()", upload["if"])
        self.assertIn("steps.eligibility.outputs.eligible", upload["if"])

        steps = jobs["persist-qualification-evidence"]["steps"]
        download = next(step for step in steps if step.get("uses", "").startswith("actions/download-artifact@"))
        self.assertEqual(download["with"]["pattern"], upload["with"]["name"].replace("${{ matrix.family }}", "*"))
        post = next(step for step in steps if step.get("uses", "").startswith("actions/github-script@"))
        self.assertEqual(post["env"]["EVIDENCE_DIR"], download["with"]["path"])
        self.assertEqual(post["env"]["QUALIFIER_VERSION"], "browser-qualification-v4")
        self.assertTrue(upload["with"]["path"].endswith("/browser-qualification.json"))

        artifact = [{"device": device, "canonical_url": "https://example.org/", "meaningful_text_length": 72}
                    for device in ("desktop", "mobile")]
        result = self.run_ingestion(post, artifact)
        self.assertEqual(result, [{
            "url": "https://stumblr.dev/api/catalogue/evidence", "method": "POST",
            "headers": {"Authorization": "Bearer collector-token", "Content-Type": "application/json"},
            "body": {
                "run_id": "1234", "run_attempt": 3, "qualifier_version": "browser-qualification-v4",
                "observations": artifact,
            },
            "redirect": "error",
        }])

    def run_ingestion(self, step, artifact):
        with tempfile.TemporaryDirectory() as temporary:
            source = Path(temporary) / "shard"
            source.mkdir()
            (source / "browser-qualification.json").write_text(json.dumps(artifact, ensure_ascii=False))
            result = self.run_workflow_script(step, {
                "EVIDENCE_DIR": temporary, "GITHUB_RUN_ID": "1234",
                "GITHUB_RUN_ATTEMPT": "3", "QUALIFIER_VERSION": step["env"]["QUALIFIER_VERSION"],
            }, """
                if (Buffer.byteLength(options.body) > 1024 * 1024) throw new Error('oversized request');
                const body = JSON.parse(options.body);
                console.log(JSON.stringify({url, ...options, body}));
                return {ok: true, json: async () => ({ok: true, inserted: body.observations.length, existing: 0})};
            """)
            return [json.loads(line) for line in result.splitlines()]

    def run_workflow_script(self, step, env, fetch_body):
        harness = """
            const core = {
              getIDToken: async (audience) => {
                if (audience !== 'https://stumblr.dev/catalogue-collect') throw new Error('wrong audience');
                return 'collector-token';
              },
              info: () => {},
            };
            global.fetch = async (url, options) => {
        """ + fetch_body + """
            };
            new (Object.getPrototypeOf(async function () {}).constructor)('require', 'core', process.argv[1])(require, core)
              .catch(error => { console.error(error); process.exitCode = 1; });
        """
        return subprocess.check_output(["node", "-e", harness, step["with"]["script"]],
                                       env={**os.environ, **env}, text=True)

    def test_zero_yield_prepares_an_exact_queue_backlog_for_recovery(self):
        steps = self.workflow["jobs"]["bounded-discovery"]["steps"]
        prepare = next((step for step in steps if step.get("id") == "qualification-input"), None)
        self.assertIsNotNone(prepare)
        self.assertNotIn("review_yield", prepare.get("if", ""))
        persisted = next(step for step in steps if step.get("name") == "Persist untrusted candidates to the shared review queue only")
        self.assertLess(steps.index(persisted), steps.index(prepare))
        with tempfile.TemporaryDirectory() as temporary:
            artifact = Path(temporary) / "qualification-candidates.json"
            (Path(temporary) / "discovery_selected.json").write_text(json.dumps([
                {"canonical_url": "https://suppressed.example/"}
            ]))
            self.run_workflow_script(prepare, {"QUALIFICATION_PATH": str(artifact), "SOURCE_FAMILY": "all"}, """
                if (url.toString() !== 'https://stumblr.dev/api/catalogue/evidence' ||
                    options.headers.Authorization !== 'Bearer collector-token') throw new Error('wrong queue request');
                return {ok: true, json: async () => ({candidates: [{canonical_url: 'https://recover.example/'}]})};
            """)
            self.assertEqual(json.loads(artifact.read_text()), [{"canonical_url": "https://recover.example/"}])

    def test_large_artifact_is_split_at_exact_utf8_size_without_splitting_pairs(self):
        post = next(step for step in self.workflow["jobs"]["persist-qualification-evidence"]["steps"]
                    if step.get("uses", "").startswith("actions/github-script@"))
        reasons = ["界" * 300] + ["\0" * 300] * 19
        artifact = [{"device": device, "canonical_url": f"https://example.org/{candidate}",
                     "final_url": "https://example.org/?q=" + "x" * 15500,
                     "console_failure_reasons": reasons, "frame_failure_reasons": reasons,
                     "network_failure_reasons": reasons}
                    for candidate in range(24) for device in ("desktop", "mobile")]
        results = self.run_ingestion(post, artifact)
        self.assertGreater(len(results), 1)
        batches = [result["body"]["observations"] for result in results]
        self.assertEqual([observation for batch in batches for observation in batch], artifact)
        for batch in batches:
            self.assertLessEqual(len(batch), 48)
            self.assertEqual(len(batch) % 2, 0)
            for desktop, mobile in zip(batch[::2], batch[1::2]):
                self.assertEqual((desktop["device"], mobile["device"]), ("desktop", "mobile"))
                self.assertEqual(desktop["canonical_url"], mobile["canonical_url"])

    def test_zero_yield_is_recorded_without_failing_the_workflow(self):
        steps = self.workflow["jobs"]["bounded-discovery"]["steps"]
        gate = next(step for step in steps if step.get("id") == "review_yield")
        self.assertIn("has_candidates", gate["run"])
        self.assertIn("else 'false'", gate["run"])
        self.assertNotIn("raise SystemExit(1)", gate["run"])

        guarded_steps = [
            "Chunk selected candidates into bounded import lists",
            "Persist untrusted candidates to the shared review queue only",
        ]
        for name in guarded_steps:
            step = next(step for step in steps if step.get("name") == name)
            self.assertEqual(
                step.get("if"),
                "${{ steps.review_yield.outputs.has_candidates == 'true' }}",
                f"{name} must remain skipped for a zero-yield shard",
            )
