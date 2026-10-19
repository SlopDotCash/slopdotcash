/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createGlobalLeaders } from "../src/lib/global-leaderboard";
import type { LeaderboardSnapshot, ScoreEvent } from "../src/lib/leaderboard";
import { dailySlopScore } from "../src/lib/profile-activity";
import { findProject } from "../src/lib/projects.mjs";

// The profile's activity chart says "<n> Slop Score in the last 35 days".
// Slop Score counts an accepted event only from its project's
// reward.rewardStartAt (createGlobalLeaders, createProjectView and the
// contribution window of a closed cycle). Eliza opened its reward on
// 2026-07-07, and its frozen July source snapshot also holds accepted events
// from 1–6 July, so it shows whether the chart counts the same events.
const root = resolve(import.meta.dir, "..");
const snapshot = JSON.parse(
  readFileSync(
    resolve(root, "tests/fixtures/history/cycles/eliza/2026-07/source-snapshot.json"),
    "utf8",
  ),
) as LeaderboardSnapshot;
const registered = findProject("eliza");
if (!registered) throw new Error("eliza project is not registered");
const eliza = registered;
const rewardStartAt = eliza.reward.rewardStartAt;
const today = new Date("2026-07-31T12:00:00.000Z");
const days = 35;

function chartTotal(work: readonly ScoreEvent[]) {
  return dailySlopScore(work, today, days).reduce(
    (total, entry) => total + entry.score,
    0,
  );
}

describe("profile activity chart before a project's reward start", () => {
  const inWindow = snapshot.ledger.filter(
    (event) =>
      event.occurredAt.slice(0, 10) >= "2026-06-27" &&
      event.occurredAt.slice(0, 10) <= "2026-07-31",
  );

  it("each contributor's chart total equals their Slop Score for the same events", () => {
    expect(
      inWindow.some(
        (event) => Date.parse(event.occurredAt) < Date.parse(rewardStartAt),
      ),
    ).toBe(true);
    const scores = new Map(
      createGlobalLeaders({ ...snapshot, ledger: inWindow }, [], {
        schemaVersion: "1",
        generatedAt: today.toISOString(),
        cycles: [],
      }).map((leader) => [leader.actor.id, leader.score]),
    );
    const actors = [...new Set(inWindow.map((event) => event.actor.id))];
    const mismatched = actors.filter((actor) => {
      const total = chartTotal(
        inWindow.filter((event) => event.actor.id === actor),
      );
      return Math.abs(total - (scores.get(actor) ?? 0)) > 1e-9;
    });
    expect(actors.length).toBeGreaterThan(0);
    expect(mismatched).toEqual([]);
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
    const chart = dailySlopScore(
      [
        at("before-start", "2026-07-06T23:59:59.999Z"),
        at("at-start", rewardStartAt),
      ],
      today,
      days,
    );
    expect(chart.find((entry) => entry.day === "2026-07-06")?.score).toBe(0);
    expect(chart.find((entry) => entry.day === "2026-07-07")?.score).toBe(1);
  });
});
