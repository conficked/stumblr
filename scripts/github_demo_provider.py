"""Bounded repository metadata discovery; demo safety belongs to the collector."""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request

REQUEST_TIMEOUT_S = 8
MAX_RESPONSE_BYTES = 1_500_000
MAX_QUERIES = 4
MAX_RESULTS_PER_QUERY = 25
GITHUB_QUERIES = [
    "topic:creative-coding archived:false fork:false",
    "topic:generative-art archived:false fork:false",
    "topic:interactive-map archived:false fork:false",
    "topic:browser-game archived:false fork:false",
    "topic:webgl archived:false fork:false stars:>=20",
    "topic:threejs archived:false fork:false stars:>=20",
    "topic:p5js archived:false fork:false stars:>=10",
    "topic:canvas archived:false fork:false stars:>=20",
    "topic:shader archived:false fork:false stars:>=20",
    "topic:simulation archived:false fork:false stars:>=20",
    "topic:visualization archived:false fork:false stars:>=30",
    "topic:data-visualization archived:false fork:false stars:>=30",
    "topic:javascript-game archived:false fork:false stars:>=10",
    "topic:html5-game archived:false fork:false stars:>=10",
    "topic:puzzle-game archived:false fork:false stars:>=10",
    "topic:web-audio archived:false fork:false stars:>=10",
    "topic:synthesizer archived:false fork:false stars:>=20",
    "topic:music-visualizer archived:false fork:false stars:>=10",
    "topic:pixel-art archived:false fork:false stars:>=20",
    "topic:fractal archived:false fork:false stars:>=10",
    "topic:cellular-automata archived:false fork:false stars:>=10",
    "topic:physics-simulation archived:false fork:false stars:>=10",
    "topic:maps archived:false fork:false stars:>=30",
    "topic:leaflet archived:false fork:false stars:>=20",
    "topic:mapbox archived:false fork:false stars:>=30",
    "topic:astronomy archived:false fork:false stars:>=20",
    "topic:interactive archived:false fork:false stars:>=20",
    "topic:explorable-explanation archived:false fork:false",
    "topic:algorithm-visualizer archived:false fork:false stars:>=10",
    "topic:demoscene archived:false fork:false stars:>=10",
    "topic:ascii-art archived:false fork:false stars:>=20",
    "topic:drawing archived:false fork:false stars:>=20",
]


def rotating_queries(now: float | None = None) -> list[str]:
    """Advance through the query pool each hour so successive runs reach unseen repositories."""
    hour = int((time.time() if now is None else now) // 3600)
    start = (hour * MAX_QUERIES) % len(GITHUB_QUERIES)
    return [GITHUB_QUERIES[(start + offset) % len(GITHUB_QUERIES)] for offset in range(MAX_QUERIES)]
REJECTED_DOMAINS = {
    "github.com", "raw.githubusercontent.com", "gitlab.com", "bitbucket.org",
    "apps.apple.com", "play.google.com", "store.steampowered.com", "itch.io",
    "ko-fi.com", "patreon.com", "buymeacoffee.com", "opencollective.com",
    "paypal.com", "readthedocs.io", "readthedocs.org", "gitbook.io",
    "npmjs.com", "pypi.org", "crates.io",
}


class NoApiRedirects(urllib.request.HTTPRedirectHandler):
    """Never forward an authenticated request away from the fixed API endpoint."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def canonical_https_url(value: object) -> str | None:
    """Validate metadata URLs before either hostname normalization or persistence."""
    if not isinstance(value, str) or re.search(r"[\x00-\x20\x7f\\]", value):
        return None
    if re.search(r"%(?![0-9a-f]{2})|%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)", value, re.I):
        return None
    try:
        parsed = urllib.parse.urlsplit(value)
        host = (parsed.hostname or "").lower()
        if (parsed.scheme != "https" or parsed.username is not None or parsed.password is not None
                or parsed.port not in (None, 443) or parsed.netloc.lower() not in (host, host + ":443")):
            return None
    except ValueError:
        return None
    labels = host.split(".")
    if (len(host) > 253 or len(labels) < 2 or not re.fullmatch(r"[a-z]{2,63}", labels[-1])
            or any(not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels)):
        return None
    return urllib.parse.urlunsplit(("https", host, parsed.path or "/", parsed.query, parsed.fragment))


def demo_homepage(value: object) -> str | None:
    """Exclude obvious non-demo destinations, without fetching any homepage."""
    value = canonical_https_url(value)
    if value is None:
        return None
    parsed = urllib.parse.urlsplit(value)
    host = parsed.hostname
    if any(host == domain or host.endswith("." + domain) for domain in REJECTED_DOMAINS):
        return None
    path_parts = urllib.parse.unquote(parsed.path).lower().strip("/").split("/")
    if host.split(".")[0] in {"docs", "documentation", "shop", "store"} or any(
        part in {"docs", "documentation", "donate", "donation", "sponsors", "shop", "store"}
        for part in path_parts
    ):
        return None
    return value


def collect_github_demo_leads(token: str, queries: list[str], max_repositories: int) -> tuple[list[dict], dict]:
    """Return bounded homepage leads or no leads on an incomplete/failed API search.

    Pagination URLs are constructed locally, never taken from response links.
    No exception message or API error body is retained, since it may contain secrets.
    """
    stats = {"queries_attempted": 0, "requests": 0, "repositories_inspected": 0,
             "repository_leads": 0, "distinct_demo_domains": 0, "rejected_homepages": 0,
             "error": None}
    if not token.strip():
        stats["error"] = "missing_token"
        return [], stats
    budget = max(0, min(max_repositories, MAX_QUERIES * MAX_RESULTS_PER_QUERY))
    leads = []
    seen = set()
    opener = urllib.request.build_opener(NoApiRedirects())
    try:
        for query in queries[:MAX_QUERIES]:
            if stats["repositories_inspected"] >= budget:
                break
            stats["queries_attempted"] += 1
            inspected = 0
            page = 1
            while inspected < MAX_RESULTS_PER_QUERY and stats["repositories_inspected"] < budget:
                remaining = min(MAX_RESULTS_PER_QUERY - inspected, budget - stats["repositories_inspected"])
                # Keep per_page stable across pages so GitHub's offset never changes.
                params = urllib.parse.urlencode({"q": query, "sort": "updated", "order": "desc",
                                                 "per_page": min(MAX_RESULTS_PER_QUERY, budget), "page": page})
                request = urllib.request.Request("https://api.github.com/search/repositories?" + params, headers={
                    "Authorization": "Bearer " + token.strip(), "Accept": "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "StumblrDiscoveryBot/0.1",
                })
                stats["requests"] += 1
                with opener.open(request, timeout=REQUEST_TIMEOUT_S) as response:
                    payload = response.read(MAX_RESPONSE_BYTES + 1)
                if len(payload) > MAX_RESPONSE_BYTES:
                    raise ValueError("oversized response")
                data = json.loads(payload)
                if not isinstance(data, dict) or not isinstance(data.get("items"), list) or type(data.get("incomplete_results")) is not bool or type(data.get("total_count")) is not int:
                    raise ValueError("invalid response")
                if data["incomplete_results"]:
                    stats["error"] = "incomplete_results"
                    return [], stats
                items = data["items"][:remaining]
                for item in items:
                    stats["repositories_inspected"] += 1
                    inspected += 1
                    if not isinstance(item, dict):
                        raise ValueError("invalid repository")
                    identity = item.get("id")
                    if isinstance(identity, bool) or not str(identity).isdigit() or int(identity) <= 0:
                        raise ValueError("invalid repository identity")
                    identity = int(identity)
                    full_name = item.get("full_name")
                    if not isinstance(full_name, str) or not re.fullmatch(r"[\w.-]+/[\w.-]+", full_name.strip(), flags=re.ASCII):
                        raise ValueError("invalid repository name")
                    full_name = full_name.strip().lower()
                    if identity in seen:
                        continue
                    seen.add(identity)
                    demo = demo_homepage(item.get("homepage"))
                    if demo is None:
                        stats["rejected_homepages"] += 1
                        continue
                    topics = item.get("topics") or []
                    if not isinstance(topics, list) or not all(isinstance(topic, str) for topic in topics):
                        raise ValueError("invalid topics")
                    leads.append({"repository_id": identity, "repository_full_name": full_name,
                        "repository_url": "https://github.com/" + full_name, "demo_url": demo,
                        "raw_homepage": item["homepage"],
                        "description": item.get("description") or "", "topics": sorted(set(t.lower() for t in topics)),
                        "stars": item.get("stargazers_count", 0), "pushed_at": item.get("pushed_at"),
                        "archived": bool(item.get("archived", False)), "source_query": query})
                if not items or inspected >= data["total_count"]:
                    break
                page += 1
    except urllib.error.HTTPError as exc:
        stats["error"] = f"http_error:{exc.code}"
        return [], stats
    except (urllib.error.URLError, TimeoutError, OSError):
        stats["error"] = "request_failed"
        return [], stats
    except (ValueError, TypeError):
        stats["error"] = "invalid_response"
        return [], stats
    stats["repository_leads"] = len(leads)
    stats["distinct_demo_domains"] = len({urllib.parse.urlsplit(lead["demo_url"]).hostname for lead in leads})
    return leads, stats
