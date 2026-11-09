import { expect, test } from "vitest";
import { createFrameCycle } from "./useFrameCycle";
import { getCatalogue } from "@/lib/catalogue";

test("ignores stale load completion when newer Next request started", () => {
  const [entryA, entryB] = getCatalogue({ includeEvaluation: true });
  const cycle = createFrameCycle();
  const first = cycle.startLoad(entryA);
  const second = cycle.startLoad(entryB);
  cycle.resolveLoad(first, { kind: "ready" });
  expect(cycle.getState().activeEntry?.id).toBe(entryB.id);
  cycle.resolveLoad(second, { kind: "ready" });
  expect(cycle.getState().phase).toBe("ready");
});
