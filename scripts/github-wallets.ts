/**
 * Resolves the contributor's wallet on one settlement network from the Slop
 * wallet registry or an immutable revision of the contributor's public profile
 * README. Each network has its own claim lineage; a claim on another network
 * never substitutes. API responses are bounded and every source is rebound to
 * the exact GitHub actor.
 */

import { githubUserIdFromNodeId } from "../src/lib/github-actor";
import type { ProfileReadmeWalletProof, WalletProof } from "../src/lib/rewards";
import {
  isWalletAddress,
  parsePublishedWallets,
  type WalletChain,
} from "../src/lib/wallets";

const API_ORIGIN = "https://api.github.com";
const WALLET_AUTHORITY = "https://api.slop.cash";
const MAX_API_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_API_ATTEMPTS = 4;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

/** Terminal lookup failure: never retried, never reclassified as transport. */
class TerminalWalletLookupError extends Error {}

async function boundedApiBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!/^\d+$/u.test(declaredLength) || !Number.isSafeInteger(parsedLength)) {
      throw new TerminalWalletLookupError(
        "GitHub wallet lookup returned an invalid Content-Length",
      );
    }
    if (parsedLength > MAX_API_RESPONSE_BYTES) {
      throw new TerminalWalletLookupError(
        "GitHub wallet lookup response is oversized",
      );
    }
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new TerminalWalletLookupError(
      "GitHub wallet lookup returned no readable body",
    );
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const decode = (chunk?: Uint8Array, stream = false): string => {
    try {
      return decoder.decode(chunk, { stream });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      throw new TerminalWalletLookupError(
        "GitHub wallet lookup response is not valid UTF-8",
        { cause: error },
      );
    }
  };
  let byteLength = 0;
  let body = "";
  try {
    for (;;) {
      // Stream reads throw TypeError on interrupted transport; callers retry it.
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_API_RESPONSE_BYTES) {
        // Cancellation is best effort; the size violation stays terminal.
        await reader.cancel("response exceeded size limit").catch(() => {});
        throw new TerminalWalletLookupError(
          "GitHub wallet lookup response exceeded its size limit",
        );
      }
      body += decode(chunk.value, true);
    }
    body += decode();
  } finally {
    reader.releaseLock();
  }
  return body;
}

function githubLogin(value: string): string {
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(value)) {
    throw new TypeError("GitHub login is invalid");
  }
  return value;
}

function transientNetworkError(value: unknown): boolean {
  if (value instanceof TypeError) return true;
  if (typeof value !== "object" || value === null) return false;
  const error = value as { code?: unknown; name?: unknown };
  return (
    error.name === "AbortError" ||
    [
      "ConnectionRefused",
      "ECONNREFUSED",
      "ECONNRESET",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "ETIMEDOUT",
      "EAI_AGAIN",
      "UND_ERR_CONNECT_TIMEOUT",
      "UND_ERR_SOCKET",
    ].includes(typeof error.code === "string" ? error.code : "")
  );
}

async function retryDelay(attempt: number): Promise<void> {
  await new Promise<void>((resolveDelay) => {
    setTimeout(resolveDelay, 250 * 2 ** (attempt - 1));
  });
}

async function apiJson(
  path: string,
  token: string | undefined,
  fetchImpl: FetchLike,
): Promise<unknown | null> {
  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let body: string;
      try {
        const response = await fetchImpl(`${API_ORIGIN}${path}`, {
          headers: {
            Accept: "application/vnd.github+json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "User-Agent": "slop-wallet-observer/1",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          redirect: "error",
          signal: controller.signal,
        });
        if (
          [502, 503, 504].includes(response.status) &&
          attempt < MAX_API_ATTEMPTS
        ) {
          await retryDelay(attempt);
          continue;
        }
        if (response.status === 404 || response.status === 409) return null;
        if (!response.ok) {
          throw new TerminalWalletLookupError(
            `GitHub wallet lookup failed with HTTP ${response.status}`,
          );
        }
        // Interrupted body reads use the same transport retry boundary.
        body = await boundedApiBody(response);
      } catch (error) {
        if (error instanceof TerminalWalletLookupError) throw error;
        const retryable =
          controller.signal.aborted || transientNetworkError(error);
        if (retryable && attempt < MAX_API_ATTEMPTS) {
          await retryDelay(attempt);
          continue;
        }
        throw new Error(
          `GitHub wallet lookup network failed (${attempt}/${MAX_API_ATTEMPTS})`,
          { cause: error },
        );
      }
      try {
        return JSON.parse(body);
      } catch (error) {
        throw new Error("GitHub wallet lookup returned invalid JSON", {
          cause: error,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("GitHub wallet lookup exhausted its retry boundary");
}

async function registryJson(
  path: string,
  fetchImpl: FetchLike,
): Promise<unknown | null> {
  for (let attempt = 1; attempt <= MAX_API_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      let body: string;
      try {
        const response = await fetchImpl(`${WALLET_AUTHORITY}${path}`, {
          headers: {
            Accept: "application/json",
            "User-Agent": "slop-wallet-observer/1",
          },
          redirect: "error",
          signal: controller.signal,
        });
        if (
          [502, 503, 504].includes(response.status) &&
          attempt < MAX_API_ATTEMPTS
        ) {
          await retryDelay(attempt);
          continue;
        }
        if (response.status === 404) return null;
        if (!response.ok) {
          throw new TerminalWalletLookupError(
            `Slop wallet registry failed with HTTP ${response.status}`,
          );
        }
        // Interrupted body reads use the same transport retry boundary.
        body = await boundedApiBody(response);
      } catch (error) {
        if (error instanceof TerminalWalletLookupError) throw error;
        const retryable =
          controller.signal.aborted || transientNetworkError(error);
        if (retryable && attempt < MAX_API_ATTEMPTS) {
          await retryDelay(attempt);
          continue;
        }
        throw new Error(
          `Slop wallet registry network failed (${attempt}/${MAX_API_ATTEMPTS})`,
          { cause: error },
        );
      }
      try {
        return JSON.parse(body);
      } catch (error) {
        throw new Error("Slop wallet registry returned invalid JSON", {
          cause: error,
        });
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Slop wallet registry exhausted its retry boundary");
}

function object(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${context} is not an object`);
  }
  return value as Record<string, unknown>;
}

async function fetchRegistryWallet(
  githubNumericId: string,
  sourceActorId: string,
  observedAt: string,
  chain: WalletChain,
  fetchImpl: FetchLike,
): Promise<WalletProof | null> {
  // Solana keeps the original route; the registry defaults it to Solana.
  const response = await registryJson(
    `/api/v1/wallet-claims/actors/${githubNumericId}/current${chain === "solana" ? "" : `?chain=${chain}`}`,
    fetchImpl,
  );
  if (response === null) return null;
  const claim = object(response, "Slop wallet registry claim");
  if (
    claim.schemaVersion !== 1 ||
    typeof claim.claimId !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(claim.claimId) ||
    // The claim is bound to the immutable numeric id. Its login is a display
    // alias recorded at claim time; a later rename keeps the claim (ACC-01).
    claim.githubActorId !== githubNumericId ||
    typeof claim.githubLogin !== "string" ||
    (claim.chain ?? "solana") !== chain ||
    !isWalletAddress(chain, claim.address) ||
    !["d1_registry", "github_issue", "profile_readme"].includes(
      String(claim.source),
    ) ||
    typeof claim.sourceBodySha256 !== "string" ||
    !/^[0-9a-f]{64}$/u.test(claim.sourceBodySha256) ||
    typeof claim.observedAt !== "string" ||
    !Number.isFinite(Date.parse(claim.observedAt)) ||
    Date.parse(claim.observedAt) > Date.parse(observedAt) ||
    typeof claim.recordDigest !== "string" ||
    !/^[0-9a-f]{64}$/u.test(claim.recordDigest)
  ) {
    throw new TypeError("Slop wallet registry claim is invalid");
  }
  return {
    address: claim.address as string,
    chain,
    observedAt,
    sourceActorId,
    sourceClaimId: claim.claimId,
    sourceRecordSha256: claim.recordDigest,
    sourceUrl: `${WALLET_AUTHORITY}/api/v1/wallet-claims/${claim.claimId}`,
  };
}

/** Returns an actor-bound D1 claim, with immutable profile bytes as fallback. */
export async function fetchPublishedGithubWallet(
  actorIdInput: string,
  loginInput: string,
  observedAt: string,
  options: {
    chain?: WalletChain;
    fetch?: FetchLike;
    token?: string;
    /**
     * Set by the reward cycle generator for every actor, scored or carried.
     * `readmeProof` is the README proof that the reviewed prior manifest froze
     * for the actor id, or null. A cycle row may not gain a new README proof
     * (readme-proof-binding.ts). Unset: the live README is read (legacy
     * funding preparations only).
     */
    prior?: { readmeProof: WalletProof | null };
  } = {},
): Promise<WalletProof | null> {
  const chain = options.chain ?? "solana";
  if (!/^[A-Za-z0-9_=-]{4,128}$/u.test(actorIdInput)) {
    throw new TypeError("GitHub actor id is invalid");
  }
  const recordedLogin = githubLogin(loginInput);
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new TypeError("Wallet observation time is invalid");
  }
  const fetchImpl = options.fetch ?? fetch;
  // The node id encodes the numeric id, so the identity is read by that
  // immutable id. A recorded login can be stale (rename) or now belong to
  // another account (handle reuse); neither may change whose wallet is read.
  const numericId = githubUserIdFromNodeId(actorIdInput);
  const identityResponse = await apiJson(
    numericId === null
      ? `/users/${encodeURIComponent(loginInput)}`
      : `/user/${numericId}`,
    options.token,
    fetchImpl,
  );
  if (identityResponse === null) return null;
  const identity = object(identityResponse, "GitHub wallet actor identity");
  if (
    !Number.isSafeInteger(identity.id) ||
    Number(identity.id) < 1 ||
    (numericId !== null && String(identity.id) !== numericId) ||
    identity.node_id !== actorIdInput ||
    typeof identity.login !== "string" ||
    (numericId === null &&
      identity.login.toLowerCase() !== loginInput.toLowerCase())
  ) {
    throw new TypeError("GitHub wallet actor identity changed");
  }
  const login = githubLogin(identity.login);
  const registryWallet = await fetchRegistryWallet(
    String(identity.id),
    actorIdInput,
    observedAt,
    chain,
    fetchImpl,
  );
  if (registryWallet) return registryWallet;
  if (options.prior) {
    return boundReadmeWallet(
      options.prior.readmeProof,
      recordedLogin,
      login,
      chain,
      (readmeLogin) =>
        fetchProfileReadmeWallet(
          readmeLogin,
          observedAt,
          chain,
          options.token,
          fetchImpl,
        ),
    );
  }
  // A README proof has no actor id. Proposal validation and payment import
  // bind it to the login recorded for the actor (`actor.login`). After a
  // rename that login is stale, so a proof under the current login would be
  // rejected there and stop the whole cycle. Then no README is read: the row
  // stays unclaimed, and the actor can claim through the actor-bound
  // registry. The README of whoever now holds the old login is never read,
  // so a reused handle receives nothing (ACC-01).
  if (login.toLowerCase() !== recordedLogin.toLowerCase()) return null;
  return fetchProfileReadmeWallet(
    login,
    observedAt,
    chain,
    options.token,
    fetchImpl,
  );
}

/**
 * The README wallet of a cycle row (scored or carried). The verifier accepts a
 * README proof only if it is byte-equal to the proof that the reviewed prior
 * manifest froze for the same actor id, because the recorded login can now
 * belong to another account and offline nothing else binds a README to the
 * actor id. The frozen proof is bound to the immutable actor id by that
 * manifest, so its login is only a display alias (ACC-01). So no new README
 * proof is returned:
 * - no frozen README proof: null (the row stays unclaimed; the actor can use
 *   the actor-bound registry).
 * - a frozen README proof: the README under the current login of the actor id
 *   is read again, also when the frozen proof names another login (the actor
 *   renamed, before or after the snapshot). The frozen proof is kept only if
 *   that README still publishes the same address (ACC-01: a rename keeps
 *   claims), else null, so a README change applies to the next cycle (WAL-03).
 *   The README of whoever now holds the old login is never read.
 */
export async function boundReadmeWallet(
  priorWallet: WalletProof | null,
  _recordedLogin: string,
  currentLogin: string,
  chain: WalletChain,
  readCurrent: (login: string) => Promise<WalletProof | null>,
): Promise<ProfileReadmeWalletProof | null> {
  if (
    !priorWallet ||
    !("sourceCommit" in priorWallet) ||
    priorWallet.chain !== chain
  )
    return null;
  const proofLogin = /^https:\/\/github\.com\/([^/]+)\/\1\/blob\//iu.exec(
    priorWallet.sourceUrl,
  )?.[1];
  if (!proofLogin) return null;
  // currentLogin is read through the immutable numeric id, so only a README
  // under that login is the actor's own README now.
  const current = await readCurrent(currentLogin);
  return current &&
    current.chain === priorWallet.chain &&
    current.address === priorWallet.address
    ? priorWallet
    : null;
}

async function fetchProfileReadmeWallet(
  login: string,
  observedAt: string,
  chain: WalletChain,
  token: string | undefined,
  fetchImpl: FetchLike,
): Promise<WalletProof | null> {
  const options = { token };
  const repository = `${login}/${login}`;
  const readmeResponse = await apiJson(
    `/repos/${encodeURIComponent(login)}/${encodeURIComponent(login)}/readme`,
    options.token,
    fetchImpl,
  );
  if (readmeResponse === null) return null;
  const readme = object(readmeResponse, "GitHub profile README");
  if (
    typeof readme.path !== "string" ||
    readme.path.toLowerCase() !== "readme.md"
  ) {
    throw new TypeError("GitHub profile README path is not canonical");
  }

  const commitsResponse = await apiJson(
    `/repos/${encodeURIComponent(login)}/${encodeURIComponent(login)}/commits?path=${encodeURIComponent(readme.path)}&per_page=1`,
    options.token,
    fetchImpl,
  );
  if (commitsResponse === null) return null;
  if (!Array.isArray(commitsResponse) || commitsResponse.length !== 1) {
    throw new TypeError("GitHub profile README has no unique latest commit");
  }
  const commit = object(commitsResponse[0], "GitHub profile README commit");
  if (typeof commit.sha !== "string" || !/^[0-9a-f]{40}$/u.test(commit.sha)) {
    throw new TypeError("GitHub profile README commit SHA is invalid");
  }

  const immutableResponse = await apiJson(
    `/repos/${encodeURIComponent(login)}/${encodeURIComponent(login)}/contents/${encodeURIComponent(readme.path)}?ref=${commit.sha}`,
    options.token,
    fetchImpl,
  );
  if (immutableResponse === null) {
    throw new TypeError("Immutable GitHub profile README disappeared");
  }
  const immutableReadme = object(
    immutableResponse,
    "immutable GitHub profile README",
  );
  if (
    immutableReadme.type !== "file" ||
    typeof immutableReadme.path !== "string" ||
    immutableReadme.path.toLowerCase() !== readme.path.toLowerCase() ||
    immutableReadme.encoding !== "base64" ||
    typeof immutableReadme.content !== "string"
  ) {
    throw new TypeError("Immutable GitHub profile README response is invalid");
  }
  const normalizedBase64 = immutableReadme.content.replace(/\s/gu, "");
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      normalizedBase64,
    )
  ) {
    throw new TypeError("Immutable GitHub profile README encoding is invalid");
  }
  const decoded = Buffer.from(normalizedBase64, "base64");
  if (decoded.byteLength > 1_000_000) {
    throw new TypeError("Immutable GitHub profile README is too large");
  }
  const canonicalBase64 = decoded.toString("base64");
  if (canonicalBase64 !== normalizedBase64) {
    throw new TypeError(
      "Immutable GitHub profile README base64 is not canonical",
    );
  }
  const published = parsePublishedWallets(decoded.toString("utf8"))[chain];
  if (!published) return null;
  return {
    address: published.address,
    chain,
    observedAt,
    sourceCommit: commit.sha,
    sourceUrl: `https://github.com/${repository}/blob/${commit.sha}/${readme.path}`,
  };
}
