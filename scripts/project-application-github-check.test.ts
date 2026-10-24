// The GitHub check of project setup through the production Pages Function:
// every repository and alias in the manifest is read from GitHub, not only
// the first repository. New projects list one repository; projects and
// stored applications from before self-service setup may list more.
import { afterEach, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { onRequest, repositoryControl } from "../functions/api/v1/[[path]]";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
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
  "example/registry-docs": {
    id: 223456789,
    node_id: "R_docs",
    full_name: "example/registry-docs",
    private: false,
    owner: OWNER,
  },
  "partner-lab/shared-models": {
    id: 323456789,
    node_id: "R_partner",
    full_name: "partner-lab/shared-models",
    private: false,
    owner: {
      id: 777000111,
      node_id: "O_partner_lab",
      login: "partner-lab",
      type: "Organization",
    },
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
    if (url === `${API}/orgs/partner-lab/public_members/example`)
      return new Response(null, { status: 204 });
    const path = url.startsWith(`${API}/repos/`)
      ? url.slice(`${API}/repos/`.length)
      : "";
    return repositories[path]
      ? Response.json(repositories[path])
      : Response.json({ message: "Not Found" }, { status: 404 });
  }) as typeof fetch;
};

/** The public-facts check for the signed-in owner `example`. */
async function control(manifest: unknown) {
  stubGithub();
  return await repositoryControl(
    manifest as ProjectDefinition,
    { githubId: "987654321", githubLogin: "example" },
    {} as never,
  );
}

async function submit(
  manifest: unknown,
  path = "projects",
  seed?: (sqlite: ReturnType<typeof sqliteD1>["sqlite"]) => void,
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
    env: { SLOP_DB: db, ADMIN_GITHUB_IDS: "900000001" } as never,
  });
  const body = (await response.json()) as {
    setup?: {
      checks: {
        authority: { state: string; basis?: string; message: string };
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

test("an owner who controls the repository creates the project at once", async () => {
  const { status, body, sqlite } = await submit(manifestWith({}));
  expect(status).toBe(201);
  expect(body.setup?.checks.authority).toEqual({
    state: "verified",
    basis: "public-github-facts",
    message: "@example owns example/open-registry.",
  });
  // Slopbot is not connected to this site, so the installation is a retry.
  expect(body.setup?.checks.installation.state).toBe("retry");
  expect(
    sqlite
      .prepare("SELECT status FROM projects WHERE id = ?")
      .get("open-registry"),
  ).toEqual({ status: "paused" });
});

test("a new project lists exactly one repository", async () => {
  const { status, body } = await submit(
    manifestWith({}, repository("example/registry-docs")),
  );
  expect(status).toBe(422);
  expect(body).toMatchObject({
    error: "invalid_manifest",
    message: "A new project lists exactly one repository",
  });
});

test("control is proven only when the owner controls every repository", async () => {
  expect(
    await control(
      manifestWith(
        {},
        repository("example/registry-docs"),
        repository("partner-lab/shared-models"),
      ),
    ),
  ).toEqual({
    state: "proven",
    reason: "@example owns example/open-registry",
  });
  expect(lookups).toContain(`${API}/repos/partner-lab/shared-models`);
  expect(
    await control(manifestWith({}, repository("someone-else/their-repo"))),
  ).toEqual({
    state: "unproven",
    reason: "@example does not own someone-else/their-repo",
  });
  expect(
    await control(manifestWith({}, repository("someone-else/missing-repo"))),
  ).toEqual({
    state: "mismatch",
    reason: "GitHub has no public repository named someone-else/missing-repo",
  });
});

test("an alias must lead to the repository it names", async () => {
  const former = await submit(
    manifestWith({ aliases: ["example/old-registry-name"] }),
  );
  expect(former.status).toBe(201);
  expect(former.body.setup?.checks.authority.message).toBe(
    "@example owns example/open-registry.",
  );

  const other = await submit(
    manifestWith({ aliases: ["someone-else/their-repo"] }),
  );
  expect(other.status).toBe(422);
  expect(other.body).toMatchObject({
    error: "invalid_manifest",
    message:
      "Alias someone-else/their-repo is not a name of example/open-registry on GitHub",
  });

  expect(
    await control(
      manifestWith(
        {},
        {
          ...repository("example/registry-docs"),
          aliases: ["someone-else/missing-repo"],
        },
      ),
    ),
  ).toEqual({
    state: "mismatch",
    reason: "GitHub has no public repository named someone-else/missing-repo",
  });
});

test("a check names at most 5 repositories and aliases", async () => {
  const docs = repositories["example/registry-docs"];
  for (const name of ["docs-old-1", "docs-old-2", "docs-old-3"])
    repositories[`example/${name}`] = docs;
  const five = manifestWith(
    { aliases: ["example/old-registry-name"] },
    {
      ...repository("example/registry-docs"),
      aliases: ["example/docs-old-1", "example/docs-old-2"],
    },
  );
  expect((await control(five)).state).toBe("proven");
  expect(lookups.filter((url) => url.startsWith(`${API}/repos/`))).toHaveLength(
    5,
  );

  lookups.length = 0;
  const [first, second] = five.repositories as Record<string, unknown>[];
  const six = {
    ...five,
    repositories: [
      first,
      {
        ...second,
        aliases: [...(second.aliases as string[]), "example/docs-old-3"],
      },
    ],
  };
  expect(await control(six)).toEqual({
    state: "mismatch",
    reason: "An application may name at most 5 repositories and aliases",
  });
  expect(lookups).toEqual([]);
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
          message:
            "Alias example/old-registry-name is not a name of example/open-registry on GitHub",
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
test("a project cannot claim a different GitHub owner account type", async () => {
  const manifest = manifestWith({});
  manifest.steward.github.type = "Organization";
  const { status, body } = await submit(manifest);
  expect(lookups).toContain(`${API}/repos/example/open-registry`);
  expect(status).toBe(422);
  expect(body).toMatchObject({
    error: "invalid_manifest",
    message: "Repository or steward facts do not match GitHub",
  });
});
