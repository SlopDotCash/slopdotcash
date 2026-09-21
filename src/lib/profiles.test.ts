import { describe, expect, it } from "vitest";
import { assertProfiles, type ProfileIndex, profileCounts } from "./profiles";
import { TARGET_REPOSITORIES } from "./repositories.mjs";

function fixture(): ProfileIndex {
  return {
    schemaVersion: "1",
    startedAt: "2026-09-21T00:00:00Z",
    generatedAt: "2026-09-21T01:00:00Z",
    repositories: TARGET_REPOSITORIES.map((r, i) => ({
      repository: r.id,
      count: i === 0 ? 7 : 0,
      excluded: i === 0 ? 1 : 0,
    })),
    people: [
      {
        id: "U_test",
        login: "contributor",
        avatarUrl: "https://avatars.githubusercontent.com/u/1",
        repositories: [
          {
            repository: TARGET_REPOSITORIES[0].id,
            merged: 3,
            open: 2,
            closed: 1,
          },
        ],
      },
    ],
  };
}
describe("complete contributor census", () => {
  it("keeps merged, open and unmerged closed PRs distinct and reconciles excluded authors", () => {
    const f = fixture();
    assertProfiles(f);
    expect(profileCounts(f.people[0])).toEqual({
      merged: 3,
      open: 2,
      closed: 1,
    });
  });
  it("rejects partial inventories, duplicate identities and unsafe images", () => {
    const partial = fixture();
    partial.repositories[0].count++;
    expect(() => assertProfiles(partial)).toThrow();
    const dup = fixture();
    dup.people.push(dup.people[0]);
    expect(() => assertProfiles(dup)).toThrow();
    const unsafe = fixture();
    unsafe.people[0].avatarUrl = "https://evil.example/avatar";
    expect(() => assertProfiles(unsafe)).toThrow();
    const missing = fixture();
    missing.repositories.pop();
    expect(() => assertProfiles(missing)).toThrow();
  });
});
