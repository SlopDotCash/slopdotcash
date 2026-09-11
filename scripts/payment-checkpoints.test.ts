import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PAYMENT_RESERVATION_PATH,
  paymentRecordBytes,
} from "../src/lib/payment-reservations";
import { assertRewardAllocationManifest } from "../src/lib/rewards";
import { checkPaymentCheckpointTransition } from "./check-payment-checkpoints";
import * as admission from "./payment-admission";
import { verifyHistoricalPaymentAdmission } from "./payment-admission";
import * as receipts from "./payment-admission-receipt";
import * as checkpoints from "./payment-checkpoints";
import {
  assertCheckpointAppend,
  bootstrapCheckpointDigest,
  buildPaymentCheckpointSnapshot,
  checkpointDigest,
  checkpointSnapshotPath,
  describePaymentCheckpoint,
  PAYMENT_CHECKPOINT_CHAIN_PATH,
  PAYMENT_WORKFLOW_PATH,
  validatePinnedPaymentCheckpoints,
} from "./payment-checkpoints";
import * as github from "./payment-reservation-history";
import {
  parsePaymentCheckpointArguments,
  preparePaymentCheckpoint,
} from "./prepare-payment-checkpoint";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function approvedAllocation() {
  return assertRewardAllocationManifest({
    schemaVersion: "1",
    kind: "reward-allocation",
    projectId: "eliza",
    cycleId: "2026-07",
    status: "approved",
    generatedAt: "2026-08-01T00:00:00.000Z",
    approvedAt: "2026-08-15T00:00:00.000Z",
    contributionWindow: {
      from: "2026-07-07T00:00:00.000Z",
      to: "2026-08-01T00:00:00.000Z",
    },
    review: {
      days: 14,
      lastMaterialChangeAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2026-08-15T00:00:00.000Z",
    },
    currency: "USDC",
    chain: "solana",
    capMinor: "10000000000",
    feeBasisPoints: 100,
    scoringRuleVersion: "gitarmy-v1",
    sourceSnapshotSha256: "b".repeat(64),
    allocations: [
      {
        intentId: "pay_eliza_2026_07_u1",
        actor: { id: "U_1", login: "contributor" },
        score: 100,
        suggestedMinor: "1000000",
        approvedMinor: "1000000",
        state: "approved",
        wallet: {
          address: "11111111111111111111111111111111",
          chain: "solana",
          observedAt: "2026-08-01T00:00:00.000Z",
          sourceCommit: "a".repeat(40),
          sourceUrl: `https://github.com/contributor/contributor/blob/${"a".repeat(40)}/README.md`,
        },
        evidenceEventIds: ["event_1"],
        adjustmentReason: null,
        relatedParty: false,
        platformApproval: null,
      },
    ],
    totals: {
      suggestedMinor: "1000000",
      approvedMinor: "1000000",
      feeMinor: "10000",
    },
  });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "slop-checkpoint-"));
  roots.push(root);
  const git = (args: string[]) =>
    github.reservationGit(root, args).toString().trim();
  git(["init", "-b", "develop"]);
  git(["config", "user.name", "Checkpoint test"]);
  git(["config", "user.email", "checkpoint@example.invalid"]);
  const write = (path: string, value: unknown) => {
    const target = join(root, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, paymentRecordBytes(value));
  };
  const commit = () => {
    git(["add", "."]);
    git(["commit", "-m", "fixture"]);
    return git(["rev-parse", "HEAD"]);
  };
  write(PAYMENT_WORKFLOW_PATH, { trusted: "workflow" });
  write(PAYMENT_RESERVATION_PATH, []);
  write(PAYMENT_CHECKPOINT_CHAIN_PATH, []);
  write("projects/eliza/project.json", { id: "eliza", funding: {} });
  const bootstrap = commit();
  const allocation = approvedAllocation();
  allocation.projectId = "eliza";
  allocation.cycleId = "2026-08";
  allocation.generatedAt = "2026-09-01T00:00:00.000Z";
  allocation.approvedAt = "2026-09-15T00:00:00.000Z";
  allocation.contributionWindow = {
    from: "2026-08-01T00:00:00.000Z",
    to: "2026-09-01T00:00:00.000Z",
  };
  allocation.review = {
    days: 14,
    lastMaterialChangeAt: allocation.generatedAt,
    endsAt: allocation.approvedAt,
  };
  allocation.fundingBasis = {
    cycleId: allocation.cycleId,
    fundingState: "committed",
    instrumentId:
      "squads-v4-vault:solana:Stake11111111111111111111111111111111111111:0:SysvarRent111111111111111111111111111111111",
    monthlyCapMinor: allocation.capMinor,
    committedMinor: allocation.capMinor,
  };
  write("cycles/eliza/2026-08/allocation.json", allocation);
  write("cycles/eliza/2026-08/execution-plan.json", {
    sourceOwner: "SysvarRent111111111111111111111111111111111",
  });
  const row = {
    schemaVersion: "1",
    kind: "payment-reservation",
    projectId: "eliza",
    cycleId: "2026-08",
    instrumentId: allocation.fundingBasis.instrumentId,
    allocationSha256: checkpointDigest(paymentRecordBytes(allocation)),
    policySha256: "a".repeat(64),
    planSha256: "b".repeat(64),
    reservedAt: "2026-09-01T00:00:00.000Z",
    principalMinor: "100",
    feeMinor: "1",
    intentIds: ["intent_test_2026_08"],
  };
  write(PAYMENT_RESERVATION_PATH, [row]);
  write("cycles/old/2026-07/execution-plan.json", {
    capMinor: "50",
    fundingBasis: { instrumentId: row.instrumentId },
  });
  commit();
  rmSync(join(root, "cycles/old"), { recursive: true });
  const checkpoint = commit();
  const snapshot = buildPaymentCheckpointSnapshot(root, checkpoint);
  const pin = describePaymentCheckpoint(
    root,
    snapshot,
    bootstrapCheckpointDigest(bootstrap),
  );
  git(["checkout", "-b", "migration"]);
  write(checkpointSnapshotPath(checkpoint), snapshot);
  write(PAYMENT_CHECKPOINT_CHAIN_PATH, [pin]);
  const head = commit();
  git(["checkout", "develop"]);
  git(["merge", "--no-ff", "migration", "-m", "reviewed migration"]);
  const accepted = git(["rev-parse", "HEAD"]);
  return {
    root,
    git,
    write,
    commit,
    bootstrap,
    checkpoint,
    snapshot,
    pin,
    head,
    accepted,
    row,
  };
}
function liveEvidence(f: ReturnType<typeof fixture>, expired = false) {
  const calls: string[] = [];
  vi.spyOn(github, "reservationGithub").mockImplementation((path) => {
    calls.push(path);
    if (path.includes(`/commits/${f.accepted}/pulls`))
      return [
        {
          number: 1,
          merge_commit_sha: f.accepted,
          merged_at: "2026-09-10T10:00:00Z",
          base: {
            ref: "develop",
            repo: { full_name: github.PAYMENT_REPOSITORY },
          },
          head: { sha: f.head },
        },
      ];
    if (
      path.includes("/actions/workflows/") &&
      path.includes(`head_sha=${f.checkpoint}`)
    )
      return {
        total_count: 1,
        workflow_runs: [
          {
            id: 7,
            run_attempt: 1,
            path: PAYMENT_WORKFLOW_PATH,
            event: "pull_request_target",
            head_sha: f.checkpoint,
            status: "completed",
            conclusion: "success",
            run_started_at: "2026-09-10T09:00:00Z",
            updated_at: "2026-09-10T09:01:00Z",
            repository: { full_name: github.PAYMENT_REPOSITORY },
          },
        ],
      };
    if (
      path.includes("/actions/workflows/") &&
      path.includes(`head_sha=${f.head}`)
    )
      return { total_count: 0, workflow_runs: [] };
    if (path.includes("/actions/runs/7/jobs"))
      return {
        total_count: 1,
        jobs: [
          {
            name: "Trusted payment reservation gate",
            conclusion: "success",
            completed_at: "2026-09-10T09:01:00Z",
          },
        ],
      };
    throw new Error("Old receipt expired or unexpected evidence request");
  });
  vi.spyOn(receipts, "verifyReceipt").mockImplementation(() => {
    if (expired) throw new Error("Admission receipt expired");
  });
  return calls;
}
describe("reviewed payment checkpoint migration", () => {
  it("retains nonempty permanent ledger and deleted historical obligations", () => {
    const f = fixture();
    expect(f.snapshot.reservations).toEqual([f.row]);
    expect(
      f.snapshot.obligationsHistory.some(
        (v) => v.path === "cycles/old/2026-07/execution-plan.json",
      ),
    ).toBe(true);
    expect(
      validatePinnedPaymentCheckpoints(f.root, f.accepted, f.bootstrap, [
        f.pin,
      ]),
    ).toBe(f.checkpoint);
  });
  it("releases verification from expired pre-checkpoint receipts while checking later merges", async () => {
    const f = fixture();
    const calls = liveEvidence(f);
    await expect(
      verifyHistoricalPaymentAdmission(f.root, f.accepted, f.bootstrap, [
        f.pin,
      ]),
    ).resolves.toBeUndefined();
    expect(calls.filter((p) => p.includes("/commits/"))).toEqual([
      `repos/${github.PAYMENT_REPOSITORY}/commits/${f.accepted}/pulls?per_page=100`,
    ]);
    expect(receipts.verifyReceipt).toHaveBeenCalledTimes(1);
  });
  it("supports repeated checkpoints without forgetting earlier reservations or requiring earlier receipts", async () => {
    const f = fixture();
    const snapshot = buildPaymentCheckpointSnapshot(f.root, f.accepted);
    const nextPin = describePaymentCheckpoint(
      f.root,
      snapshot,
      checkpointDigest(paymentRecordBytes(f.pin)),
    );
    f.git(["checkout", "-b", "second-migration"]);
    f.write(checkpointSnapshotPath(f.accepted), snapshot);
    f.write(PAYMENT_CHECKPOINT_CHAIN_PATH, [f.pin, nextPin]);
    const head = f.commit();
    f.git(["checkout", "develop"]);
    f.git([
      "merge",
      "--no-ff",
      "second-migration",
      "-m",
      "second reviewed migration",
    ]);
    const accepted = f.git(["rev-parse", "HEAD"]);
    const calls = liveEvidence({
      ...f,
      checkpoint: f.accepted,
      head,
      accepted,
    });
    await expect(
      verifyHistoricalPaymentAdmission(f.root, accepted, f.bootstrap, [
        f.pin,
        nextPin,
      ]),
    ).resolves.toBeUndefined();
    expect(snapshot.reservations).toEqual([f.row]);
    expect(calls.filter((p) => p.includes("/commits/"))).toEqual([
      `repos/${github.PAYMENT_REPOSITORY}/commits/${accepted}/pulls?per_page=100`,
    ]);
  });
  it("cannot migrate past an expired still-required receipt", async () => {
    const f = fixture();
    liveEvidence(f, true);
    await expect(
      verifyHistoricalPaymentAdmission(f.root, f.accepted, f.bootstrap, [
        f.pin,
      ]),
    ).rejects.toThrow(/No exact successful trusted reservation gate/);
  });
  it.each(["drop", "reprice", "omit-history"])(
    "rejects %s in a checkpoint snapshot even with a recomputed snapshot hash",
    (change) => {
      const f = fixture();
      const snapshot = structuredClone(f.snapshot);
      if (change === "drop") snapshot.reservations = [];
      else if (change === "reprice")
        snapshot.reservations[0].principalMinor = "101";
      else
        snapshot.obligationsHistory = snapshot.obligationsHistory.filter(
          (v) => !v.path.startsWith("cycles/old/"),
        );
      const pin = describePaymentCheckpoint(
        f.root,
        snapshot,
        bootstrapCheckpointDigest(f.bootstrap),
      );
      f.write(checkpointSnapshotPath(f.checkpoint), snapshot);
      const revision = f.commit();
      expect(() =>
        validatePinnedPaymentCheckpoints(f.root, revision, f.bootstrap, [pin]),
      ).toThrow(/hashes/);
    },
  );
  it("rejects dropped canonical reservations and reuse of an issued instrument", () => {
    const f = fixture();
    f.write(PAYMENT_RESERVATION_PATH, []);
    f.commit();
    expect(() =>
      buildPaymentCheckpointSnapshot(f.root, f.git(["rev-parse", "HEAD"])),
    ).toThrow(/append-only/);
    f.write(PAYMENT_RESERVATION_PATH, [
      f.row,
      {
        ...f.row,
        cycleId: "2026-09",
        planSha256: "c".repeat(64),
        allocationSha256: "d".repeat(64),
        intentIds: ["different_intent"],
      },
    ]);
    f.commit();
    expect(() =>
      buildPaymentCheckpointSnapshot(f.root, f.git(["rev-parse", "HEAD"])),
    ).toThrow(/conflict|replay|append-only/);
  });
  it("rejects chain rewrite and retained snapshot deletion at the trusted gate", async () => {
    const f = fixture();
    expect(() =>
      assertCheckpointAppend(
        [f.pin],
        [{ ...f.pin, previousCheckpointSha256: "f".repeat(64) }],
      ),
    ).toThrow(/prefix/);
    rmSync(join(f.root, checkpointSnapshotPath(f.checkpoint)));
    const head = f.commit();
    await expect(
      checkPaymentCheckpointTransition(f.root, f.accepted, head),
    ).rejects.toThrow(/inventory/);
  });
  it("rejects broken ancestry and shallow history", () => {
    const f = fixture();
    expect(() =>
      validatePinnedPaymentCheckpoints(f.root, f.accepted, f.bootstrap, [
        { ...f.pin, revision: "f".repeat(40) },
      ]),
    ).toThrow(/first-parent/);
    const clone = mkdtempSync(join(tmpdir(), "slop-checkpoint-shallow-"));
    roots.push(clone);
    github.reservationGit(f.root, [
      "clone",
      "--depth=1",
      `file://${f.root}`,
      clone,
    ]);
    expect(() => buildPaymentCheckpointSnapshot(clone, f.accepted)).toThrow(
      /non-shallow/,
    );
  });
  it("admits a reviewed nonempty migration using only the old chain and rejects expired proof", async () => {
    const f = fixture();
    vi.spyOn(admission, "requirePaymentBootstrapCheckpoint").mockReturnValue(
      f.bootstrap,
    );
    const verify = vi
      .spyOn(admission, "verifyHistoricalPaymentAdmission")
      .mockResolvedValue(undefined);
    await expect(
      checkPaymentCheckpointTransition(f.root, f.checkpoint, f.accepted),
    ).resolves.toBeUndefined();
    expect(verify).toHaveBeenCalledWith(f.root, f.checkpoint, f.bootstrap, []);
    verify.mockRejectedValue(new Error("Required admission receipt expired"));
    await expect(
      checkPaymentCheckpointTransition(f.root, f.checkpoint, f.accepted),
    ).rejects.toThrow(/expired/);
  });
  it("CLI writes exact review artifacts without changing the deployed chain", async () => {
    const f = fixture();
    vi.spyOn(admission, "requirePaymentBootstrapCheckpoint").mockReturnValue(
      f.bootstrap,
    );
    vi.spyOn(admission, "verifyHistoricalPaymentAdmission").mockResolvedValue(
      undefined,
    );
    vi.spyOn(github, "verifyPaymentAuthority").mockReturnValue(f.checkpoint);
    vi.spyOn(checkpoints, "readCheckpointChain").mockReturnValue([]);
    vi.spyOn(checkpoints, "buildPaymentCheckpointSnapshot").mockReturnValue(
      f.snapshot,
    );
    vi.spyOn(checkpoints, "describePaymentCheckpoint").mockReturnValue(f.pin);
    const outputDirectory = join(f.root, "review-output");
    const result = await preparePaymentCheckpoint({ outputDirectory });
    expect(JSON.parse(readFileSync(result.chainPath, "utf8"))).toEqual([f.pin]);
    expect(JSON.parse(readFileSync(result.snapshotPath, "utf8"))).toEqual(
      f.snapshot,
    );
    expect(checkpoints.DEPLOYED_PAYMENT_CHECKPOINTS).toEqual([]);
    await expect(preparePaymentCheckpoint({ outputDirectory })).rejects.toThrow(
      /already exists/,
    );
  });
  it("CLI rejects invalid arguments and an unconfigured bootstrap", async () => {
    vi.spyOn(admission, "requirePaymentBootstrapCheckpoint").mockImplementation(
      () => {
        throw new TypeError(
          "Configure reviewed bootstrap before checkpoint migration",
        );
      },
    );
    expect(() =>
      parsePaymentCheckpointArguments(["--revision", "a".repeat(40)]),
    ).toThrow(/Usage/);
    await expect(
      preparePaymentCheckpoint(
        parsePaymentCheckpointArguments(["--output-dir", "/unused"]),
      ),
    ).rejects.toThrow(/bootstrap/);
  });
});
