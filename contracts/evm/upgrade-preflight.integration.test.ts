import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  compileCurrentImplementation,
  compileHistoricalImplementation,
} from "./prepare-upgrade";
import {
  IMPLEMENTATION_SLOT,
  prepareUpgradeTransaction,
  type UpgradeApproval,
} from "./upgrade-preflight";

const root = dirname(fileURLToPath(import.meta.url));
const proxy = "0x2222222222222222222222222222222222222222";

test("clean prior worktree and clean checkout produce a legitimate owner-signable upgrade", async () => {
  const previousCommit = execFileSync(
    "git",
    ["rev-parse", "09de07a0^{commit}"],
    { cwd: root, encoding: "utf8" },
  ).trim();
  const compiled = compileCurrentImplementation("vault");
  const previousCompiled = compileHistoricalImplementation(
    "vault",
    previousCommit,
  );
  const approval: UpgradeApproval = {
    schemaVersion: 2,
    kind: "vault",
    contract: "ProjectEscrow",
    implementation: compiled.implementation,
    runtimeCodeSha256: compiled.runtimeCodeSha256,
    source: compiled.source,
    storageLayoutSha256: compiled.storageLayoutSha256,
    previous: {
      implementation: previousCompiled.implementation,
      runtimeCodeSha256: previousCompiled.runtimeCodeSha256,
      source: previousCompiled.source,
      storageLayoutSha256: previousCompiled.storageLayoutSha256,
    },
  };
  const rpc = async (method: string, params: unknown[]) => {
    if (method === "eth_getStorageAt")
      return `0x${previousCompiled.implementation.slice(2).padStart(64, "0")}`;
    if (method === "eth_getCode")
      return String(params[0]).toLowerCase() ===
        previousCompiled.implementation.toLowerCase()
        ? previousCompiled.runtimeCode
        : compiled.runtimeCode;
    if (method === "eth_call") return IMPLEMENTATION_SLOT;
    throw new Error(`unexpected RPC method ${method}`);
  };

  const transaction = await prepareUpgradeTransaction({
    approval,
    compiled,
    previousCompiled,
    proxy,
    rpc,
  });
  expect(transaction.to).toBe(proxy);
  expect(transaction.value).toBe("0x0");
  expect(transaction.implementation).toBe(compiled.implementation);
  expect(transaction.data).toStartWith("0x4f1ef286");
}, 120_000);
