import { expect, test } from "bun:test";
import type { ProjectRecord } from "../../src/lib/project-contracts";
import { REPO_REQUEST_LIMIT } from "../../src/lib/repo-requests";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { handleRepoRequests } from "./repo-requests";

const origin = "https://slop.cash";
const api = `${origin}/api/v1/repo-requests`;
const ALICE = "900000100";
const BOB = "900000200";
const NEWBIE = "900000300";
const ADMIN = "900000900";

type Answer = {
  repo?: string;
  count?: number;
  flagged?: boolean;
  expiresAt?: string | null;
  error?: string;
  message?: string;
  repos?: { repo: string; count: number; newestAt: string }[];
  mine?: { repo: string; expiresAt: string; listedAs: string | null }[] | null;
};

/** A listed project whose first repository is `path` with GitHub id `id`. */
function listed(id: string, path: string, githubId: string): ProjectRecord {
  return {
    id,
    manifest: {
      authority: { repositoryId: githubId },
      repositories: [{ id: path }],
    },
  } as unknown as ProjectRecord;
}

function harness() {
  const { db, sqlite } = sqliteD1();
  let revision = 0;
  const sources = new Map<string, string>();
  const member = (githubId: string, login: string) =>
    sqlite
      .query(
        "INSERT INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,'2026-11-01T00:00:00.000Z',1)",
      )
      .run(`U_${githubId}`, githubId, login);
  /** One Points revision crediting `githubId`; returns its id. */
  const award = (
    githubId: string,
    category: string,
    amount: number,
    previous: string | null = null,
  ) => {
    revision += 1;
    const id = `rev-${revision}`;
    const source =
      previous === null ? `source-${revision}` : (sources.get(previous) ?? "");
    sources.set(id, source);
    sqlite
      .query(
        "INSERT INTO points_revisions(id,source_key,previous,recorded_at,payload) VALUES(?,?,?,'2026-11-02T00:00:00.000Z',?)",
      )
      .run(
        id,
        source,
        previous,
        JSON.stringify({
          id,
          award: { actor: { id: `U_${githubId}` }, category, amount },
        }),
      );
    return id;
  };
  member(ALICE, "alice-gh");
  member(BOB, "bob-gh");
  member(NEWBIE, "newbie-gh");
  member(ADMIN, "admin-gh");
  award(ALICE, "merged-pull-request", 10);
  award(BOB, "merged-pull-request", 10);
  award(ADMIN, "merged-pull-request", 10);
  // A review only: not merged work.
  award(NEWBIE, "substantive-review", 30);

  type Repo = {
    id: number;
    full_name: string;
    private: boolean;
    fork: boolean;
    archived: boolean;
    owner: { id: number; login: string };
  };
  const repos = new Map<string, Repo>();
  const add = (full: string, id: number, extra: Partial<Repo> = {}) =>
    repos.set(full.toLowerCase(), {
      id,
      full_name: full,
      private: false,
      fork: false,
      archived: false,
      owner: { id: 7, login: full.split("/")[0] },
      ...extra,
    });
  add("acme/widgets", 501);
  add("acme/gadgets", 502);
  add("acme/forked", 503, { fork: true });
  add("acme/old", 504, { archived: true });
  add("acme/secret", 505, { private: true });
  add("alice-gh/mine", 506, {
    owner: { id: Number(ALICE), login: "alice-gh" },
  });
  add("slop/listed", 507);
  for (let n = 0; n < REPO_REQUEST_LIMIT + 1; n += 1)
    add(`many/r${n}`, 600 + n);

  let githubDown = false;
  let lookups = 0;
  let now = new Date("2026-11-22T12:00:00.000Z");
  const projects: ProjectRecord[] = [
    listed("listed-one", "slop/listed", "507"),
  ];
  const deps = (actor: string | null) => ({
    db,
    sessionActor: async () =>
      actor === null
        ? null
        : {
            githubId: actor,
            githubLogin:
              {
                [ALICE]: "alice-gh",
                [BOB]: "bob-gh",
                [NEWBIE]: "newbie-gh",
                [ADMIN]: "admin-gh",
              }[actor] ?? "x",
          },
    teamGithubIds: new Set([ADMIN]),
    projects: { listProjects: async () => projects },
    github: {
      fetch: async (url: string) => {
        lookups += 1;
        if (githubDown) return new Response("down", { status: 500 });
        const path = decodeURIComponent(url.split("/repos/")[1] ?? "");
        const repo = repos.get(path.toLowerCase());
        return repo === undefined
          ? new Response("{}", { status: 404 })
          : Response.json(repo);
      },
      token: undefined,
      apiOrigin: "https://api.github.test",
    },
    now: () => now,
  });
  const post = async (actor: string | null, body: unknown, from = origin) => {
    const response = await handleRepoRequests(
      new Request(api, {
        method: "POST",
        headers: { origin: from, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      deps(actor),
    );
    if (response === null) throw new Error("Route did not match");
    return { status: response.status, body: (await response.json()) as Answer };
  };
  const flag = (actor: string | null, repo: string) =>
    post(actor, { repo, action: "flag" });
  const withdraw = (actor: string | null, repo: string) =>
    post(actor, { repo, action: "withdraw" });
  const read = async (actor: string | null) => {
    const response = await handleRepoRequests(new Request(api), deps(actor));
    if (response === null) throw new Error("Route did not match");
    return {
      status: response.status,
      cache: response.headers.get("cache-control"),
      body: (await response.json()) as Answer,
    };
  };
  return {
    sqlite,
    flag,
    withdraw,
    post,
    read,
    award,
    projects,
    rename: (from: string, to: string) => {
      const repo = repos.get(from.toLowerCase());
      if (!repo) throw new Error("no repo");
      repos.delete(from.toLowerCase());
      repos.set(to.toLowerCase(), { ...repo, full_name: to });
    },
    lookups: () => lookups,
    githubDown: (value: boolean) => {
      githubDown = value;
    },
    advance: (days: number) => {
      now = new Date(now.getTime() + days * 86_400_000);
    },
  };
}

test("members with merged work flag a repo; the public board counts them and names nobody", async () => {
  const h = harness();
  expect(await h.flag(ALICE, "acme/widgets")).toEqual({
    status: 200,
    body: {
      repo: "acme/widgets",
      count: 1,
      flagged: true,
      expiresAt: "2027-02-20T12:00:00.000Z",
    },
  });
  // Case does not matter; GitHub's own spelling is stored.
  expect((await h.flag(BOB, "ACME/Widgets")).body.count).toBe(2);
  expect((await h.flag(BOB, "acme/gadgets")).body.count).toBe(1);
  const board = await h.read(null);
  expect(board.status).toBe(200);
  expect(board.cache).toBe("public, max-age=300");
  expect(board.body).toEqual({
    repos: [
      { repo: "acme/widgets", count: 2, newestAt: "2026-11-22T12:00:00.000Z" },
      { repo: "acme/gadgets", count: 1, newestAt: "2026-11-22T12:00:00.000Z" },
    ],
    mine: null,
  });
  expect(JSON.stringify(board.body)).not.toContain("alice");
  expect(JSON.stringify(board.body)).not.toContain(ALICE);
  const own = await h.read(ALICE);
  expect(own.cache).toBe("private, no-store");
  expect(own.body.mine).toEqual([
    {
      repo: "acme/widgets",
      expiresAt: "2027-02-20T12:00:00.000Z",
      listedAs: null,
    },
  ]);
});

test("accounts without merged work, team accounts and signed-out visitors cannot flag", async () => {
  const h = harness();
  expect(await h.flag(NEWBIE, "acme/widgets")).toEqual({
    status: 403,
    body: {
      error: "no_merged_work",
      message:
        "Flag a repo after your first pull request is merged on a Slop project.",
    },
  });
  expect((await h.flag(ADMIN, "acme/widgets")).body.error).toBe("team_account");
  expect((await h.flag(null, "acme/widgets")).status).toBe(401);
  // A merged award later corrected to zero is not merged work.
  const id = h.award(NEWBIE, "merged-pull-request", 10);
  expect((await h.flag(NEWBIE, "acme/widgets")).status).toBe(200);
  await h.withdraw(NEWBIE, "acme/widgets");
  h.award(NEWBIE, "merged-pull-request", 0, id);
  expect((await h.flag(NEWBIE, "acme/widgets")).body.error).toBe(
    "no_merged_work",
  );
  // No refusal above read GitHub.
  expect(h.lookups()).toBe(1);
});

test("GitHub facts refuse forks, archived, private, missing, listed and own repos", async () => {
  const h = harness();
  const refused = async (repo: string) => (await h.flag(ALICE, repo)).body;
  expect((await refused("acme/forked")).error).toBe("fork");
  expect((await refused("acme/old")).error).toBe("archived");
  expect((await refused("acme/secret")).error).toBe("not_found");
  expect((await refused("acme/nothing")).error).toBe("not_found");
  expect(await refused("slop/listed")).toEqual({
    error: "already_listed",
    message:
      "slop/listed is already on Slop. See https://slop.cash/projects/listed-one.",
  });
  expect((await refused("alice-gh/mine")).error).toBe("own_repo");
  expect((await refused("acme/../x")).error).toBe("invalid_repo");
  expect((await refused("not a repo")).error).toBe("invalid_repo");
  h.githubDown(true);
  expect(await h.flag(ALICE, "acme/widgets")).toEqual({
    status: 503,
    body: {
      error: "github_unavailable",
      message: "GitHub did not answer. Try again.",
    },
  });
  expect(h.sqlite.query("SELECT count(*) n FROM repo_requests").get()).toEqual({
    n: 0,
  });
});

test("a flag expires after 90 days, renews, withdraws and can be flagged again", async () => {
  const h = harness();
  await h.flag(ALICE, "acme/widgets");
  h.advance(89);
  expect((await h.read(null)).body.repos?.[0]?.count).toBe(1);
  // Renewing moves the expiry 90 days from now.
  expect((await h.flag(ALICE, "acme/widgets")).body.expiresAt).toBe(
    "2027-05-20T12:00:00.000Z",
  );
  h.advance(91);
  expect((await h.read(null)).body.repos).toEqual([]);
  expect((await h.read(ALICE)).body.mine).toEqual([]);
  await h.flag(ALICE, "acme/widgets");
  expect(await h.withdraw(ALICE, "acme/widgets")).toEqual({
    status: 200,
    body: { repo: "acme/widgets", count: 0, flagged: false, expiresAt: null },
  });
  expect((await h.withdraw(ALICE, "acme/widgets")).body.error).toBe(
    "not_flagged",
  );
  expect((await h.flag(ALICE, "acme/widgets")).body.count).toBe(1);
  // Rows are kept, one per repository and account.
  expect(h.sqlite.query("SELECT count(*) n FROM repo_requests").get()).toEqual({
    n: 1,
  });
  expect(() => h.sqlite.exec("DELETE FROM repo_requests")).toThrow(
    "repo requests are permanent",
  );
  expect(() =>
    h.sqlite.exec("UPDATE repo_requests SET github_id = '900000200'"),
  ).toThrow("repo request identity is permanent");
});

test("an account holds at most the limit of active flags; a renewal stays allowed", async () => {
  const h = harness();
  for (let n = 0; n < REPO_REQUEST_LIMIT; n += 1)
    expect((await h.flag(ALICE, `many/r${n}`)).status).toBe(200);
  const lookups = h.lookups();
  expect(await h.flag(ALICE, `many/r${REPO_REQUEST_LIMIT}`)).toEqual({
    status: 409,
    body: {
      error: "request_limit",
      message: `You already flag ${REPO_REQUEST_LIMIT} repos. Withdraw one first.`,
    },
  });
  // Refused before reading GitHub.
  expect(h.lookups()).toBe(lookups);
  expect((await h.flag(ALICE, "many/r0")).status).toBe(200);
  await h.withdraw(ALICE, "many/r0");
  expect((await h.flag(ALICE, `many/r${REPO_REQUEST_LIMIT}`)).status).toBe(200);
  // Another account is not affected.
  expect((await h.flag(BOB, "many/r0")).status).toBe(200);
});

test("a renamed repo keeps its flags under its GitHub id; a repo listed later leaves the board", async () => {
  const h = harness();
  await h.flag(ALICE, "acme/widgets");
  h.rename("acme/widgets", "acme/widgets-two");
  h.advance(1);
  expect((await h.flag(BOB, "acme/widgets-two")).body.count).toBe(2);
  expect((await h.read(null)).body.repos).toEqual([
    {
      repo: "acme/widgets-two",
      count: 2,
      newestAt: "2026-11-23T12:00:00.000Z",
    },
  ]);
  // Listed by GitHub id under any name: off the board, marked in "mine".
  h.projects.push(listed("widgets", "acme/widgets-two", "501"));
  expect((await h.read(null)).body.repos).toEqual([]);
  expect((await h.read(ALICE)).body.mine).toEqual([
    {
      repo: "acme/widgets",
      expiresAt: "2027-02-20T12:00:00.000Z",
      listedAs: "widgets",
    },
  ]);
});

test("writes need a same-origin JSON request with exactly repo and action", async () => {
  const h = harness();
  expect(
    (
      await h.post(
        ALICE,
        { repo: "acme/widgets", action: "flag" },
        "https://evil.test",
      )
    ).status,
  ).toBe(403);
  expect((await h.post(ALICE, { repo: "acme/widgets" })).body.error).toBe(
    "invalid_request",
  );
  expect(
    (await h.post(ALICE, { repo: "acme/widgets", action: "boost" })).body.error,
  ).toBe("invalid_request");
  expect(
    (await h.post(ALICE, { repo: "acme/widgets", action: "flag", x: 1 })).body
      .error,
  ).toBe("invalid_request");
  const other = await handleRepoRequests(
    new Request(`${origin}/api/v1/repo-requests/x`),
    {} as never,
  );
  expect(other).toBeNull();
});
