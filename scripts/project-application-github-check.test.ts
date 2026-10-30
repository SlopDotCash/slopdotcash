// The GitHub and steward checks of project setup through the production Pages
// Function: the primary identity comes from the authenticated Slopbot read;
// every additional repository and alias is checked too. Identity facts alone never
// grant authority; the installation permission does (owner decision D11).
import { afterEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { onRequest } from "../functions/api/v1/[[path]]";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";
import { sha256Hex } from "../workers/identity/crypto";

const ORIGIN = "https://slop.cash";
const API = "https://api.github.com";
const SESSION = "t".repeat(48);

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

afterEach(() => {
  globalThis.fetch = realFetch;
  lookups.length = 0;
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
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        cookie: `__Host-slop_points=${SESSION}`,
      },
      body: JSON.stringify(path === "projects" ? { manifest } : {}),
    }),
    env: {
      SLOP_DB: db,
      ADMIN_GITHUB_IDS: "900000001",
      ...(slopbot === null
        ? {}
        : {
            SLOPBOT: {
              fetch: async (request: Request) => {
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
  };
  return { status: response.status, body, db, sqlite };
}

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
