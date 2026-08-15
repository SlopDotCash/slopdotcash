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
      screen.getByRole("heading", { name: /^MAKE MONEY/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Slop.cash", { selector: "strong" })).toBeVisible();
    expect(screen.getByText("1 / 10")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(
      screen.getByRole("heading", {
        name: "We know how to make open source move.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("Shaw")).toBeInTheDocument();
    expect(window.location.hash).toBe("#2");

    fireEvent.keyDown(window, { key: "End" });
    expect(
      screen.getByRole("heading", { name: "We own the results together." }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next slide" })).toBeDisabled();

    fireEvent.keyDown(window, { key: "Home" });
    expect(screen.getByText("1 / 10")).toBeInTheDocument();
  });

  it("publishes the raise, revenue, token, ownership, and go-to-market model", () => {
    const { rerender } = render(<Deck />);

    window.history.replaceState({}, "", "/deck#5");
    rerender(<Deck key="gtm" />);
    expect(screen.getByText("Start with trust.")).toBeInTheDocument();
    expect(
      screen.getByText("Turn compute into sponsorship."),
    ).toBeInTheDocument();
    expect(screen.getByText("Make useful work the ad.")).toBeInTheDocument();

    window.history.replaceState({}, "", "/deck#6");
    rerender(<Deck key="ownership" />);
    expect(screen.getByText("Project-owned")).toBeInTheDocument();
    expect(screen.getByText("Collectively owned")).toBeInTheDocument();
    expect(screen.getByText("DAO-owned")).toBeInTheDocument();

    window.history.replaceState({}, "", "/deck#8");
    rerender(<Deck key="economics" />);
    expect(screen.getByText("Planned 1% payout fee")).toBeInTheDocument();
    expect(screen.getAllByText("⅓", { selector: "strong" })).toHaveLength(3);
    expect(screen.getByText("$SLOP buybacks")).toBeInTheDocument();
    expect(screen.getAllByText("$5M", { selector: "strong" })).toHaveLength(2);

    window.history.replaceState({}, "", "/deck#9");
    rerender(<Deck key="raise" />);
    expect(screen.getByText("$500K")).toBeInTheDocument();
    expect(screen.getByText("75%")).toBeInTheDocument();
    expect(screen.getByText("Bounties + incentives")).toBeInTheDocument();
    expect(screen.getAllByText("10%", { selector: "span" })).toHaveLength(2);
  });
});
