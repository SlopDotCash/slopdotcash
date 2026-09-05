/** Trusted Git objects, exact chain evidence, and human-review exclusions. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProjectFundingRecord } from "../src/lib/funding";
import { SOLANA_MAINNET_USDC_MINT } from "../src/lib/settlement-plan";
import {
  checkFundingEligibility,
  fundingAdditionPaths,
} from "./check-funding-eligibility";
import { verifyFundingSolana } from "./verify-funding-solana";

const RECIPIENT = "11111111111111111111111111111111";
const SIGNATURE = "3".repeat(88);
const PATH = `funding/sample/solana/${SIGNATURE}/fund_sample1.json`;
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "slop-funding-gate-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const put = (path: string, value: unknown) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), JSON.stringify(value));
  };
  git("init", "-q");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  put("projects/sample/project.json", {
    id: "sample",
    funding: {
      recordsPath: "funding/sample",
      addresses: [
        {
          network: "solana",
          asset: "USDC",
          address: RECIPIENT,
          effectiveAt: "2026-01-01T00:00:00.000Z",
          replacedAt: null,
        },
      ],
    },
  });
  git("add", ".");
  git("commit", "-qm", "base");
  const baseSha = git("rev-parse", "HEAD");
  const record: ProjectFundingRecord = {
    schemaVersion: "1",
    kind: "project-funding",
    recordId: "fund_sample1",
    projectId: "sample",
    manifestRevision: baseSha,
    network: "solana",
    asset: "USDC",
    transactionId: SIGNATURE,
    recipient: RECIPIENT,
    amountMinor: "1000000",
    observedAt: "2026-08-01T00:00:00.000Z",
    state: "verified-on-chain",
    donor: { attribution: "anonymous" },
    finality: { kind: "finalized" },
    verifier: {
      version: "funding-solana-v1",
      checkedAt: "2026-08-01T00:00:00.000Z",
      evidenceUrl: `https://solscan.io/tx/${SIGNATURE}`,
      reason: null,
    },
    supersedes: null,
  };
  const head = () => {
    git("add", ".");
    git("commit", "-qm", "addition");
    const headSha = git("rev-parse", "HEAD");
    git("checkout", "--detach", baseSha);
    return { root, baseSha, headSha };
  };
  return { git, put, record, head };
}

// Exercise the production verifier with deterministic RPC responses, not a
// predeclared success result. An off-by-one amount must fail inside it.
function verifyRecord(record: ProjectFundingRecord) {
  const balance = (accountIndex: number, owner: string, amount: string) => ({
    accountIndex,
    owner,
    mint: SOLANA_MAINNET_USDC_MINT,
    uiTokenAmount: { amount, decimals: 6 },
  });
  const source = "Vote111111111111111111111111111111111111111";
  return verifyFundingSolana({
    signature: record.transactionId,
    recipient: record.recipient,
    amountMinor: record.amountMinor,
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: SIGNATURE,
          result: {
            slot: 123,
            blockTime: 1786000000,
            transaction: { signatures: [SIGNATURE] },
            meta: {
              err: null,
              preTokenBalances: [
                balance(0, source, "1000000"),
                balance(1, RECIPIENT, "0"),
              ],
              postTokenBalances: [
                balance(0, source, "0"),
                balance(1, RECIPIENT, "1000000"),
              ],
            },
          },
        }),
      ),
  });
}

describe("trusted funding eligibility", () => {
  it("accepts exact verified additions and hashes the exact output bytes without authorizing a merge", async () => {
    const f = fixture();
    f.put(PATH, f.record);
    const result = await checkFundingEligibility({ ...f.head(), verifyRecord });
    expect(result.eligible).toBe(true);
    expect(result.mergeAuthorized).toBe(false);
    expect(result.records).toHaveLength(1);
    const evidence = result.records[0];
    expect(evidence?.verifierVersion).toBe("funding-solana-v1");
    expect(evidence?.outputSha256).toBe(
      createHash("sha256")
        .update(evidence?.outputJson ?? "")
        .digest("hex"),
    );
  });
  it("fails an amount off by one minor unit", async () => {
    const f = fixture();
    f.put(PATH, { ...f.record, amountMinor: "1000001" });
    await expect(
      checkFundingEligibility({ ...f.head(), verifyRecord }),
    ).rejects.toThrow();
  });
  it("does not query the chain for mixed manifest changes", async () => {
    const f = fixture();
    f.put(PATH, f.record);
    f.put("projects/other/project.json", {});
    const result = await checkFundingEligibility({
      ...f.head(),
      verifyRecord: async () => {
        throw new Error("must not query");
      },
    });
    expect(result.eligible).toBe(false);
  });
  it.each([
    {
      donor: {
        attribution: "github",
        actorId: "1",
        actorNodeId: "MDQ6VXNlcjE=",
        login: "donor",
      },
    },
    { supersedes: "fund_previous" },
    {
      state: "self-reported",
      verifier: null,
      finality: { kind: "unverified" },
    },
  ])("keeps judgment-dependent records on human review: %j", async (change) => {
    const f = fixture();
    f.put(PATH, { ...f.record, ...change });
    expect(
      (await checkFundingEligibility({ ...f.head(), verifyRecord })).eligible,
    ).toBe(false);
  });
  it("rejects a mismatched record path", async () => {
    const f = fixture();
    f.put(PATH, { ...f.record, recordId: "fund_wrongid" });
    await expect(
      checkFundingEligibility({ ...f.head(), verifyRecord }),
    ).rejects.toThrow(/path/);
  });
  it("rejects reuse within the same PR", async () => {
    const f = fixture();
    f.put(PATH, f.record);
    f.put(PATH.replace("sample1", "sample2"), {
      ...f.record,
      recordId: "fund_sample2",
    });
    await expect(
      checkFundingEligibility({ ...f.head(), verifyRecord }),
    ).rejects.toThrow(/already recorded/);
  });
  it("fails closed when the verifier is unavailable", async () => {
    const f = fixture();
    f.put(PATH, f.record);
    await expect(
      checkFundingEligibility({
        ...f.head(),
        verifyRecord: async () => {
          throw new Error("RPC unavailable");
        },
      }),
    ).rejects.toThrow("RPC unavailable");
  });
  it("rejects a transaction already present in a trusted commitment ledger", async () => {
    const f = fixture();
    f.put(`funding/other/commitments/solana/${SIGNATURE}/cmt_previous.json`, {
      network: "solana",
      transactionId: SIGNATURE,
      recordId: "cmt_previous",
    });
    f.git("add", ".");
    f.git("commit", "-qm", "prior trusted commitment");
    const baseSha = f.git("rev-parse", "HEAD");
    f.put(PATH, f.record);
    const input = { ...f.head(), baseSha, verifyRecord };
    f.git("checkout", "--detach", baseSha);
    await expect(checkFundingEligibility(input)).rejects.toThrow(
      /already recorded/,
    );
  });
  it("rejects executable record blobs", async () => {
    const f = fixture();
    f.put(PATH, f.record);
    chmodSync(join(f.git("rev-parse", "--show-toplevel"), PATH), 0o755);
    f.git("add", ".");
    f.git("update-index", "--chmod=+x", PATH);
    f.git("commit", "-qm", "executable candidate");
    const headSha = f.git("rev-parse", "HEAD");
    const baseSha = f.git("rev-parse", "HEAD^");
    f.git("checkout", "--detach", baseSha);
    await expect(
      checkFundingEligibility({
        root: f.git("rev-parse", "--show-toplevel"),
        baseSha,
        headSha,
        verifyRecord,
      }),
    ).rejects.toThrow(/regular/);
  });
  it("rejects future observation claims even when the transfer matches", async () => {
    const f = fixture();
    f.put(PATH, {
      ...f.record,
      observedAt: "2099-01-01T00:00:00.000Z",
      verifier: { ...f.record.verifier, checkedAt: "2099-01-01T00:00:00.000Z" },
    });
    await expect(
      checkFundingEligibility({ ...f.head(), verifyRecord }),
    ).rejects.toThrow(/fresh verifier/);
  });
  it("keeps retired routes on human review even with a backdated observation", async () => {
    const f = fixture();
    f.put("projects/sample/project.json", {
      id: "sample",
      funding: {
        recordsPath: "funding/sample",
        addresses: [
          {
            network: "solana",
            asset: "USDC",
            address: RECIPIENT,
            effectiveAt: "2026-01-01T00:00:00.000Z",
            replacedAt: "2026-08-02T00:00:00.000Z",
          },
        ],
      },
    });
    f.git("add", ".");
    f.git("commit", "-qm", "retire receiving route");
    const baseSha = f.git("rev-parse", "HEAD");
    f.put(PATH, f.record);
    const input = { ...f.head(), baseSha, verifyRecord };
    f.git("checkout", "--detach", baseSha);
    expect((await checkFundingEligibility(input)).eligible).toBe(false);
  });
  it.each([
    "",
    `M\0${PATH}\0`,
    `D\0${PATH}\0`,
    `A\0${PATH}\0A\0README.md\0`,
    "A\0funding/sample/commitments/solana/tx/id.json\0",
    `A\0${PATH}`,
    `A\0${PATH}\0A\0${PATH}\0`,
  ])("keeps non-addition or malformed diffs on human review", (diff) => {
    expect(fundingAdditionPaths(diff)).toBeNull();
  });
});
