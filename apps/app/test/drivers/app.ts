// SPEC.md, "Conformance": spec/app/index.md against the shell of src/routes.vibe, observed as the route it holds.
import { Effect } from "effect";
import { effectDriver } from "vibestack/testing";
import type { Options } from "../../gen/app.conformance.ts";
import type { Machine } from "../../gen/app.effect.vibe";
import type { Event, Shell } from "../../gen/app.ts";
import { current, opened, routes } from "../../src/routes.vibe";

/** What the shell did with `input`: a refusal by the rules or the decoder is "refused", any other failure stays one. */
const receive = (_key: string, input: unknown) =>
  opened(input).pipe(
    Effect.as("accepted" as const),
    Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const), NotAnEvent: () => Effect.succeed("refused" as const) }),
  );

export const driver = effectDriver<Event, Shell, Machine, unknown>(routes, {
  dispatch: receive,
  receive,
  observe: current,
});

/** One page, so one key. */
export const options: Options<Shell> = { keys: ["page"] };
