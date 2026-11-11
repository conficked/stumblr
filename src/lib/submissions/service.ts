import crypto from "node:crypto";
import { catalogueEntries } from "@/lib/catalogue/entries";
import { readRuntimeCatalogue } from "@/lib/catalogue/runtimeStore";
import { Topic } from "@/lib/catalogue/types";
import { canonicalizeHttpsUrl, resolveHostSafety } from "@/lib/url/safeUrl";
import { findPendingByCanonicalOrDomain, findScreenedOutCandidate, insertCommunitySuggestion } from "./storage";
import { CommunitySuggestion, SuggestionInput } from "./types";

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 8;
const MAX_NOTE_LEN = 600;
const MAX_TITLE_LEN = 120;

const rateLimiter = new Map<string, number[]>();

function hashSubmitter(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function nowIso() {
  return new Date().toISOString();
}

function cleanTopicList(value: unknown): Topic[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<Topic>([
    "art",
    "science",
    "maps",
    "music",
    "games",
    "culture",
    "archives",
    "education",
    "nature",
    "tech",
  ]);
  const cleaned = value
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter((item): item is Topic => allowed.has(item as Topic));
  return Array.from(new Set(cleaned)).slice(0, 4);
}

function checkRateLimit(submitterKey: string): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const entries = (rateLimiter.get(submitterKey) ?? []).filter((stamp) => now - stamp <= RATE_LIMIT_WINDOW_MS);
  if (entries.length >= RATE_LIMIT_MAX) {
    const oldest = entries[0];
    const retryAfterSec = Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000));
    rateLimiter.set(submitterKey, entries);
    return { ok: false, retryAfterSec };
  }
  entries.push(now);
  rateLimiter.set(submitterKey, entries);
  return { ok: true };
}

function normalizeText(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLen);
}

function hasCatalogueDuplicate(canonicalUrl: string, domain: string): boolean {
  return [...catalogueEntries, ...readRuntimeCatalogue().entries].some(
    (entry) => entry.canonicalUrl === canonicalUrl || entry.domain === domain,
  );
}

function makeId(domain: string, canonicalUrl: string): string {
  const digest = crypto.createHash("sha1").update(canonicalUrl).digest("hex").slice(0, 10);
  return `${domain.replace(/[^a-z0-9]+/g, "-")}-${digest}`;
}

export async function processSuggestion(input: SuggestionInput, submitterToken: string) {
  const rate = checkRateLimit(submitterToken);
  if (!rate.ok) {
    return {
      ok: false as const,
      status: 429,
      code: "rate_limited",
      message: "Too many submissions from this client. Try again later.",
      retryAfterSec: rate.retryAfterSec ?? 60,
    };
  }

  const canonicalUrl = canonicalizeHttpsUrl(input.url ?? "");
  if (!canonicalUrl) {
    return {
      ok: false as const,
      status: 400,
      code: "invalid_url",
      message: "Provide a valid https URL.",
    };
  }

  const parsed = new URL(canonicalUrl);
  const hostSafety = await resolveHostSafety(parsed.hostname);
  if (!hostSafety.ok) {
    return {
      ok: false as const,
      status: 400,
      code: "unsafe_host",
      message: `Submission host rejected: ${hostSafety.reason}.`,
    };
  }

  const domain = parsed.hostname.toLowerCase();
  if (hasCatalogueDuplicate(canonicalUrl, domain)) {
    return {
      ok: true as const,
      status: 200,
      code: "already_in_catalogue",
      message: "This destination is already represented in the curated pool.",
      suggestionId: null,
    };
  }

  const screenedOut = findScreenedOutCandidate(canonicalUrl, domain);
  if (screenedOut) {
    return {
      ok: false as const,
      status: 409,
      code: screenedOut,
      message: screenedOut === "framing_denied"
        ? "This site was checked, but it blocks being shown inside other sites, so Stumblr can't display it."
        : "This site was checked and didn't pass Stumblr's screening, so it won't be added.",
    };
  }

  const duplicateQueued = findPendingByCanonicalOrDomain(canonicalUrl, domain);
  if (duplicateQueued) {
    return {
      ok: true as const,
      status: 200,
      code: "already_pending",
      message: "This destination is already pending review.",
      suggestionId: null,
    };
  }

  const title = normalizeText(input.title, MAX_TITLE_LEN);
  const note = normalizeText(input.note, MAX_NOTE_LEN);
  const topics = cleanTopicList(input.topics);
  const submitterHash = hashSubmitter(submitterToken);
  const suggestion: CommunitySuggestion = {
    id: makeId(domain, canonicalUrl),
    canonicalUrl,
    domain,
    submittedAt: nowIso(),
    status: "pending_review",
    source: "community",
    title,
    note,
    topics,
    submitterHash,
  };

  const write = insertCommunitySuggestion(suggestion);
  if (write.kind === "duplicate") {
    return {
      ok: true as const,
      status: 200,
      code: "already_pending",
      message: "This destination is already pending review.",
      suggestionId: null,
    };
  }

  return {
    ok: true as const,
    status: 201,
    code: "queued",
    message: "Thanks! It will be checked in the next discovery run and added if it passes screening.",
    suggestionId: suggestion.id,
  };
}

export function __resetSuggestionRateLimitForTests() {
  rateLimiter.clear();
}
