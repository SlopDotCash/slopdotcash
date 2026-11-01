import {
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  keccak256,
  parseAbi,
} from "viem";
import { verifyProof } from "../../workers/referral-accrual/merkle";
import type { PayoutWallet } from "./use-payout-wallets";

export const REFERRAL_CACHE_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const REFERRAL_ABI = parseAbi([
  "function token() view returns (address)",
  "function paused() view returns (bool)",
  "function claimed(address) view returns (uint256)",
  "function currentRoot() view returns (bytes32,uint256,uint256)",
  "function claim(uint256 cumulative,bytes32[] proof)",
]);
export interface ReferralProgram {
  network: "robinhood-mainnet" | "robinhood-testnet";
  chainId: number;
  distributor: Hex;
  token: Hex;
  decimals: number;
  codeHash: Hex;
}
export interface ReferralClaim {
  period: string;
  epoch: number;
  root: Hex;
  cumulativeBase: string;
  proof: Hex[];
}
export interface ReferralAccount {
  enabled: true;
  status: "ready" | "stale" | "unknown";
  program: ReferralProgram | null;
  observedAt: string | null;
  finalizedAt: string | null;
  wallet: string | null;
  accruedBase: string;
  claimedBase: string | null;
  claimableBase: string | null;
  pendingBase: string | null;
  paused: boolean;
  ended: boolean;
  latestVoided: boolean;
  pendingUntil: string | null;
  claim: ReferralClaim | null;
}
export type ReferralResponse = { enabled: false } | ReferralAccount;
const address = (v: unknown): v is Hex =>
  typeof v === "string" && /^0x[0-9a-f]{40}$/.test(v);
const hash = (v: unknown): v is Hex =>
  typeof v === "string" && /^0x[0-9a-f]{64}$/.test(v);
const amount = (v: unknown): v is string =>
  typeof v === "string" &&
  /^(0|[1-9][0-9]{0,77})$/.test(v) &&
  BigInt(v) < 1n << 256n;
// A timestamp that Date.parse accepts is not enough: it silently rolls an
// impossible calendar date forward (2027-02-29 becomes 2027-03-01), so an
// overflow date would pass validation and then shift the 48-hour freshness
// check in reviewReferralClaim. The backend writes these fields with
// toISOString, so an exact round-trip holds for every legitimate record.
const instant = (v: unknown): v is string =>
  typeof v === "string" &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString() === v;

// Observation stamps must sit in a two-sided window: the 48-hour freshness
// check in reviewReferralClaim only bounds age from below, so an unbounded
// future stamp would read as permanently fresh. pendingUntil is exempt: a
// maturity deadline is supposed to sit in the future. Five minutes matches
// the clock-skew tolerance the repo already uses for client-checked
// backend timestamps (backend/security/submissions.ts, backend/trace/handler.ts).
export const REFERRAL_MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const observed = (v: unknown): v is string =>
  instant(v) && Date.parse(v) <= Date.now() + REFERRAL_MAX_FUTURE_SKEW_MS;

export function referralResponse(value: unknown): ReferralResponse {
  const data = value as ReferralResponse;
  if (data?.enabled === false) return { enabled: false };
  if (
    data?.enabled !== true ||
    !["ready", "stale", "unknown"].includes(data.status) ||
    !amount(data.accruedBase) ||
    ![data.claimedBase, data.claimableBase, data.pendingBase].every(
      (v) => v === null || amount(v),
    ) ||
    ![data.paused, data.ended, data.latestVoided].every(
      (v) => typeof v === "boolean",
    ) ||
    ![data.observedAt, data.finalizedAt].every(
      (v) => v === null || observed(v),
    ) ||
    !(data.pendingUntil === null || instant(data.pendingUntil)) ||
    !(data.wallet === null || address(data.wallet))
  )
    throw new Error("Referral rewards could not be verified. Retry.");
  const p = data.program;
  if (
    p !== null &&
    (!address(p.distributor) ||
      !address(p.token) ||
      !hash(p.codeHash) ||
      !Number.isInteger(p.decimals) ||
      p.decimals < 0 ||
      p.decimals > 36 ||
      !(
        (p.network === "robinhood-mainnet" && p.chainId === 4663) ||
        (p.network === "robinhood-testnet" && p.chainId === 46630)
      ))
  )
    throw new Error("Referral program could not be verified.");
  const c = data.claim;
  if (
    c !== null &&
    (!p ||
      !data.wallet ||
      !hash(c.root) ||
      !amount(c.cumulativeBase) ||
      !Number.isSafeInteger(c.epoch) ||
      c.epoch < 0 ||
      !/^\d{4}-\d{2}$/.test(c.period) ||
      !Array.isArray(c.proof) ||
      c.proof.length > 256 ||
      !c.proof.every(hash) ||
      !verifyProof(
        c.root,
        { address: data.wallet, cumulativeBase: BigInt(c.cumulativeBase) },
        c.proof,
      ))
  )
    throw new Error("Referral claim proof could not be verified.");
  if (
    data.status === "ready" &&
    (!p ||
      !data.observedAt ||
      !data.finalizedAt ||
      data.claimedBase === null ||
      data.claimableBase === null ||
      data.pendingBase === null)
  )
    throw new Error("Referral claim state is incomplete.");
  return data;
}

type Connection = Awaited<ReturnType<PayoutWallet["connect"]>>;
/** Runs only after the user selects Review. No page-view RPC and no signature. */
export async function reviewReferralClaim(
  data: ReferralAccount,
  wallet: Connection,
) {
  const { program: p, claim: c } = data;
  if (
    data.status !== "ready" ||
    data.paused ||
    data.ended ||
    !p ||
    !c ||
    !data.wallet ||
    !data.observedAt ||
    Date.now() - Date.parse(data.observedAt) > REFERRAL_CACHE_MAX_AGE_MS ||
    !data.finalizedAt ||
    Date.now() - Date.parse(data.finalizedAt) > REFERRAL_CACHE_MAX_AGE_MS ||
    !data.claimableBase ||
    BigInt(data.claimableBase) === 0n
  )
    throw new Error(
      "A current claimable reward is required. Refresh the record.",
    );
  const request = wallet.evmRequest;
  if (!request || wallet.address.toLowerCase() !== data.wallet)
    throw new Error("Choose the referral wallet shown in this record.");
  const accounts = await request("eth_accounts", []);
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== "string" ||
    accounts[0].toLowerCase() !== data.wallet
  )
    throw new Error("The wallet account changed. Connect and review again.");
  const chain = await request("eth_chainId", []);
  if (
    typeof chain !== "string" ||
    !/^0x[0-9a-f]+$/i.test(chain) ||
    BigInt(chain) !== BigInt(p.chainId)
  )
    throw new Error(
      `Switch your wallet to ${p.network === "robinhood-mainnet" ? "Robinhood Chain" : "Robinhood Chain Testnet"}, then review again.`,
    );
  const code = await request("eth_getCode", [p.distributor, "latest"]);
  if (
    typeof code !== "string" ||
    !/^0x[0-9a-f]+$/i.test(code) ||
    keccak256(code as Hex) !== p.codeHash
  )
    throw new Error("The referral contract could not be verified.");
  const read = async (name: "token" | "paused" | "currentRoot") => {
    const value = await request("eth_call", [
      {
        to: p.distributor,
        data: encodeFunctionData({ abi: REFERRAL_ABI, functionName: name }),
      },
      "latest",
    ]);
    if (typeof value !== "string") throw new Error("Wallet read failed.");
    return decodeFunctionResult({
      abi: REFERRAL_ABI,
      functionName: name,
      data: value as Hex,
    });
  };
  if (
    String(await read("token")).toLowerCase() !== p.token ||
    (await read("paused")) !== false
  )
    throw new Error(
      "Claims are paused or the token differs. Refresh the record.",
    );
  const root = await read("currentRoot");
  if (!Array.isArray(root) || root[0] !== c.root || root[2] !== BigInt(c.epoch))
    throw new Error("The claim root changed. Refresh and review again.");
  const claimedData = await request("eth_call", [
    {
      to: p.distributor,
      data: encodeFunctionData({
        abi: REFERRAL_ABI,
        functionName: "claimed",
        args: [data.wallet as Hex],
      }),
    },
    "latest",
  ]);
  const claimed = decodeFunctionResult({
    abi: REFERRAL_ABI,
    functionName: "claimed",
    data: claimedData as Hex,
  });
  if ((BigInt(c.cumulativeBase) - claimed).toString() !== data.claimableBase)
    throw new Error(
      "The claim amount changed. Wait for the verified record to refresh.",
    );
  const transaction = {
    from: data.wallet,
    to: p.distributor,
    value: "0x0",
    data: encodeFunctionData({
      abi: REFERRAL_ABI,
      functionName: "claim",
      args: [BigInt(c.cumulativeBase), c.proof],
    }),
  };
  await request("eth_call", [transaction, "latest"]);
  await request("eth_estimateGas", [transaction]);
  return transaction;
}

/** Explicit second user action. Recheck the reviewed amount; never retry a send. */
export async function sendReferralClaim(
  data: ReferralAccount,
  wallet: Connection,
  beforeSend: () => void,
) {
  const transaction = await reviewReferralClaim(data, wallet);
  const accounts = await wallet.evmRequest?.("eth_accounts", []);
  const chain = await wallet.evmRequest?.("eth_chainId", []);
  if (
    !Array.isArray(accounts) ||
    typeof accounts[0] !== "string" ||
    accounts[0].toLowerCase() !== data.wallet ||
    typeof chain !== "string" ||
    !/^0x[0-9a-f]+$/i.test(chain) ||
    BigInt(chain) !== BigInt(data.program?.chainId ?? 0)
  )
    throw new Error("The wallet account or network changed. Review again.");
  beforeSend();
  const result = await wallet.evmRequest?.("eth_sendTransaction", [
    transaction,
  ]);
  if (typeof result !== "string" || !/^0x[0-9a-f]{64}$/i.test(result))
    throw new Error(
      "The wallet returned no transaction hash. Check wallet activity before another attempt.",
    );
  return result;
}
