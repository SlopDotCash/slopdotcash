/// <reference types="bun-types" />
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CycleIndex, CycleIndexEntry } from "../src/lib/cycle-index";
import { createGlobalLeaders } from "../src/lib/global-leaderboard";
import type { LeaderboardSnapshot, ScoreEvent } from "../src/lib/leaderboard";
import { createProjectView } from "../src/lib/project-view";
import { findProject } from "../src/lib/projects.mjs";
import { fixtureCheckout } from "../tests/fixture-checkout";

// A project cycle starts at the later of the UTC month start and the
// project's reward.rewardStartAt (createProjectView and the contribution
// window of a closed cycle record). Eliza opened its reward on 2026-07-07, so
// its frozen July source snapshot also holds accepted events from before the
// reward start. The cumulative Slop Score and the project standings must count
// the same window as the cycle leaderboard, and closing the cycle must not
// change the score of the month.
const root = resolve(import.meta.dir, "..");
const snapshot = JSON.parse(
  readFileSync(
    resolve(
      root,
      "tests/fixtures/history/cycles/eliza/2026-07/source-snapshot.json",
    ),
    "utf8",
  ),
) as LeaderboardSnapshot;
const registered = findProject("eliza");
if (!registered) throw new Error("eliza project is not registered");
const eliza = registered;
const rewardStartAt = eliza.reward.rewardStartAt;

let checkout = "";
afterAll(() => {
  if (checkout) rmSync(checkout, { recursive: true, force: true });
});

let index: CycleIndex;
let julyCycle: CycleIndexEntry;
beforeAll(async () => {
  // The cycle index reads fixed repository paths, so it is built inside a
  // checkout that restores the frozen pre-registry history.
  checkout = fixtureCheckout("global-leaderboard-");
  const built = spawnSync(process.execPath, ["scripts/sync-cycle-index.ts"], {
    cwd: checkout,
    encoding: "utf8",
  });
  if (built.status !== 0) throw new Error(built.stderr);
  index = JSON.parse(
    readFileSync(join(checkout, "public/data/cycles/index.json"), "utf8"),
  ) as CycleIndex;
  const entry = index.cycles.find(
    (cycle) => cycle.projectId === "eliza" && cycle.cycleId === "2026-07",
  );
  if (!entry) throw new Error("closed eliza 2026-07 cycle is missing");
  julyCycle = entry;
});

// The project page's standings (src/lib/contributor-standings.ts) pass this
// projection the ledger of the project's repositories in the selected UTC
// month and the closed cycles of that project and month.
function standings(cycles: CycleIndexEntry[]) {
  const repositories = new Set(
    eliza.repositories.map((repository) => repository.id),
  );
  const leaders = createGlobalLeaders(
    {
      ...snapshot,
      ledger: snapshot.ledger.filter(
        (event) =>
          repositories.has(event.repository) &&
          event.occurredAt.startsWith("2026-07"),
      ),
    },
    [],
    { ...index, cycles },
  );
  return new Map(
    leaders
      .filter((leader) => leader.score !== 0)
      .map((leader) => [leader.actor.id, leader.score]),
  );
}

describe("Slop Score before a project's reward start", () => {
  it("project standings for a month equal the cycle leaderboard", () => {
    const view = createProjectView(snapshot, "eliza", "2026-07");
    const cycleScores = new Map(
      view.leaders
        .filter((leader) => leader.scoreThirds !== 0)
        .map((leader) => [leader.actor.id, leader.scoreThirds / 3]),
    );
    expect(cycleScores.size).toBeGreaterThan(0);
    expect(Object.fromEntries(standings([]))).toEqual(
      Object.fromEntries(cycleScores),
    );
  });

  it("closing the cycle does not change the month's Slop Score", () => {
    expect(Object.fromEntries(standings([julyCycle]))).toEqual(
      Object.fromEntries(standings([])),
    );
  });

  it("counts an event at the reward start and not one before it", () => {
    const template = snapshot.ledger.find(
      (event) => event.repository === eliza.repositories[0].id,
    ) as ScoreEvent;
    const at = (id: string, occurredAt: string): ScoreEvent => ({
      ...template,
      id,
      occurredAt,
      points: 1,
      scoreThirds: 3,
    });
    const leaders = createGlobalLeaders(
      {
        ...snapshot,
        ledger: [
          at("before-start", "2026-07-06T23:59:59.999Z"),
          at("at-start", rewardStartAt),
        ],
      },
      [],
      { ...index, cycles: [] },
    );
    expect(leaders).toHaveLength(1);
    expect(leaders[0].score).toBe(1);
    expect(leaders[0].cycles).toBe(1);
  });
});
