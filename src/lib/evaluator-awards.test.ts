/**
 * Proves that raw evaluator output cannot create score and that only bounded,
 * canonical, maintainer-reviewed award manifests become ledger events.
 */

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertEvaluatorAwardManifest,
  loadEvaluatorAwardEvents,
} from "./evaluator-awards";

const temporaryRoots: string[] = [];

function award(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: "1",
    kind: "evaluated-contribution",
    id: "award_useful_diagnosis_17",
    projectId: "eliza",
    repository: "elizaOS/eliza",
    actor: {
      id: "U_contributor",
      login: "contributor",
      avatarUrl: "https://avatars.githubusercontent.com/u/42?v=4",
      url: "https://github.com/contributor",
      kind: "User",
    },
    occurredAt: "2026-07-20T10:00:00.000Z",
    points: 4,
    source: {
      id: "PR_unmerged_17",
      kind: "pull-request",
      number: 17,
      title: "Diagnose the scheduler race",
      url: "https://github.com/elizaOS/eliza/pull/17",
    },
    reason:
      "The unmerged patch isolated a real scheduler race and supplied a deterministic regression test used by the final repair.",
    review: {
      reviewer: "maintainer",
      reviewedAt: "2026-07-22T10:00:00.000Z",
      decisionUrl: "https://github.com/elizaOS/army/pull/99",
    },
    ...overrides,
  };
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "gitarmy-awards-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "eliza"));
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("evaluator award protocol", () => {
  it("turns a reviewed manifest into one digest-bound score event", () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, "eliza", "award-useful-diagnosis-17.json"),
      `${JSON.stringify(award(), null, 2)}\n`,
    );

    const events = loadEvaluatorAwardEvents(root);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      id: "award_useful_diagnosis_17",
      category: "evaluated-contribution",
      points: 4,
      repository: "elizaOS/eliza",
      evaluation: {
        reviewer: "maintainer",
        manifestSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    });
  });

  it("rejects raw model output, extra fields, and non-project repositories", () => {
    expect(() =>
      assertEvaluatorAwardManifest({
        ...award(),
        modelVerdict: "award",
      }),
    ).toThrow("unexpected or missing fields");
    expect(() =>
      assertEvaluatorAwardManifest(
        award({ repository: "attacker/copied-repository" }),
      ),
    ).toThrow("not canonical");
  });

  it("rejects duplicate source credit even when award ids differ", () => {
    const root = fixtureRoot();
    writeFileSync(
      join(root, "eliza", "award-first.json"),
      JSON.stringify(award({ id: "award_first" })),
    );
    writeFileSync(
      join(root, "eliza", "award-second.json"),
      JSON.stringify(award({ id: "award_second" })),
    );

    expect(() => loadEvaluatorAwardEvents(root)).toThrow(
      "ids and sources must be unique",
    );
  });

  it("rejects symlinks and unexpected files instead of following them", () => {
    const root = fixtureRoot();
    const outside = join(root, "outside.json");
    writeFileSync(outside, JSON.stringify(award()));
    symlinkSync(outside, join(root, "eliza", "award-linked.json"));

    expect(() => loadEvaluatorAwardEvents(root)).toThrow(
      "not a canonical award file",
    );
  });
});
