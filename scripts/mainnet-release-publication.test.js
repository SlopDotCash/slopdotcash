import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assembleMainnetBindings,
  prepareMainnetRelease,
  publishMainnetRelease,
} from "../workers/payment-executor/release-mainnets.mjs";

const sha = "a".repeat(40);
const account = "b".repeat(32);
const name = "slop-payments-base-mainnet-attester";
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
