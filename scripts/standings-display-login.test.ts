import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { type PointsJournal, pointMembers } from "../src/lib/points";
import {
  censusLoginsByActorId,
  standingsDisplayLogin,
} from "../src/lib/profiles";

// The committed journal still records this contributor under the login they
// had when their work was scored. The profile directory (census) records the
// same permanent actor ID under the login GitHub now proves for the account,
// so the standings must display the current login for the same ID — the way
// the People directory and the profile page already present the person.
const journal = JSON.parse(
  readFileSync("data/points/history.json", "utf8"),
) as PointsJournal;

const renamed = pointMembers(journal).find(
  (member) => member.actor.id === "MDQ6VXNlcjg2NTUzNTgw",
);

test("the journal projection still names the renamed contributor by the recorded login", () => {
  expect(renamed?.actor.login).toBe("futreall");
  expect(renamed?.total).toBe(10);
});

const person = (id: string, login: string) => ({
  id,
  login,
  avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
  repositories: [],
});

test("the census index keys the current login by permanent actor ID", () => {
  const index = censusLoginsByActorId([
    person("MDQ6VXNlcjg2NTUzNTgw", "STARMEXXX"),
    person("MDQ6VXNlcjI=", "someone-else"),
  ]);
  expect(index.get("MDQ6VXNlcjg2NTUzNTgw")).toBe("STARMEXXX");
  expect(index.get("MDQ6VXNlcjI=")).toBe("someone-else");
});

test("an ID the census records under two different logins is ambiguous and left out", () => {
  const index = censusLoginsByActorId([
    person("MDQ6VXNlcjg2NTUzNTgw", "STARMEXXX"),
    person("MDQ6VXNlcjg2NTUzNTgw", "recycled-login"),
  ]);
  expect(index.has("MDQ6VXNlcjg2NTUzNTgw")).toBe(false);
  // A case-only difference is the same login, not an ambiguity.
  const cased = censusLoginsByActorId([
    person("MDQ6VXNlcjg2NTUzNTgw", "STARMEXXX"),
    person("MDQ6VXNlcjg2NTUzNTgw", "starmexxx"),
  ]);
  expect(cased.get("MDQ6VXNlcjg2NTUzNTgw")).toBe("STARMEXXX");
});

const recorded = { id: "MDQ6VXNlcjg2NTUzNTgw", login: "futreall" };
const directory = new Map([[recorded.id, "STARMEXXX"]]);
const noScores = new Map<string, ReadonlySet<string>>();

test("a renamed contributor outside the score records displays under the current login", () => {
  expect(standingsDisplayLogin(recorded, directory, noScores)).toBe(
    "STARMEXXX",
  );
});

test("a contributor with no directory record keeps the recorded login", () => {
  expect(standingsDisplayLogin(recorded, new Map(), noScores)).toBe("futreall");
});

test("a case-only difference keeps the recorded login", () => {
  const cased = new Map([[recorded.id, "Futreall"]]);
  expect(standingsDisplayLogin(recorded, cased, noScores)).toBe("futreall");
});

test("a score record naming the ID under the recorded login keeps the recorded login", () => {
  // The profile page refuses the directory login in exactly this case, so
  // the display follows the score record it resolves through instead.
  const scores = new Map([[recorded.id, new Set(["futreall"])]]);
  expect(standingsDisplayLogin(recorded, directory, scores)).toBe("futreall");
});

test("a score record naming the ID under the current login displays the current login", () => {
  const scores = new Map([[recorded.id, new Set(["STARMEXXX"])]]);
  expect(standingsDisplayLogin(recorded, directory, scores)).toBe("STARMEXXX");
});

test("a score record naming the ID under any other login keeps the recorded login", () => {
  const scores = new Map([[recorded.id, new Set(["third-login"])]]);
  expect(standingsDisplayLogin(recorded, directory, scores)).toBe("futreall");
});

test("a login the census records under two permanent IDs is ambiguous and left out", () => {
  // The directory only enforces unique IDs, so a carried-over row can
  // still claim a login another ID has since taken; the profile page
  // refuses such a login, so neither ID may display through it.
  const index = censusLoginsByActorId([
    person("MDQ6VXNlcjg2NTUzNTgw", "shared-login"),
    person("MDQ6VXNlcjI=", "shared-login"),
    person("MDQ6VXNlcjM=", "someone-else"),
  ]);
  expect(index.has("MDQ6VXNlcjg2NTUzNTgw")).toBe(false);
  expect(index.has("MDQ6VXNlcjI=")).toBe(false);
  expect(index.get("MDQ6VXNlcjM=")).toBe("someone-else");
});

test("a case-only login collision across two permanent IDs is ambiguous too", () => {
  const index = censusLoginsByActorId([
    person("MDQ6VXNlcjg2NTUzNTgw", "Shared-Login"),
    person("MDQ6VXNlcjI=", "shared-login"),
  ]);
  expect(index.has("MDQ6VXNlcjg2NTUzNTgw")).toBe(false);
  expect(index.has("MDQ6VXNlcjI=")).toBe(false);
});

test("a score record naming another ID under the current login keeps the recorded login", () => {
  // The profile page vetoes the directory login in exactly this case, so
  // the row must not display a login the profile page cannot resolve to it.
  const scores = new Map([["MDQ6VXNlcjI=", new Set(["STARMEXXX"])]]);
  expect(standingsDisplayLogin(recorded, directory, scores)).toBe("futreall");
});

test("a score record naming another ID under a different login still displays the current login", () => {
  const scores = new Map([["MDQ6VXNlcjI=", new Set(["someone-else"])]]);
  expect(standingsDisplayLogin(recorded, directory, scores)).toBe("STARMEXXX");
});
