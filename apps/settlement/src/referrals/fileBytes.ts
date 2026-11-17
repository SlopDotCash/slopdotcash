// spec/settlement/referralAccrual.md, "Filed records, first-use wallet pins and exact roots commit atomically"; spec/settlement/referralPublication.md, "The next immutable filed tree supplies every root entry"
import type { Hex } from "viem";
import { buildTree } from "./merkle.ts";

export const FILE_SCHEMA = "slop-referral-accrual-file-v1";
export const RULE_VERSION = "referral-accrual-v1";
export const CLAIM_CHAIN = "robinhood";
const LEAF_RULE = "keccak256(bytes.concat(keccak256(abi.encode(address,uint256 cumulativeBase))))";

export type FileMode = "dry_run" | "live";

export interface FileParameters {
  readonly rateBasePerMicro: string;
  readonly tokenDecimals: number;
  readonly poolBase: string;
  readonly projectCapBase: string;
  readonly windowMonths: number;
}

export interface FileAccrual {
  readonly obligationId: string;
  readonly projectId: string;
  readonly referrerGithubId: string;
  readonly referrerGithubLogin: string;
  readonly network: string;
  readonly paidTransaction: string;
  readonly paidObservedAt: string;
  readonly grossBase: string;
  readonly assetAddress: string;
  readonly assetSymbol: string;
  readonly computedBase: string;
  readonly accruedBase: string;
  readonly outcome: string;
  readonly reason: string | null;
}

export interface ReferrerTotal {
  readonly githubId: string;
  readonly githubLogin: string;
  readonly cumulativeBase: bigint;
  readonly wallet: string | null;
}

export interface FileInput {
  readonly period: string;
  readonly epoch: number;
  readonly mode: FileMode;
  readonly generatedAt: string;
  readonly runId: string;
  readonly parameters: FileParameters;
  readonly accruals: ReadonlyArray<FileAccrual>;
  readonly poolAccruedBase: bigint;
  readonly referrers: ReadonlyArray<ReferrerTotal>;
}

export interface AssembledFile {
  readonly body: string;
  readonly merkleRoot: Hex | null;
  readonly treeTotalBase: string;
  readonly leafCount: number;
}

/** @throws {TypeError | RangeError} */
export function assembleFile(input: FileInput): AssembledFile {
  const leaves = input.referrers.flatMap((referrer) => (referrer.wallet === null ? [] : [{ address: referrer.wallet, cumulativeBase: referrer.cumulativeBase }]));
  const tree = buildTree(leaves);
  const proofs = new Map((tree?.leaves ?? []).map((leaf) => [leaf.address, { hash: leaf.hash, proof: leaf.proof }]));
  const treeTotal = leaves.reduce((sum, leaf) => sum + leaf.cumulativeBase, 0n);
  const referrers = input.referrers.map((referrer) => {
    const leaf = referrer.wallet === null ? undefined : proofs.get(referrer.wallet);
    const base = { githubId: referrer.githubId, githubLogin: referrer.githubLogin, cumulativeBase: referrer.cumulativeBase.toString(), wallet: referrer.wallet };
    return leaf === undefined ? base : { ...base, leaf };
  });
  const body = JSON.stringify(
    {
      schema: FILE_SCHEMA,
      ruleVersion: RULE_VERSION,
      period: input.period,
      epoch: input.epoch,
      mode: input.mode,
      generatedAt: input.generatedAt,
      runId: input.runId,
      parameters: {
        rateBasePerMicro: input.parameters.rateBasePerMicro,
        tokenDecimals: input.parameters.tokenDecimals,
        poolBase: input.parameters.poolBase,
        projectCapBase: input.parameters.projectCapBase,
        windowMonths: input.parameters.windowMonths,
        claimChain: CLAIM_CHAIN,
      },
      accruals: input.accruals.map((row) => ({
        obligationId: row.obligationId,
        projectId: row.projectId,
        referrerGithubId: row.referrerGithubId,
        referrerGithubLogin: row.referrerGithubLogin,
        network: row.network,
        paidTransaction: row.paidTransaction,
        paidObservedAt: row.paidObservedAt,
        grossBase: row.grossBase,
        assetAddress: row.assetAddress,
        assetSymbol: row.assetSymbol,
        computedBase: row.computedBase,
        accruedBase: row.accruedBase,
        outcome: row.outcome,
        reason: row.reason,
      })),
      totals: {
        poolAccruedBase: input.poolAccruedBase.toString(),
        treeTotalBase: treeTotal.toString(),
      },
      referrers,
      merkle: tree === null ? null : { leaf: LEAF_RULE, pairs: "sorted", root: tree.root, leafCount: tree.leaves.length },
    },
    null,
    2,
  );
  return { body, merkleRoot: tree === null ? null : tree.root, treeTotalBase: treeTotal.toString(), leafCount: tree === null ? 0 : tree.leaves.length };
}
