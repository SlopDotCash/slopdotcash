import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { makeBucketState } from "alchemy/State/BucketState";
import { State, StateStoreError } from "alchemy/State/State";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Scope from "effect/Scope";
import {
  makeR2BucketObjects,
  resolveStage,
  type R2BucketConfig,
  type StageTarget,
} from "vibestack/alchemy";
import { resolveSlopStatePrefix } from "./catalog.ts";

type SlopStateBackend =
  | { readonly kind: "local" }
  | { readonly kind: "cloudflare"; readonly accountId?: string }
  | { readonly kind: "r2"; readonly config: R2BucketConfig; readonly prefix: string };

export function describeSlopStateBackend(
  stageTarget: StageTarget,
  env: Readonly<Record<string, string | undefined>> = process.env,
): SlopStateBackend {
  if (stageTarget.kind === "dev" || stageTarget.kind === "test") {
    return { kind: "local" };
  }
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (env.ALCHEMY_STATE_STORE === "cloudflare") {
    return { kind: "cloudflare", ...(accountId ? { accountId } : {}) };
  }
  const bucket = env.R2_STATE_BUCKET?.trim();
  const prefix = resolveSlopStatePrefix(stageTarget, env);
  const accessKeyId = env.R2_STATE_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_STATE_SECRET_ACCESS_KEY?.trim();
  if (bucket && accountId && accessKeyId && secretAccessKey) {
    return {
      kind: "r2",
      config: { kind: "s3", accountId, bucket, accessKeyId, secretAccessKey },
      prefix,
    };
  }
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  if (bucket && accountId && apiToken) {
    return {
      kind: "r2",
      config: { kind: "api", accountId, bucket, apiToken },
      prefix,
    };
  }
  return { kind: "local" };
}

function buildR2StateLayer(config: R2BucketConfig, prefix: string): Layer.Layer<State> {
  const objects = makeR2BucketObjects<StateStoreError>(config, {
    tryPromise: Effect.tryPromise,
    makeError: ({ message, cause, status }) =>
      new StateStoreError({
        message,
        ...(cause ? { cause } : {}),
        ...(status !== undefined ? { http: { status } } : {}),
      }),
  });
  return Layer.effect(
    State,
    Effect.gen(function* () {
      const context = yield* Effect.context();
      const scope = yield* Effect.scope;
      const make = makeBucketState({
        id: "r2",
        label: "Cloudflare R2",
        prefix,
        objects: Effect.succeed(objects),
      }).pipe(Scope.provide(scope), Effect.provideContext(context));
      return yield* Effect.cached(make);
    }),
  );
}

export function resolveSlopStateLayer(
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  return Layer.unwrap(
    Effect.gen(function* () {
      const stageName = yield* Alchemy.Stage;
      const stageTarget = resolveStage({ stage: stageName, cwd, env });
      const backend = describeSlopStateBackend(stageTarget, env);
      if (backend.kind === "cloudflare") {
        return Cloudflare.state({
          ...(backend.accountId ? { accountId: backend.accountId } : {}),
        });
      }
      if (backend.kind === "r2") {
        return buildR2StateLayer(backend.config, backend.prefix);
      }
      return Alchemy.localState();
    }),
  );
}
