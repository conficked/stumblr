import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from discovery_batch_report import report_selection


class BatchReportTests(unittest.TestCase):
    def test_blocked_entries_are_not_usable_growth(self):
        report = report_selection([
            {"selection_status": "blocked", "source_family": "archives"},
            {"selection_status": "evaluation_candidate", "source_family": "webring"},
        ])
        self.assertEqual(report["pending_review_count"], 1)
        self.assertEqual(report["quarantined_count"], 1)
        self.assertEqual(report["new_playable_count"], 0)
        self.assertEqual(report["pending_review_family_counts"], {"webring": 1})

    def test_unknown_status_never_counts_as_reviewable(self):
        with self.assertRaises(ValueError):
            report_selection([{"selection_status": "launch_approved"}])

    def test_zero_reviewable_is_explicit(self):
        self.assertEqual(report_selection([{"selection_status": "blocked"}])["pending_review_count"], 0)
