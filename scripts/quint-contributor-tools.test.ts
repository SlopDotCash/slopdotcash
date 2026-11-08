/** The real contributor CLI consumes a generated finite review-frontier trace. */
import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

test("Quint review-frontier trace controls real CLI completion and head-bound dispositions", async () => {
  const directory = mkdtempSync(join(tmpdir(), "slop-contributor-quint-"));
  try {
    const scripts = join(directory, "scripts");
    mkdirSync(scripts);
    for (const name of ["live-report.mjs", "run-receipt.mjs"])
      copyFileSync(
        resolve("skills/project-contributor-template/scripts", name),
        join(scripts, name),
      );
    writeFileSync(
      join(directory, "project.json"),
      JSON.stringify({ repositoryId: "example/project" }),
    );
    const module = (await import(
      pathToFileURL(join(scripts, "live-report.mjs")).href
    )) as {
      createReviewEpoch(
        candidates: unknown[],
        cutoff: string,
        cap: number,
      ): {
        candidates: { number: number; headSha: string }[];
        deferred: { number: number }[];
      };
      completeReviewEpoch(
        epoch: unknown,
        dispositions: unknown[],
      ): {
        complete: boolean;
        allowsNextTier: boolean;
      };
    };
    const candidate = (number: number, after = false) => ({
      number,
      title: `Candidate ${number}`,
      url: `https://github.com/example/project/pull/${number}`,
      headSha: String(number).repeat(40),
      updatedAt: after
        ? "2026-11-07T01:00:00.000Z"
        : "2026-11-06T23:00:00.000Z",
    });
    const epoch = module.createReviewEpoch(
      [candidate(3, true), candidate(2), candidate(1)],
      "2026-11-07T00:00:00.000Z",
      2,
    );
    expect(epoch.candidates.map((entry) => entry.number)).toEqual([1, 2]);
    expect(epoch.deferred.map((entry) => entry.number)).toEqual([3]);
    execFileSync(
      "node",
      [
        resolve("node_modules/@informalsystems/quint/dist/src/cli.js"),
        "test",
        "formal/models/contributor_review_epoch.qnt",
        "--backend=typescript",
        "--seed=1",
        "--match=^staleHeadIsExplicitDispositionTest$",
        `--out-itf=${join(directory, "trace-{test}-{seq}.json")}`,
      ],
      { stdio: "pipe" },
    );
    const trace = JSON.parse(
      readFileSync(
        join(directory, "trace-staleHeadIsExplicitDispositionTest-0.json"),
        "utf8",
      ),
      (_key, value) =>
        value && typeof value === "object" && "#bigint" in value
          ? Number(value["#bigint"])
          : value,
    ) as {
      states: {
        s: { frozen: boolean; done: { "#set": number[] }; permit: boolean };
      }[];
    };
    const disposition = (id: number) =>
      id === 1
        ? {
            number: id,
            expectedHeadSha: "1".repeat(40),
            status: "stale-head",
            currentHeadSha: "a".repeat(40),
          }
        : {
            number: id,
            expectedHeadSha: "2".repeat(40),
            status: "merge",
            recommendationUrl:
              "https://github.com/example/project/pull/2#issuecomment-1",
          };
    for (const { s } of trace.states) {
      if (!s.frozen) continue;
      const actual = module.completeReviewEpoch(
        epoch,
        s.done["#set"].map(disposition),
      );
      expect(actual.complete).toBe(s.done["#set"].length === 2);
      expect(actual.allowsNextTier).toBe(s.done["#set"].length === 2);
    }
    const epochPath = join(directory, "epoch.json");
    const dispositionsPath = join(directory, "dispositions.json");
    writeFileSync(epochPath, JSON.stringify(epoch));
    writeFileSync(dispositionsPath, JSON.stringify([disposition(1)]));
    const args = [
      join(scripts, "live-report.mjs"),
      "--complete-epoch",
      epochPath,
      "--dispositions",
      dispositionsPath,
    ];
    const incomplete = spawnSync("node", args, { encoding: "utf8" });
    expect(incomplete.status).toBe(2);
    expect(JSON.parse(incomplete.stdout).allowsNextTier).toBe(false);
    writeFileSync(
      dispositionsPath,
      JSON.stringify([disposition(1), disposition(2)]),
    );
    const complete = spawnSync("node", args, { encoding: "utf8" });
    expect(complete.status).toBe(0);
    expect(JSON.parse(complete.stdout)).toMatchObject({
      complete: true,
      allowsNextTier: true,
      maxNextTierOutcomes: 1,
    });
    expect(() =>
      module.completeReviewEpoch(epoch, [
        { ...disposition(1), expectedHeadSha: "b".repeat(40) },
      ]),
    ).toThrow("frozen head");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
