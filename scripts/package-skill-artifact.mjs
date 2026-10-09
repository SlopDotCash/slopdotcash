/** Stage, normalize and atomically publish a skill archive with its provenance. */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function packageSkillArtifact({
  repositoryRoot,
  skillRoot,
  downloadsRoot,
  provenance,
  runPython,
}) {
  const archiveName = `${provenance.name}.skill`;
  const packagingRoot = mkdtempSync(
    join(tmpdir(), `${provenance.name}-package-`),
  );
  const stagedSkillRoot = join(packagingRoot, provenance.name);
  const stagedDownloadsRoot = join(packagingRoot, "downloads");
  const stagedArchive = join(
    downloadsRoot,
    `.${archiveName}.${process.pid}.tmp`,
  );
  try {
    for (const { path } of provenance.files) {
      const destination = join(stagedSkillRoot, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(skillRoot, path), destination);
    }
    writeFileSync(
      join(stagedSkillRoot, "PROVENANCE.json"),
      `${JSON.stringify(provenance, null, 2)}\n`,
    );
    runPython([
      join(repositoryRoot, "scripts", "skill-validation", "package_skill.py"),
      stagedSkillRoot,
      stagedDownloadsRoot,
    ]);
    const packagedArchive = join(stagedDownloadsRoot, archiveName);
    runPython([
      join(repositoryRoot, "scripts", "normalize-skill-archive.py"),
      packagedArchive,
    ]);
    const archive = readFileSync(packagedArchive);
    if (archive.length === 0) throw new Error(`[Slop] ${archiveName} is empty`);
    copyFileSync(packagedArchive, stagedArchive);
    renameSync(stagedArchive, join(downloadsRoot, archiveName));
    return archive;
  } finally {
    rmSync(stagedArchive, { force: true });
    rmSync(packagingRoot, { force: true, recursive: true });
  }
}
