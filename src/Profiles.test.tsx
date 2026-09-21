import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cycleIndexFixture } from "../tests/fixtures";
import type { ProfileIndex } from "./lib/profiles";
import { TARGET_REPOSITORIES } from "./lib/repositories.mjs";
import { ProfileActivity } from "./Profiles";

afterEach(cleanup);
const index: ProfileIndex = {
  schemaVersion: "1",
  startedAt: "2026-09-21T00:00:00Z",
  generatedAt: "2026-09-21T01:00:00Z",
  repositories: TARGET_REPOSITORIES.map((r) => ({
    repository: r.id,
    count: 0,
    excluded: 0,
  })),
  people: [],
};
describe("individual profile", () => {
  it("gives verified members a zero-PR profile and an image fallback without inventing money", () => {
    render(
      <ProfileActivity
        login="new-member"
        actorId="U_newmember"
        showIdentity
        cycles={{ ...cycleIndexFixture(), cycles: [] }}
        census={{ state: { status: "ready", index }, retry: vi.fn() }}
      />,
    );
    expect(screen.getByRole("heading", { name: "new-member" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "GitHub · @new-member" }),
    ).toHaveAttribute("href", "https://github.com/new-member");
    expect(screen.getAllByText("0")).toHaveLength(3);
    expect(screen.getAllByText("$0.00")).toHaveLength(2);
    const img = document.querySelector("img")!;
    fireEvent.error(img);
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText("NE")).toBeInTheDocument();
  });
  it("does not fabricate zero counts or receipts when evidence is unavailable", () => {
    render(
      <ProfileActivity
        login="unknown-person"
        showIdentity
        census={{ state: { status: "error" }, retry: vi.fn() }}
      />,
    );
    expect(screen.getByText(/PR counts are unavailable/)).toBeVisible();
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.queryByText("$0.00")).toBeNull();
  });
});
