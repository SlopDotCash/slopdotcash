/**
 * An in-memory GitHub for private intake tests. It answers the HTTP calls
 * the real adapter makes (OAuth code exchange, `/user`, advisory report,
 * read and listing, and the App installation check), so tests run the real
 * request mapping and 201 validation against fault modes. It keeps no log
 * and never prints a request body.
 */
import {
  githubAdvisoryClient,
  type IntakeInstallationCheck,
  type PrivateAdvisoryClient,
} from "../backend/security/github-advisories";

export type CreateFault =
  | "ok"
  | "timeout-after-create"
  | "5xx-after-create"
  | "5xx-before-create"
  | "duplicate-after-create"
  | "wrong-author-201"
  | "malformed-201"
  | "422"
  | "403"
  | "403-secondary-rate-limit"
  | "403-primary-rate-limit"
  | "429"
  | "404"
  | "401";
export type ListFault = "ok" | "error" | "paginated";
export type GetFault = "ok" | "error";

type Advisory = {
  ghsa_id: string;
  html_url: string;
  summary: string;
  description: string;
  severity: string | null;
  cvss: { vector_string: string | null; score: number | null } | null;
  cwe_ids: string[];
  vulnerabilities: unknown[] | null;
  author: { id: number; login: string };
  credits_detailed: { user: { id: number; login: string }; type: string }[];
  /** Present only for a private vulnerability report. */
  submission: { accepted: boolean } | null;
  state: string;
  created_at: string;
};

const ALPHABET = "23456789cfghjmpqrvwx";

export const FAKE_API = "https://api.github.fake";
export const FAKE_OAUTH = "https://github.fake";

export function fakeGithub(options: { now: () => Date }) {
  const advisories: { repository: string; advisory: Advisory }[] = [];
  /** Access token to account. */
  const users = new Map<string, { id: number; login: string }>();
  /** OAuth code to the account it authorizes and the PKCE verifier. */
  const codes = new Map<string, { id: number; login: string }>();
  const installed = new Set<string>();
  /** Former repository path to its numeric id, as after a GitHub rename. */
  const moved = new Map<string, number>();
  const faults: { create: CreateFault; list: ListFault; get: GetFault } = {
    create: "ok",
    list: "ok",
    get: "ok",
  };
  const counts = { posts: 0, lists: 0, gets: 0 };
  let beforeCreate: (() => void) | null = null;
  let issued = 0;
  let createdOffsetSeconds = 0;

  const ghsa = () => {
    issued += 1;
    let n = issued * 7919;
    const part = () => {
      let out = "";
      for (let i = 0; i < 4; i += 1) {
        out += ALPHABET[n % ALPHABET.length];
        n = Math.floor(n / ALPHABET.length) + 3;
      }
      return out;
    };
    return `GHSA-${part()}-${part()}-${part()}`;
  };

  const store = (
    repository: string,
    author: { id: number; login: string },
    fields: Record<string, unknown>,
    createdAt?: string,
    extra: Partial<
      Pick<Advisory, "credits_detailed" | "submission" | "state">
    > = {},
  ): Advisory => {
    const id = ghsa();
    const cvss =
      typeof fields.cvss_vector_string === "string"
        ? { vector_string: fields.cvss_vector_string, score: null }
        : null;
    const advisory: Advisory = {
      ghsa_id: id,
      html_url: `https://github.com/${repository}/security/advisories/${id}`,
      summary: String(fields.summary ?? ""),
      description: String(fields.description ?? ""),
      severity: typeof fields.severity === "string" ? fields.severity : null,
      cvss,
      cwe_ids: Array.isArray(fields.cwe_ids)
        ? (fields.cwe_ids as string[])
        : [],
      vulnerabilities: Array.isArray(fields.vulnerabilities)
        ? fields.vulnerabilities
        : null,
      author,
      credits_detailed: [{ user: author, type: "reporter" }],
      submission: { accepted: false },
      state: "triage",
      created_at:
        createdAt ??
        new Date(
          options.now().getTime() + createdOffsetSeconds * 1000,
        ).toISOString(),
      ...extra,
    };
    advisories.push({ repository: repository.toLowerCase(), advisory });
    return advisory;
  };

  const reply = (status: number, body?: unknown, headers = {}) =>
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });

  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const target = new URL(url);
    const method = init.method ?? "GET";
    const auth = new Headers(init.headers).get("authorization") ?? "";
    const user = users.get(auth.replace(/^Bearer /u, ""));
    if (target.origin === FAKE_OAUTH) {
      if (
        method === "POST" &&
        target.pathname === "/login/oauth/access_token"
      ) {
        const form = new URLSearchParams(String(init.body));
        const account = codes.get(form.get("code") ?? "");
        if (!account || !form.get("code_verifier"))
          return reply(200, { error: "bad_verification_code" });
        codes.delete(form.get("code") ?? "");
        const token = `ghu_fake${String(users.size + 1).padStart(30, "0")}`;
        users.set(token, account);
        return reply(200, { access_token: token, token_type: "bearer" });
      }
      return reply(404);
    }
    if (target.origin !== FAKE_API) return reply(404);
    const path = target.pathname;
    // GitHub answers a renamed or transferred repository's former path with
    // a redirect to its numeric id: 301 for GET, 307 for other methods.
    const former = /^\/repos\/([^/]+\/[^/]+)(\/.*)?$/u.exec(path);
    const movedId = former
      ? moved.get(decodeURIComponent(former[1]).toLowerCase())
      : undefined;
    if (former && movedId !== undefined)
      return reply(
        method === "GET" ? 301 : 307,
        { message: "Moved Permanently" },
        {
          location: `${FAKE_API}/repositories/${movedId}${former[2] ?? ""}${target.search}`,
        },
      );
    const installation = /^\/repos\/([^/]+\/[^/]+)\/installation$/u.exec(path);
    if (installation)
      return installed.has(decodeURIComponent(installation[1]).toLowerCase())
        ? reply(200, { id: 4242 })
        : reply(404, { message: "Not Found" });
    if (user === undefined) return reply(401, { message: "Bad credentials" });
    if (method === "GET" && path === "/user") return reply(200, user);
    const reports =
      /^\/repos\/([^/]+\/[^/]+)\/security-advisories\/reports$/u.exec(path);
    if (method === "POST" && reports) {
      counts.posts += 1;
      const hook = beforeCreate;
      beforeCreate = null;
      hook?.();
      const repository = decodeURIComponent(reports[1]);
      const fields = JSON.parse(String(init.body)) as Record<string, unknown>;
      switch (faults.create) {
        case "5xx-before-create":
          return reply(502, { message: "upstream" });
        case "422":
          return reply(422, { message: "Validation Failed" });
        case "403":
          return reply(403, { message: "Forbidden" });
        case "403-secondary-rate-limit":
          return reply(403, {
            message:
              "You have exceeded a secondary rate limit and have been temporarily blocked from content creation. Please retry your request again later.",
          });
        case "403-primary-rate-limit":
          return reply(
            403,
            { message: "API rate limit exceeded for user ID 1." },
            {
              "x-ratelimit-remaining": "0",
              "x-ratelimit-reset": String(
                Math.floor(options.now().getTime() / 1000) + 600,
              ),
            },
          );
        case "429":
          return reply(
            429,
            { message: "Too Many Requests" },
            { "retry-after": "90" },
          );
        case "404":
          return reply(404, { message: "Not Found" });
        case "401":
          return reply(401, { message: "Bad credentials" });
        case "timeout-after-create":
          store(repository, user, fields);
          throw new DOMException("The operation timed out.", "TimeoutError");
        case "5xx-after-create":
          store(repository, user, fields);
          return reply(504, { message: "gateway timeout" });
        case "duplicate-after-create":
          store(repository, user, fields);
          createdOffsetSeconds += 1;
          store(repository, user, fields);
          return reply(504, { message: "gateway timeout" });
        case "wrong-author-201": {
          const advisory = store(repository, user, fields);
          return reply(201, {
            ...advisory,
            author: { id: 1, login: "someone-else" },
          });
        }
        case "malformed-201":
          store(repository, user, fields);
          return reply(201, { ghsa_id: "GHSA-not-valid" });
        default:
          return reply(201, store(repository, user, fields));
      }
    }
    const one =
      /^\/repos\/([^/]+\/[^/]+)\/security-advisories\/(GHSA-[^/]+)$/u.exec(
        path,
      );
    if (method === "GET" && one) {
      counts.gets += 1;
      if (faults.get === "error") return reply(500, { message: "upstream" });
      const found = advisories.find(
        (entry) =>
          entry.repository === decodeURIComponent(one[1]).toLowerCase() &&
          entry.advisory.ghsa_id === one[2],
      );
      return found
        ? reply(200, found.advisory)
        : reply(404, { message: "Not Found" });
    }
    const list = /^\/repos\/([^/]+\/[^/]+)\/security-advisories$/u.exec(path);
    if (method === "GET" && list) {
      counts.lists += 1;
      if (faults.list === "error") return reply(500, { message: "upstream" });
      const all = advisories
        .filter(
          (entry) =>
            entry.repository === decodeURIComponent(list[1]).toLowerCase(),
        )
        .map((entry) => entry.advisory)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      const perPage =
        faults.list === "paginated"
          ? 1
          : Number(target.searchParams.get("per_page") ?? 30);
      const after = Number(target.searchParams.get("after") ?? 0);
      if (faults.list === "paginated" && after > 0)
        return reply(500, { message: "upstream" });
      const page = all.slice(after, after + perPage);
      const headers: Record<string, string> = {};
      if (after + perPage < all.length || faults.list === "paginated") {
        const next = new URL(target);
        next.searchParams.set("after", String(after + perPage));
        headers.link = `<${next.href}>; rel="next"`;
      }
      return reply(200, page, headers);
    }
    return reply(404, { message: "Not Found" });
  };

  const installation: IntakeInstallationCheck = {
    async installed(repository) {
      const response = await fetch(
        `${FAKE_API}/repos/${repository}/installation`,
        {},
      );
      return response.status === 200
        ? "yes"
        : response.status === 404
          ? "no"
          : "unknown";
    },
  };
  const client: PrivateAdvisoryClient = githubAdvisoryClient({
    fetch,
    apiOrigin: FAKE_API,
    installation,
    now: options.now,
  });

  return {
    fetch,
    client,
    installation,
    faults,
    counts,
    advisories,
    install: (repository: string) => installed.add(repository.toLowerCase()),
    /** Renames `from`: GitHub then redirects its old path to the id. */
    rename: (from: string, id: number) => moved.set(from.toLowerCase(), id),
    /** Issues an OAuth code that authorizes `account`. */
    issueCode: (account: { id: number; login: string }) => {
      const code = `code_${codes.size + 1}_${account.id}`;
      codes.set(code, account);
      return code;
    },
    /** Runs once, inside the next report POST, before it is processed. */
    beforeCreate: (hook: () => void) => {
      beforeCreate = hook;
    },
    /**
     * Adds an advisory as if `author` filed it. `extra` overrides credits,
     * the private-report `submission` object (null for a maintainer's own
     * draft) or the state.
     */
    seed: (
      repository: string,
      author: { id: number; login: string },
      fields: Record<string, unknown>,
      createdAt?: string,
      extra?: Partial<
        Pick<Advisory, "credits_detailed" | "submission" | "state">
      >,
    ) => store(repository, author, fields, createdAt, extra),
  };
}
