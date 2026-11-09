// Real SQL projection and HTTP boundary; no GitHub or model calls.
import { afterEach, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { handleSlopbotApi } from "./summary";

const opened: ReturnType<typeof sqliteD1>["sqlite"][] = [];
// The first fixture applies the complete migration history.
setDefaultTimeout(30_000);
afterEach(() => {
  for (const sqlite of opened.splice(0)) sqlite.close();
});
const time = (second: number) => `2026-11-09T00:00:0${second}.000Z`;

function fixture() {
  const { db, sqlite } = sqliteD1();
  opened.push(sqlite);
  const review = (
    key: string,
    repository: number,
    item: string,
    status: "running" | "completed" | "failed" | "skipped",
    second = 1,
    installation = 1,
  ) => {
    sqlite.query(`INSERT INTO slopbot_reviews
      (review_key,installation_id,repository_id,item_kind,item_number,item_node_id,author_id,
       revision,content_digest,policy_digest,status,verdict,created_at,completed_at,claim_token,lease_expires_at)
      VALUES (?,?,?,'pull_request',1,?,77,'revision','private-content-digest','policy',?, ?,?,?,?,?)`)
      .run(key, installation, repository, item, status,
        JSON.stringify({ privateBody: "private-review-body" }), time(second),
        status === "completed" || status === "failed" ? time(second) : null,
        `claim:${key}`, time(9));
  };
  const event = (key: string, repository: number, item: string, action: string, second: number) => {
    sqlite.query(`INSERT INTO slopbot_actions
      (review_key,repository_id,item_node_id,action,detail,created_at) VALUES (?,?,?,?,?,?)`)
      .run(key, repository, item, action, "private-action-detail", time(second));
  };
  const block = (key: string, repository: number, second = 2) => {
    sqlite.query(`INSERT INTO slopbot_budget_blocks
      (review_key,claim_token,job_json,blocked_at,retry_at) VALUES (?,?,?,?,?)`)
      .run(key, `claim:${key}`, JSON.stringify({
        installationId: 1, repositoryId: repository, number: 1, itemKind: "pull_request",
      }), time(second), time(9));
  };
  const read = () => handleSlopbotApi(new Request("https://slop.test/api/v1/slopbot/summary"), db);
  const body = async () => (await read()).json();
  return { db, sqlite, review, event, block, read, body };
}

describe("public Slopbot summary", () => {
  test("empty storage is a cacheable success, while unsupported routes never query it", async () => {
    const t = fixture();
    const empty = await t.read();
    expect(empty.status).toBe(200);
    expect(empty.headers.get("cache-control")).toBe("public, max-age=60");
    expect(await empty.json()).toMatchObject({ repositories: [] });
    const prepare = spyOn(t.db, "prepare");
    try {
      const missing = await handleSlopbotApi(new Request("https://slop.test/api/v1/slopbot/missing"), t.db);
      const wrongMethod = await handleSlopbotApi(new Request("https://slop.test/api/v1/slopbot/summary", { method: "POST" }), t.db);
      expect(missing.status).toBe(404);
      expect(wrongMethod.status).toBe(405);
      expect(wrongMethod.headers.get("allow")).toBe("GET");
      expect(prepare).not.toHaveBeenCalled();
    } finally { prepare.mockRestore(); }
  });

  test("deduplicates items and installations, includes failed-only repositories, and excludes private fields", async () => {
    const t = fixture();
    t.review("a", 20, "PR_hidden-a", "failed", 2, 2);
    t.review("b", 10, "PR_hidden-b", "completed", 1, 2);
    t.review("c", 10, "PR_hidden-b", "completed", 2, 1);
    t.sqlite.query("UPDATE slopbot_reviews SET completed_at=NULL WHERE review_key='c'").run();
    t.review("d", 10, "PR_hidden-c", "running", 3, 3);
    t.review("e", 30, "PR_hidden-d", "skipped", 3, 3);
    t.event("orphan", 40, "PR_hidden-e", "close", 4);
    const body = await t.body();
    expect(body.repositories.map((row: { repositoryId: number }) => row.repositoryId)).toEqual([10, 20]);
    expect(body.repositories[0]).toEqual({
      installationIds: [1, 2], repositoryId: 10, itemsReviewed: 1, itemsBlocked: 0,
      itemsLabeled: 0, itemsClosed: 0, closuresReopened: 0, closuresAppealed: 0, lastActivityAt: time(2),
    });
    expect(body.repositories[1]).toMatchObject({ installationIds: [2], itemsReviewed: 0, itemsBlocked: 0 });
    const bytes = JSON.stringify(body);
    for (const privateValue of ["PR_hidden", "private-review-body", "private-content-digest", "private-action-detail"])
      expect(bytes).not.toContain(privateValue);
  });

  test("a newer row suppresses a budget block by row order even when its timestamp is older", async () => {
    const t = fixture();
    t.review("blocked", 10, "PR_a", "running", 1);
    t.block("blocked", 10, 3);
    expect((await t.body()).repositories[0]).toMatchObject({ itemsBlocked: 1, itemsReviewed: 0 });
    t.review("new-running", 10, "PR_a", "running", 1);
    expect((await t.body()).repositories[0]).toMatchObject({ itemsBlocked: 0, itemsReviewed: 0, lastActivityAt: time(3) });
    t.sqlite.query("UPDATE slopbot_reviews SET status='completed',completed_at=? WHERE review_key='new-running'").run(time(4));
    expect((await t.body()).repositories[0]).toMatchObject({ itemsBlocked: 0, itemsReviewed: 1, lastActivityAt: time(4) });
  });

  test("a changed claim cannot borrow a historical budget block", async () => {
    const t = fixture();
    t.review("blocked", 10, "PR_a", "running");
    t.block("blocked", 10);
    t.sqlite.query("UPDATE slopbot_reviews SET claim_token='replacement-claim' WHERE review_key='blocked'").run();
    expect((await t.body()).repositories[0]).toMatchObject({ itemsBlocked: 0, itemsReviewed: 0 });
  });

  test("reopen and appeal windows use the earliest close, and duplicate actions count one item", async () => {
    const t = fixture();
    t.review("review", 10, "PR_a", "completed");
    t.event("close-later", 10, "PR_a", "close", 4);
    t.event("reopen-before", 10, "PR_a", "human_reopen", 1);
    t.event("close-earlier", 10, "PR_a", "close", 2);
    t.event("appeal-equal", 10, "PR_a", "appeal", 2);
    expect((await t.body()).repositories[0]).toMatchObject({ itemsClosed: 1, closuresReopened: 0, closuresAppealed: 1 });
    t.event("reopen-after-earliest", 10, "PR_a", "human_reopen", 3);
    t.event("label-1", 10, "PR_a", "label", 2);
    t.event("label-2", 10, "PR_a", "label", 3);
    t.event("unclosed-reopen", 10, "PR_b", "human_reopen", 4);
    t.event("late-comment", 10, "PR_b", "comment", 5);
    expect((await t.body()).repositories[0]).toMatchObject({
      itemsClosed: 1, itemsLabeled: 1, closuresReopened: 1, closuresAppealed: 1, lastActivityAt: time(5),
    });
  });

  test("an in-flight response keeps its captured SQL projection", async () => {
    const t = fixture();
    t.review("first", 10, "PR_a", "completed");
    let entered!: () => void;
    const captured = new Promise<void>((resolve) => { entered = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const original = t.db.prepare.bind(t.db);
    const prepare = spyOn(t.db, "prepare").mockImplementation((sql) => {
      const statement = original(sql);
      return new Proxy(statement, {
        get(target, key, receiver) {
          if (key === "first") return async () => {
            const row = await target.first();
            entered();
            await gate;
            return row;
          };
          return Reflect.get(target, key, receiver);
        },
      });
    });
    try {
      const pending = t.read();
      await captured;
      t.review("second", 10, "PR_b", "completed", 2);
      release();
      expect((await (await pending).json()).repositories[0].itemsReviewed).toBe(1);
    } finally {
      release();
      prepare.mockRestore();
    }
    expect((await t.body()).repositories[0].itemsReviewed).toBe(2);
  });

  test("database failures are unavailable and never public-cacheable", async () => {
    const t = fixture();
    const prepare = spyOn(t.db, "prepare").mockImplementation(() => { throw new Error("private storage error"); });
    const logging = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await t.read();
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "unavailable" });
      expect(logging).toHaveBeenCalledWith("Slopbot summary API failure");
    } finally {
      prepare.mockRestore();
      logging.mockRestore();
    }
  });
});
