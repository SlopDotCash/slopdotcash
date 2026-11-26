// spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"
import { Cause, type Effect, Exit, type ManagedRuntime } from "effect";
import { useRef, useState } from "react";
import { BountyRefused } from "../../../wallets/bounty/paymentCase.vibe";

export type Acted<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly message: string; readonly stale: boolean };

const fallback = "The wallet request failed.";

function stoppedBy(cause: Cause.Cause<unknown>): { readonly message: string; readonly stale: boolean } {
  const error: unknown = Cause.squash(cause);
  const stale = error instanceof BountyRefused && error.current !== undefined;
  const message = typeof error === "object" && error !== null && "message" in error && typeof error.message === "string" && error.message !== "" ? error.message : fallback;
  return { message, stale };
}

/** Runs `work` on `runtime`; a refusal says whether the case changed under it. @throws {never} */
export async function act<A, E, R>(runtime: ManagedRuntime.ManagedRuntime<R, unknown>, work: Effect.Effect<A, E, R>): Promise<Acted<A>> {
  const exit = await runtime.runPromiseExit(work);
  return Exit.isSuccess(exit) ? { ok: true, value: exit.value } : { ok: false, ...stoppedBy(exit.cause) };
}

export interface Action {
  readonly busy: boolean;
  readonly error: string | null;
  readonly stale: boolean;
  run<A>(work: () => Promise<Acted<A>>, done?: (value: A) => void): void;
}

/** One control group's running action: a second start while one runs is ignored, as the old `sending` guard did. `onStart` runs when an action really starts. */
export function useAction(onStart?: () => void): Action {
  const [state, setState] = useState<{ busy: boolean; error: string | null; stale: boolean }>({ busy: false, error: null, stale: false });
  const running = useRef(false);
  return {
    ...state,
    run(work, done) {
      if (running.current) return;
      running.current = true;
      onStart?.();
      setState({ busy: true, error: null, stale: false });
      void work().then((result) => {
        running.current = false;
        if (result.ok) {
          setState({ busy: false, error: null, stale: false });
          done?.(result.value);
        } else setState({ busy: false, error: result.message, stale: result.stale });
      });
    },
  };
}
