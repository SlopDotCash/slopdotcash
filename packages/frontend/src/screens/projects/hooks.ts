// spec/frontend/requests.md, "Only the current request may publish its validated result"
import { Cause } from "effect";
import { useMachine } from "../../../gen/frontend__requests.react.ts";
import type { Shown } from "../home/listing.ts";
import { useMounted } from "../security/program/hooks.ts";
import { loadRead, type ShownRead } from "./reads.vibe";

/** A public read of the project page as its request machine shows it, selected for `key` and loaded each time a component mounts. */
export function useShownRead<T>(shown: ShownRead<T>, key: string): Shown<T> {
  const { state, cause } = useMachine(shown.runtime);
  useMounted(shown.runtime, () => loadRead(shown, key));
  if (cause) throw Cause.squash(cause);
  const status = state === undefined || state.status === "Idle" ? "Loading" : state.status;
  return { status, value: shown.read.value(), onRetry: () => void shown.runtime.runPromise(shown.read.load()) };
}
