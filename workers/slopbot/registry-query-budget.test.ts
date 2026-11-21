/** Fresh native D1 authority reads: PRD5/9/11. No model or public API calls. */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  CloudflareProjectPersistence,
  enforcementStatement,
} from "../../backend/projects/cloudflare-persistence";
import type { ProjectEnforcement } from "../../src/lib/project-contracts";
import { assertProjectDefinition } from "../../src/lib/project-schema.mjs";
import { fixtureProject } from "../../tests/fixture-overlay.mjs";
import { sqliteD1 } from "../../tests/sqlite-d1";
import type { D1Database } from "./persistence";
import { repositoryCapabilities } from "./registry";

const at = "2026-11-01T00:00:00.000Z";
const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

function fixture(
  options: { retired?: boolean; restrictionRetired?: boolean } = {},
) {
  const { db, sqlite } = sqliteD1();
  const initial = assertProjectDefinition({
    ...fixtureProject("asi"),
    repositories: [
      ...fixtureProject("asi").repositories,
      {
        id: "acme-tools/extra",
        aliases: ["Acme-Tools/Renamed"],
        displayName: "Extra",
        githubUrl: "https://github.com/Acme-Tools/Renamed",
        description: "Additional source fixture",
        integrationBranch: "main",
        githubId: "555000111",
        nodeId: "R_extra",
        countsFrom: at,
      },
    ],
  });
  function seed(project: typeof initial, revision = 1, first = project) {
    for (const [n, manifest] of revision === 2
      ? ([
          [1, first],
          [2, project],
        ] as const)
      : ([[1, project]] as const)) {
      const text = JSON.stringify(manifest);
      sqlite.run(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES (?,?,?,?,?,?)",
        [project.id, n, text, digest(text), "Registry query fixture", at],
      );
    }
    const text = JSON.stringify(project);
    sqlite.run(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
      [project.id, project.status, revision, text, digest(text), at, at],
    );
    for (const repository of project.repositories)
      for (const key of [repository.id, ...(repository.aliases ?? [])])
        sqlite.run(
          "INSERT INTO project_repositories(repository_key,project_id) VALUES (?,?)",
          [key.toLowerCase(), project.id],
        );
  }
  const project = options.retired
    ? assertProjectDefinition({
        ...initial,
        status: "paused",
        listingTier: "retired",
      })
    : initial;
  seed(options.restrictionRetired ? initial : project);
  const other = fixtureProject("canonry");
  seed(other);
  async function enforce(
    input: {
      projectId?: string;
      githubId?: string;
      keys?: string[];
      state?: "banned" | "quarantined" | "clear";
      sequence?: number;
      appended?: boolean;
    } = {},
  ) {
    const projectId = input.projectId ?? other.id,
      state = input.state ?? "banned",
      sequence = input.sequence ?? 1;
    const before = projectId === project.id ? initial : other;
    const record: ProjectEnforcement = {
      id: `enf_query_${projectId}_${sequence}`,
      projectId,
      sequence,
      action:
        state === "clear"
          ? "reinstate"
          : state === "banned"
            ? "ban"
            : "quarantine",
      stateAfter: state,
      appealAfter: state === "clear" ? "granted" : "none",
      reason: "Native restriction fixture",
      evidenceReference: "https://example.invalid/review",
      repositoryGithubId: input.githubId ?? "999000999",
      repositoryKeys: input.keys ?? ["unrelated/repository"],
      actor: { githubId: "900000002", githubLogin: "moderator" },
      actorRole: "project-moderator",
      decisionSource: "admin-panel",
      beforeRevision: 1,
      beforeManifestSha256: digest(JSON.stringify(before)),
      afterRevision: input.appended ? 2 : null,
      afterManifestSha256: input.appended
        ? digest(JSON.stringify(project))
        : null,
      result: input.appended ? "revision_appended" : "revision_pending",
      createdAt: at,
    };
    if (input.appended) {
      const manifestText = JSON.stringify(project);
      expect(
        await new CloudflareProjectPersistence(db).appendEnforcement(
          record,
          {
            projectId,
            expectedRevision: 1,
            manifest: project,
            manifestText,
            manifestSha256: digest(manifestText),
            reason: "Restriction retires listing",
            actor: { githubId: "900000002", githubLogin: "moderator" },
            at,
          },
          [],
        ),
      ).toBe("recorded");
    } else {
      await enforcementStatement(db, record).run();
    }
  }
  let calls = 0;
  const observed: D1Database = {
    prepare(sql) {
      const wrap = (
        statement: ReturnType<typeof db.prepare>,
      ): ReturnType<D1Database["prepare"]> &
        Pick<ReturnType<typeof db.prepare>, "all"> => ({
        bind: (...values: unknown[]) => wrap(statement.bind(...values)),
        first: async <T>() => {
          calls++;
          return statement.first<T>();
        },
        all: async <T>() => {
          calls++;
          return statement.all<T>();
        },
        run: async () => {
          calls++;
          return statement.run();
        },
      });
      return wrap(db.prepare(sql));
    },
  };
  const job = {
    owner: "SlopDotCash",
    repo: "asi",
    repositoryId: Number(project.authority.repositoryId),
  };
  return {
    db,
    sqlite,
    project,
    initial,
    other,
    observed,
    job,
    enforce,
    calls: () => calls,
  };
}

test("every ordinary authority lookup is one fresh D1 read; a later pause wins", async () => {
  const f = fixture();
  try {
    expect(
      (await repositoryCapabilities(f.observed, f.job)).capabilities
        .mayOfferContributorWork,
    ).toBe(true);
    expect(f.calls()).toBe(1);
    const manifest = assertProjectDefinition({
      ...f.project,
      status: "paused",
    });
    const text = JSON.stringify(manifest);
    const persistence = new CloudflareProjectPersistence(f.db);
    expect(
      await persistence.appendProjectRevision(
        {
          projectId: f.project.id,
          expectedRevision: 1,
          manifest,
          manifestText: text,
          manifestSha256: digest(text),
          reason: "Pause between source checks",
          actor: { githubId: "900000002", githubLogin: "moderator" },
          at,
        },
        0,
      ),
    ).toBe("updated");
    expect(
      (await repositoryCapabilities(f.observed, f.job)).capabilities
        .mayOfferContributorWork,
    ).toBe(false);
    expect(f.calls()).toBe(2);
  } finally {
    f.sqlite.close();
  }
});

for (const identity of [
  "project",
  "permanent",
  "original",
  "alias",
  "appended",
  "appended-alias",
  "appended-id",
] as const) {
  test(`fresh cross-project restriction matches ${identity} identity and clears only at its latest record`, async () => {
    const f = fixture();
    try {
      const input =
        identity === "project"
          ? { projectId: f.project.id }
          : identity === "permanent"
            ? { githubId: f.project.authority.repositoryId }
            : {
                keys: [
                  {
                    original: "elizaos/asi",
                    alias: "slopdotcash/asi",
                    appended: "acme-tools/extra",
                    "appended-alias": "acme-tools/renamed",
                    "appended-id": "github:555000111",
                  }[identity],
                ],
              };
      expect(
        (await repositoryCapabilities(f.observed, f.job)).capabilities
          .mayOfferContributorWork,
      ).toBe(true);
      await f.enforce(input);
      const restricted = await repositoryCapabilities(f.observed, f.job);
      expect(restricted.capabilities.mayOfferContributorWork).toBe(false);
      expect(restricted.capabilities.mayReviewForSecurity).toBe(true);
      await f.enforce({ ...input, sequence: 2, state: "clear" });
      expect(
        (await repositoryCapabilities(f.observed, f.job)).capabilities
          .mayOfferContributorWork,
      ).toBe(true);
      expect(f.calls()).toBe(3);
    } finally {
      f.sqlite.close();
    }
  });
}

test("unrelated bans do not restrict a source; matching bans outrank quarantine", async () => {
  const f = fixture();
  try {
    await f.enforce();
    expect(
      (await repositoryCapabilities(f.observed, f.job)).capabilities
        .mayOfferContributorWork,
    ).toBe(true);
    await f.enforce({ projectId: f.project.id, state: "quarantined" });
    expect(
      (await repositoryCapabilities(f.observed, f.job)).capabilities.reasons
        .contributor,
    ).toBe("project is quarantined");
    await f.enforce({
      sequence: 2,
      githubId: f.project.authority.repositoryId,
    });
    expect(
      (await repositoryCapabilities(f.observed, f.job)).capabilities.reasons
        .contributor,
    ).toBe("project is banned");
  } finally {
    f.sqlite.close();
  }
});

test("current names and each permanent repository id still determine review authority", async () => {
  const f = fixture();
  try {
    for (const job of [
      { ...f.job, owner: "elizaOS" },
      { ...f.job, repositoryId: f.job.repositoryId + 1 },
      {
        owner: "Acme-Tools",
        repo: "Renamed",
        repositoryId: f.job.repositoryId,
      },
    ])
      expect(
        (await repositoryCapabilities(f.observed, job)).projectId,
      ).toBeNull();
    expect(
      (
        await repositoryCapabilities(f.observed, {
          owner: "Acme-Tools",
          repo: "Renamed",
          repositoryId: 555000111,
        })
      ).projectId,
    ).toBe(f.project.id);
    expect(f.calls()).toBe(4);
  } finally {
    f.sqlite.close();
  }
});

for (const proof of [false, true])
  test(`retired listing keeps ${proof ? "restriction revision proof and security review" : "owner retirement and no review"}`, async () => {
    const f = fixture({ retired: true, restrictionRetired: proof });
    try {
      if (proof) await f.enforce({ projectId: f.project.id, appended: true });
      const result = await repositoryCapabilities(f.observed, f.job);
      expect(result.capabilities.mayOfferContributorWork).toBe(false);
      expect(result.capabilities.mayReviewForSecurity).toBe(proof);
    } finally {
      f.sqlite.close();
    }
  });
