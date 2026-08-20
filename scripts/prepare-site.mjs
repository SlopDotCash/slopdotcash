/**
 * Builds the public contribution-skill artifacts from their canonical source.
 * The site never carries a hand-maintained skill copy: every raw endpoint,
 * archive, checksum, and manifest is regenerated before development or build.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
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
import { PROJECTS } from "../src/lib/projects.mjs";
import { readIdentityRecord } from "./protocol-identity.mjs";
import { renderInstallGuide } from "./render-install-guide.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = packageRoot;
const publicRoot = join(packageRoot, "public");
const downloadsRoot = join(publicRoot, "downloads");
const protocolRoot = join(repositoryRoot, "protocol");
const publicProtocolRoot = join(publicRoot, "protocol");
const bootstrapSkillRoot = join(repositoryRoot, "skills", "slop");
const bootstrapSkillSource = join(bootstrapSkillRoot, "SKILL.md");
const rootPublishedProjects = PROJECTS.filter(
  (project) => project.skill.publishAtRoot === true,
);
if (rootPublishedProjects.length !== 1) {
  throw new TypeError(
    "[Slop] project registry must select exactly one root-published skill",
  );
}
const rootPublishedProject = rootPublishedProjects[0];
const rootProjectId = rootPublishedProject.id;
const rootSkillName = rootPublishedProject.skill.id;
const skillRepositoryPath = rootPublishedProject.skill.sourcePath;
const skillRoot = join(repositoryRoot, skillRepositoryPath);
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
const skillValidator = join(
  repositoryRoot,
  "scripts",
  "skill-validation",
  "quick_validate.py",
);
const archiveNormalizer = join(
  packageRoot,
  "scripts",
  "normalize-skill-archive.py",
);
const archiveName = `${rootSkillName}.skill`;
const archivePath = join(downloadsRoot, archiveName);
const sourcePath = `${skillRepositoryPath}/SKILL.md`;
const publicSiteOrigin = "https://slop.cash";
const sourceRepository = "SlopDotCash/slopdotcash";

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function frontmatterValue(source, field) {
  const match = source.match(new RegExp(`^${field}:\\s*(.+)$`, "mu"));
  if (!match) {
    throw new TypeError(`[Slop] bootstrap skill omitted ${field}`);
  }
  const value = match[1].trim();
  if (value.startsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "string" && parsed.length > 0) return parsed;
    } catch {
      // error-policy:J3 malformed source metadata is an explicit build failure.
    }
  } else if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) {
    return value;
  }
  throw new TypeError(`[Slop] bootstrap skill has invalid ${field}`);
}

function run(executable, args, cwd = repositoryRoot) {
  execFileSync(executable, args, {
    cwd,
    stdio: "inherit",
  });
}

function pythonCommand() {
  const candidates = [
    process.env.SLOP_PYTHON,
    "python3",
    "/usr/bin/python3",
  ].filter((value, index, values) => value && values.indexOf(value) === index);
  for (const executable of candidates) {
    try {
      execFileSync(
        executable,
        [
          "-c",
          "import yaml,sys;sys.exit(0 if yaml.__version__ == '6.0.3' else 1)",
        ],
        { cwd: repositoryRoot, stdio: "ignore" },
      );
      return { executable, prefix: [] };
    } catch {
      // error-policy:J3 an unavailable validator runtime tries the next pinned path.
    }
  }
  try {
    execFileSync("uv", ["--version"], { stdio: "ignore" });
    return {
      executable: "uv",
      prefix: ["run", "--with", "PyYAML==6.0.3", "python"],
    };
  } catch {
    throw new TypeError(
      "[Slop] skill packaging requires Python with PyYAML 6.0.3 or uv; set SLOP_PYTHON to an interpreter with that exact version",
    );
  }
}

const python = pythonCommand();

function runPython(args, cwd = repositoryRoot) {
  run(python.executable, [...python.prefix, "-B", ...args], cwd);
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
mkdirSync(publicProtocolRoot, { recursive: true });
const privateTraceContractPath = join(protocolRoot, "private-trace-v1.md");
if (!existsSync(privateTraceContractPath)) {
  throw new TypeError("[Slop] private trace privacy contract is missing");
}
copyFileSync(
  privateTraceContractPath,
  join(publicProtocolRoot, "private-trace-v1.md"),
);
const scoringContractPath = join(protocolRoot, "scoring-v2.md");
if (!existsSync(scoringContractPath)) {
  throw new TypeError("[Slop] score v2 contract is missing");
}
copyFileSync(scoringContractPath, join(publicProtocolRoot, "scoring-v2.md"));
const identityRecordPath = join(protocolRoot, "identity-v1.json");
if (existsSync(identityRecordPath)) {
  readIdentityRecord(identityRecordPath);
  copyFileSync(
    identityRecordPath,
    join(publicProtocolRoot, "identity-v1.json"),
  );
}
runPython([skillValidator, bootstrapSkillRoot]);

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
const bootstrapFiles = listRegularSkillFiles(bootstrapSkillRoot);
if (bootstrapFiles.length !== 1 || bootstrapFiles[0] !== "SKILL.md") {
  throw new TypeError(
    "[Slop] universal bootstrap must remain one reviewable SKILL.md",
  );
}
const bootstrapSkillBytes = readFileSync(bootstrapSkillSource);
const bootstrapSkillText = bootstrapSkillBytes.toString("utf8");
const bootstrapSkillName = frontmatterValue(bootstrapSkillText, "name");
const bootstrapSkillDescription = frontmatterValue(
  bootstrapSkillText,
  "description",
);
if (bootstrapSkillName !== "slop") {
  throw new TypeError("[Slop] universal bootstrap must be named slop");
}
const bootstrapSkillDigest = sha256(bootstrapSkillBytes);
let bootstrapRevisionStatus = "working-tree";
try {
  const committedBootstrap = execFileSync(
    "git",
    ["show", "HEAD:skills/slop/SKILL.md"],
    {
      cwd: repositoryRoot,
      encoding: null,
      maxBuffer: 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  if (bootstrapSkillBytes.equals(committedBootstrap)) {
    bootstrapRevisionStatus = "committed";
  }
} catch {
  // error-policy:J3 an absent committed source is an explicit working-tree state.
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
const guideRendererPaths = [
  "scripts/render-install-guide.mjs",
  "src/lib/install-command.ts",
];
const rendererMatchesCommit = guideRendererPaths.every((path) => {
  try {
    return readFileSync(join(repositoryRoot, path)).equals(
      execFileSync("git", ["show", `HEAD:${path}`], {
        cwd: repositoryRoot,
        encoding: null,
        maxBuffer: 16 * 1024 * 1024,
        stdio: ["ignore", "pipe", "ignore"],
      }),
    );
  } catch {
    // error-policy:J3 an absent immutable renderer is an explicit working-tree state.
    return false;
  }
});
const rendererRevisionStatus = rendererMatchesCommit
  ? "committed"
  : "working-tree";

run(process.execPath, [
  join(repositoryRoot, "scripts", "sync-brand-assets.mjs"),
  publicRoot,
  "--logos",
  "--favicons",
  "--ogembeds",
]);

const packagingRoot = mkdtempSync(join(tmpdir(), "slop-skill-package-"));
const stagedSkillRoot = join(packagingRoot, rootSkillName);
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
        name: rootSkillName,
        repository: "SlopDotCash/slopdotcash",
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
  runPython([packager, stagedSkillRoot, stagedDownloadsRoot]);
  const packagedArchive = join(stagedDownloadsRoot, archiveName);
  runPython([archiveNormalizer, packagedArchive]);
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

const discoveryRoot = join(publicRoot, ".well-known", "agent-skills");
const discoverySkillRoot = join(discoveryRoot, "slop");
rmSync(discoveryRoot, { force: true, recursive: true });
mkdirSync(discoverySkillRoot, { recursive: true });
copyFileSync(bootstrapSkillSource, join(publicRoot, "SKILL.md"));
copyFileSync(bootstrapSkillSource, join(discoverySkillRoot, "SKILL.md"));
writeFileSync(
  join(discoveryRoot, "index.json"),
  `${JSON.stringify(
    {
      $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
      skills: [
        {
          name: bootstrapSkillName,
          type: "skill-md",
          description: bootstrapSkillDescription,
          url: `${publicSiteOrigin}/SKILL.md`,
          digest: `sha256:${bootstrapSkillDigest}`,
        },
      ],
    },
    null,
    2,
  )}\n`,
);
writeFileSync(
  join(publicRoot, "llms.txt"),
  `# Slop\n\n> Make money shipping open source. Pick important public work, ship an accepted result, and build a contributor record on GitHub.\n\n## Agent onboarding\n\n- [Slop bootstrap skill](${publicSiteOrigin}/SKILL.md): Inspect and install the repository-specific contribution skill. SHA-256: ${bootstrapSkillDigest}.\n- [Agent Skills discovery index](${publicSiteOrigin}/.well-known/agent-skills/index.json): Machine-readable v0.2 discovery and integrity metadata.\n\nThe bootstrap source revision is ${commit} (${bootstrapRevisionStatus}). It never authorizes wallet creation, background upload, raw prompt, transcript, source, credential, or private-key disclosure.\n`,
);
const projectDiscoveryRoot = join(publicRoot, ".well-known", "slop");
rmSync(projectDiscoveryRoot, { force: true, recursive: true });
mkdirSync(projectDiscoveryRoot, { recursive: true });
writeFileSync(
  join(projectDiscoveryRoot, "projects.json"),
  `${JSON.stringify(
    {
      schemaVersion: "1",
      projects: PROJECTS.flatMap((project) =>
        project.repositories.map((repository) => ({
          project_id: project.id,
          project_url: `${publicSiteOrigin}/projects/${project.id}/`,
          repository: repository.id,
          review_skill: project.reviewSkill.id,
          review_skill_manifest: `${publicSiteOrigin}/projects/${project.id}/review-skill-manifest.json`,
          skill: project.skill.id,
          skill_source: project.skill.sourcePath,
        })),
      ),
    },
    null,
    2,
  )}\n`,
);

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

const primaryGuideOptions = {
  artifactOrigin: `${publicSiteOrigin}/projects/${rootProjectId}`,
  skillName: rootSkillName,
  skillRepositoryPath,
};
const codexBootstrap = renderInstallGuide({
  ...primaryGuideOptions,
  client: "codex",
});

writeFileSync(join(publicRoot, "codex.md"), codexBootstrap);
const claudeBootstrap = renderInstallGuide({
  ...primaryGuideOptions,
  client: "claude-code",
});
writeFileSync(join(publicRoot, "claude.md"), claudeBootstrap);
writeFileSync(join(publicRoot, "claude-code.md"), claudeBootstrap);
const manualBootstrap = renderInstallGuide({
  ...primaryGuideOptions,
  client: "manual",
});
writeFileSync(join(publicRoot, "manual.md"), manualBootstrap);
writeFileSync(
  join(downloadsRoot, `${archiveName}.sha256`),
  `${archiveDigest}  ${archiveName}\n`,
);

function guideRecord({
  artifactOrigin,
  client,
  publicUrl,
  skillName,
  skillRepositoryPath,
  source,
}) {
  return {
    publicUrl,
    sha256: sha256(source),
    renderer: {
      entrypoint: "scripts/render-install-guide.mjs",
      repository: sourceRepository,
      revision: rendererMatchesCommit ? commit : null,
      revisionStatus: rendererRevisionStatus,
      paths: guideRendererPaths,
      arguments: [
        "--artifact-origin",
        artifactOrigin,
        "--client",
        client,
        "--skill",
        skillName,
        "--source",
        skillRepositoryPath,
      ],
    },
  };
}

const manifest = {
  schemaVersion: "1",
  name: rootSkillName,
  repository: "SlopDotCash/slopdotcash",
  revision: commit,
  revisionStatus: sourceRevisionStatus,
  generatedAt: new Date().toISOString(),
  source: {
    path: sourcePath,
    url: `https://github.com/SlopDotCash/slopdotcash/blob/${commit}/${sourcePath}`,
    publicUrl: `${publicSiteOrigin}/projects/${rootProjectId}/skill.md`,
    sha256: skillDigest,
  },
  archive: {
    url: `${publicSiteOrigin}/downloads/${archiveName}`,
    sha256: archiveDigest,
    checksumUrl: `${publicSiteOrigin}/downloads/${archiveName}.sha256`,
  },
  guides: {
    codex: guideRecord({
      artifactOrigin: primaryGuideOptions.artifactOrigin,
      client: "codex",
      publicUrl: `${publicSiteOrigin}/codex.md`,
      skillName: primaryGuideOptions.skillName,
      skillRepositoryPath: primaryGuideOptions.skillRepositoryPath,
      source: codexBootstrap,
    }),
    claude: guideRecord({
      artifactOrigin: primaryGuideOptions.artifactOrigin,
      client: "claude-code",
      publicUrl: `${publicSiteOrigin}/claude.md`,
      skillName: primaryGuideOptions.skillName,
      skillRepositoryPath: primaryGuideOptions.skillRepositoryPath,
      source: claudeBootstrap,
    }),
    manual: guideRecord({
      artifactOrigin: primaryGuideOptions.artifactOrigin,
      client: "manual",
      publicUrl: `${publicSiteOrigin}/manual.md`,
      skillName: primaryGuideOptions.skillName,
      skillRepositoryPath: primaryGuideOptions.skillRepositoryPath,
      source: manualBootstrap,
    }),
  },
  authority: {
    apiOrigin: "https://api.github.com",
    rawOrigin: "https://raw.githubusercontent.com",
    canonicalPath: skillRepositoryPath,
    releaseCandidateLabel: "slop-release-candidate",
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
  telemetry: {
    source: "ccusage@20.0.20",
    policy:
      "Every agent run permanently uploads its contributor-inspected, minimized run trace under https://slop.cash/protocol/private-trace-v1.md before submission; the uploader performs no automatic redaction. Public receipts contain aggregate locally reported usage, exact self-reported identity, the required trace digest and upload identity, and a device signature. The fixed private-trace evidence bonus follows https://slop.cash/protocol/scoring-v2.md; token usage is diagnostic and never changes score, rank, reward share, or payment. Unsupported usage adapters never block participation.",
  },
};

writeFileSync(
  join(publicRoot, "skill-manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);

function publishPrimaryProjectAlias() {
  const projectRoot = join(publicRoot, "projects", rootProjectId);
  const projectDownloads = join(projectRoot, "downloads");
  mkdirSync(projectDownloads, { recursive: true });
  copyFileSync(skillSource, join(projectRoot, "skill.md"));
  writeFileSync(join(projectRoot, "mission.md"), standaloneMission);
  copyFileSync(archivePath, join(projectDownloads, archiveName));
  copyFileSync(
    join(downloadsRoot, `${archiveName}.sha256`),
    join(projectDownloads, `${archiveName}.sha256`),
  );
  const codexGuide = codexBootstrap;
  writeFileSync(join(projectRoot, "codex.md"), codexGuide);
  const claudeGuide = claudeBootstrap;
  writeFileSync(join(projectRoot, "claude.md"), claudeGuide);
  writeFileSync(join(projectRoot, "claude-code.md"), claudeGuide);
  const manualGuide = manualBootstrap;
  writeFileSync(join(projectRoot, "manual.md"), manualGuide);
  const projectManifest = structuredClone(manifest);
  projectManifest.source.publicUrl = `${publicSiteOrigin}/projects/${rootProjectId}/skill.md`;
  projectManifest.archive.url = `${publicSiteOrigin}/projects/${rootProjectId}/downloads/${archiveName}`;
  projectManifest.archive.checksumUrl = `${projectManifest.archive.url}.sha256`;
  projectManifest.guides = {
    codex: guideRecord({
      artifactOrigin: primaryGuideOptions.artifactOrigin,
      client: "codex",
      publicUrl: `${publicSiteOrigin}/projects/${rootProjectId}/codex.md`,
      skillName: primaryGuideOptions.skillName,
      skillRepositoryPath: primaryGuideOptions.skillRepositoryPath,
      source: codexGuide,
    }),
    claude: guideRecord({
      artifactOrigin: primaryGuideOptions.artifactOrigin,
      client: "claude-code",
      publicUrl: `${publicSiteOrigin}/projects/${rootProjectId}/claude.md`,
      skillName: primaryGuideOptions.skillName,
      skillRepositoryPath: primaryGuideOptions.skillRepositoryPath,
      source: claudeGuide,
    }),
    manual: guideRecord({
      artifactOrigin: primaryGuideOptions.artifactOrigin,
      client: "manual",
      publicUrl: `${publicSiteOrigin}/projects/${rootProjectId}/manual.md`,
      skillName: primaryGuideOptions.skillName,
      skillRepositoryPath: primaryGuideOptions.skillRepositoryPath,
      source: manualGuide,
    }),
  };
  writeFileSync(
    join(projectRoot, "skill-manifest.json"),
    `${JSON.stringify(projectManifest, null, 2)}\n`,
  );
}

function publishAdditionalProject({
  id,
  name,
  publicationPrefix = "",
  skillRepositoryPath,
}) {
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
          repository: "SlopDotCash/slopdotcash",
          revision: revisionStatus === "committed" ? commit : null,
          revisionStatus,
          source: { path: sourcePath, sha256: sha256(skillBytes) },
          files: fileManifest,
        },
        null,
        2,
      )}\n`,
    );
    runPython([packager, stagedSkillRoot, stagedDownloadsRoot]);
    const packagedArchive = join(stagedDownloadsRoot, archiveName);
    runPython([archiveNormalizer, packagedArchive]);
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
  writeFileSync(join(projectRoot, `${publicationPrefix}skill.md`), skillBytes);
  writeFileSync(
    join(projectRoot, `${publicationPrefix}mission.md`),
    `${skillBytes.toString()}\n\n---\n\n${references.join("\n\n---\n\n")}`,
  );
  const codexGuide = renderInstallGuide({
    artifactOrigin: `${publicSiteOrigin}/projects/${id}`,
    client: "codex",
    skillName: name,
    skillRepositoryPath,
  });
  writeFileSync(join(projectRoot, `${publicationPrefix}codex.md`), codexGuide);
  const claudeGuide = renderInstallGuide({
    artifactOrigin: `${publicSiteOrigin}/projects/${id}`,
    client: "claude-code",
    skillName: name,
    skillRepositoryPath,
  });
  writeFileSync(
    join(projectRoot, `${publicationPrefix}claude.md`),
    claudeGuide,
  );
  writeFileSync(
    join(projectRoot, `${publicationPrefix}claude-code.md`),
    claudeGuide,
  );
  const manualGuide = renderInstallGuide({
    artifactOrigin: `${publicSiteOrigin}/projects/${id}`,
    client: "manual",
    skillName: name,
    skillRepositoryPath,
  });
  writeFileSync(
    join(projectRoot, `${publicationPrefix}manual.md`),
    manualGuide,
  );
  writeFileSync(
    join(projectDownloads, `${archiveName}.sha256`),
    `${archiveDigest}  ${archiveName}\n`,
  );
  const additionalManifest = {
    schemaVersion: "1",
    name,
    repository: "SlopDotCash/slopdotcash",
    revision: commit,
    revisionStatus,
    generatedAt: new Date().toISOString(),
    source: {
      path: sourcePath,
      url: `https://github.com/SlopDotCash/slopdotcash/blob/${commit}/${sourcePath}`,
      publicUrl: `${publicSiteOrigin}/projects/${id}/${publicationPrefix}skill.md`,
      sha256: sha256(skillBytes),
    },
    archive: {
      url: `${publicSiteOrigin}/projects/${id}/downloads/${archiveName}`,
      sha256: archiveDigest,
      checksumUrl: `${publicSiteOrigin}/projects/${id}/downloads/${archiveName}.sha256`,
    },
    guides: {
      codex: guideRecord({
        artifactOrigin: `${publicSiteOrigin}/projects/${id}`,
        client: "codex",
        publicUrl: `${publicSiteOrigin}/projects/${id}/${publicationPrefix}codex.md`,
        skillName: name,
        skillRepositoryPath,
        source: codexGuide,
      }),
      claude: guideRecord({
        artifactOrigin: `${publicSiteOrigin}/projects/${id}`,
        client: "claude-code",
        publicUrl: `${publicSiteOrigin}/projects/${id}/${publicationPrefix}claude.md`,
        skillName: name,
        skillRepositoryPath,
        source: claudeGuide,
      }),
      manual: guideRecord({
        artifactOrigin: `${publicSiteOrigin}/projects/${id}`,
        client: "manual",
        publicUrl: `${publicSiteOrigin}/projects/${id}/${publicationPrefix}manual.md`,
        skillName: name,
        skillRepositoryPath,
        source: manualGuide,
      }),
    },
    authority: {
      apiOrigin: "https://api.github.com",
      rawOrigin: "https://raw.githubusercontent.com",
      canonicalPath: skillRepositoryPath,
      releaseCandidateLabel: "slop-release-candidate",
      acceptedRevisions: manifest.authority.acceptedRevisions,
    },
    provenance: {
      status: "self-reported",
      policy:
        "Every provider, exact model identifier, and agent client may participate. Exact provider, model, client, and skill revision disclosure is required, self-reported, and never changes score.",
    },
    telemetry: {
      source: "ccusage@20.0.20",
      policy:
        "Every agent run permanently uploads its contributor-inspected, minimized run trace under https://slop.cash/protocol/private-trace-v1.md before submission; the uploader performs no automatic redaction. Public receipts contain only aggregate locally reported usage, exact self-reported identity, the required trace digest and upload identity, and a device signature. The fixed private-trace evidence bonus follows https://slop.cash/protocol/scoring-v2.md; token usage is diagnostic and never changes score, rank, reward share, or payment. Unsupported usage adapters never block participation.",
    },
    ...(publicationPrefix
      ? {
          review: {
            policy:
              "Advisory review only. The reviewer must post exact provider, model, and client identity plus finalized private-trace evidence. Maintainers decide acceptance, score, and every money-state transition.",
          },
        }
      : {}),
  };
  writeFileSync(
    join(projectRoot, `${publicationPrefix}skill-manifest.json`),
    `${JSON.stringify(additionalManifest, null, 2)}\n`,
  );
  console.log(
    `[Slop] prepared ${archiveName} (${archiveDigest.slice(0, 12)}) from ${commit.slice(0, 12)}`,
  );
}

publishPrimaryProjectAlias();
for (const project of PROJECTS) {
  if (!project.skill.publishAtRoot) {
    publishAdditionalProject({
      id: project.id,
      name: project.skill.id,
      skillRepositoryPath: project.skill.sourcePath,
    });
  }
  publishAdditionalProject({
    id: project.id,
    name: project.reviewSkill.id,
    publicationPrefix: "review-",
    skillRepositoryPath: project.reviewSkill.sourcePath,
  });
  const projectRoot = join(publicRoot, "projects", project.id);
  mkdirSync(projectRoot, { recursive: true });
  writeFileSync(
    join(projectRoot, "terms.json"),
    `${JSON.stringify(
      {
        schemaVersion: "1",
        projectId: project.id,
        status: "active",
        steward: project.steward,
        authority: project.authority,
        terms: project.terms,
      },
      null,
      2,
    )}\n`,
  );
}
run("bun", [join(repositoryRoot, "scripts", "sync-cycle-index.ts")]);
run("bun", [join(repositoryRoot, "scripts", "sync-funding-index.ts")]);

console.log(
  `[Slop] prepared ${archiveName} (${archiveDigest.slice(0, 12)}) from ${commit.slice(0, 12)}`,
);
