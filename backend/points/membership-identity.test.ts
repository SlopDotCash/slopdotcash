import { expect, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { sha256Hex } from "../../workers/identity/crypto";
import { handleIdentityRequest } from "../../workers/identity/handler";
import { D1IdentityPersistence } from "../../workers/identity/persistence";
import { handlePointsApi, sessionGithubActor } from "./handler";

const LEGACY = "MDQ6VXNlcjE=";
const CURRENT = "U_kgDOAAAAAQ";
const JOINED = "2026-10-20T12:00:00.000Z";
const NOW = "2026-11-03T12:00:00.000Z";

function harness(actor: string) {
  const app = sqliteD1();
  const identity = sqliteD1();
  const persistence = new D1IdentityPersistence(identity.db);
  app.sqlite
    .prepare(
      "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,'1','original-login',?,0)",
    )
    .run(actor, JOINED);
  app.sqlite
    .prepare("INSERT INTO points_x_claims VALUES('77',?,?)")
    .run(actor, JOINED);
  app.sqlite
    .prepare("INSERT INTO points_x_awards VALUES(?,'77',?,10)")
    .run(actor, JOINED);
  app.sqlite
    .prepare("INSERT INTO points_x_links VALUES(?,'77','linked-x',?,0)")
    .run(actor, JOINED);
  let serial = 0;
  const deps = {
    db: app.db,
    now: () => new Date(NOW),
    rateLimitSecret: "fixture-membership-identity".repeat(3),
    identity: {
      fetch: (request: Request) =>
        handleIdentityRequest(request, {
          persistence,
          stateEncryptionSecret: "unused-by-assertion-consumption",
          assertionSecret: "unused-by-assertion-consumption",
          githubClientId: "local-membership-fixture",
          now: () => new Date(NOW),
          randomToken: () => "unused-by-assertion-consumption",
          resolveGithubIdentity: async () => null,
        }),
    },
  };
  return {
    ...app,
    async signIn(node: string, reopen = false) {
      const assertion = `slop_assert_v1_${String(++serial).padStart(48, "0")}`;
      await persistence.createAssertion({
        tokenHash: await sha256Hex(assertion),
        githubActorId: "1",
        githubNodeId: node,
        githubLogin: "renamed-login",
        audience: "slop-points-web",
        createdAt: NOW,
        expiresAt: "2026-11-03T12:01:00.000Z",
        consumedAt: null,
      });
      return handlePointsApi(
        new Request("https://slop.cash/api/v1/points/join", {
          method: "POST",
          headers: {
            origin: "https://slop.cash",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            assertion,
            public: true,
            ...(reopen ? { reopen: true } : {}),
          }),
        }),
        deps,
      );
    },
    close() {
      app.sqlite.close();
      identity.sqlite.close();
    },
  };
}

for (const [stored, asserted] of [
  [LEGACY, CURRENT],
  [CURRENT, LEGACY],
]) {
  test(`sign-in keeps membership and linked history when ${stored} returns as ${asserted}`, async () => {
    const { db, sqlite, signIn, close } = harness(stored);
    try {
      const response = await signIn(asserted);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        actor: { id: stored, login: "renamed-login" },
        joinedAt: JOINED,
        public: true,
        welcome: 5,
        socialPoints: 10,
      });
      const cookie = response.headers.get("set-cookie");
      if (!cookie) throw new Error("Sign-in did not set a session cookie");
      expect(
        await sessionGithubActor(
          new Request("https://slop.cash/", { headers: { cookie } }),
          db,
          NOW,
        ),
      ).toEqual({ githubId: "1", githubLogin: "renamed-login" });
      expect(sqlite.query("SELECT * FROM points_members").all()).toEqual([
        {
          actor_id: stored,
          github_id: "1",
          login: "renamed-login",
          joined_at: JOINED,
          public: 1,
          welcome: 5,
          closed_at: null,
        },
      ]);
      expect(sqlite.query("SELECT * FROM points_x_claims").all()).toEqual([
        { x_id: "77", actor_id: stored, claimed_at: JOINED },
      ]);
      expect(sqlite.query("SELECT * FROM points_x_awards").all()).toEqual([
        { actor_id: stored, x_id: "77", awarded_at: JOINED, points: 10 },
      ]);
      expect(sqlite.query("SELECT * FROM points_x_links").all()).toEqual([
        {
          actor_id: stored,
          x_id: "77",
          username: "linked-x",
          verified_at: JOINED,
          public: 1,
        },
      ]);
      expect((await signIn(stored)).status).toBe(200);
      expect(
        sqlite.query("SELECT actor_id FROM points_sessions").all(),
      ).toEqual([{ actor_id: stored }, { actor_id: stored }]);
    } finally {
      close();
    }
  });

  test(`a changed node ID still requires explicit reopening of ${stored}`, async () => {
    const { sqlite, signIn, close } = harness(stored);
    try {
      sqlite
        .prepare("UPDATE points_members SET closed_at=? WHERE actor_id=?")
        .run(JOINED, stored);
      const refused = await signIn(asserted);
      expect(refused.status).toBe(409);
      expect(await refused.json()).toEqual({
        error: "account_closed",
        closedAt: JOINED,
      });
      expect(refused.headers.get("set-cookie")).toBeNull();
      expect(sqlite.query("SELECT * FROM points_sessions").all()).toEqual([]);
      expect(sqlite.query("SELECT public FROM points_x_links").all()).toEqual([
        { public: 0 },
      ]);

      const reopened = await signIn(asserted, true);
      expect(reopened.status).toBe(200);
      expect(await reopened.json()).toMatchObject({
        actor: { id: stored, login: "renamed-login" },
        joinedAt: JOINED,
        welcome: 5,
        socialPoints: 10,
      });
      expect(
        sqlite.query("SELECT actor_id,closed_at FROM points_members").all(),
      ).toEqual([{ actor_id: stored, closed_at: null }]);
      expect(
        sqlite.query("SELECT actor_id FROM points_sessions").all(),
      ).toEqual([{ actor_id: stored }]);
    } finally {
      close();
    }
  });
}
