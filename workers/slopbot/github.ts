// GitHub App plumbing: webhook signatures, App JWT, installation tokens, and
// the few REST calls Slopbot is allowed to make (BOT-01, slopbot-v2 permissions).

const API = "https://api.github.com";
const encoder = new TextEncoder();

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyWebhookSignature(
  secret: string,
  body: string,
  header: string | null,
): Promise<boolean> {
  if (header === null || !header.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = `sha256=${hex(await crypto.subtle.sign("HMAC", key, encoder.encode(body)))}`;
  return timingSafeEqual(expected, header);
}

function base64url(input: ArrayBuffer | string): string {
  const bytes =
    typeof input === "string" ? encoder.encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

// GitHub issues PKCS#1 keys; Workers WebCrypto imports PKCS#8 only. The secret
// must be converted once with `openssl pkcs8 -topk8 -nocrypt` (README).
async function appJwt(appId: string, pkcs8Pem: string): Promise<string> {
  if (!pkcs8Pem.includes("-----BEGIN PRIVATE KEY-----")) {
    throw new Error("SLOPBOT_APP_PRIVATE_KEY must be a PKCS#8 PEM");
  }
  const der = Uint8Array.from(
    atob(pkcs8Pem.replace(/-----[^-]+-----/gu, "").replace(/\s+/gu, "")),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(
    JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }),
  )}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    encoder.encode(unsigned),
  );
  return `${unsigned}.${base64url(signature)}`;
}

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export class GitHubClient {
  private constructor(private readonly token: string) {}

  static async forInstallation(
    appId: string,
    privateKey: string,
    installationId: number,
  ) {
    const jwt = await appJwt(appId, privateKey);
    const response = await fetch(
      `${API}/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: headers(jwt),
      },
    );
    if (!response.ok)
      throw new GitHubError(
        response.status,
        "installation token request failed",
      );
    const body = (await response.json()) as { token: string };
    return new GitHubClient(body.token);
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T | null }> {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        ...headers(this.token),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    if (
      response.status === 204 ||
      response.status === 404 ||
      response.status === 302
    ) {
      return { status: response.status, data: null };
    }
    if (!response.ok) {
      throw new GitHubError(
        response.status,
        `${method} ${path} returned ${response.status}`,
      );
    }
    return { status: response.status, data: (await response.json()) as T };
  }

  async get<T>(path: string): Promise<T | null> {
    return (await this.request<T>("GET", path)).data;
  }

  // Raw file text at an exact commit, bounded. null when absent.
  async fileText(
    owner: string,
    repo: string,
    path: string,
    ref: string,
    maxBytes: number,
  ) {
    const file = await this.get<{
      type: string;
      size: number;
      content?: string;
      encoding?: string;
    }>(
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path).replaceAll("%2F", "/")}?ref=${ref}`,
    );
    if (
      file === null ||
      file.type !== "file" ||
      file.content === undefined ||
      file.encoding !== "base64"
    ) {
      return null;
    }
    const bytes = Uint8Array.from(
      atob(file.content.replace(/\s+/gu, "")),
      (c) => c.charCodeAt(0),
    );
    const truncated = bytes.length > maxBytes;
    return {
      text: new TextDecoder().decode(
        truncated ? bytes.slice(0, maxBytes) : bytes,
      ),
      truncated,
    };
  }
}

function headers(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "user-agent": "slopbot",
    "x-github-api-version": "2022-11-28",
  };
}

export type Exemption = "exempt" | "not-exempt" | "unknown";

// Never trust author_association: private org membership reads as
// CONTRIBUTOR or NONE. Check repository permission and org membership directly.
export async function authorExemption(
  github: GitHubClient,
  owner: { login: string; id: number; type: string },
  repo: string,
  author: { login: string; id: number },
): Promise<Exemption> {
  if (author.id === owner.id) return "exempt";
  try {
    const permission = await github.get<{
      permission: string;
      role_name?: string;
    }>(
      `/repos/${owner.login}/${repo}/collaborators/${author.login}/permission`,
    );
    if (
      permission !== null &&
      ["admin", "maintain", "write"].includes(
        permission.role_name ?? permission.permission,
      )
    ) {
      return "exempt";
    }
    if (owner.type === "Organization") {
      const membership = await github.request(
        "GET",
        `/orgs/${owner.login}/members/${author.login}`,
      );
      if (membership.status === 204) return "exempt";
      if (membership.status !== 404) return "unknown";
    }
    return "not-exempt";
  } catch {
    return "unknown";
  }
}
