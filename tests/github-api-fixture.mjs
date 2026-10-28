/**
 * A loopback stand-in for the public GitHub API reads the project registry
 * makes (repository facts, organization membership, the integration-branch
 * head that security vetting pins, the security intake readiness check, and
 * the synthetic private vulnerability reports that verify receipt),
 * so the registry browser lane is deterministic and never
 * spends GitHub's rate limit. The browser's own repository lookup is mocked
 * from the same facts.
 *
 * Contributor flags read account facts: `GET /user/:id` and the member's
 * merged pull requests through `GET /repos/:owner/:repo/issues?creator=`.
 * Accounts are unknown until a test sets them with
 * `PUT /__fixture/github-users/:id?login=&createdAt=&merged=`.
 *
 * It also stands in for the automatic private intake GitHub calls: the
 * intake App's OAuth authorization and code exchange, `/user`, the App
 * installation check, and private vulnerability reports. Advisories live in
 * memory only and are never logged; `/__fixture` routes toggle faults.
 * The Slopbot App's installation and permission reads live under
 * `/__slopbot`, so their state never mixes with the intake App's.
 */
import { createHash } from "node:crypto";
import { createServer } from "node:http";

/** The site session that owns its user repositories. */
export const E2E_OWNER = { githubId: "900000003", login: "e2e-owner" };
/** An organization whose members are never public. */
export const E2E_ORGANIZATION = { githubId: "987654320", login: "example" };

/** Site sessions for the private security bounty roles, by role name. */
export const E2E_SECURITY_ACCOUNTS = Object.freeze({
  "reporter-a": "900000011",
  "reporter-b": "900000012",
  security: "900000013",
  triager: "900000014",
  finance: "900000015",
  dispute: "900000016",
  "security-b": "900000017",
});

/**
 * One maintainer session per Chromium project that runs the registry specs. A
 * moderator bans each one with its project after a confirmed malicious result,
 * so the shared D1 keeps every other session able to list projects.
 */
export const E2E_MAINTAINER_ACCOUNTS = Object.freeze({
  "maintainer-desktop": "900000021",
  "maintainer-mobile": "900000024",
});

/** A fixture user's GitHub actor ID, from its `e2e-<role>` login. */
function fixtureMemberId(login) {
  const role = login.replace(/^e2e-/, "");
  return E2E_SECURITY_ACCOUNTS[role] ?? E2E_MAINTAINER_ACCOUNTS[role];
}

/**
 * The installation token the fixture mints for the slopdotcash App stand-in,
 * only for a repository-scoped "Repository security advisories: read"
 * request. The fixture refuses advisory reads without it.
 */
const E2E_INSTALLATION_TOKEN = "ghs_e2e-fixture-advisory-read-token";

/** Deterministic public facts for a fixture repository. */
export function fixtureRepository(fullName) {
  const [ownerLogin, name] = fullName.split("/");
  const memberId =
    ownerLogin === "e2e-applicant" ? "900000002" : fixtureMemberId(ownerLogin);
  const owner = memberId
    ? { login: ownerLogin, id: Number(memberId), type: "User" }
    : ownerLogin === E2E_OWNER.login
      ? { login: E2E_OWNER.login, id: Number(E2E_OWNER.githubId), type: "User" }
      : {
          // The platform-only bounty gate needs its canonical repository name.
          login:
            ownerLogin === "SlopDotCash" ? ownerLogin : E2E_ORGANIZATION.login,
          id: Number(E2E_ORGANIZATION.githubId),
          type: "Organization",
        };
  let hash = 0;
  for (const character of fullName)
    hash = (hash * 31 + character.charCodeAt(0)) % 100_000;
  return {
    id: 123_400_000 + hash,
    node_id: `R_${fullName.replaceAll(/[^A-Za-z0-9]/gu, "_")}`,
    full_name: `${owner.login}/${name}`,
    description: "A reproducible research tool used by the registry tests.",
    private: false,
    default_branch: "main",
    owner: { ...owner, node_id: `O_${owner.login.replaceAll("-", "_")}` },
  };
}

/** The deterministic head commit of a fixture repository branch. */
export function fixtureBranchHead(fullName, branch) {
  return createHash("sha1").update(`${fullName}#${branch}`).digest("hex");
}

/** A stable integration-branch head, which security vetting pins. */
function fixtureBranch(repository, encodedName) {
  const name = decodeURIComponent(encodedName);
  return { name, commit: { sha: fixtureBranchHead(repository, name) } };
}

const GHSA_ALPHABET = "23456789cfghjmpqrvwx";

/** The fixture's private advisory store and intake App state. */
function privateIntakeFixture() {
  // The App is installed on every fixture repository unless a test removes it.
  const uninstalled = new Set();
  const advisories = [];
  const tokens = new Map();
  const codes = new Map();
  const faults = { create: "ok", list: "ok", get: "ok" };
  // Request bodies the loopback analysis provider received, in order.
  const analysisRequests = [];
  let issued = 0;
  const loginToAccount = (login) => {
    const role = /^e2e-(.+)$/u.exec(login ?? "")?.[1];
    const id = role === undefined ? undefined : E2E_SECURITY_ACCOUNTS[role];
    return id === undefined ? null : { id: Number(id), login };
  };
  const ghsa = () => {
    issued += 1;
    let n = issued * 7919 + 101;
    const part = () => {
      let out = "";
      for (let i = 0; i < 4; i += 1) {
        out += GHSA_ALPHABET[n % GHSA_ALPHABET.length];
        n = Math.floor(n / GHSA_ALPHABET.length) + 3;
      }
      return out;
    };
    return `GHSA-${part()}-${part()}-${part()}`;
  };
  const store = (repository, author, fields) => {
    const id = ghsa();
    const advisory = {
      ghsa_id: id,
      html_url: `https://github.com/${repository}/security/advisories/${id}`,
      summary: String(fields.summary ?? ""),
      description: String(fields.description ?? ""),
      severity: typeof fields.severity === "string" ? fields.severity : null,
      cvss:
        typeof fields.cvss_vector_string === "string"
          ? { vector_string: fields.cvss_vector_string, score: null }
          : null,
      cwe_ids: Array.isArray(fields.cwe_ids) ? fields.cwe_ids : [],
      vulnerabilities: Array.isArray(fields.vulnerabilities)
        ? fields.vulnerabilities
        : null,
      author,
      credits_detailed: [{ user: author, type: "reporter" }],
      submission: { accepted: false },
      state: "triage",
      created_at: new Date(Date.now() - 1000).toISOString(),
    };
    advisories.push({ repository: repository.toLowerCase(), advisory });
    return advisory;
  };
  return {
    uninstalled,
    advisories,
    analysisRequests,
    tokens,
    codes,
    faults,
    loginToAccount,
    store,
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > 512 * 1024) reject(new Error("too large"));
      else chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}

/**
 * Answers the intake routes, or returns false for every other path. Bodies
 * are never logged.
 */
async function handlePrivateIntake(state, request, response, url) {
  const path = url.pathname;
  const send = (status, body, headers = {}) => {
    response.writeHead(status, {
      "content-type": "application/json",
      ...headers,
    });
    response.end(body === undefined ? "" : JSON.stringify(body));
    return true;
  };
  const seedReport = /^\/__fixture\/security-advisories\/([^/]+\/[^/]+)$/u.exec(
    path,
  );
  if (request.method === "POST" && seedReport) {
    const advisory = JSON.parse(await readBody(request));
    state.advisories.push({
      repository: seedReport[1].toLowerCase(),
      advisory,
    });
    return send(204);
  }
  const appControl =
    /^\/__fixture\/intake-app\/([^/]+\/[^/]+)\/(installed|missing)$/u.exec(
      path,
    );
  if (request.method === "PUT" && appControl) {
    if (appControl[2] === "installed")
      state.uninstalled.delete(appControl[1].toLowerCase());
    else state.uninstalled.add(appControl[1].toLowerCase());
    return send(204);
  }
  const faultControl =
    /^\/__fixture\/advisories\/(create|list|get)\/([a-z0-9-]+)$/u.exec(path);
  if (request.method === "PUT" && faultControl) {
    state.faults[faultControl[1]] = faultControl[2];
    return send(204);
  }
  // A loopback stand-in for the Surplus Messages API that the private AI
  // analysis calls in the private-intake lane. It answers one fixed
  // proposal and keeps each request so a test can see what the model read.
  if (request.method === "POST" && path === "/anthropic/v1/messages") {
    if (request.headers.authorization !== "Bearer e2e-fixture-analysis-key")
      return send(401, { type: "error" });
    const body = await readBody(request);
    // Owner decision: request Opus 5.5 through Surplus only.
    if (JSON.parse(body).model !== "claude-opus-5.5")
      return send(400, { type: "error" });
    state.analysisRequests.push(body);
    // Exercise the screening transport before the separate case proposal.
    // This deterministic answer proves routing controls, not model quality.
    if (
      JSON.parse(body).system.startsWith(
        "You screen private vulnerability reports",
      )
    )
      return send(200, {
        type: "message",
        role: "assistant",
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              decision: "legitimate",
              reason:
                "Fixture screening: the report names a concrete local reproduction for private owner review.",
            }),
          },
        ],
      });
    // Slopbot's appeal triage drafts a resolution for a moderator.
    if (JSON.parse(body).system.includes("first triage step for appeals"))
      return send(200, {
        type: "message",
        role: "assistant",
        stop_reason: "end_turn",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              proposedOutcome: "return",
              rationale:
                "Fixture draft: the appeal names a separate withdrawal path that the decision did not review.",
              confidence: 0.72,
            }),
          },
        ],
      });
    return send(200, {
      type: "message",
      role: "assistant",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: JSON.stringify({
            summary:
              "Fixture proposal: the withdraw path skips the owner check, so a crafted proof can drain the vault.",
            severity: "critical",
            potentialLoss: "likely",
            duplicateCaseIds: [],
            rootCauseKey: "vault-withdraw-owner-check",
            remediation: "Require the owner check before every withdraw.",
          }),
        },
      ],
    });
  }
  if (request.method === "GET" && path === "/__fixture/analysis/requests") {
    const needle = url.searchParams.get("containing") ?? "";
    return send(200, {
      count: state.analysisRequests.length,
      containing: state.analysisRequests.filter(
        (body) => needle !== "" && body.includes(needle),
      ).length,
    });
  }
  const countControl = /^\/__fixture\/advisories\/([^/]+\/[^/]+)\/count$/u.exec(
    path,
  );
  if (request.method === "GET" && countControl)
    return send(200, {
      count: state.advisories.filter(
        (entry) => entry.repository === countControl[1].toLowerCase(),
      ).length,
    });
  if (request.method === "GET" && path === "/login/oauth/authorize") {
    const redirect = url.searchParams.get("redirect_uri") ?? "";
    const account = state.loginToAccount(url.searchParams.get("login"));
    if (
      account === null ||
      !/^http:\/\/127\.0\.0\.1:[0-9]{4,5}\//u.test(redirect) ||
      url.searchParams.get("code_challenge_method") !== "S256"
    )
      return send(400, { error: "invalid_request" });
    const code = `fixture_code_${state.codes.size + 1}`;
    state.codes.set(code, account);
    const target = new URL(redirect);
    target.searchParams.set("code", code);
    target.searchParams.set("state", url.searchParams.get("state") ?? "");
    response.writeHead(302, { location: target.href });
    response.end();
    return true;
  }
  if (request.method === "POST" && path === "/login/oauth/access_token") {
    const form = new URLSearchParams(await readBody(request));
    const account = state.codes.get(form.get("code") ?? "");
    if (!account || !form.get("code_verifier"))
      return send(200, { error: "bad_verification_code" });
    state.codes.delete(form.get("code") ?? "");
    const token = `ghu_fixture${String(state.tokens.size + 1).padStart(28, "0")}`;
    state.tokens.set(token, account);
    return send(200, { access_token: token, token_type: "bearer" });
  }
  const installation = /^\/repos\/([^/]+\/[^/]+)\/installation$/u.exec(path);
  const appJwt = /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/u;
  if (request.method === "GET" && installation)
    return appJwt.test(request.headers.authorization ?? "") &&
      !state.uninstalled.has(decodeURIComponent(installation[1]).toLowerCase())
      ? send(200, { id: 4242 })
      : send(404, { message: "Not Found" });
  // Owner decision D10: the App mints one repository-scoped token with
  // advisory read only. Any broader request is refused.
  if (
    request.method === "POST" &&
    path === "/app/installations/4242/access_tokens"
  ) {
    const scope = JSON.parse(await readBody(request));
    return appJwt.test(request.headers.authorization ?? "") &&
      Array.isArray(scope.repositories) &&
      scope.repositories.length === 1 &&
      JSON.stringify(scope.permissions) ===
        JSON.stringify({ repository_advisories: "read" })
      ? send(201, {
          token: E2E_INSTALLATION_TOKEN,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        })
      : send(422, { message: "Invalid scope" });
  }
  const advisoryPath =
    /^\/repos\/([^/]+\/[^/]+)\/security-advisories(?:\/(reports|GHSA-[^/]+))?$/u.exec(
      path,
    );
  if (path !== "/user" && !advisoryPath) return false;
  const token = (request.headers.authorization ?? "").replace(/^Bearer /u, "");
  const user = state.tokens.get(token);
  const readOnly =
    token === E2E_INSTALLATION_TOKEN &&
    request.method === "GET" &&
    advisoryPath;
  if (user === undefined && !readOnly)
    return send(401, { message: "Bad credentials" });
  if (request.method === "GET" && path === "/user") return send(200, user);
  const repository = decodeURIComponent(advisoryPath[1]);
  const own = state.advisories.filter(
    (entry) => entry.repository === repository.toLowerCase(),
  );
  if (request.method === "POST" && advisoryPath[2] === "reports") {
    const fields = JSON.parse(await readBody(request));
    switch (state.faults.create) {
      case "5xx-before-create":
        return send(502, { message: "upstream" });
      case "422":
      case "403":
      case "404":
        return send(Number(state.faults.create), { message: "refused" });
      case "timeout-after-create":
        state.store(repository, user, fields);
        state.faults.create = "ok";
        request.socket.destroy();
        return true;
      default:
        return send(201, state.store(repository, user, fields));
    }
  }
  if (request.method === "GET" && advisoryPath[2]?.startsWith("GHSA-")) {
    if (state.faults.get === "error") return send(500, { message: "upstream" });
    const found = own.find(
      (entry) => entry.advisory.ghsa_id === advisoryPath[2],
    );
    return found
      ? send(200, found.advisory)
      : send(404, { message: "Not Found" });
  }
  if (request.method === "GET" && advisoryPath[2] === undefined) {
    if (state.faults.list === "error")
      return send(500, { message: "upstream" });
    return send(
      200,
      own
        .map((entry) => entry.advisory)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    );
  }
  return send(404, { message: "Not Found" });
}

/**
 * Account facts for contributor flag eligibility. Every merged pull request
 * the fixture reports belongs to the repository that was asked about.
 */
function handleGithubUsers(users, request, response, url) {
  const send = (status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(body === undefined ? "" : JSON.stringify(body));
    return true;
  };
  const control = /^\/__fixture\/github-users\/([1-9][0-9]*)$/u.exec(
    url.pathname,
  );
  if (request.method === "PUT" && control) {
    users.set(control[1], {
      id: Number(control[1]),
      login: url.searchParams.get("login") ?? "",
      type: "User",
      created_at: url.searchParams.get("createdAt") ?? "",
      merged: Number(url.searchParams.get("merged") ?? "0"),
    });
    return send(204);
  }
  if (request.method !== "GET") return false;
  const user = /^\/user\/([1-9][0-9]*)$/u.exec(url.pathname);
  if (user) {
    const found = users.get(user[1]);
    if (found === undefined) return send(404, { message: "Not Found" });
    const { merged: _merged, ...facts } = found;
    return send(200, facts);
  }
  if (/^\/repos\/[^/]+\/[^/]+\/issues$/u.test(url.pathname)) {
    const creator = url.searchParams.get("creator");
    const found = [...users.values()].find(
      (entry) => entry.login.toLowerCase() === creator?.toLowerCase(),
    );
    return send(
      200,
      Array.from({ length: found?.merged ?? 0 }, (_, index) => ({
        number: index + 1,
        user: { id: found.id, login: found.login },
        pull_request: { merged_at: "2026-09-01T00:00:00Z" },
      })),
    );
  }
  return false;
}

/**
 * The Slopbot GitHub App's view, reached only by the local Slopbot Worker
 * under `/__slopbot`. Slopbot starts uninstalled everywhere. When installed,
 * a repository owner has admin access and anyone else has no access, unless
 * a `/__fixture/slopbot` route sets the state.
 */
function handleSlopbotApp(state, request, response, path) {
  const send = (status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(body === undefined ? "" : JSON.stringify(body));
    return true;
  };
  const installControl =
    /^\/__fixture\/slopbot\/([^/]+\/[^/]+)\/(installed|suspended|missing|unavailable)$/u.exec(
      path,
    );
  if (request.method === "PUT" && installControl) {
    const key = installControl[1].toLowerCase();
    if (installControl[2] === "missing") state.installations.delete(key);
    else state.installations.set(key, installControl[2]);
    return send(204);
  }
  const permissionControl =
    /^\/__fixture\/slopbot\/([^/]+\/[^/]+)\/permission\/([^/]+)\/(admin|write|read|none)$/u.exec(
      path,
    );
  if (request.method === "PUT" && permissionControl) {
    state.permissions.set(
      `${permissionControl[1]}#${permissionControl[2]}`.toLowerCase(),
      permissionControl[3],
    );
    return send(204);
  }
  if (!path.startsWith("/__slopbot/")) return false;
  const route = path.slice("/__slopbot".length);
  const bearer = (request.headers.authorization ?? "").replace(/^Bearer /u, "");
  const installation = /^\/repos\/([^/]+\/[^/]+)\/installation$/u.exec(route);
  if (request.method === "GET" && installation) {
    // The App authenticates as itself with a signed JWT here.
    if (bearer.split(".").length !== 3)
      return send(401, { message: "A JSON web token is required" });
    const found = state.installations.get(installation[1].toLowerCase());
    if (found === "unavailable")
      return send(503, { message: "Fixture unavailable" });
    return found === undefined
      ? send(404, { message: "Not Found" })
      : send(200, {
          id: 5151,
          suspended_at: found === "suspended" ? "2026-10-01T00:00:00Z" : null,
        });
  }
  if (
    request.method === "POST" &&
    route === "/app/installations/5151/access_tokens"
  )
    return bearer.split(".").length === 3
      ? send(201, { token: state.token })
      : send(401, { message: "A JSON web token is required" });
  if (bearer !== state.token) return send(401, { message: "Bad credentials" });
  const repository = /^\/repos\/([^/]+\/[^/]+)$/u.exec(route);
  if (request.method === "GET" && repository)
    return send(200, fixtureRepository(repository[1]));
  const branch = /^\/repos\/([^/]+\/[^/]+)\/branches\/([^/]+)$/u.exec(route);
  if (request.method === "GET" && branch)
    return send(200, fixtureBranch(branch[1], branch[2]));
  const permission =
    /^\/repos\/([^/]+\/[^/]+)\/collaborators\/([^/]+)\/permission$/u.exec(
      route,
    );
  if (request.method === "GET" && permission) {
    const [full, login] = [permission[1], permission[2]];
    const level =
      state.permissions.get(`${full}#${login}`.toLowerCase()) ??
      (full.split("/")[0].toLowerCase() === login.toLowerCase()
        ? "admin"
        : "none");
    // GitHub names the account it read, by its permanent ID.
    const account = fixtureRepository(`${login}/account`).owner;
    return level === "none" || account.type !== "User"
      ? send(404, { message: "Not Found" })
      : send(200, {
          permission: level,
          role_name: level,
          user: { id: account.id, login: account.login },
        });
  }
  return send(404, { message: "Not Found" });
}

export function startGitHubApiFixture(port) {
  // Private vulnerability reporting per repository; on unless a test sets it.
  const intake = new Map();
  const privateIntake = privateIntakeFixture();
  const githubUsers = new Map();
  const limitedRepositories = new Set();
  const slopbot = {
    installations: new Map(),
    permissions: new Map(),
    token: "ghs_slopbotfixtureinstallationtoken",
  };
  const server = createServer(async (request, response) => {
    // Browser tests can spend seconds in synchronous fixture/database setup
    // between these control requests. Retiring a pooled idle connection then
    // races the Node client's next write and surfaces as ECONNRESET. Use a
    // fresh loopback connection per request rather than retrying mutations.
    response.setHeader("connection", "close");
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const publicControl =
      /^\/__fixture\/public-repository\/([^/]+\/[^/]+)\/(rate-limited|ready)$/u.exec(
        path,
      );
    if (request.method === "PUT" && publicControl) {
      const key = publicControl[1].toLowerCase();
      if (publicControl[2] === "rate-limited") limitedRepositories.add(key);
      else limitedRepositories.delete(key);
      response.writeHead(204);
      response.end();
      return;
    }
    if (handleSlopbotApp(slopbot, request, response, path)) return;
    if (handleGithubUsers(githubUsers, request, response, url)) return;
    try {
      if (await handlePrivateIntake(privateIntake, request, response, url))
        return;
    } catch {
      response.writeHead(400, { "content-type": "application/json" });
      response.end('{"message":"Fixture refusal"}');
      return;
    }
    const control =
      /^\/__fixture\/private-vulnerability-reporting\/([^/]+\/[^/]+)\/(enabled|disabled|forbidden|unavailable)$/u.exec(
        path,
      );
    if (request.method === "PUT" && control) {
      intake.set(control[1].toLowerCase(), control[2]);
      response.writeHead(204);
      response.end();
      return;
    }
    const reporting =
      /^\/repos\/([^/]+\/[^/]+)\/private-vulnerability-reporting$/u.exec(path);
    if (request.method === "GET" && reporting) {
      const state = intake.get(reporting[1].toLowerCase()) ?? "enabled";
      if (state === "forbidden" || state === "unavailable") {
        response.writeHead(state === "forbidden" ? 403 : 503, {
          "content-type": "application/json",
        });
        response.end('{"message":"Fixture refusal"}');
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ enabled: state === "enabled" }));
      return;
    }
    const account = /^\/users\/([^/]+)$/u.exec(path);
    if (request.method === "GET" && account) {
      const id = fixtureMemberId(account[1]);
      if (id !== undefined) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify({ id: Number(id), login: account[1], type: "User" }),
        );
        return;
      }
    }
    const ownedRepositories = /^\/users\/([^/]+)\/repos$/u.exec(path);
    if (request.method === "GET" && ownedRepositories) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify(
          ownedRepositories[1] === E2E_OWNER.login
            ? ["desktop", "mobile"].map((suffix) => ({
                ...fixtureRepository(
                  `${E2E_OWNER.login}/owned-registry-${suffix}`,
                ),
                private: false,
                fork: false,
                archived: false,
              }))
            : [],
        ),
      );
      return;
    }
    const repository = /^\/repos\/([^/]+\/[^/]+)$/u.exec(path);
    const branch = /^\/repos\/([^/]+\/[^/]+)\/branches\/([^/]+)$/u.exec(path);
    const limited = (repository ?? branch)?.[1].toLowerCase();
    if (
      request.method === "GET" &&
      limited !== undefined &&
      limitedRepositories.has(limited)
    ) {
      response.writeHead(403, {
        "content-type": "application/json",
        "x-ratelimit-remaining": "0",
      });
      response.end('{"message":"API rate limit exceeded"}');
      return;
    }
    if (request.method === "GET" && branch) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(fixtureBranch(branch[1], branch[2])));
      return;
    }
    if (request.method === "GET" && repository) {
      const name = repository[1].split("/")[1];
      if (name === "lookup-rate-limited" || name === "lookup-unavailable") {
        response.writeHead(name === "lookup-rate-limited" ? 429 : 503, {
          "content-type": "application/json",
        });
        response.end(
          '{"message":"Private upstream diagnostic must not be shown"}',
        );
        return;
      }
      const [owner] = repository[1].split("/");
      if (
        owner === E2E_OWNER.login ||
        owner === E2E_ORGANIZATION.login ||
        owner === "e2e-applicant" ||
        fixtureMemberId(owner) !== undefined
      ) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(fixtureRepository(repository[1])));
        return;
      }
    }
    // Organization membership is private, so it is never proven.
    response.writeHead(404, { "content-type": "application/json" });
    response.end('{"message":"Not Found"}');
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}
