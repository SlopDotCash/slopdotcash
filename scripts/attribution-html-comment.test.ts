import { describe, expect, test } from "bun:test";
import { assessModelAttribution } from "../src/lib/leaderboard";
import type { GitHubTextSource } from "../src/lib/leaderboard-types";

const footer = [
  "Made via @slopdotcash",
  "AI provider/model: openai / gpt-5",
  "Client / agent tooling: codex-cli",
  "Contribution skill revision: N/A - ordinary GitHub contribution without optional run evidence",
  "Attribution status: self-reported",
].join("\n");

const markerBody = `Made via @slopdotcash
AI provider/model: OpenAI / gpt-5
Client / agent tooling: codex
Contribution skill revision: N/A - ordinary GitHub contribution without optional run evidence
Attribution status: self-reported
— [contributor]
<!-- slop-contribution-attribution:v1 {"provider":"OpenAI","model":"gpt-5","client":"codex","skill_revision":"N/A - ordinary GitHub contribution without optional run evidence"} -->`;

function source(body: string): GitHubTextSource {
  return {
    id: "PR_kwDOhtmlcomment",
    artifactId: "PR_kwDOhtmlcomment",
    kind: "body",
    body,
    url: "https://github.com/example/repo/pull/1",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    author: {
      id: "MDQ6VXNlcjE=",
      login: "alice",
      url: "https://github.com/alice",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      kind: "User",
    },
  };
}

function identifiers(body: string): string[] {
  return assessModelAttribution([source(body)], {
    requireEverySource: true,
  }).declarations.map((declaration) => declaration.identifier);
}

describe("attribution declarations and HTML comments", () => {
  test("a footer inside a multi-line HTML comment is not a declaration", () => {
    const body = `<!--\n${footer}\n-->`;
    expect(identifiers(body)).toEqual([]);
    // The hidden lines must not even make the source eligible on their own.
    expect(assessModelAttribution([source(body)]).declarations).toEqual([]);
  });

  test("a comment opening after visible text still hides what follows", () => {
    expect(identifiers(`Notes: <!--\n${footer}\n-->`)).toEqual([]);
  });

  test("an unclosed HTML comment hides the footer after it", () => {
    expect(identifiers(`<!-- draft\n${footer}`)).toEqual([]);
  });

  test("a fence marker inside a comment does not hide a later footer", () => {
    expect(identifiers(`<!--\n\`\`\`\n-->\n${footer}`)).toEqual([
      "openai/gpt-5",
    ]);
  });

  test("a comment marker inside a code span opens no comment", () => {
    expect(identifiers(`\`<!--\`\n\n${footer}`)).toEqual(["openai/gpt-5"]);
  });

  test("a comment marker inside a fenced block opens no comment", () => {
    expect(identifiers(`\`\`\`\n<!--\n\`\`\`\n${footer}`)).toEqual([
      "openai/gpt-5",
    ]);
  });

  test("a comment closed on the same line opens no comment", () => {
    const body = [
      "Models used: openai/gpt-5 <!-- note -->",
      "AI provider/model: anthropic / claude-sonnet",
    ].join("\n");
    expect(identifiers(body)).toEqual([
      "openai/gpt-5",
      "anthropic/claude-sonnet",
    ]);
  });

  test("a marker inside a multi-line comment is not a marker", () => {
    const body = `<!--\n<!-- slop-contribution-attribution:v1 {"provider":"OpenAI","model":"gpt-5","client":"codex","skill_revision":"N/A - ordinary GitHub contribution without optional run evidence"} -->\n-->\n${footer}`;
    const result = assessModelAttribution([source(body)], {
      requireEverySource: true,
    });
    expect(result.invalidMarkers).toEqual([]);
    expect(result.declarations.map((d) => d.identifier)).toEqual([
      "openai/gpt-5",
    ]);
    expect(
      result.declarations.every((d) => d.format === "visible-declaration"),
    ).toBe(true);
  });

  test("the ordinary single-line marker comment still validates", () => {
    const result = assessModelAttribution([source(markerBody)], {
      requireEverySource: true,
    });
    expect(result.coverage.status).toBe("complete");
    expect(result.invalidMarkers).toEqual([]);
  });
});
