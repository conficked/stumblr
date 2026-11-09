"""Distinguish harvested/screened candidates from reviewable and playable growth."""
from collections import Counter


def report_selection(rows):
    if not isinstance(rows, list):
        raise ValueError("selected candidates must be a list")
    statuses = Counter()
    families = Counter()
    for row in rows:
        status = row.get("selection_status")
        if status not in {"evaluation_candidate", "blocked"}:
            raise ValueError("unsupported candidate selection status")
        statuses[status] += 1
        if status == "evaluation_candidate":
            families[row.get("source_family") or "unknown"] += 1
    return {
        "selected_count": len(rows),
        "pending_review_count": statuses["evaluation_candidate"],
        "quarantined_count": statuses["blocked"],
        "pending_review_family_counts": dict(sorted(families.items())),
        "new_playable_count": 0,
        "auto_rotation": False,
    }
