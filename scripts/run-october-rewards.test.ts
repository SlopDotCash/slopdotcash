import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  appendPointAwards,
  emptyPointsJournal,
  type PointAward,
  pointKey,
} from "../src/lib/points";
import { sha256Hex } from "../src/lib/sha256";
import { octoberRunnerFixture } from "../tests/october-runner-fixture";
import { sqliteD1 } from "../tests/sqlite-d1";
import { pointsSql } from "./generate-points";
import {
  assertOctoberReviewedWeights,
  importOctoberPlan,
  octoberQueryRows,
  preparePrivateOctoberPlan,
  verifyOctoberReadback,
} from "./run-october-rewards";

const now = new Date("2026-11-15T01:00:02.000Z");
const terms = readFileSync(
  new URL("../tests/fixtures/october-approved-terms.txt", import.meta.url),
);
const encode = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
function fixture() {
  const source = octoberRunnerFixture();
  source.packet.projects = source.packet.projects.slice(0, 1);
  source.registry.projects = source.registry.projects.slice(0, 1);
  // Two eligible contributors with no synthetic production authority.
  source.packet.projects[0].identities =
    source.packet.projects[0].identities.slice(0, 2);
  source.packet.projects[0].weights = source.packet.projects[0].weights.slice(
    0,
    2,
  );
  const awards: PointAward[] = source.packet.projects[0].identities.map(
    (actor, i) => ({
      key: pointKey(
        "eliza",
        actor.githubNodeId,
        "merged-pull-request",
        `PR_fixture_${i}`,
      ),
      actor: { id: actor.githubNodeId, login: actor.login },
      projectId: "eliza",
      category: "merged-pull-request",
      amount: (i + 1) * 10,
      occurredAt: "2026-10-15T00:00:00.000Z",
      sourceId: `PR_fixture_${i}`,
      sourceUrl: `https://github.com/elizaOS/eliza/pull/${i + 1}`,
      workUnitId: `PR_fixture_${i}`,
      provisional: false,
    }),
  );
  const journal = appendPointAwards(
    emptyPointsJournal(now.toISOString()),
    awards,
    "a".repeat(64),
    "slop-score-v2",
    now.toISOString(),
  );
  source.packet.evidence.pointsBatch = sha256Hex(JSON.stringify(journal));
  const { sqlite } = sqliteD1();
  const row = source.registry.projects[0];
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,?,?,?,?,?)",
    )
    .run(
      row.id,
      row.revision,
      row.manifestText,
      row.manifestSha256,
      "synthetic",
      now.toISOString(),
    );
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'active',?,?,?,?,?)",
    )
    .run(
      row.id,
      row.revision,
      row.manifestText,
      row.manifestSha256,
      now.toISOString(),
      now.toISOString(),
    );
  sqlite.exec(pointsSql(journal));
  const query = async (sql: string) =>
    sqlite.query(sql).all() as Record<string, unknown>[];
  const options = () => {
    const packetBytes = encode(source.packet);
    return {
      approvedTerms: terms,
      packetBytes,
      reviewedPacketSha256: sha256Hex(packetBytes),
      journal,
      query,
      now,
    };
  };
  return { source, sqlite, journal, query, options };
}

test("private runner rejects missing or failed D1 JSON", () => {
  expect(() => octoberQueryRows("")).toThrow();
  expect(() => octoberQueryRows('[{"success":false,"results":[]}]')).toThrow();
  expect(() => octoberQueryRows("[]")).toThrow();
  expect(octoberQueryRows('[{"success":true,"results":[]}]')).toEqual([]);
});

test("private runner conserves gross, applies once and verifies exact replay", async () => {
  const f = fixture();
  try {
    const { plan } = await preparePrivateOctoberPlan(f.options());
    expect(
      plan.reviews.projects[0].awards.map((award) => award.grossBase),
    ).toEqual(["333333333", "666666667"]);
    const apply = () =>
      f.sqlite
        .transaction(() => {
          for (const sql of plan.sql.trimEnd().split("\n")) f.sqlite.exec(sql);
        })
        .immediate();
    apply();
    await verifyOctoberReadback(plan, f.query);
    apply();
    await preparePrivateOctoberPlan(f.options());
    expect(
      f.sqlite.query("SELECT COUNT(*) n FROM monthly_reward_base_rows").get(),
    ).toEqual({ n: 2 });
    expect(() =>
      f.sqlite.exec("UPDATE monthly_reward_base_rows SET gross_base='1'"),
    ).toThrow("immutable");
    await expect(
      verifyOctoberReadback(plan, async (sql) => {
        const rows = await f.query(sql);
        return sql.includes("SELECT github_user_id")
          ? rows.map((row, i) => (i ? row : { ...row, gross_base: "1" }))
          : rows;
      }),
    ).rejects.toThrow();
  } finally {
    f.sqlite.close();
  }
});

for (const mutation of [
  "weight",
  "missing-actor",
  "eligibility",
  "batch",
  "registry",
  "protected",
  "enforcement",
] as const) {
  test(`private runner refuses ${mutation}`, async () => {
    const f = fixture();
    try {
      if (mutation === "weight")
        f.source.packet.projects[0].weights[0].acceptedWorkPoints++;
      if (mutation === "missing-actor") {
        f.source.packet.projects[0].weights.pop();
        f.source.packet.projects[0].identities.pop();
      }
      if (mutation === "eligibility")
        f.source.packet.projects[0].weights[0].eligible = false;
      if (mutation === "batch")
        f.source.packet.evidence.pointsBatch = "d".repeat(64);
      if (mutation === "registry")
        f.source.packet.projects[0].manifestSha256 = "0".repeat(64);
      if (mutation === "protected")
        f.sqlite
          .query(
            "INSERT INTO payment_direct_transfers VALUES('solana-mainnet','synthetic','eliza','2026-10','7101',?,'fixture-alpha','solana','synthetic','1',?,'synthetic','synthetic',?)",
          )
          .run(btoa("04:User7101"), now.toISOString(), now.toISOString());
      if (mutation === "enforcement") f.source.packet.enforcementGeneration++;
      await expect(preparePrivateOctoberPlan(f.options())).rejects.toThrow();
    } finally {
      f.sqlite.close();
    }
  });
}

test("payout recognition and prior-month work never increase reviewed October weight", async () => {
  const f = fixture();
  try {
    const base = f.journal.revisions[0].award;
    const payoutSource = `payout:2026-10:${base.actor.id}`;
    const withPayout = appendPointAwards(
      f.journal,
      [
        {
          ...base,
          key: pointKey(
            "eliza",
            base.actor.id,
            "payout-received",
            payoutSource,
          ),
          category: "payout-received",
          sourceId: payoutSource,
          sourceUrl: "https://slop.cash/cycles/eliza/2026-10",
          workUnitId: payoutSource,
          amount: 25,
        },
      ],
      "b".repeat(64),
      "verified-payout-v1",
      now.toISOString(),
    );
    const journal = appendPointAwards(
      withPayout,
      [
        {
          ...base,
          key: pointKey("eliza", base.actor.id, "merged-pull-request", "prior"),
          sourceId: "prior",
          workUnitId: "prior-independent",
          occurredAt: "2026-09-15T00:00:00.000Z",
          amount: 1000,
        },
      ],
      "c".repeat(64),
      "slop-score-v2",
      now.toISOString(),
    );
    f.source.packet.evidence.pointsBatch = sha256Hex(JSON.stringify(journal));
    f.sqlite.exec(pointsSql(journal));
    const input = { ...f.options(), journal };
    const { plan } = await preparePrivateOctoberPlan(input);
    assertOctoberReviewedWeights(plan, journal, input.packetBytes);
  } finally {
    f.sqlite.close();
  }
});

test("exact replay needs no current Points fetch, and a lost response is read back", async () => {
  const f = fixture();
  try {
    const { plan } = await preparePrivateOctoberPlan(f.options());
    await importOctoberPlan(
      plan,
      async () => {
        f.sqlite
          .transaction(() => {
            for (const sql of plan.sql.trimEnd().split("\n"))
              f.sqlite.exec(sql);
          })
          .immediate();
        throw new Error("Synthetic lost HTTP response after commit");
      },
      f.query,
    );
    const result = await preparePrivateOctoberPlan({
      ...f.options(),
      journal: async () => {
        throw new Error("Points should not be fetched for exact replay");
      },
    });
    expect(result.alreadyImported).toBe(true);
  } finally {
    f.sqlite.close();
  }
});

test("lost response without a committed proposal remains a failure", async () => {
  const f = fixture();
  try {
    const { plan } = await preparePrivateOctoberPlan(f.options());
    await expect(
      importOctoberPlan(
        plan,
        async () => {
          throw new Error("Synthetic refusal");
        },
        f.query,
      ),
    ).rejects.toThrow("missing or duplicated");
  } finally {
    f.sqlite.close();
  }
});

test("cross-period and before-start deduplication precede the reward window", async () => {
  const f = fixture();
  try {
    const first = f.journal.revisions.find(
      (r) => r.award.actor.id === btoa("04:User7101"),
    )?.award;
    if (!first) throw new Error("Missing synthetic first actor");
    const shared = {
      ...first,
      key: pointKey("eliza", first.actor.id, "merged-pull-request", "old-copy"),
      sourceId: "old-copy",
      occurredAt: "2026-09-15T00:00:00.000Z",
    };
    const journal = appendPointAwards(
      f.journal,
      [shared],
      "d".repeat(64),
      "slop-score-v2",
      now.toISOString(),
    );
    f.source.packet.evidence.pointsBatch = sha256Hex(JSON.stringify(journal));
    f.source.packet.projects[0].weights[0].acceptedWorkPoints = 0;
    f.sqlite.exec(pointsSql(journal));
    await preparePrivateOctoberPlan({ ...f.options(), journal });
    // At a later start, an original on October 15 still suppresses its copy on October 20.
    const original = first;
    const later = {
      ...original,
      key: pointKey(
        "eliza",
        original.actor.id,
        "merged-pull-request",
        "new-copy",
      ),
      sourceId: "new-copy",
      occurredAt: "2026-10-20T00:00:00.000Z",
    };
    const laterJournal = appendPointAwards(
      f.journal,
      [later],
      "e".repeat(64),
      "slop-score-v2",
      now.toISOString(),
    );
    const options = f.options();
    const plan = await preparePrivateOctoberPlan({ ...options, journal });
    const packet = structuredClone(f.source.packet);
    packet.evidence.pointsBatch = sha256Hex(JSON.stringify(laterJournal));
    const packetBytes = encode(packet);
    const policy = JSON.parse(plan.plan.reviews.projects[0].manifest);
    policy.reward.rewardStartAt = "2026-10-16T00:00:00.000Z";
    const changed = {
      ...plan.plan,
      reviews: {
        ...plan.plan.reviews,
        reviewedPacketSha256: sha256Hex(packetBytes),
        evidence: {
          ...plan.plan.reviews.evidence,
          pointsBatch: packet.evidence.pointsBatch,
        },
        projects: plan.plan.reviews.projects.map((project) => ({
          ...project,
          manifest: JSON.stringify(policy),
        })),
      },
    };
    packet.projects[0].weights[1].acceptedWorkPoints = 0;
    const finalBytes = encode(packet);
    changed.reviews.reviewedPacketSha256 = sha256Hex(finalBytes);
    expect(() =>
      assertOctoberReviewedWeights(changed, laterJournal, finalBytes),
    ).not.toThrow();
  } finally {
    f.sqlite.close();
  }
});
