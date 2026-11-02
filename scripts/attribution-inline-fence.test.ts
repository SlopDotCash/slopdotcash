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
    id: "PR_kwDOinlinefence",
    artifactId: "PR_kwDOinlinefence",
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
  return assessModelAttribution([source(body)]).declarations.map(
    (declaration) => declaration.identifier,
  );
}

describe("attribution footer after inline triple backticks", () => {
  test("a backtick line with a backtick in its info string opens no fence", () => {
    expect(
      identifiers(`- \`\`\`bun run verify\`\`\` passes.\n\n${footer}`),
    ).toEqual(["openai/gpt-5"]);
    expect(identifiers(`\`\`\`bun run verify\`\`\`\n\n${footer}`)).toEqual([
      "openai/gpt-5",
    ]);
  });

  test("a footer inside a real fence stays hidden", () => {
    expect(identifiers(`\`\`\`text\n${footer}\n\`\`\``)).toEqual([]);
    expect(identifiers(`~~~ \`info\`\n${footer}\n~~~`)).toEqual([]);
  });
});
