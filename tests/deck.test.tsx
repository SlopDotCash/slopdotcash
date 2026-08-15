/**
 * Exercises the presentation as a keyboard- and button-operable deck while
 * keeping the fundraising claims deliberately qualitative.
 */

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Deck } from "../src/Deck";

beforeEach(() => {
  window.history.replaceState({}, "", "/deck#1");
});

afterEach(() => {
  cleanup();
});

describe("Slop deck", () => {
  it("walks the complete story with controls and keyboard navigation", () => {
    render(<Deck />);

    expect(
      screen.getByRole("heading", { name: "Grow open source." }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 / 8")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(
      screen.getByRole("heading", {
        name: "The incentive network for useful open-source work.",
      }),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe("#2");

    fireEvent.keyDown(window, { key: "End" });
    expect(
      screen.getByRole("heading", { name: "Fund the flywheel." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next slide" })).toBeDisabled();

    fireEvent.keyDown(window, { key: "Home" });
    expect(screen.getByText("1 / 8")).toBeInTheDocument();
  });

  it("states the allocation without inventing a percentage", () => {
    window.history.replaceState({}, "", "/deck#5");
    render(<Deck />);

    expect(screen.getByText("Most")).toBeInTheDocument();
    expect(screen.getByText("Small share")).toBeInTheDocument();
    expect(screen.queryByText(/%/u)).not.toBeInTheDocument();
  });
});
