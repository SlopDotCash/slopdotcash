/**
 * Builds the public contribution-skill artifacts from their canonical source.
 * The site never carries a hand-maintained skill copy: every raw endpoint,
 * archive, checksum, and manifest is regenerated before development or build.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInstallCommand } from "../src/lib/install-command.ts";
import { PROJECTS } from "../src/lib/projects.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = packageRoot;
const publicRoot = join(packageRoot, "public");
const downloadsRoot = join(publicRoot, "downloads");
const skillRoot = join(repositoryRoot, "skills", "contribute-to-eliza");
const skillSource = join(skillRoot, "SKILL.md");
const repositoryContractPath = join(
  skillRoot,
  "references",
  "repository-contract.md",
);
const evidenceRubricPath = join(
  skillRoot,
  "references",
  "evidence-review-rubric.md",
);
const packager = join(
  repositoryRoot,
  "scripts",
  "skill-validation",
  "package_skill.py",
);
const archiveNormalizer = join(
  packageRoot,
  "scripts",
  "normalize-skill-archive.py",
);
const archiveName = "contribute-to-eliza.skill";
const archivePath = join(downloadsRoot, archiveName);
const skillRepositoryPath = "skills/contribute-to-eliza";
const sourcePath = `${skillRepositoryPath}/SKILL.md`;
const publicSiteOrigin = "https://slop.cash";

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function run(executable, args, cwd = repositoryRoot) {
  execFileSync(executable, args, {
    cwd,
    stdio: "inherit",
  });
}

function listRegularSkillFiles(root, prefix = "") {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = join(root, entry.name);
    const relativePath = join(prefix, entry.name).replaceAll("\\", "/");
    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink()) {
      throw new TypeError(
        `[Slop] skill source contains a symlink: ${relativePath}`,
      );
    }
    if (stats.isDirectory()) {
      return listRegularSkillFiles(absolutePath, relativePath);
    }
    if (!stats.isFile()) {
      throw new TypeError(
        `[Slop] skill source contains a non-regular file: ${relativePath}`,
      );
    }
    return [relativePath];
  });
}

mkdirSync(publicRoot, { recursive: true });
mkdirSync(downloadsRoot, { recursive: true });

const skillMarkdown = readFileSync(skillSource);
const repositoryContract = readFileSync(repositoryContractPath, "utf8");
const evidenceRubric = readFileSync(evidenceRubricPath, "utf8");
const skillDigest = sha256(skillMarkdown);
const trackedSkillFiles = execFileSync(
  "git",
  ["ls-files", "-z", "--", skillRepositoryPath],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean)
  .map((path) => relative(skillRepositoryPath, path).replaceAll("\\", "/"))
  .sort();
const actualSkillFiles = listRegularSkillFiles(skillRoot).sort();
if (
  trackedSkillFiles.length === 0 ||
  trackedSkillFiles.includes("PROVENANCE.json") ||
  trackedSkillFiles.some(
    (path) => path === ".." || path.startsWith("../") || path.includes("/../"),
  )
) {
  throw new TypeError(
    "[Slop] tracked skill file manifest is empty, escaped its root, or reserves PROVENANCE.json",
  );
}
if (trackedSkillFiles.length > 32) {
  throw new TypeError(
    "[Slop] canonical skill exceeds the installer's 32-file authority bound",
  );
}
if (
  trackedSkillFiles.length !== actualSkillFiles.length ||
  trackedSkillFiles.some((path, index) => path !== actualSkillFiles[index])
) {
  const tracked = new Set(trackedSkillFiles);
  const actual = new Set(actualSkillFiles);
  const extras = actualSkillFiles.filter((path) => !tracked.has(path));
  const missing = trackedSkillFiles.filter((path) => !actual.has(path));
  throw new TypeError(
    `[Slop] skill source must exactly match tracked files (extra: ${extras.join(", ") || "none"}; missing: ${missing.join(", ") || "none"})`,
  );
}
const skillFileManifest = trackedSkillFiles.map((path) => ({
  path,
  sha256: sha256(readFileSync(join(skillRoot, path))),
}));
const commit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: repositoryRoot,
  encoding: "utf8",
}).trim();
if (!/^[0-9a-f]{40}$/.test(commit)) {
  throw new TypeError("[Slop] git did not return a full commit SHA");
}
const committedSkillFiles = execFileSync(
  "git",
  ["ls-tree", "-r", "-z", "--name-only", "HEAD", "--", skillRepositoryPath],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean)
  .map((path) => relative(skillRepositoryPath, path).replaceAll("\\", "/"))
  .sort();
const sourceMatchesCommit =
  committedSkillFiles.length === trackedSkillFiles.length &&
  committedSkillFiles.every(
    (path, index) =>
      path === trackedSkillFiles[index] &&
      readFileSync(join(skillRoot, path)).equals(
        execFileSync("git", ["show", `HEAD:${skillRepositoryPath}/${path}`], {
          cwd: repositoryRoot,
          encoding: null,
          maxBuffer: 16 * 1024 * 1024,
        }),
      ),
  );
const sourceRevisionStatus = sourceMatchesCommit ? "committed" : "working-tree";

run(process.execPath, [
  join(repositoryRoot, "scripts", "sync-brand-assets.mjs"),
  publicRoot,
  "--logos",
  "--favicons",
  "--ogembeds",
]);

const packagingRoot = mkdtempSync(
  join(tmpdir(), "eliza-computer-skill-package-"),
);
const stagedSkillRoot = join(packagingRoot, "contribute-to-eliza");
const stagedDownloadsRoot = join(packagingRoot, "downloads");
const stagedPublicArchive = join(
  downloadsRoot,
  `.${archiveName}.${process.pid}.tmp`,
);
let archive;
try {
  for (const path of trackedSkillFiles) {
    const destination = join(stagedSkillRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(skillRoot, path), destination);
  }
  writeFileSync(
    join(stagedSkillRoot, "PROVENANCE.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1",
        name: "contribute-to-eliza",
        repository: "elizaOS/army",
        revision: sourceRevisionStatus === "committed" ? commit : null,
        revisionStatus: sourceRevisionStatus,
        source: {
          path: sourcePath,
          sha256: skillDigest,
        },
        files: skillFileManifest,
      },
      null,
      2,
    )}\n`,
  );
  run("python3", [packager, stagedSkillRoot, stagedDownloadsRoot]);
  const packagedArchive = join(stagedDownloadsRoot, archiveName);
  run("python3", [archiveNormalizer, packagedArchive]);
  archive = readFileSync(packagedArchive);
  if (archive.length === 0) {
    throw new Error("[Slop] packaged skill archive is empty");
  }
  copyFileSync(packagedArchive, stagedPublicArchive);
  renameSync(stagedPublicArchive, archivePath);
} finally {
  rmSync(stagedPublicArchive, { force: true });
  rmSync(packagingRoot, { force: true, recursive: true });
}

const archiveDigest = sha256(archive);

copyFileSync(skillSource, join(publicRoot, "skill.md"));
const standaloneMission = `${skillMarkdown.toString()}

---

# Embedded repository contract

The URL-only mission embeds both required references so an agent does not need
to fetch or execute additional code. If the local live-report script is absent,
use the read-only inspection commands below and verify live claim state
manually.

${repositoryContract}

---

# Embedded evidence and review rubric

${evidenceRubric}
`;
writeFileSync(join(publicRoot, "mission.md"), standaloneMission);

const codexBootstrap = `# Install contribute-to-eliza for Codex

Install or update the complete skill archive. The installer accepts the current
\`develop\` commit, a develop ancestor only while its complete canonical skill
tree remains byte-identical to current \`develop\`, or a same-repository,
non-draft pull request labeled
\`gitarmy-release-candidate\` after its exact current-head event and fully
synchronized with \`develop\`, then independently compares every packaged byte
with GitHub's immutable source. This does not replace a repository's \`AGENTS.md\`
or any local instructions.

\`\`\`bash
${createInstallCommand(
  publicSiteOrigin,
  `\${CODEX_HOME:-\${HOME}/.codex}/skills`,
)}
\`\`\`

Then ask Codex:

\`\`\`text
Use $contribute-to-eliza to finish one scoped elizaOS issue or independently
review one open elizaOS pull request.
\`\`\`

Versions live beside one atomic \`contribute-to-eliza\` symlink. Re-running the
command is a no-op at the same revision and updates only when GitHub proves the
installed revision is an ancestor of the newly authorized revision. The prior
verified version is retained, but rollback still requires current authorization.
To roll back, export
\`GITARMY_SKILL_OPERATION=rollback\` and
\`GITARMY_SKILL_REVISION=<retained-40-character-revision>\`, then run the
same command. The rollback byte-verifies both the active and retained versions,
then applies the current GitHub authorization rules to the requested target
immediately before switching the symlink. The stored receipt records how a
version entered the local store; it cannot authorize rollback. Unset both
variables afterward so the next invocation returns to install/update mode.

Inspect the installed source before running it:

\`\`\`bash
curl -fsSL ${publicSiteOrigin}/skill-manifest.json
SKILLS_ROOT="\${CODEX_HOME:-\${HOME}/.codex}/skills"
cat "\${SKILLS_ROOT}/contribute-to-eliza/PROVENANCE.json"
sed -n '1,240p' "\${SKILLS_ROOT}/contribute-to-eliza/SKILL.md"
\`\`\`
`;

writeFileSync(join(publicRoot, "codex.md"), codexBootstrap);
const shellDollar = "$";
const claudeBootstrap = codexBootstrap
  .replace(" for Codex", " for Claude Code")
  .replace("Then ask Codex:", "Then ask Claude Code:")
  .replaceAll(
    `${shellDollar}{CODEX_HOME:-${shellDollar}{HOME}/.codex}`,
    `${shellDollar}{CLAUDE_CONFIG_DIR:-${shellDollar}{HOME}/.claude}`,
  );
writeFileSync(join(publicRoot, "claude.md"), claudeBootstrap);
writeFileSync(join(publicRoot, "claude-code.md"), claudeBootstrap);
writeFileSync(
  join(downloadsRoot, `${archiveName}.sha256`),
  `${archiveDigest}  ${archiveName}\n`,
);

const manifest = {
  schemaVersion: "1",
  name: "contribute-to-eliza",
  repository: "elizaOS/army",
  revision: commit,
  revisionStatus: sourceRevisionStatus,
  generatedAt: new Date().toISOString(),
  source: {
    path: sourcePath,
    url: `https://github.com/elizaOS/army/blob/${commit}/${sourcePath}`,
    publicUrl: `${publicSiteOrigin}/skill.md`,
    sha256: skillDigest,
  },
  archive: {
    url: `${publicSiteOrigin}/downloads/${archiveName}`,
    sha256: archiveDigest,
    checksumUrl: `${publicSiteOrigin}/downloads/${archiveName}.sha256`,
  },
  authority: {
    apiOrigin: "https://api.github.com",
    rawOrigin: "https://raw.githubusercontent.com",
    canonicalPath: skillRepositoryPath,
    releaseCandidateLabel: "gitarmy-release-candidate",
    acceptedRevisions: [
      "current develop head",
      "develop ancestor whose complete canonical skill tree is byte-identical to current develop",
      "open non-draft same-repository PR head into develop, zero behind current develop, with a release-candidate label event after the exact current-head event",
    ],
  },
  provenance: {
    status: "self-reported",
    policy:
      "Contributors disclose provider, exact model identifier, client, and skill revision. Disclosure is not independently verified and does not affect score.",
  },
};

writeFileSync(
  join(publicRoot, "skill-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

function projectBootstrap({
  artifactOrigin,
  name,
  skillRepositoryPath,
  skillsRoot = `\${CODEX_HOME:-\${HOME}/.codex}/skills`,
}) {
  return `# Install ${name}

Install or update the complete skill archive. The authenticated installer
accepts the current \`develop\` revision, a byte-identical authorized ancestor,
or an explicitly labeled same-repository release candidate. It independently
compares packaged bytes with immutable GitHub source before atomic activation.

\`\`\`bash
${createInstallCommand(artifactOrigin, skillsRoot, {
  skillName: name,
  skillRepositoryPath,
})}
\`\`\`

Re-run the command whenever the skill starts. It is a no-op at the current
verified revision and retains the prior version for an explicitly authorized
rollback. Inspect \`PROVENANCE.json\` and \`SKILL.md\` before first use. Never
enter a wallet seed phrase, private key, or unrelated credential.
`;
}

function publishPrimaryProjectAlias() {
  const projectRoot = join(publicRoot, "projects", "eliza");
  const projectDownloads = join(projectRoot, "downloads");
  mkdirSync(projectDownloads, { recursive: true });
  copyFileSync(skillSource, join(projectRoot, "skill.md"));
  writeFileSync(join(projectRoot, "mission.md"), standaloneMission);
  copyFileSync(archivePath, join(projectDownloads, archiveName));
  copyFileSync(
    join(downloadsRoot, `${archiveName}.sha256`),
    join(projectDownloads, `${archiveName}.sha256`),
  );
  writeFileSync(
    join(projectRoot, "codex.md"),
    projectBootstrap({
      artifactOrigin: `${publicSiteOrigin}/projects/eliza`,
      name: "contribute-to-eliza",
      skillRepositoryPath: "skills/contribute-to-eliza",
    }),
  );
  const claudeGuide = projectBootstrap({
    artifactOrigin: `${publicSiteOrigin}/projects/eliza`,
    name: "contribute-to-eliza",
    skillRepositoryPath: "skills/contribute-to-eliza",
    skillsRoot: `\${CLAUDE_CONFIG_DIR:-\${HOME}/.claude}/skills`,
  });
  writeFileSync(join(projectRoot, "claude.md"), claudeGuide);
  writeFileSync(join(projectRoot, "claude-code.md"), claudeGuide);
  const projectManifest = structuredClone(manifest);
  projectManifest.source.publicUrl = `${publicSiteOrigin}/projects/eliza/skill.md`;
  projectManifest.archive.url = `${publicSiteOrigin}/projects/eliza/downloads/${archiveName}`;
  projectManifest.archive.checksumUrl = `${projectManifest.archive.url}.sha256`;
  writeFileSync(
    join(projectRoot, "skill-manifest.json"),
    `${JSON.stringify(projectManifest, null, 2)}\n`,
  );
}

function publishAdditionalProject({ id, name, skillRepositoryPath }) {
  const additionalSkillRoot = join(repositoryRoot, skillRepositoryPath);
  const additionalSkillSource = join(additionalSkillRoot, "SKILL.md");
  const sourcePath = `${skillRepositoryPath}/SKILL.md`;
  const projectRoot = join(publicRoot, "projects", id);
  const projectDownloads = join(projectRoot, "downloads");
  const archiveName = `${name}.skill`;
  mkdirSync(projectDownloads, { recursive: true });

  const trackedFiles = execFileSync(
    "git",
    ["ls-files", "-z", "--", skillRepositoryPath],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .map((path) => relative(skillRepositoryPath, path).replaceAll("\\", "/"))
    .sort();
  const actualFiles = listRegularSkillFiles(additionalSkillRoot).sort();
  if (
    trackedFiles.length === 0 ||
    trackedFiles.includes("PROVENANCE.json") ||
    trackedFiles.length > 32 ||
    trackedFiles.some(
      (path) =>
        path === ".." || path.startsWith("../") || path.includes("/../"),
    ) ||
    trackedFiles.length !== actualFiles.length ||
    trackedFiles.some((path, index) => path !== actualFiles[index])
  ) {
    throw new TypeError(
      `[Slop] ${name} source must be a bounded, tracked, exact file tree`,
    );
  }
  const fileManifest = trackedFiles.map((path) => ({
    path,
    sha256: sha256(readFileSync(join(additionalSkillRoot, path))),
  }));
  const committedFiles = execFileSync(
    "git",
    ["ls-tree", "-r", "-z", "--name-only", "HEAD", "--", skillRepositoryPath],
    { cwd: repositoryRoot, encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean)
    .map((path) => relative(skillRepositoryPath, path).replaceAll("\\", "/"))
    .sort();
  const sourceMatchesCommit =
    committedFiles.length === trackedFiles.length &&
    committedFiles.every(
      (path, index) =>
        path === trackedFiles[index] &&
        readFileSync(join(additionalSkillRoot, path)).equals(
          execFileSync("git", ["show", `HEAD:${skillRepositoryPath}/${path}`], {
            cwd: repositoryRoot,
            encoding: null,
            maxBuffer: 16 * 1024 * 1024,
          }),
        ),
    );
  const revisionStatus = sourceMatchesCommit ? "committed" : "working-tree";
  const skillBytes = readFileSync(additionalSkillSource);
  const packagingRoot = mkdtempSync(join(tmpdir(), `${name}-package-`));
  const stagedSkillRoot = join(packagingRoot, name);
  const stagedDownloadsRoot = join(packagingRoot, "downloads");
  const stagedArchive = join(
    projectDownloads,
    `.${archiveName}.${process.pid}.tmp`,
  );
  let archive;
  try {
    for (const path of trackedFiles) {
      const destination = join(stagedSkillRoot, path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(additionalSkillRoot, path), destination);
    }
    writeFileSync(
      join(stagedSkillRoot, "PROVENANCE.json"),
      `${JSON.stringify(
        {
          schemaVersion: "1",
          name,
          repository: "elizaOS/army",
          revision: revisionStatus === "committed" ? commit : null,
          revisionStatus,
          source: { path: sourcePath, sha256: sha256(skillBytes) },
          files: fileManifest,
        },
        null,
        2,
      )}\n`,
    );
    run("python3", [packager, stagedSkillRoot, stagedDownloadsRoot]);
    const packagedArchive = join(stagedDownloadsRoot, archiveName);
    run("python3", [archiveNormalizer, packagedArchive]);
    archive = readFileSync(packagedArchive);
    if (archive.length === 0) throw new Error(`[Slop] ${archiveName} is empty`);
    copyFileSync(packagedArchive, stagedArchive);
    renameSync(stagedArchive, join(projectDownloads, archiveName));
  } finally {
    rmSync(stagedArchive, { force: true });
    rmSync(packagingRoot, { force: true, recursive: true });
  }

  const archiveDigest = sha256(archive);
  const references = trackedFiles
    .filter((path) => path.startsWith("references/") && path.endsWith(".md"))
    .map((path) => readFileSync(join(additionalSkillRoot, path), "utf8"));
  writeFileSync(join(projectRoot, "skill.md"), skillBytes);
  writeFileSync(
    join(projectRoot, "mission.md"),
    `${skillBytes.toString()}\n\n---\n\n${references.join("\n\n---\n\n")}`,
  );
  writeFileSync(
    join(projectRoot, "codex.md"),
    projectBootstrap({
      artifactOrigin: `${publicSiteOrigin}/projects/${id}`,
      name,
      skillRepositoryPath,
    }),
  );
  const claudeGuide = projectBootstrap({
    artifactOrigin: `${publicSiteOrigin}/projects/${id}`,
    name,
    skillRepositoryPath,
    skillsRoot: `\${CLAUDE_CONFIG_DIR:-\${HOME}/.claude}/skills`,
  });
  writeFileSync(join(projectRoot, "claude.md"), claudeGuide);
  writeFileSync(join(projectRoot, "claude-code.md"), claudeGuide);
  writeFileSync(
    join(projectDownloads, `${archiveName}.sha256`),
    `${archiveDigest}  ${archiveName}\n`,
  );
  const additionalManifest = {
    schemaVersion: "1",
    name,
    repository: "elizaOS/army",
    revision: commit,
    revisionStatus,
    generatedAt: new Date().toISOString(),
    source: {
      path: sourcePath,
      url: `https://github.com/elizaOS/army/blob/${commit}/${sourcePath}`,
      publicUrl: `${publicSiteOrigin}/projects/${id}/skill.md`,
      sha256: sha256(skillBytes),
    },
    archive: {
      url: `${publicSiteOrigin}/projects/${id}/downloads/${archiveName}`,
      sha256: archiveDigest,
      checksumUrl: `${publicSiteOrigin}/projects/${id}/downloads/${archiveName}.sha256`,
    },
    authority: {
      apiOrigin: "https://api.github.com",
      rawOrigin: "https://raw.githubusercontent.com",
      canonicalPath: skillRepositoryPath,
      releaseCandidateLabel: "gitarmy-release-candidate",
      acceptedRevisions: manifest.authority.acceptedRevisions,
    },
    telemetry: {
      source: "ccusage@20.0.19",
      policy:
        "Raw sessions stay local. Public receipts contain aggregate locally reported usage, provenance, optional trajectory digest, and a device signature.",
    },
  };
  writeFileSync(
    join(projectRoot, "skill-manifest.json"),
    `${JSON.stringify(additionalManifest, null, 2)}\n`,
  );
  console.log(
    `[Slop] prepared ${archiveName} (${archiveDigest.slice(0, 12)}) from ${commit.slice(0, 12)}`,
  );
}

publishPrimaryProjectAlias();
for (const project of PROJECTS) {
  if (project.id === "eliza") continue;
  publishAdditionalProject({
    id: project.id,
    name: project.skill.id,
    skillRepositoryPath: project.skill.sourcePath,
  });
}
run("bun", [join(repositoryRoot, "scripts", "sync-cycle-index.ts")]);

console.log(
  `[Slop] prepared ${archiveName} (${archiveDigest.slice(0, 12)}) from ${commit.slice(0, 12)}`,
);
