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

describe("Slop fundraising deck", () => {
  it("walks the complete 10-slide story with controls and keyboard navigation", () => {
    render(<Deck />);

    expect(
      screen.getByRole("heading", {
        name: "MAKE MONEY SHIPPING SLOP.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Slop.cash", { selector: "strong" })).toBeVisible();
    expect(screen.getByText("1 / 10")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(
      screen.getByRole("heading", {
        name: "We built a movement in open source.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Shaw")).toBeInTheDocument();
    expect(screen.getByText("Nubs")).toBeInTheDocument();
    expect(screen.getByText("CEO")).toBeInTheDocument();
    expect(screen.getByText("CTO")).toBeInTheDocument();
    expect(screen.getByAltText("Shaw GitHub contributions")).toBeVisible();
    expect(screen.getByAltText("Nubs GitHub contributions")).toBeVisible();
    expect(window.location.hash).toBe("#2");

    fireEvent.keyDown(window, { key: "End" });
    expect(
      screen.getByRole("heading", {
        name: "When we build it, we own it.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next slide" })).toBeDisabled();

    fireEvent.keyDown(window, { key: "Home" });
    expect(screen.getByText("1 / 10")).toBeInTheDocument();
  });

  it("publishes the raise, revenue, token, ownership, and go-to-market model", () => {
    const { rerender } = render(<Deck />);

    window.history.replaceState({}, "", "/deck#3");
    rerender(<Deck key="mission" />);
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Eliza")).toBeInTheDocument();
    expect(screen.getByText("Proximity Prize")).toBeInTheDocument();
    expect(screen.getByText("“ASI” continual learning")).toBeInTheDocument();

    window.history.replaceState({}, "", "/deck#5");
    rerender(<Deck key="gtm" />);
    expect(screen.getByText("Hack traction.")).toBeInTheDocument();
    expect(screen.getByText("Align the supporters.")).toBeInTheDocument();
    expect(screen.getByText("Make support one click.")).toBeInTheDocument();
    expect(screen.getByText(/Extropic’s THRML \+ torx/)).toBeInTheDocument();
    expect(screen.getByText(/sponsors like Sapiom/)).toBeInTheDocument();
    expect(screen.queryByText("01")).not.toBeInTheDocument();

    window.history.replaceState({}, "", "/deck#6");
    rerender(<Deck key="ownership" />);
    expect(screen.getByText("Funded by a project")).toBeInTheDocument();
    expect(screen.getByText("Owned together")).toBeInTheDocument();
    expect(screen.getByText("Won together")).toBeInTheDocument();

    window.history.replaceState({}, "", "/deck#7");
    rerender(<Deck key="competition" />);
    expect(screen.getByText("Yukon")).toBeInTheDocument();
    expect(screen.getByText("OpenSolve")).toBeInTheDocument();

    window.history.replaceState({}, "", "/deck#8");
    rerender(<Deck key="economics" />);
    expect(
      screen.getByText(/3% of payouts plus sponsorships/),
    ).toBeInTheDocument();
    expect(screen.getByText("$2M")).toBeInTheDocument();
    expect(screen.getByText("$1.0M")).toBeInTheDocument();
    expect(screen.getAllByText("+$500K")).toHaveLength(2);

    window.history.replaceState({}, "", "/deck#9");
    rerender(<Deck key="raise" />);
    expect(screen.getByText("$250K")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("$100K")).toBeInTheDocument();
    expect(screen.getByText("Bounties + incentives")).toBeInTheDocument();
    expect(screen.getByText("$75K")).toBeInTheDocument();
    expect(screen.getByText("$50K")).toBeInTheDocument();
    expect(screen.getByText("$25K")).toBeInTheDocument();
    expect(screen.getByText("Legal")).toBeInTheDocument();
  });
});
