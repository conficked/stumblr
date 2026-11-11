"""Exercise local workflow planning for every scheduled UTC hour."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]


class DiscoveryScheduleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.workflow = json.loads(subprocess.check_output([
            "ruby", "-ryaml", "-rjson", "-e",
            "puts JSON.generate(YAML.load_file('.github/workflows/discovery-manual-review.yml'))",
        ], cwd=ROOT))
        cls.plan = next(step for step in cls.workflow["jobs"]["plan-discovery"]["steps"] if step.get("id") == "plan")

    def plan_run(self, event, schedule="", mode="", recheck=""):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "output"
            result = subprocess.run(["bash", "-e", "-c", self.plan["run"]], cwd=ROOT, env={
                **os.environ, "EVENT_NAME": event, "SCHEDULE": schedule,
                "REQUESTED_MODE": mode, "REQUESTED_RECHECK": recheck, "GITHUB_OUTPUT": str(output),
            }, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return dict(line.split("=", 1) for line in output.read_text().splitlines())

    def step_runs(self, step, outputs):
        expression = step.get("if", "True").removeprefix("${{").removesuffix("}}").strip()
        for key, value in outputs.items():
            expression = expression.replace(f"needs.plan-discovery.outputs.{key}", repr(value))
        return eval(expression, {"__builtins__": {}})

    def test_cron_sets_are_disjoint_and_cover_every_hour_at_minute_17(self):
        hourly_occurrences = []
        recheck_hours = []
        schedules = self.workflow["on"]["schedule"]
        self.assertEqual(len(schedules), 2)
        for schedule in schedules:
            scheduled_hours = []
            minute, hours, day, month, weekday = schedule["cron"].split()
            self.assertEqual((minute, day, month, weekday), ("17", "*", "*", "*"))
            for part in hours.split(","):
                if part.startswith("*/"):
                    scheduled_hours.extend(range(0, 24, int(part[2:])))
                elif "-" in part:
                    start, stop = map(int, part.split("-"))
                    scheduled_hours.extend(range(start, stop + 1))
                else:
                    scheduled_hours.append(int(part))
            hourly_occurrences.extend(scheduled_hours)
            if self.plan_run("schedule", schedule["cron"])["recheck"] == "true":
                recheck_hours.extend(scheduled_hours)
        self.assertEqual(sorted(hourly_occurrences), list(range(24)))
        self.assertEqual(sorted(recheck_hours), [0, 6, 12, 18])

    def test_only_six_hour_schedule_runs_runtime_observation(self):
        jobs = self.workflow["jobs"]
        discovery = next(step for step in jobs["bounded-discovery"]["steps"] if step.get("name") == "Run bounded review-only discovery")
        recheck = jobs["load-runtime-health-targets"]
        for schedule in self.workflow["on"]["schedule"]:
            cron = schedule["cron"]
            outputs = self.plan_run("schedule", cron, "bootstrap")
            self.assertEqual(outputs["mode"], "maintenance")
            self.assertEqual(outputs["ceiling"], "24")
            self.assertEqual(json.loads(outputs["families"]), ["all"])
            self.assertTrue(self.step_runs(discovery, outputs))
            self.assertEqual(outputs.get("recheck"), "true" if cron == "17 */6 * * *" else "false")
            self.assertEqual(self.step_runs(recheck, outputs), cron == "17 */6 * * *")

    def test_manual_maintenance_always_rechecks_but_bootstrap_never_does(self):
        for mode, expected in [("", "true"), ("maintenance", "true"), ("bootstrap", "false")]:
            with self.subTest(mode=mode):
                outputs = self.plan_run("workflow_dispatch", mode=mode)
                self.assertEqual(outputs.get("recheck"), expected)
                self.assertEqual(outputs["mode"], mode or "maintenance")

    def test_dispatched_maintenance_can_skip_recheck_for_the_hourly_scheduler(self):
        for recheck, expected in [("true", "true"), ("false", "false")]:
            with self.subTest(recheck=recheck):
                self.assertEqual(self.plan_run("workflow_dispatch", mode="maintenance", recheck=recheck)["recheck"], expected)
        self.assertEqual(self.plan_run("workflow_dispatch", mode="bootstrap", recheck="true")["recheck"], "false")

    def test_runtime_observation_has_no_token_authority_and_persistence_is_bounded(self):
        jobs = self.workflow["jobs"]
        owner, observe = next((job, step) for job in jobs.values() for step in job["steps"]
                              if step.get("name") == "Observe established entries in the frame sandbox")
        permissions = owner.get("permissions", self.workflow.get("permissions", {}))
        self.assertEqual(permissions, {"contents": "read"})
        self.assertIn("npm ci", observe["run"])
        self.assertIn("--max-candidates 24", observe["run"])
        self.assertNotIn("getIDToken", json.dumps(owner))
        self.assertNotIn("github.token", json.dumps(owner))
        self.assertNotIn("secrets.", json.dumps(owner))
        self.assertFalse(next(step for step in owner["steps"] if step.get("uses", "").startswith("actions/checkout"))["with"]["persist-credentials"])

        target = jobs["load-runtime-health-targets"]
        self.assertEqual(target["permissions"], {"id-token": "write"})
        self.assertIn("targets.length > 24", json.dumps(target))
        self.assertIn("load-runtime-health-targets", owner["needs"])
        self.assertTrue(any(step.get("uses", "").startswith("actions/upload-artifact") for step in owner["steps"]))

        persist = jobs["persist-runtime-health"]
        self.assertEqual(persist["permissions"], {"id-token": "write"})
        self.assertIn("observe-runtime-health", persist["needs"])
        self.assertNotIn("actions/checkout", json.dumps(persist))
        self.assertNotIn("npm ci", json.dumps(persist))
        self.assertTrue(any(step.get("uses", "").startswith("actions/download-artifact") for step in persist["steps"]))
        script = next(step["with"]["script"] for step in persist["steps"] if step.get("uses", "").startswith("actions/github-script"))
        self.assertIn("https://stumblr.dev/catalogue-collect", script)
        self.assertIn("statSync", script)
        self.assertNotIn("catalogue-publish", script)
        self.assertLess(script.index("runtime_http"), script.index("runtime_health"))

    def test_runtime_persistence_whitelists_artifact_fields_and_binds_targets(self):
        job = self.workflow["jobs"]["persist-runtime-health"]
        script = next(step["with"]["script"] for step in job["steps"] if step.get("uses", "").startswith("actions/github-script"))
        harness = """
            const fs = require('node:fs');
            const script = fs.readFileSync(0, 'utf8');
            const execute = new (Object.getPrototypeOf(async function() {}).constructor)('require', 'core', 'fetch', script);
            const core = { getIDToken: async audience => audience, info: () => {} };
            const fetch = async (url, options) => {
              console.log(JSON.stringify({ url, authorization: options.headers.Authorization, body: JSON.parse(options.body) }));
              return { ok: true, json: async () => ({ ok: true }) };
            };
            execute(require, core, fetch).catch(error => { console.error(error.message); process.exitCode = 1; });
        """
        target = {"id": "queue-id", "canonicalUrl": "https://example.org/"}
        framing = {"xfo_present": False, "csp_present": False, "csp_frame_ancestors": False, "denied": False}
        row = {"id": "queue-id", "canonical_url": target["canonicalUrl"], "availability_status": 200,
               "framing": {**framing, "untrusted_header": "private text"}}
        observation = {"canonical_url": target["canonicalUrl"], "render_result": "text_observed",
                       "functionality_result": "not_demonstrated", "document_http_status": 200,
                       "frame_failure_reasons": [], "network_failure_reasons": [], "console_failure_reasons": ["private text"]}
        with tempfile.TemporaryDirectory() as temporary:
            paths = {key: str(Path(temporary) / f"{key}.json") for key in ("TARGETS_PATH", "RECHECK_PATH", "BROWSER_PATH")}
            Path(paths["TARGETS_PATH"]).write_text(json.dumps([target]))
            Path(paths["RECHECK_PATH"]).write_text(json.dumps([row]))
            Path(paths["BROWSER_PATH"]).write_text(json.dumps([{**observation, "device": device} for device in ("desktop", "mobile")]))

            def run():
                return subprocess.run(["node", "-e", harness], input=script, capture_output=True, text=True, cwd=ROOT, env={
                    **os.environ, **paths, "BROWSER_READY": "true", "GITHUB_RUN_ID": "1234", "GITHUB_RUN_ATTEMPT": "2",
                })

            result = run()
            self.assertEqual(result.returncode, 0, result.stderr)
            http, browser = map(json.loads, result.stdout.splitlines())
            self.assertEqual(http["authorization"], "Bearer https://stumblr.dev/catalogue-collect")
            self.assertEqual(http["body"], {"runtime_http": [{"id": "queue-id", "availability_status": 200, "framing": framing}]})
            pair = browser["body"]["runtime_health"][0]["observation_pair"]
            self.assertEqual((pair["run_id"], pair["run_attempt"]), ("1234", 2))
            self.assertNotIn("console_failure_reasons", pair["desktop"])
            self.assertNotIn("canonical_url", pair["desktop"])

            Path(paths["RECHECK_PATH"]).write_text(json.dumps([{**row, "id": "unrequested-id"}]))
            result = run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("Unexpected runtime HTTP target", result.stderr)
            self.assertEqual(result.stdout, "")

            Path(paths["RECHECK_PATH"]).write_bytes(b" " * (512 * 1024 + 1))
            result = run()
            self.assertEqual(result.returncode, 1)
            self.assertIn("Runtime artifact exceeds byte budget", result.stderr)
            self.assertEqual(result.stdout, "")
