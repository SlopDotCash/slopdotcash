// spec/operations/paymentJobs.md, "Story: Respect service authorization and settle each configured network independently"
import { Effect, ManagedRuntime } from "effect";
import type { Driver, Options } from "../../gen/operations__paymentJobs.conformance.ts";
import type { Machine, Rejected } from "../../gen/operations__paymentJobs.effect.vibe";
import type { Event, ExecutionResult, Network } from "../../gen/operations__paymentJobs.ts";
import { type NotCurrent, type Recheck, begin, configure, jobState, observed, refuseOverlap, report, resetRun, settleExecution, settleRead, startExecution, startRead } from "../../src/jobs/runner.vibe";

type Run = ManagedRuntime.ManagedRuntime<Machine, never>;

const keys = ["fees", "referrals"];
let runs = new Map<string, Run>();

const runFor = (key: string): Run => {
  const found = runs.get(key);
  if (found !== undefined) return found;
  const made: Run = ManagedRuntime.make(jobState());
  runs.set(key, made);
  return made;
};

const rpcRead = (network: Network, outcome: "ReadOk" | "ReadFailed") =>
  outcome === "ReadOk" ? Effect.succeed(`${network} balances`) : Effect.fail(`${network} rpc unavailable`);

const authorityRead = (answer: Recheck) => Effect.succeed(answer);

const signerOutcome = (network: Network, result: ExecutionResult) =>
  result === "ExecutionUncertain" ? Effect.fail(`${network} response lost after broadcast`) : Effect.succeed(result);

const sent = (event: Event): Effect.Effect<unknown, Rejected | NotCurrent, Machine> => {
  switch (event.type) {
    case "configure":
      return configure(event.config);
    case "begin":
      return begin(event.runId);
    case "refuseOverlap":
      return refuseOverlap(event.runId);
    case "startRead":
      return startRead(event.net, event.runId);
    case "settleRead":
      return settleRead(event.net, event.runId, rpcRead(event.net, event.read));
    case "startExecution":
      return startExecution(event.net, event.runId, authorityRead({ role: event.role, release: event.release }));
    case "settleExecution":
      return settleExecution(event.net, event.runId, signerOutcome(event.net, event.result));
    case "report":
      return report();
    case "resetRun":
      return resetRun();
  }
};

export const driver: Driver & AsyncDisposable = {
  reset: async () => {
    const previous = [...runs.values()];
    runs = new Map();
    await Promise.all(previous.map((run) => run.dispose()));
  },
  dispatch: (key, event: Event) => runFor(key).runPromise(sent(event).pipe(
    Effect.as("accepted" as const),
    Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const), NotCurrent: () => Effect.succeed("refused" as const) }),
  )),
  observe: (key) => runFor(key).runPromise(observed()),
  [Symbol.asyncDispose]: async () => {
    await Promise.all([...runs.values()].map((run) => run.dispose()));
  },
};

export const options: Options = { keys, walks: 30, steps: 30 };
