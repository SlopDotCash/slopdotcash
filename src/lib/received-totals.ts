/** All-time money received, as published by GET /api/v1/payments/received. */
import { ESCROW_NETWORKS } from "./escrow-policy.mjs";
import { CANONICAL_UINT } from "./record-validation.mjs";

/** One contributor's all-time receipts in micro-dollars (USDC base units). */
export interface ReceivedContributor {
  githubUserId: string;
  login: string | null;
  usdMicro: string;
  directMicro: string;
  vaultUsdMicro: string;
  directTransfers: number;
  vaultPayments: number;
  projects: { projectId: string; usdMicro: string }[];
}
export interface ReceivedTotals {
  generatedAt: string;
  contributors: ReceivedContributor[];
  totals: {
    usdMicro: string;
    directTransfers: number;
    vaultPayments: number;
    contributors: number;
  };
}
const money = (v: unknown) => typeof v === "string" && CANONICAL_UINT.test(v);
const count = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0;

export function isReceivedTotals(value: unknown): value is ReceivedTotals {
  const v = value as ReceivedTotals | null;
  return (
    !!v &&
    typeof v.generatedAt === "string" &&
    Number.isFinite(Date.parse(v.generatedAt)) &&
    !!v.totals &&
    money(v.totals.usdMicro) &&
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
        ),
    ) &&
    v.contributors.reduce((sum, c) => sum + BigInt(c.usdMicro), 0n) ===
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
