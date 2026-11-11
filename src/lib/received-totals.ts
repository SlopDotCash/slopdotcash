/** All-time money received, as published by GET /api/v1/payments/received. */
import { ESCROW_NETWORKS } from "./escrow-policy.mjs";
import { CANONICAL_UINT } from "./record-validation.mjs";
import { sumAmounts } from "./verified-allocation";

/** One contributor's all-time finalized receipts, in exact base units. */
export interface ReceivedContributor {
  githubUserId: string;
  login: string | null;
  /** Disclosed direct USDC transfers plus finalized USD-stablecoin vault payments. */
  usdMicro: string;
  directMicro: string;
  vaultUsdMicro: string;
  directTransfers: number;
  vaultPayments: number;
  /** The same dollar receipts by project, largest first. */
  projects: { projectId: string; usdMicro: string }[];
  /** Finalized vault payments in other assets, never converted to dollars. */
  otherAssets: {
    network: string;
    assetAddress: string;
    assetDecimals: number;
    netBase: string;
  }[];
}
/** The D1 aggregate behind the endpoint; the handler adds `generatedAt`. */
export interface ReceivedTotalsRecord {
  schemaVersion: "1";
  contributors: ReceivedContributor[];
  totals: {
    usdMicro: string;
    directMicro: string;
    vaultUsdMicro: string;
    directTransfers: number;
    vaultPayments: number;
    contributors: number;
  };
}
export interface ReceivedTotals extends ReceivedTotalsRecord {
  generatedAt: string;
}
const money = (v: unknown) => typeof v === "string" && CANONICAL_UINT.test(v);
const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;

export function isReceivedTotals(value: unknown): value is ReceivedTotals {
  const v = value as ReceivedTotals | null;
  return (
    !!v &&
    v.schemaVersion === "1" &&
    typeof v.generatedAt === "string" &&
    Number.isFinite(Date.parse(v.generatedAt)) &&
    !!v.totals &&
    money(v.totals.usdMicro) &&
    money(v.totals.directMicro) &&
    money(v.totals.vaultUsdMicro) &&
    count(v.totals.directTransfers) &&
    count(v.totals.vaultPayments) &&
    count(v.totals.contributors) &&
    Array.isArray(v.contributors) &&
    v.contributors.length === v.totals.contributors &&
    v.contributors.every(
      (c) =>
        !!c &&
        /^[1-9]\d{0,15}$/u.test(c.githubUserId) &&
        (c.login === null || typeof c.login === "string") &&
        money(c.usdMicro) &&
        money(c.directMicro) &&
        money(c.vaultUsdMicro) &&
        BigInt(c.directMicro) + BigInt(c.vaultUsdMicro) ===
          BigInt(c.usdMicro) &&
        count(c.directTransfers) &&
        count(c.vaultPayments) &&
        Array.isArray(c.projects) &&
        c.projects.every(
          (p) => !!p && typeof p.projectId === "string" && money(p.usdMicro),
        ) &&
        Array.isArray(c.otherAssets) &&
        c.otherAssets.every(
          (a) =>
            !!a &&
            typeof a.network === "string" &&
            typeof a.assetAddress === "string" &&
            Number.isSafeInteger(a.assetDecimals) &&
            money(a.netBase),
        ),
    ) &&
    sumAmounts(v.contributors.map((c) => BigInt(c.usdMicro))) ===
      BigInt(v.totals.usdMicro)
  );
}

/**
 * A USD stablecoin is one of the network's reviewed reference assets with six
 * decimals, so its base units are micro-dollars. Testnet receipts count only
 * outside production, where staging pays in testnet stablecoins.
 */
export function isUsdMicroAsset(
  network: string,
  assetAddress: string,
  assetDecimals: number,
  includeTestnets: boolean,
): boolean {
  const definition = (
    ESCROW_NETWORKS as Record<
      string,
      | {
          testnet: boolean;
          assets: readonly { address: string; decimals: number }[];
        }
      | undefined
    >
  )[network];
  if (!definition || (definition.testnet && !includeTestnets)) return false;
  const evm = assetAddress.startsWith("0x");
  return definition.assets.some(
    (reference) =>
      reference.decimals === 6 &&
      assetDecimals === 6 &&
      (evm
        ? reference.address.toLowerCase() === assetAddress.toLowerCase()
        : reference.address === assetAddress),
  );
}
