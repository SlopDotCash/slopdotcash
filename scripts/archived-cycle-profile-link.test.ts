/**
 * Copyright 2026 The Slop Authors
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A frozen cycle record keeps the login a contributor had at freeze time.
 * Profile URLs resolve against current records, and the profile page
 * vetoes a login that the same permanent actor ID now contradicts
 * (src/ProfilePage.tsx currentProfileActor: "Every identity source can
 * veto a stale login"), so an archived-table link built from the frozen
 * login lands on "Slop has no contributor record" for a contributor who
 * renamed after the freeze. The archived table therefore resolves the
 * link target through the current actor record for the contributor's ID
 * — the substitution createGlobalLeaders already applies to the same
 * frozen contributors — while the frozen row itself (name, points,
 * amounts) stays verbatim.
 */
import { describe, expect, test } from "bun:test";
import { cycleContributorProfileLogin } from "../src/lib/global-leaderboard";
import type { GitHubActor } from "../src/lib/leaderboard-types";

const actor = (id: string, login: string): GitHubActor => ({
  id,
  login,
  avatarUrl: `https://avatars.githubusercontent.com/${login}?size=96`,
  url: `https://github.com/${login}`,
  kind: "User",
});

const ID = "U_kgDOEOd4mA";
const frozen = { actor: { id: ID, login: "old-handle" } };

describe("cycleContributorProfileLogin", () => {
  test("a contributor renamed after the freeze links to the current login", () => {
    const currentActors = new Map([[ID, actor(ID, "new-handle")]]);
    expect(cycleContributorProfileLogin(frozen, currentActors)).toBe(
      "new-handle",
    );
  });

  test("a contributor with no current record keeps the frozen login", () => {
    expect(cycleContributorProfileLogin(frozen, new Map())).toBe("old-handle");
  });

  test("a current record under the same login leaves the link unchanged", () => {
    const currentActors = new Map([[ID, actor(ID, "old-handle")]]);
    expect(cycleContributorProfileLogin(frozen, currentActors)).toBe(
      "old-handle",
    );
  });

  test("another actor's current record never substitutes", () => {
    const currentActors = new Map([
      ["U_kgDOther", actor("U_kgDOther", "new-handle")],
    ]);
    expect(cycleContributorProfileLogin(frozen, currentActors)).toBe(
      "old-handle",
    );
  });
});
