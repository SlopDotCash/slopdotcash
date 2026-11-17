// spec/operations/localValidator.md, "Story: Run tests only against the validator owned by the current stage"
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, ManagedRuntime } from "effect";
import type { Driver, Options } from "../../gen/operations__localValidator.conformance.ts";
import type { Event } from "../../gen/operations__localValidator.ts";
import { type ValidatorMachine, startStage, validatorMachine } from "../../src/local/validator/steps.vibe";

const workspace = mkdtempSync(join(tmpdir(), "slop-local-validator-"));
const keypair = join(workspace, "payer.json");
const program = join(workspace, "escrow.so");
const account = join(workspace, "config.json");
writeFileSync(keypair, JSON.stringify(Array.from({ length: 64 }, (_, index) => index)), { mode: 0o600 });
writeFileSync(program, new Uint8Array([0x7f, 0x45, 0x4c, 0x46]));
writeFileSync(account, JSON.stringify({ pubkey: "11111111111111111111111111111111", account: { lamports: 1, data: ["", "base64"], owner: "11111111111111111111111111111111", executable: false, rentEpoch: 0, space: 0 } }));

const runtime = ManagedRuntime.make(NodeServices.layer);
let machines = new Map<string, ValidatorMachine>();

const machineFor = async (key: string) => {
  const found = machines.get(key);
  if (found !== undefined) return found;
  const made = await runtime.runPromise(validatorMachine());
  machines.set(key, made);
  return made;
};

const mountsOf = (publicOnly: boolean) => publicOnly ? [program, account] : [program, keypair];
const endpointOf = (local: boolean) => local ? "http://127.0.0.1:18999" : "https://api.devnet.solana.com";

const sent = (machine: ValidatorMachine, event: Event) => event.type === "startStage"
  ? startStage(machine, { mode: event.mode, receipt: event.receipt, mounts: mountsOf(event.publicReadOnlyMounts), keypair, endpoint: endpointOf(event.localEndpoint) })
  : machine.send(event);

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    machines = new Map();
  },
  dispatch: async (key, event: Event) => runtime.runPromise(sent(await machineFor(key), event).pipe(
    Effect.as("accepted" as const),
    Effect.catchTag("Rejected", () => Effect.succeed("refused" as const)),
  )),
  observe: async (key) => runtime.runPromise((await machineFor(key)).get()),
  [Symbol.asyncDispose]: () => runtime.dispose(),
};

export const options: Options = { keys: ["acceptance", "shell"], walks: 30, steps: 30 };
