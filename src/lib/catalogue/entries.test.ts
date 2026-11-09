import { describe, expect, test } from "vitest";
import { getCatalogue } from "./index";

describe("catalogue", () => {
  test("launch-only filter excludes evaluation-only entries", () => {
    const entries = getCatalogue({ includeEvaluation: false });
    expect(entries).toHaveLength(0);
    expect(entries.every((entry) => entry.status === "launch_approved")).toBe(true);
  });

  test("evaluation filter excludes blocked entries", () => {
    const entries = getCatalogue({ includeEvaluation: true });
    expect(entries.some((entry) => entry.status === "blocked")).toBe(false);
    expect(entries.some((entry) => entry.domain === "radio.garden")).toBe(false);
  });
});
