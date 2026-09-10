/** Browser adapter for the canonical wallet-claim/run-receipt OAuth protocol. */
import { isSolanaAddress } from "./wallets";

const IDENTITY = "https://identity.slop.cash";
const API = "https://api.slop.cash";
const AUDIENCE = "private-trace-api";
export interface WalletRegistrationIdentity {
  githubActorId: string;
  githubLogin: string;
}
export interface RegisteredWalletClaim extends WalletRegistrationIdentity {
  schemaVersion: 1;
  claimId: string;
  address: string;
  source: "d1_registry" | "github_issue" | "profile_readme";
  issueRepository: string | null;
  issueNumber: number | null;
  sourceBodySha256: string;
  observedAt: string;
  recordDigest: string;
  supersedesClaimId: string | null;
}
export interface WalletRegistrationPreview {
  identity: WalletRegistrationIdentity;
  address: string;
  current: RegisteredWalletClaim | null;
  expiresAt: string;
}
export interface WalletRegistrationSession {
  preview: WalletRegistrationPreview;
  confirm: () => Promise<RegisteredWalletClaim>;
  cancel: () => void;
}
export interface WalletRegistrationOptions {
  signal?: AbortSignal;
  fetch?: typeof fetch;
  now?: () => number;
  /** Called only with the validated canonical authorize URL; never bearer secrets. */
  authorize: (url: string) => void;
}

function invalid(): never {
  throw new Error("Wallet service returned an invalid response. Start again.");
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
function identity(value: Record<string, unknown>): WalletRegistrationIdentity {
  if (
    typeof value.githubActorId !== "string" ||
    !/^\d+$/u.test(value.githubActorId) ||
    typeof value.githubLogin !== "string" ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(value.githubLogin)
  )
    invalid();
  return { githubActorId: value.githubActorId, githubLogin: value.githubLogin };
}
async function digest(value: unknown) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
async function claim(
  value: unknown,
  owner: WalletRegistrationIdentity,
): Promise<RegisteredWalletClaim> {
  const row = record(value);
  const actor = identity(row);
  if (
    actor.githubActorId !== owner.githubActorId ||
    actor.githubLogin.toLowerCase() !== owner.githubLogin.toLowerCase()
  )
    throw new Error(
      "Returned wallet claim belongs to a different GitHub identity.",
    );
  if (
    row.schemaVersion !== 1 ||
    typeof row.claimId !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(row.claimId) ||
    !isSolanaAddress(row.address) ||
    !["d1_registry", "github_issue", "profile_readme"].includes(
      String(row.source),
    ) ||
    !(
      row.issueRepository === null || typeof row.issueRepository === "string"
    ) ||
    !(
      row.issueNumber === null ||
      (Number.isSafeInteger(row.issueNumber) && Number(row.issueNumber) > 0)
    ) ||
    typeof row.sourceBodySha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(row.sourceBodySha256) ||
    typeof row.recordDigest !== "string" ||
    !/^[a-f0-9]{64}$/u.test(row.recordDigest) ||
    !(
      row.supersedesClaimId === null ||
      (typeof row.supersedesClaimId === "string" &&
        /^[A-Za-z0-9_-]+$/u.test(row.supersedesClaimId))
    )
  )
    invalid();
  timestamp(row.observedAt);
  const canonical = {
    schemaVersion: 1,
    ...actor,
    address: row.address,
    source: row.source,
    issueRepository: row.issueRepository,
    issueNumber: row.issueNumber,
    sourceBodySha256: row.sourceBodySha256,
    observedAt: row.observedAt,
    supersedesClaimId: row.supersedesClaimId,
  };
  if ((await digest(canonical)) !== row.recordDigest)
    throw new Error(
      "Wallet claim proof digest does not match its returned record.",
    );
  return {
    ...canonical,
    claimId: row.claimId,
    recordDigest: row.recordDigest,
  } as RegisteredWalletClaim;
}
async function boundedJson(response: Response) {
  if (!response.body) invalid();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        invalid();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return record(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
  } catch {
    return invalid();
  }
}
function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => {
      clearTimeout(timer);
      reject(new Error("Wallet sign-in cancelled or timed out."));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

/** No registry write until the returned confirm function is explicitly invoked. */
export async function prepareWalletRegistration(
  address: string,
  options: WalletRegistrationOptions,
): Promise<WalletRegistrationSession> {
  if (!isSolanaAddress(address))
    throw new Error("Enter a valid Solana public address (32-byte base58).");
  const now = options.now ?? Date.now;
  const transport = options.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  let token = "";
  const cancel = () => {
    token = "";
    controller.abort();
  };
  // Covers stalled OAuth requests as well as stalled poll responses.
  const oauthTimer = setTimeout(cancel, 5 * 60_000);
  async function request(url: string, init: RequestInit = {}, missing = false) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await transport(url, {
        ...init,
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      });
    } catch {
      throw new Error(
        "Wallet request failed or timed out. Start again to check the current claim.",
      );
    }
    if (missing && response.status === 404) return null;
    if (!response.ok)
      throw new Error(
        response.status === 409
          ? "Wallet claim changed. Start again to review the current claim."
          : `Wallet service returned HTTP ${response.status}. Start again.`,
      );
    return { status: response.status, body: await boundedJson(response) };
  }
  function post(body: unknown): RequestInit {
    return {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    };
  }
  try {
    const started =
      (
        await request(
          `${IDENTITY}/v1/oauth/start`,
          post({ audience: AUDIENCE }),
        )
      )?.body ?? invalid();
    const expires = timestamp(started.expiresAt);
    if (
      expires <= now() ||
      expires > now() + 5 * 60_000 ||
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
      authorization.origin !== IDENTITY ||
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
    options.authorize(authorization.href);
    let assertion = "";
    while (now() < expires) {
      await delay(Math.min(interval * 1000, expires - now()), signal);
      if (now() >= expires) break;
      const polled = await request(
        `${IDENTITY}/v1/oauth/poll`,
        post({
          flowId: started.flowId,
          pollCapability: started.pollCapability,
          audience: AUDIENCE,
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
    if (!assertion) throw new Error("GitHub sign-in expired. Start again.");
    const authenticated =
      (
        await request(`${API}/api/v1/auth/session`, {
          method: "POST",
          headers: { "X-Slop-Identity-Assertion": assertion },
        })
      )?.body ?? invalid();
    assertion = "";
    if (
      authenticated.tokenType !== "Bearer" ||
      typeof authenticated.token !== "string" ||
      authenticated.token.length < 20 ||
      authenticated.token.length > 4096
    )
      invalid();
    token = authenticated.token;
    authenticated.token = "";
    const sessionExpires = timestamp(authenticated.expiresAt);
    let payload: Record<string, unknown>;
    try {
      payload = record(
        JSON.parse(
          atob(token.split(".")[1].replace(/-/gu, "+").replace(/_/gu, "/")),
        ),
      );
    } catch {
      invalid();
    }
    // Display identity comes from the trusted HTTPS session response. The API
    // verifies its signature and authority on every authenticated request.
    const owner = identity({
      githubActorId: payload.githubId,
      githubLogin: payload.githubLogin,
    });
    if (
      payload.iss !== "slop.cash" ||
      payload.aud !== AUDIENCE ||
      payload.sub !== `github:${owner.githubActorId}` ||
      payload.exp !== sessionExpires / 1000 ||
      sessionExpires <= now()
    )
      invalid();
    const currentResponse = await request(
      `${API}/api/v1/wallet-claims/current`,
      { headers: { Authorization: `Bearer ${token}` } },
      true,
    );
    const current = currentResponse
      ? await claim(currentResponse.body, owner)
      : null;
    clearTimeout(oauthTimer);
    const sessionTimer = setTimeout(
      cancel,
      Math.min(sessionExpires - now(), 10 * 60_000),
    );
    const dispose = () => {
      clearTimeout(sessionTimer);
      cancel();
    };
    signal.addEventListener(
      "abort",
      () => {
        token = "";
        clearTimeout(sessionTimer);
      },
      { once: true },
    );
    const preview = {
      identity: owner,
      address,
      current,
      expiresAt: new Date(sessionExpires).toISOString(),
    };
    let used = false;
    return {
      preview: structuredClone(preview),
      cancel: dispose,
      confirm: async () => {
        if (used || signal.aborted || !token || now() >= sessionExpires)
          throw new Error(
            "Wallet preview expired or was already submitted. Start again.",
          );
        used = true;
        try {
          if (current?.address === address) return current;
          const result =
            (
              await request(`${API}/api/v1/wallet-claims`, {
                ...post({
                  address,
                  supersedesClaimId: current?.claimId ?? null,
                }),
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
              })
            )?.body ?? invalid();
          const created = await claim(result, owner);
          if (
            created.address !== address ||
            created.supersedesClaimId !== (current?.claimId ?? null) ||
            created.source !== "d1_registry" ||
            created.issueRepository !== null ||
            created.issueNumber !== null ||
            created.sourceBodySha256 !==
              (await digest({
                schemaVersion: 1,
                githubActorId: owner.githubActorId,
                address,
                supersedesClaimId: current?.claimId ?? null,
              }))
          )
            throw new Error(
              "Returned wallet registration does not match the confirmed address and predecessor.",
            );
          return created;
        } finally {
          dispose();
        }
      },
    };
  } catch (error) {
    cancel();
    throw error;
  } finally {
    clearTimeout(oauthTimer);
  }
}
