/**
 * Proves that an award for work outside GitHub scores only when the project
 * has opted in, the URL is canonical, the id is bound to that URL, and archive
 * evidence was captured between the contribution and its review.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertEvaluatorAwardManifest,
  loadEvaluatorAwardEvents,
} from "./evaluator-awards";
import { externalSourceId } from "./external-sources";

vi.mock("./projects.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./projects.mjs")>();
  return {
    ...actual,
    findProject: (id: string) => {
      const project = actual.findProject(id);
      if (!project || id !== "eliza") return project;
      return {
        ...project,
        reward: { ...project.reward, externalEvaluations: { enabled: true } },
      };
    },
  };
});

const post = "https://x.com/contributor/status/1830000000000000000";
const temporaryRoots: string[] = [];

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "slop-external-awards-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "eliza"));
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function externalAward(
  overrides: Record<string, unknown> = {},
  source: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: "1",
    kind: "evaluated-contribution",
    id: "award_contributor_thread_plugins",
    projectId: "eliza",
    repository: "elizaOS/eliza",
    actor: {
      id: "U_contributor",
      login: "contributor",
      avatarUrl: "https://avatars.githubusercontent.com/u/42?v=4",
      url: "https://github.com/contributor",
      kind: "User",
    },
    occurredAt: "2026-09-01T10:00:00.000Z",
    points: 2,
    source: {
      id: externalSourceId(post),
      kind: "external",
      platform: "x",
      title: "Thread: migrating an eliza plugin to the v2 runtime",
      url: post,
      evidence: {
        archiveUrl: `https://web.archive.org/web/20260902120000/${post}`,
        contentSha256: "b".repeat(64),
        capturedAt: "2026-09-02T12:00:00.000Z",
      },
      ...source,
    },
    reason:
      "The thread walked through the exact runtime migration steps that three separate issue reporters had been missing, and maintainers now link it from the plugin guide.",
    review: {
      reviewer: "maintainer",
      reviewedAt: "2026-09-03T10:00:00.000Z",
      decisionUrl: "https://github.com/SlopDotCash/slopdotcash/pull/99",
    },
    ...overrides,
  };
}

describe("external evaluated contributions", () => {
  it("accepts an opted-in, archived, canonical external award", () => {
    const manifest = assertEvaluatorAwardManifest(externalAward());
    expect(manifest.source).toEqual({
      id: externalSourceId(post),
      kind: "external",
      number: 0,
      platform: "x",
      title: "Thread: migrating an eliza plugin to the v2 runtime",
      url: post,
      evidence: {
        archiveUrl: `https://web.archive.org/web/20260902120000/${post}`,
        contentSha256: "b".repeat(64),
        capturedAt: "2026-09-02T12:00:00.000Z",
      },
    });
  });

  it("rejects external awards for projects that have not opted in", () => {
    expect(() =>
      assertEvaluatorAwardManifest(
        externalAward({ projectId: "asi", repository: "elizaOS/asi" }),
      ),
    ).toThrow(/has not opted in/u);
  });

  it("binds the id to the URL and forbids GitHub or numbered sources", () => {
    expect(() =>
      assertEvaluatorAwardManifest(externalAward({}, { id: "external-x" })),
    ).toThrow(/sha256 digest of its external URL/u);
    expect(() =>
      assertEvaluatorAwardManifest(externalAward({}, { number: 17 })),
    ).toThrow(/unexpected or missing fields/u);
    expect(() =>
      assertEvaluatorAwardManifest(
        externalAward(
          {},
          {
            platform: "web",
            url: "https://github.com/elizaOS/eliza/discussions/1",
          },
        ),
      ),
    ).toThrow(/canonical public web URL/u);
    expect(() =>
      assertEvaluatorAwardManifest(externalAward({}, { platform: "tiktok" })),
    ).toThrow(/platform must be one of/u);
    for (const url of [
      "https://gist.github.com/contributor/abcdef123456",
      "https://raw.githubusercontent.com/contributor/notes/main/thread.md",
      "https://contributor.github.io/thread",
      "https://fxtwitter.com/contributor/status/1830000000000000000",
      "https://nitter.net/contributor/status/1830000000000000000",
    ]) {
      expect(() =>
        assertEvaluatorAwardManifest(
          externalAward(
            {},
            {
              id: externalSourceId(url),
              platform: "web",
              url,
              evidence: {
                archiveUrl: `https://web.archive.org/web/20260902120000/${url}`,
                contentSha256: "b".repeat(64),
                capturedAt: "2026-09-02T12:00:00.000Z",
              },
            },
          ),
        ),
      ).toThrow(/canonical public web URL/u);
    }
    expect(() =>
      assertEvaluatorAwardManifest(
        externalAward(
          {},
          {
            id: externalSourceId(
              "https://twitter.com/contributor/status/1830000000000000000",
            ),
            url: "https://twitter.com/contributor/status/1830000000000000000",
          },
        ),
      ),
    ).toThrow(/use https:\/\/x\.com/u);
  });

  it("rejects a second award for the same work or the same archived content", () => {
    const sameStatusOtherHandle =
      "https://x.com/Contributor_/status/1830000000000000000";
    const root = fixtureRoot();
    writeFileSync(
      join(root, "eliza", "award-first.json"),
      JSON.stringify(externalAward({ id: "award_first" })),
    );
    writeFileSync(
      join(root, "eliza", "award-second.json"),
      JSON.stringify(
        externalAward(
          { id: "award_second" },
          {
            id: externalSourceId(sameStatusOtherHandle),
            url: sameStatusOtherHandle,
            evidence: {
              archiveUrl: `https://web.archive.org/web/20260902120000/${sameStatusOtherHandle}`,
              contentSha256: "d".repeat(64),
              capturedAt: "2026-09-02T12:00:00.000Z",
            },
          },
        ),
      ),
    );
    expect(() => loadEvaluatorAwardEvents(root)).toThrow(
      /repeats external work already awarded/u,
    );

    const article = "https://blog.example.org/eliza-runtime-migration";
    const mirror = "https://mirror.example.net/eliza-runtime-migration";
    const contentRoot = fixtureRoot();
    for (const [id, url] of [
      ["award_article", article],
      ["award_mirror", mirror],
    ] as const) {
      writeFileSync(
        join(contentRoot, "eliza", `${id.replace("_", "-")}.json`),
        JSON.stringify(
          externalAward(
            { id },
            {
              id: externalSourceId(url),
              platform: "web",
              url,
              evidence: {
                archiveUrl: `https://web.archive.org/web/20260902120000/${url}`,
                contentSha256: "e".repeat(64),
                capturedAt: "2026-09-02T12:00:00.000Z",
              },
            },
          ),
        ),
      );
    }
    expect(() => loadEvaluatorAwardEvents(contentRoot)).toThrow(
      /repeats external work already awarded/u,
    );
  });

  it("requires evidence captured between the contribution and its review", () => {
    const evidence = {
      archiveUrl: `https://web.archive.org/web/20260902120000/${post}`,
      contentSha256: "b".repeat(64),
    };
    expect(() =>
      assertEvaluatorAwardManifest(
        externalAward(
          {},
          {
            evidence: { ...evidence, capturedAt: "2026-08-31T12:00:00.000Z" },
          },
        ),
      ),
    ).toThrow(/captured between/u);
    expect(() =>
      assertEvaluatorAwardManifest(
        externalAward(
          {},
          {
            evidence: { ...evidence, capturedAt: "2026-09-04T12:00:00.000Z" },
          },
        ),
      ),
    ).toThrow(/captured between/u);
    const { evidence: _omitted, ...withoutEvidence } = externalAward()
      .source as Record<string, unknown>;
    expect(() =>
      assertEvaluatorAwardManifest(externalAward({ source: withoutEvidence })),
    ).toThrow(/unexpected or missing fields/u);
  });
});
