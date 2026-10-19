/**
 * An application may list up to twenty repositories, and approval lists every
 * one of them. The GitHub ownership check must therefore cover each
 * repository, not only the first: an unchecked second repository lets an
 * applicant claim a repository that is not theirs, block its owner's own
 * application, and have it collected under their project.
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { repositoryControl } from "../functions/api/v1/[[path]]";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import { applicationManifest } from "../tests/project-application-manifest";

// The fixture manifest names the organization `example` as its steward.
const STEWARD = { id: 987654321, login: "example", type: "Organization" };
const ACTOR = { githubId: "900000002", githubLogin: "e2e-applicant" };
const REPOSITORIES: Record<string, Record<string, unknown>> = {
  "/repos/example/open-registry": {
    id: 123456789,
    node_id: "R_example",
    full_name: "example/open-registry",
    private: false,
    owner: STEWARD,
  },
  "/repos/example/second-tool": {
    id: 123456790,
    node_id: "R_second",
    full_name: "example/second-tool",
    private: false,
    owner: STEWARD,
  },
  "/repos/victim/popular": {
    id: 555,
    node_id: "R_victim",
    full_name: "victim/popular",
    private: false,
    owner: { id: 777, login: "victim", type: "User" },
  },
};

let github: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  github = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      if (pathname === "/orgs/example/public_members/e2e-applicant")
        return new Response(null, { status: 204 });
      const facts = REPOSITORIES[pathname];
      return facts
        ? Response.json(facts)
        : Response.json({ message: "Not Found" }, { status: 404 });
    },
  });
});
afterAll(() => {
  github.stop(true);
});

function manifest(...secondary: string[]): ProjectDefinition {
  const base = applicationManifest("open-registry", "example/open-registry");
  const [primary] = base.repositories as Record<string, unknown>[];
  return {
    ...base,
    repositories: [
      primary,
      ...secondary.map((id) => ({
        ...primary,
        id,
        displayName: id,
        githubUrl: `https://github.com/${id}`,
      })),
    ],
  } as unknown as ProjectDefinition;
}

const env = () =>
  ({
    SLOP_GITHUB_API_ORIGIN: `http://127.0.0.1:${github.port}`,
  }) as unknown as Parameters<typeof repositoryControl>[2];

test("a second repository that the steward does not own is refused", async () => {
  expect(
    await repositoryControl(manifest("victim/popular"), ACTOR, env()),
  ).toEqual({
    state: "mismatch",
    reason: "victim/popular is not a public repository of the steward",
  });
  expect(
    await repositoryControl(manifest("example/missing"), ACTOR, env()),
  ).toEqual({
    state: "mismatch",
    reason: "GitHub has no public repository named example/missing",
  });
});

test("every repository of the steward is proven together", async () => {
  expect(
    await repositoryControl(manifest("example/second-tool"), ACTOR, env()),
  ).toEqual({
    state: "proven",
    reason: "@e2e-applicant is a public member of example",
  });
  expect(await repositoryControl(manifest(), ACTOR, env())).toEqual({
    state: "proven",
    reason: "@e2e-applicant is a public member of example",
  });
});
