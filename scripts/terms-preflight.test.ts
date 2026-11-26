import { afterAll, beforeAll, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  handleProjectArtifactRequest,
  type SkillPublicationDependencies,
} from "../backend/projects/skill-publication";
import type { ProjectRecord } from "../src/lib/project-contracts";
import type { ProjectDefinition } from "../src/lib/projects.mjs";
import { applicationManifest } from "../tests/project-application-manifest";

type TermsPreflight = {
  preflight(
    projectId: string,
    options?: { testAuthority?: string },
  ): Promise<Record<string, unknown>>;
};

// The shared skill script has no declaration file; type only what this test uses.
const { preflight }: TermsPreflight = await import(
  new URL(
    "../skills/project-contributor-template/scripts/terms-preflight.mjs",
    import.meta.url,
  ).href
);

const PROJECT_ID = "open-registry";
let authority = "";

beforeAll(() => {
  authority = mkdtempSync(join(tmpdir(), "slop-terms-preflight-"));
});
afterAll(() => {
  rmSync(authority, { recursive: true, force: true });
});

/** The terms.json body slop.cash serves for an approved project. */
async function servedTerms(): Promise<Record<string, unknown>> {
  const manifest = applicationManifest(
    PROJECT_ID,
    "example/open-registry",
  ) as unknown as ProjectDefinition;
  const record: ProjectRecord = {
    id: PROJECT_ID,
    status: manifest.status,
    revision: 1,
    manifest,
    manifestSha256: "0".repeat(64),
    createdAt: "2026-10-18T00:00:00.000Z",
    updatedAt: "2026-10-18T00:00:00.000Z",
    sourceApplicationId: null,
    referrer: null,
  };
  const unused = async (): Promise<never> => {
    throw new Error("terms.json does not render skills");
  };
  const dependencies: SkillPublicationDependencies = {
    getProject: async (id) => (id === PROJECT_ID ? record : null),
    listProjects: async () => [record],
    listEnforcements: async () => [],
    loadTemplate: unused,
    vettingClearance: unused,
  };
  const response = await handleProjectArtifactRequest(
    new Request(`https://slop.cash/projects/${PROJECT_ID}/terms.json`),
    dependencies,
  );
  expect(response?.status).toBe(200);
  return (await response?.json()) as Record<string, unknown>;
}

function acknowledge(policy: Record<string, unknown>) {
  const directory = join(authority, "projects", PROJECT_ID);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "terms.json"), JSON.stringify(policy));
  return preflight(PROJECT_ID, {
    testAuthority: pathToFileURL(authority).href,
  });
}

test("acknowledges the terms.json slop.cash serves for a project without a bounty program", async () => {
  const policy = await servedTerms();
  expect(policy.securityBounty).toBeNull();
  expect(await acknowledge(policy)).toMatchObject({
    policyRevision: "draft-1",
    licenseSha256: null,
    inboundTermsSha256: null,
    prizeRulesSha256: null,
  });
});

test("a verified immutable cache remains usable when closing its read handle reports an error", async () => {
  const policy = await servedTerms();
  const document = Buffer.from("Synthetic immutable license document.\n");
  const sha = (value: string | Buffer) =>
    createHash("sha256").update(value).digest("hex");
  const expected = sha(document);
  const source = `https://raw.githubusercontent.com/example/project/${"a".repeat(40)}/LICENSE`;
  const terms = policy.terms as Record<string, unknown>;
  policy.terms = {
    ...terms,
    repositoryLicense: {
      ...(terms.repositoryLicense as Record<string, unknown>),
      state: "verified",
      url: source,
      fileSha256: expected,
    },
  };
  const cacheHome = join(authority, "cache-close");
  const cache = join(cacheHome, "slop", "policy-documents-v1");
  mkdirSync(cache, { recursive: true });
  writeFileSync(join(cache, `${sha(`${source}\0${expected}`)}.bin`), document);
  const moduleUrl = new URL(
    "../skills/project-contributor-template/scripts/terms-preflight.mjs",
    import.meta.url,
  ).href;
  const probe = `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const [url, policyJson, projectId] = process.argv.slice(1);
    const nativeOpen = fs.open;
    let closed = 0;
    fs.open = async (...args) => {
      const handle = await nativeOpen(...args);
      return {
        stat: () => handle.stat(),
        readFile: () => handle.readFile(),
        close: async () => {
          await handle.close();
          closed++;
          throw new Error('synthetic cache-close failure');
        },
      };
    };
    syncBuiltinESMExports();
    const reads = [];
    globalThis.fetch = async (input) => {
      reads.push(String(input));
      if (String(input) !== 'https://slop.cash/projects/' + projectId + '/terms.json')
        throw new Error('verified cache unexpectedly required a document download');
      return new Response(policyJson, { status: 200 });
    };
    const { preflight } = await import(url);
    const result = await preflight(projectId);
    process.stdout.write(JSON.stringify({ result, reads, closed }));
  `;
  const result = spawnSync(
    "node",
    [
      "--input-type=module",
      "--eval",
      probe,
      moduleUrl,
      JSON.stringify(policy),
      PROJECT_ID,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, XDG_CACHE_HOME: cacheHome },
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    result: { licenseSha256: expected },
    reads: [`https://slop.cash/projects/${PROJECT_ID}/terms.json`],
    closed: 1,
  });
});

test("the terms CLI verifies a paused project's documents without announcing work admission", async () => {
  const policy = { ...(await servedTerms()), status: "paused" };
  const script = fileURLToPath(
    new URL(
      "../skills/project-contributor-template/scripts/terms-preflight.mjs",
      import.meta.url,
    ),
  );
  const probe = `
    import { pathToFileURL } from 'node:url';
    const [script, policyJson, projectId] = process.argv.slice(1);
    globalThis.fetch = async () => new Response(policyJson, { status: 200 });
    process.argv = [process.execPath, script, '--project', projectId];
    await import(pathToFileURL(script).href);
  `;
  const result = spawnSync(
    "node",
    [
      "--input-type=module",
      "--eval",
      probe,
      script,
      JSON.stringify(policy),
      PROJECT_ID,
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("Project policy documents verified:");
  expect(result.stdout).not.toContain("contributions open");
});
