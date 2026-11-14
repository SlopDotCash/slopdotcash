import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { PointsDependencies } from "../points/dependencies";
import { handlePointsApi, sessionGithubActor } from "../points/handler";
import {
  handleReferralCode,
  REFERRAL_CODE_LIMIT,
  referralRedirect,
} from "./codes";

const origin = "https://slop.cash";
const api = `${origin}/api/v1/referrals/code`;
const ALICE = "900000100";
const BOB = "900000200";
const ADMIN = "900000900";

function harness() {
  const { db, sqlite } = sqliteD1();
  const member = (githubId: string, login: string) =>
    sqlite
      .query(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,'2026-11-01T00:00:00.000Z',1)",
      )
      .run(`U_${githubId}`, githubId, login);
  member(ALICE, "alice-gh");
  member(BOB, "bob-gh");
  member(ADMIN, "admin-gh");
  // GitHub accounts that exist, by lowercase login.
  const github = new Map<string, number>([
    ["alice-gh", Number(ALICE)],
    ["someone", 42],
  ]);
  let githubDown = false;
  let lookups = 0;
  const deps = (actor: string | null) => ({
    db,
    sessionActor: async () => (actor === null ? null : { githubId: actor }),
    teamGithubIds: new Set([ADMIN]),
    github: {
      fetch: async (url: string) => {
        lookups += 1;
        if (githubDown) return new Response("down", { status: 500 });
        const id = github.get(
          decodeURIComponent(url.split("/users/")[1] ?? "").toLowerCase(),
        );
        return id === undefined
          ? new Response("{}", { status: 404 })
          : Response.json({ id, login: "x", type: "User" });
      },
      token: undefined,
      apiOrigin: "https://api.github.test",
    },
    now: () => new Date("2026-11-14T12:00:00.000Z"),
  });
  const choose = async (actor: string | null, code: unknown) => {
    const response = await handleReferralCode(
      new Request(api, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ code }),
      }),
      deps(actor),
    );
    if (response === null) throw new Error("Route did not match");
    return {
      status: response.status,
      body: (await response.json()) as { code?: string; error?: string },
    };
  };
  /** The name in use, as the member record reads it. */
  const read = async (actor: string) => ({
    code:
      (
        sqlite
          .query(
            "SELECT code FROM referral_codes WHERE github_id = ? AND retired_at IS NULL",
          )
          .get(actor) as { code: string } | null
      )?.code ?? null,
  });
  const follow = async (code: string, method = "GET") => {
    const response = await referralRedirect(
      new Request(`${origin}/referral/${code}`, { method }),
      db,
    );
    if (response === null) throw new Error("Route did not match");
    return {
      status: response.status,
      location: response.headers.get("location"),
    };
  };
  return {
    db,
    sqlite,
    deps,
    choose,
    read,
    follow,
    lookups: () => lookups,
    githubDown: (value: boolean) => {
      githubDown = value;
    },
  };
}

test("a chosen code forwards to the project form naming the member's GitHub login", async () => {
  const h = harness();
  expect(await h.read(ALICE)).toEqual({ code: null });
  expect(await h.choose(ALICE, "AliceBuilds")).toEqual({
    status: 200,
    body: { code: "AliceBuilds" },
  });
  expect(await h.read(ALICE)).toEqual({ code: "AliceBuilds" });
  // Case does not matter on the link.
  for (const code of ["AliceBuilds", "alicebuilds", "ALICEBUILDS/"])
    expect(await h.follow(code)).toEqual({
      status: 302,
      location: `${origin}/projects/new?ref=alice-gh`,
    });
  // A name nobody holds still reaches the form, without a referrer.
  expect(await h.follow("nobody-here")).toEqual({
    status: 302,
    location: `${origin}/projects/new`,
  });
  expect((await h.follow("AliceBuilds", "POST")).status).toBe(405);
});

test("a name held by another account, in use or replaced, is refused", async () => {
  const h = harness();
  await h.choose(ALICE, "first-name");
  expect(await h.choose(BOB, "FIRST-NAME")).toMatchObject({
    status: 409,
    body: { error: "code_taken" },
  });
  // Alice replaces it: the old link stops forwarding and stays hers.
  expect((await h.choose(ALICE, "second-name")).status).toBe(200);
  expect((await h.follow("first-name")).location).toBe(
    `${origin}/projects/new`,
  );
  expect((await h.follow("second-name")).location).toBe(
    `${origin}/projects/new?ref=alice-gh`,
  );
  expect(await h.choose(BOB, "first-name")).toMatchObject({
    status: 409,
    body: { error: "code_taken" },
  });
  expect(await h.read(BOB)).toEqual({ code: null });
  // Alice may take her old name back, with new capitals.
  expect(await h.choose(ALICE, "First-Name")).toEqual({
    status: 200,
    body: { code: "First-Name" },
  });
  expect((await h.follow("second-name")).location).toBe(
    `${origin}/projects/new`,
  );
  expect((await h.follow("first-name")).location).toBe(
    `${origin}/projects/new?ref=alice-gh`,
  );
});

test("reserved names, GitHub logins of other accounts and team accounts are refused", async () => {
  const h = harness();
  for (const code of ["Slop_Cash", "umia", "the-official-link", "SlopSupport"])
    expect(await h.choose(ALICE, code)).toMatchObject({
      status: 422,
      body: { error: "reserved_code" },
    });
  for (const code of ["ab", "-abc", "abc_", "has space", "a".repeat(33), 7])
    expect(await h.choose(ALICE, code)).toMatchObject({
      status: 422,
      body: { error: "invalid_code" },
    });
  expect(await h.choose(ALICE, "Someone")).toMatchObject({
    status: 409,
    body: { error: "code_is_github_account" },
  });
  expect(await h.choose(ADMIN, "admin-link")).toMatchObject({
    status: 422,
    body: { error: "team_account" },
  });
  expect(await h.read(ALICE)).toEqual({ code: null });
  // A member's own GitHub login is theirs to use.
  expect((await h.choose(ALICE, "alice-gh")).status).toBe(200);
  // An underscore cannot be a GitHub login, so GitHub is not asked.
  const before = h.lookups();
  expect((await h.choose(BOB, "bob_builds")).status).toBe(200);
  expect(h.lookups()).toBe(before);
});

test("an unanswered GitHub lookup refuses the name instead of recording it", async () => {
  const h = harness();
  h.githubDown(true);
  expect((await h.choose(ALICE, "maybe-taken")).status).toBe(502);
  expect(await h.read(ALICE)).toEqual({ code: null });
  h.githubDown(false);
  expect((await h.choose(ALICE, "maybe-taken")).status).toBe(200);
});

test("an account holds a limited number of names and can still return to one", async () => {
  const h = harness();
  for (let index = 1; index <= REFERRAL_CODE_LIMIT; index += 1)
    expect((await h.choose(ALICE, `name-${index}`)).status).toBe(200);
  expect(await h.choose(ALICE, "one-too-many")).toMatchObject({
    status: 409,
    body: { error: "code_limit" },
  });
  // The refused request left the name in use untouched.
  expect(await h.read(ALICE)).toEqual({ code: `name-${REFERRAL_CODE_LIMIT}` });
  expect((await h.choose(ALICE, "name-1")).status).toBe(200);
  // The refused name was never recorded, so another account can take it.
  expect((await h.choose(BOB, "one-too-many")).status).toBe(200);
});

test("the write needs a session and a same-origin JSON request", async () => {
  const h = harness();
  const read = await handleReferralCode(new Request(api), h.deps(ALICE));
  expect(read?.status).toBe(403);
  expect((await h.choose(null, "anyone")).status).toBe(401);
  const crossSite = await handleReferralCode(
    new Request(api, {
      method: "POST",
      headers: {
        origin: "https://elsewhere.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ code: "anyone" }),
    }),
    h.deps(ALICE),
  );
  expect(crossSite?.status).toBe(403);
  expect(await h.read(ALICE)).toEqual({ code: null });
});

test("a closed account's code stops forwarding, and stored rows cannot change owner or be deleted", async () => {
  const h = harness();
  await h.choose(ALICE, "alice-link");
  expect(() =>
    h.sqlite
      .query("UPDATE referral_codes SET github_id = ? WHERE code_key = ?")
      .run(BOB, "alice-link"),
  ).toThrow("referral code owner is permanent");
  expect(() => h.sqlite.query("DELETE FROM referral_codes").run()).toThrow(
    "referral codes are permanent",
  );
  h.sqlite
    .query(
      "UPDATE points_members SET closed_at = ?, public = 0 WHERE github_id = ?",
    )
    .run("2026-11-14T13:00:00.000Z", ALICE);
  expect((await h.follow("alice-link")).location).toBe(
    `${origin}/projects/new`,
  );
});

test("a failed read answers 503 instead of forwarding without the referrer", async () => {
  const h = harness();
  const broken = {
    ...h.db,
    prepare: () => {
      throw new Error("D1 unavailable");
    },
  } as unknown as typeof h.db;
  const response = await referralRedirect(
    new Request(`${origin}/referral/alice-link`),
    broken,
  );
  expect(response?.status).toBe(503);
  expect(response?.headers.get("location")).toBeNull();
});

test("the member record carries the name in use, at sign-in and on later reads", async () => {
  const { db, sqlite } = sqliteD1();
  const now = () => new Date("2026-11-14T12:00:00.000Z");
  const points: PointsDependencies = {
    db,
    now,
    rateLimitSecret: "fixture-referral-code-secret".repeat(2),
    identity: {
      fetch: async () =>
        Response.json({
          audience: "slop-points-web",
          githubActorId: "91002",
          githubNodeId: "U_91002",
          githubLogin: "Link-Member",
        }),
    },
  };
  const join = () =>
    handlePointsApi(
      new Request(`${origin}/api/v1/points/join`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({
          assertion: `slop_assert_v1_${"r".repeat(48)}`,
          public: true,
        }),
      }),
      points,
    );
  const first = await join();
  expect(await first.json()).toMatchObject({ referralCode: null });
  const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0];
  const me = async () =>
    (
      await handlePointsApi(
        new Request(`${origin}/api/v1/points/me`, { headers: { cookie } }),
        points,
      )
    ).json();
  expect(await me()).toMatchObject({ referralCode: null });
  // The real session cookie authorizes the choice.
  const chosen = await handleReferralCode(
    new Request(api, {
      method: "POST",
      headers: { origin, cookie, "content-type": "application/json" },
      body: JSON.stringify({ code: "Link_Member" }),
    }),
    {
      db,
      sessionActor: (request) =>
        sessionGithubActor(request, db, now().toISOString()),
      teamGithubIds: new Set<string>(),
      github: {
        fetch: async () => new Response("{}", { status: 404 }),
        token: undefined,
        apiOrigin: "https://api.github.test",
      },
      now,
    },
  );
  expect(chosen?.status).toBe(200);
  expect(await me()).toMatchObject({ referralCode: "Link_Member" });
  expect(await (await join()).json()).toMatchObject({
    referralCode: "Link_Member",
  });
  const followed = await referralRedirect(
    new Request(`${origin}/referral/link_member`),
    db,
  );
  expect(followed?.headers.get("location")).toBe(
    `${origin}/projects/new?ref=Link-Member`,
  );
  sqlite.close();
});
