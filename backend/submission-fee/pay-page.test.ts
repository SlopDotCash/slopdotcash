// The pay page's rules (src/lib/submission-fee-page.ts), against the real read
// route and the real migrations. It lives here so the unit shards run it.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import {
  SUBMISSION_FEE_BURN,
  SUBMISSION_FEE_CONTRACTS,
  SUBMISSION_FEE_KEPT_TO,
  SUBMISSION_FEE_RECLAIM_DAYS,
  SUBMISSION_FEE_TOKENS,
  submissionFeeItem,
} from "../../src/lib/submission-fee.mjs";
import {
  FEE_RATE_PATH,
  type FeeRates,
  FeeRecordError,
  feeAmountText,
  feeItemPath,
  feeRepository,
  feeRoute,
  PUBLISHED_FEE_TABLES,
  publishedSlopAmounts,
  readFeeItem,
  readFeeRates,
  savedFeeWay,
} from "../../src/lib/submission-fee-page";
import { sqliteD1 } from "../../tests/sqlite-d1";
import {
  feeNeededComment,
  feeWays,
} from "../../workers/slopbot/submission-fee";
import { handleSubmissionFeeApi } from "./handler";

const NOW = "2026-12-05T12:00:00.000Z";
const REPOSITORY = "4242";
const PULL = 7;
const DEPOSIT = `0x${"d".repeat(64)}`;
const RESOLVE = `0x${"e".repeat(64)}`;

function harness() {
  const { db, sqlite } = sqliteD1();
  const clock = { now: NOW };
  const rate = (effectiveAt: string, slopPerUsd: string) =>
    sqlite
      .query("INSERT INTO submission_fee_rates VALUES (?, ?, 'test', ?)")
      .run(effectiveAt, slopPerUsd, effectiveAt);
  rate("2026-11-20T00:00:00.000Z", "75");
  const get = async (path: string) => {
    const response = await handleSubmissionFeeApi(
      new Request(`https://slop.cash${path}`),
      { db: db as never, now: () => new Date(clock.now) },
    );
    return { status: response?.status, body: await response?.json() };
  };
  const read = (repositoryId = REPOSITORY, pullNumber = PULL) =>
    get(feeItemPath(repositoryId, pullNumber));
  /** The published rates, read from the real rate route as the page reads them. */
  const rates = async () => readFeeRates((await get(FEE_RATE_PATH)).body);
  const ask = (stableMinor = "2000000") =>
    sqlite.exec(
      `INSERT INTO submission_fee_items (repository_id, pull_number, project_id, item, stable_minor, asked_at)
       VALUES (${REPOSITORY}, ${PULL}, 'acme', '${submissionFeeItem(REPOSITORY, PULL)}', '${stableMinor}', '2026-12-05T10:00:00.000Z')`,
    );
  return { sqlite, read, ask, rate, rates, clock };
}

test("only a GitHub owner, repository name and pull request number name a page", () => {
  expect(feeRoute("SlopDotCash", "slopdotcash", "3080")).toEqual({
    owner: "SlopDotCash",
    repo: "slopdotcash",
    number: 3080,
  });
  expect(feeRoute("alextitonis", "fly.ai", "8")?.repo).toBe("fly.ai");
  for (const [owner, repo, number] of [
    ["-owner", "repo", "1"],
    ["owner", "..", "1"],
    ["owner", "re po", "1"],
    ["owner", "repo", "0"],
    ["owner", "repo", "01"],
    ["owner", "repo", "1e3"],
    ["owner", "repo", "12345678901"],
    ["owner/x", "repo", "1"],
  ])
    expect(feeRoute(owner, repo, number)).toBe(null);
});

test("the numeric repository id comes from the registry, for a first and an appended repository", () => {
  const project = {
    id: "toon-plugins",
    name: "TOON Plugins",
    slug: "toon-plugins",
    authority: { repositoryId: "1430274000" },
    repositories: [
      { id: "toon-protocol/toon-plugins", aliases: ["old-org/toon-plugins"] },
      { id: "toon-protocol/toon", githubId: "1271472696" },
      { id: "toon-protocol/unrecorded" },
    ],
  } as unknown as ProjectDefinition;
  const names = new Map(
    project.repositories.flatMap((repository) =>
      [repository.id, ...(repository.aliases ?? [])].map((name) => [
        name.toLowerCase(),
        project,
      ]),
    ),
  );
  const find = (name: string) => names.get(name) ?? null;
  const resolve = (owner: string, repo: string) =>
    feeRepository({ owner, repo, number: 1 }, find);
  expect(resolve("TOON-Protocol", "Toon-Plugins")).toEqual({
    projectId: "toon-plugins",
    projectName: "TOON Plugins",
    projectSlug: "toon-plugins",
    repository: "toon-protocol/toon-plugins",
    repositoryId: "1430274000",
  });
  // A transferred repository's old name is the same repository.
  expect(resolve("old-org", "toon-plugins")?.repositoryId).toBe("1430274000");
  // An appended repository has its own id, never the first repository's.
  expect(resolve("toon-protocol", "toon")?.repositoryId).toBe("1271472696");
  // No recorded id and no project: no fee can be looked up.
  expect(resolve("toon-protocol", "unrecorded")).toBe(null);
  expect(resolve("someone", "else")).toBe(null);
});

test("the record the route serves for an unpaid pull request is accepted with the published addresses", async () => {
  const { read, ask, rates } = harness();
  expect((await read()).status).toBe(404);
  ask("3000000");
  const item = readFeeItem(
    (await read()).body,
    REPOSITORY,
    PULL,
    PUBLISHED_FEE_TABLES,
    await rates(),
  );
  expect(item.slopWithheld).toBe(false);
  expect(item.item).toBe(submissionFeeItem(REPOSITORY, PULL));
  expect(item.paid).toBe(null);
  expect(item.due).toEqual([
    {
      network: "base-mainnet",
      chainId: 8453,
      contract: SUBMISSION_FEE_CONTRACTS["base-mainnet"],
      token: SUBMISSION_FEE_TOKENS["base-mainnet"].usdc,
      symbol: "USDC",
      decimals: 6,
      amount: "3000000",
      minimumAccepted: "3000000",
      keptTo: SUBMISSION_FEE_KEPT_TO["base-mainnet"],
      kind: "stable",
    },
    {
      network: "robinhood-mainnet",
      chainId: 4663,
      contract: SUBMISSION_FEE_CONTRACTS["robinhood-mainnet"],
      token: SUBMISSION_FEE_TOKENS["robinhood-mainnet"].usdg,
      symbol: "USDG",
      decimals: 6,
      amount: "3000000",
      minimumAccepted: "3000000",
      keptTo: SUBMISSION_FEE_KEPT_TO["robinhood-mainnet"],
      kind: "stable",
    },
    {
      network: "robinhood-mainnet",
      chainId: 4663,
      contract: SUBMISSION_FEE_CONTRACTS["robinhood-mainnet"],
      token: SUBMISSION_FEE_TOKENS["robinhood-mainnet"].slop,
      symbol: "SLOP",
      decimals: 18,
      amount: "110000000000000000000",
      minimumAccepted: "110000000000000000000",
      keptTo: SUBMISSION_FEE_BURN,
      kind: "slop",
    },
  ] as never);
  expect(item.due.map(feeAmountText)).toEqual(["3 USDC", "3 USDG", "110 SLOP"]);
});

test("a record that names another contract, chain, token, destination, amount or pull request is refused whole", async () => {
  const { read, ask, rates } = harness();
  ask();
  const { body } = await read();
  const published = await rates();
  const attacker = "0x000000000000000000000000000000000000bEEF";
  const refused = (change: (record: typeof body) => void) => {
    const record = structuredClone(body);
    change(record);
    expect(() =>
      readFeeItem(record, REPOSITORY, PULL, PUBLISHED_FEE_TABLES, published),
    ).toThrow(FeeRecordError);
  };
  expect(
    readFeeItem(body, REPOSITORY, PULL, PUBLISHED_FEE_TABLES, published).due,
  ).toHaveLength(3);
  refused((record) => {
    record.due[0].contract = attacker;
  });
  refused((record) => {
    record.due[0].keptTo = attacker;
  });
  refused((record) => {
    record.due[0].token = attacker;
  });
  refused((record) => {
    record.due[0].chainId = 1;
  });
  refused((record) => {
    record.due[0].network = "ethereum";
  });
  // A SLOP fee sent to the fee wallet, or a stablecoin fee sent to the burn address.
  refused((record) => {
    record.due[2].keptTo = SUBMISSION_FEE_KEPT_TO["robinhood-mainnet"];
  });
  refused((record) => {
    record.due[1].keptTo = SUBMISSION_FEE_BURN;
  });
  // A stablecoin amount is the pull request's own recorded fee.
  refused((record) => {
    record.due[0].amount = "9000000";
    record.due[0].minimumAccepted = "9000000";
  });
  refused((record) => {
    record.stableMinor = "900000000";
  });
  refused((record) => {
    record.due[2].decimals = 6;
  });
  refused((record) => {
    record.due[2].minimumAccepted = "999000000000000000000";
  });
  refused((record) => {
    record.due.push(record.due[0]);
  });
  refused((record) => {
    record.item = submissionFeeItem(REPOSITORY, PULL + 1);
  });
  refused((record) => {
    record.repositoryId = 4243;
  });
  refused((record) => {
    record.outcome = "refund_due";
  });
  // The record of another pull request is never shown for this one.
  expect(() => readFeeItem(body, REPOSITORY, PULL + 1)).toThrow(FeeRecordError);
  expect(() => readFeeItem(body, "4243", PULL)).toThrow(FeeRecordError);
});

test("a SLOP amount must be the recorded fee at a published rate, and an inflated one is refused", async () => {
  const { read, ask, rates } = harness();
  ask();
  const { body } = await read();
  const published = await rates();
  expect(published).toEqual({ current: "75", previous: null });
  // 2.00 at half price and 75 SLOP a dollar: 75 SLOP, and nothing else.
  expect(publishedSlopAmounts("2000000", published)).toEqual([
    { amount: "75000000000000000000", minimumAccepted: "75000000000000000000" },
  ]);
  const check = (amount: string, minimumAccepted: string) => {
    const record = structuredClone(body);
    record.due[2].amount = amount;
    record.due[2].minimumAccepted = minimumAccepted;
    return () =>
      readFeeItem(record, REPOSITORY, PULL, PUBLISHED_FEE_TABLES, published);
  };
  expect(
    check("75000000000000000000", "75000000000000000000")().due,
  ).toHaveLength(3);
  // Ten times the fee, with a matching or the true least amount.
  expect(check("750000000000000000000", "750000000000000000000")).toThrow(
    FeeRecordError,
  );
  expect(check("750000000000000000000", "75000000000000000000")).toThrow(
    FeeRecordError,
  );
  // One base unit more, and an amount too low to count.
  expect(check("75000000000000000001", "75000000000000000000")).toThrow(
    FeeRecordError,
  );
  expect(check("7500000000000000000", "7500000000000000000")).toThrow(
    FeeRecordError,
  );
  // A lowered least amount beside the right amount is not the published record either.
  expect(check("75000000000000000000", "1")).toThrow(FeeRecordError);
  // The route says no rate is in force, yet the record lists SLOP.
  expect(() =>
    readFeeItem(body, REPOSITORY, PULL, PUBLISHED_FEE_TABLES, {
      current: null,
      previous: null,
    }),
  ).toThrow(FeeRecordError);
});

test("a rate change between the two reads is allowed only for the previous rate's 48 hours", async () => {
  const { read, ask, rate, rates, clock } = harness();
  ask();
  // The record is read while 75 is in force.
  const before = (await read()).body;
  expect(before.due[2].amount).toBe("75000000000000000000");
  // A new rate takes effect, then the rates are read: 100 now, 75 for 48 hours.
  rate("2026-12-05T12:00:00.000Z", "100");
  clock.now = "2026-12-05T12:00:30.000Z";
  const during = await rates();
  expect(during).toEqual({ current: "100", previous: "75" });
  const accept = (body: unknown, published: FeeRates | null) =>
    readFeeItem(body, REPOSITORY, PULL, PUBLISHED_FEE_TABLES, published);
  // The record made just before the change still names a published amount.
  expect(accept(before, during).due[2].amount).toBe("75000000000000000000");
  // A record made after it: 100 SLOP to pay, 75 still accepted.
  const after = (await read()).body;
  expect(after.due[2]).toMatchObject({
    amount: "100000000000000000000",
    minimumAccepted: "75000000000000000000",
  });
  expect(accept(after, during).due[2].amount).toBe("100000000000000000000");
  // Neither rate's amount: refused, during the 48 hours as at any time.
  const inflated = structuredClone(after);
  inflated.due[2].amount = "200000000000000000000";
  expect(() => accept(inflated, during)).toThrow(FeeRecordError);
  // The newer record against rates read before the change is refused; the next read agrees.
  expect(() => accept(after, { current: "75", previous: null })).toThrow(
    FeeRecordError,
  );
  // After the 48 hours the previous rate's amount is no longer published.
  clock.now = "2026-12-07T12:00:00.000Z";
  const later = await rates();
  expect(later).toEqual({ current: "100", previous: null });
  expect(() => accept(before, later)).toThrow(FeeRecordError);
  expect(accept((await read()).body, later).due[2]).toMatchObject({
    amount: "100000000000000000000",
    minimumAccepted: "100000000000000000000",
  });
});

test("without readable rates SLOP is left out and the stablecoin ways remain", async () => {
  const { read, ask } = harness();
  ask();
  const { body } = await read();
  const item = readFeeItem(body, REPOSITORY, PULL, PUBLISHED_FEE_TABLES, null);
  expect(item.due.map(feeAmountText)).toEqual(["2 USDC", "2 USDG"]);
  expect(item.slopWithheld).toBe(true);
  // Even an inflated SLOP entry is simply never offered; the rest is still checked.
  const inflated = structuredClone(body);
  inflated.due[2].amount = "750000000000000000000";
  expect(
    readFeeItem(inflated, REPOSITORY, PULL, PUBLISHED_FEE_TABLES, null).due,
  ).toHaveLength(2);
  // A rate reply that is not the rate record counts as unread.
  for (const reply of [
    null,
    {},
    {
      schema: "slop-submission-fee-rate-v1",
      rate: { slopPerUsd: "0" },
      previous: null,
    },
    {
      schema: "slop-submission-fee-rate-v1",
      rate: { slopPerUsd: "1e9" },
      previous: null,
    },
    {
      schema: "slop-submission-fee-rate-v1",
      rate: null,
      previous: { slopPerUsd: "75" },
    },
    { schema: "other", rate: { slopPerUsd: "75" }, previous: null },
  ])
    expect(() => readFeeRates(reply)).toThrow("could not be read");
});

test("a recorded deposit and its outcome are read, and nothing is due after it", async () => {
  const { sqlite, read, ask } = harness();
  ask();
  const usdc = SUBMISSION_FEE_TOKENS["base-mainnet"].usdc as string;
  sqlite.exec(
    `UPDATE submission_fee_items SET paid_at = '2026-12-05T11:00:00.000Z', paid_network = 'base-mainnet', paid_deposit_id = 3;
     INSERT INTO submission_fee_deposits (network, deposit_id, item, payer, token, amount, kept_to, tx_hash,
       block_number, block_time, finalized_at, accepted, state)
     VALUES ('base-mainnet', 3, '${submissionFeeItem(REPOSITORY, PULL)}', '0x00000000000000000000000000000000000000aa',
       '${usdc}', '2000000', '${SUBMISSION_FEE_KEPT_TO["base-mainnet"]}', '${DEPOSIT}', 10,
       '2026-12-05T10:59:00.000Z', NULL, 1, 'open')`,
  );
  const included = readFeeItem((await read()).body, REPOSITORY, PULL);
  expect(included.due).toEqual([]);
  expect(included.outcome).toBe(null);
  expect(included.paid).toEqual({
    at: "2026-12-05T11:00:00.000Z",
    network: "base-mainnet",
    depositId: 3,
    token: usdc,
    kind: "stable",
    symbol: "USDC",
    decimals: 6,
    amount: "2000000",
    transaction: DEPOSIT,
    finalized: false,
  });
  sqlite.exec(
    `UPDATE submission_fee_deposits SET finalized_at = '2026-12-05T11:20:00.000Z', state = 'refunded', resolve_tx = '${RESOLVE}';
     UPDATE submission_fee_items SET outcome = 'refunded', outcome_at = '2026-12-05T11:40:00.000Z'`,
  );
  const settled = readFeeItem((await read()).body, REPOSITORY, PULL);
  expect(settled.paid?.finalized).toBe(true);
  expect(settled.outcome).toBe("refunded");
  expect(settled.resolveTransaction).toBe(RESOLVE);
});

test("a way saved with a wallet request must still name the published addresses", async () => {
  const { read, ask } = harness();
  ask();
  const [usdc] = readFeeItem((await read()).body, REPOSITORY, PULL).due;
  expect(savedFeeWay(JSON.parse(JSON.stringify(usdc)))).toEqual(usdc);
  expect(() =>
    savedFeeWay({
      ...usdc,
      contract: "0x000000000000000000000000000000000000bEEF",
    }),
  ).toThrow(FeeRecordError);
  expect(() => savedFeeWay({ ...usdc, amount: "1" })).toThrow(FeeRecordError);
  // Other tables, such as a private test chain's, are checked the same way.
  const local = {
    ...PUBLISHED_FEE_TABLES,
    contracts: {
      ...PUBLISHED_FEE_TABLES.contracts,
      "base-mainnet": "0x00000000000000000000000000000000000000C1",
    },
  };
  expect(() => savedFeeWay(usdc, local)).toThrow(FeeRecordError);
  expect(
    savedFeeWay({ ...usdc, contract: local.contracts["base-mainnet"] }, local)
      .contract,
  ).toBe(local.contracts["base-mainnet"]);
});

test("Slopbot's comment links the page this route serves, and the site rewrites it to the app", () => {
  const comment = feeNeededComment({
    owner: "alextitonis",
    repo: "fly.ai",
    number: 8,
    repositoryId: 1365890202,
    item: submissionFeeItem(1365890202, 8),
    stableMinor: "2000000",
    ways: feeWays("2000000", [], NOW),
  });
  const link = /^Pay page: https:\/\/slop\.cash(\/fee\/\S+)$/mu.exec(comment);
  const segments = link?.[1].split("/").slice(1) ?? [];
  expect(segments).toHaveLength(4);
  expect(segments[0]).toBe("fee");
  expect(feeRoute(segments[1], segments[2], segments[3])).toEqual({
    owner: "alextitonis",
    repo: "fly.ai",
    number: 8,
  });
  const redirects = readFileSync("public/_redirects", "utf8").split("\n");
  expect(redirects).toContain("/fee/:owner/:repo/:number / 200");
  expect(redirects).toContain("/fee/:owner/:repo/:number/ / 200");
});

test("the reclaim sentence states the delay the contracts were deployed with", () => {
  const script = readFileSync(
    "contracts/evm/script/DeploySubmissionDeposits.sol",
    "utf8",
  );
  expect(script).toContain(
    `uint64 public constant RECLAIM_DELAY = ${SUBMISSION_FEE_RECLAIM_DAYS} days;`,
  );
});
