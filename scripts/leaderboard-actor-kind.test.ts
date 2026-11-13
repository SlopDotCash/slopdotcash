import { expect, test } from "bun:test";
import { isCreditEligibleCommitAuthor } from "../src/lib/commit-credit";
import { parseActor } from "./generate-leaderboard";

// Exact shapes GitHub returned on 12 November 2026 for one node ID in
// TokenJunction/eliza-valhalla#53: the pull request author, then the same
// account as an assignee and as a linked commit author.
const AVATAR = "https://avatars.githubusercontent.com/in/1143301?v=4";
const pullRequestAuthor = {
  __typename: "Bot",
  id: "BOT_kgDOC9w8XQ",
  login: "copilot-swe-agent",
  url: "https://github.com/apps/copilot-swe-agent",
  avatarUrl: AVATAR,
};
const userShapedAlias = {
  __typename: "User",
  id: "BOT_kgDOC9w8XQ",
  login: "Copilot",
  url: "https://github.com/Copilot",
  avatarUrl: AVATAR,
};

test("an app account served in User shape is still a Bot", () => {
  const author = parseActor(pullRequestAuthor, "author");
  const alias = parseActor(userShapedAlias, "assignees.nodes[0]");
  expect(author?.kind).toBe("Bot");
  expect(alias?.kind).toBe("Bot");
  expect(alias?.login).toBe("Copilot");
});

test("the User-shaped app alias never receives commit-author credit", () => {
  expect(
    isCreditEligibleCommitAuthor(parseActor(userShapedAlias, "commit.author")),
  ).toBe(false);
});

test("an ordinary user keeps the kind GitHub reports", () => {
  const person = parseActor(
    {
      __typename: "User",
      id: "U_kgDOFONy6A",
      login: "TokenJunction",
      url: "https://github.com/TokenJunction",
      avatarUrl:
        "https://avatars.githubusercontent.com/u/350450408?u=239cb5b6&v=4",
    },
    "commit.author",
  );
  expect(person?.kind).toBe("User");
  expect(isCreditEligibleCommitAuthor(person)).toBe(true);
});
