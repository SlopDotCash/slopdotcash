import { expect, test } from "bun:test";
import { type ProfileRecord, recordedProfileCounts } from "../src/lib/profiles";

const record: ProfileRecord = {
  id: "12345",
  login: "contributor",
  avatarUrl: "https://avatars.githubusercontent.com/contributor?size=160",
  repositories: [
    { repository: "SlopDotCash/slopdotcash", merged: 3, open: 1, closed: 2 },
    { repository: "elizaOS/eliza", merged: 4, open: 0, closed: 1 },
  ],
};

test("a recorded contributor's profile counts sum every collected repository", () => {
  expect(recordedProfileCounts(record)).toEqual({
    merged: 7,
    open: 1,
    closed: 3,
  });
});

test("a contributor the census does not record has unknown counts, not zero", () => {
  // The points journal can know a contributor the profile census has no
  // record of; their pull requests are uncounted, not none. The profile
  // must not state a fabricated zero for them (points-v1: missing data is
  // unavailable, never a fabricated zero).
  expect(recordedProfileCounts(undefined)).toBeNull();
});

test("a recorded contributor with no collected rows has a real zero", () => {
  expect(recordedProfileCounts({ ...record, repositories: [] })).toEqual({
    merged: 0,
    open: 0,
    closed: 0,
  });
});
