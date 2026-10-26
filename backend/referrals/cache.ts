import {
  createPublicClient,
  decodeEventLog,
  type Hex,
  http,
  keccak256,
  parseAbi,
} from "viem";
import { isCanonicalEvmReceipt } from "../../contracts/evm/adapter";
import {
  REFERRAL_ABI,
  type ReferralProgram,
} from "../../src/lib/referral-claims";
import { scanReferralLogs } from "../../workers/referral-accrual/chain-logs";
import {
  parseConfig,
  type ReferralAccrualEnv,
} from "../../workers/referral-accrual/config";
import type { ReferralD1Database } from "../../workers/referral-accrual/store";

export const REFERRAL_EVENTS = parseAbi([
  "event RootPosted(uint256 indexed epoch,bytes32 root,uint256 total,uint64 claimableAt)",
  "event RootVoided(uint256 indexed epoch,bytes32 root)",
  "event Claimed(address indexed account,uint256 indexed epoch,uint256 amount,uint256 cumulative)",
  "event Paused(address account)",
  "event Unpaused(address account,uint256 indexed extendedEpoch,uint64 newClaimableAt)",
  "event Rescued(address indexed to,uint256 amount)",
]);
export interface ClaimEpoch {
  epoch: number;
  period: string;
  root: Hex;
  totalBase: string;
  claimableAt: number;
  voided: boolean;
}
export interface ClaimSnapshot {
  program: ReferralProgram;
  deploymentBlock: string;
  block: { number: string; hash: Hex; timestamp: number };
  observedAt: string;
  paused: boolean;
  pauseAt: number | null;
  latestPaused: boolean;
  ended: boolean;
  epochs: ClaimEpoch[];
  claimed: Record<string, string>;
}
export interface ClaimCacheRow {
  body: string | null;
  observed_at: string | null;
  error_at: string | null;
}
export interface ClaimCacheEnv extends ReferralAccrualEnv {
  REFERRAL_DB: ReferralD1Database;
  REFERRAL_DEPLOYMENT_BLOCK?: string;
  REFERRAL_DISTRIBUTOR_CODE_HASH?: string;
}
const same = (a: unknown, b: unknown) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.toLowerCase() === b.toLowerCase();

/** Independent read-only projection. Uses finalized headers/receipts, not archive eth_call. */
export async function refreshReferralClaims(
  env: ClaimCacheEnv,
  now = new Date(),
  fetcher: typeof fetch = fetch,
) {
  // No second activation flag. Existing active records remain visible and become stale on failure.
  if (env.REFERRAL_PROGRAM_ENABLED !== "true") return;
  const priorRow = await env.REFERRAL_DB.prepare(
    "SELECT body,observed_at,error_at FROM referral_claim_cache WHERE id='program'",
  ).first<ClaimCacheRow>();
  try {
    const config = parseConfig({ ...env, REFERRAL_ACCRUAL_MODE: "live" });
    const p = config.poster;
    const codeHash = env.REFERRAL_DISTRIBUTOR_CODE_HASH?.toLowerCase();
    const start = env.REFERRAL_DEPLOYMENT_BLOCK;
    if (
      !p ||
      !codeHash ||
      !/^0x[0-9a-f]{64}$/.test(codeHash) ||
      !start ||
      !/^(0|[1-9][0-9]*)$/.test(start)
    )
      throw new Error("Referral deployment evidence is missing");
    const program: ReferralProgram = {
      network: p.network,
      chainId: p.chainId,
      distributor: p.distributor as Hex,
      token: p.token as Hex,
      decimals: config.tokenDecimals,
      codeHash: codeHash as Hex,
    };
    const client = createPublicClient({
      transport: http(p.rpcUrl, {
        fetchFn: fetcher,
        retryCount: 0,
        timeout: 20_000,
      }),
    });
    const finalized = await client.getBlock({ blockTag: "finalized" });
    if (
      finalized.number === null ||
      !finalized.hash ||
      finalized.number < BigInt(start) ||
      (await client.getChainId()) !== p.chainId
    )
      throw new Error("Referral finality unavailable");
    const code = await client.getCode({ address: program.distributor });
    if (!code || keccak256(code) !== codeHash)
      throw new Error("Referral runtime differs");
    if (
      !same(
        await client.readContract({
          address: program.distributor,
          abi: REFERRAL_ABI,
          functionName: "token",
        }),
        program.token,
      ) ||
      (await client.readContract({
        address: program.token,
        abi: parseAbi(["function decimals() view returns (uint8)"]),
        functionName: "decimals",
      })) !== program.decimals
    )
      throw new Error("Referral token differs");
    const prior: ClaimSnapshot | null = priorRow?.body
      ? JSON.parse(priorRow.body)
      : null;
    if (
      prior &&
      (JSON.stringify(prior.program) !== JSON.stringify(program) ||
        prior.deploymentBlock !== start)
    )
      throw new Error("Referral cached deployment differs");
    if (prior) {
      const previous = await client.getBlock({
        blockNumber: BigInt(prior.block.number),
      });
      if (
        previous.hash !== prior.block.hash ||
        finalized.number < BigInt(prior.block.number)
      )
        throw new Error("Referral finalized history differs");
    }
    const snapshot: ClaimSnapshot = prior
      ? structuredClone(prior)
      : {
          program,
          deploymentBlock: start,
          block: {
            number: finalized.number.toString(),
            hash: finalized.hash,
            timestamp: Number(finalized.timestamp),
          },
          observedAt: now.toISOString(),
          paused: false,
          pauseAt: null,
          latestPaused: false,
          ended: false,
          epochs: [],
          claimed: {},
        };
    const from = prior ? BigInt(prior.block.number) + 1n : BigInt(start);
    const logs = await scanReferralLogs(
      p.network,
      from,
      finalized.number,
      (fromBlock, toBlock) =>
        client.getLogs({
          address: program.distributor,
          events: REFERRAL_EVENTS,
          fromBlock,
          toBlock,
          strict: true,
        }),
    );
    logs.sort((a, b) =>
      a.blockNumber === b.blockNumber
        ? a.logIndex - b.logIndex
        : a.blockNumber < b.blockNumber
          ? -1
          : 1,
    );
    for (const log of logs) {
      const receipt = await client.getTransactionReceipt({
        hash: log.transactionHash,
      });
      const block = await client.getBlock({ blockNumber: log.blockNumber });
      if (
        log.removed ||
        log.blockNumber > finalized.number ||
        receipt.status !== "success" ||
        !isCanonicalEvmReceipt(log.transactionHash, receipt, block) ||
        log.blockHash !== block.hash ||
        !receipt.logs.some(
          (l) =>
            l.logIndex === log.logIndex &&
            l.address.toLowerCase() === program.distributor &&
            l.data === log.data &&
            JSON.stringify(l.topics) === JSON.stringify(log.topics),
        )
      )
        throw new Error("Referral event is not canonical");
      const event = decodeEventLog({
        abi: REFERRAL_EVENTS,
        data: log.data,
        topics: log.topics,
      });
      if (event.eventName === "RootPosted") {
        const a = event.args;
        const epoch = Number(a.epoch);
        const journal = await env.REFERRAL_DB.prepare(
          "SELECT p.period,f.merkle_root,f.tree_total_base FROM referral_root_posts p JOIN referral_accrual_files f ON f.period=p.period WHERE p.network=? AND p.distributor=? AND p.token=? AND p.epoch=? AND p.tx_id=? AND p.merkle_root=? AND p.total_base=? AND p.state IN ('submitted','unknown','finalized','voided')",
        )
          .bind(
            p.network,
            p.distributor,
            p.token,
            epoch,
            log.transactionHash.toLowerCase(),
            a.root,
            a.total.toString(),
          )
          .first<{
            period: string;
            merkle_root: string;
            tree_total_base: string;
          }>();
        if (
          !journal ||
          journal.merkle_root !== a.root ||
          journal.tree_total_base !== a.total.toString() ||
          epoch !== snapshot.epochs.length
        )
          throw new Error("Referral root does not match its filed journal");
        snapshot.epochs.push({
          epoch,
          period: journal.period,
          root: a.root,
          totalBase: a.total.toString(),
          claimableAt: Number(a.claimableAt),
          voided: false,
        });
      } else if (event.eventName === "RootVoided") {
        const e = snapshot.epochs[Number(event.args.epoch)];
        if (!e || e.root !== event.args.root)
          throw new Error("Unknown voided root");
        e.voided = true;
      } else if (event.eventName === "Claimed") {
        const a = event.args;
        const wallet = a.account.toLowerCase();
        const previous = BigInt(snapshot.claimed[wallet] ?? "0");
        if (
          !snapshot.epochs[Number(a.epoch)] ||
          a.cumulative - previous !== a.amount ||
          a.amount <= 0n
        )
          throw new Error("Referral claim counter differs");
        snapshot.claimed[wallet] = a.cumulative.toString();
      } else if (event.eventName === "Paused") {
        snapshot.paused = true;
        snapshot.pauseAt = Number(block.timestamp);
      } else if (event.eventName === "Unpaused") {
        const a = event.args;
        if (a.extendedEpoch !== (1n << 256n) - 1n) {
          const e = snapshot.epochs[Number(a.extendedEpoch)];
          if (!e) throw new Error("Unknown extended root");
          e.claimableAt = Number(a.newClaimableAt);
        }
        snapshot.paused = false;
        snapshot.pauseAt = null;
      } else if (event.eventName === "Rescued") snapshot.ended = true;
    }
    snapshot.latestPaused = await client.readContract({
      address: program.distributor,
      abi: REFERRAL_ABI,
      functionName: "paused",
    });
    if (
      (await client.getBlock({ blockNumber: finalized.number })).hash !==
      finalized.hash
    )
      throw new Error("Referral finality changed during refresh");
    snapshot.block = {
      number: finalized.number.toString(),
      hash: finalized.hash,
      timestamp: Number(finalized.timestamp),
    };
    snapshot.observedAt = now.toISOString();
    // Publish the complete projection at once; a concurrent older refresh cannot overwrite it.
    await env.REFERRAL_DB.prepare(
      "INSERT INTO referral_claim_cache(id,body,observed_at,error_at) VALUES('program',?,?,NULL) ON CONFLICT(id) DO UPDATE SET body=excluded.body,observed_at=excluded.observed_at,error_at=NULL WHERE referral_claim_cache.observed_at IS NULL OR referral_claim_cache.observed_at < excluded.observed_at AND CAST(json_extract(referral_claim_cache.body,'$.block.number') AS INTEGER) <= CAST(json_extract(excluded.body,'$.block.number') AS INTEGER)",
    )
      .bind(JSON.stringify(snapshot), snapshot.observedAt)
      .run();
  } catch {
    await env.REFERRAL_DB.prepare(
      "INSERT INTO referral_claim_cache(id,body,observed_at,error_at) VALUES('program',NULL,NULL,?) ON CONFLICT(id) DO UPDATE SET error_at=excluded.error_at WHERE referral_claim_cache.observed_at IS NULL OR referral_claim_cache.observed_at <= excluded.error_at",
    )
      .bind(now.toISOString())
      .run();
    throw new Error("Referral claim refresh failed");
  }
}

/** A paused pending root does not mature while its objection clock is frozen. */
export function activeClaimEpoch(snapshot: ClaimSnapshot) {
  return (
    [...snapshot.epochs]
      .reverse()
      .find(
        (e) =>
          !e.voided &&
          e.claimableAt <= snapshot.block.timestamp &&
          !(
            snapshot.paused &&
            snapshot.pauseAt !== null &&
            e.claimableAt > snapshot.pauseAt
          ),
      ) ?? null
  );
}
