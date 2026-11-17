// spec/backend/identity.md, "The callback claims a pending flow once and clears its verifier before contacting GitHub"
import { createHash, createSign, verify } from "node:crypto";
import { type Access, type Account, type App, type GitHubWorld, type Installation, type Permissions, type Repository, accessRank } from "./world.ts";

export type Credential =
  | { readonly kind: "anonymous" }
  | { readonly kind: "user"; readonly account: Account }
  | { readonly kind: "app"; readonly app: App }
  | {
    readonly kind: "installation";
    readonly installation: Installation;
    readonly repositories: "all" | ReadonlySet<number>;
    readonly permissions: Permissions;
    readonly expiresAt: number;
  };

export type Authenticated = { readonly credential: Credential } | { readonly refused: string };

interface Code {
  readonly app: App;
  readonly account: Account;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly expiresAt: number;
}

export interface TokenScope {
  readonly repositories?: ReadonlyArray<string>;
  readonly repositoryIds?: ReadonlyArray<number>;
  readonly permissions?: Permissions;
}

const hour = 3_600_000;
const privateReads: ReadonlySet<string> = new Set(["repository_advisories", "administration", "members"]);

/** @throws {never} */
export function base64url(bytes: Uint8Array | string): string {
  return Buffer.from(bytes).toString("base64url");
}

/** @throws {never} */
export function label(credential: Credential): string {
  switch (credential.kind) {
    case "anonymous": return "anonymous";
    case "user": return `user:${credential.account.login}`;
    case "app": return `app:${credential.app.slug}`;
    case "installation": return `installation:${credential.installation.id}`;
    default: {
      const _exhaustive: never = credential;
      return _exhaustive;
    }
  }
}

export class Credentials {
  readonly #tokens = new Map<string, Credential>();
  readonly #codes = new Map<string, Code>();
  #issued = 0;

  constructor(readonly world: GitHubWorld) {}

  #token(prefix: string, credential: Credential): string {
    this.#issued += 1;
    const token = `${prefix}_${String(this.#issued).padStart(36, "0")}`;
    this.#tokens.set(token, credential);
    return token;
  }

  /** @throws {never} */
  user(account: Account): string {
    return this.#token("ghu", { kind: "user", account });
  }

  /** @throws {never} */
  installation(installation: Installation, scope: { readonly repositories: "all" | ReadonlySet<number>; readonly permissions: Permissions }): { readonly token: string; readonly expiresAt: number } {
    const expiresAt = this.world.now() + hour;
    return { token: this.#token("ghs", { kind: "installation", installation, ...scope, expiresAt }), expiresAt };
  }

  /** @throws {never} */
  scope(installation: Installation, requested: TokenScope): { readonly repositories: "all" | ReadonlySet<number>; readonly permissions: Permissions } | string {
    const named = (requested.repositories ?? []).map((name) => this.world.findRepo(`${installation.account.login}/${name}`));
    const numbered = (requested.repositoryIds ?? []).map((id) => this.world.repoById(id));
    const repos = [...named, ...numbered];
    if (repos.some((repo) => repo === undefined || !this.world.covers(installation, repo))) return "There is at least one repository that does not exist or is not accessible to the parent installation.";
    const permissions = requested.permissions ?? installation.permissions;
    for (const [name, level] of Object.entries(permissions)) {
      if (accessRank[level] > accessRank[installation.permissions[name] ?? "none"]) return "The permissions requested are not granted to this installation.";
    }
    const narrowed = requested.repositories === undefined && requested.repositoryIds === undefined;
    return { repositories: narrowed ? installation.repositories : new Set(repos.map((repo) => repo?.id ?? 0)), permissions: { metadata: "read", ...permissions } };
  }

  /** @throws {never} */
  authenticate(authorization: string | null): Authenticated {
    if (authorization === null || authorization === "") return { credential: { kind: "anonymous" } };
    const [scheme = "", value = ""] = authorization.split(" ");
    if (!/^(bearer|token)$/iu.test(scheme) || value === "") return { refused: "Bad credentials" };
    if (value.split(".").length === 3) {
      const app = appFromJwt(this.world, value);
      return typeof app === "string" ? { refused: app } : { credential: { kind: "app", app } };
    }
    const found = this.#tokens.get(value);
    if (found === undefined) return { refused: "Bad credentials" };
    if (found.kind === "installation" && (found.expiresAt <= this.world.now() || this.world.installation(found.installation.id) === undefined)) return { refused: "Bad credentials" };
    return { credential: found };
  }

  /** @throws {never} */
  authorize(url: URL): Response {
    const app = this.world.app(url.searchParams.get("client_id") ?? "");
    const account = this.world.findAccount(url.searchParams.get("login") ?? "");
    const redirect = url.searchParams.get("redirect_uri") ?? "";
    const challenge = url.searchParams.get("code_challenge") ?? "";
    if (app === undefined) return Response.json({ error: "unknown_client" }, { status: 404 });
    if (account === undefined || account.kind !== "User" || !/^https?:\/\//u.test(redirect) || challenge === "" || url.searchParams.get("code_challenge_method") !== "S256") {
      return Response.json({ error: "invalid_request" }, { status: 400 });
    }
    this.#issued += 1;
    const code = `fake${String(this.#issued).padStart(16, "0")}`;
    this.#codes.set(code, { app, account, redirectUri: redirect, challenge, expiresAt: this.world.now() + 600_000 });
    const target = new URL(redirect);
    target.searchParams.set("code", code);
    target.searchParams.set("state", url.searchParams.get("state") ?? "");
    return new Response(null, { status: 302, headers: { location: target.href } });
  }

  /** @throws {never} */
  exchange(form: URLSearchParams, json: boolean): Response {
    const code = form.get("code") ?? "";
    const found = this.#codes.get(code);
    this.#codes.delete(code);
    const verifier = form.get("code_verifier") ?? "";
    const redirect = form.get("redirect_uri");
    const outcome: Record<string, string> = found === undefined || found.expiresAt <= this.world.now() ? { error: "bad_verification_code" }
      : found.app.clientId !== form.get("client_id") || found.app.clientSecret !== form.get("client_secret") ? { error: "incorrect_client_credentials" }
      : redirect !== null && redirect !== found.redirectUri ? { error: "redirect_uri_mismatch" }
      : base64url(createHash("sha256").update(verifier).digest()) !== found.challenge ? { error: "bad_verification_code" }
      : { access_token: this.user(found.account), token_type: "bearer", scope: "" };
    return json
      ? Response.json(outcome)
      : new Response(new URLSearchParams(outcome).toString(), { headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" } });
  }
}

function decoded(part: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

/** @throws {never} */
export function appFromJwt(world: GitHubWorld, jwt: string): App | string {
  const [header = "", payload = "", signature = ""] = jwt.split(".");
  const head = decoded(header), claims = decoded(payload);
  if (head?.alg !== "RS256" || claims === undefined) return "A JSON web token could not be decoded";
  const app = world.app(String(claims.iss ?? ""));
  if (app === undefined) return "Integration not found";
  if (!verify("sha256", Buffer.from(`${header}.${payload}`), app.publicKey, Buffer.from(signature, "base64url"))) return "A JSON web token could not be decoded";
  const now = Math.floor(world.now() / 1000);
  const { iat, exp } = claims;
  if (typeof iat !== "number" || !Number.isInteger(iat) || iat > now + 60) return "'Issued at' claim ('iat') must be an Integer representing the time that the assertion was issued";
  if (typeof exp !== "number" || exp <= now) return "'Expiration time' claim ('exp') must be a numeric value representing the future time at which the assertion expires";
  if (exp > now + 600) return "'Expiration time' claim ('exp') is too far in the future";
  return app;
}

/** @throws {Error} */
export function signAppJwt(app: App, claims: { readonly issuedAt: number; readonly expiresAt: number; readonly issuer?: string }): string {
  const unsigned = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64url(JSON.stringify({ iat: claims.issuedAt, exp: claims.expiresAt, iss: claims.issuer ?? app.id }))}`;
  return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(app.privateKeyPem, "base64url")}`;
}

/** @throws {never} */
export function granted(credential: Credential, repo: Repository, world: GitHubWorld, permission: string, level: Access): "granted" | "hidden" | "forbidden" {
  if (credential.kind !== "installation") return "granted";
  const scoped = credential.repositories === "all" ? world.covers(credential.installation, repo) : credential.repositories.has(repo.id);
  if (!scoped) return repo.private ? "hidden" : level === "read" && !privateReads.has(permission) ? "granted" : "forbidden";
  return accessRank[credential.permissions[permission] ?? "none"] >= accessRank[level] ? "granted" : "forbidden";
}
