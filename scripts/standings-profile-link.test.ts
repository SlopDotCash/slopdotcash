import { expect, test } from "bun:test";
import {
  directoryLoginsByActorId,
  type ProfileRecord,
  standingsProfileLogin,
} from "../src/lib/profiles";

/**
 * The standings name contributors by the login the points journal recorded,
 * substituting a current actor only for score-snapshot leaders. A renamed
 * contributor outside the snapshot is therefore linked under a login the
 * profile page cannot resolve: it knows the person only by the directory's
 * current login. The row link must follow the permanent actor ID through
 * the rename (PRD section 3) while the display keeps the recorded actor.
 */

const RENAMED_ID = "MDQ6VXNlcjg2NTUzNTgw";

function person(id: string, login: string): ProfileRecord {
  return { id, login, avatarUrl: "", repositories: [] };
}

test("the directory index keys current logins by permanent actor ID", () => {
  const logins = directoryLoginsByActorId([
    person(RENAMED_ID, "STARMEXXX"),
    person("U_kgDOEOd4mA", "hermesagent270-commits"),
  ]);
  expect(logins.get(RENAMED_ID)).toBe("STARMEXXX");
  expect(logins.get("U_kgDOEOd4mA")).toBe("hermesagent270-commits");
  expect(logins.get("U_missing")).toBeUndefined();
});

test("an ID the directory records under two logins is left ambiguous", () => {
  const logins = directoryLoginsByActorId([
    person(RENAMED_ID, "STARMEXXX"),
    person(RENAMED_ID, "futreall"),
    person(RENAMED_ID, "starmexxx"),
  ]);
  expect(logins.has(RENAMED_ID)).toBe(false);
});

test("a renamed non-leader row links to the directory's current login", () => {
  const directory = directoryLoginsByActorId([person(RENAMED_ID, "STARMEXXX")]);
  const login = standingsProfileLogin(
    { id: RENAMED_ID, login: "futreall" },
    directory,
    new Map(),
  );
  expect(login).toBe("STARMEXXX");
});

test("a row with no directory record keeps its recorded login", () => {
  const login = standingsProfileLogin(
    { id: "U_unknown", login: "journal-only" },
    new Map(),
    new Map(),
  );
  expect(login).toBe("journal-only");
});

test("a leader already displayed under the current login is unchanged", () => {
  const directory = directoryLoginsByActorId([person(RENAMED_ID, "STARMEXXX")]);
  const scoreLogins = new Map([[RENAMED_ID, new Set(["STARMEXXX"])]]);
  const login = standingsProfileLogin(
    { id: RENAMED_ID, login: "STARMEXXX" },
    directory,
    scoreLogins,
  );
  expect(login).toBe("STARMEXXX");
});

test("a score record naming the ID under the recorded login keeps that login", () => {
  // The profile page refuses a directory login when a score record names
  // the same ID differently, so the recorded login — which resolves
  // through the score record — must keep the link.
  const directory = directoryLoginsByActorId([person(RENAMED_ID, "STARMEXXX")]);
  const scoreLogins = new Map([[RENAMED_ID, new Set(["futreall"])]]);
  const login = standingsProfileLogin(
    { id: RENAMED_ID, login: "futreall" },
    directory,
    scoreLogins,
  );
  expect(login).toBe("futreall");
});

test("a score record naming the ID under the current login links to it", () => {
  const directory = directoryLoginsByActorId([person(RENAMED_ID, "STARMEXXX")]);
  const scoreLogins = new Map([[RENAMED_ID, new Set(["STARMEXXX"])]]);
  const login = standingsProfileLogin(
    { id: RENAMED_ID, login: "futreall" },
    directory,
    scoreLogins,
  );
  expect(login).toBe("STARMEXXX");
});

test("a case-only spelling difference keeps the recorded login", () => {
  const directory = directoryLoginsByActorId([person(RENAMED_ID, "StarMexxx")]);
  const login = standingsProfileLogin(
    { id: RENAMED_ID, login: "starmexxx" },
    directory,
    new Map(),
  );
  expect(login).toBe("starmexxx");
});
