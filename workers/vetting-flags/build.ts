/** Build-only inputs for the disposable qualification, never application bindings. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PROJECT_SKILL_TEMPLATES } from "../../src/lib/project-schema.mjs";
import {
  ACCEPTED_SKILL_REVISIONS,
  GUIDE_RENDERER_PATHS,
} from "../../src/lib/project-skill-publication.mjs";

const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export async function prepareFlagsEntry(root: string, directory: string) {
  const source = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
  const workingTree =
    execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf8",
    }).trim() !== "";
  const assets: Record<string, string> = {};
  async function file(path: string) {
    const text = await readFile(join(root, path), "utf8");
    assets[path] = text;
    return { path, sha256: digest(text) };
  }
  async function group(sourcePath: string) {
    const paths = execFileSync("git", ["ls-files", "-z", "--", sourcePath], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\0")
      .filter(Boolean)
      .sort();
    return {
      sourcePath,
      files: await Promise.all(
        paths.map(async (path) => ({
          ...(await file(path)),
          path: path.slice(sourcePath.length + 1),
        })),
      ),
    };
  }
  const contributor = await group(PROJECT_SKILL_TEMPLATES.contributor);
  const reviewer = await group(PROJECT_SKILL_TEMPLATES.reviewer);
  const rendererSources = await Promise.all(
    [
      ...GUIDE_RENDERER_PATHS,
      "src/lib/project-skill-publication.mjs",
      "src/lib/project-skill.mjs",
      "src/lib/project-schema.mjs",
    ].map(file),
  );
  const inputs = {
    contributor,
    reviewer,
    rendererSources,
    acceptedRevisions: ACCEPTED_SKILL_REVISIONS,
  };
  assets["index.json"] = JSON.stringify({
    schemaVersion: "1",
    repository: "SlopDotCash/slopdotcash",
    commit: source,
    templateSha256: digest(JSON.stringify(inputs)),
    revisionStatus: "committed",
    contributor,
    reviewer,
    renderer: {
      paths: GUIDE_RENDERER_PATHS,
      sources: rendererSources,
      revisionStatus: "committed",
    },
    acceptedRevisions: ACCEPTED_SKILL_REVISIONS,
  });
  const migrations = (await readdir(join(root, "migrations")))
    .filter((path) => path.endsWith(".sql"))
    .sort();
  const migrationHashes = await Promise.all(
    migrations.map(async (path) => ({
      path,
      sha256: digest(await readFile(join(root, "migrations", path), "utf8")),
    })),
  );
  const entry = join(directory, "flag-entry.ts");
  await writeFile(
    entry,
    `import { qualification } from ${JSON.stringify(join(root, "workers/vetting-flags/qualification.ts"))};\nexport default qualification(${JSON.stringify({ source, workingTree, assets, migrationHashes })});\n`,
  );
  return { entry, migrations, migrationHashes };
}
