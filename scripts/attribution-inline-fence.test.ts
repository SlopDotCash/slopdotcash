import { expect, test } from "bun:test";
import { assessModelAttribution } from "../src/lib/leaderboard";
import type { GitHubTextSource } from "../src/lib/leaderboard-types";

const SKILL_REVISION =
  "N/A - ordinary GitHub contribution without optional run evidence";

function footer(): string {
  return [
    "AI provider/model: OpenAI / gpt-5",
    "Client / agent tooling: cursor",
    `Contribution skill revision: ${SKILL_REVISION}`,
    "Attribution status: self-reported",
    "— [contributor]",
    `<!-- slop-contribution-attribution:v1 ${JSON.stringify({
      provider: "OpenAI",
      model: "gpt-5",
      client: "cursor",
      skill_revision: SKILL_REVISION,
    })} -->`,
  ].join("\n");
}

function source(body: string): GitHubTextSource {
  return {
    id: "PR_inline_fence:body",
    artifactId: "PR_inline_fence",
    kind: "body",
    body,
    url: "https://github.com/example/alpha/pull/1",
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    author: {
      id: "MDQ6VXNlcjE=",
      login: "contributor",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      url: "https://github.com/contributor",
      kind: "User",
    },
  };
}

test("an inline triple-backtick span does not hide the attribution footer", () => {
  const assessment = assessModelAttribution([
    source(`${"```"}bun run verify${"```"} passes.\n\n${footer()}`),
  ]);
  expect(assessment.invalidMarkers).toEqual([]);
  expect(assessment.coverage.status).toBe("complete");
  expect(assessment.declarations.map((entry) => entry.identifier)).toEqual([
    "OpenAI/gpt-5",
  ]);
});

test("a tilde line whose info string contains a tilde still opens a fence", () => {
  const assessment = assessModelAttribution([
    source(`~~~echo~~~ is not a fence.\n\n${footer()}`),
  ]);
  expect(assessment.invalidMarkers).toEqual([]);
  expect(assessment.coverage.status).toBe("missing");
  expect(assessment.declarations).toEqual([]);
});

test("a tilde fence with a tilde in its info string hides the block and keeps the footer", () => {
  const fenced = "~~~a~b\nIN-BLOCK-LINE\n~~~\n\nREAL-FOOTER-LINE";
  const assessment = assessModelAttribution([
    source(
      `${fenced.replace(
        "IN-BLOCK-LINE",
        "IN-BLOCK-LINE\nAI provider/model: OpenAI / gpt-4",
      )}\n\n${footer()}`,
    ),
  ]);
  expect(assessment.invalidMarkers).toEqual([]);
  expect(assessment.coverage.status).toBe("complete");
  expect(assessment.declarations.map((entry) => entry.identifier)).toEqual([
    "OpenAI/gpt-5",
  ]);
});

test("a real fence still hides the example and keeps the footer after it", () => {
  const assessment = assessModelAttribution([
    source(
      [
        "```",
        "AI provider/model: OpenAI / gpt-4",
        "```bun run verify``` stays inside the fence.",
        "```",
        "",
        footer(),
      ].join("\n"),
    ),
  ]);
  expect(assessment.invalidMarkers).toEqual([]);
  expect(assessment.coverage.status).toBe("complete");
  expect(assessment.declarations.map((entry) => entry.identifier)).toEqual([
    "OpenAI/gpt-5",
  ]);
});
