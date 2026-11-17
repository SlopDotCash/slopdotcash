// spec/slopbot/reviewLease.md, "Story: Claim a review and allow only its current owner to finish"
import { Cause, type Effect, Exit, type ManagedRuntime } from "effect";

const refusals = new Set(["Rejected", "NotAnEvent", "ReviewLeaseLost", "ReviewBusy"]);

export function verdictOf<A, E>(exit: Exit.Exit<A, E>, accepted: (value: A) => boolean = () => true): "accepted" | "refused" {
  if (Exit.isSuccess(exit)) return accepted(exit.value) ? "accepted" : "refused";
  const error = Cause.squash(exit.cause);
  if (typeof error === "object" && error !== null && "_tag" in error && typeof error._tag === "string" && refusals.has(error._tag)) return "refused";
  throw error;
}

export async function settled<A, E, R>(effect: Effect.Effect<A, E, R>, runtime: ManagedRuntime.ManagedRuntime<R, never>): Promise<"accepted" | "refused"> {
  return verdictOf(await runtime.runPromiseExit(effect));
}
