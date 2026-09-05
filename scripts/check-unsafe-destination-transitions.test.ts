import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createRewardCycleProposal } from "../src/lib/reward-cycle";
import { finalizeRewardAllocation } from "../src/lib/reward-finalization";
import {
  feeForPrincipal,
  unsafeDestinationReportMessage,
} from "../src/lib/rewards";
import { snapshotFixture } from "../tests/fixtures";
import {
  checkUnsafeDestinationTransitions,
  verifyUnsafeDestinationTransitionAuthorities,
} from "./check-unsafe-destination-transitions";
import { applyUnsafeDestinationHold } from "./unsafe-destination-hold";

const PATH = "cycles/eliza/2026-07/proposal.json";
async function fixture(acceptedHold = true) {
  const root = mkdtempSync("/tmp/slop-unsafe-transition-");
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "--initial-branch=develop");
  git("config", "user.name", "Unsafe Transition Test");
  git("config", "user.email", "unsafe-transition@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", join(root, "no-hooks"));
  const snapshot = snapshotFixture();
  snapshot.window.from = "2026-06-28T00:00:00.000Z";
  snapshot.window.to = "2026-08-02T00:00:00.000Z";
  snapshot.source.verificationWindow.from = snapshot.window.from;
  snapshot.source.verificationWindow.to = snapshot.window.to;
  const wallet = {
    address: "11111111111111111111111111111111",
    chain: "solana" as const,
    observedAt: snapshot.window.to,
    sourceActorId: "U_fixture",
    sourceClaimId: "claim_original",
    sourceRecordSha256: "b".repeat(64),
    sourceUrl: "https://api.slop.cash/api/v1/wallet-claims/claim_original",
  };
  const proposal = createRewardCycleProposal({
    cycleId: "2026-07",
    generatedAt: snapshot.window.to,
    projectId: "eliza",
    snapshot,
    sourceSnapshotSha256: "a".repeat(64),
    wallets: new Map([["U_fixture", wallet]]),
  });
  if (proposal.kind !== "reward-allocation") throw new Error("wrong fixture");
  const row = proposal.allocations[0];
  const report = {
    kind: "unsafe-destination" as const,
    projectId: "eliza",
    cycleId: proposal.cycleId,
    intentId: row.intentId,
    suggestedMinor: row.suggestedMinor,
    carryMinor: row.suggestedMinor,
    reportedAt: "2026-08-03T00:00:00.000Z",
    verifiedAt: "2026-08-03T01:00:00.000Z",
    wallet,
    sourceRepository: "finish-line/reports",
    sourceCommit: "c".repeat(40),
  };
  const held = await applyUnsafeDestinationHold({
    proposal,
    report,
    reason: "Contributor reports this original destination is unsafe.",
    now: report.verifiedAt,
    readCommit: async () => ({
      oid: report.sourceCommit,
      message: unsafeDestinationReportMessage(report),
      signature: {
        isValid: true,
        state: "VALID",
        signer: { id: "U_fixture", databaseId: 42 },
      },
    }),
  });
  const write = (path: string, bytes: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  };
  write(PATH, JSON.stringify(acceptedHold ? held : proposal));
  git("add", ".");
  git("commit", "-qm", "accepted unsafe hold");
  const baseSha = git("rev-parse", "HEAD");
  return {
    root,
    git,
    held,
    report,
    wallet,
    snapshot,
    write,
    baseSha,
    head(change: () => void) {
      change();
      git("add", "--all");
      git("commit", "-qm", "untrusted proposal");
      const headSha = git("rev-parse", "HEAD");
      git("switch", "--detach", baseSha);
      return headSha;
    },
    check(headSha: string) {
      return checkUnsafeDestinationTransitions({
        repositoryRoot: root,
        baseSha,
        headSha,
      });
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

describe("trusted unsafe destination Git transitions", () => {
  for (const outcome of [
    "valid",
    "wrong-signer",
    "unsigned",
    "wrong-message",
    "unreachable",
  ] as const) {
    it(`explicit trusted online authorization handles ${outcome} evidence`, async () => {
      const repo = await fixture(false);
      try {
        const headSha = repo.head(() => {
          repo.write(PATH, JSON.stringify(repo.held));
          repo.write(
            "cycles/eliza/2026-07/allocation.json",
            JSON.stringify(
              finalizeRewardAllocation(
                repo.held,
                repo.held.review.endsAt,
                Date.parse(repo.held.review.endsAt),
              ),
            ),
          );
          repo.write(
            "scripts/unsafe-destination-hold.ts",
            "throw new Error('untrusted head must never run');",
          );
        });
        const readCommit = vi.fn(async (repository: string, commit: string) => {
          expect(repository).toBe(repo.report.sourceRepository);
          expect(commit).toBe(repo.report.sourceCommit);
          if (outcome === "unreachable") throw new Error("GitHub unavailable");
          return {
            oid: commit,
            message:
              outcome === "wrong-message"
                ? "forged report"
                : unsafeDestinationReportMessage(repo.report),
            signature: {
              isValid: outcome !== "unsigned",
              state: outcome === "unsigned" ? "UNSIGNED" : "VALID",
              signer: {
                id: outcome === "wrong-signer" ? "U_attacker" : "U_fixture",
                databaseId: 42,
              },
            },
          };
        });
        const result = verifyUnsafeDestinationTransitionAuthorities(
          { repositoryRoot: repo.root, baseSha: repo.baseSha, headSha },
          readCommit,
        );
        if (outcome === "valid")
          await expect(result).resolves.toEqual({
            preservedFiles: 1,
            checkedFiles: 2,
            verifiedReports: 1,
          });
        else await expect(result).rejects.toThrow();
        expect(readCommit).toHaveBeenCalledTimes(1);
      } finally {
        repo.cleanup();
      }
    });
  }

  it("builds and verifies a real held cycle without credentials or GitHub execution", async () => {
    const repo = await fixture();
    try {
      const packageRoot = process.cwd();
      const paths = execFileSync("git", ["ls-files", "-z"], {
        cwd: packageRoot,
        encoding: "utf8",
      })
        .split("\0")
        .filter(Boolean);
      for (const path of paths) {
        mkdirSync(dirname(join(repo.root, path)), { recursive: true });
        cpSync(join(packageRoot, path), join(repo.root, path));
      }
      symlinkSync(
        join(packageRoot, "node_modules"),
        join(repo.root, "node_modules"),
        "dir",
      );
      const snapshot = repo.snapshot;
      for (const [index, event] of snapshot.ledger.entries()) {
        event.scoreThirds = event.points * 3;
        event.workUnitId = `wu_unsafe_packaging_${index}`;
      }
      snapshot.source.cutoffAt = snapshot.window.to;
      const snapshotBytes = JSON.stringify(snapshot);
      repo.held.sourceSnapshotSha256 = createHash("sha256")
        .update(snapshotBytes)
        .digest("hex");
      repo.write(PATH, JSON.stringify(repo.held));
      repo.write("cycles/eliza/2026-07/source-snapshot.json", snapshotBytes);
      repo.git("add", ".");
      repo.git("commit", "-qm", "complete credential-free packaging fixture");
      const bin = join(repo.root, "test-bin");
      repo.write(
        "test-bin/gh",
        "#!/bin/sh\nprintf 'unexpected GitHub execution' >&2\nexit 99\n",
      );
      chmodSync(join(bin, "gh"), 0o755);
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GH_CONFIG_DIR: join(repo.root, "empty-gh-config"),
      };
      for (const key of [
        "GH_TOKEN",
        "GITHUB_TOKEN",
        "GH_ENTERPRISE_TOKEN",
        "GITHUB_ENTERPRISE_TOKEN",
      ])
        delete env[key];
      for (const command of ["cycles:check", "cycles:verify", "build"]) {
        const output = execFileSync("bun", ["run", command], {
          cwd: repo.root,
          env,
          encoding: "utf8",
          timeout: 120_000,
          maxBuffer: 4 * 1024 * 1024,
        });
        expect(output).toContain(
          command === "build" ? "built in" : "validated 1 reward cycle",
        );
      }
      expect(existsSync(join(repo.root, "dist/data/cycles/index.json"))).toBe(
        true,
      );
    } finally {
      repo.cleanup();
    }
  }, 120_000);

  for (const kind of [
    "whole-field-removal",
    "report-removal",
    "report-substitution",
    "report-time-rewrite",
    "hold-removal",
    "unsafe-approval",
    "safe-same-cycle-wallet",
    "row-removal",
    "file-deletion",
    "file-rename",
    "symlink",
    "duplicate-key",
    "oversized",
    "invalid-utf8",
  ] as const) {
    it(`refuses ${kind} using immutable Git blobs without executing head code`, async () => {
      const repo = await fixture();
      try {
        const headSha = repo.head(() => {
          const value = structuredClone(repo.held);
          const row = value.allocations[0];
          if (kind === "whole-field-removal" || kind === "unsafe-approval") {
            delete row.unsafeDestinationReports;
            delete row.hold;
            row.state = "approved";
            row.approvedMinor = row.suggestedMinor;
            value.totals.approvedMinor = row.approvedMinor;
            value.totals.feeMinor = feeForPrincipal(
              row.approvedMinor,
              value.feeBasisPoints,
            );
          }
          if (kind === "report-removal") row.unsafeDestinationReports = [];
          if (kind === "report-substitution") {
            if (!row.unsafeDestinationReports?.[0] || !row.hold)
              throw new Error("missing fixture");
            row.unsafeDestinationReports[0].sourceCommit = "d".repeat(40);
            row.hold.sourceCommit = "d".repeat(40);
          }
          if (kind === "report-time-rewrite") {
            if (!row.unsafeDestinationReports?.[0])
              throw new Error("missing fixture");
            row.unsafeDestinationReports[0].verifiedAt =
              "2026-08-04T00:00:00.000Z";
          }
          if (kind === "hold-removal") delete row.hold;
          if (kind === "safe-same-cycle-wallet") {
            row.wallet = {
              ...repo.wallet,
              address: "Vote111111111111111111111111111111111111111",
              sourceClaimId: "claim_safe",
              sourceUrl:
                "https://api.slop.cash/api/v1/wallet-claims/claim_safe",
              observedAt: "2026-08-04T00:00:00.000Z",
            };
          }
          if (kind === "row-removal") {
            value.allocations = [];
            value.totals.suggestedMinor = "0";
          }
          repo.write(
            PATH,
            kind === "oversized"
              ? " ".repeat(8 * 1024 * 1024 + 1)
              : JSON.stringify(value),
          );
          if (kind === "file-deletion") unlinkSync(join(repo.root, PATH));
          if (kind === "file-rename")
            renameSync(
              join(repo.root, PATH),
              join(repo.root, "cycles/eliza/2026-07/renamed.json"),
            );
          if (kind === "symlink") {
            unlinkSync(join(repo.root, PATH));
            symlinkSync("outside.json", join(repo.root, PATH));
          }
          if (kind === "duplicate-key")
            repo.write(
              PATH,
              JSON.stringify(value).replace(
                '"approvedMinor":"0"',
                '"approvedMinor":"1","approvedMinor":"0"',
              ),
            );
          if (kind === "invalid-utf8")
            writeFileSync(join(repo.root, PATH), Buffer.from([0xff]));
          repo.write(
            "src/lib/rewards.ts",
            `throw new Error("contributor code must not execute");`,
          );
          repo.write(
            "scripts/check-unsafe-destination-transitions.ts",
            `await Bun.write(${JSON.stringify(join(repo.root, "executed"))}, "unsafe");`,
          );
        });
        expect(() => repo.check(headSha)).toThrow();
        expect(existsSync(join(repo.root, "executed"))).toBe(false);
        expect(repo.git("rev-parse", "HEAD")).toBe(repo.baseSha);
      } finally {
        repo.cleanup();
      }
    });
  }

  it("allows finalizing the unchanged held origin and adding a later safe-successor proposal", async () => {
    const repo = await fixture();
    try {
      const snapshot = snapshotFixture();
      snapshot.window.from = "2026-08-01T00:00:00.000Z";
      snapshot.window.to = "2026-09-05T00:00:00.000Z";
      snapshot.source.verificationWindow.from = snapshot.window.from;
      snapshot.source.verificationWindow.to = snapshot.window.to;
      const later = createRewardCycleProposal({
        cycleId: "2026-08",
        generatedAt: snapshot.window.to,
        projectId: "eliza",
        snapshot,
        sourceSnapshotSha256: "e".repeat(64),
        priorAccruedMinor: new Map([["U_fixture", repo.report.carryMinor]]),
        priorActorLogins: new Map([["U_fixture", "finish-line"]]),
        priorUnsafeDestinationReports: new Map([["U_fixture", [repo.report]]]),
        wallets: new Map([
          [
            "U_fixture",
            {
              ...repo.wallet,
              address: "Vote111111111111111111111111111111111111111",
              sourceClaimId: "claim_safe",
              sourceUrl:
                "https://api.slop.cash/api/v1/wallet-claims/claim_safe",
              observedAt: "2026-08-04T00:00:00.000Z",
            },
          ],
        ]),
      });
      if (later.kind !== "reward-allocation") throw new Error("wrong fixture");
      expect(later.allocations[0].state).toBe("proposed");
      const headSha = repo.head(() => {
        repo.write(
          "cycles/eliza/2026-07/allocation.json",
          JSON.stringify(
            finalizeRewardAllocation(
              repo.held,
              repo.held.review.endsAt,
              Date.parse(repo.held.review.endsAt),
            ),
          ),
        );
        repo.write("cycles/eliza/2026-08/proposal.json", JSON.stringify(later));
        repo.held.allocations[0].adjustmentReason =
          "Maintainer clarified the reason while preserving the unsafe hold.";
        repo.write(PATH, JSON.stringify(repo.held));
      });
      expect(repo.check(headSha)).toEqual({
        preservedFiles: 1,
        checkedFiles: 3,
      });
    } finally {
      repo.cleanup();
    }
  });

  it("rejects execution from the contributor checkout", async () => {
    const repo = await fixture();
    try {
      const headSha = repo.head(() =>
        repo.write("README.md", "untrusted head"),
      );
      repo.git("switch", "--detach", headSha);
      expect(() => repo.check(headSha)).toThrow(/exact trusted base/u);
    } finally {
      repo.cleanup();
    }
  });

  for (const cycle of ["2026-07", "2026-08"] as const) {
    it(`rejects a new ${cycle} allocation that omits trusted history and revives the unsafe address`, async () => {
      const repo = await fixture();
      try {
        const headSha = repo.head(() => {
          const value = structuredClone(repo.held);
          const row = value.allocations[0];
          delete row.unsafeDestinationReports;
          delete row.hold;
          row.state = "approved";
          row.approvedMinor = row.suggestedMinor;
          value.totals.approvedMinor = row.approvedMinor;
          value.totals.feeMinor = feeForPrincipal(
            row.approvedMinor,
            value.feeBasisPoints,
          );
          if (cycle === "2026-08") {
            value.cycleId = cycle;
            value.generatedAt = value.review.lastMaterialChangeAt =
              "2026-09-05T00:00:00.000Z";
            value.review.endsAt = "2026-09-19T00:00:00.000Z";
            value.contributionWindow.from = "2026-08-01T00:00:00.000Z";
            value.contributionWindow.to = "2026-09-01T00:00:00.000Z";
            row.intentId = "pay_eliza_2026_08_fixture";
          }
          repo.write(
            `cycles/eliza/${cycle}/allocation.json`,
            JSON.stringify(
              finalizeRewardAllocation(
                value,
                value.review.endsAt,
                Date.parse(value.review.endsAt),
              ),
            ),
          );
          repo.write(
            "src/lib/rewards.ts",
            "throw new Error('head validator must not run');",
          );
        });
        expect(() => repo.check(headSha)).toThrow(
          /retain all trusted unsafe destination history/u,
        );
      } finally {
        repo.cleanup();
      }
    });
  }

  it("keeps the workflow on immutable trusted-base code with read-only permissions", () => {
    const workflow = readFileSync(
      join(
        process.cwd(),
        ".github/workflows/unsafe-destination-transitions.yml",
      ),
      "utf8",
    );
    expect(workflow).toContain("pull_request_target:");
    expect(workflow).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
      "ref: ${{ github.event.pull_request.base.sha }}",
    );
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("contents: read");
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
    expect(workflow).toContain("GH_TOKEN: ${{ github.token }}");
    expect(workflow).toContain(
      "bun --no-install scripts/check-unsafe-destination-transitions.ts",
    );
    expect(workflow).not.toMatch(
      /contents: write|pull-requests: write|environment:|bun install|ref:.*head.sha/u,
    );
    for (const path of ["deploy.yml", "monthly-rewards.yml"]) {
      const caller = readFileSync(
        join(process.cwd(), ".github/workflows", path),
        "utf8",
      );
      expect(caller).toMatch(
        /(?:Validate reward lifecycle|Verify immutable cycle chain)\n\s+run: bun run cycles:check/u,
      );
    }
  });
});
