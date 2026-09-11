import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { assessModelAttribution } from "./leaderboard";

describe("ordinary contribution", () => {
  it("produces accepted attribution without Slop networking, usage, or a measured run", () => {
    const body = execFileSync(
      "node",
      [
        "skills/contribute-to-eliza/scripts/run-receipt.mjs",
        "disclose",
        "--provider",
        "openai",
        "--model",
        "gpt-6",
        "--client",
        "codex",
      ],
      { encoding: "utf8" },
    );
    const result = assessModelAttribution([
      {
        id: "COMMENT_1",
        artifactId: "PR_1",
        kind: "comment",
        body,
        url: "https://github.com/elizaOS/eliza/pull/1#issuecomment-1",
        createdAt: "2026-09-11T12:00:00.000Z",
        updatedAt: "2026-09-11T12:00:00.000Z",
        author: {
          id: "U_1",
          login: "builder",
          avatarUrl: "https://avatars.githubusercontent.com/builder",
          url: "https://github.com/builder",
          kind: "User",
        },
        authorAssociation: "MEMBER",
      },
    ]);
    expect(result.invalidMarkers).toEqual([]);
    expect(result.declarations[0]).toMatchObject({
      provider: "openai",
      model: "gpt-6",
      client: "codex",
    });
    expect(result.declarations[0].run).toBeNull();
  });
});
