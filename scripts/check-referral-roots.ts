/** Read-only referral file and chain comparison. It never reads a signing key. */
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
} from "viem";
import { REFERRAL_ACCRUALS_PATH } from "../backend/referrals/handler";
import { isCanonicalEvmReceipt } from "../contracts/evm/adapter";
import { scanReferralLogs } from "../workers/referral-accrual/chain-logs";
import {
  type PosterConfig,
  parseConfig,
  type ReferralAccrualEnv,
  RULE_VERSION,
} from "../workers/referral-accrual/config";
import {
  eligibleAsset,
  nextPeriod,
  pendingPeriods,
  periodBounds,
} from "../workers/referral-accrual/core";
import { buildTree, type Leaf } from "../workers/referral-accrual/merkle";

const POSTED = parseAbiItem(
  "event RootPosted(uint256 indexed epoch, bytes32 root, uint256 total, uint64 claimableAt)",
);
const VOIDED = parseAbiItem(
  "event RootVoided(uint256 indexed epoch, bytes32 root)",
);
const ABI = parseAbi([
  "function token() view returns (address)",
  "function nextEpoch() view returns (uint256)",
  "function epochAt(uint256) view returns ((bytes32 root,uint256 total,uint64 postedAt,bool voided))",
]);
const COUNTED = new Set(["accrued", "project_cap", "pool_cap"]);
const EXCLUDED = new Set([
  "window_closed",
  "held",
  "referrer_excluded",
  "asset_not_eligible",
]);
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
export type ReferralWatchFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

class WatchError extends Error {}
function requireEvidence(condition: unknown, code: string): asserts condition {
  if (!condition) throw new WatchError(code);
}
function units(value: unknown): bigint {
  requireEvidence(
    typeof value === "string" && /^(0|[1-9][0-9]{0,77})$/u.test(value),
    "referral_file_amount_invalid",
  );
  return BigInt(value);
}
function accountId(value: unknown): asserts value is string {
  requireEvidence(
    typeof value === "string" && /^[1-9][0-9]{0,19}$/u.test(value),
    "referral_file_account_invalid",
  );
}

interface FiledMonth {
  period: string;
  epoch: number;
  mode: string;
  bodySha256: string;
  merkleRoot: Hex | null;
  treeTotalBase: string;
  leafCount: number;
  createdAt: string;
  url: string;
}
interface PublicFile {
  schema: string;
  ruleVersion: string;
  period: string;
  epoch: number;
  mode: string;
  generatedAt: string;
  parameters: {
    rateBasePerMicro: string;
    tokenDecimals: number;
    poolBase: string;
    projectCapBase: string;
    claimChain: string;
  };
  accruals: {
    obligationId: string;
    projectId: string;
    referrerGithubId: string;
    grossBase: string;
    network: string;
    assetAddress: string;
    assetSymbol: string;
    computedBase: string;
    accruedBase: string;
    outcome: string;
  }[];
  totals: { poolAccruedBase: string; treeTotalBase: string };
  referrers: {
    githubId: string;
    cumulativeBase: string;
    wallet: string | null;
    leaf?: { hash: string; proof: string[] };
  }[];
  merkle: { root: Hex; leafCount: number } | null;
}

/** Public endpoint data is evidence, not authority to follow another URL. */
async function readPublic(url: string, fetcher: ReferralWatchFetch) {
  const response = await fetcher(url, {
    redirect: "error",
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
  requireEvidence(response.ok, "referral_public_data_unavailable");
  const text = await response.text();
  requireEvidence(
    text.length <= 16 * 1024 * 1024,
    "referral_public_data_oversized",
  );
  return { text, digest: response.headers.get("x-slop-sha256") };
}

export async function checkReferralFiles(options: {
  origin: string;
  firstPeriod: string;
  now: Date;
  fetch?: ReferralWatchFetch;
}): Promise<{ files: FiledMonth[]; awaitingFiling: boolean }> {
  const fetcher = options.fetch ?? fetch;
  const base = new URL(REFERRAL_ACCRUALS_PATH, options.origin);
  const index = JSON.parse((await readPublic(base.href, fetcher)).text) as {
    schema: string;
    files: FiledMonth[];
  };
  requireEvidence(
    index.schema === "slop-referral-accrual-index-v1" &&
      Array.isArray(index.files),
    "referral_index_invalid",
  );
  const obligations = new Set<string>();
  const projects = new Map<string, bigint>();
  const totals = new Map<string, bigint>();
  const pins = new Map<string, string>();
  const wallets = new Map<string, string>();
  let pool = 0n;
  let period = options.firstPeriod;
  for (const [epoch, row] of index.files.entries()) {
    requireEvidence(
      row.epoch === epoch &&
        row.period === period &&
        Date.parse(periodBounds(period).end) <= options.now.getTime() &&
        row.url === `${REFERRAL_ACCRUALS_PATH}/${period}`,
      "referral_period_coverage_invalid",
    );
    const response = await readPublic(new URL(row.url, base).href, fetcher);
    requireEvidence(
      sha(response.text) === row.bodySha256 &&
        response.digest === row.bodySha256,
      "referral_file_digest_mismatch",
    );
    const file = JSON.parse(response.text) as PublicFile;
    requireEvidence(
      file.schema === "slop-referral-accrual-file-v1" &&
        file.ruleVersion === RULE_VERSION &&
        file.epoch === epoch &&
        file.period === period &&
        file.mode === row.mode &&
        ["dry_run", "live"].includes(file.mode) &&
        file.generatedAt === row.createdAt &&
        Date.parse(file.generatedAt) >= Date.parse(periodBounds(period).end) &&
        Date.parse(file.generatedAt) <= options.now.getTime() &&
        file.parameters.claimChain === "robinhood" &&
        Array.isArray(file.accruals) &&
        Array.isArray(file.referrers),
      "referral_file_identity_mismatch",
    );
    const rate = units(file.parameters.rateBasePerMicro);
    const projectCap = units(file.parameters.projectCapBase);
    const poolCap = units(file.parameters.poolBase);
    for (const accrual of file.accruals) {
      accountId(accrual.referrerGithubId);
      requireEvidence(
        typeof accrual.obligationId === "string" &&
          !obligations.has(accrual.obligationId),
        "referral_obligation_repeated",
      );
      obligations.add(accrual.obligationId);
      const accrued = units(accrual.accruedBase);
      const computed = units(accrual.computedBase);
      if (!COUNTED.has(accrual.outcome)) {
        requireEvidence(
          EXCLUDED.has(accrual.outcome) && accrued === 0n && computed === 0n,
          "referral_excluded_amount_mismatch",
        );
        continue;
      }
      const asset = eligibleAsset(accrual.network, accrual.assetAddress, 6);
      requireEvidence(
        asset !== null &&
          asset.symbol === accrual.assetSymbol &&
          computed === units(accrual.grossBase) * rate,
        "referral_accrual_arithmetic_mismatch",
      );
      const used = projects.get(accrual.projectId) ?? 0n;
      const projectLeft = projectCap > used ? projectCap - used : 0n;
      const poolLeft = poolCap > pool ? poolCap - pool : 0n;
      const expected = [computed, projectLeft, poolLeft].reduce((a, b) =>
        a < b ? a : b,
      );
      requireEvidence(accrued === expected, "referral_accrual_cap_mismatch");
      projects.set(accrual.projectId, used + accrued);
      totals.set(
        accrual.referrerGithubId,
        (totals.get(accrual.referrerGithubId) ?? 0n) + accrued,
      );
      pool += accrued;
    }
    requireEvidence(
      file.referrers.length === totals.size &&
        units(file.totals.poolAccruedBase) === pool,
      "referral_cumulative_total_mismatch",
    );
    const ids = new Set<string>();
    const leaves: Leaf[] = [];
    for (const referrer of file.referrers) {
      accountId(referrer.githubId);
      const amount = units(referrer.cumulativeBase);
      requireEvidence(
        !ids.has(referrer.githubId) && totals.get(referrer.githubId) === amount,
        "referral_cumulative_account_mismatch",
      );
      ids.add(referrer.githubId);
      const pinned = pins.get(referrer.githubId);
      requireEvidence(
        pinned === undefined || referrer.wallet === pinned,
        "referral_wallet_pin_mismatch",
      );
      if (referrer.wallet === null) {
        requireEvidence(
          referrer.leaf === undefined,
          "referral_walletless_leaf",
        );
        continue;
      }
      requireEvidence(
        /^0x[0-9a-f]{40}$/u.test(referrer.wallet) &&
          amount > 0n &&
          (!wallets.has(referrer.wallet) ||
            wallets.get(referrer.wallet) === referrer.githubId),
        "referral_wallet_invalid",
      );
      pins.set(referrer.githubId, referrer.wallet);
      wallets.set(referrer.wallet, referrer.githubId);
      leaves.push({ address: referrer.wallet, cumulativeBase: amount });
    }
    const tree = buildTree(leaves);
    const treeTotal = leaves.reduce(
      (sum, leaf) => sum + leaf.cumulativeBase,
      0n,
    );
    requireEvidence(
      row.merkleRoot === (tree?.root ?? null) &&
        row.leafCount === leaves.length &&
        units(row.treeTotalBase) === treeTotal &&
        units(file.totals.treeTotalBase) === treeTotal &&
        (tree === null
          ? file.merkle === null
          : file.merkle?.root === tree.root &&
            file.merkle.leafCount === leaves.length),
      "referral_tree_mismatch",
    );
    for (const leaf of tree?.leaves ?? []) {
      const published = file.referrers.find(
        (entry) => entry.wallet === leaf.address,
      )?.leaf;
      requireEvidence(
        published?.hash === leaf.hash &&
          JSON.stringify(published.proof) === JSON.stringify(leaf.proof),
        "referral_proof_mismatch",
      );
    }
    period = nextPeriod(period);
  }
  // The filing cron is 01:23 UTC. Its first run has until 02:00 to publish a
  // just-closed month; this distinguishes normal scheduling from stale data.
  const due = pendingPeriods(
    [],
    options.firstPeriod,
    new Date(options.now.getTime() - 2 * 60 * 60 * 1000),
  );
  requireEvidence(index.files.length >= due.length, "referral_files_stale");
  return {
    files: index.files,
    awaitingFiling:
      index.files.length <
      pendingPeriods([], options.firstPeriod, options.now).length,
  };
}

export interface ReferralWatchConfig {
  poster: PosterConfig;
  firstPeriod: string;
  deploymentBlock: bigint;
  codeHash: Hex;
}
export function referralWatchConfig(
  vars: ReferralAccrualEnv & {
    REFERRAL_DEPLOYMENT_BLOCK?: string;
    REFERRAL_DISTRIBUTOR_CODE_HASH?: string;
  },
): ReferralWatchConfig | null {
  const facts = [
    vars.REFERRAL_DISTRIBUTOR_ADDRESS,
    vars.REFERRAL_TOKEN_ADDRESS,
    vars.REFERRAL_DEPLOYMENT_BLOCK,
    vars.REFERRAL_DISTRIBUTOR_CODE_HASH,
  ];
  if (
    (vars.REFERRAL_ACCRUAL_MODE ?? "off") === "off" &&
    facts.every((value) => !value)
  )
    return null;
  // Validate the same public deployment fields without activating any service.
  // This process has no signer and also watches a configured but inactive job.
  const { poster, firstPeriod } = parseConfig({
    ...vars,
    REFERRAL_ACCRUAL_MODE: "live",
    REFERRAL_PROGRAM_ENABLED: "true",
  });
  requireEvidence(
    poster !== null &&
      /^0x[0-9a-f]{64}$/u.test(vars.REFERRAL_DISTRIBUTOR_CODE_HASH ?? ""),
    "referral_deployment_evidence_missing",
  );
  return {
    poster,
    firstPeriod,
    deploymentBlock: units(vars.REFERRAL_DEPLOYMENT_BLOCK),
    codeHash: vars.REFERRAL_DISTRIBUTOR_CODE_HASH as Hex,
  };
}

export async function checkReferralRoots(options: {
  config: ReferralWatchConfig;
  origin: string;
  now?: Date;
  fetch?: ReferralWatchFetch;
}) {
  const { config } = options;
  const now = options.now ?? new Date();
  const files = await checkReferralFiles({
    origin: options.origin,
    firstPeriod: config.firstPeriod,
    now,
    fetch: options.fetch,
  });
  const client = createPublicClient({
    transport: http(config.poster.rpcUrl, {
      fetchFn: options.fetch,
      retryCount: 0,
      timeout: 15_000,
    }),
  });
  requireEvidence(
    (await client.getChainId()) === config.poster.chainId,
    "referral_wrong_chain",
  );
  const distributor = config.poster.distributor as Address;
  const finalized = await client.getBlock({ blockTag: "finalized" });
  requireEvidence(
    finalized.number >= config.deploymentBlock,
    "referral_deployment_not_finalized",
  );
  const code = await client.getCode({ address: distributor });
  requireEvidence(
    code && keccak256(code) === config.codeHash,
    "referral_deployment_code_mismatch",
  );
  const token = await client.readContract({
    address: distributor,
    abi: ABI,
    functionName: "token",
  });
  requireEvidence(
    token.toLowerCase() === config.poster.token,
    "referral_deployment_token_mismatch",
  );
  const tip = await client.getBlock({ blockTag: "latest" });
  const [posted, voids] = await Promise.all([
    scanReferralLogs(
      config.poster.network,
      config.deploymentBlock,
      tip.number,
      (fromBlock, toBlock) =>
        client.getLogs({
          address: distributor,
          event: POSTED,
          fromBlock,
          toBlock,
          strict: true,
        }),
    ),
    scanReferralLogs(
      config.poster.network,
      config.deploymentBlock,
      tip.number,
      (fromBlock, toBlock) =>
        client.getLogs({
          address: distributor,
          event: VOIDED,
          fromBlock,
          toBlock,
          strict: true,
        }),
    ),
  ]);
  const count = await client.readContract({
    address: distributor,
    abi: ABI,
    functionName: "nextEpoch",
  });
  requireEvidence(
    BigInt(posted.length) === count,
    "referral_event_coverage_mismatch",
  );
  const candidates = files.files.filter((file) => file.merkleRoot !== null);
  requireEvidence(
    posted.length <= candidates.length,
    "referral_post_without_file",
  );
  let pending = files.awaitingFiling || posted.length < candidates.length;
  const mappings: {
    epoch: number;
    period: string;
    transaction: Hex;
    finalized: boolean;
    voided: boolean;
  }[] = [];
  const checkLog = async (
    log: (typeof posted)[number] | (typeof voids)[number],
  ) => {
    const receipt = await client.getTransactionReceipt({
      hash: log.transactionHash,
    });
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    requireEvidence(
      !log.removed &&
        isCanonicalEvmReceipt(log.transactionHash, receipt, block) &&
        receipt.status === "success" &&
        receipt.to?.toLowerCase() === config.poster.distributor &&
        log.blockHash === receipt.blockHash &&
        log.blockNumber === receipt.blockNumber &&
        log.transactionIndex === receipt.transactionIndex &&
        receipt.logs.some(
          (entry) =>
            !entry.removed &&
            entry.logIndex === log.logIndex &&
            entry.transactionHash === log.transactionHash &&
            entry.blockHash === receipt.blockHash &&
            entry.blockNumber === receipt.blockNumber &&
            entry.transactionIndex === receipt.transactionIndex &&
            entry.address.toLowerCase() === config.poster.distributor &&
            entry.data === log.data &&
            JSON.stringify(entry.topics) === JSON.stringify(log.topics),
        ),
      "referral_event_not_canonical",
    );
    return receipt.blockNumber <= finalized.number;
  };
  const seenVoids = new Set<bigint>();
  for (const log of voids) {
    requireEvidence(
      !seenVoids.has(log.args.epoch) && log.args.epoch < count,
      "referral_void_coverage_mismatch",
    );
    seenVoids.add(log.args.epoch);
    requireEvidence(
      log.args.root === candidates[Number(log.args.epoch)]?.merkleRoot,
      "referral_void_root_mismatch",
    );
    if (!(await checkLog(log))) pending = true;
  }
  for (const [index, log] of posted.entries()) {
    const file = candidates[index];
    requireEvidence(
      log.args.epoch === BigInt(index) &&
        log.args.root === file.merkleRoot &&
        log.args.total === units(file.treeTotalBase),
      "referral_posted_root_mismatch",
    );
    const confirmed = await checkLog(log);
    if (!confirmed) pending = true;
    const epoch = await client.readContract({
      address: distributor,
      abi: ABI,
      functionName: "epochAt",
      args: [BigInt(index)],
    });
    requireEvidence(
      epoch.root === file.merkleRoot &&
        epoch.total === units(file.treeTotalBase) &&
        epoch.voided === seenVoids.has(BigInt(index)),
      "referral_epoch_state_mismatch",
    );
    mappings.push({
      epoch: index,
      period: file.period,
      transaction: log.transactionHash,
      finalized: confirmed,
      voided: epoch.voided,
    });
  }
  const end = await client.getBlock({ blockNumber: finalized.number });
  requireEvidence(end.hash === finalized.hash, "referral_finality_changed");
  const endTip = await client.getBlock({ blockNumber: tip.number });
  requireEvidence(endTip.hash === tip.hash, "referral_observation_changed");
  const endCount = await client.readContract({
    address: distributor,
    abi: ABI,
    functionName: "nextEpoch",
  });
  requireEvidence(endCount === count, "referral_observation_changed");
  return {
    status: pending ? "pending" : "verified",
    scope: "public_files_and_canonical_roots",
    observedAt: now.toISOString(),
    network: config.poster.network,
    finalizedBlock: finalized.number.toString(),
    files: files.files.length,
    unpostedFiles: candidates.length - posted.length,
    mappings,
  };
}

if (import.meta.main) {
  try {
    const configFile = Bun.TOML.parse(
      readFileSync("workers/referral-accrual/wrangler.toml", "utf8"),
    ) as { vars: Parameters<typeof referralWatchConfig>[0] };
    const config = referralWatchConfig(configFile.vars);
    const result =
      config === null
        ? {
            status: "inactive",
            reason:
              "Program deployment is not configured; this is not qualification.",
          }
        : await checkReferralRoots({ config, origin: "https://slop.cash" });
    console.log(JSON.stringify(result));
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `Referral root watch: ${JSON.stringify(result)}\n`,
      );
  } catch (error) {
    // RPC errors can contain provider URLs. Publish only fixed local categories.
    const reason =
      error instanceof WatchError
        ? error.message
        : "referral_watch_unavailable";
    console.error(`::error::${reason}`);
    if (process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `Referral root watch failed: ${reason}\n`,
      );
    process.exitCode = 1;
  }
}
