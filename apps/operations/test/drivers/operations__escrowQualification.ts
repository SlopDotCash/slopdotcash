// spec/operations/escrowQualification.md, "Story: Qualify escrow one network at a time with an explicitly approved scope"; spec/operations/escrowQualification.md, "Story: Keep previously approved scope and evidence exceptions attached to their specific controls"
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { webCrypto } from "@repo/platform/crypto";
import { signPersonalMessage } from "@repo/platform/testing/chains";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { Driver, Options } from "../../gen/operations__escrowQualification.conformance.ts";
import type { Approver, Event } from "../../gen/operations__escrowQualification.ts";
import { type Approval, approvalMessage, createLedger, loadLedger, recordEntry } from "../../src/qualification/escrow/ledger.vibe";
import type { Registry } from "../../src/qualification/escrow/registry.ts";

const runtime = ManagedRuntime.make(Layer.mergeAll(NodeServices.layer, webCrypto));
const ownerKey = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const owner = "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266";
const zeroAddress = `0x${"0".repeat(40)}`;
const zeroHash = "0".repeat(64);
const registry: Registry = {
  evm: [{
    network: "Base",
    sourceCommit: "0".repeat(40),
    factory: zeroAddress,
    proxyCodeSha256: zeroHash,
    vaultImplementation: zeroAddress,
    vaultImplementationCodeSha256: zeroHash,
    factoryImplementation: zeroAddress,
    factoryImplementationCodeSha256: zeroHash,
    authority: owner,
  }],
  solana: [],
};
let workspace = mkdtempSync(join(tmpdir(), "slop-escrow-ledger-"));
let created = new Set<string>();

const ledgerOf = async (key: string) => {
  const path = join(workspace, `${key}.json`);
  if (!created.has(path)) {
    await runtime.runPromise(createLedger(path));
    created.add(path);
  }
  return path;
};

const approval = async (event: Event): Promise<Approval | undefined> => {
  if (event.type !== "approve") return undefined;
  const { signer, signature } = await signPersonalMessage(ownerKey, approvalMessage(event.review));
  return { scheme: "evm", signer, signature };
};

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    rmSync(workspace, { recursive: true, force: true });
    workspace = mkdtempSync(join(tmpdir(), "slop-escrow-ledger-"));
    created = new Set();
  },
  dispatch: async (key, event: Event, by) => {
    const path = await ledgerOf(key);
    const signed = await approval(event);
    const extra = { ...(event.type === "retainAttempt" ? { raw: event.operation.transaction } : {}), ...(signed === undefined ? {} : { approval: signed }) };
    return runtime.runPromise(Effect.flatMap(loadLedger(path, registry), (loaded) => recordEntry(loaded, event, by as Approver, extra)).pipe(
      Effect.as("accepted" as const),
      Effect.catchTag("Rejected", () => Effect.succeed("refused" as const)),
    ));
  },
  observe: async (key) => (await runtime.runPromise(loadLedger(await ledgerOf(key), registry))).state,
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
    rmSync(workspace, { recursive: true, force: true });
  },
};

export const options: Options = { keys: ["ledger"], walks: 20, steps: 24 };
