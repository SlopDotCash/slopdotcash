// The release check of the submission-fee Worker, on the checked-in file.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SUBMISSION_FEE_SWITCHED_ON } from "../src/lib/submission-fee.mjs";
import { assertSubmissionFeeRelease } from "./release-submission-fee";

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
const never = () => {
  throw new Error("the secret inventory must not be read");
};

test("the checked-in Worker ships off, on the private production database, and reads no secret names", () => {
  expect(assertSubmissionFeeRelease(checkedIn(), production, never)).toBe(
    "off",
  );
});

test("dry_run needs no key and no deployed contract", () => {
  const config = checkedIn();
  config.vars.SUBMISSION_FEE_MODE = "dry_run";
  expect(assertSubmissionFeeRelease(config, production, never)).toBe("dry_run");
});

test("live is refused until every contract, start block and the key are in place", () => {
  const config = checkedIn();
  config.vars.SUBMISSION_FEE_MODE = "live";
  const key = () => ["SUBMISSION_FEE_RESOLVER_KEY"];
  expect(() =>
    assertSubmissionFeeRelease(config, production, key, unpublished),
  ).toThrow("every contract address and start block");
  expect(() =>
    assertSubmissionFeeRelease(config, production, key, {
      ...deployed,
      startBlocks: { "base-mainnet": 10, "robinhood-mainnet": null },
    }),
  ).toThrow("every contract address and start block");
  expect(() =>
    assertSubmissionFeeRelease(config, production, () => [], deployed),
  ).toThrow("secret inventory is not ready");
  // A secret the Worker has no use for is refused too.
  expect(() =>
    assertSubmissionFeeRelease(
      config,
      production,
      () => ["SUBMISSION_FEE_RESOLVER_KEY", "FEE_WALLET_KEY_BASE"],
      deployed,
    ),
  ).toThrow("secret inventory is not ready");
  expect(
    assertSubmissionFeeRelease(
      config,
      production,
      () => ["SUBMISSION_FEE_RESOLVER_KEY", "RPC_URL_SUBMISSION_FEE_BASE"],
      deployed,
    ),
  ).toBe("live");
});

test("the reviewed tables hold both deployed contracts, so live waits only for the key", () => {
  const config = checkedIn();
  config.vars.SUBMISSION_FEE_MODE = "live";
  expect(() =>
    assertSubmissionFeeRelease(config, production, () => []),
  ).toThrow("secret inventory is not ready");
  expect(
    assertSubmissionFeeRelease(config, production, () => [
      "SUBMISSION_FEE_RESOLVER_KEY",
    ]),
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

test("another database, a route, a missing schedule, a key in the file or a bad value is refused", () => {
  const refused = (change: (config: Config) => void, message: string) => {
    const config = checkedIn();
    change(config);
    expect(() => assertSubmissionFeeRelease(config, production, never)).toThrow(
      message,
    );
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
