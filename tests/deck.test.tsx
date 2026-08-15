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
        name: "Two builders. 25K+ GitHub stars.",
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
    expect(screen.getByText("Hack traction.")).toBeInTheDocument();
    expect(screen.getByText("Align the supporters.")).toBeInTheDocument();
    expect(screen.getByText("Make support one click.")).toBeInTheDocument();

    window.history.replaceState({}, "", "/deck#6");
    rerender(<Deck key="ownership" />);
    expect(screen.getByText("Project-owned")).toBeInTheDocument();
    expect(screen.getByText("Collectively owned")).toBeInTheDocument();
    expect(screen.getByText("DAO-owned")).toBeInTheDocument();

    window.history.replaceState({}, "", "/deck#8");
    rerender(<Deck key="economics" />);
    expect(screen.getByText(/Base case: a 1% payout fee/)).toBeInTheDocument();
    expect(screen.getByText("$2M")).toBeInTheDocument();
    expect(screen.getByText("$1.6M")).toBeInTheDocument();
    expect(screen.getAllByText("+$750K")).toHaveLength(2);

    window.history.replaceState({}, "", "/deck#9");
    rerender(<Deck key="raise" />);
    expect(screen.getByText("$500K")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
    expect(screen.getByText("$200K")).toBeInTheDocument();
    expect(screen.getByText("Bounties + incentives")).toBeInTheDocument();
    expect(screen.getByText("$100K")).toBeInTheDocument();
    expect(screen.getByText("Legal")).toBeInTheDocument();
  });
});
