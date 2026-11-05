import { describe, expect, test } from "bun:test";
import { directoryPeople, type ProfileRecord } from "../src/lib/profiles";

/**
 * The base People merge, copied verbatim in behaviour from Points.tsx at
 * d80086e4: rows come from the profile census and the public members only.
 * It exists here to demonstrate the base arrival on the live fixture below.
 */
function basePeople(
  census: readonly ProfileRecord[] | null,
  members: readonly { actor: { id: string; login: string } }[],
) {
  const byId = new Map<
    string,
    { id: string; login: string; merged: number | null; member?: unknown }
  >();
  if (census)
    for (const p of census)
      byId.set(p.id, {
        id: p.id,
        login: p.login,
        merged: p.repositories.reduce((a, r) => a + r.merged, 0),
      });
  for (const p of members) {
    const known = byId.get(p.actor.id);
    byId.set(p.actor.id, {
      id: p.actor.id,
      login: known?.login ?? p.actor.login,
      merged: known?.merged ?? (census ? 0 : null),
      member: p,
    });
  }
  return [...byId.values()].sort((a, b) => a.login.localeCompare(b.login));
}

function censusPerson(
  id: string,
  login: string,
  merged: number,
): ProfileRecord {
  return {
    id,
    login,
    avatarUrl: "",
    repositories: [{ repository: "elizaOS/eliza", merged, open: 0, closed: 0 }],
  };
}

type Member = {
  actor: { id: string; login: string };
  welcome: number;
  socialPoints: number;
  x: null;
};
const member = (id: string, login: string): Member => ({
  actor: { id, login },
  welcome: 0,
  socialPoints: 0,
  x: null,
});

// Live fixture, published batch generated 2026-11-04: the journal records
// this contributor with 3,610 points from 363 merged-pull-request awards,
// but the profile census omits them (their pull requests' author no longer
// resolves to a GitHub user, so the census counts them as excluded) and
// they are not a public member. On the base they have no directory row.
const JOURNAL_ONLY_ID = "U_kgDOFLIR6w";
const JOURNAL_ONLY_LOGIN = "shawgotbags";

describe("People directory rows", () => {
  test("base merge has no row for a journal-only contributor", () => {
    const rows = basePeople([censusPerson("U_kgDOBAAA", "someone", 3)], []);
    expect(rows.map((r) => r.id)).toEqual(["U_kgDOBAAA"]);
  });

  test("a journal-only contributor gets a row with an unknown PR count", () => {
    const rows = directoryPeople(
      [censusPerson("U_kgDOBAAA", "someone", 3)],
      [],
      [{ actor: { id: JOURNAL_ONLY_ID, login: JOURNAL_ONLY_LOGIN } }],
    );
    const row = rows.find((r) => r.id === JOURNAL_ONLY_ID);
    expect(row?.login).toBe(JOURNAL_ONLY_LOGIN);
    // The census never counted this person's pull requests; the row must
    // not invent a count (the page renders null as "PR count unavailable").
    expect(row?.merged).toBeNull();
    expect(row?.member).toBeUndefined();
  });

  test("census login and PR count win over the journal for the same person", () => {
    const rows = directoryPeople(
      [censusPerson(JOURNAL_ONLY_ID, "current-login", 7)],
      [],
      [{ actor: { id: JOURNAL_ONLY_ID, login: "recorded-login" } }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.login).toBe("current-login");
    expect(rows[0]?.merged).toBe(7);
  });

  test("a public member keeps the member marker and census precedence", () => {
    const m = member(JOURNAL_ONLY_ID, "member-login");
    const rows = directoryPeople(
      [censusPerson(JOURNAL_ONLY_ID, "census-login", 2)],
      [m],
      [{ actor: { id: JOURNAL_ONLY_ID, login: "recorded-login" } }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.login).toBe("census-login");
    expect(rows[0]?.merged).toBe(2);
    expect(rows[0]?.member).toBe(m);
  });

  test("a member with no census row keeps the base merged fallback", () => {
    const ready = directoryPeople(null, [member("U_kgDOBBBB", "mem")], []);
    expect(ready[0]?.merged).toBeNull();
    const withCensus = directoryPeople(
      [censusPerson("U_kgDOBAAA", "someone", 1)],
      [member("U_kgDOBBBB", "mem")],
      [],
    );
    expect(withCensus.find((r) => r.id === "U_kgDOBBBB")?.merged).toBe(0);
  });

  test("a journal row never displaces a member row for the same person", () => {
    const m = member("U_kgDOBBBB", "mem");
    const rows = directoryPeople(
      null,
      [m],
      [{ actor: { id: "U_kgDOBBBB", login: "recorded" } }],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.member).toBe(m);
    expect(rows[0]?.login).toBe("mem");
  });

  test("rows stay sorted by login across all three sources", () => {
    const rows = directoryPeople(
      [censusPerson("U_kgDOBAAA", "zeta", 1)],
      [member("U_kgDOBBBB", "alpha")],
      [{ actor: { id: "U_kgDOBCCC", login: "mid" } }],
    );
    expect(rows.map((r) => r.login)).toEqual(["alpha", "mid", "zeta"]);
  });
});
