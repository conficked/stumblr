"""Check the daily publisher's authority and workflow ordering."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class AutoPublishWorkflowTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = json.loads(subprocess.check_output([
            "ruby", "-ryaml", "-rjson", "-e",
            "puts JSON.generate(YAML.load_file('.github/workflows/catalogue-auto-publish.yml'))",
        ], cwd=ROOT, stderr=subprocess.STDOUT))
        cls.job = cls.workflow["jobs"]["release"]
        cls.steps = {step.get("id", step.get("uses")): step for step in cls.job["steps"]}

    def test_daily_schedule_main_checkout_and_dedicated_authority(self):
        events = self.workflow["on"]
        self.assertEqual(events["schedule"], [{"cron": "37 1,17,21 * * *"}])
        mode = events["workflow_dispatch"]["inputs"]["mode"]
        self.assertEqual((mode["type"], mode["options"], mode["default"]), ("choice", ["report", "publish"], "report"))
        self.assertEqual(self.workflow["permissions"], {"contents": "read", "id-token": "write"})
        self.assertIn("refs/heads/main", self.job["if"])
        self.assertEqual(self.steps["actions/checkout@v4"]["with"], {"ref": "main", "persist-credentials": False})
        for name in ("preview", "commit", "rollback"):
            script = self.steps[name]["with"]["script"]
            self.assertIn("getIDToken('https://stumblr.dev/catalogue-auto-publish')", script)
            self.assertIn(f"/api/catalogue/auto/{name}", script)
            self.assertNotIn("catalogue-collect", script)
            self.assertNotIn("catalogue-ingest", script)

    def test_gate_commit_and_proof_with_the_server_preview_and_verified_revision(self):
        ordered = list(self.steps)
        self.assertLess(ordered.index("preview"), ordered.index("commit"))
        self.assertLess(ordered.index("commit"), ordered.index("proof"))
        self.assertLess(ordered.index("proof"), ordered.index("rollback"))
        preview = self.steps["preview"]["with"]["script"]
        for value in ("rolloutStage", "report_only", "publish", "cap"):
            self.assertIn(value, preview)
        commit = self.steps["commit"]
        self.assertIn("steps.preview.outputs.publish == 'true'", commit["if"])
        for value in ("proposalId", "expectedRevision", "contentHash", "no_op", "entryCount", "/api/catalogue"):
            self.assertIn(value, commit["with"]["script"])
        proof = self.steps["proof"]
        self.assertIn("steps.commit.outputs.status == 'published'", proof["if"])
        for value in ("verify_auto_publication.mjs", "--base-url", "--revision", "--candidate-ids", "--output"):
            self.assertIn(value, proof["run"])
        rollback = self.steps["rollback"]
        self.assertIn("steps.proof.outputs.rollback == 'true'", rollback["if"])
        for value in ("rollbackPayload", "releaseRevision", "failedIds", "addedIds"):
            self.assertIn(value, rollback["with"]["script"])

    def run_script(self, name, directory, event, mode, responses, environment=None):
        fixture = """
            const fs = require('node:fs');
            const { script, eventName, responses } = JSON.parse(fs.readFileSync(0, 'utf8'));
            const calls = [];
            const outputs = {};
            const failures = [];
            const core = {
              getIDToken: async audience => { calls.push({ audience }); return 'fixture-token'; },
              setOutput: (key, value) => { outputs[key] = value; },
              setFailed: message => { failures.push(message); },
            };
            const fetch = async (url, options) => {
              calls.push({ url, ...(options.body ? { body: JSON.parse(options.body) } : {}) });
              if (!responses.length) throw new Error('Unexpected request');
              const result = responses.shift();
              if (result.__networkError) throw new Error('Fixture network error');
              const status = result.__status ?? 200;
              return { ok: status < 300, status, json: async () => result };
            };
            const run = new (Object.getPrototypeOf(async function() {}).constructor)('require', 'core', 'context', 'fetch', script);
            run(require, core, { eventName }, fetch).then(() => console.log(JSON.stringify({ outputs, calls, failures }))).catch(error => {
              console.error(error);
              process.exitCode = 1;
            });
        """
        output = subprocess.run(["node", "-e", fixture], cwd=ROOT, check=True, capture_output=True, text=True,
                                env={**os.environ, "REPORT_DIR": directory, "MODE": mode, **(environment or {})}, input=json.dumps({
                                    "script": self.steps[name]["with"]["script"], "eventName": event, "responses": responses,
                                }))
        return json.loads(output.stdout)

    def test_report_modes_only_preview_and_no_op_checks_the_live_revision(self):
        preview = {
            "ok": True, "rolloutStage": {"stage": "full", "cap": 20}, "additions": [],
            "counts": {"admitted": 0}, "decisions": {"admitted": []},
            "proposalId": "fixture-proposal", "expectedRevision": None, "contentHash": "fixture-hash",
            "proposedSnapshot": {"entries": []},
        }
        with tempfile.TemporaryDirectory() as directory:
            manual = self.run_script("preview", directory, "workflow_dispatch", "report", [preview])
            self.assertEqual(manual["outputs"]["publish"], "false")
            report = {**preview, "rolloutStage": {"stage": "report_only", "cap": 20}}
            scheduled = self.run_script("preview", directory, "schedule", "", [report])
            self.assertEqual(scheduled["outputs"]["publish"], "false")
            limited = {**preview, "rolloutStage": {"stage": "limited", "cap": 5}}
            scheduled = self.run_script("preview", directory, "schedule", "", [limited])
            self.assertEqual(scheduled["outputs"], {"publish": "true", "has_additions": "false"})
            committed = self.run_script("commit", directory, "schedule", "", [
                {"ok": True, "status": "no_op", "revision": None, "entryCount": 0, "addedIds": []},
                {"revision": None, "entries": []},
            ])
            self.assertEqual(committed["outputs"]["status"], "no_op")
            self.assertEqual(committed["calls"][1]["body"], {
                "proposalId": "fixture-proposal", "expectedRevision": None, "contentHash": "fixture-hash",
            })
            self.assertEqual(committed["calls"][2], {"url": "https://stumblr.dev/api/catalogue"})

    def test_no_op_readback_uses_exact_public_ids_even_when_an_entry_is_hidden(self):
        preview = {
            "ok": True, "rolloutStage": {"stage": "full", "cap": 20}, "additions": [],
            "counts": {"admitted": 0}, "proposalId": "fixture-proposal",
            "expectedRevision": "current", "contentHash": "fixture-hash",
            "proposedSnapshot": {"entries": [{"id": "visible"}]},
            "removals": [{"id": "hidden"}],
        }
        committed = {"ok": True, "status": "no_op", "revision": "current", "entryCount": 1, "addedIds": []}
        with tempfile.TemporaryDirectory() as directory:
            self.run_script("preview", directory, "workflow_dispatch", "publish", [preview])
            good = self.run_script("commit", directory, "workflow_dispatch", "publish", [
                committed, {"revision": "current", "entries": [{"id": "visible"}]},
            ])
            self.assertEqual(good["outputs"]["status"], "no_op")
            with self.assertRaises(subprocess.CalledProcessError) as rejected:
                self.run_script("commit", directory, "workflow_dispatch", "publish", [
                    committed, {"revision": "current", "entries": [{"id": "hidden"}]},
                ])
            self.assertIn("Live catalogue does not match", rejected.exception.stderr)

    def test_proof_is_finalized_after_browser_checks_and_recovery_reuses_the_release(self):
        ordered = list(self.steps)
        self.assertIn("recovery", self.steps["preview"]["with"]["script"])
        self.assertIn("recovery", self.steps["commit"]["with"]["script"])
        self.assertLess(ordered.index("commit"), ordered.index("proof_input"))
        self.assertLess(ordered.index("proof_input"), ordered.index("proof"))
        self.assertLess(ordered.index("proof"), ordered.index("complete"))
        for name in ("proof_input", "complete"):
            self.assertIn("/api/catalogue/auto/proof", self.steps[name]["with"]["script"])
        self.assertIn("unverified", self.steps["complete"]["with"]["script"])

    def test_retry_uses_the_recorded_release_and_reconstructs_a_lost_rollback_response(self):
        revision = "a" * 40 + ":12:1"
        prior = "b" * 40
        release = {"status": "published", "revision": revision, "entryCount": 1, "addedIds": ["fresh"]}
        preview = {
            "ok": True, "rolloutStage": {"stage": "limited", "cap": 5}, "additions": [{"id": "fresh"}],
            "counts": {"admitted": 1}, "expectedRevision": prior,
            "recovery": {"status": "pending", "release": release},
        }
        with tempfile.TemporaryDirectory() as directory:
            self.run_script("preview", directory, "schedule", "", [preview])
            resumed = self.run_script("commit", directory, "schedule", "", [{"revision": prior, "entries": []}])
            self.assertEqual(resumed["calls"], [{"url": "https://stumblr.dev/api/catalogue"}])
            self.assertEqual(resumed["outputs"]["revision"], revision)

            recorded = {"revision": revision + ":rollback", "removedIds": ["fresh"], "entryCount": 0}
            preview["recovery"].update(status="rolled_back", rollback=recorded, publicCheck="pending")
            self.run_script("preview", directory, "schedule", "", [preview])
            awaiting = self.run_script("commit", directory, "schedule", "", [])
            self.assertEqual(awaiting["outputs"], {"public_check": "true"})
            self.assertEqual(awaiting["calls"], [])
            preview["recovery"]["publicCheck"] = "confirmed"
            retry = self.run_script("preview", directory, "schedule", "", [preview])
            self.assertEqual(retry["outputs"]["has_additions"], "false")
            recovered = self.run_script("commit", directory, "schedule", "", [])
            self.assertEqual(recovered["calls"], [])
            self.assertEqual(recovered["outputs"], {})
            self.assertEqual(json.loads((Path(directory) / "rollback.json").read_text()), recorded)

    def test_an_incomplete_proof_records_unverified_and_never_finalizes_as_verified(self):
        revision = "a" * 40 + ":12:1"
        with tempfile.TemporaryDirectory() as directory:
            decision = Path(directory) / "decision.json"
            decision.write_text('{"status":"awaiting_proof"}')
            result = self.run_script("complete", directory, "schedule", "", [
                {"ok": True, "revision": revision, "status": "unverified"},
            ], {"RELEASE_REVISION": revision, "PROOF_OUTCOME": ""})
            self.assertEqual(result["calls"][1]["body"], {"releaseRevision": revision, "action": "unverified"})
            self.assertEqual(json.loads(decision.read_text())["status"], "unverified")
            self.assertEqual(len(result["failures"]), 1)

    def test_public_readback_checks_activated_full_and_selective_revisions_and_corrects_mismatch(self):
        revision = "a" * 40 + ":12:1"
        ids = ["prior-unaffected", "fresh-good", "fresh-failed"]
        release = {"revision": revision, "entryCount": 3, "addedIds": ids[1:]}
        preview = {"proposedSnapshot": {"entries": [{"id": id} for id in ids]}, "decisions": {"admitted": []}}
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            (directory / "preview.json").write_text(json.dumps(preview))
            for removed, live_ids, expected_action in [
                ([], ids, "confirm_public"),
                (["fresh-failed"], ids[:2], "confirm_public"),
                (["fresh-failed"], ids[1:], "reject_public"),
                ([], ["prior-unaffected", "fresh-good", "foreign"], "reject_public"),
            ]:
                with self.subTest(removed=removed, live_ids=live_ids):
                    activated = revision + ":rollback" if removed else revision
                    (directory / "decision.json").write_text(json.dumps({"release": release}))
                    (directory / "rollback.json").write_text(json.dumps({
                        "revision": activated, "entryCount": 2, "removedIds": removed,
                    } if removed else {"status": "not_run"}))
                    result = self.run_script("public_check", str(directory), "schedule", "", [
                        {"revision": activated, "entries": [{"id": id} for id in live_ids]},
                        {"ok": True, "revision": activated, "publicCheck": "confirmed" if expected_action == "confirm_public" else "failed"},
                    ])
                    self.assertEqual(result["calls"][0], {"url": "https://stumblr.dev/api/catalogue"})
                    self.assertEqual(result["calls"][2]["body"], {"releaseRevision": revision, "action": expected_action})
                    self.assertEqual(json.loads((directory / "decision.json").read_text())["publicCheck"],
                                     "confirmed" if expected_action == "confirm_public" else "failed")

    def test_public_readback_unavailability_or_confirmation_conflict_requests_correction(self):
        revision = "a" * 40 + ":12:1"
        release = {"revision": revision, "entryCount": 1, "addedIds": ["fresh"]}
        preview = {"proposedSnapshot": {"entries": [{"id": "fresh"}]}, "decisions": {"admitted": []}}
        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            (directory / "preview.json").write_text(json.dumps(preview))
            (directory / "rollback.json").write_text('{"status":"not_run"}')
            for responses, actions in [
                ([{"__networkError": True}], ["reject_public"]),
                ([{"revision": revision, "entries": [{"id": "fresh"}]}, {"__status": 409}], ["confirm_public", "reject_public"]),
            ]:
                (directory / "decision.json").write_text(json.dumps({"release": release}))
                result = self.run_script("public_check", str(directory), "schedule", "", [
                    *responses, {"ok": True, "revision": revision, "publicCheck": "failed"},
                ])
                self.assertEqual([call["body"]["action"] for call in result["calls"] if "body" in call], actions)
                self.assertEqual(len(result["failures"]), 1)

    def test_bounded_single_job_and_retains_all_reports_after_failure(self):
        self.assertEqual(self.workflow["concurrency"], {
            "group": "stumblr-catalogue-auto-publish", "cancel-in-progress": False,
        })
        self.assertLessEqual(self.job["timeout-minutes"], 20)
        self.assertLessEqual(self.steps["proof"]["timeout-minutes"], 7)
        upload = self.steps["actions/upload-artifact@v4"]
        self.assertEqual(upload["if"], "always()")
        self.assertEqual(upload["with"]["retention-days"], 3)
        for report in ("preview", "decision", "proof", "rollback"):
            self.assertIn(f"{report}.json", upload["with"]["path"])


if __name__ == "__main__":
    unittest.main()
