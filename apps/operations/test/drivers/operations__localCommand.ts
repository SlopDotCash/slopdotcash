// spec/operations/localCommand.md, "Story: Reach a bounded result while keeping ownership of local processes"
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, ManagedRuntime } from "effect";
import type { Driver, Options } from "../../gen/operations__localCommand.conformance.ts";
import type { Event } from "../../gen/operations__localCommand.ts";
import { type CommandMachine, commandMachine, launch, launchFacts } from "../../src/local/command/steps.vibe";

const workspace = mkdtempSync(join(tmpdir(), "slop-local-command-"));
const keypair = join(workspace, "payer.json");
writeFileSync(keypair, JSON.stringify(Array.from({ length: 64 }, (_, index) => index)), { mode: 0o600 });

const runtime = ManagedRuntime.make(NodeServices.layer);
let machines = new Map<string, CommandMachine>();

const machineFor = async (key: string) => {
  const found = machines.get(key);
  if (found !== undefined) return found;
  const made = await runtime.runPromise(commandMachine());
  machines.set(key, made);
  return made;
};

const endpointOf = (loopback: boolean) => loopback ? "http://127.0.0.1:8899" : "https://api.mainnet-beta.solana.com";
const keypairOf = (local: boolean) => local ? keypair : join(workspace, "missing.json");

const sent = (machine: CommandMachine, event: Event) => {
  if (event.type !== "launch") return machine.send(event);
  return Effect.flatMap(launchFacts(endpointOf(event.loopbackHttp), keypairOf(event.localPayer)), (facts) => launch(machine, event.receipt, event.group, event.now, facts));
};

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

export const options: Options = { keys: ["airdrop", "second"], walks: 30, steps: 30 };
