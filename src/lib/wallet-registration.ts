import { browserDeployment } from "./browser-deployment";
/** Browser adapter for the canonical wallet-claim/run-receipt OAuth protocol. */
import {
  type IdentityAuthorization,
  requestIdentityAssertion,
} from "./identity-flow";
import { isWalletAddress, isWalletChain, type WalletChain } from "./wallets";

const IDENTITY = browserDeployment.identity;
const API = browserDeployment.api;
const AUDIENCE = "private-trace-api";
export interface WalletRegistrationIdentity {
  githubActorId: string;
  githubLogin: string;
}
export interface RegisteredWalletClaim extends WalletRegistrationIdentity {
  chain: WalletChain;
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
  chain: WalletChain;
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
export type WalletAuthorization = IdentityAuthorization;
export interface WalletRegistrationOptions {
  chain?: WalletChain;
  /** Short-lived per-tab state for same-tab navigation; never an API session token. */
  resume?: unknown;
  saveAuthorization?: (value: WalletAuthorization | null) => void;
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
  chain: WalletChain,
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
    !isWalletAddress(chain, row.address) ||
    (row.chain ?? "solana") !== chain ||
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
    ...(chain === "base" ? { chain } : {}),
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
    chain,
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
/** No registry write until the returned confirm function is explicitly invoked. */
export async function prepareWalletRegistration(
  address: string,
  options: WalletRegistrationOptions,
): Promise<WalletRegistrationSession> {
  const chain = options.chain ?? "solana";
  if (!isWalletChain(chain) || !isWalletAddress(chain, address))
    throw new Error(
      chain === "base"
        ? "Enter a valid lowercase Base public address (0x and 40 hexadecimal characters)."
        : "Enter a valid Solana public address (32-byte base58).",
    );
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
    let assertion = await requestIdentityAssertion({
      origin: IDENTITY,
      audience: AUDIENCE,
      signal,
      now,
      resume: options.resume,
      saveAuthorization: options.saveAuthorization,
      authorize: options.authorize,
      request,
    });
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
      `${API}/api/v1/wallet-claims/current${chain === "base" ? "?chain=base" : ""}`,
      { headers: { Authorization: `Bearer ${token}` } },
      true,
    );
    const current = currentResponse
      ? await claim(currentResponse.body, owner, chain)
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
      chain,
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
                  ...(chain === "base" ? { chain } : {}),
                  supersedesClaimId: current?.claimId ?? null,
                }),
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
              })
            )?.body ?? invalid();
          const created = await claim(result, owner, chain);
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
                ...(chain === "base" ? { chain } : {}),
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
