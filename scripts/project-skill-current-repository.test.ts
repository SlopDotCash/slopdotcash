// A recorded rename keeps the original path as repository.id and publishes the
// live GitHub path as githubUrl. Generated skills and the receipt gate must
// work in that live path. The registry id stays the recorded repository so a
// run stored under the original name still matches closure.
import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SKILL_AUTHORITY_PYTHON } from "../skills/project-contributor-template/scripts/skill-authority.mjs";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { renderProjectSkill } from "../src/lib/project-skill.mjs";
import { applicationManifest } from "../tests/project-application-manifest";

const TEMPLATE = new URL(
  "../skills/project-contributor-template/scripts/",
  import.meta.url,
);

const CURRENT = "renamed-org/alpha-next";
const ORIGINAL = "example/alpha";
const DIGEST = "ab".repeat(32);

function renamedManifest(githubUrl = `https://github.com/${CURRENT}`) {
  return assertProjectDefinition(
    applicationManifest("alpha", ORIGINAL, {
      status: "active",
      rewardAsset: {
        network: "ethereum",
        kind: "stablecoin",
        address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        symbol: "USDC",
        chainId: "1",
        cluster: null,
        decimals: 6,
        verifiedAt: "2026-10-18T00:00:00.000Z",
      },
      repositories: [
        {
          id: ORIGINAL,
          aliases: [CURRENT],
          displayName: CURRENT,
          githubUrl,
          description: "Reproducible research tooling for everyone.",
          integrationBranch: "main",
        },
      ],
      links: {
        repository: githubUrl.replace(/\/$/u, ""),
        issues: `https://github.com/${CURRENT}/issues`,
      },
    }),
  );
}

function render(
  manifest: ReturnType<typeof renamedManifest>,
  role: "contributor" | "reviewer",
) {
  return renderProjectSkill({
    role,
    templateFiles: {
      "SKILL.md": `Work in \`{{SLOP_REPOSITORY}}\` on \`{{SLOP_INTEGRATION_BRANCH}}\`.`,
    },
    manifest,
    registry: { revision: 4, manifestSha256: DIGEST },
  });
}

function projectJson(rendered: Record<string, Uint8Array>) {
  return JSON.parse(new TextDecoder().decode(rendered["project.json"])) as {
    repositoryId: string;
    currentRepository?: string;
  };
}

test("a renamed repository skill names the live GitHub path and keeps the registry id", () => {
  const manifest = renamedManifest();
  for (const role of ["contributor", "reviewer"] as const) {
    const rendered = render(manifest, role);
    expect(new TextDecoder().decode(rendered["SKILL.md"])).toBe(
      `Work in \`${CURRENT}\` on \`main\`.`,
    );
    expect(projectJson(rendered)).toMatchObject({
      repositoryId: ORIGINAL,
      currentRepository: CURRENT,
    });
  }
});

test("an unrenamed repository skill does not add a second repository name", () => {
  const manifest = assertProjectDefinition(
    applicationManifest("alpha", ORIGINAL, {
      status: "active",
      rewardAsset: {
        network: "ethereum",
        kind: "stablecoin",
        address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        symbol: "USDC",
        chainId: "1",
        cluster: null,
        decimals: 6,
        verifiedAt: "2026-10-18T00:00:00.000Z",
      },
    }),
  );
  const rendered = render(manifest, "contributor");
  expect(new TextDecoder().decode(rendered["SKILL.md"])).toBe(
    `Work in \`${ORIGINAL}\` on \`main\`.`,
  );
  expect(projectJson(rendered).currentRepository).toBeUndefined();
  expect(projectJson(rendered).repositoryId).toBe(ORIGINAL);
});

test("a githubUrl outside the registered names cannot retarget the skill", () => {
  const manifest = renamedManifest();
  const retargeted = {
    ...manifest,
    repositories: [
      {
        ...manifest.repositories[0],
        githubUrl: "https://github.com/other/repo",
      },
    ],
  };
  expect(() => render(retargeted, "contributor")).toThrow(/githubUrl/u);
});

test("the installer renderer publishes the same renamed skill bytes", () => {
  const manifest = renamedManifest();
  const js = render(manifest, "contributor");
  const root = mkdtempSync(join(tmpdir(), "slop-skill-rename-"));
  try {
    const script = join(root, "render.py");
    writeFileSync(
      script,
      `import hashlib, json, math, os, re, sys, time, urllib.parse, urllib.request
from pathlib import Path, PurePosixPath
${SKILL_AUTHORITY_PYTHON}
skill_repository_path = sys.argv[1]
registry_origin = "https://slop.cash"
manifest = json.loads(sys.argv[2])
binding = json.loads(sys.argv[3])
template = {"SKILL.md": sys.argv[4].encode("utf-8")}
rendered = render_project_skill(sys.argv[5], template, manifest, binding)
sys.stdout.buffer.write(rendered["SKILL.md"])
sys.stdout.buffer.write(b"\\0")
sys.stdout.buffer.write(rendered["project.json"])
`,
    );
    const result = spawnSync(
      "python3",
      [
        script,
        "skills/project-contributor-template",
        JSON.stringify(manifest),
        JSON.stringify({ revision: 4, manifestSha256: DIGEST }),
        "Work in `{{SLOP_REPOSITORY}}` on `{{SLOP_INTEGRATION_BRANCH}}`.",
        "contributor",
      ],
      { encoding: "buffer" },
    );
    expect(result.status, result.stderr.toString()).toBe(0);
    const [skill, project] = result.stdout.toString("utf8").split("\0");
    expect(skill).toBe(new TextDecoder().decode(js["SKILL.md"]));
    expect(project).toBe(new TextDecoder().decode(js["project.json"]));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("receipt and discovery accept the live repository after a rename", async () => {
  const root = mkdtempSync(join(tmpdir(), "slop-skill-receipt-"));
  const saved = {
    GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
    GIT_CONFIG_SYSTEM: process.env.GIT_CONFIG_SYSTEM,
    GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  };
  try {
    mkdirSync(join(root, "scripts"));
    writeFileSync(
      join(root, "project.json"),
      JSON.stringify({
        projectId: "alpha",
        repositoryId: ORIGINAL,
        currentRepository: CURRENT,
      }),
    );
    for (const name of ["run-receipt.mjs", "live-report.mjs"])
      writeFileSync(
        join(root, "scripts", name),
        readFileSync(new URL(name, TEMPLATE)),
      );
    const receipt = await import(
      pathToFileURL(join(root, "scripts", "run-receipt.mjs")).href
    );
    const { readProjectSelectionPolicy } = await import(
      pathToFileURL(join(root, "scripts", "live-report.mjs")).href
    );
    const checkout = join(root, "checkout");
    // This environment rewrites github.com remotes to an authenticated URL.
    // The receipt compares the remote the contributor configured.
    process.env.GIT_CONFIG_GLOBAL = "/dev/null";
    process.env.GIT_CONFIG_SYSTEM = "/dev/null";
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    const gitEnv = { ...process.env };
    spawnSync("git", ["init", "--quiet", checkout], {
      stdio: "ignore",
      env: gitEnv,
    });
    spawnSync(
      "git",
      [
        "-C",
        checkout,
        "remote",
        "add",
        "origin",
        `git@github.com:${CURRENT}.git`,
      ],
      { stdio: "ignore", env: gitEnv },
    );
    expect(receipt.requireRepository(checkout)).toBe(realpathSync(checkout));
    expect(
      receipt.projectPullRequestUrl(`https://github.com/${CURRENT}/pull/7`),
    ).toBe(`https://github.com/${CURRENT}/pull/7`);
    expect(
      receipt.projectPullRequestUrl(`https://github.com/${ORIGINAL}/pull/7`),
    ).toBe(`https://github.com/${ORIGINAL}/pull/7`);
    expect(() =>
      receipt.projectPullRequestUrl("https://github.com/other/repo/pull/7"),
    ).toThrow(/renamed-org\/alpha-next/u);
    expect(() => {
      spawnSync(
        "git",
        [
          "-C",
          checkout,
          "remote",
          "set-url",
          "origin",
          "https://github.com/other/repo.git",
        ],
        { stdio: "ignore", env: gitEnv },
      );
      receipt.requireRepository(checkout);
    }).toThrow(/renamed-org\/alpha-next/u);
    expect(
      readProjectSelectionPolicy(
        pathToFileURL(join(root, "scripts", "live-report.mjs")).href,
      ).repositoryId,
    ).toBe(CURRENT);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(root, { recursive: true, force: true });
  }
});
