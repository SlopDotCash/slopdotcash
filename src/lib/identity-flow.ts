/** Shared identity start/poll protocol; consumers retain separate audiences and session exchanges. */
import { identityPublicOrigin } from "../../workers/identity/contracts";
import { deploymentTier } from "./deployment";

const CLOCK_SKEW_MS = 2 * 60_000;
export interface IdentityAuthorization {
  flowId: string;
  pollCapability: string;
  authorizationUrl: string;
  expiresAt: string;
  pollAfterSeconds: number;
}
function invalid(): never {
  throw new Error(
    "Identity service returned an invalid response. Start again.",
  );
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function timestamp(value: unknown): number {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    invalid();
  return Date.parse(value);
}
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Sign-in cancelled or timed out."));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function requestIdentityAssertion(options: {
  audience: "private-trace-api" | "slop-points-web";
  origin?: string;
  signal: AbortSignal;
  now?: () => number;
  resume?: unknown;
  saveAuthorization?: (value: IdentityAuthorization | null) => void;
  authorize: (url: string) => void;
  request: (
    url: string,
    init: RequestInit,
  ) => Promise<{ status: number; body: Record<string, unknown> } | null>;
}): Promise<string> {
  const identityOrigin = identityPublicOrigin(
    options.origin,
    deploymentTier(import.meta.env.VITE_SLOP_ENVIRONMENT),
  );
  const now = options.now ?? Date.now;
  const signal = options.signal;
  const post = (body: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const started = options.resume
    ? record(options.resume)
    : ((
        await options.request(
          `${identityOrigin}/v1/oauth/start`,
          post({ audience: options.audience }),
        )
      )?.body ?? invalid());
  const expires = timestamp(started.expiresAt);
  if (
    expires <= now() ||
    expires > now() + 5 * 60_000 + CLOCK_SKEW_MS ||
    typeof started.flowId !== "string" ||
    !/^flow_[A-Za-z0-9_-]{20,64}$/u.test(started.flowId) ||
    typeof started.pollCapability !== "string" ||
    !/^[A-Za-z0-9_-]{40,128}$/u.test(started.pollCapability) ||
    typeof started.authorizationUrl !== "string"
  )
    invalid();
  let authorization: URL;
  try {
    authorization = new URL(started.authorizationUrl);
  } catch {
    invalid();
  }
  if (
    authorization.origin !== identityOrigin ||
    authorization.pathname !== "/v1/oauth/authorize" ||
    authorization.username ||
    authorization.password ||
    authorization.hash ||
    authorization.searchParams.size !== 2 ||
    authorization.searchParams.get("flow_id") !== started.flowId ||
    !/^[A-Za-z0-9_-]{40,128}$/u.test(
      authorization.searchParams.get("state") ?? "",
    )
  )
    invalid();
  let interval = Number(started.pollAfterSeconds);
  if (!Number.isSafeInteger(interval) || interval < 1 || interval > 10)
    invalid();
  options.saveAuthorization?.({
    flowId: started.flowId as string,
    pollCapability: started.pollCapability as string,
    authorizationUrl: authorization.href,
    expiresAt: started.expiresAt as string,
    pollAfterSeconds: interval,
  });
  if (!options.resume) options.authorize(authorization.href);
  let assertion = "";
  while (now() < expires) {
    await delay(Math.min(interval * 1000, expires - now()), signal);
    if (now() >= expires) break;
    const polled = await options.request(
      `${identityOrigin}/v1/oauth/poll`,
      post({
        flowId: started.flowId,
        pollCapability: started.pollCapability,
        audience: options.audience,
      }),
    );
    const body = polled?.body ?? invalid();
    if (polled?.status === 202 && body.status === "pending") {
      interval = Number(body.retryAfterSeconds);
      if (
        !Number.isSafeInteger(interval) ||
        interval < Number(started.pollAfterSeconds) ||
        interval > 10
      )
        invalid();
      continue;
    }
    if (
      polled?.status !== 200 ||
      body.status !== "complete" ||
      body.assertionType !== "SlopIdentity" ||
      typeof body.assertion !== "string" ||
      !/^slop_assert_v1_[A-Za-z0-9_-]{40,128}$/u.test(body.assertion) ||
      timestamp(body.expiresAt) <= now()
    )
      invalid();
    assertion = body.assertion;
    break;
  }
  if (!assertion)
    throw new Error("GitHub sign-in expired. Please sign in again.");
  options.saveAuthorization?.(null);
  return assertion;
}
