#!/usr/bin/env bun
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expectedImplementation } from "./integration/upgrade";
import {
  prepareUpgradeTransaction,
  type StorageEntry,
  type UpgradeApproval,
} from "./upgrade-preflight";

const root = dirname(fileURLToPath(import.meta.url));
const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const name = process.argv[index];
  const value = process.argv[index + 1];
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
const sourceStatus = execFileSync(
  "git",
  [
    "status",
    "--porcelain",
    "--untracked-files=all",
    "--",
    "src",
    "vendor",
    "foundry.toml",
  ],
  { cwd: root, encoding: "utf8" },
).trim();
assert.equal(
  sourceStatus,
  "",
  "contract sources or compiler configuration differ from HEAD",
);

execFileSync(
  process.env.FORGE ?? "forge",
  ["build", "--root", root, "--force"],
  {
    stdio: ["ignore", "ignore", "inherit"],
  },
);
const artifact = JSON.parse(
  readFileSync(
    `${root}/out/ProjectEscrow.sol/${expectedContract}.json`,
    "utf8",
  ),
) as {
  storageLayout: { storage: StorageEntry[]; types: Record<string, unknown> };
};
assert(artifact.storageLayout, "independent build omitted storage layout");
const canonicalLayout = JSON.stringify(artifact.storageLayout);
const layoutDigest = createHash("sha256").update(canonicalLayout).digest("hex");
const built = expectedImplementation(root, expectedContract);
const git = (...command: string[]) =>
  execFileSync("git", command, { cwd: root, encoding: "utf8" }).trim();
const fileSha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const source = {
  commit: git("rev-parse", "HEAD"),
  evmTree: git("rev-parse", "HEAD:contracts/evm"),
  projectEscrowBlob: git("hash-object", "src/ProjectEscrow.sol"),
  foundryTomlSha256: fileSha256(`${root}/foundry.toml`),
};
const compiled = {
  kind: approval.kind,
  contract: expectedContract,
  implementation: built.predicted,
  runtimeCode: built.runtimeCode,
  runtimeCodeSha256: built.digest,
  source,
  storageLayoutSha256: layoutDigest,
  storage: artifact.storageLayout.storage.map(
    ({ label, slot, offset, type }) => ({
      label,
      slot,
      offset,
      type,
    }),
  ),
};
let rpcId = 0;
const rpc = async (method: string, params: unknown[]) => {
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  assert(response.ok, `RPC HTTP ${response.status}`);
  const body = (await response.json()) as { result?: unknown; error?: unknown };
  assert(!body.error && body.result !== undefined, `RPC ${method} failed`);
  return body.result;
};

const transaction = await prepareUpgradeTransaction({
  approval,
  compiled,
  proxy,
  rpc,
});
process.stdout.write(`${JSON.stringify(transaction, null, 2)}\n`);
