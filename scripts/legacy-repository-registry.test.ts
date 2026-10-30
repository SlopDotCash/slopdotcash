/**
 * A repository that scored before the D1 registry keeps its project id in
 * contributor points and profiles. Re-registering it under a new id would key
 * a second award for the same merged pull request, so the registry refuses it
 * at admission and keeps accepting the historical id.
 */
import { expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../backend/projects/handler";
import { TokenMetadataError } from "../backend/projects/token-metadata";
import { applicationManifest } from "../tests/project-application-manifest";
import { sqliteD1 } from "../tests/sqlite-d1";

const LEGACY_ID = "thenetwork";
const LEGACY_REPOSITORY = "eliza-research/thenetwork";

/** The creation route as /projects/new reaches it, on the real migrations. */
async function submit(id: string): Promise<{ status: number; body: unknown }> {
  const deps: ProjectApiDependencies = {
    persistence: new CloudflareProjectPersistence(
      sqliteD1(
        readdirSync(new URL("../migrations/", import.meta.url))
          .filter((name) => name.endsWith(".sql"))
          .sort(),
      ).db,
    ),
    adminGithubIds: new Set(["900000001"]),
    moderatorGithubIds: new Set(),
    vettingClearance: async () => ({ state: "unscanned" }),
    now: () => new Date("2026-10-19T12:00:00.000Z"),
    randomId: () => "00000000-0000-4000-8000-000000000001",
    sessionActor: async () => ({
      githubId: "900000002",
      githubLogin: "applicant",
    }),
    readTokenMetadata: async () => {
      throw new TokenMetadataError("No contract exists at that token address");
    },
    github: {
      fetch: async () =>
        Response.json({ message: "Not Found" }, { status: 404 }),
    },
    repositoryControl: async () => ({ state: "matched" }),
    repositoryAccess: async () => ({
      installation: "installed",
      installationId: 1,
      permission: "admin",
      roleName: "admin",
    }),
  };
  const response = await handleProjectApi(
    new Request("https://slop.cash/api/v1/projects", {
      method: "POST",
      headers: {
        origin: "https://slop.cash",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        manifest: applicationManifest(id, LEGACY_REPOSITORY),
      }),
    }),
    deps,
  );
  if (!response) throw new Error("project route was not handled");
  return { status: response.status, body: await response.json() };
}

test("a project for a legacy repository must reuse its historical id", async () => {
  const conflict = await submit("the-network");
  expect(conflict.status).toBe(409);
  expect(conflict.body).toMatchObject({
    error: "registry_conflict",
  });
  const accepted = await submit(LEGACY_ID);
  expect(accepted.status).toBe(201);
});
