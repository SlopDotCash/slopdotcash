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

function source(body: string): GitHubTextSource {
  return {
    id: "PR_kwDOtabfence",
    artifactId: "PR_kwDOtabfence",
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

describe("attribution footer and tab-indented fence lines", () => {
  test("a tab-indented fence line opens no fence", () => {
    // A leading tab expands to column four, past the three-column fence
    // allowance: the line is indented code, and the footer after it is
    // ordinary text.
    expect(identifiers(`\t\`\`\`\n${footer}`)).toEqual(["openai/gpt-5"]);
    expect(identifiers(` \t\`\`\`\n${footer}`)).toEqual(["openai/gpt-5"]);
  });

  test("a tab-indented fence line closes no fence", () => {
    // Inside a real fence the tab-indented line is code content, so the
    // declaration after it stays fenced and the real closing fence is the
    // one that lets the footer through.
    const body = [
      "```",
      "code",
      "\t```",
      "AI provider/model: anthropic / claude-sonnet",
      "```",
      "",
      footer,
    ].join("\n");
    expect(identifiers(body)).toEqual(["openai/gpt-5"]);
  });

  test("a space-indented fence still hides the footer inside it", () => {
    expect(identifiers(`  \`\`\`\n${footer}\n  \`\`\``)).toEqual([]);
  });

  test("a tab-indented declaration stays hidden as indented code", () => {
    expect(
      identifiers(`\tAI provider/model: anthropic / claude-sonnet`),
    ).toEqual([]);
  });
});
