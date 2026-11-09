import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  checkReferralFiles,
  referralWatchConfig,
  type ReferralWatchFetch,
} from "./check-referral-roots";
import { REFERRAL_ACCRUALS_PATH } from "../backend/referrals/handler";
import { buildTree } from "../workers/referral-accrual/merkle";

const ORIGIN = "https://watch.invalid";
const WALLET = `0x${"1".repeat(40)}`;
const OTHER_WALLET = `0x${"2".repeat(40)}`;
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

function fixture(walletlessFirst = false) {
  const months = ["2026-11", "2026-12"].map((period, epoch) => {
    const amount = epoch === 0 ? "2" : "3";
    const wallet = walletlessFirst && epoch === 0 ? null : WALLET;
    const tree = buildTree(wallet ? [{ address: wallet, cumulativeBase: BigInt(amount) }] : []);
    return {
      schema: "slop-referral-accrual-file-v1",
      ruleVersion: "referral-accrual-v1",
      period,
      epoch,
      mode: "dry_run",
      generatedAt: epoch === 0 ? "2026-12-01T01:23:00.000Z" : "2027-01-01T01:23:00.000Z",
      parameters: { rateBasePerMicro: "1", tokenDecimals: 0, poolBase: "4", projectCapBase: "3", claimChain: "robinhood" },
      accruals: [{ obligationId: `obligation-${epoch}`, projectId: "project", referrerGithubId: "101", grossBase: "2", network: "base-mainnet", assetAddress: USDC, assetSymbol: "USDC", computedBase: "2", accruedBase: epoch === 0 ? "2" : "1", outcome: epoch === 0 ? "accrued" : "project_cap" }],
      totals: { poolAccruedBase: amount, treeTotalBase: wallet ? amount : "0" },
      referrers: [{ githubId: "101", cumulativeBase: amount, wallet, ...(tree ? { leaf: { hash: tree.leaves[0].hash, proof: tree.leaves[0].proof } } : {}) }],
      merkle: tree ? { root: tree.root, leafCount: tree.leaves.length } : null,
    };
  });
  const bodies = new Map<string, string>();
  const rows = months.map((month) => ({ period: month.period, epoch: month.epoch, mode: month.mode, bodySha256: "", merkleRoot: month.merkle?.root ?? null, treeTotalBase: month.totals.treeTotalBase, leafCount: month.merkle?.leafCount ?? 0, createdAt: month.generatedAt, url: `${REFERRAL_ACCRUALS_PATH}/${month.period}` }));
  function publish() {
    months.forEach((month, i) => {
      const body = JSON.stringify(month);
      bodies.set(rows[i].url, body);
      rows[i].bodySha256 = sha(body);
    });
  }
  publish();
  const requests: { path: string; redirect: RequestRedirect | undefined }[] = [];
  const fetcher: ReferralWatchFetch = async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    requests.push({ path: url.pathname, redirect: init?.redirect });
    if (url.origin !== ORIGIN) throw new Error("Unexpected external origin");
    if (url.pathname === REFERRAL_ACCRUALS_PATH) return Response.json({ schema: "slop-referral-accrual-index-v1", files: rows });
    const body = bodies.get(url.pathname);
    if (body === undefined) return new Response("missing", { status: 404 });
    return new Response(body, { headers: { "x-slop-sha256": sha(body) } });
  };
  const read = () => checkReferralFiles({ origin: ORIGIN, firstPeriod: "2026-11", now: new Date("2027-01-01T03:00:00Z"), fetch: fetcher });
  return { months, rows, bodies, requests, publish, fetcher, read };
}

test("watcher recomputes cumulative lifetime caps and follows only canonical same-origin paths", async () => {
  const f = fixture();
  const result = await f.read();
  expect(result.files).toHaveLength(2);
  expect(result.awaitingFiling).toBe(false);
  expect(f.requests.map((request) => request.path)).toEqual([REFERRAL_ACCRUALS_PATH, `${REFERRAL_ACCRUALS_PATH}/2026-11`, `${REFERRAL_ACCRUALS_PATH}/2026-12`]);
  expect(f.requests.every((request) => request.redirect === "error")).toBe(true);
});

test("walletless cumulative credit can enter the next root without losing prior credit", async () => {
  const f = fixture(true);
  expect((await f.read()).files[0].merkleRoot).toBeNull();
  expect((await f.read()).files[1].treeTotalBase).toBe("3");
});

test.each([
  ["2026-11-30T23:59:59.999Z", false],
  ["2026-12-01T00:00:00.000Z", true],
  ["2026-12-01T01:59:59.999Z", true],
] as const)("empty index distinguishes filing grace at %s", async (now, awaiting) => {
  const result = await checkReferralFiles({ origin: ORIGIN, firstPeriod: "2026-11", now: new Date(now), fetch: async () => Response.json({ schema: "slop-referral-accrual-index-v1", files: [] }) });
  expect(result).toEqual({ files: [], awaitingFiling: awaiting });
});

test("two-hour filing boundary refuses a missing closed period", async () => {
  await expect(checkReferralFiles({ origin: ORIGIN, firstPeriod: "2026-11", now: new Date("2026-12-01T02:00:00.000Z"), fetch: async () => Response.json({ schema: "slop-referral-accrual-index-v1", files: [] }) })).rejects.toThrow("referral_files_stale");
});

test("index cannot redirect file reads to an attacker URL", async () => {
  const f = fixture();
  f.rows[0].url = "https://attacker.invalid/file";
  await expect(f.read()).rejects.toThrow("referral_period_coverage_invalid");
  expect(f.requests).toHaveLength(1);
});

test("wrong body digest refuses before cumulative data is accepted", async () => {
  const f = fixture();
  f.rows[1].bodySha256 = "0".repeat(64);
  await expect(f.read()).rejects.toThrow("referral_file_digest_mismatch");
});

test("same body still needs the exact digest response header", async () => {
  const f = fixture();
  await expect(checkReferralFiles({ origin: ORIGIN, firstPeriod: "2026-11", now: new Date("2027-01-01T03:00:00Z"), fetch: async (input, init) => {
    const response = await f.fetcher(input, init);
    if (new URL(String(input)).pathname !== REFERRAL_ACCRUALS_PATH) response.headers.set("x-slop-sha256", "0".repeat(64));
    return response;
  } })).rejects.toThrow("referral_file_digest_mismatch");
});

test("the same obligation cannot be counted in two files", async () => {
  const f = fixture();
  f.months[1].accruals[0].obligationId = f.months[0].accruals[0].obligationId;
  f.publish();
  await expect(f.read()).rejects.toThrow("referral_obligation_repeated");
});

test("second month cannot ignore the first month's project cap usage", async () => {
  const f = fixture();
  f.months[1].accruals[0].accruedBase = "2";
  f.publish();
  await expect(f.read()).rejects.toThrow("referral_accrual_cap_mismatch");
});

test("excluded outcomes cannot carry nonzero computed credit", async () => {
  const f = fixture();
  f.months[0].accruals[0].outcome = "held";
  f.months[0].accruals[0].accruedBase = "0";
  f.publish();
  await expect(f.read()).rejects.toThrow("referral_excluded_amount_mismatch");
});

test("a pinned wallet cannot change even when the later file digest is valid", async () => {
  const f = fixture();
  f.months[1].referrers[0].wallet = OTHER_WALLET;
  f.publish();
  await expect(f.read()).rejects.toThrow("referral_wallet_pin_mismatch");
});

test("walletless entries cannot carry a leaf", async () => {
  const f = fixture(true);
  f.months[0].referrers[0].leaf = { hash: `0x${"3".repeat(64)}`, proof: [] };
  f.publish();
  await expect(f.read()).rejects.toThrow("referral_walletless_leaf");
});

test("a valid root does not excuse an altered published leaf proof", async () => {
  const f = fixture();
  f.months[0].referrers[0].leaf!.proof = [`0x${"4".repeat(64)}`];
  f.publish();
  await expect(f.read()).rejects.toThrow("referral_proof_mismatch");
});

test("a later failure does not expose accepted earlier files", async () => {
  const f = fixture();
  f.months[1].totals.poolAccruedBase = "2";
  f.publish();
  await expect(f.read()).rejects.toThrow("referral_cumulative_total_mismatch");
  expect(f.requests).toHaveLength(3);
});

test("unconfigured off watcher is inactive without parsing unrelated fields", () => {
  expect(referralWatchConfig({ REFERRAL_ACCRUAL_MODE: "off", REFERRAL_FIRST_PERIOD: "invalid" })).toBeNull();
});

test("partly configured deployment cannot masquerade as inactive", () => {
  expect(() => referralWatchConfig({ REFERRAL_ACCRUAL_MODE: "off", REFERRAL_DISTRIBUTOR_ADDRESS: WALLET })).toThrow();
});
