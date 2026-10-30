import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { assertProjectRegistry } from "../src/lib/project-schema.mjs";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import { renderProjectRevisions } from "./sync-project-registry.mjs";

type Revision = {
  projectId: string;
  revision: number;
  manifest: ProjectDefinition;
  manifestSha256: string;
  reason: string;
  createdAt: string;
};
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Import the validated public snapshot without replacing local project edits. */
export function syncDevProjectRegistry(
  sqlite: Database,
  source: unknown,
  history: unknown,
) {
  const projects = assertProjectRegistry(source);
  const revisions = JSON.parse(
    renderProjectRevisions(history, projects),
  ) as Revision[];
  sqlite.exec(`CREATE TABLE IF NOT EXISTS dev_registry_sources (
    project_id TEXT PRIMARY KEY, manifest_sha256 TEXT NOT NULL
  ) STRICT`);
  let imported = 0;
  sqlite.transaction(() => {
    for (const project of projects) {
      const repositoryKeys = [
        ...new Set(
          project.repositories.flatMap((repository) =>
            [repository.id, ...(repository.aliases ?? [])].map((name) =>
              name.toLowerCase(),
            ),
          ),
        ),
      ];
      const records = revisions.filter((row) => row.projectId === project.id);
      const latest = records.at(-1);
      if (!latest || latest.manifestSha256 !== digest(project))
        throw new Error(
          "Sync the complete project registry before local development",
        );
      const current = sqlite
        .query("SELECT revision,manifest_sha256 FROM projects WHERE id=?")
        .get(project.id) as {
        revision: number;
        manifest_sha256: string;
      } | null;
      const tracked = sqlite
        .query(
          "SELECT manifest_sha256 FROM dev_registry_sources WHERE project_id=?",
        )
        .get(project.id) as { manifest_sha256: string } | null;
      if (
        current &&
        (!tracked || current.manifest_sha256 !== tracked.manifest_sha256)
      )
        continue;
      if (current && current.revision > latest.revision) continue;
      // A local project can intentionally own a repository from the public
      // snapshot. Keep that local inventory rather than aborting startup or
      // taking its repository keys for a public clone.
      if (
        repositoryKeys.some((key) =>
          sqlite
            .query(
              "SELECT 1 FROM project_repositories WHERE repository_key=? AND project_id<>?",
            )
            .get(key, project.id),
        )
      )
        continue;
      for (const row of records) {
        const retained = sqlite
          .query(
            "SELECT manifest_sha256 FROM project_revisions WHERE project_id=? AND revision=?",
          )
          .get(row.projectId, row.revision) as {
          manifest_sha256: string;
        } | null;
        if (retained && retained.manifest_sha256 !== row.manifestSha256)
          throw new Error(
            "A local project revision differs from the public snapshot",
          );
        if (!retained)
          sqlite
            .query(`INSERT INTO project_revisions
          (project_id,revision,manifest,manifest_sha256,reason,created_at)
          VALUES(?,?,?,?,?,?)`)
            .run(
              row.projectId,
              row.revision,
              JSON.stringify(row.manifest),
              row.manifestSha256,
              row.reason,
              row.createdAt,
            );
        if (current && row.revision > current.revision)
          sqlite
            .query(`UPDATE projects
          SET revision=?,status=?,manifest=?,manifest_sha256=?,updated_at=? WHERE id=?`)
            .run(
              row.revision,
              row.manifest.status,
              JSON.stringify(row.manifest),
              row.manifestSha256,
              row.createdAt,
              row.projectId,
            );
      }
      if (!current)
        sqlite
          .query(`INSERT INTO projects
        (id,status,revision,manifest,manifest_sha256,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?)`)
          .run(
            project.id,
            project.status,
            latest.revision,
            JSON.stringify(project),
            latest.manifestSha256,
            records[0].createdAt,
            latest.createdAt,
          );
      sqlite
        .query("DELETE FROM project_repositories WHERE project_id=?")
        .run(project.id);
      for (const key of repositoryKeys)
        sqlite
          .query(
            "INSERT INTO project_repositories(repository_key,project_id) VALUES(?,?)",
          )
          .run(key, project.id);
      sqlite
        .query(
          "INSERT INTO dev_registry_sources VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET manifest_sha256=excluded.manifest_sha256",
        )
        .run(project.id, latest.manifestSha256);
      imported++;
    }
  })();
  return imported;
}
