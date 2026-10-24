// The internal repository-access route that self-service setup reads: the
// installation comes from GitHub's repository installation lookup, and the
// account's base permission from the installation token, never from a
// stored installation row or a renamed repository.
import { expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { parseRepositoryAccess } from "../../backend/projects/setup";
import {
  handleRepositoryAccess,
  REPOSITORY_ACCESS_URL,
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
