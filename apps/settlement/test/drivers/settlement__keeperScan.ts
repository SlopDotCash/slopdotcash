// spec/settlement/keeperScan.md, "A deployment progresses through preflight, authority, gas, scanning and local state checks"; spec/settlement/keeperScan.md, "Returning to scanning requires successful receipt verification and indexing"
import { Effect, Layer, ManagedRuntime } from "effect";
import type { Driver, Options } from "../../gen/settlement__keeperScan.conformance.ts";
import type { Event, KeeperScan } from "../../gen/settlement__keeperScan.ts";
import { scanSession } from "../../src/keeper/sessions.vibe";

const runtime = ManagedRuntime.make(Layer.empty);
type Session = Effect.Success<ReturnType<typeof scanSession>>;
const sessions = new Map<string, Session>();

const session = async (key: string) => {
  const known = sessions.get(key);
  if (known !== undefined) return known;
  const opened = await runtime.runPromise(scanSession());
  sessions.set(key, opened);
  return opened;
};

const outcome = (sent: Effect.Effect<KeeperScan, unknown>) => runtime.runPromise(sent.pipe(
  Effect.as("accepted" as const),
  Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const), NotAnEvent: () => Effect.succeed("refused" as const) }),
));

export const driver: Driver & AsyncDisposable = {
  reset: () => {
    sessions.clear();
  },
  dispatch: async (key, event: Event) => outcome((await session(key)).send(event)),
  receive: async (key, raw) => outcome((await session(key)).receive(raw)),
  observe: async (key) => runtime.runPromise((await session(key)).get()),
  [Symbol.asyncDispose]: async () => {
    await runtime.dispose();
  },
};

export const options: Options = { keys: ["first", "second"], walks: 20, steps: 12 };
