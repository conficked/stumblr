#!/usr/bin/env python3
"""Bounded Stumblr candidate discovery and screening pipeline.

Collects candidate destination URLs from documented public sources,
applies URL safety checks, performs lightweight availability/header screening,
and emits reproducible evidence artifacts for editorial curation.
"""

from __future__ import annotations

import argparse
import dataclasses
import html
import ipaddress
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Iterable

if __package__:
    from . import github_demo_provider
else:
    import github_demo_provider


REQUEST_TIMEOUT_S = 8
MAX_SOURCE_BYTES = 1_500_000
MAX_SCREENED_FINAL_URL_LENGTH = 16_384  # Matches the qualification document URL limit.
MAX_CANDIDATES = 220
MAX_PER_SOURCE_LINKS = 45
MAX_SCREENED = 220
MAX_RANDOM_FETCHES_PER_SOURCE = 36
RANDOM_FETCH_DELAY_S = 0.2
USER_AGENT = "StumblrDiscoveryBot/0.1 (+private-evaluation)"
REPO_ROOT = Path(__file__).resolve().parents[1]

SOURCE_CONFIG = [
    {
        "id": "webring-xxiivv",
        "kind": "directory_html",
        "url": "https://webring.xxiivv.com/",
        "topic_hint": "culture",
        "source_family": "webring",
    },
    {
        "id": "webring-fediring",
        "kind": "directory_html",
        "url": "https://fediring.net/",
        "topic_hint": "culture",
        "source_family": "webring",
    },
    {
        "id": "webring-hotline",
        "kind": "directory_html",
        "url": "https://hotlinewebring.club/",
        "topic_hint": "culture",
        "source_family": "webring",
    },
    {
        "id": "personalsites-directory",
        "kind": "directory_html",
        "url": "https://personalsit.es/",
        "topic_hint": "culture",
        "source_family": "indie-directory",
    },
    {
        "id": "one-mb-club",
        "kind": "directory_html",
        "url": "https://1mb.club/",
        "topic_hint": "culture",
        "source_family": "small-web-directory",
    },
    {
        "id": "ten-kb-club",
        "kind": "directory_html",
        "url": "https://10kb.club/",
        "topic_hint": "culture",
        "source_family": "small-web-directory",
    },
    {
        "id": "ooh-directory",
        "kind": "directory_html",
        "url": "https://ooh.directory/",
        "topic_hint": "culture",
        "source_family": "blog-directory",
    },
    {
        "id": "indie-web-index",
        "kind": "directory_html",
        "url": "https://theindex.fyi/",
        "topic_hint": "culture",
        "source_family": "indie-directory",
    },
    {
        "id": "tildeverse",
        "kind": "directory_html",
        "url": "https://tildeverse.org/",
        "topic_hint": "education",
        "source_family": "tilde",
    },
    {
        "id": "lobsters-rss",
        "kind": "feed",
        "url": "https://lobste.rs/rss",
        "topic_hint": "science",
        "source_family": "community-feed",
    },
    {
        "id": "nrich-maths",
        "kind": "html",
        "url": "https://nrich.maths.org/",
        "topic_hint": "education",
        "source_family": "educational",
    },
    {
        "id": "exploratorium-explore",
        "kind": "html",
        "url": "https://www.exploratorium.edu/explore",
        "topic_hint": "science",
        "source_family": "educational",
    },
    {
        "id": "p5js-examples",
        "kind": "html",
        "url": "https://p5js.org/examples/",
        "topic_hint": "art",
        "source_family": "creative-coding",
    },
    {
        "id": "ia-blog-feed",
        "kind": "feed",
        "url": "https://blog.archive.org/feed/",
        "topic_hint": "archives",
        "source_family": "archives",
    },
    {
        "id": "useless-web-sites-index",
        "kind": "feed",
        "url": "https://theuselessweb.com/sites/index.xml",
        "topic_hint": "games",
        "source_family": "novelty-list",
    },
    {
        "id": "useless-web-sites-page",
        "kind": "html",
        "url": "https://theuselessweb.com/sites/",
        "topic_hint": "games",
        "source_family": "novelty-list",
    },
    {
        "id": "bored-button-random",
        "kind": "random_html",
        "url": "https://www.boredbutton.com/random",
        "topic_hint": "games",
        "sample_rounds": 24,
        "source_family": "novelty-list",
    },
    {
        "id": "open-culture-rss",
        "kind": "feed",
        "url": "https://www.openculture.com/feed",
        "topic_hint": "culture",
        "source_family": "archives",
    },
    {
        "id": "nasa-breaking-rss",
        "kind": "feed",
        "url": "https://www.nasa.gov/rss/dyn/breaking_news.rss",
        "topic_hint": "science",
        "source_family": "archives",
    },
    {
        "id": "public-domain-review-rss",
        "kind": "feed",
        "url": "https://publicdomainreview.org/feed/",
        "topic_hint": "archives",
        "source_family": "archives",
    },
    {
        "id": "wikimedia-glam-rss",
        "kind": "feed",
        "url": "https://diff.wikimedia.org/feed/",
        "topic_hint": "archives",
        "source_family": "archives",
    },
    {
        # URLs submitted through the site's Suggest form; links come from --community-urls.
        "id": "community-suggestions",
        "kind": "community_suggestions",
        "url": "https://stumblr.dev/",
        "topic_hint": "culture",
        "source_family": "community",
    },
    {
        "id": "github-live-demo",
        "kind": "github_repositories",
        "url": "https://api.github.com/search/repositories",
        "topic_hint": "art",
        "source_family": "github-live-demo",
    },
]

NOVELTY_FAMILIES = {"novelty-list"}
FAMILY_SOFT_CAPS = {
    "novelty-list": 18,
    "awesome-list": 20,
    "community-feed": 16,
    "webring": 40,
    "indie-directory": 40,
}

TOPIC_KEYWORDS = {
    "art": ["art", "visual", "creative", "design", "gallery", "generative", "drawing"],
    "science": ["science", "astronomy", "biology", "physics", "math", "lab", "weather", "climate"],
    "maps": ["map", "geo", "earth", "atlas", "planet", "carto", "spatial"],
    "archives": ["archive", "library", "museum", "history", "collection", "heritage"],
    "culture": ["culture", "music", "radio", "story", "language", "poetry"],
    "games": ["game", "play", "toy", "puzzle", "interactive"],
    "education": ["learn", "course", "education", "lesson", "teaching", "tutorial"],
    "tech": ["llm", "agent", "mcp", "self-host", "osint", "security", "cli", "terminal", "developer", "open source", "open-source", "machine learning", "neural", "emulator", "compiler", "programming", "linux", "hacker"],
}

DISALLOWED_HOST_SNIPPETS = [
    "localhost",
    ".local",
    ".internal",
    ".arpa",
]

DISALLOWED_DOMAINS = {
    "github.com",
    "raw.githubusercontent.com",
    "gitlab.com",
    "bitbucket.org",
    "codeberg.org",
    "sr.ht",
    "git.sr.ht",
    "hg.sr.ht",
    "todo.sr.ht",
    "lists.sr.ht",
    "npmjs.com",
    "pypi.org",
    "crates.io",
    "play.google.com",
    "apps.apple.com",
    "youtube.com",
    "www.youtube.com",
    "youtu.be",
    "twitter.com",
    "x.com",
    "docs.google.com",
    "schema.org",
    "www.googletagmanager.com",
    "googletagmanager.com",
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "pagead2.googlesyndication.com",
    "awesome.re",
    "cdn.rawgit.com",
}

TRACKING_QUERY_PREFIXES = ("utm_", "ref_", "fbclid", "gclid")


@dataclasses.dataclass
class Candidate:
    id: str
    source_id: str
    source_family: str
    source_url: str
    discovered_at: str
    link_text: str
    raw_url: str
    canonical_url: str
    domain: str
    topic_hint: str
    inferred_topics: list[str]
    provenance: dict = dataclasses.field(default_factory=dict)
    repository_associations: list[dict] = dataclasses.field(default_factory=list)


SUGGESTION_TOPICS = {"art", "science", "maps", "music", "games", "culture", "archives", "education", "nature", "tech"}


def load_community_suggestions(path: str) -> list[tuple[str, str | None]]:
    rows = json.loads(Path(path).read_text())
    if not isinstance(rows, list) or len(rows) > 24:
        raise ValueError("invalid community suggestion snapshot")
    suggestions: list[tuple[str, str | None]] = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("canonical_url"), str):
            raise ValueError("invalid community suggestion snapshot")
        topics = row.get("topics") if isinstance(row.get("topics"), list) else []
        hint = next((topic for topic in topics if topic in SUGGESTION_TOPICS), None)
        suggestions.append((row["canonical_url"], hint))
    return suggestions


def load_existing_catalogue_keys() -> tuple[set[str], set[str]]:
    canonical_urls: set[str] = set()
    domains: set[str] = set()
    catalogue_dir = REPO_ROOT / "src/lib/catalogue"
    if not catalogue_dir.exists():
        return canonical_urls, domains
    for ts_file in catalogue_dir.glob("*.ts"):
        text = ts_file.read_text(encoding="utf-8", errors="ignore")
        for match in re.finditer(r'canonicalUrl:\s*"([^"]+)"', text):
            canonical = canonicalize_url(match.group(1))
            if canonical:
                canonical_urls.add(canonical)
        for match in re.finditer(r'domain:\s*"([^"]+)"', text):
            domains.add(match.group(1).strip().lower())
    return canonical_urls, domains


def fetch_text(url: str) -> str:
    assert_url_public_https(url)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    opener = build_opener(enforce_robots=True)
    with opener.open(req, timeout=REQUEST_TIMEOUT_S) as resp:
        payload = resp.read(MAX_SOURCE_BYTES + 1)
        if len(payload) > MAX_SOURCE_BYTES:
            raise ValueError(f"source too large ({len(payload)} bytes): {url}")
        encoding = resp.headers.get_content_charset() or "utf-8"
        return payload.decode(encoding, errors="replace")


def parse_markdown_links(markdown: str) -> list[tuple[str, str]]:
    pattern = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
    return [(m.group(1).strip(), m.group(2).strip()) for m in pattern.finditer(markdown)]


def parse_feed_links(feed_text: str) -> list[tuple[str, str]]:
    links: list[tuple[str, str]] = []
    item_pattern = re.compile(r"<item>(.*?)</item>", re.DOTALL | re.IGNORECASE)
    entry_pattern = re.compile(r"<entry>(.*?)</entry>", re.DOTALL | re.IGNORECASE)
    title_pattern = re.compile(r"<title[^>]*>(.*?)</title>", re.DOTALL | re.IGNORECASE)
    link_pattern = re.compile(r"<link[^>]+href=['\"]([^'\"]+)['\"]|<link>(.*?)</link>", re.IGNORECASE)

    for block in item_pattern.findall(feed_text) + entry_pattern.findall(feed_text):
        title_match = title_pattern.search(block)
        title = re.sub(r"<[^>]+>", "", title_match.group(1)).strip() if title_match else "feed-item"
        link_match = link_pattern.search(block)
        if not link_match:
            continue
        link = (link_match.group(1) or link_match.group(2) or "").strip()
        if link:
            links.append((title, link))
    return links


def parse_html_links(html: str, source_url: str) -> list[tuple[str, str]]:
    href_pattern = re.compile(r"<a[^>]+href=['\"]([^'\"]+)['\"][^>]*>(.*?)</a>", re.IGNORECASE | re.DOTALL)
    links: list[tuple[str, str]] = []
    for href, text_html in href_pattern.findall(html):
        text = re.sub(r"<[^>]+>", " ", text_html)
        text = re.sub(r"\s+", " ", text).strip() or "html-link"
        absolute = urllib.parse.urljoin(source_url, href.strip())
        links.append((text, absolute))

    # Fallback for script-embedded absolute URLs that may not be in anchor tags.
    for raw in re.findall(r"https?://[^\"'\s<>)]+", html):
        links.append(("embedded-url", raw))
    return links


def parse_external_html_links(html: str, source_url: str) -> list[tuple[str, str]]:
    source_host = urllib.parse.urlparse(source_url).hostname or ""
    parsed_links = parse_html_links(html, source_url)
    results: list[tuple[str, str]] = []
    seen: set[str] = set()
    for link_text, candidate_url in parsed_links:
        parsed = urllib.parse.urlparse(candidate_url)
        host = (parsed.hostname or "").lower()
        if not host:
            continue
        if host == source_host or host.endswith(f".{source_host}"):
            continue
        normalized = candidate_url.strip()
        if normalized in seen:
            continue
        seen.add(normalized)
        results.append((link_text, normalized))
    return results


def parse_bored_button_random_links(html: str, source_url: str) -> list[tuple[str, str]]:
    return parse_external_html_links(html, source_url)


def drop_tracking_query(parsed: urllib.parse.ParseResult) -> urllib.parse.ParseResult:
    query_pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    kept_pairs = []
    for key, value in query_pairs:
        lowered = key.lower()
        if lowered in TRACKING_QUERY_PREFIXES or lowered.startswith("utm_"):
            continue
        kept_pairs.append((key, value))
    return parsed._replace(query=urllib.parse.urlencode(kept_pairs), fragment="")


def canonicalize_url(raw_url: str) -> str | None:
    try:
        parsed = urllib.parse.urlparse(raw_url.strip())
    except ValueError:
        return None
    if parsed.scheme != "https":
        return None
    if not parsed.hostname:
        return None
    host = parsed.hostname.lower().rstrip(".")
    netloc = host
    if parsed.port and parsed.port != 443:
        netloc = f"{host}:{parsed.port}"
    rebuilt = drop_tracking_query(parsed._replace(netloc=netloc))
    path = rebuilt.path or "/"
    if path != "/" and path.endswith("/"):
        path = path[:-1]
    normalized = rebuilt._replace(path=path)
    return urllib.parse.urlunparse(normalized)


def looks_like_asset_or_badge(url: str, link_text: str) -> bool:
    lowered_url = url.lower()
    lowered_text = link_text.lower()
    if lowered_text.startswith("![") or "badge" in lowered_text:
        return True
    if any(lowered_url.endswith(ext) for ext in (".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".pdf", ".zip")):
        return True
    if "/badge" in lowered_url or "badge.svg" in lowered_url:
        return True
    return False


def host_is_disallowed(hostname: str) -> bool:
    host = hostname.lower()
    if host in DISALLOWED_DOMAINS:
        return True
    return any(snippet in host for snippet in DISALLOWED_HOST_SNIPPETS)


def resolve_public_ip(hostname: str) -> tuple[bool, str]:
    try:
        addr_info = socket.getaddrinfo(hostname, None)
    except OSError as exc:
        return False, f"dns_error:{exc}"
    for info in addr_info:
        ip_txt = info[4][0]
        try:
            ip_obj = ipaddress.ip_address(ip_txt)
        except ValueError:
            return False, f"invalid_ip:{ip_txt}"
        if (
            ip_obj.is_private
            or ip_obj.is_loopback
            or ip_obj.is_link_local
            or ip_obj.is_multicast
            or ip_obj.is_reserved
            or ip_obj.is_unspecified
        ):
            return False, f"disallowed_ip:{ip_txt}"
    return True, "ok"


def assert_url_public_https(url: str) -> None:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise urllib.error.URLError(f"non_https:{parsed.scheme or 'missing'}")
    host = (parsed.hostname or "").lower()
    if not host:
        raise urllib.error.URLError("missing_host")
    if host_is_disallowed(host):
        raise urllib.error.URLError(f"disallowed_host:{host}")
    ok, reason = resolve_public_ip(host)
    if not ok:
        raise urllib.error.URLError(reason)


def assert_candidate_screening_url(url: str) -> None:
    if (len(url.encode("utf-16-le")) // 2 > MAX_SCREENED_FINAL_URL_LENGTH
            or not url.startswith("https://") or any(character.isspace() for character in url)
            or github_demo_provider.canonical_https_url(url) is None):
        raise urllib.error.URLError("invalid_screening_url")
    assert_url_public_https(url)


class SafeRedirectHandler(urllib.request.HTTPRedirectHandler):
    """Re-check scheme/host/DNS on every redirect hop (closes SSRF gap)."""

    def __init__(self, *, enforce_robots: bool = False) -> None:
        super().__init__()
        self.enforce_robots = enforce_robots

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        if self.enforce_robots:
            assert_candidate_screening_url(newurl)
            allowed, reason = robots_allows(newurl)
            if not allowed:
                raise urllib.error.URLError(reason)
        else:
            assert_url_public_https(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def build_opener(*, enforce_robots: bool = False) -> urllib.request.OpenerDirector:
    return urllib.request.build_opener(SafeRedirectHandler(enforce_robots=enforce_robots))


_robots_cache: dict[str, dict] = {}


def parse_robots_txt(text: str) -> dict:
    """Parse user-agent groups with Allow, Disallow, and Crawl-delay directives."""
    groups: list[dict] = []
    agents: list[str] = []
    rules: list[dict[str, str]] = []
    crawl_delay: float | None = None
    saw_directive = False

    def flush_group() -> None:
        nonlocal agents, rules, crawl_delay, saw_directive
        if agents:
            groups.append(
                {"agents": agents, "rules": rules, "crawl_delay": crawl_delay}
            )
        agents = []
        rules = []
        crawl_delay = None
        saw_directive = False

    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key_l = key.strip().lower()
        value = value.strip()
        if key_l == "user-agent":
            if saw_directive:
                flush_group()
            agents.append(value.lower())
        elif agents and key_l in {"allow", "disallow"}:
            saw_directive = True
            if value:
                rules.append({"kind": key_l, "path": value})
        elif agents and key_l == "crawl-delay":
            saw_directive = True
            try:
                crawl_delay = float(value)
            except ValueError:
                crawl_delay = None
    flush_group()
    return {"fetched": True, "groups": groups, "error": None}


def fetch_robots_record(host: str, scheme: str = "https") -> dict:
    if host in _robots_cache:
        return _robots_cache[host]
    robots_url = f"{scheme}://{host}/robots.txt"
    record: dict = {"fetched": False, "groups": [], "error": None, "absent": False}
    try:
        assert_url_public_https(robots_url)
        req = urllib.request.Request(robots_url, headers={"User-Agent": USER_AGENT})
        opener = build_opener()
        with opener.open(req, timeout=REQUEST_TIMEOUT_S) as resp:
            payload = resp.read(100_000).decode("utf-8", errors="replace")
            record = parse_robots_txt(payload)
            record["absent"] = False
    except urllib.error.HTTPError as exc:
        if exc.code in {404, 410}:
            record = {"fetched": True, "groups": [], "error": None, "absent": True}
        else:
            record = {
                "fetched": False,
                "groups": [],
                "error": f"http_error:{exc.code}",
                "absent": False,
            }
    except (urllib.error.URLError, TimeoutError) as exc:
        record = {
            "fetched": False,
            "groups": [],
            "error": f"{type(exc).__name__}:{exc}",
            "absent": False,
        }
    _robots_cache[host] = record
    return record


def robots_allows(url: str) -> tuple[bool, str]:
    parsed = urllib.parse.urlparse(url)
    host = (parsed.hostname or "").lower()
    if not host:
        return False, "robots_missing_host"
    record = fetch_robots_record(host, parsed.scheme or "https")
    if not record.get("fetched"):
        cause = record.get("error") or "unknown"
        return False, f"robots_unreachable_fail_closed:{cause}"

    product = USER_AGENT.split("/", 1)[0].lower()
    groups = record.get("groups")
    if groups is None:
        groups = [
            {
                "agents": ["*"],
                "rules": [
                    {"kind": "disallow", "path": rule}
                    for rule in record.get("disallows") or []
                ],
                "crawl_delay": record.get("crawl_delay"),
            }
        ]
    matches: list[tuple[int, dict]] = []
    for group in groups:
        agent_matches = [
            0 if agent == "*" else len(agent)
            for agent in group.get("agents", [])
            if agent == "*" or product.startswith(agent)
        ]
        if agent_matches:
            matches.append((max(agent_matches), group))
    if not matches:
        return True, "ok"
    best_specificity = max(specificity for specificity, _group in matches)
    selected_groups = [group for specificity, group in matches if specificity == best_specificity]
    delays = [
        group.get("crawl_delay")
        for group in selected_groups
        if isinstance(group.get("crawl_delay"), (int, float))
    ]
    delay = max(delays) if delays else None
    # Extremely large crawl-delay (e.g. Curlie 1000s) is treated as not workable for batch discovery.
    if isinstance(delay, (int, float)) and delay >= 60:
        return False, f"robots_crawl_delay_too_high:{delay}"

    target = (parsed.path or "/") + (f"?{parsed.query}" if parsed.query else "")
    matched_rules: list[tuple[int, str, str]] = []
    for group in selected_groups:
        for rule in group.get("rules", []):
            pattern = rule.get("path") or ""
            anchored = pattern.endswith("$")
            body = pattern[:-1] if anchored else pattern
            regex = re.escape(body).replace(r"\*", ".*")
            if re.match(f"^{regex}{'$' if anchored else ''}", target):
                matched_rules.append((len(body.replace("*", "")), rule.get("kind", "disallow"), pattern))
    if not matched_rules:
        return True, "ok"
    longest = max(length for length, _kind, _pattern in matched_rules)
    strongest = [rule for rule in matched_rules if rule[0] == longest]
    if any(kind == "allow" for _length, kind, _pattern in strongest):
        return True, "ok"
    return False, f"robots_disallow:{strongest[0][2]}"


def interleave_sources_by_family(sources: list[dict]) -> list[tuple[int, dict]]:
    """Round-robin sources across families so early webrings cannot starve later families."""
    buckets: dict[str, list[tuple[int, dict]]] = {}
    for index, source in enumerate(sources):
        family = source.get("source_family", "unknown")
        buckets.setdefault(family, []).append((index, source))
    families = sorted(
        buckets.keys(),
        key=lambda family: (1 if family in NOVELTY_FAMILIES else 0, family),
    )
    ordered: list[tuple[int, dict]] = []
    while any(buckets[family] for family in families):
        for family in families:
            if buckets[family]:
                ordered.append(buckets[family].pop(0))
    return ordered


def family_batch_quota(family: str, max_candidates: int, family_count: int) -> int:
    base = max(2, (max_candidates + max(1, family_count) - 1) // max(1, family_count))
    if family in NOVELTY_FAMILIES:
        return max(1, base // 2)
    # Also respect long-run soft caps as upper bound for a single batch.
    soft = FAMILY_SOFT_CAPS.get(family, base)
    return max(1, min(base, soft, max_candidates))


def domain_candidate_priority(url: str) -> int:
    path = (urllib.parse.urlparse(url).path or "/").lower().rstrip("/")
    if not path:
        return 0
    leaf = path.rsplit("/", 1)[-1]
    if (
        leaf in {"feed", "rss", "atom"}
        or leaf.startswith(("feed.", "rss.", "atom."))
        or leaf.endswith((".xml", ".rss", ".atom"))
    ):
        return 2
    return 1


def infer_topics(text_blobs: Iterable[str], topic_hint: str) -> list[str]:
    blob = " ".join(text_blobs).lower()
    topics: list[str] = []
    for topic, keywords in TOPIC_KEYWORDS.items():
        if any(keyword in blob for keyword in keywords):
            topics.append(topic)
    if topic_hint and topic_hint not in topics:
        topics = topics[:2] + [topic_hint]
    return topics[:3] if topics else ([topic_hint] if topic_hint else ["culture"])


def framing_flags(xfo: str | None, csp: str | None) -> dict[str, bool]:
    ancestors = [directive for directive in (csp or "").split(";") if re.match(r"\s*frame-ancestors\b", directive, re.I)]
    return {
        "xfo_present": bool((xfo or "").strip()),
        "csp_present": bool((csp or "").strip()),
        "csp_frame_ancestors": bool(ancestors),
        "denied": bool(re.search(r"(?:^|[\s,])(?:deny|sameorigin)(?:[\s,]|$)", xfo or "", re.I))
        or any(re.search(r"(?:^|\s)'(?:none|self)'(?:\s|$)", directive, re.I) for directive in ancestors),
    }


def screening_framing(screening: dict) -> dict[str, bool]:
    framing = screening.get("framing")
    if isinstance(framing, dict):
        return {key: framing.get(key) is True for key in framing_flags(None, None)}
    return framing_flags(screening.get("x_frame_options"), screening.get("content_security_policy"))


def framing_denied(screening: dict) -> bool:
    return screening_framing(screening)["denied"]


def screening_error(reason: str) -> str:
    code, _, detail = reason.partition(":")
    if code in {"disallowed_ip", "invalid_ip"}:
        try:
            return f"{code}:{ipaddress.ip_address(detail)}"
        except ValueError:
            return code
    if code == "robots_unreachable_fail_closed":
        address = re.search(r"\bdisallowed_ip:([a-f\d:.]+)(?=[>\s]|$)", detail, re.I)
        if address:
            return f"{code}:{screening_error(f'disallowed_ip:{address[1]}')}"
        return code
    if code in {"robots_disallow", "robots_missing_host", "dns_error",
                "disallowed_host", "missing_host", "non_https", "invalid_screening_url"}:
        return code
    return "screening_request_failed"


def screened_media_type(headers: dict) -> str | None:
    content_type = (headers.get("content-type") or "").split(";", 1)[0].strip().lower()
    if not content_type:
        return None
    return content_type if content_type in {"text/html", "application/xhtml+xml", "text/plain"} else "other"


def screening_content_is_playable(screening: dict) -> bool:
    content_type = (screening.get("content_type") or "").split(";", 1)[0].strip().lower()
    if not content_type:
        return True
    return content_type in {"text/html", "application/xhtml+xml", "text/plain"}


def selection_status_for_screening(screening: dict) -> str:
    """Discovery can quarantine or queue review, but never approve launch rotation."""
    return "blocked" if framing_denied(screening) else "evaluation_candidate"


def queue_status_for_screening(screening: dict) -> str:
    """Route screened candidates to human review or quarantine; never qualify them."""
    if (
        screening.get("error")
        or not screening.get("available")
        or framing_denied(screening)
        or not screening_content_is_playable(screening)
    ):
        return "quarantined"
    return "pending_review"


PLAIN_PATH_SEGMENT = re.compile(r"[A-Za-z0-9._~-]{1,40}")


def clean_redirect_target(start: str, final: str) -> str | None:
    """A same-site redirect to a plain public path can become the canonical URL.

    Queries, fragments, credentials, ports and token-like path segments are where
    private redirect state lives, so any of them keeps the redirect opaque.
    """
    try:
        source, target = urllib.parse.urlsplit(start), urllib.parse.urlsplit(final)
        port = target.port
    except ValueError:
        return None
    if (target.scheme != "https" or target.query or target.fragment or target.username or target.password
            or port is not None or len(final) > 200 or not target.hostname):
        return None
    if target.hostname.lower().removeprefix("www.") != (source.hostname or "").lower().removeprefix("www."):
        return None
    segments = [segment for segment in target.path.split("/") if segment]
    if len(segments) > 3 or any(
        not PLAIN_PATH_SEGMENT.fullmatch(segment) or sum(c.isdigit() for c in segment) > 6 for segment in segments
    ):
        return None
    return final


def screen_url(url: str) -> dict:
    started = time.time()
    try:
        robots_ok, robots_reason = robots_allows(url)
        if not robots_ok:
            return {
                "available": False,
                "status": None,
                "elapsed_ms": int((time.time() - started) * 1000),
                "framing": framing_flags(None, None),
                "content_type": None,
                "title_hint": None,
                "error": screening_error(robots_reason),
            }
        assert_candidate_screening_url(url)
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        opener = build_opener(enforce_robots=True)
        with opener.open(req, timeout=REQUEST_TIMEOUT_S) as resp:
            status = getattr(resp, "status", 200)
            final_url = resp.geturl()
            # Final URL may differ after redirects; re-assert safety.
            assert_candidate_screening_url(final_url)
            screened_destination = json.loads(subprocess.run(
                ["node", str(REPO_ROOT / "scripts/identify_screened_destination.mjs")],
                input=final_url, text=True, capture_output=True, check=True, timeout=REQUEST_TIMEOUT_S,
            ).stdout)
            if screened_destination is None:
                raise urllib.error.URLError("invalid_screening_url")
            headers = {k.lower(): v for k, v in resp.headers.items()}
            snippet = resp.read(6000).decode("utf-8", errors="ignore")
            elapsed_ms = int((time.time() - started) * 1000)
            raw_title = extract_raw_title(snippet)
            redirected = final_url != url
            adopted_url = clean_redirect_target(url, final_url) if redirected else None
            if adopted_url:
                redirected = False
            signals = classify_title(raw_title) if raw_title else None
            if redirected:
                signals = read_title_signals(signals)
            return {
                "available": True,
                "status": status,
                "screened_destination": screened_destination,
                "elapsed_ms": elapsed_ms,
                "framing": framing_flags(headers.get("x-frame-options"), headers.get("content-security-policy")),
                "content_type": screened_media_type(headers),
                "title_hint": sanitize_title(raw_title) if raw_title and not redirected else None,
                "title_signals": signals,
                "redirected": redirected,
                **({"adopted_url": adopted_url} if adopted_url else {}),
                "error": None,
            }
    except urllib.error.HTTPError as exc:
        elapsed_ms = int((time.time() - started) * 1000)
        headers = {k.lower(): v for k, v in exc.headers.items()} if exc.headers else {}
        return {
            "available": False,
            "status": exc.code,
            "elapsed_ms": elapsed_ms,
            "framing": framing_flags(headers.get("x-frame-options"), headers.get("content-security-policy")),
            "content_type": screened_media_type(headers),
            "title_hint": None,
            "error": f"http_error:{exc.code}",
        }
    except (urllib.error.URLError, TimeoutError) as exc:
        elapsed_ms = int((time.time() - started) * 1000)
        return {
            "available": False,
            "status": None,
            "elapsed_ms": elapsed_ms,
            "framing": framing_flags(None, None),
            "content_type": None,
            "title_hint": None,
            "error": screening_error(str(exc.reason)) if isinstance(exc, urllib.error.URLError) else "screening_timeout",
        }


TITLE_URL = re.compile(
    r"(?:[a-z][a-z\d+.-]*://|\bwww\.)[^\s<>]+|(?:^|(?<=[\s(]))"
    r"(?://[^\s<>]+|[\w.-]+\.[a-z]{2,63}/[^\s<>]*)",
    re.I,
)


def sanitize_title(value: str) -> str:
    text = unicodedata.normalize("NFKC", html.unescape(value))
    text = TITLE_URL.sub(" ", text)
    text = re.sub(r"[^\s<>\[\](){}]+", lambda token: " " if re.search(r"[/#?].", token.group()) else token.group(), text)
    text = re.sub(r"\[\s*\]|\(\s*\)|\{\s*\}|[\[({]\s*$", " ", text)
    return re.sub(r"\s+", " ", text).strip()[:180]


def safe_domain_title(domain: str) -> str:
    return f"Website at {domain}"[:180]


def extract_raw_title(snippet: str) -> str | None:
    match = re.search(r"<title[^>]*>(.*?)</title>", snippet, re.IGNORECASE | re.DOTALL)
    return html.unescape(re.sub(r"<[^>]+>", "", match.group(1))) if match else None


def extract_title(snippet: str) -> str | None:
    raw = extract_raw_title(snippet)
    return sanitize_title(raw) or None if raw else None


def read_title_signals(value) -> dict:
    if (
        isinstance(value, dict)
        and set(value) in ({"quality", "denied"}, {"quality", "denied", "digest"})
        and type(value["quality"]) is bool
        and type(value["denied"]) is bool
        and ("digest" not in value or isinstance(value["digest"], str) and re.fullmatch(r"[0-9a-f]{64}", value["digest"]))
    ):
        return value
    return {"quality": False, "denied": isinstance(value, dict) and value.get("denied") is True}


def classify_title(raw: str) -> dict:
    try:
        result = subprocess.run(
            ["node", str(REPO_ROOT / "scripts/classify_collector_title.mjs")],
            input=json.dumps({"raw": raw, "cleaned": sanitize_title(raw)}), text=True,
            capture_output=True, check=True, timeout=REQUEST_TIMEOUT_S,
        )
        return read_title_signals(json.loads(result.stdout))
    except (subprocess.SubprocessError, ValueError, TypeError):
        pass
    return {"quality": False, "denied": False}


def sanitize_id(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")[:80]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        default="docs/catalogue",
        help="Directory for generated discovery artifacts.",
    )
    parser.add_argument("--db-path", default=None, help="SQLite ops DB path (STUMBLR_DB_PATH).")
    parser.add_argument("--known-urls", default=None, help="Authenticated shared review-queue URL dedupe snapshot; never fetched as targets.")
    parser.add_argument("--community-urls", default=None, help="Authenticated snapshot of unscreened Suggest-form URLs.")
    parser.add_argument("--resume-run", default=None, help="Resume an existing discovery run id.")
    parser.add_argument("--max-candidates", type=int, default=MAX_CANDIDATES)
    parser.add_argument("--skip-db", action="store_true", help="Artifacts only; skip durable DB writes.")
    parser.add_argument("--owner", default="local-batch", help="Lease owner id for overlap prevention.")
    args = parser.parse_args()

    sys.path.insert(0, str(REPO_ROOT / "scripts"))
    import stumblr_db  # noqa: WPS433

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    discovered_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    existing_urls, existing_domains = load_existing_catalogue_keys()
    if args.known_urls:
        shared = json.loads(Path(args.known_urls).read_text())
        if not isinstance(shared, list) or len(shared) > 20000 or not all(isinstance(url, str) for url in shared):
            raise ValueError("invalid shared known URL snapshot")
        existing_urls.update(shared)
    max_candidates = max(1, min(args.max_candidates, MAX_CANDIDATES))

    db_conn = None
    run_id = None
    checkpoint: dict = {"source_index": 0, "accepted": 0}
    if not args.skip_db:
        if args.db_path:
            os.environ["STUMBLR_DB_PATH"] = args.db_path
        db_conn = stumblr_db.connect(args.db_path)
        if args.resume_run:
            run_id = args.resume_run
            if not stumblr_db.try_acquire_lease(db_conn, run_id, args.owner):
                print(json.dumps({"ok": False, "error": "lease_held", "run_id": run_id}))
                return 2
            checkpoint = stumblr_db.get_checkpoint(db_conn, run_id)
        else:
            run_id = stumblr_db.start_run(db_conn, args.owner)

    discovered: list[Candidate] = []
    rejected: list[dict] = []
    seen_urls: set[str] = set()
    seen_domains: Counter = Counter()
    domain_candidate_indexes: dict[str, int] = {}
    family_accepted: Counter = Counter()
    families = sorted({source.get("source_family", "unknown") for source in SOURCE_CONFIG})
    family_quotas = {
        family: family_batch_quota(family, max_candidates, len(families)) for family in families
    }
    github_stats: dict = {}
    github_associations: dict[str, list[dict]] = {}
    source_yields: dict[str, dict] = {
        source["id"]: {
            "kind": source["kind"],
            "source_family": source.get("source_family", "unknown"),
            "source_url": source["url"],
            "attempted": 0,
            "skipped": 0,
            "skipped_reason": None,
            "fetched": 0,
            "raw_links_seen": 0,
            "accepted_candidates": 0,
            "rejected_candidates": 0,
            "errors": 0,
            "robots": None,
        }
        for source in SOURCE_CONFIG
    }

    start_index = int(checkpoint.get("source_index") or 0)
    processed_original_indexes: set[int] = set()
    for original_index, source in interleave_sources_by_family(SOURCE_CONFIG):
        source_index = original_index
        if source_index < start_index:
            source_yields[source["id"]]["skipped"] = 1
            source_yields[source["id"]]["skipped_reason"] = "before_checkpoint"
            continue
        if source_index in processed_original_indexes:
            continue
        processed_original_indexes.add(source_index)

        family = source.get("source_family", "unknown")
        quota = family_quotas.get(family, 2)
        if family_accepted[family] >= quota:
            source_yields[source["id"]]["skipped"] = 1
            source_yields[source["id"]]["skipped_reason"] = f"family_batch_quota:{quota}"
            if db_conn and run_id:
                checkpoint = {
                    "source_index": max(start_index, source_index + 1),
                    "accepted": len(discovered),
                    "family_accepted": dict(family_accepted),
                }
                stumblr_db.checkpoint_run(db_conn, run_id, checkpoint, {"accepted": len(discovered)})
            continue
        if len(discovered) >= max_candidates:
            source_yields[source["id"]]["skipped"] = 1
            source_yields[source["id"]]["skipped_reason"] = "max_candidates_reached"
            continue

        if db_conn and run_id and not stumblr_db.try_acquire_lease(db_conn, run_id, args.owner):
            stumblr_db.finish_run(db_conn, run_id, "interrupted", {"accepted": len(discovered)}, "lease_lost")
            print(json.dumps({"ok": False, "error": "lease_lost", "run_id": run_id}))
            return 3

        source_yields[source["id"]]["attempted"] = 1
        is_github = source["kind"] == "github_repositories"
        is_community = source["kind"] == "community_suggestions"
        if is_github:
            robots_ok, robots_reason = True, "github_api"
        elif is_community:
            robots_ok, robots_reason = True, "own_site"
        else:
            robots_ok, robots_reason = robots_allows(source["url"])
        source_yields[source["id"]]["robots"] = robots_reason
        if not robots_ok:
            source_yields[source["id"]]["skipped"] = 1
            source_yields[source["id"]]["skipped_reason"] = robots_reason
            rejected.append(
                {
                    "source_id": source["id"],
                    "raw_url": source["url"],
                    "reason": robots_reason,
                }
            )
            continue

        source_host = (urllib.parse.urlparse(source["url"]).hostname or "").lower()
        links: list[tuple[str, str]] = []
        github_provenance: dict[str, dict] = {}
        topic_hints: dict[str, str] = {}
        try:
            if is_community:
                suggestions = load_community_suggestions(args.community_urls) if args.community_urls else []
                for raw_url, hint in suggestions:
                    # Submitted titles are untrusted; the screened page supplies the title.
                    links.append((safe_domain_title((urllib.parse.urlparse(raw_url).hostname or "").lower()), raw_url))
                    if hint:
                        topic_hints[raw_url] = hint
                source_yields[source["id"]]["raw_links_seen"] = len(links)
            elif is_github:
                leads, github_stats = github_demo_provider.collect_github_demo_leads(
                    os.environ.get("GITHUB_TOKEN", ""), github_demo_provider.rotating_queries(), 100
                )
                if github_stats.get("error"):
                    raise ValueError(github_stats["error"])
                for lead in leads[:100]:
                    try:
                        if not isinstance(lead, dict):
                            raise ValueError("invalid metadata")
                        demo = github_demo_provider.demo_homepage(lead.get("demo_url"))
                        if demo is None or not isinstance(lead.get("description", ""), str):
                            raise ValueError("invalid metadata")
                        lead = stumblr_db.validate_repository_associations([{
                            **lead, "demo_url": canonicalize_url(demo),
                            "raw_homepage": lead.get("raw_homepage", lead.get("demo_url")),
                        }])[0]
                    except (ValueError, TypeError):
                        github_stats["invalid_associations"] = github_stats.get("invalid_associations", 0) + 1
                        source_yields[source["id"]]["rejected_candidates"] += 1
                        rejected.append({"source_id": source["id"], "reason": "invalid_github_association"})
                        continue
                    demo_domain = urllib.parse.urlparse(lead["demo_url"]).hostname
                    associations = github_associations.setdefault(demo_domain, [])
                    if not any(str(item["repository_id"]) == str(lead["repository_id"]) for item in associations):
                        associations.append(lead)
                    links.append((lead.get("description") or lead["repository_full_name"], lead["demo_url"]))
                    github_provenance.setdefault(lead["demo_url"], lead)
                source_yields[source["id"]]["raw_links_seen"] = min(len(leads), 100)
            elif source["kind"] == "random_html":
                rounds = min(int(source.get("sample_rounds", MAX_RANDOM_FETCHES_PER_SOURCE)), MAX_RANDOM_FETCHES_PER_SOURCE)
                for index in range(rounds):
                    if len(discovered) >= max_candidates or family_accepted[family] >= quota:
                        break
                    text = fetch_text(source["url"])
                    parsed_links = parse_bored_button_random_links(text, source["url"])
                    links.extend(parsed_links)
                    source_yields[source["id"]]["raw_links_seen"] += len(parsed_links)
                    if index + 1 < rounds:
                        time.sleep(RANDOM_FETCH_DELAY_S)
            else:
                text = fetch_text(source["url"])
                if source["kind"] == "markdown":
                    links = parse_markdown_links(text)
                elif source["kind"] == "directory_html":
                    links = parse_external_html_links(text, source["url"])
                elif source["kind"] == "html":
                    links = parse_html_links(text, source["url"])
                else:
                    links = parse_feed_links(text)
                source_yields[source["id"]]["raw_links_seen"] = len(links)
            source_yields[source["id"]]["fetched"] = 1
        except Exception as exc:  # noqa: BLE001
            source_yields[source["id"]]["errors"] += 1
            rejected.append(
                {
                    "source_id": source["id"],
                    "raw_url": source["url"],
                    "reason": f"source_fetch_failed:{exc}",
                }
            )
            if db_conn and run_id:
                checkpoint = {"source_index": source_index + 1, "accepted": len(discovered)}
                stumblr_db.checkpoint_run(db_conn, run_id, checkpoint, {"accepted": len(discovered)})
            continue

        per_source_budget = min(MAX_PER_SOURCE_LINKS, max(4, quota * 3))
        limit = min(len(links), per_source_budget) if source["kind"] != "random_html" else min(len(links), per_source_budget)
        for link_text, raw_url in links[:limit]:
            if len(discovered) >= max_candidates or family_accepted[family] >= quota:
                break
            canonical = canonicalize_url(raw_url)
            if not canonical:
                source_yields[source["id"]]["rejected_candidates"] += 1
                rejected.append(
                    {
                        "source_id": source["id"],
                        "raw_url": raw_url,
                        "reason": "unsupported_or_invalid_url",
                    }
                )
                continue
            parsed = urllib.parse.urlparse(canonical)
            host = parsed.hostname or ""
            if source_host and (host == source_host or host.endswith(f".{source_host}")):
                source_yields[source["id"]]["rejected_candidates"] += 1
                rejected.append(
                    {
                        "source_id": source["id"],
                        "raw_url": raw_url,
                        "canonical_url": canonical,
                        "reason": "source_self_link",
                    }
                )
                continue
            if canonical in existing_urls:
                source_yields[source["id"]]["rejected_candidates"] += 1
                rejected.append(
                    {
                        "source_id": source["id"],
                        "raw_url": raw_url,
                        "canonical_url": canonical,
                        "reason": "already_in_catalogue",
                    }
                )
                continue
            if host in existing_domains:
                source_yields[source["id"]]["rejected_candidates"] += 1
                rejected.append(
                    {
                        "source_id": source["id"],
                        "raw_url": raw_url,
                        "canonical_url": canonical,
                        "reason": "already_known_domain",
                    }
                )
                continue
            if canonical in seen_urls:
                continue
            if looks_like_asset_or_badge(canonical, link_text):
                source_yields[source["id"]]["rejected_candidates"] += 1
                rejected.append(
                    {
                        "source_id": source["id"],
                        "raw_url": raw_url,
                        "canonical_url": canonical,
                        "reason": "asset_or_badge_link",
                    }
                )
                continue
            if host_is_disallowed(host):
                source_yields[source["id"]]["rejected_candidates"] += 1
                rejected.append(
                    {
                        "source_id": source["id"],
                        "raw_url": raw_url,
                        "canonical_url": canonical,
                        "reason": "disallowed_host_class",
                    }
                )
                continue
            host_ok, host_reason = resolve_public_ip(host)
            if not host_ok:
                source_yields[source["id"]]["rejected_candidates"] += 1
                rejected.append(
                    {
                        "source_id": source["id"],
                        "raw_url": raw_url,
                        "canonical_url": canonical,
                        "reason": host_reason,
                    }
                )
                continue

            topic_hint = topic_hints.get(raw_url, source["topic_hint"])
            inferred_topics = infer_topics([link_text, canonical, source["id"]], topic_hint)
            candidate = Candidate(
                # Keep discovery IDs URL-sensitive and within the shared import limit.
                id=stumblr_db.candidate_id(canonical, sanitize_id(host)),
                source_id=source["id"],
                source_family=family,
                source_url=source["url"],
                discovered_at=discovered_at,
                link_text=sanitize_title(link_text),
                raw_url=raw_url,
                canonical_url=canonical,
                domain=host,
                topic_hint=topic_hint,
                inferred_topics=inferred_topics,
                provenance=github_provenance.get(raw_url, {}),
            )
            seen_urls.add(canonical)
            existing_index = domain_candidate_indexes.get(host)
            if existing_index is not None:
                existing_candidate = discovered[existing_index]
                if domain_candidate_priority(canonical) >= domain_candidate_priority(
                    existing_candidate.canonical_url
                ):
                    source_yields[source["id"]]["rejected_candidates"] += 1
                    rejected.append(
                        {
                            "source_id": source["id"],
                            "raw_url": raw_url,
                            "canonical_url": canonical,
                            "reason": "duplicate_domain_in_batch",
                        }
                    )
                    continue
                source_yields[existing_candidate.source_id]["accepted_candidates"] -= 1
                source_yields[existing_candidate.source_id]["rejected_candidates"] += 1
                family_accepted[existing_candidate.source_family] -= 1
                rejected.append(
                    {
                        "source_id": existing_candidate.source_id,
                        "raw_url": existing_candidate.raw_url,
                        "canonical_url": existing_candidate.canonical_url,
                        "reason": "replaced_by_better_domain_candidate",
                    }
                )
                discovered[existing_index] = candidate
            else:
                domain_candidate_indexes[host] = len(discovered)
                discovered.append(candidate)
                seen_domains[host] = 1
            family_accepted[family] += 1
            source_yields[source["id"]]["accepted_candidates"] += 1

        if db_conn and run_id:
            checkpoint = {
                "source_index": source_index + 1,
                "accepted": len(discovered),
                "family_accepted": dict(family_accepted),
            }
            stumblr_db.checkpoint_run(db_conn, run_id, checkpoint, {"accepted": len(discovered)})

    # Attribution is aggregated from all harvested leads before URL/domain selection.
    for candidate in discovered:
        candidate.repository_associations = github_associations.get(candidate.domain, [])
    association_updates = [{
        "association_update": True,
        "canonical_url": canonicalize_url(associations[0]["demo_url"]),
        "domain": domain,
        "repository_associations": associations,
    } for domain, associations in sorted(github_associations.items())]

    screened = []
    for candidate in discovered[: min(MAX_SCREENED, max_candidates)]:
        screening = screen_url(candidate.canonical_url)
        adopted_url = screening.pop("adopted_url", None)
        if adopted_url:
            candidate.canonical_url = adopted_url
            candidate.domain = urllib.parse.urlsplit(adopted_url).hostname.lower()
        if screening.get("redirected"):
            # Neither page text nor harvested link text proves independence from the destination.
            candidate.link_text = safe_domain_title(candidate.domain)
            screening["title_hint"] = None
            screening["title_signals"] = read_title_signals(screening.get("title_signals"))
        elif screening.get("title_hint"):
            candidate.inferred_topics = infer_topics(
                [candidate.link_text, candidate.canonical_url, candidate.source_id, screening["title_hint"]],
                candidate.topic_hint,
            )
        screened.append(
            {
                **dataclasses.asdict(candidate),
                "screening": screening,
            }
        )
        if db_conn:
            stumblr_db.upsert_candidate(
                db_conn,
                canonical_url=candidate.canonical_url,
                domain=candidate.domain,
                source_id=candidate.source_id,
                source_family=candidate.source_family,
                source_url=candidate.source_url,
                status=queue_status_for_screening(screening),
                topic_hint=candidate.topic_hint,
                topics=candidate.inferred_topics,
                link_text=candidate.link_text,
                screen=screening,
                repository_associations=candidate.repository_associations,
                provenance={
                    **candidate.provenance,
                    "raw_url": candidate.raw_url,
                    "discovered_at": candidate.discovered_at,
                    "review_only": True,
                    "auto_rotation": False,
                },
            )

    if db_conn:
        for update in association_updates:
            stumblr_db.update_existing_repository_associations(
                db_conn, update["canonical_url"], update["domain"], update["repository_associations"],
            )

    EDITORIAL_REJECT_SNIPPETS = (
        "gag-gift",
        "funny-gag",
        "shop.",
        "/shop",
        "buy-now",
        "amazon.",
        "etsy.",
    )
    EDITORIAL_REJECT_DOMAINS = {
        "www.inherentlyfunny.com",
        "inherentlyfunny.com",
        "www.concerthotels.com",
        "concerthotels.com",
        "vimeo.com",
        "www.vimeo.com",
        "hackernoon.com",
    }
    selected = []
    selected_domains: set[str] = set()
    topic_target = Counter()
    family_target = Counter()
    # Prefer non-novelty families first to avoid Bored Button / novelty domination.
    ordered = sorted(
        screened,
        key=lambda row: (
            1 if row.get("source_family") in NOVELTY_FAMILIES else 0,
            row.get("source_family") or "",
            row["domain"],
        ),
    )
    for row in ordered:
        domain = row["domain"]
        family = row.get("source_family") or "unknown"
        if domain in selected_domains:
            continue
        if not row["screening"]["available"]:
            continue
        if row["screening"]["status"] and int(row["screening"]["status"]) >= 400:
            continue
        if not screening_content_is_playable(row["screening"]):
            rejected.append(
                {
                    "source_id": row["source_id"],
                    "raw_url": row["raw_url"],
                    "canonical_url": row["canonical_url"],
                    "reason": "non_page_content_type",
                }
            )
            continue
        lowered_url = row["canonical_url"].lower()
        if domain in EDITORIAL_REJECT_DOMAINS or any(snip in lowered_url for snip in EDITORIAL_REJECT_SNIPPETS):
            rejected.append(
                {
                    "source_id": row["source_id"],
                    "raw_url": row["raw_url"],
                    "canonical_url": row["canonical_url"],
                    "reason": "editorial_reject_commercial_or_low_fit",
                }
            )
            continue
        topics = row["inferred_topics"] or ["culture"]
        primary_topic = topics[0]
        soft_cap = 24 if primary_topic == "games" else 16
        if topic_target[primary_topic] >= soft_cap:
            continue
        family_cap = FAMILY_SOFT_CAPS.get(family, 30)
        if family_target[family] >= family_cap:
            continue
        denied = framing_denied(row["screening"])
        selected.append(
            {
                "id": row["id"],
                "canonical_url": row["canonical_url"],
                "domain": row["domain"],
                "title_hint": row["screening"]["title_hint"] or row["link_text"],
                "topics": topics,
                "source_id": row["source_id"],
                "source_family": family,
                "source_url": row["source_url"],
                "provenance": row["provenance"],
                "repository_associations": row["repository_associations"],
                "framing": screening_framing(row["screening"]),
                "availability_status": row["screening"]["status"],
                "screened_destination": row["screening"].get("screened_destination"),
                **({"redirected": True} if row["screening"].get("redirected") else {}),
                **({"title_signals": row["screening"]["title_signals"]} if row["screening"].get("title_signals") is not None else {}),
                "selection_status": selection_status_for_screening(row["screening"]),
                "notes": (
                    "Explicit framing denial from headers; quarantine from ordinary discovery."
                    if denied
                    else "Review-only shortlist. Not auto-published into live rotation."
                ),
            }
        )
        selected_domains.add(domain)
        topic_target[primary_topic] += 1
        family_target[family] += 1
        if len(selected) >= 70:
            break

    telemetry = {
        "sources_attempted": sum(1 for row in source_yields.values() if row["attempted"]),
        "sources_skipped": sum(1 for row in source_yields.values() if row["skipped"]),
        "sources_fetched": sum(1 for row in source_yields.values() if row["fetched"]),
        "sources_total": len(source_yields),
    }
    summary = {
        "generated_at": discovered_at,
        "source_count": len(SOURCE_CONFIG),
        "github": github_stats,
        "discovered_count": len(discovered),
        "screened_count": len(screened),
        "selected_count": len(selected),
        "rejected_count": len(rejected),
        "distinct_discovered_domains": len({c.domain for c in discovered}),
        "distinct_selected_domains": len({c["domain"] for c in selected}),
        "discovered_family_counts": dict(family_accepted),
        "family_batch_quotas": family_quotas,
        "selected_topic_counts": dict(topic_target),
        "selected_family_counts": dict(family_target),
        "source_yields": source_yields,
        "telemetry": telemetry,
        "run_id": run_id,
        "auto_rotation": False,
        "durability": "local_sqlite_proof" if db_conn else "artifacts_only",
    }

    (out_dir / "discovery_sources.json").write_text(json.dumps(SOURCE_CONFIG, indent=2) + "\n")
    (out_dir / "discovery_candidates.json").write_text(
        json.dumps([dataclasses.asdict(item) for item in discovered], indent=2) + "\n"
    )
    (out_dir / "discovery_screened.json").write_text(json.dumps(screened, indent=2) + "\n")
    (out_dir / "discovery_associations.json").write_text(json.dumps(association_updates, indent=2) + "\n")
    (out_dir / "discovery_selected.json").write_text(json.dumps(selected, indent=2) + "\n")
    (out_dir / "discovery_rejected.json").write_text(json.dumps(rejected, indent=2) + "\n")
    (out_dir / "discovery_summary.json").write_text(json.dumps(summary, indent=2) + "\n")

    if db_conn and run_id:
        stumblr_db.finish_run(
            db_conn,
            run_id,
            "succeeded",
            {
                "accepted": len(discovered),
                "screened": len(screened),
                "selected": len(selected),
                "rejected": len(rejected),
            },
        )
        db_conn.close()

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
