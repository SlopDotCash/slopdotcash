/**
 * checkSetup activation gate (PRD section 4): a paused project activates
 * through `POST /api/v1/project-setup/:id/check` only when the caller is
 * the project steward or a repository admin. Any other collaborator with
 * repository write access can still read the setup status, but their check
 * must leave the project paused.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import type {
  ProjectSetupStatus,
  RepositoryAccess,
} from "../../src/lib/project-contracts";
import type { VettingClearance } from "../../src/lib/vetting-contracts";
import {
  applicationManifest,
  CONTRIBUTION,
} from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { CloudflareProjectPersistence } from "./cloudflare-persistence";
import { handleProjectApi, type ProjectApiDependencies } from "./handler";
import type { ScanRequest } from "./setup";
import { TokenMetadataError } from "./token-metadata";

// The fixture manifest names this steward (see
// tests/project-application-manifest.ts).
const STEWARD = "987654321";
const CREATOR = "900000002";
const WRITER = "111";
const REPO_ADMIN = "222";
const READER = "333";
const NOW = "2026-10-19T12:00:00.000Z";

const LOGINS: Record<string, string> = {
  [STEWARD]: "example",
  [CREATOR]: "owner",
  [WRITER]: "writer",
  [REPO_ADMIN]: "repo-admin",
  [READER]: "reader",
};

const PERMISSIONS: Record<string, "admin" | "write" | "read"> = {
  [STEWARD]: "write",
  [CREATOR]: "admin",
  [WRITER]: "write",
  [REPO_ADMIN]: "admin",
  [READER]: "read",
};

const CLEARED: VettingClearance = {
  state: "cleared",
  assessment: {
    id: "vet_00000000000000000000000000000001",
    revision: 1,
    state: "clean",
    commitSha: "a".repeat(40),
    templateSha256: "d".repeat(64),
    policyVersion: "fixture",
    requestedAt: NOW,
    completedAt: NOW,
    modelRuns: [],
    artifacts: 0,
    heldArtifacts: 0,
  },
};

function registry() {
  const { db, sqlite } = sqliteD1(
    readdirSync(new URL("../../migrations/", import.meta.url))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  const persistence = new CloudflareProjectPersistence(db);
  let sequence = 0;
  const state = {
    clearance: { state: "unscanned" } as VettingClearance,
  };
  const deps: ProjectApiDependencies = {
    persistence,
    adminGithubIds: new Set(),
    moderatorGithubIds: new Set(),
    vettingClearance: async () => state.clearance,
    now: () => new Date(NOW),
    randomId: () =>
      `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    sessionActor: async (request) => {
      const actor = request.headers.get("x-test-actor");
      return actor
        ? { githubId: actor, githubLogin: LOGINS[actor] ?? "other" }
        : null;
    },
    readTokenMetadata: async () => {
      throw new TokenMetadataError("No contract exists at that token address");
    },
    github: {
      fetch: async () =>
        Response.json({ message: "Not Found" }, { status: 404 }),
    },
    repositoryControl: async () => ({ state: "matched" as const }),
    repositoryAccess: async (_repository, actor) => {
      const permission = PERMISSIONS[actor.githubId] ?? "read";
      return {
        installation: "installed",
        installationId: 42,
        permission,
        roleName: permission,
      } as RepositoryAccess;
    },
    requestScan: async () => ({ state: "queued" }) as ScanRequest,
  };
  const call = async (
    method: string,
    path: string,
    actor: string,
    body?: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> }> => {
    const response = await handleProjectApi(
      new Request(`https://slop.cash/api/v1/${path}`, {
        method,
        headers: {
          origin: "https://slop.cash",
          "content-type": "application/json",
          "x-test-actor": actor,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      deps,
    );
    if (!response) return { status: 404, body: {} };
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  };
  const createPaused = async (id: string) => {
    const created = await call("POST", "projects", CREATOR, {
      manifest: applicationManifest(id, `example/${id}`),
    });
    expect(created.status).toBe(201);
    state.clearance = CLEARED;
    const project = await persistence.getProject(id);
    expect(project).toMatchObject({ status: "paused", revision: 1 });
    return project;
  };
  const check = async (id: string, actor: string) =>
    (await call("POST", `project-setup/${id}/check`, actor, {})).body
      .setup as ProjectSetupStatus;
  return { persistence, sqlite, state, call, createPaused, check };
}

describe("checkSetup activation is limited to the steward or a repository admin", () => {
  test("a write collaborator who is neither steward nor admin leaves the project paused", async () => {
    const t = registry();
    try {
      await t.createPaused("write-collaborator");
      const setup = await t.check("write-collaborator", WRITER);
      expect(setup).toMatchObject({
        state: "action_required",
        status: "paused",
        activatedRevision: null,
        nextAction: { kind: "activate_project" },
      });
      expect(
        await t.persistence.getProject("write-collaborator"),
      ).toMatchObject({ status: "paused", revision: 1 });
    } finally {
      t.sqlite.close();
    }
  });

  test("the steward still activates the paused project", async () => {
    const t = registry();
    try {
      await t.createPaused("steward-activation");
      const setup = await t.check("steward-activation", STEWARD);
      expect(setup).toMatchObject({
        state: "ready",
        status: "active",
        activatedRevision: 2,
      });
      expect(
        await t.persistence.getProject("steward-activation"),
      ).toMatchObject({ status: "active", revision: 2 });
    } finally {
      t.sqlite.close();
    }
  });

  test("a repository admin who is not the steward still activates the paused project", async () => {
    const t = registry();
    try {
      await t.createPaused("admin-activation");
      const setup = await t.check("admin-activation", REPO_ADMIN);
      expect(setup).toMatchObject({
        state: "ready",
        status: "active",
        activatedRevision: 2,
      });
      expect(await t.persistence.getProject("admin-activation")).toMatchObject({
        status: "active",
        revision: 2,
      });
    } finally {
      t.sqlite.close();
    }
  });

  test("a read-only collaborator still cannot activate the paused project", async () => {
    const t = registry();
    try {
      await t.createPaused("read-collaborator");
      const setup = await t.check("read-collaborator", READER);
      expect(setup).toMatchObject({
        status: "paused",
        activatedRevision: null,
      });
      expect(setup.state).toBe("action_required");
      expect(await t.persistence.getProject("read-collaborator")).toMatchObject(
        { status: "paused", revision: 1 },
      );
    } finally {
      t.sqlite.close();
    }
  });

  test("a writer cannot resume a project paused by an owner edit that needed a fresh scan", async () => {
    const t = registry();
    try {
      await t.createPaused("resume-after-owner-pause");
      // A repository admin activates the project once the scan is clean.
      t.state.clearance = CLEARED;
      const activated = await t.check("resume-after-owner-pause", REPO_ADMIN);
      expect(activated).toMatchObject({
        status: "active",
        activatedRevision: 2,
      });
      // An owner edit to a skill input pauses the project until a fresh
      // scan clears it.
      t.state.clearance = { state: "unscanned" };
      const current = await t.persistence.getProject(
        "resume-after-owner-pause",
      );
      if (!current) throw new Error("Project missing");
      const edited = await t.call(
        "PUT",
        "projects/resume-after-owner-pause",
        CREATOR,
        {
          manifest: {
            ...current.manifest,
            contribution: {
              ...CONTRIBUTION,
              requiredTests: "Run `bun test` twice.",
            },
          },
          expectedRevision: current.revision,
        },
      );
      expect(edited.status).toBe(200);
      expect(
        await t.persistence.getProject("resume-after-owner-pause"),
      ).toMatchObject({ status: "paused", revision: 3 });
      // With the fresh scan clean, a writer's check still must not resume it.
      t.state.clearance = CLEARED;
      const writerSetup = await t.check("resume-after-owner-pause", WRITER);
      expect(writerSetup).toMatchObject({
        state: "action_required",
        status: "paused",
        activatedRevision: null,
      });
      expect(
        await t.persistence.getProject("resume-after-owner-pause"),
      ).toMatchObject({ status: "paused", revision: 3 });
      // A repository admin resumes it.
      const adminSetup = await t.check("resume-after-owner-pause", REPO_ADMIN);
      expect(adminSetup).toMatchObject({
        status: "active",
        activatedRevision: 4,
      });
    } finally {
      t.sqlite.close();
    }
  });
});
