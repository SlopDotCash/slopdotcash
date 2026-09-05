import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import eliza from "../projects/eliza/project.json";
import { EVM_FUNDING_USDC_CONTRACTS } from "../src/lib/evm-funding";
import type { FundingNetwork, ProjectFundingRecord } from "../src/lib/funding";
import { SOLANA_MAINNET_USDC_MINT } from "../src/lib/settlement-plan";
import {
  canonicalFundingDecisionBytes,
  checkFundingRecordPr,
} from "./check-funding-record-pr";

const SIGNATURE = "3".repeat(88);
const BLOCK_TIME = Date.parse("2026-07-31T00:00:00.000Z") / 1000;
const SOLANA_RECIPIENT = "11111111111111111111111111111111";
const SOLANA_SOURCE = "Vote111111111111111111111111111111111111111";
const EVM_RECIPIENT = `0x${"1".repeat(40)}`;
const BITCOIN_RECIPIENT = "bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq";
const BTC_SOURCE = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
const RECIPIENTS = {
  solana: SOLANA_RECIPIENT,
  bitcoin: BITCOIN_RECIPIENT,
  base: EVM_RECIPIENT,
  ethereum: EVM_RECIPIENT,
};

function pathFor(record: ProjectFundingRecord): string {
  return `funding/${record.projectId}/${record.network}/${record.transactionId}/${record.recordId}.json`;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "slop-funding-pr-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  const write = (path: string, bytes: string) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), bytes);
  };
  git("init", "--initial-branch=develop");
  git("config", "user.name", "Funding Gate Test");
  git("config", "user.email", "funding-gate@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", join(root, "no-hooks"));
  const project = {
    ...structuredClone(eliza),
    funding: {
      ...eliza.funding,
      addresses: (Object.keys(RECIPIENTS) as FundingNetwork[]).map(
        (network) => ({
          network,
          asset: network === "bitcoin" ? "BTC" : "USDC",
          address: RECIPIENTS[network],
          effectiveAt: "2026-01-01T00:00:00.000Z",
          replacedAt: null,
        }),
      ),
    },
  };
  write("projects/eliza/project.json", JSON.stringify(project));
  write("funding/README.md", "Reviewed funding history.\n");
  git("add", ".");
  git("commit", "-qm", "reviewed base");
  let baseSha = git("rev-parse", "HEAD");
  function record(network: FundingNetwork = "solana"): ProjectFundingRecord {
    const transactionId =
      network === "solana"
        ? SIGNATURE
        : network === "bitcoin"
          ? "a".repeat(64)
          : `0x${"a".repeat(64)}`;
    const origin =
      network === "solana"
        ? "https://solscan.io"
        : network === "bitcoin"
          ? "https://mempool.space"
          : network === "base"
            ? "https://basescan.org"
            : "https://etherscan.io";
    return {
      kind: "project-funding",
      schemaVersion: "1",
      recordId: "fund_fixture01",
      projectId: "eliza",
      manifestRevision: baseSha,
      network,
      asset: network === "bitcoin" ? "BTC" : "USDC",
      transactionId,
      recipient: RECIPIENTS[network],
      amountMinor: network === "bitcoin" ? "150000" : "1000000",
      observedAt: "2026-08-01T00:00:00.000Z",
      state: "verified-on-chain",
      donor: { attribution: "anonymous" },
      finality:
        network === "solana"
          ? { kind: "finalized" }
          : {
              kind: "confirmations",
              confirmations: network === "bitcoin" ? 11 : 100,
            },
      verifier: {
        version: `funding-${network}-v1`,
        checkedAt: "2026-08-01T00:00:00.000Z",
        evidenceUrl: `${origin}/tx/${transactionId}`,
        reason: null,
      },
      supersedes: null,
    };
  }
  return {
    root,
    git,
    write,
    project,
    record,
    get baseSha() {
      return baseSha;
    },
    commitBase(records: ProjectFundingRecord[]) {
      for (const item of records)
        write(pathFor(item), canonicalFundingDecisionBytes(item));
      git("add", ".");
      git("commit", "-qm", "accepted funding records");
      baseSha = git("rev-parse", "HEAD");
    },
    proposal(records: ProjectFundingRecord[], extra?: () => void) {
      for (const item of records)
        write(pathFor(item), canonicalFundingDecisionBytes(item));
      extra?.();
      git("add", "--all");
      git("commit", "-qm", "untrusted proposal");
      const headSha = git("rev-parse", "HEAD");
      git("switch", "--detach", baseSha);
      return headSha;
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function chainFetcher(network: FundingNetwork) {
  const requests: string[] = [];
  return {
    requests,
    fetchImpl: async (url: RequestInfo | URL, init?: RequestInit) => {
      const source = new URL(String(url));
      requests.push(source.href);
      expect(init?.redirect).toBe("error");
      if (network === "bitcoin") {
        const path = source.pathname.replace(/^\/api/u, "");
        expect(init?.method).toBe("GET");
        if (path === "/blocks/tip/height") return new Response("800010");
        if (path === "/block-height/800000")
          return new Response("f".repeat(64));
        if (path === `/tx/${"a".repeat(64)}`)
          return new Response(
            JSON.stringify({
              txid: "a".repeat(64),
              status: {
                confirmed: true,
                block_height: 800000,
                block_time: BLOCK_TIME,
                block_hash: "f".repeat(64),
              },
              vin: [
                {
                  is_coinbase: false,
                  prevout: { scriptpubkey_address: BTC_SOURCE, value: 200000 },
                },
              ],
              vout: [
                { scriptpubkey_address: BITCOIN_RECIPIENT, value: 150000 },
                { scriptpubkey_address: BTC_SOURCE, value: 49000 },
              ],
              fee: 1000,
            }),
          );
        throw new Error(`unexpected Bitcoin request ${path}`);
      }
      const body = JSON.parse(String(init?.body));
      expect(init?.method).toBe("POST");
      let result: unknown;
      if (network === "solana") {
        expect(source.href).toBe("https://api.mainnet-beta.solana.com/");
        expect(body.method).toBe("getTransaction");
        expect(body.params).toMatchObject([
          SIGNATURE,
          { commitment: "finalized", encoding: "jsonParsed" },
        ]);
        const balance = (
          accountIndex: number,
          owner: string,
          amount: string,
        ) => ({
          accountIndex,
          mint: SOLANA_MAINNET_USDC_MINT,
          owner,
          uiTokenAmount: { amount, decimals: 6 },
        });
        result = {
          slot: 123,
          blockTime: BLOCK_TIME,
          meta: {
            err: null,
            preTokenBalances: [
              balance(0, SOLANA_SOURCE, "2000000"),
              balance(1, SOLANA_RECIPIENT, "0"),
            ],
            postTokenBalances: [
              balance(0, SOLANA_SOURCE, "1000000"),
              balance(1, SOLANA_RECIPIENT, "1000000"),
            ],
          },
          transaction: { signatures: [SIGNATURE] },
        };
      } else if (body.method === "eth_chainId")
        result = network === "base" ? "0x2105" : "0x1";
      else if (body.method === "eth_getBlockByNumber")
        result =
          body.params[0] === "finalized"
            ? { number: "0x163", hash: `0x${"c".repeat(64)}` }
            : {
                number: "0x100",
                hash: `0x${"b".repeat(64)}`,
                timestamp: `0x${BLOCK_TIME.toString(16)}`,
              };
      else if (body.method === "eth_getTransactionReceipt") {
        const transactionHash = `0x${"a".repeat(64)}`;
        const blockHash = `0x${"b".repeat(64)}`;
        result = {
          status: "0x1",
          transactionHash,
          blockNumber: "0x100",
          blockHash,
          logs: [
            {
              address: EVM_FUNDING_USDC_CONTRACTS[network],
              topics: [
                "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
                `0x${"0".repeat(24)}${"2".repeat(40)}`,
                `0x${"0".repeat(24)}${"1".repeat(40)}`,
              ],
              data: `0x${1000000n.toString(16).padStart(64, "0")}`,
              removed: false,
              transactionHash,
              blockNumber: "0x100",
              blockHash,
            },
          ],
        };
      } else throw new Error(`unexpected RPC method ${body.method}`);
      return new Response(
        JSON.stringify({ jsonrpc: "2.0", id: body.id, result }),
      );
    },
  };
}

describe("trusted funding-record PR gate", () => {
  for (const network of ["solana", "base", "ethereum", "bitcoin"] as const) {
    for (const temporalFault of [
      "pre-inclusion",
      "missing-inclusion",
      "future-inclusion",
    ] as const) {
      it(`rejects ${network} ${temporalFault} evidence without granting authority`, async () => {
        const repo = fixture();
        try {
          const record = repo.record(network);
          if (temporalFault === "pre-inclusion") {
            record.observedAt = "2026-07-30T00:00:00.000Z";
            if (!record.verifier) throw new Error("missing fixture verifier");
            record.verifier.checkedAt = record.observedAt;
          }
          const headSha = repo.proposal([record]);
          const chain = chainFetcher(network);
          const result = await checkFundingRecordPr({
            repositoryRoot: repo.root,
            baseSha: repo.baseSha,
            headSha,
            pullRequestNumber: 368,
            fetchImpl: async (url, init) => {
              const response = await chain.fetchImpl(url, init);
              if (temporalFault === "pre-inclusion") return response;
              const text = await response.text();
              if (!text.startsWith("{")) return new Response(text);
              const body = JSON.parse(text);
              const value =
                temporalFault === "missing-inclusion"
                  ? undefined
                  : Math.floor(Date.now() / 1000) + 86400;
              if (network === "solana") body.result.blockTime = value;
              else if (network === "bitcoin" && body.status)
                body.status.block_time = value;
              else if (
                (network === "base" || network === "ethereum") &&
                body.result?.number === "0x100"
              )
                body.result.timestamp =
                  value === undefined ? undefined : `0x${value.toString(16)}`;
              return new Response(JSON.stringify(body));
            },
          });
          expect(result.decision, result.reason).toBe("verification-failed");
          expect(result.mergeAuthorized).toBe(false);
          if (temporalFault === "pre-inclusion")
            expect(result.reason).toMatch(/predates chain inclusion/u);
        } finally {
          repo.cleanup();
        }
      });
    }
  }
  for (const network of ["solana", "base", "ethereum", "bitcoin"] as const) {
    it(`verifies a pure ${network} addition through its real read-only verifier`, async () => {
      const repo = fixture();
      try {
        const record = repo.record(network);
        const headSha = repo.proposal([record]);
        const rpc = chainFetcher(network);
        const result = await checkFundingRecordPr({
          repositoryRoot: repo.root,
          baseSha: repo.baseSha,
          headSha,
          pullRequestNumber: 368,
          fetchImpl: rpc.fetchImpl,
        });
        expect(result.decision, result.reason).toBe("verified-records");
        expect(result.mergeAuthorized).toBe(false);
        expect(result.headSha).toBe(headSha);
        expect(result.checkerRevision).toBe(repo.baseSha);
        const evidence = result.records[0];
        expect(evidence.recordBytesSha256).toBe(
          createHash("sha256")
            .update(canonicalFundingDecisionBytes(record))
            .digest("hex"),
        );
        expect(evidence.recordBlobOid).toBe(
          repo.git("rev-parse", `${headSha}:${pathFor(record)}`),
        );
        expect(evidence.verificationInput).toMatchObject({
          projectId: record.projectId,
          recipient: record.recipient,
          asset: record.asset,
          amountMinor: record.amountMinor,
          transactionId: record.transactionId,
        });
        expect(evidence.verifierVersion).toBe(record.verifier?.version);
        if (!evidence.verifierOutputCanonical)
          throw new Error("missing verifier output");
        expect(evidence.verifierOutputSha256).toBe(
          createHash("sha256")
            .update(evidence.verifierOutputCanonical)
            .digest("hex"),
        );
        expect(JSON.parse(evidence.verifierOutputCanonical)).toMatchObject({
          state: "verified-on-chain",
          finality: record.finality,
        });
        expect(rpc.requests.length).toBeGreaterThan(0);
      } finally {
        repo.cleanup();
      }
    });
  }

  it("fails the exact-amount claim when Solana credits one fewer minor unit", async () => {
    const repo = fixture();
    try {
      const record = { ...repo.record(), amountMinor: "1000001" };
      const headSha = repo.proposal([record]);
      const rpc = chainFetcher("solana");
      const result = await checkFundingRecordPr({
        repositoryRoot: repo.root,
        baseSha: repo.baseSha,
        headSha,
        pullRequestNumber: 368,
        fetchImpl: rpc.fetchImpl,
      });
      expect(result.decision).toBe("verification-failed");
      expect(result.reason).toMatch(/exact amount/u);
      expect(result.records[0].verifierVersion).toBe("funding-solana-v1");
      expect(result.records[0].verifierOutputSha256).toBeNull();
    } finally {
      repo.cleanup();
    }
  });

  it("rejects a fresh confirmation count different from the submitted finality", async () => {
    const repo = fixture();
    try {
      const record = {
        ...repo.record("bitcoin"),
        finality: { kind: "confirmations" as const, confirmations: 10 },
      };
      const headSha = repo.proposal([record]);
      const result = await checkFundingRecordPr({
        repositoryRoot: repo.root,
        baseSha: repo.baseSha,
        headSha,
        pullRequestNumber: 368,
        fetchImpl: chainFetcher("bitcoin").fetchImpl,
      });
      expect(result.decision).toBe("verification-failed");
      expect(result.reason).toMatch(/finality/u);
      expect(result.records[0].verifierOutputSha256).toMatch(/^[a-f0-9]{64}$/u);
    } finally {
      repo.cleanup();
    }
  });

  for (const kind of [
    "manifest",
    "modified",
    "deleted",
    "symlink",
    "executable",
    "commitment",
    "script",
  ] as const) {
    it(`leaves ${kind} changes on human review without calling a verifier`, async () => {
      const repo = fixture();
      try {
        const record = repo.record();
        const headSha = repo.proposal([record], () => {
          if (kind === "manifest")
            repo.write(
              "projects/eliza/project.json",
              JSON.stringify({ ...repo.project, name: "Different" }),
            );
          if (kind === "modified") repo.write("funding/README.md", "changed\n");
          if (kind === "deleted")
            unlinkSync(join(repo.root, "funding/README.md"));
          if (kind === "symlink") {
            unlinkSync(join(repo.root, pathFor(record)));
            symlinkSync(
              "../../../../projects/eliza/project.json",
              join(repo.root, pathFor(record)),
            );
          }
          if (kind === "executable")
            chmodSync(join(repo.root, pathFor(record)), 0o755);
          if (kind === "commitment")
            repo.write("funding/eliza/commitments/record.json", "{}\n");
          if (kind === "script")
            repo.write(
              "scripts/attacker.ts",
              `require("node:fs").writeFileSync(${JSON.stringify(join(repo.root, "executed"))}, "bad")`,
            );
        });
        let fetched = false;
        const result = await checkFundingRecordPr({
          repositoryRoot: repo.root,
          baseSha: repo.baseSha,
          headSha,
          pullRequestNumber: 368,
          fetchImpl: async () => {
            fetched = true;
            throw new Error("must not fetch");
          },
        });
        expect(result.decision).toBe("human-review-required");
        expect(result.mergeAuthorized).toBe(false);
        expect(fetched).toBe(false);
        expect(existsSync(join(repo.root, "executed"))).toBe(false);
        expect(repo.git("rev-parse", "HEAD")).toBe(repo.baseSha);
      } finally {
        repo.cleanup();
      }
    });
  }

  for (const kind of [
    "self-reported",
    "disputed",
    "supersedes",
    "attributed",
  ] as const) {
    it(`keeps ${kind} records outside unattended verification`, async () => {
      const repo = fixture();
      try {
        const record = repo.record();
        if (kind === "self-reported") {
          record.state = kind;
          record.finality = { kind: "unverified" };
          record.verifier = null;
        }
        if (kind === "disputed") {
          record.state = kind;
          if (!record.verifier) throw new Error("missing fixture verifier");
          record.verifier.reason = "disputed by a later observation";
        }
        if (kind === "supersedes") record.supersedes = "fund_previous01";
        if (kind === "attributed")
          record.donor = {
            attribution: "github",
            actorId: "42",
            actorNodeId: "MDQ6VXNlcjQy",
            login: "someone",
          };
        const headSha = repo.proposal([record]);
        const result = await checkFundingRecordPr({
          repositoryRoot: repo.root,
          baseSha: repo.baseSha,
          headSha,
          pullRequestNumber: 368,
          fetchImpl: async () => {
            throw new Error("must not fetch");
          },
        });
        expect(result.decision, result.reason).toBe("human-review-required");
        expect(result.records[0].verifierOutputSha256).toBeNull();
      } finally {
        repo.cleanup();
      }
    });
  }

  it("rejects duplicate transactions against the base and within the same proposal", async () => {
    for (const existing of [true, false]) {
      const repo = fixture();
      try {
        const previous = repo.record();
        if (existing) repo.commitBase([previous]);
        const next = { ...repo.record(), recordId: "fund_fixture02" };
        const headSha = repo.proposal(existing ? [next] : [previous, next]);
        const result = await checkFundingRecordPr({
          repositoryRoot: repo.root,
          baseSha: repo.baseSha,
          headSha,
          pullRequestNumber: 368,
        });
        expect(result.decision).toBe("verification-failed");
        expect(result.reason).toMatch(/duplicates/u);
      } finally {
        repo.cleanup();
      }
    }
  });

  it("refuses a manifest commit present only in unreviewed PR history", async () => {
    const repo = fixture();
    try {
      const unreviewed = repo.git(
        "commit-tree",
        `${repo.baseSha}^{tree}`,
        "-p",
        repo.baseSha,
        "-m",
        "unreviewed manifest state",
      );
      const record = { ...repo.record(), manifestRevision: unreviewed };
      const headSha = repo.proposal([record]);
      const result = await checkFundingRecordPr({
        repositoryRoot: repo.root,
        baseSha: repo.baseSha,
        headSha,
        pullRequestNumber: 368,
      });
      expect(result.decision).toBe("verification-failed");
      expect(result.records[0].verifierOutputCanonical).toBeNull();
    } finally {
      repo.cleanup();
    }
  });

  it("binds verification to the trusted checkout and rejects a non-descendant PR head", async () => {
    const repo = fixture();
    try {
      const headSha = repo.proposal([repo.record()]);
      repo.git("switch", "--detach", headSha);
      const wrongCheckout = await checkFundingRecordPr({
        repositoryRoot: repo.root,
        baseSha: repo.baseSha,
        headSha,
        pullRequestNumber: 368,
      });
      expect(wrongCheckout.reason).toMatch(/exact trusted base/u);
      repo.git("switch", "--detach", repo.baseSha);
      const unrelated = repo.git(
        "commit-tree",
        `${headSha}^{tree}`,
        "-m",
        "unrelated history",
      );
      const result = await checkFundingRecordPr({
        repositoryRoot: repo.root,
        baseSha: repo.baseSha,
        headSha: unrelated,
        pullRequestNumber: 368,
      });
      expect(result.decision).toBe("verification-failed");
      expect(result.records).toEqual([]);
    } finally {
      repo.cleanup();
    }
  });

  it("rejects ambiguous JSON and preserves the hash of the actual proposed bytes", async () => {
    const repo = fixture();
    try {
      const record = repo.record();
      const bytes = canonicalFundingDecisionBytes(record).replace(
        '"amountMinor": "1000000"',
        '"amountMinor": "1", "amountMinor": "1000000"',
      );
      const headSha = repo.proposal([record], () =>
        repo.write(pathFor(record), bytes),
      );
      const result = await checkFundingRecordPr({
        repositoryRoot: repo.root,
        baseSha: repo.baseSha,
        headSha,
        pullRequestNumber: 368,
      });
      expect(result.decision).toBe("human-review-required");
      expect(result.reason).toMatch(/canonical UTF-8/u);
      expect(result.records[0].recordBytesSha256).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
    } finally {
      repo.cleanup();
    }
  });

  for (const kind of [
    "project",
    "recipient",
    "asset",
    "transaction",
    "future",
    "oversized",
    "invalid-utf8",
  ] as const) {
    it(`rejects ${kind} evidence before any network request`, async () => {
      const repo = fixture();
      try {
        const record = repo.record();
        const path = pathFor(record);
        if (kind === "project") record.projectId = "not-the-project";
        if (kind === "recipient") record.recipient = SOLANA_SOURCE;
        if (kind === "asset") record.asset = "BTC";
        if (kind === "transaction") record.transactionId = "4".repeat(88);
        if (kind === "future") record.observedAt = "2999-01-01T00:00:00.000Z";
        const headSha = repo.proposal([], () => {
          repo.write(
            path,
            kind === "oversized"
              ? " ".repeat(65537)
              : canonicalFundingDecisionBytes(record),
          );
          if (kind === "invalid-utf8")
            writeFileSync(join(repo.root, path), Buffer.from([0xff, 0xfe]));
        });
        let requests = 0;
        const result = await checkFundingRecordPr({
          repositoryRoot: repo.root,
          baseSha: repo.baseSha,
          headSha,
          pullRequestNumber: 368,
          fetchImpl: async () => {
            requests += 1;
            throw new Error("unexpected network request");
          },
        });
        expect(result.decision).toBe("verification-failed");
        expect(result.mergeAuthorized).toBe(false);
        expect(requests).toBe(0);
      } finally {
        repo.cleanup();
      }
    });
  }

  it("fails closed when the read-only verifier cannot reach its authority", async () => {
    const repo = fixture();
    try {
      const headSha = repo.proposal([repo.record()]);
      const result = await checkFundingRecordPr({
        repositoryRoot: repo.root,
        baseSha: repo.baseSha,
        headSha,
        pullRequestNumber: 368,
        fetchImpl: async () => new Response("unavailable", { status: 503 }),
      });
      expect(result.decision).toBe("verification-failed");
      expect(result.mergeAuthorized).toBe(false);
    } finally {
      repo.cleanup();
    }
  });

  it("keeps the workflow on trusted-base code with read-only permissions and no merge API", () => {
    const workflow = readFileSync(
      join(process.cwd(), ".github/workflows/funding-records.yml"),
      "utf8",
    );
    expect(workflow).toContain("pull_request_target:");
    expect(workflow).toContain(
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal GitHub Actions expression
      "ref: ${{ github.event.pull_request.base.sha }}",
    );
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain(
      'test "$(git rev-parse refs/remotes/origin/slop-funding-head)" = "$FUNDING_HEAD_SHA"',
    );
    expect(workflow).not.toMatch(
      /contents: write|pull-requests: write|gh pr merge|gh pr review|environment:|bun install|ref:.*head.sha/u,
    );
  });
});
