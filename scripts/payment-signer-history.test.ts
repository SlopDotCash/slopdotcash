import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import eliza from "../projects/eliza/project.json";
import { canonicalFundingDecisionBytes } from "./check-funding-record-pr";
import { buildPaymentCheckpointSnapshot } from "./payment-checkpoints";
import {
  paymentSignerHistoryDigest,
  readPaymentSignerHistory,
} from "./payment-signer-history";
import {
  signerCapabilityState,
  signerReportPath,
} from "./signer-access-ledger";
import {
  type SignerAccessReport,
  signerAccessCommitMessage,
  signerCapabilityMessage,
} from "./verify-signer-access";

const roots: string[] = [];
function base58(bytes: Uint8Array) {
  let n = BigInt(`0x${Buffer.from(bytes).toString("hex")}`);
  let encoded = "";
  while (n) {
    encoded =
      "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[
        Number(n % 58n)
      ] + encoded;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "slop-signer-ledger-test-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Synthetic test");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  const seeds = {
    funder: new Uint8Array(32).fill(1),
    steward: new Uint8Array(32).fill(2),
  };
  const member = base58(ed25519.getPublicKey(seeds.funder));
  const stewardMember = base58(ed25519.getPublicKey(seeds.steward));
  const vault = "Vote111111111111111111111111111111111111111";
  const instrument = {
    kind: "squads-v4-vault",
    network: "solana",
    asset: "USDC",
    multisig: member,
    vault,
    vaultIndex: 0,
    funderActorId: "18633264",
    funderMember: member,
    stewardMember,
    stewardGithub: {
      actorId: "42",
      nodeId: "U_fixture_42",
      login: "independent-fixture",
    },
    monthlyCommitment: {
      cycleId: "2026-09",
      amountMinor: "5000000",
      accessibility: "unknown",
    },
    effectiveAt: "2026-09-01T00:00:00.000Z",
    deadline: "2026-10-01T00:00:00.000Z",
    replacedAt: null,
  };
  const write = async (path: string, bytes: string) => {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), bytes);
  };
  await write(
    "projects/eliza/project.json",
    JSON.stringify({
      ...eliza,
      reward: {
        ...eliza.reward,
        fundingState: "committed",
        committedMinor: "5000000",
        paymentMode: "disabled",
      },
      funding: { ...eliza.funding, commitments: [instrument] },
    }),
  );
  const commit = () => {
    git("add", "-A");
    git("commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  };
  const baseSha = commit();
  const report: SignerAccessReport = {
    kind: "slop-signer-access",
    schemaVersion: "1",
    projectId: "eliza",
    manifestRevision: baseSha,
    cycleId: "2026-09",
    instrumentId: `squads-v4-vault:solana:${member}:0:${vault}`,
    actorId: "18633264",
    role: "funder",
    member,
    capability: "lost-access",
    reportedAt: "2026-09-05T20:00:00.000Z",
    expiresAt: null,
    reason: "Synthetic signer lost access.",
    memberSignature: null,
    sourceRepository: "example/evidence",
    sourceCommit: "b".repeat(40),
  };
  const authenticated = new Map<string, SignerAccessReport>();
  const add = async (value = report) => {
    authenticated.set(value.sourceCommit, structuredClone(value));
    await write(signerReportPath(value), canonicalFundingDecisionBytes(value));
  };
  const positive = (
    role: "funder" | "steward",
    source: string,
    reportedAt = report.reportedAt,
  ): SignerAccessReport => {
    const value: SignerAccessReport = {
      ...report,
      reportedAt,
      role,
      actorId: role === "funder" ? "18633264" : "42",
      member: role === "funder" ? member : stewardMember,
      capability: "can-sign",
      sourceCommit: source.repeat(40),
      expiresAt: "2026-09-06T20:00:00.000Z",
      memberSignature: null,
    };
    value.memberSignature = Buffer.from(
      ed25519.sign(
        new TextEncoder().encode(signerCapabilityMessage(value)),
        seeds[role],
      ),
    ).toString("base64");
    return value;
  };
  const readCommit = async (_repository: string, source: string) => {
    const value = authenticated.get(source);
    if (!value) throw new Error("missing synthetic signature authority");
    return {
      oid: value.sourceCommit,
      message: signerAccessCommitMessage(value),
      signature: {
        isValid: true,
        state: "VALID",
        signer: { databaseId: Number(value.actorId), id: "U_fixture_42" },
      },
    };
  };
  const input = () => ({
    root,
    baseSha,
    headSha: git("rev-parse", "HEAD"),
    now: "2026-09-06T00:00:00.000Z",
    readCommit,
  });
  return { root, git, write, commit, report, add, input, positive };
}

describe("payment signer full history", () => {
  it("returns a branded loss-preserving ledger and exact canonical checkpoint hash", async () => {
    const f = await fixture();
    await f.add();
    const first = f.commit();
    await f.add(f.positive("funder", "c"));
    await f.add(f.positive("steward", "d"));
    const head = f.commit();
    const result = await readPaymentSignerHistory({
      ...f.input(),
      baseSha: head,
    });
    expect(
      signerCapabilityState(result.ledger, f.report, f.input().now).state,
    ).toBe("inaccessible");
    expect(
      result.entries.find((e) => e.path === signerReportPath(f.report)),
    ).toEqual({
      path: signerReportPath(f.report),
      sha256: createHash("sha256")
        .update(canonicalFundingDecisionBytes(f.report))
        .digest("hex"),
      firstAcceptedRevision: first,
    });
    const snapshot = buildPaymentCheckpointSnapshot(f.root, head);
    expect(snapshot.signerHistory).toEqual(result.entries);
    expect(paymentSignerHistoryDigest(snapshot.signerHistory)).toBe(
      result.signerHistorySha256,
    );
    expect(result.signerHistorySha256).toBe(
      createHash("sha256")
        .update(
          JSON.stringify({
            kind: "slop-payment-signer-history",
            schemaVersion: 1,
            entries: result.entries,
          }),
        )
        .digest("hex"),
    );
    await f.write("unrelated.txt", "unrelated");
    const next = f.commit();
    const unchanged = await readPaymentSignerHistory({
      ...f.input(),
      baseSha: next,
    });
    expect(unchanged.signerHistorySha256).toBe(result.signerHistorySha256);
  });
  it("accepts additions, ignores dirty bytes, and fetches each immutable source once", async () => {
    const f = await fixture();
    await f.add();
    const baseSha = f.commit();
    await f.add(f.positive("funder", "c"));
    const headSha = f.commit();
    await f.write(signerReportPath(f.report), "dirty noncanonical bytes");
    const readCommit = vi.fn(f.input().readCommit);
    const result = await readPaymentSignerHistory({
      ...f.input(),
      baseSha,
      headSha,
      readCommit,
    });
    expect(result.entries).toHaveLength(2);
    expect(result.ledger.headSha).toBe(headSha);
    expect(result.ledger.baseSha).toBe(baseSha);
    expect(readCommit).toHaveBeenCalledTimes(2);
    expect(
      signerCapabilityState(result.ledger, f.report, f.input().now).state,
    ).toBe("inaccessible");
  });
  it.each(["delete", "rewrite", "delete-restore"])(
    "rejects accepted %s even when base equals head",
    async (change) => {
      const f = await fixture();
      await f.add();
      f.commit();
      if (change === "rewrite")
        await f.write(
          signerReportPath(f.report),
          canonicalFundingDecisionBytes({ ...f.report, reason: "rewritten" }),
        );
      else f.git("rm", signerReportPath(f.report));
      f.commit();
      if (change === "delete-restore") {
        await f.add();
        f.commit();
      }
      const head = f.input().headSha;
      await expect(
        readPaymentSignerHistory({ ...f.input(), baseSha: head }),
      ).rejects.toThrow("append-only");
    },
  );
  it("rejects proposed removal", async () => {
    const f = await fixture();
    await f.add();
    const base = f.commit();
    f.git("rm", signerReportPath(f.report));
    f.commit();
    await expect(
      readPaymentSignerHistory({ ...f.input(), baseSha: base }),
    ).rejects.toThrow("append-only");
  });
  it("authenticates historical loss even if it was later deleted", async () => {
    const f = await fixture();
    await f.add();
    f.commit();
    f.git("rm", signerReportPath(f.report));
    const head = f.commit();
    const readCommit = vi.fn(async () => {
      throw new Error("historical authority unavailable");
    });
    await expect(
      readPaymentSignerHistory({ ...f.input(), baseSha: head, readCommit }),
    ).rejects.toThrow("historical authority unavailable");
    expect(readCommit).toHaveBeenCalledOnce();
  });
  it("rejects forged proposed reports using the existing authenticator", async () => {
    const f = await fixture();
    await f.add();
    f.commit();
    await expect(
      readPaymentSignerHistory({
        ...f.input(),
        readCommit: async () => {
          throw new Error("forged");
        },
      }),
    ).rejects.toThrow("forged");
  });
  it("rejects shallow history and nonancestor transition", async () => {
    const f = await fixture();
    await f.add();
    const head = f.commit();
    await expect(
      readPaymentSignerHistory({
        ...f.input(),
        baseSha: head,
        headSha: f.input().baseSha,
      }),
    ).rejects.toThrow();
    await f.write(".git/shallow", `${head}\n`);
    await expect(
      readPaymentSignerHistory({ ...f.input(), baseSha: head }),
    ).rejects.toThrow("nonshallow");
  });
});
