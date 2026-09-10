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
import eliza from "../projects/eliza/project.json";
import { assertFundingCommitments } from "../src/lib/funding-instruments.mjs";
import { fundingReviewProposalSha256 } from "../src/lib/funding-review-submission";
import {
  assertPaymentReservationLedger,
  assertPaymentReservationTransition,
  draftPaymentReservation,
  PAYMENT_RESERVATION_CHECK,
  PAYMENT_RESERVATION_PATH,
  parsePaymentReservationLedger,
  paymentRecordBytes,
  reservedPlanBytes,
} from "../src/lib/payment-reservations";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { assertRewardAllocationManifest } from "../src/lib/rewards";
import * as checker from "./check-payment-reservations";
import { checkPaymentReservations } from "./check-payment-reservations";
import { loadCanonicalPaymentReservation } from "./load-payment-reservation";
import * as admission from "./payment-admission";
import * as authority from "./payment-reservation-history";
import {
  assertPaymentBranchProtection,
  gitReservationBlob,
  reservationGit,
} from "./payment-reservation-history";
import {
  parsePaymentReservationArguments,
  preparePaymentReservation,
} from "./prepare-payment-reservation";

const RECIPIENT = "11111111111111111111111111111111";
const COMMIT = "a".repeat(40);
const MULTISIG = "xmWqhNJwNL4z4BcDo1Yh7BbStLU7omVafZNmg91y2Vg";
const VAULT = "FTK6ckiPWbe1jAiRtcPCz9sCrvCV6Y6hAJhAU5b9S3nv";
const FUNDER = "Stake11111111111111111111111111111111111111";
const STEWARD = "SysvarRent111111111111111111111111111111111";
const STAMP = "2026-08-15T00:01:00.000Z";
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
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
          address: RECIPIENT,
          chain: "solana",
          observedAt: "2026-08-01T00:00:00.000Z",
          sourceCommit: COMMIT,
          sourceUrl: `https://github.com/contributor/contributor/blob/${COMMIT}/README.md`,
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

async function fixture() {
  const instrument = assertFundingCommitments([
    {
      kind: "squads-v4-vault",
      network: "solana",
      asset: "USDC",
      multisig: MULTISIG,
      vault: VAULT,
      vaultIndex: 0,
      funderMember: FUNDER,
      stewardMember: STEWARD,
      funderActorId: "18633264",
      stewardGithub: { actorId: "42", nodeId: "U_42", login: "independent" },
      monthlyCommitment: {
        cycleId: "2026-07",
        amountMinor: "10000000000",
        accessibility: "unknown",
      },
      effectiveAt: "2026-07-01T00:00:00.000Z",
      deadline: "2026-08-01T00:00:00.000Z",
      replacedAt: null,
    },
  ])[0];
  const policy = {
    schemaVersion: "1",
    kind: "fresh-cycle-payment-policy",
    projectId: "eliza",
    cycleId: "2026-07",
    effectiveAt: "2026-07-31T00:00:00.000Z",
    planningExpiresAt: "2026-09-01T00:00:00.000Z",
    instrumentSha256: await fundingReviewProposalSha256(
      new TextEncoder().encode(JSON.stringify(instrument)),
    ),
    feeRecipient: FUNDER,
  };
  const allocation = approvedAllocation();
  allocation.fundingBasis = {
    cycleId: allocation.cycleId,
    fundingState: "committed",
    instrumentId: `squads-v4-vault:solana:${MULTISIG}:0:${VAULT}`,
    monthlyCapMinor: allocation.capMinor,
    committedMinor: allocation.capMinor,
  };
  const allocationBytes = paymentRecordBytes(allocation);
  const row = await draftPaymentReservation(allocationBytes, policy, STAMP);
  const project = {
    ...eliza,
    funding: {
      ...eliza.funding,
      commitments: [instrument],
      freshCyclePaymentPolicy: policy,
    },
  };
  const root = mkdtempSync(join(tmpdir(), "slop-reservation-"));
  roots.push(root);
  reservationGit(root, ["init", "-b", "develop"]);
  reservationGit(root, ["config", "user.name", "Reservation fixture"]);
  reservationGit(root, ["config", "user.email", "fixture@example.invalid"]);
  function write(path: string, bytes: Uint8Array) {
    const file = join(root, path);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, bytes);
  }
  function commit() {
    reservationGit(root, ["add", "."]);
    reservationGit(root, ["commit", "-m", "fixture"]);
    return reservationGit(root, ["rev-parse", "HEAD"]).toString().trim();
  }
  write("projects/eliza/project.json", paymentRecordBytes(project));
  write("cycles/eliza/2026-07/allocation.json", allocationBytes);
  write(PAYMENT_RESERVATION_PATH, paymentRecordBytes([]));
  const base = commit();
  return { root, base, write, commit, row, policy, project, allocationBytes };
}
describe("global canonical payment reservations", () => {
  it("enables only an explicit matching fresh policy and preserves no-policy refusal", async () => {
    const f = await fixture();
    // This fixture isolates schema policy shape from unrelated current cap changes.
    const project = {
      ...f.project,
      reward: {
        ...f.project.reward,
        monthlyCapMinor: "10000000000",
        monthlyCapDisplay: "$10,000",
      },
    };
    expect(() => assertProjectDefinition(project)).not.toThrow();
    expect(() =>
      assertProjectDefinition({
        ...project,
        reward: {
          ...project.reward,
          paymentMode: "enabled",
          fundingState: "committed",
          committedMinor: "10000000000",
        },
      }),
    ).not.toThrow();
    const { freshCyclePaymentPolicy: _policy, ...fundingWithoutPolicy } =
      project.funding;
    expect(() =>
      assertProjectDefinition({
        ...project,
        funding: fundingWithoutPolicy,
        reward: {
          ...project.reward,
          paymentMode: "enabled",
          fundingState: "committed",
          committedMinor: "10000000000",
        },
      }),
    ).toThrow(/activation|accessibility/);
    expect(() =>
      assertProjectDefinition({
        ...project,
        funding: {
          ...project.funding,
          freshCyclePaymentPolicy: { ...f.policy, cycleId: "2026-08" },
        },
      }),
    ).toThrow(/exact active/);
  });
  it("rejects a valid allocation/reservation for a different vault than the reviewed policy", async () => {
    const f = await fixture();
    const allocation = JSON.parse(new TextDecoder().decode(f.allocationBytes));
    allocation.fundingBasis.instrumentId = `squads-v4-vault:solana:${MULTISIG}:1:${STEWARD}`;
    const bytes = paymentRecordBytes(allocation);
    f.write("cycles/eliza/2026-07/allocation.json", bytes);
    const base = f.commit();
    const wrong = await draftPaymentReservation(bytes, f.policy, STAMP);
    f.write(PAYMENT_RESERVATION_PATH, paymentRecordBytes([wrong]));
    await expect(
      checkPaymentReservations(f.root, base, f.commit(), STAMP),
    ).rejects.toThrow(/exact reviewed instrument/);
  });
  it.each(["overwrite", "retain-both"])(
    "rejects a rebased reservation loser resolving as %s",
    async (mode) => {
      const f = await fixture();
      f.write(PAYMENT_RESERVATION_PATH, paymentRecordBytes([f.row]));
      const winner = f.commit();
      const loser = await draftPaymentReservation(
        f.allocationBytes,
        f.policy,
        "2026-08-15T00:02:00.000Z",
      );
      f.write(
        PAYMENT_RESERVATION_PATH,
        paymentRecordBytes(mode === "overwrite" ? [loser] : [f.row, loser]),
      );
      await expect(
        checkPaymentReservations(
          f.root,
          winner,
          f.commit(),
          "2026-08-15T00:03:00.000Z",
        ),
      ).rejects.toThrow(/append-only|conflict|replay/);
    },
  );
  it("rejects historical use in another project's deleted execution plan", async () => {
    const f = await fixture();
    f.write(
      "cycles/other/2026-06/execution-plan.json",
      paymentRecordBytes({ sourceOwner: VAULT }),
    );
    f.commit();
    rmSync(join(f.root, "cycles/other"), { recursive: true });
    const base = f.commit();
    f.write(PAYMENT_RESERVATION_PATH, paymentRecordBytes([f.row]));
    await expect(
      checkPaymentReservations(f.root, base, f.commit(), STAMP),
    ).rejects.toThrow(/historical monetary use/);
  });
  it("keeps truthful replacement dates across distinct contribution months", async () => {
    const f = await fixture();
    const august = {
      ...f.project.funding.commitments[0],
      effectiveAt: "2026-08-01T00:00:00.000Z",
      deadline: "2026-09-01T00:00:00.000Z",
      replacedAt: "2026-09-24T00:00:00.000Z",
      monthlyCommitment: {
        cycleId: "2026-08",
        amountMinor: "10000000000",
        accessibility: "unknown",
      },
    };
    const september = {
      ...august,
      multisig: STEWARD,
      vault: FUNDER,
      effectiveAt: "2026-09-01T00:00:00.000Z",
      deadline: "2026-10-01T00:00:00.000Z",
      replacedAt: null,
      monthlyCommitment: {
        cycleId: "2026-09",
        amountMinor: "5000000000",
        accessibility: "unknown",
      },
    };
    expect(() => assertFundingCommitments([august, september])).not.toThrow();
    expect(() =>
      assertFundingCommitments([
        august,
        {
          ...september,
          effectiveAt: august.effectiveAt,
          deadline: august.deadline,
          monthlyCommitment: august.monthlyCommitment,
        },
      ]),
    ).toThrow(/overlapping/);
  });
  it("drafts a canonical ledger-only candidate and never releases unsigned plan bytes", async () => {
    const f = await fixture();
    const project = {
      ...f.project,
      reward: {
        ...f.project.reward,
        monthlyCapMinor: "10000000000",
        monthlyCapDisplay: "$10,000",
        paymentMode: "enabled",
        fundingState: "committed",
        committedMinor: "10000000000",
      },
    };
    f.write("projects/eliza/project.json", paymentRecordBytes(project));
    const revision = f.commit();
    const blob = authority.gitReservationBlob;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(STAMP));
    vi.spyOn(authority, "verifyPaymentAuthority").mockReturnValue(revision);
    vi.spyOn(admission, "verifyHistoricalPaymentAdmission").mockResolvedValue(
      undefined,
    );
    vi.spyOn(authority, "gitReservationBlob").mockImplementation(
      (_root, sha, path) => blob(f.root, sha, path),
    );
    vi.spyOn(authority, "gitReservationLedger").mockReturnValue([]);
    vi.spyOn(checker, "assertNoHistoricalInstrumentUse").mockReturnValue(
      undefined,
    );
    const output = join(f.root, "candidate.json");
    const args = parsePaymentReservationArguments(
      ["--project", "eliza", "--cycle", "2026-07", "--output", output],
      STAMP,
    );
    const result = await preparePaymentReservation(args);
    const content = JSON.parse(readFileSync(output, "utf8"));
    expect(result.revision).toBe(revision);
    expect(content).toEqual([f.row]);
    expect(content[0]).not.toHaveProperty("transfers");
    await expect(preparePaymentReservation(args)).rejects.toThrow(
      /already exists/,
    );
    vi.spyOn(authority, "verifyPaymentAuthority")
      .mockReturnValueOnce(revision)
      .mockReturnValue("d".repeat(40));
    await expect(
      preparePaymentReservation({
        ...args,
        outputPath: join(f.root, "moved.json"),
      }),
    ).rejects.toThrow(/moved/);
  });
  it("rejects malformed or future reservation CLI inputs", () => {
    const args = [
      "--project",
      "eliza",
      "--cycle",
      "2026-07",
      "--output",
      "candidate.json",
    ];
    expect(() =>
      parsePaymentReservationArguments(
        [...args, "--reserved-at", "2027-01-01T00:00:00.000Z"],
        STAMP,
      ),
    ).toThrow(/timestamp/);
    expect(() =>
      parsePaymentReservationArguments([...args, "--project", "other"], STAMP),
    ).toThrow(/unique/);
    expect(() =>
      parsePaymentReservationArguments(args.slice(0, 4), STAMP),
    ).toThrow(/output/);
  });
  it("serializes one append and reconstructs identical exact bytes on retry", async () => {
    const f = await fixture();
    f.write(PAYMENT_RESERVATION_PATH, paymentRecordBytes([f.row]));
    const head = f.commit();
    expect(await checkPaymentReservations(f.root, f.base, head, STAMP)).toEqual(
      { prior: 0, current: 1 },
    );
    const first = await reservedPlanBytes(f.row, f.allocationBytes, f.policy);
    const retry = await reservedPlanBytes(f.row, f.allocationBytes, f.policy);
    expect(first).toEqual(retry);
    expect(await fundingReviewProposalSha256(first)).toBe(f.row.planSha256);
    f.write("cycles/eliza/2026-07/execution-plan.json", first);
    const released = f.commit();
    expect(
      await checkPaymentReservations(f.root, head, released, STAMP),
    ).toEqual({ prior: 1, current: 1 });
  });
  it("rejects a stale parallel PR after another reservation wins the canonical append", async () => {
    const f = await fixture();
    reservationGit(f.root, ["checkout", "-b", "first", f.base]);
    f.write(PAYMENT_RESERVATION_PATH, paymentRecordBytes([f.row]));
    const first = f.commit();
    reservationGit(f.root, ["checkout", "-b", "second", f.base]);
    const secondRow = await draftPaymentReservation(
      f.allocationBytes,
      f.policy,
      "2026-08-15T00:02:00.000Z",
    );
    f.write(PAYMENT_RESERVATION_PATH, paymentRecordBytes([secondRow]));
    const second = f.commit();
    expect(
      await checkPaymentReservations(
        f.root,
        f.base,
        first,
        "2026-08-15T00:03:00.000Z",
      ),
    ).toEqual({ prior: 0, current: 1 });
    await expect(
      checkPaymentReservations(
        f.root,
        first,
        second,
        "2026-08-15T00:03:00.000Z",
      ),
    ).rejects.toThrow();
    expect(() =>
      assertPaymentReservationTransition([f.row], [f.row, secondRow]),
    ).toThrow(/conflict|replay/);
  });
  it("rejects allocation edits after reservation and premature plan release", async () => {
    const f = await fixture();
    f.write(
      "cycles/eliza/2026-07/execution-plan.json",
      await reservedPlanBytes(f.row, f.allocationBytes, f.policy),
    );
    await expect(
      checkPaymentReservations(f.root, f.base, f.commit(), STAMP),
    ).rejects.toThrow(/previously merged/);
  });
  it("rejects reservation and plan publication in the same PR", async () => {
    const f = await fixture();
    f.write(PAYMENT_RESERVATION_PATH, paymentRecordBytes([f.row]));
    f.write(
      "cycles/eliza/2026-07/execution-plan.json",
      await reservedPlanBytes(f.row, f.allocationBytes, f.policy),
    );
    await expect(
      checkPaymentReservations(f.root, f.base, f.commit(), STAMP),
    ).rejects.toThrow(/previously merged/);
  });
  it("freezes accepted allocation bytes even for harmless whitespace", async () => {
    const f = await fixture();
    f.write(PAYMENT_RESERVATION_PATH, paymentRecordBytes([f.row]));
    const reserved = f.commit();
    f.write(
      "cycles/eliza/2026-07/allocation.json",
      new TextEncoder().encode(
        `${new TextDecoder().decode(f.allocationBytes)} `,
      ),
    );
    await expect(
      checkPaymentReservations(f.root, reserved, f.commit(), STAMP),
    ).rejects.toThrow(/immutable/);
  });
  it("refuses stale conflicting appends, intent replay, omission and retirement assertions", async () => {
    const f = await fixture();
    const other = {
      ...f.row,
      planSha256: "e".repeat(64),
      allocationSha256: "f".repeat(64),
      cycleId: "2026-08",
    };
    expect(() => assertPaymentReservationLedger([f.row, other])).toThrow(
      /conflict|replay/,
    );
    expect(() =>
      assertPaymentReservationLedger([
        f.row,
        {
          ...other,
          instrumentId: `squads-v4-vault:solana:${FUNDER}:0:${STEWARD}`,
        },
      ]),
    ).toThrow(/conflict|replay/);
    expect(() => assertPaymentReservationTransition([f.row], [])).toThrow(
      /append-only/,
    );
    expect(() =>
      assertPaymentReservationTransition(
        [f.row],
        [{ ...f.row, feeMinor: "0" }],
      ),
    ).toThrow(/append-only/);
    expect(() =>
      assertPaymentReservationLedger([{ ...f.row, state: "retired" }]),
    ).toThrow();
  });
  it("rejects noncanonical duplicate JSON keys and tampered fee/timestamp", async () => {
    const f = await fixture();
    const text = new TextDecoder()
      .decode(paymentRecordBytes([f.row]))
      .replace(
        '"kind": "payment-reservation"',
        '"kind": "payment-reservation", "kind": "payment-reservation"',
      );
    expect(() =>
      parsePaymentReservationLedger(new TextEncoder().encode(text)),
    ).toThrow(/Noncanonical/);
    await expect(
      reservedPlanBytes(
        { ...f.row, feeMinor: "0" },
        f.allocationBytes,
        f.policy,
      ),
    ).rejects.toThrow(/exact/);
    await expect(
      reservedPlanBytes(
        { ...f.row, reservedAt: "2026-08-15T00:02:00.000Z" },
        f.allocationBytes,
        f.policy,
      ),
    ).rejects.toThrow(/exact/);
  });
  it("never accepts local or branch reservation as canonical authority", async () => {
    const f = await fixture();
    reservationGit(f.root, [
      "remote",
      "add",
      "origin",
      "https://example.invalid/other.git",
    ]);
    f.write(PAYMENT_RESERVATION_PATH, paymentRecordBytes([f.row]));
    f.commit();
    await expect(
      loadCanonicalPaymentReservation(f.root, "eliza", "2026-07"),
    ).rejects.toThrow(/canonical origin/);
    expect(
      Array.from(gitReservationBlob(f.root, f.base, PAYMENT_RESERVATION_PATH)),
    ).toEqual(Array.from(paymentRecordBytes([])));
  });
  it("requires actual strict branch protections, review and bound gate; missing means unavailable", () => {
    const protection = {
      enforce_admins: { enabled: true },
      required_status_checks: {
        strict: true,
        checks: [{ context: PAYMENT_RESERVATION_CHECK, app_id: 15368 }],
      },
      required_pull_request_reviews: {
        required_approving_review_count: 1,
        dismiss_stale_reviews: true,
        require_last_push_approval: true,
        bypass_pull_request_allowances: { users: [], teams: [], apps: [] },
      },
      required_conversation_resolution: { enabled: true },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
    };
    expect(() => assertPaymentBranchProtection(protection)).not.toThrow();
    expect(() => assertPaymentBranchProtection(null)).toThrow();
    expect(() =>
      assertPaymentBranchProtection({
        ...protection,
        required_status_checks: {
          ...protection.required_status_checks,
          strict: false,
        },
      }),
    ).toThrow();
    expect(() =>
      assertPaymentBranchProtection({
        ...protection,
        required_pull_request_reviews: {
          ...protection.required_pull_request_reviews,
          bypass_pull_request_allowances: { apps: [1] },
        },
      }),
    ).toThrow();
  });
});
