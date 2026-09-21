import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { handlePointsApi } from "../../../backend/points/handler";
import type { D1Database } from "../../../backend/trace/cloudflare-persistence";
import {
  pointsSql,
  retainPublishedHistory,
} from "../../../scripts/generate-points";
import {
  appendPointAwards,
  awardForScore,
  emptyPointsJournal,
} from "../../../src/lib/points";
import { snapshotFixture } from "../../../tests/fixtures";
import { pkceChallenge, sha256Hex } from "../../../workers/identity/crypto";

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync("migrations/0002_slop_identity.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0008_points.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0009_points_social.sql", "utf8"));
  sqlite.exec(readFileSync("migrations/0004_identity_rate_limits.sql", "utf8"));
  const db: D1Database = {
    prepare(query) {
      let args: unknown[] = [];
      const s = {
        bind(...values: unknown[]) {
          args = values;
          return s;
        },
        async first<T>() {
          return (sqlite.prepare(query).get(...(args as never[])) ??
            null) as T | null;
        },
        async run() {
          const r = sqlite.prepare(query).run(...(args as never[]));
          return { success: true, meta: { changes: Number(r.changes) } };
        },
      };
      return s;
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (e) {
        sqlite.exec("ROLLBACK");
        throw e;
      }
    },
  };
  let calls = 0;
  const deps = {
    db,
    rateLimitSecret: "p".repeat(43),
    now: () => new Date("2026-09-21T12:00:00.000Z"),
    identity: {
      async fetch(request: Request) {
        expect(await request.json()).toEqual({ audience: "slop-points-web" });
        calls++;
        return Response.json({
          audience: "slop-points-web",
          githubActorId: "123",
          githubNodeId: "U_points",
          githubLogin: "points-user",
        });
      },
    },
  };
  return { sqlite, deps, calls: () => calls };
}
function post(
  path: string,
  body: unknown,
  cookie?: string,
  origin = "https://slop.cash",
) {
  return new Request(`https://slop.cash/api/v1/points/${path}`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
describe("points persistence and joining", () => {
  it("awards welcome once, retains membership on signout, and binds visibility to the session", async () => {
    const { deps, sqlite } = setup();
    const body = {
      assertion: `slop_assert_v1_${"a".repeat(43)}`,
      public: false,
    };
    const first = await handlePointsApi(post("join", body), deps);
    expect(first.status).toBe(200);
    const cookie = first.headers.get("set-cookie")!.split(";")[0];
    expect(first.headers.get("set-cookie")).toContain("HttpOnly");
    expect((await first.json()).welcome).toBe(5);
    const second = await handlePointsApi(post("join", body), deps);
    expect(second.status).toBe(200);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) n,SUM(welcome) total FROM points_members")
        .get(),
    ).toMatchObject({ n: 1, total: 5 });
    expect(
      (
        await handlePointsApi(
          post(
            "visibility",
            { public: true },
            cookie,
            "https://attacker.example",
          ),
          deps,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await handlePointsApi(
          post("visibility", { public: true }, cookie),
          deps,
        )
      ).status,
    ).toBe(200);
    const publicResult = await handlePointsApi(
      new Request("https://slop.cash/api/v1/points/member?login=points-user"),
      deps,
    );
    expect((await publicResult.json()).actor.id).toBe("U_points");
    await handlePointsApi(post("signout", {}, cookie), deps);
    const me = await handlePointsApi(
      new Request("https://slop.cash/api/v1/points/me", {
        headers: { cookie },
      }),
      deps,
    );
    expect(await me.json()).toBe(null);
    expect(() => sqlite.exec("DELETE FROM points_members")).toThrow(
      /uniqueness/,
    );
  });
  it("rejects client-selected awards and preserves journal rows across retry and correction", async () => {
    const { deps, sqlite, calls } = setup();
    expect(
      (
        await handlePointsApi(
          post("join", { actor: "other", amount: 500 }),
          deps,
        )
      ).status,
    ).toBe(400);
    expect(calls()).toBe(0);
    const now = "2026-09-21T12:00:00.000Z";
    const a = awardForScore(snapshotFixture().ledger[0]);
    let j = appendPointAwards(
      emptyPointsJournal(now),
      [a],
      "a".repeat(64),
      "slop-score-v2",
      now,
    );
    sqlite.exec(pointsSql(j));
    sqlite.exec(pointsSql(j));
    expect(
      sqlite.prepare("SELECT COUNT(*) n FROM points_revisions").get(),
    ).toMatchObject({ n: 1 });
    j = appendPointAwards(
      j,
      [{ ...a, amount: a.amount + 60 }],
      "b".repeat(64),
      "slop-score-v2",
      "2026-09-21T13:00:00.000Z",
    );
    sqlite.exec(pointsSql(j));
    expect(
      sqlite.prepare("SELECT COUNT(*) n FROM points_revisions").get(),
    ).toMatchObject({ n: 2 });
    expect(() => sqlite.exec("DELETE FROM points_revisions")).toThrow(
      /append-only/,
    );
    const result = await handlePointsApi(
      new Request("https://slop.cash/api/v1/points/journal"),
      deps,
    );
    const page = await result.json();
    expect(page.revisions).toEqual(j.revisions);
    expect(page.next).toBe(null);
  });
  it("keeps interrupted uploads invisible and commits a complete replacement atomically", () => {
    const { sqlite } = setup();
    const now = "2026-09-21T12:00:00.000Z";
    const a = awardForScore(snapshotFixture().ledger[0]);
    const initial = appendPointAwards(
      emptyPointsJournal(now),
      [a],
      "a".repeat(64),
      "slop-score-v2",
      now,
    );
    const sql = pointsSql(initial).trim().split("\n");
    sqlite.exec(sql[0]);
    expect(
      sqlite.prepare("SELECT COUNT(*) n FROM points_revisions").get(),
    ).toMatchObject({ n: 0 });
    const corrected = appendPointAwards(
      initial,
      [{ ...a, amount: a.amount + 60 }],
      "b".repeat(64),
      "slop-score-v2",
      "2026-09-21T13:00:00.000Z",
    );
    const replacement = pointsSql(corrected).trim().split("\n");
    sqlite.exec(replacement[0]);
    expect(() => sqlite.exec(replacement.at(-1)!)).toThrow(/incomplete/);
    expect(
      sqlite.prepare("SELECT COUNT(*) n FROM points_revisions").get(),
    ).toMatchObject({ n: 0 });
    expect(retainPublishedHistory(initial, corrected)).toEqual(corrected);
    expect(retainPublishedHistory(corrected, initial)).toEqual(corrected);
    const fork = appendPointAwards(
      initial,
      [{ ...a, amount: a.amount + 90 }],
      "c".repeat(64),
      "slop-score-v2",
      "2026-09-21T13:00:00.000Z",
    );
    expect(() => retainPublishedHistory(corrected, fork)).toThrow(/diverged/);
    sqlite.exec(pointsSql(corrected));
    expect(
      sqlite.prepare("SELECT COUNT(*) n FROM points_revisions").get(),
    ).toMatchObject({ n: 2 });
    expect(
      sqlite.prepare("SELECT COUNT(*) n FROM points_batches").get(),
    ).toMatchObject({ n: 1 });
  });
});

describe("verified X connections", () => {
  it("binds the browser and GitHub session, awards once, preserves privacy and prevents cross-account reuse", async () => {
    const { deps, sqlite } = setup();
    let xUser = { id: "123456789", username: "slop_member" };
    let challenge = "";
    const xFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/token")) {
          const body = new URLSearchParams(String(init?.body));
          expect(await pkceChallenge(body.get("code_verifier")!)).toBe(
            challenge,
          );
          expect(body.get("redirect_uri")).toBe(
            "https://slop.cash/api/v1/points/x/callback",
          );
          return Response.json({
            access_token: "provider-test-token",
            token_type: "bearer",
          });
        }
        if (url.endsWith("/me")) return Response.json({ data: xUser });
        if (url.endsWith("/revoke")) return Response.json({ revoked: true });
        throw new Error("unexpected provider URL");
      },
    );
    const linked = {
      ...deps,
      x: { clientId: "test-client", clientSecret: "test-secret" },
      xFetch,
    };
    const joined = await handlePointsApi(
      post("join", {
        assertion: `slop_assert_v1_${"a".repeat(43)}`,
        public: false,
      }),
      linked,
    );
    const sessionCookie = joined.headers.get("set-cookie")!.split(";")[0];
    const start = async (cookie = sessionCookie) => {
      const response = await handlePointsApi(
        post("x/start", { public: true }, cookie),
        linked,
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("set-cookie")).toContain("SameSite=Lax");
      const authorize = new URL((await response.json()).authorizationUrl);
      expect(authorize.searchParams.get("scope")).toBe("tweet.read users.read");
      expect(authorize.searchParams.get("code_challenge_method")).toBe("S256");
      challenge = authorize.searchParams.get("code_challenge")!;
      const flowCookie = response.headers.get("set-cookie")!.split(";")[0];
      return {
        callback: `https://slop.cash/api/v1/points/x/callback?code=test-code&state=${authorize.searchParams.get("state")}`,
        flowCookie,
      };
    };
    const callback = async (
      flow: Awaited<ReturnType<typeof start>>,
      cookie = flow.flowCookie,
    ) =>
      handlePointsApi(
        new Request(flow.callback, { headers: { cookie } }),
        linked,
      );
    const first = await start();
    expect(
      (
        await callback(first, "__Host-slop_x_flow=" + "z".repeat(43))
      ).headers.get("location"),
    ).toContain("failed");
    expect(xFetch).not.toHaveBeenCalled();
    const results = await Promise.all([callback(first), callback(first)]);
    expect(results.map((r) => r.headers.get("location")).sort()).toEqual([
      "/points?x=connected",
      "/points?x=failed",
    ]);
    expect(xFetch).toHaveBeenCalledTimes(3);
    expect(
      sqlite
        .prepare("SELECT COUNT(*) n,SUM(points) points FROM points_x_awards")
        .get(),
    ).toMatchObject({ n: 1, points: 10 });
    const publicLink = () =>
      handlePointsApi(
        new Request("https://slop.cash/api/v1/points/x/profile?actor=U_points"),
        linked,
      );
    expect(await (await publicLink()).json()).toBeNull();
    await handlePointsApi(
      post("visibility", { public: true }, sessionCookie),
      linked,
    );
    expect(await (await publicLink()).json()).toMatchObject(xUser);
    const people = await handlePointsApi(
      new Request("https://slop.cash/api/v1/points/people"),
      linked,
    );
    expect((await people.json()).people[0]).toMatchObject({
      welcome: 5,
      socialPoints: 10,
      x: xUser,
    });
    const me = await handlePointsApi(
      new Request("https://slop.cash/api/v1/points/me", {
        headers: { cookie: sessionCookie },
      }),
      linked,
    );
    expect((await me.json()).socialPoints).toBe(10);
    await handlePointsApi(post("x/disconnect", {}, sessionCookie), linked);
    expect(await (await publicLink()).json()).toBeNull();
    xUser = { id: "987654321", username: "new_handle" };
    expect((await callback(await start())).headers.get("location")).toContain(
      "connected",
    );
    expect(
      sqlite
        .prepare("SELECT COUNT(*) n,SUM(points) points FROM points_x_awards")
        .get(),
    ).toMatchObject({ n: 1, points: 10 });
    expect(
      sqlite.prepare("SELECT COUNT(*) n FROM points_x_claims").get(),
    ).toMatchObject({ n: 2 });
    const otherToken = "b".repeat(43),
      otherHash = await sha256Hex(otherToken);
    sqlite
      .prepare(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES('U_other','456','other',?,1)",
      )
      .run("2026-09-21T12:00:00.000Z");
    sqlite
      .prepare(
        "INSERT INTO points_sessions(token_hash,actor_id,expires_at) VALUES(?,'U_other','2026-09-21T13:00:00.000Z')",
      )
      .run(otherHash);
    xUser = { id: "123456789", username: "renamed_old" };
    expect(
      (
        await callback(await start(`__Host-slop_points=${otherToken}`))
      ).headers.get("location"),
    ).toContain("failed");
    expect(
      sqlite.prepare("SELECT COUNT(*) n FROM points_x_awards").get(),
    ).toMatchObject({ n: 1 });
    expect(() => sqlite.exec("DELETE FROM points_x_awards")).toThrow(
      /permanent/,
    );
  });
  it("rejects CSRF, signout, provider failures and unsupported configuration without awarding", async () => {
    const { deps, sqlite } = setup();
    const xFetch = vi.fn(async () =>
      Response.json({ error: "denied" }, { status: 403 }),
    );
    const linked = {
      ...deps,
      x: { clientId: "test-client", clientSecret: "test-secret" },
      xFetch,
    };
    const joined = await handlePointsApi(
      post("join", {
        assertion: `slop_assert_v1_${"a".repeat(43)}`,
        public: true,
      }),
      linked,
    );
    const cookie = joined.headers.get("set-cookie")!.split(";")[0];
    expect(
      (
        await handlePointsApi(
          post("x/start", { public: true }, cookie, "https://attacker.example"),
          linked,
        )
      ).status,
    ).toBe(403);
    expect(
      (await handlePointsApi(post("x/start", { public: true }, cookie), deps))
        .status,
    ).toBe(503);
    const first = await handlePointsApi(
      post("x/start", { public: true }, cookie),
      linked,
    );
    const state = new URL(
      (await first.json()).authorizationUrl,
    ).searchParams.get("state");
    const callback = new Request(
      `https://slop.cash/api/v1/points/x/callback?code=test&state=${state}`,
      { headers: { cookie: first.headers.get("set-cookie")!.split(";")[0] } },
    );
    expect(
      (await handlePointsApi(callback.clone(), linked)).headers.get("location"),
    ).toContain("failed");
    expect(
      sqlite.prepare("SELECT COUNT(*) n FROM points_x_awards").get(),
    ).toMatchObject({ n: 0 });
    const second = await handlePointsApi(
      post("x/start", { public: true }, cookie),
      linked,
    );
    const secondState = new URL(
      (await second.json()).authorizationUrl,
    ).searchParams.get("state");
    await handlePointsApi(post("signout", {}, cookie), linked);
    const calls = vi.mocked(xFetch).mock.calls.length;
    const signedOut = await handlePointsApi(
      new Request(
        `https://slop.cash/api/v1/points/x/callback?code=test&state=${secondState}`,
        {
          headers: { cookie: second.headers.get("set-cookie")!.split(";")[0] },
        },
      ),
      linked,
    );
    expect(signedOut.headers.get("location")).toContain("failed");
    expect(xFetch).toHaveBeenCalledTimes(calls);
  });
});
