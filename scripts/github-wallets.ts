/**
 * Resolves a Solana wallet marker from a canonical Slop claim issue or an
 * immutable revision of the contributor's public profile README. API responses
 * are bounded and every source is rebound to the exact GitHub actor.
 */

import type { WalletProof } from "../src/lib/rewards";
import { isSolanaAddress, parsePublishedWallet } from "../src/lib/wallets";

const API_ORIGIN = "https://api.github.com";
const WALLET_AUTHORITY = "https://api.slop.cash";
const MAX_API_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_API_ATTEMPTS = 4;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

async function boundedApiBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0) {
      throw new Error(
        "GitHub wallet lookup returned an invalid Content-Length",
      );
    }
    if (parsedLength > MAX_API_RESPONSE_BYTES) {
      throw new Error("GitHub wallet lookup response is oversized");
    }
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new Error("GitHub wallet lookup returned no readable body");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let byteLength = 0;
  let body = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_API_RESPONSE_BYTES) {
        throw new RangeError(
          "GitHub wallet lookup response exceeded its size limit",
        );
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    body += decoder.decode();
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error("GitHub wallet lookup response is not valid UTF-8", {
        cause: error,
      });
    }
    throw error;
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
      let response: Response;
      try {
        response = await fetchImpl(`${API_ORIGIN}${path}`, {
          headers: {
            Accept: "application/vnd.github+json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            "User-Agent": "slop-wallet-observer/1",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          redirect: "error",
          signal: controller.signal,
        });
      } catch (error) {
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
      if (
        [502, 503, 504].includes(response.status) &&
        attempt < MAX_API_ATTEMPTS
      ) {
        await retryDelay(attempt);
        continue;
      }
      if (response.status === 404 || response.status === 409) return null;
      if (!response.ok) {
        throw new Error(
          `GitHub wallet lookup failed with HTTP ${response.status}`,
        );
      }
      const body = await boundedApiBody(response);
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
      let response: Response;
      try {
        response = await fetchImpl(`${WALLET_AUTHORITY}${path}`, {
          headers: {
            Accept: "application/json",
            "User-Agent": "slop-wallet-observer/1",
          },
          redirect: "error",
          signal: controller.signal,
        });
      } catch (error) {
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
      if (
        [502, 503, 504].includes(response.status) &&
        attempt < MAX_API_ATTEMPTS
      ) {
        await retryDelay(attempt);
        continue;
      }
      if (response.status === 404) return null;
      if (!response.ok) {
        throw new Error(
          `Slop wallet registry failed with HTTP ${response.status}`,
        );
      }
      const body = await boundedApiBody(response);
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
  login: string,
  observedAt: string,
  fetchImpl: FetchLike,
): Promise<WalletProof | null> {
  const response = await registryJson(
    `/api/v1/wallet-claims/actors/${githubNumericId}/current`,
    fetchImpl,
  );
  if (response === null) return null;
  const claim = object(response, "Slop wallet registry claim");
  if (
    claim.schemaVersion !== 1 ||
    typeof claim.claimId !== "string" ||
    !/^[A-Za-z0-9_-]+$/u.test(claim.claimId) ||
    claim.githubActorId !== githubNumericId ||
    typeof claim.githubLogin !== "string" ||
    claim.githubLogin.toLowerCase() !== login.toLowerCase() ||
    !isSolanaAddress(claim.address) ||
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
    address: claim.address,
    chain: "solana",
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
  options: { fetch?: FetchLike; token?: string } = {},
): Promise<WalletProof | null> {
  if (!/^[A-Za-z0-9_=-]{4,128}$/u.test(actorIdInput)) {
    throw new TypeError("GitHub actor id is invalid");
  }
  const login = githubLogin(loginInput);
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new TypeError("Wallet observation time is invalid");
  }
  const fetchImpl = options.fetch ?? fetch;
  const identityResponse = await apiJson(
    `/users/${encodeURIComponent(login)}`,
    options.token,
    fetchImpl,
  );
  if (identityResponse === null) return null;
  const identity = object(identityResponse, "GitHub wallet actor identity");
  if (
    !Number.isSafeInteger(identity.id) ||
    Number(identity.id) < 1 ||
    identity.node_id !== actorIdInput ||
    typeof identity.login !== "string" ||
    identity.login.toLowerCase() !== login.toLowerCase()
  ) {
    throw new TypeError("GitHub wallet actor identity changed");
  }
  const registryWallet = await fetchRegistryWallet(
    String(identity.id),
    actorIdInput,
    login,
    observedAt,
    fetchImpl,
  );
  if (registryWallet) return registryWallet;
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
  const published = parsePublishedWallet(decoded.toString("utf8"));
  if (!published) return null;
  return {
    address: published.address,
    chain: "solana",
    observedAt,
    sourceCommit: commit.sha,
    sourceUrl: `https://github.com/${repository}/blob/${commit.sha}/${readme.path}`,
  };
}
