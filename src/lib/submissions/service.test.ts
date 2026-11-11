/** @vitest-environment node */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/url/safeUrl", () => ({
  canonicalizeHttpsUrl: (rawUrl: string) => {
    try {
      const parsed = new URL(rawUrl.trim());
      if (parsed.protocol !== "https:") return null;
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return null;
    }
  },
  resolveHostSafety: async () => ({ ok: true }),
}));

import { closeOpsDbForTests, openOpsDb } from "@/lib/db/client";
import { listSuggestions } from "@/lib/db/suggestionsRepo";
import { __resetSuggestionRateLimitForTests, processSuggestion } from "./service";

describe("community suggestion service", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stumblr-suggestions-"));
    process.env.STUMBLR_DB_PATH = path.join(tmpDir, "ops.sqlite");
    closeOpsDbForTests();
    __resetSuggestionRateLimitForTests();
  });

  afterEach(() => {
    closeOpsDbForTests();
    delete process.env.STUMBLR_DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("accepts valid suggestion and stores pending review record", async () => {
    const result = await processSuggestion(
      {
        url: "https://example.org/interesting",
        title: "Interesting",
        note: "Looks useful for weird web exploration",
        topics: ["art", "culture"],
      },
      "submitter-a",
    );

    expect(result.ok).toBe(true);
    expect(result.status).toBe(201);
    expect(result.code).toBe("queued");

    openOpsDb();
    const suggestions = listSuggestions();
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].canonicalUrl).toBe("https://example.org/interesting");
    expect(suggestions[0].status).toBe("pending_review");
  });

  test("rejects invalid url payloads", async () => {
    const result = await processSuggestion({ url: "http://insecure.example.org" }, "submitter-b");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.code).toBe("invalid_url");
  });

  test("dedupes suggestions already pending", async () => {
    const first = await processSuggestion({ url: "https://unique.example.org/path" }, "submitter-c");
    const second = await processSuggestion({ url: "https://unique.example.org/path" }, "submitter-c");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.code).toBe("already_pending");
  });

  test("explains when discovery already screened the destination out", async () => {
    await processSuggestion({ url: "https://framed.example.org/" }, "submitter-f");
    const db = openOpsDb();
    const add = db.prepare(`INSERT INTO discovery_candidates (id, canonical_url, domain, source_id, source_family, source_url,
      discovered_at, status, screen_json, updated_at) VALUES (?, ?, ?, 'community-suggestions', 'community', 'https://stumblr.dev/',
      '2026-11-11', ?, ?, '2026-11-11')`);
    add.run("framed", "https://framed.example.org/", "framed.example.org", "quarantined", JSON.stringify({ framing: { denied: true } }));
    add.run("broken", "https://broken.example.org/", "broken.example.org", "quarantined", JSON.stringify({ status: 503 }));
    add.run("waiting", "https://waiting.example.org/", "waiting.example.org", "pending_review", JSON.stringify({ framing: { denied: false } }));

    expect(await processSuggestion({ url: "https://framed.example.org/" }, "submitter-f"))
      .toMatchObject({ ok: false, status: 409, code: "framing_denied" });
    expect(await processSuggestion({ url: "https://broken.example.org/other" }, "submitter-f"))
      .toMatchObject({ ok: false, status: 409, code: "screened_out" });
    expect(await processSuggestion({ url: "https://waiting.example.org/" }, "submitter-f")).toMatchObject({ ok: true });
  });

  test("rejects suggestions already represented in curated catalogue", async () => {
    const result = await processSuggestion({ url: "https://weavesilk.com/" }, "submitter-d");
    expect(result.ok).toBe(true);
    expect(result.code).toBe("already_in_catalogue");
  });

  test("rate limits repeated submissions from same client token", async () => {
    for (let i = 0; i < 8; i += 1) {
      const accepted = await processSuggestion({ url: `https://candidate-${i}.example.org` }, "submitter-e");
      expect(accepted.ok).toBe(true);
    }
    const blocked = await processSuggestion({ url: "https://candidate-overflow.example.org" }, "submitter-e");
    expect(blocked.ok).toBe(false);
    expect(blocked.status).toBe(429);
    expect(blocked.code).toBe("rate_limited");
  });
});
