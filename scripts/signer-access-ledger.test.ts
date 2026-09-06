import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ed25519 } from "@noble/curves/ed25519.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import eliza from "../projects/eliza/project.json";
import { canonicalFundingDecisionBytes } from "./check-funding-record-pr";
import {
  assertSignerCapabilityForSettlement,
  readCurrentSignerAccessLedger,
  readSignerAccessLedger,
  signerCapabilityState,
  signerReportPath,
} from "./signer-access-ledger";
import { buildFundingIndex } from "./sync-funding-index";
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

describe("complete authenticated signer history", () => {
  it("fetches accepted loss rather than trusting a stale local develop ref", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-06T00:00:00.000Z"));
    const f = await fixture();
    f.git("branch", "-M", "develop");
    f.git("remote", "add", "origin", f.root);
    f.git("update-ref", "refs/remotes/origin/develop", f.input().baseSha);
    await f.add();
    const acceptedLoss = f.commit();
    const ledger = await readCurrentSignerAccessLedger(
      f.root,
      f.input().readCommit,
    );
    expect(ledger.headSha).toBe(acceptedLoss);
    expect(
      signerCapabilityState(ledger, f.report, new Date().toISOString()).state,
    ).toBe("inaccessible");
  });
  it("validates stored reports offline without turning them into funding", async () => {
    const f = await fixture();
    await f.add();
    f.commit();
    const result = await buildFundingIndex({
      repositoryRoot: f.root,
      projects: [eliza],
    });
    expect(result.records).toEqual([]);
    expect(result.commitments).toEqual([]);
    await f.write(signerReportPath(f.report), JSON.stringify(f.report));
    await expect(
      buildFundingIndex({ repositoryRoot: f.root, projects: [eliza] }),
    ).rejects.toThrow("content-addressed");
  });
  it("requires both member proofs and expires at the exact bound", async () => {
    const f = await fixture();
    await f.add(f.positive("funder", "c"));
    f.commit();
    const one = await readSignerAccessLedger(f.input());
    expect(signerCapabilityState(one, f.report, f.input().now).state).toBe(
      "unknown",
    );
    const allocation = {
      ...f.report,
      fundingBasis: { instrumentId: f.report.instrumentId },
    };
    expect(() =>
      assertSignerCapabilityForSettlement(one, allocation, f.input().now),
    ).toThrow("unknown");
    await f.add(f.positive("steward", "d"));
    f.commit();
    const both = await readSignerAccessLedger(f.input());
    expect(
      signerCapabilityState(both, f.report, "2026-09-06T19:59:59.999Z").state,
    ).toBe("both-signers-current");
    expect(
      signerCapabilityState(both, f.report, "2026-09-06T20:00:00.000Z").state,
    ).toBe("unknown");
    expect(() =>
      assertSignerCapabilityForSettlement(both, allocation, f.input().now),
    ).not.toThrow();
    expect(() =>
      assertSignerCapabilityForSettlement(
        both,
        allocation,
        "2026-09-06T20:00:00.000Z",
      ),
    ).toThrow("unknown");
  });

  it("never lets later positive reports erase a terminal loss", async () => {
    const f = await fixture();
    await f.add();
    const baseSha = f.commit();
    for (const [role, source] of [
      ["funder", "c"],
      ["steward", "d"],
    ] as const) {
      const value = f.positive(role, source, "2026-09-05T21:00:00.000Z");
      // A later signed report still cannot restore this instrument.
      await f.add(value);
    }
    f.commit();
    const ledger = await readSignerAccessLedger({ ...f.input(), baseSha });
    expect(signerCapabilityState(ledger, f.report, f.input().now).state).toBe(
      "inaccessible",
    );
  });
  it("authenticates loss from immutable blobs and ignores dirty working bytes", async () => {
    const f = await fixture();
    await f.add();
    f.commit();
    await f.write(signerReportPath(f.report), "not a report");
    const ledger = await readSignerAccessLedger(f.input());
    const state = signerCapabilityState(ledger, f.report, f.input().now);
    expect(state.state).toBe("inaccessible");
    expect(state.losses.map((loss) => loss.reason)).toEqual([f.report.reason]);
    expect(state.paymentAuthorized).toBe(false);
    expect(() =>
      assertSignerCapabilityForSettlement(
        ledger,
        { ...f.report, fundingBasis: { instrumentId: f.report.instrumentId } },
        f.input().now,
      ),
    ).toThrow("inaccessible");
    expect(() =>
      signerCapabilityState(
        { ...ledger, reports: [] },
        f.report,
        f.input().now,
      ),
    ).toThrow("complete authenticated ledger");
  });

  it.each(["delete", "rewrite"])(
    "rejects %s of a previously accepted loss",
    async (change) => {
      const f = await fixture();
      await f.add();
      const baseSha = f.commit();
      if (change === "delete") f.git("rm", signerReportPath(f.report));
      else
        await f.write(
          signerReportPath(f.report),
          canonicalFundingDecisionBytes({ ...f.report, reason: "changed" }),
        );
      f.commit();
      await expect(
        readSignerAccessLedger({ ...f.input(), baseSha }),
      ).rejects.toThrow("append-only");
    },
  );

  it("does not authenticate a report against its own proposed manifest", async () => {
    const f = await fixture();
    await f.write("extra.txt", "new revision");
    f.report.manifestRevision = f.commit();
    await f.add();
    f.commit();
    await expect(readSignerAccessLedger(f.input())).rejects.toThrow();
  });

  it("fails the whole read on unavailable signature authority", async () => {
    const f = await fixture();
    await f.add();
    f.commit();
    await expect(
      readSignerAccessLedger({
        ...f.input(),
        readCommit: async () => {
          throw new Error("offline");
        },
      }),
    ).rejects.toThrow("offline");
  });

  it.each(["duplicate-key", "wrong-path", "symlink"])(
    "rejects %s records",
    async (change) => {
      const f = await fixture();
      if (change === "duplicate-key")
        await f.write(
          signerReportPath(f.report),
          canonicalFundingDecisionBytes(f.report).replace(
            "{",
            '{"reason":"discarded",',
          ),
        );
      if (change === "wrong-path")
        await f.write(
          `funding/eliza/signer-access/${"0".repeat(64)}.json`,
          canonicalFundingDecisionBytes(f.report),
        );
      if (change === "symlink") {
        const { symlink } = await import("node:fs/promises");
        await mkdir(join(f.root, "funding/eliza/signer-access"), {
          recursive: true,
        });
        await symlink(
          "../../../projects/eliza/project.json",
          join(f.root, signerReportPath(f.report)),
        );
      }
      f.commit();
      await expect(readSignerAccessLedger(f.input())).rejects.toThrow();
    },
  );
});
