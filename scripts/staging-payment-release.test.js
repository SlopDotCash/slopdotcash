import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stagingPaymentProject } from "../tests/staging-payment-fixture.mjs";
import {
  releaseStagingPayments,
  runStagingWrangler,
  STAGING_MONTHLY_RELEASES,
  stagingBindingNoncePolicy,
  stagingReleasePlan,
} from "../workers/payment-executor/release-staging.mjs";

const sha = "a".repeat(40);
const database = {
  database_name: "slop-staging",
  database_id: "6fcddcc1-f3d7-4175-bdde-09afddd53a8a",
};
const schedule =
  '{"firstPeriod":"2026-11","cutoffSecondsAfterPeriodEnd":259200}';
const ok = (value) => ({
  status: 0,
  stdout: JSON.stringify(value),
  stderr: "",
});
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "slop-staging-attesters-"));
  const path = join(directory, "wrangler.jsonc");
  const pages = {
    name: "slop-staging",
    vars: { SLOP_ENVIRONMENT: "staging", MONTHLY_PAYMENT_SCHEDULE: schedule },
    d1_databases: [{ binding: "SLOP_DB", ...database }],
    services: [
      { binding: "SLOP_IDENTITY", service: "slop-identity-staging" },
      { binding: "MONTHLY_RELEASE_SOLANA", service: "stale" },
    ],
    env: { preview: { services: [] } },
  };
  await writeFile(path, JSON.stringify(pages));
  try {
    await run({ directory, path, pages });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test.each(Object.entries(STAGING_MONTHLY_RELEASES))(
  "%s publishes only its verified named test service",
  async (network, binding) => {
    await fixture(async ({ directory, path, pages }) => {
      const calls = [];
      const provider = async (args) => {
        calls.push(args);
        if (args[0] === "secret")
          return ok([
            { name: "PAYMENT_RPC_URLS" },
            {
              name:
                network === "solana-devnet"
                  ? "TEST_SOLANA_SIGNER_SEED"
                  : "TEST_SIGNER_PRIVATE_KEY",
            },
          ]);
        if (args[0] === "versions")
          return ok([{ id: "v1", annotations: { "workers/tag": sha } }]);
        if (args[0] === "deployments")
          return ok({ versions: [{ version_id: "v1", percentage: 100 }] });
        return ok({});
      };
      const result = await releaseStagingPayments({
        directory,
        path,
        sha,
        registry: [stagingPaymentProject(network)],
        provider,
      });
      const assembled = JSON.parse(await readFile(path, "utf8"));
      expect(assembled.services).toEqual([
        pages.services[0],
        {
          binding,
          service: `slop-payments-${network}-staging-attester`,
          entrypoint: "MonthlyReserveRelease",
        },
      ]);
      expect(assembled.vars).toEqual(pages.vars);
      expect(assembled.env).toEqual(pages.env);
      const config = JSON.parse(
        await readFile(
          join(directory, `${result.services[0].name}.json`),
          "utf8",
        ),
      );
      expect(config.vars.SIGNER_STACK).toBe("test");
      expect(config.vars.SIGNER_ROLE).toBe("attester");
      expect(config.vars.TEST_BINDING_NONCE_LIMIT).toBeUndefined();
      expect(config.vars.MONTHLY_PAYMENT_SCHEDULE).toBe(schedule);
      expect(config.d1_databases.map((d) => d.database_id)).toEqual([
        database.database_id,
        database.database_id,
      ]);
      expect(calls.filter((c) => c[0] === "deploy")).toHaveLength(1);
    });
  },
);

test("all test secret inventories pass before any service deploys", async () => {
  await fixture(async ({ directory, path, pages }) => {
    const calls = [];
    const provider = async (args) => {
      calls.push(args);
      return ok([
        { name: "PAYMENT_RPC_URLS" },
        { name: "TEST_SIGNER_PRIVATE_KEY" },
      ]);
    };
    await expect(
      releaseStagingPayments({
        directory,
        path,
        sha,
        registry: [
          stagingPaymentProject("base-sepolia"),
          stagingPaymentProject("solana-devnet", "slopdotcash"),
        ],
        provider,
      }),
    ).rejects.toThrow("secret inventory");
    expect(calls.every((c) => c[0] === "secret")).toBe(true);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(pages);
  });
});

test("only unreadable secret metadata is retried before publication", async () => {
  await fixture(async ({ directory, path }) => {
    let reads = 0;
    const calls = [];
    await releaseStagingPayments({
      directory,
      path,
      sha,
      registry: [stagingPaymentProject("base-sepolia")],
      provider: async (args) => {
        calls.push(args);
        if (args[0] === "secret") {
          reads++;
          return reads < 3
            ? { status: 0, stdout: reads === 1 ? "" : "[", stderr: "" }
            : ok([
                { name: "PAYMENT_RPC_URLS" },
                { name: "TEST_SIGNER_PRIVATE_KEY" },
              ]);
        }
        if (args[0] === "versions")
          return ok([{ id: "v1", annotations: { "workers/tag": sha } }]);
        if (args[0] === "deployments")
          return ok({ versions: [{ version_id: "v1", percentage: 100 }] });
        return ok({});
      },
    });
    expect(reads).toBe(3);
    expect(calls.slice(0, 3).every((args) => args[0] === "secret")).toBe(true);
    expect(calls.filter((args) => args[0] === "deploy")).toHaveLength(1);
  });
});

test("unreadable or failed secret reads hold the Pages artifact without publication", async () => {
  for (const status of [0, 1]) {
    await fixture(async ({ directory, path, pages }) => {
      let reads = 0;
      await expect(
        releaseStagingPayments({
          directory,
          path,
          sha,
          registry: [stagingPaymentProject("base-sepolia")],
          provider: async (args) => {
            expect(args[0]).toBe("secret");
            reads++;
            return { status, stdout: "", stderr: "" };
          },
        }),
      ).rejects.toThrow(status === 0 ? "after 3 reads" : "secret failed");
      expect(reads).toBe(status === 0 ? 3 : 1);
      expect(JSON.parse(await readFile(path, "utf8"))).toEqual(pages);
    });
  }
});

test("wrong deployed source cannot expose any new Pages binding", async () => {
  await fixture(async ({ directory, path, pages }) => {
    const provider = async (args) =>
      args[0] === "secret"
        ? ok([
            { name: "PAYMENT_RPC_URLS" },
            { name: "TEST_SIGNER_PRIVATE_KEY" },
          ])
        : args[0] === "versions"
          ? ok([{ id: "v1", annotations: { "workers/tag": "b".repeat(40) } }])
          : ok({ versions: [{ version_id: "v1", percentage: 100 }] });
    await expect(
      releaseStagingPayments({
        directory,
        path,
        sha,
        registry: [stagingPaymentProject("base-sepolia")],
        provider,
      }),
    ).rejects.toThrow("released source");
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual(pages);
  });
});

test("unpinned networks get no Worker, secret read or stale release binding", async () => {
  await fixture(async ({ directory, path, pages }) => {
    await releaseStagingPayments({
      directory,
      path,
      sha,
      registry: [],
      provider: async () => {
        throw new Error("Unpinned network contacted provider");
      },
    });
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      ...pages,
      services: [pages.services[0]],
    });
  });
});

test("production Pages or storage cannot receive a staging release", async () => {
  expect(() =>
    stagingReleasePlan({
      registry: [stagingPaymentProject("base-sepolia")],
      registryDatabase: {
        database_name: "slop-private",
        database_id: "1b453124-2709-45af-8389-151a8105c461",
      },
      monthlySchedule: schedule,
    }),
  ).toThrow("slop-staging");
  await fixture(async ({ directory, path }) => {
    await writeFile(
      path,
      JSON.stringify({
        name: "eliza-computer",
        vars: { SLOP_ENVIRONMENT: "production" },
      }),
    );
    await expect(
      releaseStagingPayments({
        directory,
        path,
        sha,
        registry: [],
        provider: async () => {
          throw new Error("Production contacted provider");
        },
      }),
    ).rejects.toThrow("Only the staging");
  });
});

test("mismatched Pages storage or monthly schedule stops before provider access", async () => {
  await fixture(async ({ directory, path, pages }) => {
    for (const changed of [
      {
        ...pages,
        d1_databases: [
          {
            binding: "SLOP_DB",
            database_name: "slop-private",
            database_id: "1b453124-2709-45af-8389-151a8105c461",
          },
        ],
      },
      {
        ...pages,
        vars: {
          ...pages.vars,
          MONTHLY_PAYMENT_SCHEDULE:
            '{"firstPeriod":"2026-09","cutoffSecondsAfterPeriodEnd":259200}',
        },
      },
    ]) {
      await writeFile(path, JSON.stringify(changed));
      await expect(
        releaseStagingPayments({
          directory,
          path,
          sha,
          registry: [stagingPaymentProject("base-sepolia")],
          provider: async () => {
            throw new Error("Mismatched Pages contacted provider");
          },
        }),
      ).rejects.toThrow("storage or schedule differ");
    }
  });
});

test("the installed Node Wrangler supplies real staging secret metadata before publication", async () => {
  await fixture(async ({ directory, path }) => {
    const name = "slop-payments-base-sepolia-staging-attester";
    const account = "b".repeat(32);
    const responsePath = join(directory, "response.json");
    const secrets = [
      { name: "PAYMENT_RPC_URLS", type: "secret_text" },
      { name: "TEST_SIGNER_PRIVATE_KEY", type: "secret_text" },
    ];
    const respond = (result, success = true) =>
      writeFile(
        responsePath,
        JSON.stringify({ success, result, errors: [], messages: [] }),
      );
    await respond(secrets);
    // The synchronous CLI talks only to this exact loopback metadata route.
    // A child server can answer while it waits; no live API or key is used.
    const server = spawn(
      "node",
      [
        "--eval",
        `const http = require("node:http");
         const fs = require("node:fs");
         const expected = ${JSON.stringify(`/client/v4/accounts/${account}/workers/scripts/${name}/secrets`)};
         const server = http.createServer((request, response) => {
           if (request.method !== "GET" || request.url !== expected) {
             response.writeHead(404); response.end(); return;
           }
           response.setHeader("content-type", "application/json");
           response.end(fs.readFileSync(${JSON.stringify(responsePath)}));
         });
         server.listen(0, "127.0.0.1", () => console.log(server.address().port));`,
      ],
      { env: { PATH: process.env.PATH }, stdio: ["ignore", "pipe", "pipe"] },
    );
    try {
      const [ready] = await once(server.stdout, "data");
      const port = Number(String(ready).trim());
      expect(Number.isInteger(port) && port > 0).toBe(true);
      const env = {
        PATH: process.env.PATH,
        XDG_CONFIG_HOME: directory,
        CLOUDFLARE_API_TOKEN: "local-fixture-token",
        CLOUDFLARE_ACCOUNT_ID: account,
        CLOUDFLARE_API_BASE_URL: `http://127.0.0.1:${port}/client/v4`,
        WRANGLER_SEND_METRICS: "false",
        WRANGLER_WRITE_LOGS: "false",
        WRANGLER_LOG_SANITIZE: "true",
      };
      let publications = 0;
      const provider = (args) => {
        if (args[0] === "secret") return runStagingWrangler(args, env);
        if (args[0] === "versions")
          return ok([{ id: "v1", annotations: { "workers/tag": sha } }]);
        if (args[0] === "deployments")
          return ok({ versions: [{ version_id: "v1", percentage: 100 }] });
        publications++;
        return ok({});
      };
      const release = () =>
        releaseStagingPayments({
          directory,
          path,
          sha,
          registry: [stagingPaymentProject("base-sepolia")],
          provider,
        });
      await release();
      expect(publications).toBe(1);
      for (const invalid of [
        secrets.slice(0, 1),
        [...secrets, { name: "EXTRA_KEY", type: "secret_text" }],
      ]) {
        await respond(invalid);
        await expect(release()).rejects.toThrow("secret inventory differs");
      }
      await respond(null, false);
      await expect(release()).rejects.toThrow("secret failed");
      expect(publications).toBe(1);
    } finally {
      const exited = once(server, "exit");
      server.kill();
      await exited;
    }
  });
}, 60_000);

// The normal release opts in explicitly; other staging releases keep their prior behavior.
test("qualification nonce limit reaches only opted-in EVM staging attesters", () => {
  const registry = Object.keys(STAGING_MONTHLY_RELEASES).map((network, index) =>
    stagingPaymentProject(
      network,
      ["eliza", "slopdotcash", "thenetwork", "asi"][index],
    ),
  );
  const ordinary = stagingReleasePlan({
    registry,
    registryDatabase: database,
    monthlySchedule: schedule,
  });
  expect(
    ordinary.every((p) => p.config.vars.TEST_BINDING_NONCE_LIMIT === undefined),
  ).toBe(true);
  const limited = stagingReleasePlan({
    registry,
    registryDatabase: database,
    monthlySchedule: schedule,
    singleNonceBindings: true,
  });
  for (const p of limited)
    expect(p.config.vars.TEST_BINDING_NONCE_LIMIT).toBe(
      p.network === "solana-devnet" ? undefined : "1",
    );
  expect(stagingBindingNoncePolicy(undefined)).toBe(false);
  expect(stagingBindingNoncePolicy("")).toBe(false);
  expect(stagingBindingNoncePolicy("1")).toBe(true);
  expect(() => stagingBindingNoncePolicy("true")).toThrow(
    "Unknown staging binding nonce policy",
  );
});
