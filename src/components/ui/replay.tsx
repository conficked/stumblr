"use client";

import { useCallback, useState, type ReactNode } from "react";

// Remounting on each trigger restarts the CSS animation even mid-play.
export function useReplay(): [number, () => void] {
  const [count, setCount] = useState(0);
  return [count, useCallback(() => setCount((value) => value + 1), [])];
}

export function Replay({ count, effect, children }: { count: number; effect: string; children: ReactNode }) {
  return (
    <span key={count} className={count > 0 ? effect : "inline-flex"}>
      {children}
    </span>
  );
}
