/**
 * slop-referral-accrual: a cron Worker that files the project-referral
 * accruals of each closed UTC month (PRD section 11, "Referral program",
 * approved). It reads finalized payouts and each project's immutable referrer,
 * appends accrual rows, and publishes one public accrual file per epoch. It
 * has no HTTP route. `off` and `dry_run` load no key and never sign. `live`
 * adds the poster: after filing, it reconciles the distributor against the
 * journal and the files and signs at most one postRoot per run from the
 * poster hot key. Live is refused unless the owner's program flag, the
 * distributor, the token and the network are all set.
 */

import { refreshReferralClaims } from "../../backend/referrals/cache";
import { parseConfig, posterKey, type ReferralAccrualEnv } from "./config";
import {
  message,
  type PostResult,
  postNextRoot,
  type RunResult,
  runAccrual,
} from "./core";
import { createEvmPoster } from "./poster";
import { D1AccrualStore, type ReferralD1Database } from "./store";

export interface Env extends ReferralAccrualEnv {
  REFERRAL_DB: ReferralD1Database;
  REFERRAL_DEPLOYMENT_BLOCK?: string;
  REFERRAL_DISTRIBUTOR_CODE_HASH?: string;
}

export interface RunOutcome extends RunResult {
  /** Present in live mode only. */
  post?: PostResult;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function runOnce(
  env: Env,
  now: () => Date = () => new Date(),
  /** Local harnesses only; the scheduled handler never passes overrides. */
  overrides: { fetch?: typeof fetch; chainIdOverride?: number } = {},
): Promise<RunOutcome | null> {
  // Off is inert even when the rest of the configuration is incomplete.
  if ((env.REFERRAL_ACCRUAL_MODE ?? "off").trim() === "off") return null;
  const config = parseConfig(env);
  if (config.mode === "off") return null;
  const store = new D1AccrualStore(env.REFERRAL_DB);
  const log = (event: Record<string, unknown>) =>
    console.log(JSON.stringify(event));
  const randomId = () => crypto.randomUUID();
  const result: RunOutcome = await runAccrual({
    config,
    store,
    now,
    randomId,
    sha256: sha256Hex,
    log,
  });
  if (config.mode !== "live" || config.poster === null) return result;
  if (result.status === "locked") return result;
  // dry_run never reaches here, so the key is loaded only in live mode.
  const secret = posterKey(env);
  if (secret === undefined)
    throw new Error("live mode needs REFERRAL_POSTER_KEY");
  result.post = await postNextRoot({
    config: config.poster,
    store,
    client: createEvmPoster({
      config: config.poster,
      privateKey: secret,
      fetch: overrides.fetch,
      chainIdOverride: overrides.chainIdOverride,
    }),
    now,
    randomId,
    log,
  });
  return result;
}

export default {
  async scheduled(
    controller: { scheduledTime: number; cron: string },
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) {
    if (controller.cron === "*/15 * * * *") {
      ctx.waitUntil(refreshReferralClaims(env));
      return;
    }
    if (controller.cron !== "23 1 * * *")
      throw new Error("Unknown referral schedule");
    ctx.waitUntil(
      runOnce(env)
        .then((result) =>
          console.log(
            JSON.stringify({ event: "referral_accrual_run", result }),
          ),
        )
        .catch((error) => {
          console.error(
            JSON.stringify({
              event: "referral_accrual_error",
              error: message(error),
            }),
          );
          throw new Error(message(error));
        }),
    );
  },
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },
};
