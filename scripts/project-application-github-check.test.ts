// The GitHub and steward checks of project setup through the production Pages
// Function: the primary identity comes from the authenticated Slopbot read;
// every additional repository and alias is checked too. Identity facts alone never
// grant authority; the installation permission does (owner decision D11).
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { onRequest } from "../functions/api/v1/[[path]]";
import { sha256Hex } from "../src/lib/async-sha256.mjs";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";

const ORIGIN = "https://slop.cash";
const API = "https://api.github.com";
const SESSION = "t".repeat(48);
const PUBLIC_READ_TOKEN = "fixture-public-read-token";

const OWNER = {
  id: 987654321,
  node_id: "U_example",
  login: "example",
  type: "User",
};
const repositories: Record<string, unknown> = {
  "example/open-registry": {
    id: 123456789,
    node_id: "R_example",
    full_name: "example/open-registry",
    private: false,
    owner: OWNER,
  },
  "someone-else/their-repo": {
    id: 555000111,
    node_id: "R_other",
    full_name: "someone-else/their-repo",
    private: false,
    owner: {
      id: 444000111,
      node_id: "U_someone_else",
      login: "someone-else",
      type: "User",
    },
  },
};
// GitHub answers a former name with the renamed repository.
repositories["example/old-registry-name"] =
  repositories["example/open-registry"];

const realFetch = globalThis.fetch;
const lookups: string[] = [];
const slopbotReads: string[] = [];

afterEach(() => {
  globalThis.fetch = realFetch;
  lookups.length = 0;
  slopbotReads.length = 0;
});

let stubGithub = () => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    lookups.push(url);
    const path = url.startsWith(`${API}/repos/`)
      ? url.slice(`${API}/repos/`.length)
      : "";
    return repositories[path]
      ? Response.json(repositories[path])
      : Response.json({ message: "Not Found" }, { status: 404 });
  }) as typeof fetch;
};

/** What the Slopbot binding reads; `null` leaves Slopbot unbound. */
type SlopbotAnswer = Record<string, unknown> | null;
const ADMIN_ACCESS: SlopbotAnswer = {
  installation: "installed",
  installationId: 5151,
  permission: "admin",
  roleName: "admin",
};

async function submit(
  manifest: unknown,
  path = "projects",
  seed?: (sqlite: ReturnType<typeof sqliteD1>["sqlite"]) => void,
  slopbot: SlopbotAnswer = ADMIN_ACCESS,
  method: "POST" | "GET" = "POST",
) {
  const { db, sqlite } = sqliteD1(
    readdirSync(resolve(import.meta.dir, "..", "migrations"))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  sqlite.exec(
    `INSERT INTO points_members (actor_id, github_id, login, joined_at, public)
     VALUES ('act_1', '987654321', 'example', '2026-10-01T00:00:00.000Z', 0)`,
  );
  sqlite
    .prepare(
      "INSERT INTO points_sessions (token_hash, actor_id, expires_at) VALUES (?, 'act_1', '2099-01-01T00:00:00.000Z')",
    )
    .run(await sha256Hex(SESSION));
  seed?.(sqlite);
  stubGithub();
  const response = await onRequest({
    request: new Request(`${ORIGIN}/api/v1/${path}`, {
      method,
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        cookie: `__Host-slop_points=${SESSION}`,
      },
      ...(method === "POST"
        ? { body: JSON.stringify(path === "projects" ? { manifest } : {}) }
        : {}),
    }),
    env: {
      SLOP_DB: db,
      ADMIN_GITHUB_IDS: "900000001",
      SLOP_GITHUB_READ_TOKEN: PUBLIC_READ_TOKEN,
      ...(slopbot === null
        ? {}
        : {
            SLOPBOT: {
              fetch: async (request: Request) => {
                slopbotReads.push(request.url);
                const url = new URL(request.url);
                expect(url.searchParams.get("includeRepository")).toBe("1");
                return Response.json({
                  ...slopbot,
                  ...(slopbot.installation === "installed"
                    ? {
                        repository: Object.hasOwn(slopbot, "repository")
                          ? slopbot.repository
                          : repositories[
                              url.searchParams.get("repository") ?? ""
                            ],
                      }
                    : {}),
                });
              },
            },
          }),
    } as never,
  });
  const body = (await response.json()) as {
    setup?: {
      checks: {
        authority: { state: string; message: string };
        installation: { state: string };
      };
    };
    error?: string;
    message?: string;
    repository?: {
      branches: string[];
      license: { state: string };
    };
  };
  return { status: response.status, body, db, sqlite };
}

test.each(["public", "private-before-branches", "private-before-license"])(
  "the Pages repository picker keeps the public-only credential: %s",
  async (state) => {
    const previousStub = stubGithub;
    const requests: string[] = [];
    const licenseText = "Public fixture license bytes.\n";
    const blob = createHash("sha1")
      .update(`blob ${Buffer.byteLength(licenseText)}\0${licenseText}`)
      .digest("hex");
    const commit = "a".repeat(40);
    const branch = {
      name: "main",
      prefix: "refs/heads/",
      target: { __typename: "Commit", oid: commit },
    };
    const node = {
      __typename: "Repository",
      id: "R_example",
      fullDatabaseId: "123456789",
      isPrivate: false,
    };
    // The fixture enforces the deployment contract: this credential can read
    // public resources only. Visibility changes deny the later request at
    // GitHub; no privileged installation response may replace that refusal.
    stubGithub = () => {
      globalThis.fetch = (async (input, init) => {
        const request = new Request(input, init);
        requests.push(request.url);
        expect(request.headers.get("authorization")).toBe(
          `Bearer ${PUBLIC_READ_TOKEN}`,
        );
        if (request.url === `${API}/repos/example/open-registry`)
          return Response.json({
            ...(repositories["example/open-registry"] as object),
            default_branch: "main",
          });
        if (request.url === `${API}/graphql`) {
          expect(request.method).toBe("POST");
          const body = (await request.json()) as {
            query: string;
            variables: { id: string };
          };
          expect(body.variables.id).toBe("R_example");
          if (body.query.includes("ProjectRepositoryBranches")) {
            if (state === "private-before-branches")
              return new Response(null, { status: 404 });
            return Response.json({
              data: {
                node: {
                  ...node,
                  refs: {
                    nodes: [branch],
                    pageInfo: { hasNextPage: false, endCursor: null },
                  },
                },
              },
            });
          }
          if (body.query.includes("ProjectRepositoryHead"))
            return Response.json({ data: { node: { ...node, ref: branch } } });
          expect(body.query).toContain("ProjectRepositoryLicense");
          return Response.json({
            data: {
              node: { ...node, object: { __typename: "Blob", oid: blob } },
            },
          });
        }
        expect(request.url).toBe(
          `${API}/repos/example/open-registry/license?ref=${commit}`,
        );
        if (state === "private-before-license")
          return new Response(null, { status: 404 });
        return Response.json({
          path: "LICENSE",
          type: "file",
          sha: blob,
          license: { spdx_id: "MIT" },
          encoding: "base64",
          content: Buffer.from(licenseText).toString("base64"),
        });
      }) as typeof fetch;
    };
    try {
      const result = await submit(
        null,
        "project-github/repositories/example/open-registry",
        undefined,
        ADMIN_ACCESS,
        "GET",
      );
      expect(slopbotReads).toEqual([]);
      expect(requests[0]).toBe(`${API}/repos/example/open-registry`);
      if (state === "private-before-branches") {
        expect(result.status).toBe(502);
        expect(result.body.repository).toBeUndefined();
        expect(requests).toHaveLength(2);
      } else {
        expect(result.status).toBe(200);
        expect(result.body.repository?.branches).toEqual(["main"]);
        expect(result.body.repository?.license.state).toBe(
          state === "public" ? "verified" : "unknown",
        );
        expect(requests).toHaveLength(5);
      }
    } finally {
      stubGithub = previousStub;
    }
  },
);

test("the Pages picker ignores legacy repository cache bytes and caches its node-bound result", async () => {
  const previousStub = stubGithub;
  const cacheDescriptor = Object.getOwnPropertyDescriptor(globalThis, "caches");
  const cachePrefix = `${ORIGIN}/__slop-cache/projects-v1/api/v1/project-github`;
  const legacyKey = `${cachePrefix}/repositories/example/open-registry`;
  const currentKey = `${cachePrefix}/repository-node-v1/example/open-registry`;
  const entries = new Map<string, Response>([
    [legacyKey, Response.json({ repository: { branches: ["legacy-mixed"] } })],
  ]);
  const cacheReads: string[] = [];
  const providerReads: string[] = [];
  Object.defineProperty(globalThis, "caches", {
    configurable: true,
    value: {
      default: {
        async match(request: Request) {
          cacheReads.push(request.url);
          return entries.get(request.url)?.clone();
        },
        async put(request: Request, response: Response) {
          entries.set(request.url, response.clone());
        },
        async delete(request: Request) {
          return entries.delete(request.url);
        },
      },
    },
  });
  stubGithub = () => {
    globalThis.fetch = (async (input, init) => {
      const request = new Request(input, init);
      providerReads.push(request.url);
      expect(request.headers.get("authorization")).toBe(
        `Bearer ${PUBLIC_READ_TOKEN}`,
      );
      if (request.url === `${API}/repos/example/open-registry`)
        return Response.json({
          ...(repositories["example/open-registry"] as object),
          default_branch: "main",
        });
      expect(request.url).toBe(`${API}/graphql`);
      const body = (await request.json()) as {
        query: string;
        variables: { id: string };
      };
      expect(body.variables.id).toBe("R_example");
      const node = {
        __typename: "Repository",
        id: "R_example",
        fullDatabaseId: "123456789",
        isPrivate: false,
      };
      if (body.query.includes("ProjectRepositoryBranches"))
        return Response.json({
          data: {
            node: {
              ...node,
              refs: {
                nodes: [
                  {
                    name: "main",
                    prefix: "refs/heads/",
                    target: { __typename: "Commit", oid: "a".repeat(40) },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        });
      expect(body.query).toContain("ProjectRepositoryHead");
      return Response.json({ data: { node: { ...node, ref: null } } });
    }) as typeof fetch;
  };
  try {
    const path = "project-github/repositories/example/open-registry";
    const first = await submit(null, path, undefined, ADMIN_ACCESS, "GET");
    expect(first.status).toBe(200);
    expect(first.body.repository?.branches).toEqual(["main"]);
    expect(cacheReads).toEqual([currentKey]);
    expect(entries.has(legacyKey)).toBe(true);
    expect(entries.has(currentKey)).toBe(true);
    expect(providerReads).toHaveLength(3);
    const second = await submit(null, path, undefined, ADMIN_ACCESS, "GET");
    expect(second.status).toBe(200);
    expect(second.body.repository?.branches).toEqual(["main"]);
    expect(cacheReads).toEqual([currentKey, currentKey]);
    expect(providerReads).toHaveLength(3);
    expect(slopbotReads).toEqual([]);
  } finally {
    stubGithub = previousStub;
    if (cacheDescriptor === undefined)
      Reflect.deleteProperty(globalThis, "caches");
    else Object.defineProperty(globalThis, "caches", cacheDescriptor);
  }
});

/** The `/projects/new` manifest for a user repository, plus `repositories`. */
function manifestWith(...extra: Record<string, unknown>[]) {
  const base = applicationManifest("open-registry", "example/open-registry");
  const [first] = base.repositories as Record<string, unknown>[];
  const steward = base.steward as { github: Record<string, unknown> };
  return {
    ...base,
    steward: {
      ...steward,
      github: {
        ...steward.github,
        nodeId: "U_example",
        type: "User",
        profileUrl: "https://github.com/example",
      },
    },
    repositories: [{ ...first, ...extra[0] }, ...extra.slice(1)],
  };
}

function repository(id: string) {
  return {
    id,
    displayName: id,
    githubUrl: `https://github.com/${id}`,
    description: "Another repository of the same project.",
    integrationBranch: "main",
  };
}

test("an owner whose write access Slopbot reads creates the project at once", async () => {
  const { status, body, sqlite } = await submit(manifestWith({}));
  expect(status).toBe(201);
  expect(body.setup?.checks.authority).toMatchObject({
    state: "verified",
  });
  expect(body.setup?.checks.installation.state).toBe("installed");
  expect(
    sqlite
      .prepare("SELECT status FROM projects WHERE id = ?")
      .get("open-registry"),
  ).toEqual({ status: "paused" });
});

// Owner decision D11: creation requires the Slopbot installation read.
// Public GitHub ownership alone creates nothing.
test.each([
  ["missing", { installation: "missing" }, 409, "slopbot_required"],
  [
    "suspended",
    { installation: "suspended", installationId: 5151 },
    409,
    "slopbot_required",
  ],
  [
    "read access",
    { ...ADMIN_ACCESS, permission: "read", roleName: "read" },
    403,
    "authority_required",
  ],
  ["unbound Slopbot", null, 503, "github_unavailable"],
] as const)(
  "no project is created when Slopbot reads %s",
  async (_name, slopbot, status, error) => {
    const result = await submit(
      manifestWith({}),
      "projects",
      undefined,
      slopbot,
    );
    expect(result.status).toBe(status);
    expect(result.body.error).toBe(error);
    expect(
      result.sqlite.prepare("SELECT COUNT(*) AS count FROM projects").get(),
    ).toEqual({ count: 0 });
  },
);

test("a new project lists exactly one repository", async () => {
  const { status, body } = await submit(
    manifestWith({}, repository("example/registry-docs")),
  );
  expect(status).toBe(422);
  expect(body).toMatchObject({
    error: "invalid_manifest",
  });
});

test("an alias must lead to the repository it names", async () => {
  const former = await submit(
    manifestWith({ aliases: ["example/old-registry-name"] }),
  );
  expect(former.status).toBe(201);

  const other = await submit(
    manifestWith({ aliases: ["someone-else/their-repo"] }),
  );
  expect(other.status).toBe(422);
  expect(other.body).toMatchObject({
    error: "invalid_manifest",
  });
});

test.each(["unchanged", "changed", "unavailable"])(
  "publishing a stored application rechecks its alias facts: %s",
  async (state) => {
    const manifest = JSON.stringify(
      manifestWith({ aliases: ["example/old-registry-name"] }),
    ).replace(
      '"symbol":"USDC"}',
      '"symbol":"USDC","decimals":6,"chainId":"1","cluster":null,"verifiedAt":"2026-10-10T00:00:00.000Z"}',
    );
    const original = repositories["example/old-registry-name"];
    if (state === "changed")
      repositories["example/old-registry-name"] =
        repositories["someone-else/their-repo"];
    const realStub = stubGithub;
    try {
      const published = await submit(
        null,
        "project-applications/app_storedapplication1/publish",
        (sqlite) => {
          sqlite.exec(
            `INSERT INTO project_applications (id,project_id,repository_key,manifest,manifest_sha256,acceptance_criteria,applicant_github_id,applicant_github_login,submitted_at,status,admin_notification,admin_notification_at)
               VALUES ('app_storedapplication1','open-registry','example/open-registry','${manifest}','${"a".repeat(64)}','Merged pull requests','987654321','example','2026-10-10T00:00:00.000Z','pending','sent','2026-10-10T00:00:01.000Z')`,
          );
          if (state === "unavailable")
            stubGithub = () => {
              globalThis.fetch = (async () => {
                throw new Error("GitHub unavailable");
              }) as unknown as typeof fetch;
            };
        },
      );
      expect(published.status).toBe(
        state === "unchanged" ? 201 : state === "changed" ? 422 : 503,
      );
      if (state === "changed")
        expect(published.body).toMatchObject({
          error: "invalid_manifest",
        });
      expect(
        published.sqlite
          .prepare("SELECT status FROM project_applications WHERE id = ?")
          .get("app_storedapplication1"),
      ).toMatchObject({
        status: state === "unchanged" ? "approved" : "pending",
      });
    } finally {
      repositories["example/old-registry-name"] = original;
      stubGithub = realStub;
    }
  },
);
// The steward must be the account GitHub reports as the repository owner, by
// login and node id, not only by numeric id.
function stewardManifest(github: Record<string, unknown>) {
  const manifest = manifestWith({});
  return {
    ...manifest,
    steward: {
      ...manifest.steward,
      kind: "individual",
      github: { ...manifest.steward.github, ...github },
    },
  };
}

const STEWARD_MISMATCH = {
  error: "invalid_manifest",
};

test("the repository owner is accepted as steward in any login case, from the App response alone", async () => {
  // GitHub logins are case-insensitive.
  const { status } = await submit(
    stewardManifest({
      login: "Example",
      profileUrl: "https://github.com/Example",
    }),
  );
  expect(status).toBe(201);
  expect(lookups).toEqual([]);
});

test.each([
  ["login", { login: "microsoft", profileUrl: "https://github.com/microsoft" }],
  ["node id", { nodeId: "MDEyOk9yZ2FuaXphdGlvbjY4OTg0Mzc=" }],
] as const)(
  "another account's %s with the owner's id is refused",
  async (_name, github) => {
    const { status, body, sqlite } = await submit(stewardManifest(github));
    expect(status).toBe(422);
    expect(body).toMatchObject(STEWARD_MISMATCH);
    expect(
      sqlite.prepare("SELECT COUNT(*) AS count FROM projects").get(),
    ).toEqual({ count: 0 });
  },
);

test("a project cannot claim a different GitHub owner account type", async () => {
  const manifest = manifestWith({});
  manifest.steward.github.type = "Organization";
  const { status, body } = await submit(manifest);
  expect(lookups).not.toContain(`${API}/repos/example/open-registry`);
  expect(status).toBe(422);
  expect(body).toMatchObject(STEWARD_MISMATCH);
});

// A service response is parsed independently of the caller's manifest. The
// current Pages client must refuse old/malformed identity or changed facts.
test.each([
  ["old Worker reply", undefined, 503],
  [
    "private repository",
    { ...(repositories["example/open-registry"] as object), private: true },
    422,
  ],
  [
    "recreated repository",
    { ...(repositories["example/open-registry"] as object), id: 999 },
    422,
  ],
  [
    "changed repository node",
    {
      ...(repositories["example/open-registry"] as object),
      node_id: "R_changed",
    },
    422,
  ],
  [
    "different owner",
    {
      ...(repositories["example/open-registry"] as object),
      owner: { ...OWNER, id: 999 },
    },
    422,
  ],
  [
    "changed owner node",
    {
      ...(repositories["example/open-registry"] as object),
      owner: { ...OWNER, node_id: "U_changed" },
    },
    422,
  ],
] as const)(
  "an owner write refuses %s from the App",
  async (_name, repository, status) => {
    const result = await submit(manifestWith({}), "projects", undefined, {
      ...ADMIN_ACCESS,
      repository,
    });
    expect(result.status).toBe(status);
    expect(
      result.sqlite.prepare("SELECT COUNT(*) AS count FROM projects").get(),
    ).toEqual({ count: 0 });
  },
);
