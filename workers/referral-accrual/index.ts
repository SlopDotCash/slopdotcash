/**
 * slop-referral-accrual: a cron Worker that files the project-referral
 * accruals of each closed UTC month (PRD section 11, "Referral program",
 * proposed). It reads finalized payouts and each project's immutable referrer,
 * appends accrual rows, and publishes one public accrual file per epoch. It
 * has no HTTP route, loads no key, and never signs, posts or pays. The only
 * modes are `off` and `dry_run`.
 */

import { parseConfig, type ReferralAccrualEnv } from "./config";
import { message, type RunResult, runAccrual } from "./core";
import { D1AccrualStore, type ReferralD1Database } from "./store";

export interface Env extends ReferralAccrualEnv {
  REFERRAL_DB: ReferralD1Database;
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
): Promise<RunResult | null> {
  // Off is inert even when the rest of the configuration is incomplete.
  if ((env.REFERRAL_ACCRUAL_MODE ?? "off").trim() === "off") return null;
  const config = parseConfig(env);
  if (config.mode === "off") return null;
  return runAccrual({
    config,
    store: new D1AccrualStore(env.REFERRAL_DB),
    now,
    randomId: () => crypto.randomUUID(),
    sha256: sha256Hex,
    log: (event) => console.log(JSON.stringify(event)),
  });
}

export default {
  async scheduled(
    _controller: { scheduledTime: number } | undefined,
    env: Env,
    ctx: { waitUntil(promise: Promise<unknown>): void },
  ) {
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
          throw error;
        }),
    );
  },
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },
};
