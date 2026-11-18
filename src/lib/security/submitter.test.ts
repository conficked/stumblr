import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { hashSubmitter, submitterKeyFromHeaders } from "./submitter";

test("cf-connecting-ip wins over a client-controlled X-Forwarded-For and user agent", () => {
  const first = submitterKeyFromHeaders(new Headers({
    "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1", "user-agent": "a",
  }));
  const rotated = submitterKeyFromHeaders(new Headers({
    "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.2, 203.0.113.7", "user-agent": "b",
  }));
  expect(first).toBe("203.0.113.7");
  expect(rotated).toBe(first);
});

test("falls back to the first X-Forwarded-For hop, then a shared bucket", () => {
  expect(submitterKeyFromHeaders(new Headers({ "x-forwarded-for": " 198.51.100.9 , 10.0.0.1" }))).toBe("198.51.100.9");
  expect(submitterKeyFromHeaders(new Headers())).toBe("no-ip");
});

test("submitter hashes are stable within a process but not a plain SHA-256 of the IP", () => {
  expect(hashSubmitter("203.0.113.7")).toBe(hashSubmitter("203.0.113.7"));
  expect(hashSubmitter("203.0.113.7")).toHaveLength(24);
  expect(hashSubmitter("203.0.113.7")).not.toBe(
    createHash("sha256").update("203.0.113.7").digest("hex").slice(0, 24),
  );
});
