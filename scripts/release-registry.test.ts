/**
 * Reproduce the two release jobs with a real migrated registry and public API.
 * Artifact transport is a local file copy; no Worker or chain is deployed.
 */
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { CloudflareProjectPersistence } from "../backend/projects/cloudflare-persistence";
import {
  handleProjectApi,
  type ProjectApiDependencies,
} from "../backend/projects/handler";
import { assertProjectRegistry } from "../src/lib/project-schema.mjs";
import { sqliteD1 } from "../tests/sqlite-d1";

const source = resolve(import.meta.dir, "..");
const registry = "src/lib/project-registry.generated.mjs";
const revisions = "src/lib/project-revisions.generated.json";
const sha256 = (text: string) =>
  createHash("sha256").update(text).digest("hex");

async function run(
  cwd: string,
  args: string[],
  env: Record<string, string> = {},
) {
  const child = Bun.spawn(args, {
    cwd,
    env: { PATH: process.env.PATH ?? "", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

function step(workflow: string, name: string) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  if (start === -1) throw new Error(`Missing release step: ${name}`);
  const end = workflow.indexOf("\n      - name:", start + 1);
  return workflow.slice(start, end === -1 ? undefined : end);
}
function shell(workflow: string, name: string) {
  const body = step(workflow, name).split("        run: |\n")[1];
  if (!body) throw new Error(`Missing release command: ${name}`);
  return body
    .split("\n")
    .map((line) => line.slice(10))
    .join("\n");
}

test("release carries the checked D1 registry and history into canonical attester setup", async () => {
  const root = await mkdtemp(join(tmpdir(), "slop-release-registry-"));
  const prepare = join(root, "prepare");
  const deploy = join(root, "deploy");
  const database = sqliteD1(
    (await readdir(join(source, "migrations")))
      .filter((name) => name.endsWith(".sql"))
      .sort(),
  );
  // A paused project may hold funded obligations. These are schema-valid
  // controlled pins, not a claim of finalized chain evidence.
  const base = JSON.parse(
    await readFile(join(source, "tests/fixtures/projects/eliza.json"), "utf8"),
  );
  base.status = "paused";
  base.reward.chain = "base";
  base.reward.feeBasisPoints = 200;
  base.escrow = {
    schemaVersion: "1",
    effectiveCycle: "2026-11",
    chain: "base",
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [],
  };
  const deployment = {
    network: "base-mainnet",
    vault: `0x${"1".repeat(40)}`,
    asset: `0x${"2".repeat(40)}`,
    owner: `0x${"3".repeat(40)}`,
    identityAuthority: `0x${"4".repeat(40)}`,
    feeRecipient: `0x${"5".repeat(40)}`,
    registrar: `0x${"6".repeat(40)}`,
    factory: `0x${"7".repeat(40)}`,
    factoryCodeSha256: "a".repeat(64),
    codeSha256: "b".repeat(64),
    sourceCommit: "c".repeat(40),
    deploymentTransaction: `0x${"d".repeat(64)}`,
    bindingDelaySeconds: "0",
    rotationDelaySeconds: null,
    programId: null,
    projectPda: null,
    networkDomain: null,
    upgradeAuthority: null,
  };
  const [initial] = assertProjectRegistry([base]);
  const [registered] = assertProjectRegistry([
    { ...base, escrow: { ...base.escrow, deployments: [deployment] } },
  ]);
  for (const [index, manifest] of [initial, registered].entries()) {
    if (!manifest) throw new Error("Missing fixture project");
    const text = JSON.stringify(manifest);
    const digest = sha256(text);
    const at = `2026-10-25T10:00:0${index}.000Z`;
    database.sqlite
      .prepare(
        "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES(?,?,?,?,?,?,?,?)",
      )
      .run(
        manifest.id,
        index + 1,
        text,
        digest,
        "Controlled registry revision",
        "900000001",
        "fixture-owner",
        at,
      );
    if (index === 0)
      database.sqlite
        .prepare(
          "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        )
        .run(manifest.id, manifest.status, index + 1, text, digest, at, at);
    else
      database.sqlite
        .prepare(
          "UPDATE projects SET revision=?,manifest=?,manifest_sha256=?,status=?,updated_at=? WHERE id=?",
        )
        .run(index + 1, text, digest, manifest.status, at, manifest.id);
  }
  const unsupported = async () => {
    throw new Error("Only public registry reads are allowed in this fixture");
  };
  const dependencies: ProjectApiDependencies = {
    persistence: new CloudflareProjectPersistence(database.db),
    adminGithubIds: new Set(),
    moderatorGithubIds: new Set(),
    now: () => new Date("2026-10-25T10:00:02.000Z"),
    randomId: () => {
      throw new Error("No writes are allowed in this fixture");
    },
    sessionActor: async () => null,
    readTokenMetadata: unsupported,
    github: { fetch: unsupported },
    vettingClearance: unsupported,
    repositoryControl: unsupported,
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: async (request) =>
      (await handleProjectApi(request, dependencies)) ??
      new Response("Not found", { status: 404 }),
  });
  try {
    for (const folder of [prepare, deploy]) {
      for (const path of [
        "src/lib",
        "scripts/sync-project-registry.mjs",
        "scripts/sha256.mjs",
        "scripts/prepare-payment-deployments.ts",
        "workers/payment-executor/configure.mjs",
        "workers/payment-executor/signer-stacks.mjs",
        "workers/payments/registry-database.mjs",
        "wrangler.toml",
        "package.json",
      ]) {
        await mkdir(dirname(join(folder, path)), { recursive: true });
        await cp(join(source, path), join(folder, path), { recursive: true });
      }
    }
    const sync = await run(
      prepare,
      [process.execPath, "scripts/sync-project-registry.mjs"],
      { SLOP_API_ORIGIN: `http://127.0.0.1:${server.port}` },
    );
    expect(sync).toMatchObject({ code: 0, stderr: "" });
    const workflow = await readFile(
      join(source, ".github/workflows/deploy.yml"),
      "utf8",
    );
    const output = join(root, "outputs");
    const bound = await run(
      prepare,
      [
        "bash",
        "-euo",
        "pipefail",
        "-c",
        shell(workflow, "Bind the checked registry snapshot"),
      ],
      { GITHUB_OUTPUT: output },
    );
    expect(bound.code, bound.stderr).toBe(0);
    const outputs = Object.fromEntries(
      (await readFile(output, "utf8"))
        .trim()
        .split("\n")
        .map((line) => line.split("=")),
    );
    const env = {
      REGISTRY_SHA256: outputs.registry_sha256,
      REVISIONS_SHA256: outputs.revisions_sha256,
    };
    const verify = () =>
      run(
        deploy,
        [
          "bash",
          "-euo",
          "pipefail",
          "-c",
          shell(workflow, "Verify downloaded registry snapshot"),
        ],
        env,
      );
    const snippet = workflow.match(
      /attester_vaults="\$\(ATTESTER_PINS="\$attester_dir\/pinned.json" bun --eval '\n([\s\S]*?)\n {10}'\)"/,
    );
    if (!snippet?.[1]) throw new Error("Missing attester derivation");
    const derive = (cwd: string) =>
      run(
        cwd,
        [
          process.execPath,
          "--eval",
          snippet[1]
            ?.split("\n")
            .map((line) => line.slice(10))
            .join("\n") ?? "",
        ],
        { ATTESTER_PINS: join(cwd, "pins.json") },
      );
    expect((await derive(prepare)).stdout).toBe("1");
    expect((await derive(deploy)).stdout).toBe("0");
    expect((await verify()).code).not.toBe(0);
    const freshPins = join(prepare, "pins.json");
    const configure = () =>
      run(deploy, [
        "node",
        "workers/payment-executor/configure.mjs",
        "--stack",
        "production",
        "--network",
        "base-mainnet",
        "--deployments",
        freshPins,
        "--output",
        join(deploy, "config"),
      ]);
    const stale = await configure();
    expect(stale.code).not.toBe(0);
    expect(stale.stderr).toContain(
      "Deployment differs from canonical project manifest",
    );

    // Use the exact upload list and download directory of the real workflow.
    const upload = step(workflow, "Upload checked registry snapshot");
    const download = step(workflow, "Download checked registry snapshot");
    const files = upload
      .split("          path: |\n")[1]
      ?.split("\n")
      .filter((line) => line.startsWith("            "))
      .map((line) => line.trim());
    expect(files).toEqual([registry, revisions]);
    const target = download.match(/ {10}path: (.+)/)?.[1];
    expect(target).toBe("src/lib");
    const transfer = async () => {
      for (const file of files ?? [])
        await cp(
          join(prepare, file),
          join(deploy, target ?? "", file.split("/").at(-1) ?? ""),
        );
    };
    await transfer();
    const restored = await verify();
    expect(restored.code, restored.stderr).toBe(0);
    expect((await derive(deploy)).stdout).toBe("1");
    const configured = await configure();
    expect(configured.code, configured.stderr).toBe(0);
    const config = JSON.parse(
      await readFile(
        join(deploy, "config/slop-payments-base-mainnet-attester.json"),
        "utf8",
      ),
    );
    expect(JSON.parse(config.vars.PAYMENT_DEPLOYMENTS)).toEqual(
      JSON.parse(await readFile(freshPins, "utf8")),
    );
    expect(await readFile(join(deploy, revisions), "utf8")).toBe(
      await readFile(join(prepare, revisions), "utf8"),
    );
    expect(
      JSON.parse(await readFile(join(deploy, revisions), "utf8")),
    ).toHaveLength(2);

    // A valid but stale history and a modified module both stop before import.
    await writeFile(join(deploy, revisions), "[]\n");
    expect((await verify()).code).not.toBe(0);
    await transfer();
    await writeFile(
      join(deploy, registry),
      `throw new Error("UNVERIFIED_MODULE_EXECUTED");\n`,
    );
    const tampered = await verify();
    expect(tampered.code).not.toBe(0);
    expect(tampered.stderr).not.toContain("UNVERIFIED_MODULE_EXECUTED");
    await transfer();
    await rm(join(deploy, revisions));
    expect((await verify()).code).not.toBe(0);
  } finally {
    server.stop(true);
    database.sqlite.close();
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
