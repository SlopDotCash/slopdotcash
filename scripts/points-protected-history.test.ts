import { expect, test } from "bun:test";
import {
  appendPointAwards,
  emptyPointsJournal,
  type PointAward,
  type PointsJournal,
  pointKey,
} from "../src/lib/points";
import {
  PENALIZED_AUTHOR,
  PROJECT_OWNER,
} from "../tests/penalty-score-fixture";
import { sqliteD1 } from "../tests/sqlite-d1";
import { pointsSql } from "./generate-points";

const AT = "2026-11-05T00:00:00.000Z";
const RECORDED = "2026-11-06T00:00:00.000Z";
const CORRECTED = "2026-11-07T00:00:00.000Z";
function award(actor = PROJECT_OWNER, amount = 10): PointAward {
  return {
    key: pointKey("asi", actor.id, "merged-pull-request", "PR_frozen"),
    actor: { id: actor.id, login: actor.login },
    projectId: "asi",
    category: "merged-pull-request",
    amount,
    occurredAt: AT,
    sourceId: "PR_frozen",
    sourceUrl: "https://github.com/SlopDotCash/asi/pull/22",
    workUnitId: "wu_asi_pr_22",
    provisional: true,
  };
}
function setup(initialAward = award()) {
  const { sqlite } = sqliteD1();
  const initial = appendPointAwards(
    emptyPointsJournal(RECORDED),
    [initialAward],
    "a".repeat(64),
    "slop-score-v2",
    RECORDED,
  );
  const publish = (journal: PointsJournal) =>
    sqlite.transaction(() => {
      for (const statement of pointsSql(journal).trim().split("\n"))
        sqlite.exec(statement);
    })();
  publish(initial);
  const before = () =>
    sqlite
      .query("SELECT id,payload FROM points_revisions ORDER BY rowid")
      .all();
  const correction = (awards: PointAward[]) =>
    appendPointAwards(
      initial,
      awards,
      "b".repeat(64),
      "slop-score-v2",
      CORRECTED,
    );
  const base = (period = "2026-11") =>
    sqlite
      .query(
        "INSERT INTO monthly_reward_bases(project_id,period,manifest,manifest_sha256,source_snapshot_sha256,cap_base,recipient_count,created_at) VALUES('asi',?,'{}',?,?,'100',1,?)",
      )
      .run(period, "c".repeat(64), "d".repeat(64), RECORDED);
  const freeze = (period = "2026-11") => {
    base(period);
    sqlite
      .query(
        "INSERT INTO monthly_payment_runs(project_id,period,trigger,actor_id,allocation_sequence,snapshot,snapshot_sha256,network,vault,total_gross_base,frozen_at,obligations_created_at) VALUES('asi',?,'owner','43',0,'{}',?,'base-mainnet','vault','100',?,NULL)",
      )
      .run(period, "e".repeat(64), RECORDED);
  };
  return { sqlite, initial, publish, before, correction, base, freeze };
}

for (const protection of [
  "frozen",
  "approved-adjustment",
  "paid-direct",
  "reserved-legacy",
  "paid-legacy",
] as const) {
  test(`${protection} refuses provisional recipient redistribution atomically`, () => {
    const f = setup();
    try {
      if (protection === "frozen") f.freeze();
      if (protection === "approved-adjustment") {
        f.base();
        f.sqlite
          .query(
            "INSERT INTO monthly_reward_base_rows VALUES('asi','2026-11','43','project-owner','100',?)",
          )
          .run("f".repeat(64));
        f.sqlite.exec(
          "INSERT INTO monthly_allocation_changes VALUES('asi','2026-11',1,'43','100','42','2026-11-06T01:00:00.000Z')",
        );
      }
      if (protection === "paid-direct")
        f.sqlite
          .query(
            "INSERT INTO payment_direct_transfers VALUES('solana-mainnet','transaction','asi','2026-11','43',?,'project-owner','solana','recipient','100',?,'block','retained',?)",
          )
          .run(PROJECT_OWNER.id, RECORDED, RECORDED);
      if (protection.endsWith("legacy"))
        f.sqlite
          .query(
            "INSERT INTO payment_obligations(id,project_id,github_user_id,network,chain,vault,asset_address,asset_decimals,gross_base,fee_base,source_digest,state,created_at,paid_transaction) VALUES('obligation','asi','43','base-mainnet','base','vault',?,6,'100','2',?,?,?,?)",
          )
          .run(
            "0x" + "1".repeat(40),
            "f".repeat(64),
            protection === "paid-legacy" ? "paid" : "reserved",
            RECORDED,
            protection === "paid-legacy" ? "transaction" : null,
          );
      const retained = f.before();
      expect(() =>
        f.publish(
          f.correction([award(PROJECT_OWNER, 0), award(PENALIZED_AUTHOR, 10)]),
        ),
      ).toThrow("NOT NULL constraint failed: points_batches.coverage");
      expect(f.before()).toEqual(retained);
      expect(
        f.sqlite.query("SELECT count(*) AS n FROM points_batches").get(),
      ).toEqual({ n: 1 });
      expect(
        f.sqlite.query("SELECT count(*) AS n FROM points_staging").get(),
      ).toEqual({ n: 0 });
      // Exact historical replay is valid after a financial freeze.
      f.publish(f.initial);
      expect(f.before()).toEqual(retained);
    } finally {
      f.sqlite.close();
    }
  });
}

for (const mutation of [
  "new-recipient",
  "changed-amount",
  "moved-period",
  "changed-work-unit",
] as const) {
  test(`frozen history refuses ${mutation}`, () => {
    const f = setup();
    try {
      f.freeze();
      const incoming =
        mutation === "new-recipient"
          ? award(PENALIZED_AUTHOR)
          : award(PROJECT_OWNER, mutation === "changed-amount" ? 30 : 10);
      if (mutation === "moved-period")
        incoming.occurredAt = "2026-12-05T00:00:00.000Z";
      if (mutation === "changed-work-unit")
        incoming.workUnitId = "another-unit";
      expect(() => f.publish(f.correction([incoming]))).toThrow(
        mutation === "moved-period"
          ? "Point history moved"
          : "NOT NULL constraint failed: points_batches.coverage",
      );
    } finally {
      f.sqlite.close();
    }
  });
}

test("frozen history accepts GitHub presentation and score-provenance updates without changing economic identity", () => {
  const f = setup();
  try {
    f.freeze();
    const renamed = award();
    renamed.actor = { ...renamed.actor, login: "renamed-project-owner" };
    renamed.sourceUrl = "https://github.com/slopdotcash/asi/pull/22";
    renamed.provisional = false;
    const corrected = f.correction([renamed]);
    f.publish(corrected);
    const rows = f.before() as { payload: string }[];
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[1].payload).award).toEqual(renamed);
    expect(
      f.sqlite.query("SELECT count(*) AS n FROM monthly_payment_runs").get(),
    ).toEqual({ n: 1 });
  } finally {
    f.sqlite.close();
  }
});

for (const change of ["finality", "source"] as const) {
  test(`frozen review ${change} cannot change its grouping`, () => {
    const review = {
      ...award(),
      category: "substantive-review" as const,
      sourceId: "PRR_frozen",
      sourceUrl:
        "https://github.com/SlopDotCash/asi/pull/22#pullrequestreview-1",
      key: pointKey(
        "asi",
        PROJECT_OWNER.id,
        "substantive-review",
        "PRR_frozen",
      ),
    };
    const f = setup(review);
    try {
      f.freeze();
      const changed = { ...review };
      if (change === "finality") changed.provisional = false;
      else
        changed.sourceUrl =
          "https://github.com/SlopDotCash/asi/pull/22#pullrequestreview-2";
      expect(() => f.publish(f.correction([changed]))).toThrow(
        "NOT NULL constraint failed: points_batches.coverage",
      );
    } finally {
      f.sqlite.close();
    }
  });
}

test("unapproved work can rebalance and another frozen period is unaffected", () => {
  const f = setup();
  try {
    f.freeze("2026-10");
    const corrected = f.correction([
      award(PROJECT_OWNER, 0),
      award(PENALIZED_AUTHOR, 10),
    ]);
    f.publish(corrected);
    expect(
      f.sqlite.query("SELECT count(*) AS n FROM points_revisions").get(),
    ).toEqual({ n: 3 });
  } finally {
    f.sqlite.close();
  }
});
