import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { parseIncompleteAssessments } from "../../src/lib/incomplete-assessments";
import type { RepositoryAccess } from "../../src/lib/project-contracts";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  claimValueRequest,
  finishValueRequest,
} from "../../workers/slopbot/value-processing";
import { handleNotificationsApi } from "./handler";

const AT = "2026-10-30T00:00:00.000Z";
const PATH = "https://slop.cash/api/v1/notifications/incomplete-assessments";
const MAINTAINER = { githubId: "4242", githubLogin: "maintainer" };
const ADMIN = { githubId: "4243", githubLogin: "admin" };
const OTHER = { githubId: "4244", githubLogin: "other" };

function fixture() {
  const { db, sqlite } = sqliteD1();
  const project = applicationManifest("incomplete", "example/repo");
  Object.assign(project.rewardAsset as object, {
    chainId: "1",
    cluster: null,
    decimals: 6,
    verifiedAt: AT,
  });
  const manifest = JSON.stringify(project);
  const manifestHash = createHash("sha256").update(manifest).digest("hex");
  sqlite.run(
    "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('incomplete',1,?,?,'Fixture',?)",
    [manifest, manifestHash, AT],
  );
  sqlite.run(
    "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'paused',1,?,?,?,?)",
    [project.id as string, manifest, manifestHash, AT, AT],
  );
  sqlite.run(
    "INSERT INTO project_repositories(repository_key,project_id) VALUES('example/repo','incomplete')",
  );
  let permission = true;
  let unavailable = false;
  let installation: "installed" | "suspended" | "missing" = "installed";
  let repositoryId = 123456789;
  let afterAccess: (() => void) | undefined;
  const repositoryAccess = async (
    _repository: unknown,
    actor: typeof MAINTAINER,
  ): Promise<RepositoryAccess> => {
    if (unavailable) throw new Error("Synthetic provider outage");
    afterAccess?.();
    if (installation === "missing") return { installation };
    if (installation === "suspended")
      return { installation, installationId: 1 };
    return {
      installation: "installed",
      installationId: 1,
      permission:
        actor.githubId === MAINTAINER.githubId && permission ? "write" : "read",
      roleName: "maintain",
      repository: {
        id: repositoryId,
        node_id: "R_example",
        full_name: "example/repo",
        private: false,
        owner: {
          id: 987654321,
          node_id: "O_example",
          login: "example",
          type: "Organization",
        },
      },
    };
  };
  const inbox = (
    actor: typeof MAINTAINER | null = MAINTAINER,
    path = PATH,
    expected = actor?.githubId,
  ) =>
    handleNotificationsApi(
      new Request(path, {
        headers: expected ? { "x-slop-expected-github-id": expected } : {},
      }),
      {
        db,
        sessionActor: async () => actor,
        now: () => new Date(AT),
        adminGithubIds: new Set([ADMIN.githubId]),
        repositoryAccess,
      },
    );
  const seed = async (id = "delivery-one", number = 7, received = AT) => {
    sqlite.run(
      "INSERT INTO slopbot_deliveries(delivery_id,event,received_at) VALUES(?,'pull_request',?)",
      [id, received],
    );
    sqlite.run(
      "INSERT INTO slopbot_value_requests(delivery_id,installation_id,repository_id,owner,repo,pull_request_number,received_at) VALUES(?,1,123456789,'example','repo',?,?)",
      [id, number, received],
    );
    const claim = await claimValueRequest(db, id, new Date(received));
    if (!claim) throw new Error("Fixture claim refused");
    await finishValueRequest(
      db,
      claim,
      "source-incomplete",
      new Date(Date.parse(received) + 3_600_000),
      new Date(received),
    );
  };
  const list = async (
    actor: typeof MAINTAINER | null = MAINTAINER,
    path = PATH,
  ) => {
    const response = await inbox(actor, path);
    expect(response?.status).toBe(200);
    return parseIncompleteAssessments(await response?.json());
  };
  return {
    db,
    sqlite,
    seed,
    inbox,
    list,
    deny: () => (permission = false),
    outage: () => (unavailable = true),
    installation: (value: typeof installation) => (installation = value),
    replaceRepository: () => (repositoryId = 987654320),
    duringAccess: (callback: () => void) => (afterAccess = callback),
  };
}

test("a source gap appears once in the current maintainer and admin private Inbox", async () => {
  const f = fixture();
  await f.seed();
  const value = await f.list();
  expect(value).toEqual({
    recipientGithubId: MAINTAINER.githubId,
    next: null,
    items: [
      {
        projectId: "incomplete",
        projectName: "Project incomplete",
        repository: "example/repo",
        pullRequest: 7,
        since: AT,
        retryAt: "2026-10-30T01:00:00.000Z",
        running: false,
      },
    ],
  });
  expect(await f.list()).toEqual(value);
  expect((await f.list(ADMIN)).items).toEqual(value.items);
  expect((await f.list(OTHER)).items).toEqual([]);
  expect((await f.inbox(null))?.status).toBe(401);
  expect((await f.inbox(MAINTAINER, PATH, OTHER.githubId))?.status).toBe(403);
  expect(
    f.sqlite.query("SELECT count(*) AS n FROM notifications").get(),
  ).toEqual({ n: 0 });
  f.sqlite.close();
});

test("a source gap survives automatic retry and clears only with a completed source outcome", async () => {
  const f = fixture();
  await f.seed();
  await f.seed("duplicate-delivery");
  expect((await f.list()).items).toHaveLength(1);
  const at = new Date("2026-10-30T01:00:00.000Z");
  const claim = await claimValueRequest(f.db, "delivery-one", at);
  if (!claim) throw new Error("Retry claim refused");
  expect((await f.list()).items[0].running).toBe(true);
  await finishValueRequest(
    f.db,
    claim,
    "retry",
    new Date(at.getTime() + 3_600_000),
    at,
  );
  expect((await f.list()).items).toHaveLength(1);
  const finalAt = new Date("2026-10-30T02:00:00.000Z");
  const finalClaim = await claimValueRequest(f.db, "delivery-one", finalAt);
  if (!finalClaim) throw new Error("Final claim refused");
  await finishValueRequest(f.db, finalClaim, "published", null, finalAt);
  expect((await f.list()).items).toEqual([]);
  expect((await f.list(ADMIN)).items).toEqual([]);
  f.sqlite.close();
});

test("revoked, unavailable or changed project authority does not expose the private queue", async () => {
  const f = fixture();
  await f.seed();
  f.deny();
  expect((await f.list()).items).toEqual([]);
  f.outage();
  expect((await f.inbox())?.status).toBe(503);
  // Admin access is explicit and does not depend on a GitHub outage.
  expect((await f.list(ADMIN)).items).toHaveLength(1);
  f.sqlite.close();
  const changed = fixture();
  await changed.seed();
  changed.duringAccess(() => {
    const current = changed.sqlite
      .query<{ manifest: string }, []>(
        "SELECT manifest FROM projects WHERE id='incomplete'",
      )
      .get();
    const manifest = JSON.stringify({
      ...JSON.parse(current?.manifest ?? "{}"),
      name: "Changed project",
    });
    const hash = createHash("sha256").update(manifest).digest("hex");
    changed.sqlite.run(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES('incomplete',2,?,?,'Fixture change',?)",
      [manifest, hash, AT],
    );
    changed.sqlite.run(
      "UPDATE projects SET revision=2,manifest=?,manifest_sha256=? WHERE id='incomplete'",
      [manifest, hash],
    );
  });
  expect((await changed.inbox())?.status).toBe(503);
  changed.sqlite.close();
});

test("a later completed assessment resolves an exhausted sibling's retained source gap", async () => {
  const f = fixture();
  await f.seed();
  const at = new Date("2026-10-30T01:00:00.000Z");
  const exhausted = await claimValueRequest(f.db, "delivery-one", at);
  if (!exhausted) throw new Error("Exhausted claim refused");
  await finishValueRequest(f.db, exhausted, "attempts-exhausted", null, at);
  expect((await f.list()).items).toHaveLength(1);
  await f.seed("new-source", 7, "2026-10-30T02:00:00.000Z");
  const resolvedAt = new Date("2026-10-30T03:00:00.000Z");
  const completed = await claimValueRequest(f.db, "new-source", resolvedAt);
  if (!completed) throw new Error("Completed claim refused");
  await finishValueRequest(f.db, completed, "published", null, resolvedAt);
  expect((await f.list()).items).toEqual([]);
  // The terminal attempt history stays intact; the later result resolves its queue entry.
  expect(
    f.sqlite
      .query(
        "SELECT outcome FROM slopbot_value_processing WHERE delivery_id='delivery-one'",
      )
      .get(),
  ).toEqual({ outcome: "attempts-exhausted" });
  f.sqlite.close();
});

test("private queue pagination preserves numeric PR ordering without dropping entries", async () => {
  const f = fixture();
  for (let number = 1; number <= 27; number++)
    await f.seed(`delivery-${number}`, number);
  const first = await f.list();
  expect(first.items.map((row) => row.pullRequest)).toEqual(
    Array.from({ length: 25 }, (_, i) => i + 1),
  );
  expect(first.next).not.toBeNull();
  const second = await f.list(
    MAINTAINER,
    `${PATH}?${new URLSearchParams({ after: first.next ?? "" })}`,
  );
  expect(second.items.map((row) => row.pullRequest)).toEqual([26, 27]);
  expect(second.next).toBeNull();
  expect((await f.inbox(MAINTAINER, `${PATH}?after=invalid`))?.status).toBe(
    400,
  );
  f.sqlite.close();
});

test("a new source gap after a completed assessment returns to the Inbox", async () => {
  const f = fixture();
  await f.seed();
  const completedAt = new Date("2026-10-30T01:00:00.000Z");
  const claim = await claimValueRequest(f.db, "delivery-one", completedAt);
  if (!claim) throw new Error("Fixture completion claim refused");
  await finishValueRequest(f.db, claim, "published", null, completedAt);
  expect((await f.list()).items).toEqual([]);
  await f.seed("new-source-gap", 7, "2026-10-30T02:00:00.000Z");
  expect((await f.list()).items).toHaveLength(1);
  expect((await f.list()).items[0].since).toBe("2026-10-30T02:00:00.000Z");
  f.sqlite.close();
});

test("initial Inbox includes the private queue and retains notices during an authority outage", async () => {
  const f = fixture();
  await f.seed();
  const inbox = PATH.replace("/incomplete-assessments", "");
  const response = await f.inbox(MAINTAINER, inbox);
  expect(response?.status).toBe(200);
  const initial = await response?.json();
  expect(initial.incompleteAssessments.items).toHaveLength(1);
  expect(initial.notifications).toEqual([]);
  f.outage();
  const unavailable = await f.inbox(MAINTAINER, inbox);
  expect(unavailable?.status).toBe(200);
  const kept = await unavailable?.json();
  expect(kept.incompleteAssessments).toBeNull();
  expect(kept.notifications).toEqual([]);
  f.sqlite.close();
});

test("an inaccessible or replaced repository is unavailable, never a successful empty queue", async () => {
  for (const state of ["missing", "suspended", "replaced"] as const) {
    const f = fixture();
    await f.seed();
    if (state === "replaced") f.replaceRepository();
    else f.installation(state);
    expect((await f.inbox())?.status).toBe(503);
    expect((await f.list(ADMIN)).items).toHaveLength(1);
    f.sqlite.close();
  }
});
