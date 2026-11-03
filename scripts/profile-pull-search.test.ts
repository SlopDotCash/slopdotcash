import { expect, test } from "bun:test";
import {
  contributorPullSearchUrl,
  type ProfileRecord,
  profileCounts,
} from "../src/lib/profiles";

test("contributor pull counts use the public search", () => {
  expect(contributorPullSearchUrl("octocat", "is:merged")).toBe(
    "https://github.com/search?q=is%3Apr%20author%3Aoctocat%20is%3Amerged&type=pullrequests",
  );
  expect(contributorPullSearchUrl("octocat", "is:open")).toBe(
    "https://github.com/search?q=is%3Apr%20author%3Aoctocat%20is%3Aopen&type=pullrequests",
  );
  expect(contributorPullSearchUrl("octocat", "is:closed is:unmerged")).toBe(
    "https://github.com/search?q=is%3Apr%20author%3Aoctocat%20is%3Aclosed%20is%3Aunmerged&type=pullrequests",
  );
});

test("contributor pull counts scope the search to the counted repositories", () => {
  // The counts sum only the repositories recorded on the profile, so the
  // linked search must cover exactly those repositories — no more, no less.
  const profile: ProfileRecord = {
    id: "MDQ6VXNlcjEyMzQ1Njc=",
    login: "scoped-contributor",
    avatarUrl: "https://avatars.githubusercontent.com/u/1234567",
    repositories: [
      { repository: "elizaOS/eliza", merged: 3, open: 1, closed: 0 },
      { repository: "SlopDotCash/slopdotcash", merged: 2, open: 0, closed: 1 },
    ],
  };
  expect(profileCounts(profile)).toEqual({ merged: 5, open: 1, closed: 1 });
  const repositories = profile.repositories.map((row) => row.repository);
  expect(
    contributorPullSearchUrl(profile.login, "is:merged", repositories),
  ).toBe(
    "https://github.com/search?q=is%3Apr%20author%3Ascoped-contributor%20is%3Amerged%20repo%3AelizaOS%2Feliza%20repo%3ASlopDotCash%2Fslopdotcash&type=pullrequests",
  );
  expect(contributorPullSearchUrl(profile.login, "is:open", repositories)).toBe(
    "https://github.com/search?q=is%3Apr%20author%3Ascoped-contributor%20is%3Aopen%20repo%3AelizaOS%2Feliza%20repo%3ASlopDotCash%2Fslopdotcash&type=pullrequests",
  );
  // One recorded repository scopes to that repository alone.
  expect(
    contributorPullSearchUrl(profile.login, "is:merged", ["elizaOS/eliza"]),
  ).toBe(
    "https://github.com/search?q=is%3Apr%20author%3Ascoped-contributor%20is%3Amerged%20repo%3AelizaOS%2Feliza&type=pullrequests",
  );
});

test("contributor pull counts do not open the signed-in pull dashboard", () => {
  for (const qualifier of ["is:merged", "is:open", "is:closed is:unmerged"]) {
    const href = contributorPullSearchUrl(
      "profile-only-contributor",
      qualifier,
    );
    expect(href.startsWith("https://github.com/search?")).toBe(true);
    expect(href).not.toContain("github.com/pulls");
    expect(new URL(href).searchParams.get("type")).toBe("pullrequests");
  }
});
