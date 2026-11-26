import { deploymentOrigins } from "@repo/platform/config";
import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import type { ComponentMeta } from "vibestack/stories";
import { page } from "../../../gen/app.ts";
import type { PageProps } from "../../app/pages.ts";
import type { PageRuntime } from "../../app/runtime.vibe";
import { Deployment } from "../../platform/config.vibe";
import { Session } from "../../session/session.vibe";

const route = page("Admin");
const runtime = ManagedRuntime.make(
  Layer.mergeAll(
    Layer.succeed(Deployment, {
      tier: "production",
      origins: deploymentOrigins("production"),
      pageOrigin: "https://slop.cash",
      localBackendOrigin: undefined,
      loginHref: (next) => Effect.succeed(`/login?next=${encodeURIComponent(next)}`),
    }),
    Layer.succeed(Session, {
      changes: Stream.make({ status: "signedOut" as const }),
      view: () => Effect.succeed({ status: "signedOut" as const }),
      current: () => Effect.succeed(null),
      refresh: () => Effect.succeed({ view: { status: "signedOut" as const }, current: true }),
    }),
  ),
) as unknown as PageRuntime;

export const meta: ComponentMeta<PageProps> = {
  args: {
    runtime,
    route,
  },
};
