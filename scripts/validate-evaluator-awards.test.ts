/// <reference types="bun-types" />
import {
  afterAll,
  afterEach,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadEvaluatorAwardEvents } from "../src/lib/evaluator-awards";
import {
  assertLeaderboardSnapshot,
  createLeaderboardSnapshot,
} from "../src/lib/leaderboard";
import { penaltyScoreInput } from "../tests/penalty-score-fixture";

const fixture = JSON.parse(
  readFileSync(
    resolve(
      import.meta.dir,
      "../tests/fixtures/history/evaluations/eliza/award-neutize-pr-25803.json",
    ),
    "utf8",
  ),
);
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});
afterEach(() => setSystemTime());

/** Loads the awards through the production loader, as `evaluations:check` does. */
function load(awards: Record<string, unknown>, project = "eliza") {
  const root = mkdtempSync(join(tmpdir(), "evaluator-awards-"));
  roots.push(root);
  mkdirSync(join(root, "evaluations", project), { recursive: true });
  for (const [name, award] of Object.entries(awards)) {
    writeFileSync(
      join(root, "evaluations", project, name),
      JSON.stringify(award),
    );
  }
  const previous = process.cwd();
  process.chdir(root);
  try {
    return loadEvaluatorAwardEvents();
  } finally {
    process.chdir(previous);
  }
}

describe("evaluator award source uniqueness", () => {
  test("awards for two different pull requests both load", () => {
    const events = load({
      "award-a.json": fixture,
      "award-b.json": {
        ...fixture,
        id: "award_neutize_pr_25804",
        source: {
          ...fixture.source,
          id: "PR_kwDOMT5cIs8AAAABAsy-6A",
          number: 25804,
          url: "https://github.com/elizaOS/eliza/pull/25804",
        },
      },
    });
    expect(events.map((event) => event.source.number)).toEqual([25803, 25804]);
  });

  test("one pull request under its legacy node ID and another URL spelling is a duplicate", () => {
    // MDExOlB1bGxSZXF1ZXN0NDM0MTkzOTk0Mw== is base64 of
    // "011:PullRequest4341939943", the legacy ID of PR_kwDOMT5cIs8AAAABAsy-5w.
    expect(() =>
      load({
        "award-a.json": fixture,
        "award-b.json": {
          ...fixture,
          id: "award_neutize_pr_25803_again",
          source: {
            ...fixture.source,
            id: "MDExOlB1bGxSZXF1ZXN0NDM0MTkzOTk0Mw==",
            url: "https://github.com/elizaos/eliza/pull/25803",
          },
        },
      }),
    ).toThrow("evaluator award ids and sources must be unique");
  });

  test("a loaded alias award cannot also earn ordinary merge credit", () => {
    const input = penaltyScoreInput([]);
    setSystemTime(new Date(input.generatedAt));
    const pull = input.mergedPullRequests.find(
      (row) => row.id === "PR_november",
    );
    if (!pull) throw new Error("Missing accepted merge fixture");
    const events = load(
      {
        "award-alias.json": {
          ...fixture,
          id: "award_alias_duplicate",
          projectId: "asi",
          repository: "elizaOS/asi",
          actor: pull.author,
          occurredAt: pull.mergedAt,
          source: {
            id: "legacy_node_id_for_existing_pull",
            kind: "pull-request",
            number: pull.number,
            title: pull.title,
            url: pull.url.toLowerCase(),
          },
          review: { ...fixture.review, reviewedAt: input.generatedAt },
        },
      },
      "asi",
    );
    expect(events).toHaveLength(1);
    expect(() =>
      createLeaderboardSnapshot({ ...input, evaluatedContributions: events }),
    ).toThrow("duplicates a score-bearing source");
    const published = createLeaderboardSnapshot(input);
    published.ledger.push(events[0]);
    expect(() => assertLeaderboardSnapshot(published)).toThrow(
      "duplicates another score source",
    );
  });

  for (const kind of ["comment", "review"] as const) {
    test(`distinct ${kind} fragments remain distinct award sources`, () => {
      const path = kind === "comment" ? "issues" : "pull";
      const fragment =
        kind === "comment" ? "issuecomment-" : "pullrequestreview-";
      const first = {
        ...fixture,
        source: {
          ...fixture.source,
          id: "source_one",
          kind,
          url: `https://github.com/elizaOS/eliza/${path}/25803#${fragment}1`,
        },
      };
      const second = {
        ...first,
        id: "award_second_source",
        actor: {
          ...fixture.actor,
          id: "MDQ6VXNlcjQy",
          login: "author",
          url: "https://github.com/author",
        },
        source: {
          ...first.source,
          id: "source_two",
          url: `https://github.com/ELIZAOS/ELIZA/${path}/25803#${fragment}2`,
        },
      };
      expect(
        load({ "award-a.json": first, "award-b.json": second }),
      ).toHaveLength(2);
    });
  }

  test("an unregistered GitHub URL cannot enter the award loader", () => {
    expect(() =>
      load({
        "award-a.json": {
          ...fixture,
          source: {
            ...fixture.source,
            url: "https://github.com/unknown/project/pull/25803",
          },
        },
      }),
    ).toThrow("expected canonical GitHub URL");
  });
});
