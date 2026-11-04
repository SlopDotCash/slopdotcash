import { afterEach, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { GitHubClient, installationTokenPermissions } from "./github";
import { readRepositoryAccess } from "./repository-access";

// PRD section 8, owner decision of 30 October 2026: the App's advisory
// permission may become write so that a researcher-authorized user token can
// forward a report. An installation token must never create or change an
// advisory, so no installation token may carry that permission.
const ORGANIZATION_INSTALLATION = {
  contents: "read",
  issues: "write",
  members: "read",
  metadata: "read",
  pull_requests: "write",
  repository_advisories: "write",
};

const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ format: "pem", type: "pkcs8" })
  .toString();

type Seen = { method: string; path: string; body: unknown };

function github(
  installation: Record<string, unknown>,
  seen: Seen[],
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = init?.method ?? "GET";
    const body =
      typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    seen.push({ method, path: url.pathname, body });
    if (url.pathname === "/app/installations/7")
      return Response.json({ id: 7, permissions: installation });
    if (url.pathname === "/repos/example/alpha/installation")
      return Response.json({
        id: 7,
        suspended_at: null,
        permissions: installation,
      });
    if (url.pathname === "/app/installations/7/access_tokens")
      return Response.json(
        { token: "installation-token-fixture" },
        { status: 201 },
      );
    if (url.pathname === "/repos/example/alpha")
      return Response.json({ id: 123 });
    if (url.pathname === "/repos/example/alpha/collaborators/owner/permission")
      return Response.json({
        permission: "admin",
        role_name: "admin",
        user: { id: 9 },
      });
    return Response.json({ message: "Not Found" }, { status: 404 });
  }) as typeof fetch;
}

const tokenRequest = (seen: Seen[]) =>
  seen.find(
    (call) =>
      call.method === "POST" &&
      call.path === "/app/installations/7/access_tokens",
  );

describe("installation token permissions", () => {
  test("never carry the advisory permission, at any level", () => {
    for (const level of ["read", "write"])
      expect(
        installationTokenPermissions({
          ...ORGANIZATION_INSTALLATION,
          repository_advisories: level,
        }),
      ).toEqual({
        contents: "read",
        issues: "write",
        members: "read",
        metadata: "read",
        pull_requests: "write",
      });
  });

  test("keep only wanted permissions, never above the granted level", () => {
    expect(
      installationTokenPermissions(
        { contents: "read", issues: "write", metadata: "read" },
        { contents: "write", issues: "read", members: "read" },
      ),
    ).toEqual({ contents: "read", issues: "read" });
  });

  test("refuse a missing map or an empty result instead of a full grant", () => {
    for (const granted of [undefined, null, [], "read"])
      expect(() => installationTokenPermissions(granted)).toThrow(
        "installation permissions are invalid",
      );
    expect(() =>
      installationTokenPermissions({ repository_advisories: "write" }),
    ).toThrow("installation grants no requested permission");
    expect(() =>
      installationTokenPermissions(ORGANIZATION_INSTALLATION, {
        actions: "read",
      }),
    ).toThrow("installation grants no requested permission");
  });
});

describe("Slopbot installation tokens", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("a review token requests the granted permissions without advisories", async () => {
    const seen: Seen[] = [];
    globalThis.fetch = github(ORGANIZATION_INSTALLATION, seen);
    await GitHubClient.forInstallation("5257625", privateKey, 7);
    expect(tokenRequest(seen)?.body).toEqual({
      permissions: {
        contents: "read",
        issues: "write",
        members: "read",
        metadata: "read",
        pull_requests: "write",
      },
    });
  });

  test("a user-account installation is not asked for organization members", async () => {
    const seen: Seen[] = [];
    const { members: _, ...userInstallation } = ORGANIZATION_INSTALLATION;
    globalThis.fetch = github(userInstallation, seen);
    await GitHubClient.forInstallation("5257625", privateKey, 7);
    expect(tokenRequest(seen)?.body).toEqual({
      permissions: {
        contents: "read",
        issues: "write",
        metadata: "read",
        pull_requests: "write",
      },
    });
  });

  test("a failed installation lookup requests no token", async () => {
    const seen: Seen[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push({
        method: "GET",
        path: new URL(String(input)).pathname,
        body: undefined,
      });
      return Response.json({ message: "Server Error" }, { status: 502 });
    }) as typeof fetch;
    await expect(
      GitHubClient.forInstallation("5257625", privateKey, 7),
    ).rejects.toThrow("installation lookup failed");
    expect(tokenRequest(seen)).toBeUndefined();
  });

  test("a repository access token requests contents and metadata read only", async () => {
    const seen: Seen[] = [];
    const access = await readRepositoryAccess(
      { SLOPBOT_APP_ID: "5257625", SLOPBOT_APP_PRIVATE_KEY: privateKey },
      {
        owner: "example",
        repo: "alpha",
        repositoryId: "123",
        login: "owner",
        githubId: "9",
      },
      github(ORGANIZATION_INSTALLATION, seen),
    );
    expect(access).toMatchObject({
      installation: "installed",
      permission: "admin",
    });
    expect(tokenRequest(seen)?.body).toEqual({
      permissions: { contents: "read", metadata: "read" },
    });
  });
});
