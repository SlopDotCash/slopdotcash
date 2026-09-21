import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { snapshotFixture } from "../tests/fixtures";
import {
  appendPointAwards,
  awardForScore,
  emptyPointsJournal,
  type PointsIndex,
} from "./lib/points";
import { sha256Hex } from "./lib/sha256";
import { PointsPage, PointsProvider, ProfilePoints } from "./Points";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function fixture(corrupt = false) {
  const now = new Date().toISOString();
  const original = snapshotFixture().ledger[0];
  const a = awardForScore({ ...original, occurredAt: now });
  a.amount = 30;
  const b = awardForScore({
    ...original,
    actor: { ...original.actor, id: "U_second", login: "second-user" },
    source: { ...original.source, id: "PR_second" },
    occurredAt: now,
  });
  b.amount = 30;
  const j = appendPointAwards(
    emptyPointsJournal(now),
    [a, b],
    "a".repeat(64),
    "slop-score-v2",
    now,
  );
  const parts = Array.from(
    { length: 16 },
    (_, i) =>
      JSON.stringify(
        j.revisions
          .map((revision, sequence) => ({ revision, sequence }))
          .filter((r) => r.revision.award.key.startsWith(i.toString(16))),
      ) + "\n",
  );
  const index: PointsIndex = {
    schemaVersion: "1",
    ruleVersion: j.ruleVersion,
    generatedAt: j.generatedAt,
    coverage: [],
    revisionCount: j.revisions.length,
    shards: parts.map((p, i) => ({
      path: `/data/points/${i.toString(16)}.json`,
      sha256: sha256Hex(p),
      count: JSON.parse(p).length,
    })),
  };
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = String(input);
    if (url === "/data/points.json") return Response.json(index);
    const i = index.shards.findIndex((s) => s.path === url);
    if (i >= 0)
      return new Response(corrupt ? "[]\n" : parts[i], {
        headers: { "content-type": "application/json" },
      });
    return Response.json(null);
  });
  return j;
}
describe("points product", () => {
  it("shows tied contribution ranks, preserves rank through search, and explains current meaning", async () => {
    fixture();
    render(
      <PointsProvider>
        <PointsPage />
      </PointsProvider>,
    );
    const row = await screen.findByRole("row", {
      name: /1 second-user 30 pts/,
    });
    expect(row).toBeVisible();
    expect(
      screen.getByRole("row", { name: /1 finish-line 30 pts/ }),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("Find a contributor"), {
      target: { value: "second" },
    });
    expect(screen.queryByRole("row", { name: /finish-line/ })).toBeNull();
    expect(
      screen.getByRole("row", { name: /1 second-user 30 pts/ }),
    ).toBeVisible();
    expect(screen.getByText(/Points have no monetary value/)).toBeVisible();
    fireEvent.change(screen.getByLabelText("Period"), {
      target: { value: "lifetime" },
    });
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      2,
    );
  });
  it("rejects mismatched history bytes without showing fabricated balances", async () => {
    fixture(true);
    render(
      <PointsProvider>
        <PointsPage />
      </PointsProvider>,
    );
    await screen.findByText(/Points are unavailable/);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "Retry points" })).toBeEnabled();
  });
  it("shows a historical contributor independently of payment records", async () => {
    fixture();
    render(
      <PointsProvider>
        <ProfilePoints login="finish-line" />
      </PointsProvider>,
    );
    await waitFor(() =>
      expect(
        screen.getByText("30", { selector: ".points-total" }),
      ).toBeVisible(),
    );
    expect(screen.getByText("First accepted contribution")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Copy profile link" }),
    ).toBeEnabled();
  });
});
