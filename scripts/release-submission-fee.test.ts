// The release check of the submission-fee Worker, on the checked-in file.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import {
  SUBMISSION_FEE_SOLANA_SWITCHED_ON,
  SUBMISSION_FEE_SWITCHED_ON,
} from "../src/lib/submission-fee.mjs";
import {
  assertSubmissionFeeRelease,
  endpointSecrets,
} from "./release-submission-fee";

type Config = Parameters<typeof assertSubmissionFeeRelease>[0];
const checkedIn = () =>
  Bun.TOML.parse(
    readFileSync("workers/submission-fee/wrangler.toml", "utf8"),
  ) as Config;
const production = Bun.TOML.parse(readFileSync("wrangler.toml", "utf8")) as {
  d1_databases: Config["d1_databases"];
};
const deployed = {
  contracts: {
    "base-mainnet": `0x${"1".repeat(40)}`,
    "robinhood-mainnet": `0x${"2".repeat(40)}`,
  },
  startBlocks: { "base-mainnet": 10, "robinhood-mainnet": 20 },
};
const unpublished = {
  contracts: { "base-mainnet": null, "robinhood-mainnet": null },
  startBlocks: { "base-mainnet": null, "robinhood-mainnet": null },
};
// The checked-in file with the Solana ledger off, for the checks that concern
// Base and Robinhood Chain alone. The Solana checks below use the file as is.
const solanaOff = () => {
  const config = checkedIn();
  config.vars.SUBMISSION_FEE_SOLANA_MODE = "off";
  return config;
};
const never = () => {
  throw new Error("the secret inventory must not be read");
};

test("the checked-in Worker is live on the private production database with the published contracts, and needs its key", () => {
  // Live since 21 November 2026: the release reads the Worker's secret names
  // and refuses when the resolver key is not among them.
  expect(
    assertSubmissionFeeRelease(checkedIn(), production, () => [
      "SUBMISSION_FEE_RESOLVER_KEY",
      "RPC_URL_SUBMISSION_FEE_BASE",
      "RPC_URL_SUBMISSION_FEE_ROBINHOOD",
      "RPC_URL_SUBMISSION_FEE_SOLANA",
      "SUBMISSION_FEE_SOLANA_RESOLVER_SEED",
    ]),
  ).toBe("live");
  expect(() =>
    assertSubmissionFeeRelease(checkedIn(), production, () => [
      "RPC_URL_SUBMISSION_FEE_SOLANA",
      "SUBMISSION_FEE_SOLANA_RESOLVER_SEED",
    ]),
  ).toThrow("resolver secret inventory is not ready");
  const off = solanaOff();
  off.vars.SUBMISSION_FEE_MODE = "off";
  expect(
    assertSubmissionFeeRelease(off, production, never, undefined, false),
  ).toBe("off");
});

test("dry_run needs no key and no deployed contract", () => {
  const config = solanaOff();
  config.vars.SUBMISSION_FEE_MODE = "dry_run";
  expect(
    assertSubmissionFeeRelease(config, production, never, undefined, false),
  ).toBe("dry_run");
});

test("live is refused until every contract, start block and the key are in place", () => {
  const config = solanaOff();
  config.vars.SUBMISSION_FEE_MODE = "live";
  const key = () => ["SUBMISSION_FEE_RESOLVER_KEY"];
  expect(() =>
    assertSubmissionFeeRelease(config, production, key, unpublished, false),
  ).toThrow("every contract address and start block");
  expect(() =>
    assertSubmissionFeeRelease(
      config,
      production,
      key,
      {
        ...deployed,
        startBlocks: { "base-mainnet": 10, "robinhood-mainnet": null },
      },
      false,
    ),
  ).toThrow("every contract address and start block");
  expect(() =>
    assertSubmissionFeeRelease(config, production, () => [], deployed, false),
  ).toThrow("secret inventory is not ready");
  // A secret the Worker has no use for is refused too.
  expect(() =>
    assertSubmissionFeeRelease(
      config,
      production,
      () => ["SUBMISSION_FEE_RESOLVER_KEY", "FEE_WALLET_KEY_BASE"],
      deployed,
      false,
    ),
  ).toThrow("secret inventory is not ready");
  expect(
    assertSubmissionFeeRelease(
      config,
      production,
      () => ["SUBMISSION_FEE_RESOLVER_KEY", "RPC_URL_SUBMISSION_FEE_BASE"],
      deployed,
      false,
    ),
  ).toBe("live");
});

test("the reviewed tables hold both deployed contracts, so live waits only for the key", () => {
  const config = solanaOff();
  config.vars.SUBMISSION_FEE_MODE = "live";
  expect(() =>
    assertSubmissionFeeRelease(config, production, () => [], undefined, false),
  ).toThrow("secret inventory is not ready");
  expect(
    assertSubmissionFeeRelease(
      config,
      production,
      () => ["SUBMISSION_FEE_RESOLVER_KEY"],
      undefined,
      false,
    ),
  ).toBe("live");
});

test("the settings page says the fee is switched on only while Slopbot asks for it", () => {
  const slopbot = Bun.TOML.parse(
    readFileSync("workers/slopbot/wrangler.toml", "utf8"),
  ) as { vars: { SUBMISSION_FEE_MODE?: string } };
  expect(SUBMISSION_FEE_SWITCHED_ON).toBe(
    slopbot.vars.SUBMISSION_FEE_MODE === "live",
  );
});

test("no release workflow or package script builds the site with the pay page's test seam", () => {
  // `VITE_SLOP_FEE_FIXTURE` lets a browser test supply the pay page's address
  // tables and switch. Only the browser-test fixture build may set it.
  const named = (path: string) =>
    readFileSync(path, "utf8").includes("VITE_SLOP_FEE_FIXTURE");
  for (const workflow of readdirSync(".github/workflows"))
    expect([workflow, named(`.github/workflows/${workflow}`)]).toEqual([
      workflow,
      false,
    ]);
  for (const path of ["package.json", "vite.config.ts", "wrangler.toml"])
    expect([path, named(path)]).toEqual([path, false]);
  expect(named("scripts/prepare-e2e-fixture.mjs")).toBe(true);
});

test("another database, a route, a missing schedule, a key in the file or a bad value is refused", () => {
  const refused = (change: (config: Config) => void, message: string) => {
    const config = solanaOff();
    change(config);
    expect(() =>
      assertSubmissionFeeRelease(config, production, never, undefined, false),
    ).toThrow(message);
  };
  refused((config) => {
    config.d1_databases[0].database_id = "00000000-0000-0000-0000-000000000000";
  }, "private production database");
  refused((config) => {
    config.routes = [{ pattern: "slop.cash/fee/*" }];
  }, "private production database");
  refused((config) => {
    config.workers_dev = true;
  }, "private production database");
  refused((config) => {
    config.triggers = { crons: ["*/5 * * * *"] };
  }, "private production database");
  refused((config) => {
    config.vars.SUBMISSION_FEE_RESOLVER_KEY = `0x${"1".repeat(64)}`;
  }, "must not be in wrangler.toml");
  refused((config) => {
    config.vars.SUBMISSION_FEE_MODE = "on";
  }, "SUBMISSION_FEE_MODE");
  refused((config) => {
    config.vars.SUBMISSION_FEE_MAX_NATIVE_PER_TX_WEI = "0";
  }, "SUBMISSION_FEE_MAX_NATIVE_PER_TX_WEI");
  refused((config) => {
    config.vars.SUBMISSION_FEE_MAX_NATIVE_PER_DAY_WEI = "1";
  }, "daily native limit");
});

test("keyed endpoints come from the release map by network, and a bad map is refused without echoing it", () => {
  expect(endpointSecrets(undefined)).toEqual({});
  expect(endpointSecrets("  ")).toEqual({});
  expect(
    endpointSecrets(
      JSON.stringify({
        "base-mainnet": "https://base.example/v2/key-a",
        "robinhood-mainnet": "https://rc.example/v2/key-b",
        "solana-mainnet": "https://sol.example/key-c",
      }),
    ),
  ).toEqual({
    RPC_URL_SUBMISSION_FEE_BASE: "https://base.example/v2/key-a",
    RPC_URL_SUBMISSION_FEE_ROBINHOOD: "https://rc.example/v2/key-b",
  });
  // A network the map does not name keeps the public default.
  expect(
    endpointSecrets(JSON.stringify({ "base-mainnet": "https://b.example/k" })),
  ).toEqual({ RPC_URL_SUBMISSION_FEE_BASE: "https://b.example/k" });
  for (const bad of [
    "https://b.example/secret-key",
    JSON.stringify(["https://b.example/secret-key"]),
    JSON.stringify({ "base-mainnet": "http://b.example/secret-key" }),
    JSON.stringify({ "robinhood-mainnet": 7 }),
  ]) {
    let thrown = "";
    try {
      endpointSecrets(bad);
    } catch (error) {
      thrown = String(error);
    }
    expect(thrown).toContain("PAYMENT_RPC_URLS");
    expect(thrown).not.toContain("secret-key");
  }
});

const SOLANA_PROGRAM = "9EyxVhhnCJH4QL5bDsRyukrkHFyitFMuf45UDdLxm4BY";
const withSolana = {
  contracts: { ...deployed.contracts, "solana-mainnet": SOLANA_PROGRAM },
  startBlocks: { ...deployed.startBlocks, "solana-mainnet": 30 },
};
const withoutSolana = {
  contracts: { ...deployed.contracts, "solana-mainnet": null },
  startBlocks: { ...deployed.startBlocks, "solana-mainnet": null },
};
const evmSecrets = ["SUBMISSION_FEE_RESOLVER_KEY"];

const solanaSecrets = [
  "RPC_URL_SUBMISSION_FEE_SOLANA",
  "SUBMISSION_FEE_SOLANA_RESOLVER_SEED",
];

test("the checked-in Worker is live on Solana with the page switch, and needs the endpoint and the seed", () => {
  // Switched on 26 November 2026 (operator decision): the two change together.
  expect(checkedIn().vars.SUBMISSION_FEE_SOLANA_MODE).toBe("live");
  expect(SUBMISSION_FEE_SOLANA_SWITCHED_ON).toBe(true);
  expect(
    assertSubmissionFeeRelease(checkedIn(), production, () => [
      ...evmSecrets,
      ...solanaSecrets,
    ]),
  ).toBe("live");
  // The published tables with either Solana secret missing stop the release.
  for (const missing of solanaSecrets)
    expect(() =>
      assertSubmissionFeeRelease(checkedIn(), production, () => [
        ...evmSecrets,
        ...solanaSecrets.filter((name) => name !== missing),
      ]),
    ).toThrow("Solana secret inventory is not ready");
});

test("with Solana off, an unpublished Solana program does not stop the EVM release", () => {
  expect(
    assertSubmissionFeeRelease(
      solanaOff(),
      production,
      () => evmSecrets,
      withoutSolana,
      false,
    ),
  ).toBe("live");
  // Solana secrets installed ahead of the switch are not a foreign secret.
  expect(
    assertSubmissionFeeRelease(
      solanaOff(),
      production,
      () => [...evmSecrets, ...solanaSecrets],
      withoutSolana,
      false,
    ),
  ).toBe("live");
});

test("a Solana mode other than off needs the published program and the endpoint; live also needs the seed and the page switch", () => {
  const recordOnly = checkedIn();
  recordOnly.vars.SUBMISSION_FEE_SOLANA_MODE = "dry_run";
  const endpoint = [...evmSecrets, "RPC_URL_SUBMISSION_FEE_SOLANA"];
  expect(() =>
    assertSubmissionFeeRelease(
      recordOnly,
      production,
      () => endpoint,
      withoutSolana,
      false,
    ),
  ).toThrow("program id and its start slot");
  expect(() =>
    assertSubmissionFeeRelease(
      recordOnly,
      production,
      () => evmSecrets,
      withSolana,
      false,
    ),
  ).toThrow("Solana secret inventory is not ready");
  expect(
    assertSubmissionFeeRelease(
      recordOnly,
      production,
      () => endpoint,
      withSolana,
      false,
    ),
  ).toBe("live");
  const live = checkedIn();
  live.vars.SUBMISSION_FEE_SOLANA_MODE = "live";
  // Live without the page switch, and the page switch without live.
  expect(() =>
    assertSubmissionFeeRelease(
      live,
      production,
      () => endpoint,
      withSolana,
      false,
    ),
  ).toThrow("change together");
  expect(() =>
    assertSubmissionFeeRelease(
      solanaOff(),
      production,
      () => endpoint,
      withSolana,
      true,
    ),
  ).toThrow("change together");
  expect(() =>
    assertSubmissionFeeRelease(
      live,
      production,
      () => endpoint,
      withSolana,
      true,
    ),
  ).toThrow("Solana secret inventory is not ready");
  expect(
    assertSubmissionFeeRelease(
      live,
      production,
      () => [...endpoint, "SUBMISSION_FEE_SOLANA_RESOLVER_SEED"],
      withSolana,
      true,
    ),
  ).toBe("live");
  const unknown = checkedIn();
  unknown.vars.SUBMISSION_FEE_SOLANA_MODE = "on";
  expect(() =>
    assertSubmissionFeeRelease(unknown, production, () => endpoint, withSolana),
  ).toThrow("SUBMISSION_FEE_SOLANA_MODE");
  const leaked = checkedIn();
  (leaked.vars as Record<string, string>).SUBMISSION_FEE_SOLANA_RESOLVER_SEED =
    "00".repeat(32);
  expect(() =>
    assertSubmissionFeeRelease(leaked, production, never, withSolana),
  ).toThrow("must not be in wrangler.toml");
});
