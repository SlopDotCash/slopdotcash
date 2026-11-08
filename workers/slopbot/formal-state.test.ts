// PRD12: replay Quint's lease-takeover trace through the production persistence
// boundary and real migrated SQLite. This is not model inference qualification.
import { expect, setSystemTime, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  finishReview,
  REVIEW_LEASE_SECONDS,
  ReviewLeaseLostError,
  recordCalls,
  startReview,
} from "./persistence";

type State = {
  status: string;
  token: number;
  now: number;
  callMade: boolean;
};
test("Quint takeover trace fences the expired worker at the SQLite write boundary", async () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-lease-trace-"));
  const { db, sqlite } = sqliteD1();
  const output = join(directory, "trace.itf.json");
  try {
    const generated = spawnSync(
      "node_modules/.bin/quint",
      [
        "test",
        "formal/models/bot_review_lease.qnt",
        "--backend=typescript",
        "--match=takeoverFencesOldWorkerTest",
        "--seed=20261107",
        `--out-itf=${output}`,
      ],
      { encoding: "utf8", timeout: 30_000 },
    );
    expect(generated.status, generated.stderr).toBe(0);
    const trace = JSON.parse(readFileSync(output, "utf8"), (_key, value) =>
      value && typeof value === "object" && "#bigint" in value
        ? Number(value["#bigint"])
        : value,
    ) as { states: { s: State }[] };
    const row = {
      reviewKey: "formal-lease",
      installationId: 1,
      repositoryId: 2,
      itemKind: "pull_request" as const,
      itemNumber: 3,
      itemNodeId: "PR_formal",
      authorId: 4,
      revision: "a".repeat(40),
      contentDigest: "b".repeat(64),
      policyDigest: "c".repeat(64),
    };
    let previous: State | null = null;
    for (const { s } of trace.states) {
      setSystemTime(
        new Date(
          Date.parse("2026-11-07T00:00:00Z") +
            s.now * REVIEW_LEASE_SECONDS * 1000,
        ),
      );
      if (previous) {
        if (s.token > previous.token) {
          const result = await startReview(db, row, `claim-${s.token}`);
          expect(result).toBe(s.token === 1 ? "new" : "retry");
        } else if (s.callMade && !previous.callMade) {
          await recordCalls(db, row.reviewKey, row.installationId, "triage", [
            {
              routeStep: 0,
              provider: "surplus",
              requestedModel: "claude-opus-5.5",
              servedModel: "claude-opus-5.5",
              priceKey: "surplus/claude-opus-5.5",
              outcome: "ok",
              failure: null,
              usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 },
              providerCostMicroUsd: 1,
              providerRequestId: "local-persistence-evidence",
            },
          ]);
        } else if (
          s.status === "completed" &&
          previous.status !== "completed"
        ) {
          await finishReview(
            db,
            row.reviewKey,
            `claim-${s.token}`,
            "completed",
            { action: "comment" },
          );
        } else if (s.now === previous.now) {
          await expect(
            finishReview(db, row.reviewKey, "claim-1", "completed", {
              action: "close",
            }),
          ).rejects.toBeInstanceOf(ReviewLeaseLostError);
        }
      }
      const stored = sqlite
        .query(
          "SELECT status,claim_token FROM slopbot_reviews WHERE review_key=?",
        )
        .get(row.reviewKey) as { status: string; claim_token: string } | null;
      if (s.status === "absent") expect(stored).toBeNull();
      else
        expect(stored).toEqual({
          status: s.status,
          claim_token: `claim-${s.token}`,
        });
      previous = s;
    }
  } finally {
    setSystemTime();
    sqlite.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
