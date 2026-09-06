import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignerReports } from "../src/App";
import type { PublicSignerReport } from "../src/lib/signer-capability";

const report: PublicSignerReport = {
  projectId: "eliza",
  cycleId: "2026-09",
  instrumentId:
    "squads-v4-vault:solana:11111111111111111111111111111111:0:Vote111111111111111111111111111111111111111",
  role: "funder",
  capability: "can-sign",
  reportedAt: "2026-09-05T20:00:00.000Z",
  expiresAt: "2026-09-06T20:00:00.000Z",
  reason: "Synthetic signer evidence.",
  sourceRepository: "example/evidence",
  sourceCommit: "a".repeat(40),
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("visible signer history", () => {
  it("updates an open page when positive capability expires", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T19:59:59.000Z"));
    render(
      <SignerReports
        reports={[
          report,
          { ...report, role: "steward", sourceCommit: "b".repeat(40) },
        ]}
      />,
    );
    expect(
      screen.getByRole("heading", {
        name: /Both signers reported capability/u,
      }),
    ).toBeVisible();
    act(() => vi.advanceTimersByTime(1000));
    expect(
      screen.getByRole("heading", { name: /Current capability unknown/u }),
    ).toBeVisible();
    expect(screen.getAllByText(/capability report expired/u)).toHaveLength(2);
    expect(screen.getByText(/Payments remain disabled/u)).toBeVisible();
  });
  it("shows loss reason and exact source without borrowing another cycle's proof", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-06T00:00:00.000Z"));
    render(
      <SignerReports
        reports={[
          {
            ...report,
            capability: "lost-access",
            expiresAt: null,
            reason: "The reviewed signer lost the key.",
          },
          {
            ...report,
            cycleId: "2026-10",
            role: "steward",
            sourceCommit: "b".repeat(40),
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "2026-09 · Inaccessible" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "2026-10 · Current capability unknown",
      }),
    ).toBeVisible();
    expect(screen.getByText(/The reviewed signer lost the key/u)).toBeVisible();
    expect(
      screen.getAllByRole("link", { name: "Signed report" })[0],
    ).toHaveAttribute(
      "href",
      `https://github.com/example/evidence/commit/${"a".repeat(40)}`,
    );
  });
});
