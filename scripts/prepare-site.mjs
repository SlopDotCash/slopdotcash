/**
 * Builds the public contribution-skill artifacts from their canonical source.
 * The site never carries a hand-maintained skill copy: every raw endpoint,
 * archive, checksum, and manifest is regenerated before development or build.
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GENERATED_SKILL_TEMPLATES } from "../src/lib/install-command.ts";
import * as registrySnapshot from "../src/lib/project-registry.generated.mjs";
import { PROJECT_SKILL_TEMPLATES } from "../src/lib/project-schema.mjs";
import {
  ACCEPTED_SKILL_REVISIONS,
  GUIDE_RENDERER_PATHS,
} from "../src/lib/project-skill-publication.mjs";
import { readIdentityRecord } from "./protocol-identity.mjs";
import { sha256Hex as sha256 } from "./sha256.mjs";
import { pythonCommand } from "./skill-python.mjs";
import { skillSourceMatchesCommit } from "./skill-source-matches-commit.mjs";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = packageRoot;
const publicRoot = join(packageRoot, "public");
const downloadsRoot = join(publicRoot, "downloads");
const protocolRoot = join(repositoryRoot, "protocol");
const publicProtocolRoot = join(publicRoot, "protocol");
const bootstrapSkillRoot = join(repositoryRoot, "skills", "slop");
const bootstrapSkillSource = join(bootstrapSkillRoot, "SKILL.md");
const skillValidator = join(
  repositoryRoot,
  "scripts",
  "skill-validation",
  "quick_validate.py",
);
const publicSiteOrigin = "https://slop.cash";
const sourceRepository = "SlopDotCash/slopdotcash";

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

const python = pythonCommand(repositoryRoot);

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
// Project endpoints are Function responses now; a reused checkout must not
// keep serving files a build published before the D1 registry.
rmSync(join(publicRoot, "projects"), { force: true, recursive: true });
// Retire the deployment-bound intake timer from existing build directories.
rmSync(join(publicRoot, "data", "private-intake-attestation.json"), {
  force: true,
});
// PRD section 9: when the live registry read fails, pages show the last
// good registry with a stale label. That is the snapshot projects:sync read
// from D1 for this build. A snapshot no sync wrote is not published, so a
// build without one shows the outage instead of an old or empty list.
const publishedRegistryPath = join(publicRoot, "data", "project-registry.json");
rmSync(publishedRegistryPath, { force: true });
if (
  typeof registrySnapshot.PROJECT_REGISTRY_SYNCED_AT === "string" &&
  registrySnapshot.RAW_PROJECT_DEFINITIONS.length > 0
) {
  mkdirSync(dirname(publishedRegistryPath), { recursive: true });
  writeFileSync(
    publishedRegistryPath,
    `${JSON.stringify({
      schemaVersion: "1",
      syncedAt: registrySnapshot.PROJECT_REGISTRY_SYNCED_AT,
      projects: registrySnapshot.RAW_PROJECT_DEFINITIONS,
    })}\n`,
  );
}
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
copyFileSync(
  join(protocolRoot, "points-v1.md"),
  join(publicProtocolRoot, "points-v1.md"),
);
const identityRecordPath = join(protocolRoot, "identity-v1.json");
if (existsSync(identityRecordPath)) {
  readIdentityRecord(identityRecordPath);
  copyFileSync(
    identityRecordPath,
    join(publicProtocolRoot, "identity-v1.json"),
  );
}
runPython([skillValidator, bootstrapSkillRoot]);

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
// Project skills are rendered per request from the D1 manifest revision and
// this one reviewed template pair, so no per-project file is built here. The
// project discovery index and terms are Pages Function responses too.
rmSync(join(publicRoot, ".well-known", "slop"), {
  force: true,
  recursive: true,
});
for (const name of [
  "mission.md",
  "codex.md",
  "claude.md",
  "claude-code.md",
  "manual.md",
])
  rmSync(join(publicRoot, name), { force: true });
rmSync(downloadsRoot, { force: true, recursive: true });
writeFileSync(
  join(publicRoot, "skill-manifest.json"),
  `${JSON.stringify(
    {
      schemaVersion: "1",
      name: null,
      repository: sourceRepository,
      revision: commit,
      revisionStatus: bootstrapRevisionStatus,
      generatedAt: new Date().toISOString(),
    },
    null,
    2,
  )}\n`,
);

// install-command.ts inlines the template paths for the bootstrap renderer
// contract; the build refuses to publish if the two copies ever differ.
if (
  JSON.stringify(GENERATED_SKILL_TEMPLATES) !==
  JSON.stringify(PROJECT_SKILL_TEMPLATES)
)
  throw new TypeError("[Slop] generated skill template paths have drifted");

/** True when the published guide renderer is the committed source. */
const rendererMatchesCommit = GUIDE_RENDERER_PATHS.every((path) => {
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

/**
 * Publishes the canonical template trees with their digests and source
 * commit. The skill Function renders each project from these bytes and the
 * project's D1 revision, and refuses any file whose digest differs.
 */
function templateGroup(sourcePath) {
  const tracked = execFileSync("git", ["ls-files", "-z", "--", sourcePath], {
    cwd: repositoryRoot,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean)
    .map((path) => relative(sourcePath, path).replaceAll("\\", "/"))
    .sort();
  const paths = listRegularSkillFiles(join(repositoryRoot, sourcePath)).sort();
  if (
    paths.length === 0 ||
    paths.length > 32 ||
    paths.includes("PROVENANCE.json") ||
    paths.includes("project.json") ||
    paths.length !== tracked.length ||
    paths.some((path, index) => path !== tracked[index])
  )
    throw new TypeError(
      `[Slop] skill template ${sourcePath} must be a bounded, tracked, exact file tree`,
    );
  const target = join(publicRoot, "skill-templates", sourcePath);
  for (const path of paths) {
    mkdirSync(dirname(join(target, path)), { recursive: true });
    copyFileSync(join(repositoryRoot, sourcePath, path), join(target, path));
  }
  return {
    sourcePath,
    committed: skillSourceMatchesCommit(
      repositoryRoot,
      commit,
      sourcePath,
      paths,
    ),
    files: paths.map((path) => ({
      path,
      sha256: sha256(readFileSync(join(repositoryRoot, sourcePath, path))),
    })),
  };
}
rmSync(join(publicRoot, "skill-templates"), { force: true, recursive: true });
const templateGroups = {
  contributor: templateGroup(PROJECT_SKILL_TEMPLATES.contributor),
  reviewer: templateGroup(PROJECT_SKILL_TEMPLATES.reviewer),
};
/**
 * The Functions render every project skill from these sources. With the
 * template trees and the accepted revisions they decide the generated skill
 * bytes, apart from the provenance commit label. A vetting clearance binds
 * their digest, not the site commit, so an unrelated deploy keeps it and
 * staging and production share it (VET-07).
 */
const rendererSources = [
  ...GUIDE_RENDERER_PATHS,
  "src/lib/project-skill-publication.mjs",
  "src/lib/project-skill.mjs",
  "src/lib/project-schema.mjs",
].map((path) => ({
  path,
  sha256: sha256(readFileSync(join(repositoryRoot, path))),
}));
const templateInputs = {
  ...Object.fromEntries(
    Object.entries(templateGroups).map(([key, { sourcePath, files }]) => [
      key,
      { sourcePath, files },
    ]),
  ),
  rendererSources,
  acceptedRevisions: ACCEPTED_SKILL_REVISIONS,
};
writeFileSync(
  join(publicRoot, "skill-templates", "index.json"),
  `${JSON.stringify(
    {
      schemaVersion: "1",
      repository: sourceRepository,
      commit,
      templateSha256: sha256(JSON.stringify(templateInputs)),
      revisionStatus: Object.values(templateGroups).every(
        (group) => group.committed,
      )
        ? "committed"
        : "working-tree",
      contributor: templateInputs.contributor,
      reviewer: templateInputs.reviewer,
      renderer: {
        paths: GUIDE_RENDERER_PATHS,
        sources: rendererSources,
        revisionStatus: rendererMatchesCommit ? "committed" : "working-tree",
      },
      acceptedRevisions: ACCEPTED_SKILL_REVISIONS,
    },
    null,
    2,
  )}\n`,
);

run("bun", [join(repositoryRoot, "scripts", "sync-cycle-index.ts")]);
run("bun", [join(repositoryRoot, "scripts", "generate-sitemap.ts")]);
run("bun", [join(repositoryRoot, "scripts", "sync-contribution-quality.ts")]);

console.log(
  `[Slop] prepared the project skill templates from ${commit.slice(0, 12)}`,
);
