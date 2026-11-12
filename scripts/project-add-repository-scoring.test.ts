/// <reference types="bun-types" />
import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { recordCounts } from "../src/lib/global-leaderboard";
import {
  createLeaderboardSnapshot,
  type LeaderboardSnapshot,
} from "../src/lib/leaderboard";
import {
  createProjectView,
  projectActivityCollected,
} from "../src/lib/project-view";
import { findProject } from "../src/lib/projects.mjs";
import { collectTargetRepositories } from "../src/lib/repositories.mjs";
import {
  AFTER_NOVEMBER,
  penaltyScoreInput,
} from "../tests/penalty-score-fixture";
import { addActivatedRepositories } from "./prepare-pr-ledger";

afterEach(() => setSystemTime());

// A repository the fixture registry already resolves, so penalty and event
// lookups work; the test project lists it as an appended entry.
const EXTRA = "elizaOS/eliza";
const COUNTS_FROM = "2026-12-01T00:00:00.000Z";

function projectWithExtra() {
  const asi = findProject("asi");
  if (!asi) throw new Error("fixture project missing");
  const extra = {
    id: EXTRA,
    githubUrl: `https://github.com/${EXTRA}`,
    githubId: "9000001",
    nodeId: "R_extra_node",
    countsFrom: COUNTS_FROM,
  };
  return {
    ...asi,
    repositories: [...asi.repositories, extra],
  } as unknown as NonNullable<ReturnType<typeof findProject>>;
}

function snapshot(collectExtra: boolean): LeaderboardSnapshot {
  setSystemTime(new Date(AFTER_NOVEMBER));
  const base = createLeaderboardSnapshot(penaltyScoreInput([]));
  const source = base.ledger.filter(
    (event) => event.repository === "elizaOS/asi",
  );
  const extras = source.flatMap((event) => [
    {
      ...event,
      id: `${event.id}:nov`,
      repository: EXTRA,
      occurredAt: "2026-11-10T00:00:00.000Z",
    },
    {
      ...event,
      id: `${event.id}:dec`,
      repository: EXTRA,
      occurredAt: "2026-12-01T12:00:00.000Z",
    },
  ]);
  return {
    ...base,
    // Move the window end into December so the later cycle has opened.
    window: { ...base.window, to: "2026-12-05T00:00:00.000Z" },
    ledger: [...base.ledger, ...extras],
    repositories: base.repositories.filter(
      (repository) => collectExtra || repository.id !== EXTRA,
    ),
  } as LeaderboardSnapshot;
}

describe("appended repository scoring start", () => {
  test("a November view excludes the appended repository and needs no collection of it", () => {
    const project = projectWithExtra();
    const view = createProjectView(
      snapshot(false),
      "asi",
      "2026-11",
      undefined,
      project,
    );
    expect(view.ledger.some((event) => event.repository === EXTRA)).toBe(false);
    expect(view.ledger.length).toBeGreaterThan(0);
  });

  test("a December view counts the appended repository and requires its collection", () => {
    const project = projectWithExtra();
    expect(() =>
      createProjectView(snapshot(false), "asi", "2026-12", undefined, project),
    ).toThrow("Snapshot has not collected activity for asi");
    const view = createProjectView(
      snapshot(true),
      "asi",
      "2026-12",
      undefined,
      project,
    );
    const extra = view.ledger.filter((event) => event.repository === EXTRA);
    expect(extra.length).toBeGreaterThan(0);
    expect(extra.every((event) => event.occurredAt >= COUNTS_FROM)).toBe(true);
  });

  test("the collected check ignores uncollected repositories that are not yet counted", () => {
    const project = projectWithExtra();
    expect(projectActivityCollected(snapshot(false), project, "2026-11")).toBe(
      true,
    );
    expect(projectActivityCollected(snapshot(false), project, "2026-12")).toBe(
      false,
    );
    expect(projectActivityCollected(snapshot(true), project, "2026-12")).toBe(
      true,
    );
  });

  test("global standings drop appended-repository records before countsFrom", () => {
    const project = projectWithExtra();
    expect(
      recordCounts(project, {
        repository: EXTRA,
        occurredAt: "2026-11-10T00:00:00.000Z",
      }),
    ).toBe(false);
    expect(
      recordCounts(project, { repository: EXTRA, occurredAt: COUNTS_FROM }),
    ).toBe(true);
    expect(
      recordCounts(project, {
        repository: "elizaOS/asi",
        occurredAt: "2026-11-10T00:00:00.000Z",
      }),
    ).toBe(true);
  });

  test("collection uses the appended entry's own node id, never the authority's", () => {
    const project = projectWithExtra();
    const rows = collectTargetRepositories([
      {
        ...project,
        repositories: [
          project.repositories[0],
          {
            ...project.repositories[1],
            githubUrl: "https://github.com/SlopDotCash/renamed-extra",
          },
        ],
      },
    ]);
    expect(rows[1].expectedNodeId).toBe("R_extra_node");
    expect(rows[1].expectedNodeId).not.toBe(project.authority.repositoryNodeId);
  });

  test("an activated appended repository resolves its node id from the entry", () => {
    const project = projectWithExtra();
    const targets = collectTargetRepositories([project]);
    const primary = targets[0];
    const candidate = {
      repository: primary.id,
      repositories: [{ id: primary.id }],
      source: {
        repositoryId: "R_p",
        repositories: [{ id: primary.id, repositoryId: "R_p" }],
      },
    };
    const out = addActivatedRepositories(
      candidate,
      targets as never,
      () => project,
    ) as {
      source: { repositories: { id: string; repositoryId: string }[] };
    };
    expect(
      out.source.repositories.find((r) => r.id === EXTRA)?.repositoryId,
    ).toBe("R_extra_node");
  });
});
