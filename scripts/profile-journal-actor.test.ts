import { expect, test } from "bun:test";
import {
  type ProfileActorSource,
  resolveProfileActor,
} from "../src/lib/profile-actor";

const actor = (id: string, login: string): ProfileActorSource => ({
  id,
  login,
});

test("a journal-only earner resolves to their recorded profile", () => {
  // The standings name this contributor from the Points journal, but no
  // current source does: they earned only review credit, never joined, and
  // appear in neither the snapshot nor the directory.
  const resolved = resolveProfileActor({
    login: "reviewer-only",
    actors: [],
    people: [],
    member: null,
    journal: [actor("U1", "reviewer-only")],
  });
  expect(resolved?.id).toBe("U1");
  expect(resolved?.login).toBe("reviewer-only");
  expect(resolved?.url).toBe("https://github.com/reviewer-only");
});

test("the journal does not resolve anyone while it has not loaded", () => {
  expect(
    resolveProfileActor({
      login: "reviewer-only",
      actors: [],
      people: [],
      member: null,
      journal: null,
    }),
  ).toBeUndefined();
});

test("a directory rename vetoes the journal's stale login", () => {
  // The journal still records the old login; the directory names the same
  // permanent ID under the current login, so the old login resolves no one.
  expect(
    resolveProfileActor({
      login: "old-login",
      actors: [],
      people: [actor("U1", "new-login")],
      member: null,
      journal: [actor("U1", "old-login")],
    }),
  ).toBeUndefined();
});

test("the journal record does not veto the directory's current login", () => {
  const resolved = resolveProfileActor({
    login: "new-login",
    actors: [],
    people: [actor("U1", "new-login")],
    member: null,
    journal: [actor("U1", "old-login")],
  });
  expect(resolved?.id).toBe("U1");
  expect(resolved?.login).toBe("new-login");
});

test("a current source holding the journal actor's ID under another login vetoes the journal", () => {
  // The snapshot names this permanent ID under a newer login, so the
  // journal's older login for the same ID resolves no one.
  expect(
    resolveProfileActor({
      login: "reviewer-only",
      actors: [actor("U1", "current-name")],
      people: [],
      member: null,
      journal: [actor("U1", "reviewer-only")],
    }),
  ).toBeUndefined();
});

test("a membership veto is not rescued by the journal", () => {
  // The membership record names this login, but a current source holds its
  // ID under a different login: resolution fails closed, journal or not.
  expect(
    resolveProfileActor({
      login: "contested",
      actors: [actor("U1", "other-login")],
      people: [],
      member: actor("U1", "contested"),
      journal: [actor("U9", "contested")],
    }),
  ).toBeUndefined();
});

test("membership, current sources and the directory keep their priority", () => {
  const byMember = resolveProfileActor({
    login: "someone",
    actors: [actor("U1", "someone")],
    people: [actor("U1", "someone")],
    member: actor("U1", "someone"),
    journal: [actor("U1", "someone")],
  });
  expect(byMember?.id).toBe("U1");
  const byCurrent = resolveProfileActor({
    login: "someone",
    actors: [actor("U1", "someone")],
    people: [],
    member: null,
    journal: [actor("U2", "someone")],
  });
  expect(byCurrent?.id).toBe("U1");
  const byDirectory = resolveProfileActor({
    login: "someone",
    actors: [],
    people: [actor("U3", "someone")],
    member: null,
    journal: [actor("U2", "someone")],
  });
  expect(byDirectory?.id).toBe("U3");
});

test("a login the journal records under two IDs stays unresolved", () => {
  expect(
    resolveProfileActor({
      login: "reused",
      actors: [],
      people: [],
      member: null,
      journal: [actor("U1", "reused"), actor("U2", "reused")],
    }),
  ).toBeUndefined();
});

test("case differences in the recorded login still resolve", () => {
  const resolved = resolveProfileActor({
    login: "Reviewer-Only",
    actors: [],
    people: [],
    member: null,
    journal: [actor("U1", "reviewer-only")],
  });
  expect(resolved?.id).toBe("U1");
});
