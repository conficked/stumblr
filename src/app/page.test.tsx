import { render, screen } from "@testing-library/react";
import { test, expect } from "vitest";
import HomePage from "./page";

test("renders core exploration landmarks", () => {
  render(<HomePage />);
  expect(screen.getByRole("main", { name: /stumblr explorer/i })).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /^stumbl$/i }).length).toBeGreaterThan(0);
});
