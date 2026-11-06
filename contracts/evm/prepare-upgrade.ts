#!/usr/bin/env bun
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expectedImplementation } from "./integration/upgrade";
import {
  type BuildProvenance,
  type CompiledImplementation,
  prepareUpgradeTransaction,
  type StorageLayout,
  type UpgradeApproval,
  type UpgradeKind,
} from "./upgrade-preflight";

const root = dirname(fileURLToPath(import.meta.url));
const git = (...command: string[]) =>
  execFileSync("git", command, { cwd: root, encoding: "utf8" }).trim();
const sha256 = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const sourceAt = (commit: string): BuildProvenance => ({
  commit: git("rev-parse", `${commit}^{commit}`),
  evmTree: git("rev-parse", `${commit}:contracts/evm`),
  projectEscrowBlob: git(
    "rev-parse",
    `${commit}:contracts/evm/src/ProjectEscrow.sol`,
  ),
  foundryTomlSha256: sha256(
    execFileSync("git", ["show", `${commit}:contracts/evm/foundry.toml`], {
      cwd: root,
    }),
  ),
});

function compileAtRoot(
  buildRoot: string,
  kind: UpgradeKind,
  source: BuildProvenance,
): CompiledImplementation {
  const contract = kind === "vault" ? "ProjectEscrow" : "EscrowFactory";
  execFileSync(
    process.env.FORGE ?? "forge",
    [
      "build",
      "--quiet",
      "--force",
      "--out",
      `${buildRoot}/out`,
      "--cache-path",
      `${buildRoot}/cache`,
      "--extra-output",
      "storageLayout",
    ],
    { cwd: buildRoot, stdio: ["ignore", "ignore", "inherit"] },
  );
  const artifact = JSON.parse(
    readFileSync(`${buildRoot}/out/ProjectEscrow.sol/${contract}.json`, "utf8"),
  ) as { storageLayout: StorageLayout };
  assert(
    artifact.storageLayout?.storage && artifact.storageLayout.types,
    "independent build omitted complete storage layout",
  );
  const built = expectedImplementation(buildRoot, contract);
  return {
    kind,
    contract,
    implementation: built.predicted,
    runtimeCode: built.runtimeCode,
    runtimeCodeSha256: built.digest,
    source,
    storageLayoutSha256: sha256(JSON.stringify(artifact.storageLayout)),
    storageLayout: artifact.storageLayout,
  };
}

export function compileCurrentImplementation(kind: UpgradeKind) {
  return compileImplementationAtCommit(kind, git("rev-parse", "HEAD^{commit}"));
}

export function compileImplementationAtCommit(
  kind: UpgradeKind,
  commit: string,
) {
  const source = sourceAt(commit);
  assert.equal(
    source.commit,
    commit,
    "prior source commit must be the canonical full commit id",
  );
  const directory = mkdtempSync(`${tmpdir()}/upgrade-preflight-`);
  const checkout = `${directory}/source`;
  let added = false;
  try {
    execFileSync("git", ["worktree", "add", "--detach", checkout, commit], {
      cwd: root,
      stdio: ["ignore", "ignore", "inherit"],
    });
    added = true;
    return compileAtRoot(`${checkout}/contracts/evm`, kind, source);
  } finally {
    if (added)
      execFileSync("git", ["worktree", "remove", "--force", checkout], {
        cwd: root,
      });
    rmSync(directory, { recursive: true, force: true });
  }
}

export const compileHistoricalImplementation = compileImplementationAtCommit;

export async function main(argv = process.argv) {
  const args = new Map<string, string>();
  for (let index = 2; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    assert(
      name?.startsWith("--") && value,
      "arguments must be --name value pairs",
    );
    args.set(name.slice(2), value);
  }
  const approvalPath = resolve(args.get("approval") ?? "");
  const rpcUrl = args.get("rpc");
  const proxy = args.get("proxy");
  assert(
    approvalPath && rpcUrl && proxy,
    "usage: upgrade-preflight --approval FILE --rpc URL --proxy ADDRESS",
  );
  const approval = JSON.parse(
    readFileSync(approvalPath, "utf8"),
  ) as UpgradeApproval;
  assert(
    approval.kind === "vault" || approval.kind === "factory",
    "approval has an unknown contract kind",
  );
  const expectedContract =
    approval.kind === "vault" ? "ProjectEscrow" : "EscrowFactory";
  assert.equal(
    approval.contract,
    expectedContract,
    "approval contract does not match its kind",
  );

  const compiled = compileImplementationAtCommit(
    approval.kind,
    approval.source.commit,
  );
  const previousCompiled = compileHistoricalImplementation(
    approval.kind,
    approval.previous.source.commit,
  );
  let rpcId = 0;
  const rpc = async (method: string, params: unknown[]) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
    });
    assert(response.ok, `RPC HTTP ${response.status}`);
    const body = (await response.json()) as {
      result?: unknown;
      error?: unknown;
    };
    assert(!body.error && body.result !== undefined, `RPC ${method} failed`);
    return body.result;
  };
  const transaction = await prepareUpgradeTransaction({
    approval,
    compiled,
    previousCompiled,
    proxy,
    rpc,
  });
  process.stdout.write(`${JSON.stringify(transaction, null, 2)}\n`);
}

if (import.meta.main) await main();
