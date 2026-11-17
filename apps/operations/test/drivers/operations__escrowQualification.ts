// spec/operations/escrowQualification.md, "Story: Qualify escrow one network at a time with an explicitly approved scope"; spec/operations/escrowQualification.md, "Story: Keep previously approved scope and evidence exceptions attached to their specific controls"
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { base58Encode } from "@repo/platform/chain/solana";
import { webCrypto } from "@repo/platform/crypto";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { Driver, Options } from "../../gen/operations__escrowQualification.conformance.ts";
import type { Approver, Event } from "../../gen/operations__escrowQualification.ts";
import { type Approval, approvalMessage, createLedger, loadLedger, recordEntry } from "../../src/qualification/escrow/ledger.vibe";
import type { Registry } from "../../src/qualification/escrow/registry.ts";

const runtime = ManagedRuntime.make(Layer.mergeAll(NodeServices.layer, webCrypto));
const ownerKey = generateKeyPairSync("ed25519");
const owner = base58Encode(new Uint8Array(ownerKey.publicKey.export({ format: "der", type: "spki" }).subarray(12)));
const registry: Registry = { evm: [], solana: [{ network: "Solana", program: owner, programSha256: "0".repeat(64), programLength: 1, authority: owner }] };
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

const approval = (event: Event): Approval | undefined => {
  if (event.type !== "approve") return undefined;
  const signature = sign(null, new TextEncoder().encode(approvalMessage(event.review)), ownerKey.privateKey);
  return { scheme: "solana", signer: owner, signature: base58Encode(new Uint8Array(signature)) };
};

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    rmSync(workspace, { recursive: true, force: true });
    workspace = mkdtempSync(join(tmpdir(), "slop-escrow-ledger-"));
    created = new Set();
  },
  dispatch: async (key, event: Event, by) => {
    const path = await ledgerOf(key);
    const signed = approval(event);
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
