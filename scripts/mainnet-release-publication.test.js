import { expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assembleMainnetBindings,
  mainnetWranglerProvider,
  prepareMainnetRelease,
  publishMainnetRelease,
} from "../workers/payment-executor/release-mainnets.mjs";

const sha = "a".repeat(40);
const account = "b".repeat(32);
const name = "slop-payments-base-mainnet-attester";

test("supersession is a clean no-op only before service publication", async () => {
  const root = await mkdtemp(join(tmpdir(), "slop-release-supersession-"));
  const workspace = join(root, "workspace");
  const remote = join(root, "remote.git");
  const command = (args) => {
    const result = spawnSync("git", args, { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  try {
    command(["init", "--bare", remote]);
    command(["init", "-b", "main", workspace]);
    const commit = () => {
      command(["-C", workspace, "add", "."]);
      command([
        "-C",
        workspace,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.test",
        "commit",
        "-m",
        "Fixture release",
      ]);
      return command(["-C", workspace, "rev-parse", "HEAD"]);
    };
    await writeFile(join(workspace, "release.txt"), "tested\n");
    const tested = commit();
    await writeFile(join(workspace, "release.txt"), "newer main\n");
    commit();
    command(["-C", workspace, "remote", "add", "origin", remote]);
    command(["-C", workspace, "push", "origin", "main"]);
    command(["-C", workspace, "checkout", "--detach", tested]);
    // Git transport and tree comparison are real. Only GitHub's ancestry
    // response is controlled; the fixture above is an actual fast-forward.
    await writeFile(join(root, "gh"), "#!/bin/sh\nprintf '%s\\n' ahead\n", {
      mode: 0o755,
    });
    const workflow = Bun.YAML.parse(
      await readFile(
        new URL("../.github/workflows/deploy.yml", import.meta.url),
        "utf8",
      ),
    );
    const steps = Object.values(workflow.jobs).flatMap(
      (job) => job.steps ?? [],
    );
    const early = steps.find(
      (step) => step.name === "Require live release-input equivalence",
    ).run;
    const publish = steps.find(
      (step) => step.name === "Deploy private identity and Cloudflare Pages",
    ).run;
    const firstGuardEnd = publish.indexOf("\n# Prepare every enabled attester");
    const servicePublication = publish.indexOf(
      'bun workers/payment-executor/release-mainnets.mjs publish "$attester_dir"',
    );
    const lateGuardStart = publish.indexOf('live_main="$(', servicePublication);
    const lateGuardEnd = publish.indexOf(
      "\n# Use the same immutable-source publication directory",
      lateGuardStart,
    );
    const pagesPublication = publish.indexOf(
      "./node_modules/.bin/wrangler pages deploy",
      lateGuardEnd,
    );
    expect(firstGuardEnd).toBeGreaterThan(0);
    expect(
      publish.indexOf(
        "bun scripts/verify-identity-schedules.mjs --restore-missing",
      ),
    ).toBeGreaterThan(firstGuardEnd);
    expect(servicePublication).toBeGreaterThan(firstGuardEnd);
    expect(lateGuardStart).toBeGreaterThan(servicePublication);
    expect(lateGuardEnd).toBeGreaterThan(lateGuardStart);
    expect(pagesPublication).toBeGreaterThan(lateGuardEnd);
    for (const [guard, servicesPublished] of [
      [early, false],
      [publish.slice(0, firstGuardEnd), false],
      [publish.slice(lateGuardStart, lateGuardEnd), true],
    ]) {
      const output = join(root, "output");
      const summary = join(root, "summary");
      const writes = join(root, "writes");
      await Promise.all(
        [output, summary, writes].map((path) => writeFile(path, "")),
      );
      const result = spawnSync(
        "bash",
        [
          "-e",
          "-c",
          [
            "set -euo pipefail",
            servicesPublished
              ? 'printf "service\\n" >> "$PUBLICATION_PROOF"'
              : "",
            guard,
            'printf "pages\\n" >> "$PUBLICATION_PROOF"',
          ].join("\n"),
        ],
        {
          encoding: "utf8",
          env: {
            PATH: `${root}:${process.env.PATH}`,
            GITHUB_WORKSPACE: workspace,
            GITHUB_REPOSITORY: "SlopDotCash/slopdotcash",
            GITHUB_SHA: tested,
            GITHUB_OUTPUT: output,
            GITHUB_STEP_SUMMARY: summary,
            PUBLICATION_PROOF: writes,
            GIT_CONFIG_COUNT: "1",
            GIT_CONFIG_KEY_0: `url.${remote}.insteadOf`,
            GIT_CONFIG_VALUE_0:
              "https://github.com/SlopDotCash/slopdotcash.git",
          },
        },
      );
      expect(result.status, result.stderr).toBe(servicesPublished ? 1 : 0);
      expect(await readFile(writes, "utf8")).toBe(
        servicesPublished ? "service\n" : "",
      );
      expect(await readFile(output, "utf8")).toBe(
        servicesPublished ? "" : "superseded=true\n",
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the real Wrangler inventory command returns JSON through the release provider", async () => {
  const directory = await mkdtemp(join(tmpdir(), "slop-wrangler-inventory-"));
  // Separate process: the synchronous CLI caller cannot service HTTP itself.
  const server = spawn(
    "node",
    [
      "-e",
      `
    const http=require('node:http');
    const server=http.createServer((req,res)=>{
      if(req.method!=='GET'||req.url!=='/accounts/${account}/workers/scripts/fixture-attester/secrets') {
        res.writeHead(404);res.end();return;
      }
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({success:true,errors:[],messages:[],result:[{name:'FIXTURE_KEY',type:'secret_text'}]}));
    });
    server.listen(0,'127.0.0.1',()=>console.log(server.address().port));
  `,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Fixture startup timeout")),
        10000,
      );
      server.once("error", reject);
      server.stdout.once("data", (data) => {
        clearTimeout(timer);
        resolve(Number(String(data).trim()));
      });
    });
    const path = join(directory, "wrangler.json");
    await writeFile(
      path,
      JSON.stringify({
        name: "fixture-attester",
        account_id: account,
        compatibility_date: "2026-07-30",
        send_metrics: false,
      }),
    );
    const result = mainnetWranglerProvider(
      ["secret", "list", "--config", path],
      {
        PATH: process.env.PATH,
        HOME: directory,
        CI: "true",
        CLOUDFLARE_ACCOUNT_ID: account,
        CLOUDFLARE_API_TOKEN: "fixture-only",
        CLOUDFLARE_API_BASE_URL: `http://127.0.0.1:${port}`,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_WRITE_LOGS: "false",
      },
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      { name: "FIXTURE_KEY", type: "secret_text" },
    ]);
  } finally {
    server.kill();
    await rm(directory, { recursive: true, force: true });
  }
}, 40000);
const ok = (value) => ({
  status: 0,
  stdout: JSON.stringify(value),
  stderr: "",
});

async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "slop-release-plan-"));
  const path = join(directory, "wrangler.jsonc");
  await writeFile(
    path,
    JSON.stringify({
      vars: {},
      services: [
        { binding: "SLOP_IDENTITY", service: "slop-identity" },
        { binding: "MONTHLY_RELEASE_SOLANA", service: "old-disabled-service" },
      ],
    }),
  );
  try {
    await run({ directory, path });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function pinnedProject(network = "base-mainnet") {
  const { fixtureProject } = await import("../tests/fixture-overlay.mjs");
  const project = fixtureProject("eliza");
  const chain = network === "ethereum" ? "ethereum" : "base";
  project.status = "paused";
  project.reward.chain = chain;
  project.reward.feeBasisPoints = 200;
  project.escrow = {
    schemaVersion: "1",
    effectiveCycle: "2026-11",
    chain,
    feeBasisPoints: 200,
    withdrawalFeeBasisPoints: 200,
    feeMode: "deduct-from-gross",
    deployments: [
      {
        network,
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
      },
    ],
  };
  return project;
}

test("absent Base bootstrap gets exact version proof before Pages receives capabilities", async () => {
  await fixture(async ({ directory, path }) => {
    const provider = async (args) => {
      if (args[0] === "deployments" && args[1] === "list")
        return {
          status: 1,
          stdout: "",
          stderr: `A request to the Cloudflare API (/accounts/${account}/workers/scripts/${name}/deployments) failed. [code: 10007]`,
        };
      if (args[0] === "deploy") return ok({});
      if (args[0] === "versions")
        return ok([{ id: "v1", annotations: { "workers/tag": sha } }]);
      if (args[1] === "status")
        return ok({ versions: [{ version_id: "v1", percentage: 100 }] });
      throw new Error("Unexpected provider operation");
    };
    await prepareMainnetRelease({
      directory,
      account,
      sha,
      registry: [],
      provider,
    });
    await expect(
      assembleMainnetBindings({ directory, sha, path }),
    ).rejects.toThrow("not verified");
    await publishMainnetRelease({ directory, sha, provider });
    await assembleMainnetBindings({ directory, sha, path });
    const pages = JSON.parse(await readFile(path, "utf8"));
    expect(JSON.parse(pages.vars.PAYMENT_NETWORKS)).toEqual(["base-mainnet"]);
    expect(pages.services).toEqual([
      { binding: "SLOP_IDENTITY", service: "slop-identity" },
      {
        binding: "BINDING_RECOVERY",
        service: name,
        entrypoint: "BindingRecovery",
      },
      {
        binding: "MONTHLY_RELEASE_BASE",
        service: name,
        entrypoint: "MonthlyReserveRelease",
      },
    ]);
    const config = JSON.parse(
      await readFile(join(directory, `${name}.json`), "utf8"),
    );
    expect(config.triggers.crons).toEqual([]);
    expect(JSON.parse(config.vars.PAYMENT_DEPLOYMENTS)).toEqual([]);
  });
});

test("an existing empty-pin service is untouched and grants no unverified Pages entrypoint", async () => {
  await fixture(async ({ directory, path }) => {
    await prepareMainnetRelease({
      directory,
      account,
      sha,
      registry: [],
      provider: async () => ok([]),
    });
    await publishMainnetRelease({
      directory,
      sha,
      provider: async () => {
        throw new Error("Must not update existing empty-pin service");
      },
    });
    await assembleMainnetBindings({ directory, sha, path });
    expect(JSON.parse(await readFile(path, "utf8")).services).toEqual([
      { binding: "SLOP_IDENTITY", service: "slop-identity" },
    ]);
  });
});

test("pinned Base release requires the exact signer inventory and retains canonical vault pins", async () => {
  const project = await pinnedProject();
  await fixture(async ({ directory }) => {
    for (const names of [
      ["PAYMENT_RPC_URLS"],
      ["PAYMENT_RPC_URLS", "SIGNER_PRIVATE_KEY", "TEST_SIGNER_PRIVATE_KEY"],
    ]) {
      await expect(
        prepareMainnetRelease({
          directory,
          account,
          sha,
          registry: [project],
          provider: async () => ok(names.map((name) => ({ name }))),
        }),
      ).rejects.toThrow("inventory");
    }
    await prepareMainnetRelease({
      directory,
      account,
      sha,
      registry: [project],
      provider: async () =>
        ok([{ name: "SIGNER_PRIVATE_KEY" }, { name: "PAYMENT_RPC_URLS" }]),
    });
    const config = JSON.parse(
      await readFile(join(directory, `${name}.json`), "utf8"),
    );
    expect(JSON.parse(config.vars.PAYMENT_DEPLOYMENTS)[0].vault).toBe(
      project.escrow.deployments[0].vault,
    );
    expect(config.triggers.crons).toEqual(["*/5 * * * *"]);
    await writeFile(join(directory, `${name}.json`), "{}");
    await expect(
      publishMainnetRelease({
        directory,
        sha,
        provider: async () => {
          throw new Error("Changed config must never deploy");
        },
      }),
    ).rejects.toThrow("configuration changed");
  });
});

test("unreadable secret-list JSON is retried before a pinned attester can be prepared", async () => {
  const project = await pinnedProject();
  await fixture(async ({ directory }) => {
    let reads = 0;
    const plan = await prepareMainnetRelease({
      directory,
      account,
      sha,
      registry: [project],
      provider: async (args) => {
        expect(args.slice(0, 2)).toEqual(["secret", "list"]);
        reads++;
        if (reads <= 2)
          return { status: 0, stdout: reads === 1 ? "" : "[", stderr: "" };
        return ok([
          { name: "SIGNER_PRIVATE_KEY" },
          { name: "PAYMENT_RPC_URLS" },
        ]);
      },
    });
    expect(reads).toBe(3);
    expect(plan.services[0].published).toBe(false);
    expect(plan.services[0].release).toBe(true);
  });
});

test("persistent unreadable secret-list output fails without a publication plan", async () => {
  const project = await pinnedProject();
  await fixture(async ({ directory }) => {
    let reads = 0;
    await expect(
      prepareMainnetRelease({
        directory,
        account,
        sha,
        registry: [project],
        provider: async (args) => {
          expect(args.slice(0, 2)).toEqual(["secret", "list"]);
          reads++;
          return { status: 0, stdout: "[", stderr: "" };
        },
      }),
    ).rejects.toThrow(
      "secret inventory did not return valid JSON after 3 reads",
    );
    expect(reads).toBe(3);
    await expect(
      readFile(join(directory, "plan.json"), "utf8"),
    ).rejects.toThrow();
  });
});

test("reviewed stop republishes an existing disabled-network attester without exposing its Pages entrypoints", async () => {
  const stoppedName = "slop-payments-ethereum-attester";
  const project = await pinnedProject("ethereum");
  await fixture(async ({ directory, path }) => {
    const requests = [];
    const provider = async (args) => {
      requests.push(args);
      if (args[0] === "deployments" && args[1] === "list") return ok([]);
      if (args[0] === "deploy") return ok({});
      if (args[0] === "versions")
        return ok([
          { id: "stopped-version", annotations: { "workers/tag": sha } },
        ]);
      if (args[1] === "status")
        return ok({
          versions: [{ version_id: "stopped-version", percentage: 100 }],
        });
      throw new Error("Unexpected operation while stopping a service");
    };
    const plan = await prepareMainnetRelease({
      directory,
      account,
      sha,
      registry: [project],
      provider,
    });
    expect(
      plan.services.map((entry) => [entry.network, entry.enabled]),
    ).toEqual([
      ["base-mainnet", true],
      ["ethereum", false],
    ]);
    await publishMainnetRelease({ directory, sha, provider });
    const deploys = requests.filter((args) => args[0] === "deploy");
    expect(deploys).toEqual([
      [
        "deploy",
        "--config",
        join(directory, `${stoppedName}.json`),
        `--tag=${sha}`,
        `--message=slop.cash release ${sha}`,
      ],
    ]);
    const stopped = JSON.parse(
      await readFile(join(directory, `${stoppedName}.json`), "utf8"),
    );
    expect(stopped.triggers.crons).toEqual([]);
    expect(JSON.parse(stopped.vars.PAYMENT_DEPLOYMENTS)[0].vault).toBe(
      project.escrow.deployments[0].vault,
    );
    expect(stopped.durable_objects.bindings[0].class_name).toBe(
      "PaymentSignerJournal",
    );
    await assembleMainnetBindings({ directory, sha, path });
    const pages = JSON.parse(await readFile(path, "utf8"));
    expect(JSON.parse(pages.vars.PAYMENT_NETWORKS)).toEqual(["base-mainnet"]);
    expect(pages.services).toEqual([
      { binding: "SLOP_IDENTITY", service: "slop-identity" },
    ]);
  });
});

test("a disabled-network vault does not bootstrap a missing attester or hide lookup errors", async () => {
  const project = await pinnedProject("ethereum");
  await fixture(async ({ directory, path }) => {
    const provider = async (args) => {
      if (args[0] !== "deployments" || args[1] !== "list")
        throw new Error("Disabled network must not deploy");
      if (args[3] === name) return ok([]);
      return {
        status: 1,
        stdout: "",
        stderr: `A request to the Cloudflare API (/accounts/${account}/workers/scripts/slop-payments-ethereum-attester/deployments) failed. [code: 10007]`,
      };
    };
    const plan = await prepareMainnetRelease({
      directory,
      account,
      sha,
      registry: [project],
      provider,
    });
    expect(plan.services.every((entry) => !entry.release)).toBe(true);
    await publishMainnetRelease({ directory, sha, provider });
    await assembleMainnetBindings({ directory, sha, path });
    expect(JSON.parse(await readFile(path, "utf8")).services).toEqual([
      { binding: "SLOP_IDENTITY", service: "slop-identity" },
    ]);
    await expect(
      prepareMainnetRelease({
        directory,
        account,
        sha,
        registry: [project],
        provider: async (args) =>
          args[3] === name
            ? ok([])
            : { status: 1, stdout: "", stderr: "Unauthorized" },
      }),
    ).rejects.toThrow("Cannot prove ethereum attester absent");
  });
});
