import { afterEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createGlobalLeaders,
  openMonthScores,
} from "../src/lib/global-leaderboard";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
} from "../src/lib/leaderboard";
import { summarizeModelOutcomes } from "../src/lib/model-outcomes";
import { createProjectView } from "../src/lib/project-view";
import { PROJECTS } from "../src/lib/projects.mjs";
import { sha256Hex } from "../src/lib/sha256";
import {
  assertPublishedStandings,
  createPublishedStandings,
  standingProjectIds,
} from "../src/lib/standings";
import { cycleIndexFixture, snapshotFixture } from "../tests/fixtures";
import {
  CLOSED_PULL_REQUEST_ID,
  GENERATED_AT,
  PENALIZED_AUTHOR,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import { generateStandings } from "./generate-standings";

afterEach(() => setSystemTime());

/** A real snapshot with an applied Slopbot penalty, from the snapshot builder. */
function penalizedSnapshot() {
  // The fixture is dated in the future, so the builder's clock follows it.
  setSystemTime(new Date(GENERATED_AT));
  const snapshot = createLeaderboardSnapshot(
    penaltyScoreInput([
      {
        itemNodeId: CLOSED_PULL_REQUEST_ID,
        authorGithubId: "42",
        category: "spam",
        tableVersion: "slopbot-penalties-v1",
        debitThirds: 3,
        period: "2026-11",
        recordedAt: "2026-11-10T00:00:00.000Z",
      },
    ]),
  );
  assertLeaderboardSnapshot(snapshot);
  if (!snapshot.penalties?.length)
    throw new Error("The penalty fixture produced no published penalty");
  return snapshot;
}

test("the published standings carry exactly what the pages derived from the full snapshot", () => {
  const snapshot = penalizedSnapshot();
  const cycles = cycleIndexFixture();
  const digest = sha256Hex(JSON.stringify(snapshot));
  const standings = createPublishedStandings(snapshot, cycles, digest);
  assertPublishedStandings(JSON.parse(JSON.stringify(standings)));
  expect(standings.generatedAt).toBe(snapshot.generatedAt);
  expect(standings.snapshotDigest).toBe(digest);

  // The browser used to build these views and leaders itself.
  const views = standingProjectIds(snapshot).map((projectId) =>
    createProjectView(snapshot, projectId),
  );
  expect(views.length).toBeGreaterThan(0);
  expect(standings.projects).toEqual(
    views.map((view) => ({
      projectId: view.project.id,
      cycleId: view.cycle.id,
      leaders: view.leaders.map((leader) => ({
        actorId: leader.actor.id,
        score: leader.score,
        scoreThirds: leader.scoreThirds,
        adjustedWeight: leader.adjustedWeight,
      })),
    })),
  );
  expect(standings.leaders).toEqual(
    snapshot.leaders.map(({ actor }) => ({ actor })),
  );
  expect(standings.globalLeaderIds).toEqual(
    createGlobalLeaders(snapshot, views, cycles).map(
      (leader) => leader.actor.id,
    ),
  );
  const { deductions } = openMonthScores(snapshot, cycles);
  expect(standings.penalties).toEqual(
    (snapshot.penalties ?? []).map((penalty) => ({
      ...penalty,
      appliedThirds: deductions.byPenalty.get(penalty.id) ?? 0,
    })),
  );
  const applied = standings.penalties.find(
    (penalty) => penalty.actor.id === PENALIZED_AUTHOR.id,
  );
  expect(applied?.appliedThirds).toBeGreaterThan(0);

  // Every identity the profile page consulted is still present, once per
  // (id, login) pair and in the snapshot's own order.
  const expected = [
    ...(snapshot.reviewExclusions ?? []).flatMap((exclusion) =>
      exclusion.reviewer?.kind === "User" ? [exclusion.reviewer] : [],
    ),
    ...views.flatMap((view) => [
      ...view.leaders.map((leader) => leader.actor),
      ...view.opportunities.map((opportunity) => opportunity.actor),
    ]),
  ];
  const pairs = new Set<string>();
  const unique = expected.filter((actor) => {
    const key = `${actor.id}\0${actor.login}`;
    if (pairs.has(key)) return false;
    pairs.add(key);
    return true;
  });
  expect(standings.actors).toEqual(
    unique.map(({ id, login, avatarUrl }) => ({ id, login, avatarUrl })),
  );
  expect(standings.actors.length).toBe(pairs.size);

  // The sponsors page used to derive these totals from the full snapshot.
  const outcomes = summarizeModelOutcomes(snapshot).totals;
  expect(snapshot.ledger.length).toBeGreaterThan(0);
  expect(standings.audience).toEqual({
    windowDays: snapshot.window.days,
    contributors: snapshot.leaders.length,
    scoredEvents: snapshot.ledger.length,
    mergedPullRequests: outcomes.mergedPullRequests,
    mergedPullRequestsWithModel: outcomes.mergedPullRequestsWithModel,
  });
});

test("the published standings list the same suggested work the project page derived from the full snapshot", () => {
  const snapshot = snapshotFixture();
  const blocked = structuredClone(snapshot.workQueue.issues[0]);
  blocked.id = "I_blocked";
  blocked.number = 17328;
  blocked.selection = { status: "excluded", reasons: ["blocked"] };
  snapshot.workQueue.issues.push(blocked);
  const standings = createPublishedStandings(
    snapshot,
    cycleIndexFixture(),
    sha256Hex(JSON.stringify(snapshot)),
  );
  assertPublishedStandings(JSON.parse(JSON.stringify(standings)));
  const projects = PROJECTS.filter((project) => project.status === "active");
  expect(projects.length).toBeGreaterThan(0);
  for (const project of projects) {
    const repositories = new Set(project.repositories.map(({ id }) => id));
    const derived = [
      snapshot.workQueue.issues,
      snapshot.workQueue.pullRequests,
    ].flatMap((queue) =>
      queue.filter(
        (item) =>
          repositories.has(item.repository) &&
          item.selection.status === "candidate",
      ),
    );
    expect(
      standings.work.filter((item) => repositories.has(item.repository)),
    ).toEqual(
      derived.map(({ id, kind, number, title, url, repository }) => ({
        id,
        kind,
        number,
        title,
        url,
        repository,
      })),
    );
  }
  expect(standings.work.some((item) => item.id === blocked.id)).toBe(false);
  expect(standings.work.length).toBeGreaterThan(0);
});

test("the standings validator refuses records a page cannot trust", () => {
  const standings = createPublishedStandings(
    snapshotFixture(),
    cycleIndexFixture(),
    "a".repeat(64),
  );
  const valid = JSON.parse(JSON.stringify(standings));
  expect(() => assertPublishedStandings(valid)).not.toThrow();
  const cases: [string, (value: typeof valid) => void][] = [
    ["format", (v) => (v.format = "slop-standings-v0")],
    ["digest", (v) => (v.snapshotDigest = "nope")],
    ["timestamp", (v) => (v.generatedAt = "yesterday")],
    ["extra key", (v) => (v.extra = true)],
    ["duplicate project", (v) => v.projects.push(v.projects[0])],
    ["leader shape", (v) => (v.projects[0].leaders[0].score = "1")],
    [
      "duplicate project leader",
      (v) => v.projects[0].leaders.push(v.projects[0].leaders[0]),
    ],
    ["actor key", (v) => delete v.leaders[0].actor.url],
    [
      "duplicate global leader",
      (v) => v.globalLeaderIds.push(v.globalLeaderIds[0]),
    ],
    [
      "audience above merged",
      (v) =>
        (v.audience.mergedPullRequestsWithModel =
          v.audience.mergedPullRequests + 1),
    ],
    [
      "audience contributors off the leaders",
      (v) => (v.audience.contributors += 1),
    ],
    [
      "penalty applied above debit",
      (v) =>
        v.penalties.push({
          id: "p",
          actor: v.leaders[0].actor,
          repository: "elizaOS/eliza",
          occurredAt: "2026-07-01T00:00:00.000Z",
          category: "spam",
          tableVersion: "v1",
          debitThirds: 3,
          source: {
            id: "PR_1",
            kind: "pull-request",
            number: 1,
            title: "t",
            url: "https://github.com/elizaOS/eliza/pull/1",
          },
          appliedThirds: 4,
        }),
    ],
    ["work item key", (v) => (v.work[0].selection = { status: "candidate" })],
    ["duplicate work item", (v) => v.work.push(v.work[0])],
    ["work item kind", (v) => (v.work[0].kind = "discussion")],
  ];
  for (const [label, mutate] of cases) {
    const broken = JSON.parse(JSON.stringify(standings));
    mutate(broken);
    expect(() => assertPublishedStandings(broken), label).toThrow(
      "Invalid published standings",
    );
  }
});

test("the publication writes a small standings file bound to the snapshot digest", async () => {
  const root = mkdtempSync(join(tmpdir(), "slop-standings-"));
  try {
    const snapshot = penalizedSnapshot();
    const bytes = `${JSON.stringify(snapshot)}\n`;
    const paths = {
      leaderboard: join(root, "leaderboard.json"),
      cycles: join(root, "cycles.json"),
      output: join(root, "standings.json"),
    };
    writeFileSync(paths.leaderboard, bytes);
    writeFileSync(paths.cycles, JSON.stringify(cycleIndexFixture()));
    const result = await generateStandings(paths);
    const published: unknown = JSON.parse(readFileSync(paths.output, "utf8"));
    assertPublishedStandings(published);
    expect(published.snapshotDigest).toBe(sha256Hex(bytes));
    expect(result.bytes).toBeLessThan(result.snapshotBytes / 4);
    expect(result.penalties).toBe(snapshot.penalties?.length ?? 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
