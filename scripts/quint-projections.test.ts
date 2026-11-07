/** Seeded Quint traces exercise the production projection and census admission paths. */
import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type {
  ModelAttribution,
  ScoreEvent,
} from "../src/lib/leaderboard-types";
import { summarizeModelOutcomes } from "../src/lib/model-outcomes";
import { POINTS_PER_THIRD } from "../src/lib/points";
import { assertProfiles, type ProfileIndex } from "../src/lib/profiles";

function traces<T>(model: string): T[][] {
  const directory = mkdtempSync(join(tmpdir(), "slop-projection-model-"));
  try {
    execFileSync(
      "node",
      [
        resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
        "run",
        `formal/models/${model}.qnt`,
        "--backend=typescript",
        "--seed=20261107",
        "--max-samples=100",
        "--max-steps=20",
        "--n-traces=100",
        `--out-itf=${join(directory, "trace-{seq}.json")}`,
      ],
      { stdio: "pipe", maxBuffer: 8 * 1024 * 1024 },
    );
    const paths = readdirSync(directory);
    expect(paths.length).toBe(100);
    return paths.map((file) => {
      const trace = JSON.parse(
        readFileSync(join(directory, file), "utf8"),
        (_key, value) => {
          if (value && typeof value === "object") {
            if ("#bigint" in value) return Number(value["#bigint"]);
            if ("#set" in value) return value["#set"];
          }
          return value;
        },
      ) as { states: T[] };
      return trace.states;
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const actor = (id: number) => ({
  id: `U_projection_${id}`,
  login: `projection-${id}`,
  kind: "User" as const,
  avatarUrl: `https://avatars.githubusercontent.com/u/${id}?v=4`,
  url: `https://github.com/projection-${id}`,
});

function attribution(id: number): ModelAttribution {
  const provider = id === 4 ? "OpenAI" : "openai";
  const model =
    id === 5
      ? "unavailable"
      : id === 2
        ? "model-two"
        : id === 4
          ? "openai/model-one"
          : "model-one";
  return {
    id: `attribution_${id}`,
    sourceId: id === 6 ? "review_2" : "pr_1",
    sourceUrl: "https://github.com/example/repo/pull/1",
    artifactId: "pr_1",
    actor: actor(id === 3 ? 2 : 1),
    provider,
    model,
    identifier: `${provider}/${model}`,
    client: null,
    skillRevision: null,
    run: null,
    format: "machine-marker",
    status: "self-reported",
  };
}
function event(id: number): ScoreEvent {
  const review = id === 3;
  return {
    id: `event_${id}`,
    actor: actor(id === 2 ? 2 : 1),
    category: review ? "substantive-review" : "merged-pull-request",
    points: 2,
    scoreThirds: 6,
    occurredAt: "2026-11-01T00:00:00.000Z",
    repository: "example/repo",
    reason: "Accepted fixture outcome",
    source: {
      id: review ? "review_2" : "pr_1",
      kind: review ? "review" : "pull-request",
      number: 1,
      title: "Fixture",
      url: "https://github.com/example/repo/pull/1",
    },
  };
}

test("Quint model declarations preserve exact actor/source joins, aliases and split Points", () => {
  let projected = 0;
  for (const states of traces<{
    declarations: number[];
    events: number[];
    projection: {
      ready: boolean;
      model1: number;
      model2: number;
      total: number;
    };
  }>("ui_model_outcomes")) {
    for (const state of states) {
      if (!state.projection.ready) continue;
      projected++;
      const input = {
        attributions: state.declarations.map(attribution),
        ledger: state.events.map(event),
      };
      const before = JSON.stringify(input);
      const result = summarizeModelOutcomes(input);
      for (const [name, expected] of [
        ["model-one", state.projection.model1],
        ["model-two", state.projection.model2],
      ] as const) {
        const row = result.models.find((entry) => entry.model === name);
        expect((row?.pullRequestPoints ?? 0) + (row?.reviewPoints ?? 0)).toBe(
          expected * POINTS_PER_THIRD,
        );
      }
      // Provenance analysis does not rewrite the accepted ledger or its score.
      expect(JSON.stringify(input)).toBe(before);
      expect(
        input.ledger.reduce((sum, row) => sum + (row.scoreThirds ?? 0), 0),
      ).toBe(state.projection.total);
    }
  }
  expect(projected).toBeGreaterThan(25);
});

test("Quint close/reopen, hidden-history and retirement traces agree with census admission", () => {
  let checked = 0;
  for (const states of traces<{
    current: "open" | "closed";
    replayed: "open" | "closed";
    incomplete: boolean;
    active: boolean;
  }>("ui_profile_history")) {
    for (const state of states) {
      const issue = {
        id: "I_projection",
        repository: "elizaOS/eliza",
        number: 1,
        authorId: null,
        createdAt: "2026-11-01T00:00:00.000Z",
        observedAt: "2026-11-02T00:00:00.000Z",
        state:
          state.current === "open" ? ("OPEN" as const) : ("CLOSED" as const),
        reason: null,
        unavailableSince: null,
        correctedAt: null,
        historyIncompleteSince: state.incomplete
          ? "2026-11-02T00:00:00.000Z"
          : null,
        events:
          state.replayed === "open"
            ? []
            : [
                {
                  id: "close_projection",
                  kind: "closed" as const,
                  occurredAt: "2026-11-02T00:00:00.000Z",
                  reason: null,
                  relatedIssueId: null,
                },
              ],
      };
      const targets = state.active ? ["elizaOS/eliza"] : [];
      const census: ProfileIndex = {
        schemaVersion: "2",
        startedAt: "2026-11-01T00:00:00.000Z",
        generatedAt: "2026-11-02T00:00:00.000Z",
        repositories: [{ repository: "elizaOS/eliza", count: 0, excluded: 0 }],
        people: [],
        issues: {
          firstObservedAt: "2026-11-01T00:00:00.000Z",
          repositories: state.active
            ? [{ repository: "elizaOS/eliza", count: 1 }]
            : [],
          items: state.active ? [issue] : [],
          archived: state.active ? [] : [issue],
        },
      };
      const admit = () => assertProfiles(census, targets);
      if ((state.current !== state.replayed) === state.incomplete)
        expect(admit).not.toThrow();
      else expect(admit).toThrow(/history/iu);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(100);
});
