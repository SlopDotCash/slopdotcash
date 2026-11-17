// spec/settlement/keeperRpc.md, "Only an absent override uses the originally configured endpoint"; spec/settlement/keeperRpc.md, "Exact chain preflight on the selected endpoint precedes any keeper work"
import { Effect, Layer, ManagedRuntime } from "effect";
import type { Driver, Options } from "../../gen/settlement__keeperRpc.conformance.ts";
import type { Event, KeeperRpc } from "../../gen/settlement__keeperRpc.ts";
import { rpcSession } from "../../src/keeper/sessions.vibe";

const runtime = ManagedRuntime.make(Layer.empty);
type Session = Effect.Success<ReturnType<typeof rpcSession>>;
const sessions = new Map<string, Session>();

const session = async (key: string) => {
  const known = sessions.get(key);
  if (known !== undefined) return known;
  const opened = await runtime.runPromise(rpcSession("BaseMainnet"));
  sessions.set(key, opened);
  return opened;
};

const outcome = (sent: Effect.Effect<KeeperRpc, unknown>) => runtime.runPromise(sent.pipe(
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

export const options: Options = { keys: ["original", "rotated"], walks: 20, steps: 12 };
