// The internal repository-access route that self-service setup reads: the
// installation comes from GitHub's repository installation lookup, and the
// account's base permission from the installation token, never from a
// stored installation row or a renamed repository.
import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { parseRepositoryAccess } from "../../backend/projects/setup";
import {
  handleRepositoryAccess,
  handleRepositoryRead,
  REPOSITORY_ACCESS_URL,
  REPOSITORY_READ_URL,
} from "./repository-access";

const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const env = { SLOPBOT_APP_ID: "1", SLOPBOT_APP_PRIVATE_KEY: privateKey };
const API = "https://api.github.com/repos/example/open-registry";

function github(
  answers: Record<string, Response | (() => Response)>,
  calls: string[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(`${init?.method ?? "GET"} ${url}`);
    const answer = answers[url];
    if (answer === undefined) return new Response(null, { status: 404 });
    return typeof answer === "function" ? answer() : answer.clone();
  }) as typeof fetch;
}

const installed = {
  [`${API}/installation`]: Response.json({ id: 42, suspended_at: null }),
  "https://api.github.com/app/installations/42/access_tokens": Response.json({
    token: "ghs_fixture_installation_token",
  }),
  [API]: Response.json({ id: 123456789 }),
};

const repositoryIdentity = {
  id: 123456789,
  node_id: "R_example",
  full_name: "example/open-registry",
  private: false,
  owner: {
    id: 987654321,
    node_id: "U_example",
    login: "example",
    type: "User",
  },
};

async function read(fetcher: typeof fetch, query: Record<string, string> = {}) {
  const url = new URL(REPOSITORY_ACCESS_URL);
  for (const [name, value] of Object.entries({
    repository: "example/open-registry",
    repositoryId: "123456789",
    login: "owner",
    githubId: "900000003",
    ...query,
  }))
    url.searchParams.set(name, value);
  const response = await handleRepositoryAccess(new Request(url), env, fetcher);
  return { status: response.status, body: await response.json() };
}

test("reports the installation and the account's base permission", async () => {
  const calls: string[] = [];
  const answer = await read(
    github(
      {
        ...installed,
        [`${API}/collaborators/owner/permission`]: Response.json({
          permission: "write",
          role_name: "maintain",
          user: { id: 900000003 },
        }),
      },
      calls,
    ),
  );
  expect(answer).toEqual({
    status: 200,
    body: {
      installation: "installed",
      installationId: 42,
      permission: "write",
      roleName: "maintain",
    },
  });
  expect(parseRepositoryAccess(answer.body)).toEqual(answer.body);
  expect(calls).toEqual([
    `GET ${API}/installation`,
    "POST https://api.github.com/app/installations/42/access_tokens",
    `GET ${API}`,
    `GET ${API}/collaborators/owner/permission`,
  ]);
});

test("new Pages clients reuse authenticated repository identity without changing older replies", async () => {
  const calls: string[] = [];
  const answer = await read(
    github(
      {
        ...installed,
        [API]: Response.json({
          ...repositoryIdentity,
          token: "must-not-forward-provider-fields",
        }),
        [`${API}/collaborators/owner/permission`]: Response.json({
          permission: "admin",
          role_name: "admin",
          user: { id: 900000003 },
        }),
      },
      calls,
    ),
    { includeRepository: "1" },
  );
  expect(answer.status).toBe(200);
  expect(answer.body.repository).toEqual(repositoryIdentity);
  expect(parseRepositoryAccess(answer.body)).toEqual(answer.body);
  expect(calls.filter((call) => call === `GET ${API}`)).toHaveLength(1);
});

test("a repository without the App, or a suspended one, is not installed", async () => {
  expect((await read(github({}))).body).toEqual({ installation: "missing" });
  expect(
    (
      await read(
        github({
          [`${API}/installation`]: Response.json({
            id: 42,
            suspended_at: "2026-10-20T00:00:00Z",
          }),
        }),
      )
    ).body,
  ).toEqual({ installation: "suspended", installationId: 42 });
});

test("a non-collaborator has no access; a recreated repository is unavailable", async () => {
  expect((await read(github(installed))).body).toMatchObject({
    installation: "installed",
    permission: "none",
  });
  const recreated = await read(
    github({ ...installed, [API]: Response.json({ id: 999 }) }),
  );
  expect(recreated).toEqual({ status: 503, body: { error: "unavailable" } });
});

test("GitHub failures and malformed queries fail closed", async () => {
  expect(
    await read(
      github({
        [`${API}/installation`]: new Response(null, { status: 502 }),
      }),
    ),
  ).toEqual({ status: 503, body: { error: "unavailable" } });
  for (const query of <Record<string, string>[]>[
    { login: "" },
    { login: "not a login" },
    { repository: "example" },
    { repositoryId: "0" },
  ])
    expect((await read(github(installed), query)).status).toBe(400);
});

test("a reused username cannot inherit another account's repository authority", async () => {
  const response = await read(
    github({
      ...installed,
      [`${API}/collaborators/owner/permission`]: Response.json({
        permission: "admin",
        role_name: "admin",
        user: { id: 999 },
      }),
    }),
  );
  expect(response).toEqual({ status: 503, body: { error: "unavailable" } });
});

test("reads one repository resource only through its own installation", async () => {
  const readPath = async (path: string, fetcher: typeof fetch) => {
    const url = new URL(REPOSITORY_READ_URL);
    url.searchParams.set("path", path);
    return handleRepositoryRead(new Request(url), env, fetcher);
  };
  const calls: string[] = [];
  const fetcher = github(installed, calls);
  const facts = await readPath("/repos/example/open-registry", fetcher);
  expect(facts.status).toBe(200);
  expect(facts.headers.get("x-slopbot-repository-read")).toBe("github");
  expect(await facts.json()).toEqual({ id: 123456789 });
  // Encoded dot segments and other resources are refused before any call.
  calls.length = 0;
  for (const path of [
    "/repos/example/open-registry/branches/%2e%2e",
    "/repos/example/open-registry/collaborators/owner/permission",
  ])
    expect((await readPath(path, fetcher)).status).toBe(400);
  expect(calls).toEqual([]);
  // Without an installation the caller makes its ordinary read.
  const missing = await readPath("/repos/example/other", github({}));
  expect(missing.status).toBe(404);
  expect(missing.headers.get("x-slopbot-repository-read")).toBeNull();
});
