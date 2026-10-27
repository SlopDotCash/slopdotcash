/** Idempotent authorization for the ordinary monthly allocation, never a payment key. */
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { recoverAddress } from "viem";
import {
  type MonthlyAttestationPlan,
  type MonthlyAttestationRequest,
  prepareMonthlyAttestation,
} from "../../backend/payments/monthly-attestation";
import {
  type EvmMonthlyReservation,
  evmMonthlyReserveDigest,
  type MonthlyAllocationEntry,
} from "../../contracts/evm/adapter";
import { decodeBase58Bytes } from "../../src/lib/base58";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import type { JournalStore } from "./core";

export interface MonthlyAuthorization {
  plan: MonthlyAttestationPlan;
  /** Hex-encoded signature, without 0x. Public authorization; no private key. */
  signatureHex: string;
  /** Original independently signed V1 evidence. A pending legacy transaction
   * can still win admission after V2 publication; retain it for reconciliation. */
  legacyAuthorization?: {
    plan: MonthlyAttestationPlan;
    signatureHex: string;
  };
}
interface Intent {
  snapshotSha256: string;
  messageHex: string;
  authority: string;
  /** Solana: the observed freeze time, reused if signing is interrupted. */
  frozenAt?: string;
  authorization?: MonthlyAuthorization;
}
const bytes = (hex: string) => {
  if (!/^(?:[a-f0-9]{2})+$/.test(hex))
    throw new Error("Invalid authorization encoding");
  return hexToBytes(hex);
};

/**
 * Called through the attester's serialized Durable Object. The intent is saved
 * before invoking its signer: interrupted requests may sign the same bytes but
 * can never replace a month's root. Its owner authorizes on-chain admission;
 * subsequent leaf processing remains permissionless.
 */
export async function signMonthlyAllocation(
  deps: Omit<Parameters<typeof prepareMonthlyAttestation>[0], "now"> & {
    now(): Date;
    journal: JournalStore;
    /** Verify finalized chain identity, reviewed code and current authority. */
    verifyDeployment(plan: MonthlyAttestationPlan): Promise<void>;
    /** Sign the EVM digest directly (not personal_sign), or the Solana message. */
    sign(plan: MonthlyAttestationPlan): Promise<string>;
    /** Solana: at one finalized slot, prove that no included source has an
     * `origin` or `monthly-source` account and return that slot's block time. */
    freeze?(plan: MonthlyAttestationPlan): Promise<string>;
    /** EVM V2: observe remaining sources and admission at one finalized block.
     * Null is only a proven legacy vault; an admitted root refuses a new attempt. */
    reserve?(plan: MonthlyAttestationPlan): Promise<{
      reservation: EvmMonthlyReservation;
      entries: MonthlyAllocationEntry[];
    } | null>;
  },
  request: MonthlyAttestationRequest,
): Promise<MonthlyAuthorization> {
  const prepare = async (frozenAt?: string) => {
    let prepared = await prepareMonthlyAttestation(
      { ...deps, now: deps.now() },
      request,
      frozenAt,
      !!deps.reserve,
    );
    if (prepared.family !== "evm" || !deps.reserve) return prepared;
    const attempt = await deps.reserve(prepared);
    if (!attempt)
      return prepareMonthlyAttestation({ ...deps, now: deps.now() }, request);
    if (
      attempt.reservation.allocationDigest !== `0x${request.snapshotSha256}` ||
      attempt.reservation.wholeGross !== prepared.totalGrossBase
    )
      throw new Error(
        "Monthly execution attempt changed the frozen allocation",
      );
    const chainId = ESCROW_NETWORKS[request.network].chainId;
    if (!chainId) throw new Error("EVM chain identity is missing");
    prepared = {
      ...prepared,
      evmReservation: attempt.reservation,
      entries: attempt.entries.map((entry) => ({
        ...entry,
        grossMicro: String(entry.grossMicro),
      })),
      allocationRoot: attempt.reservation.allocationRoot,
      messageHex: evmMonthlyReserveDigest(
        BigInt(chainId),
        prepared.deployment.vault,
        request.period,
        attempt.reservation,
      ).slice(2),
    };
    return prepared;
  };
  let plan = await prepare();
  await deps.verifyDeployment(plan);
  const monthKey = `monthly:${request.network}:${plan.deployment.vault}:${request.period}`;
  const key = plan.evmReservation
    ? `${monthKey}:v2:${plan.evmReservation.sourceSequence}`
    : monthKey;
  if (plan.family === "solana") {
    // The release path is refund-free only if frozen_at is a time at which no
    // included source was consumed. A recorded freeze stays true: origins are
    // never closed, so a source absent at that slot was absent before it.
    const previous = await deps.journal.get<Intent>(key);
    let frozenAt = previous?.frozenAt;
    if (!frozenAt) {
      if (!deps.freeze) throw new Error("Solana freeze observer unavailable");
      frozenAt = await deps.freeze(plan);
    }
    plan = await prepareMonthlyAttestation(
      { ...deps, now: deps.now() },
      request,
      frozenAt,
    );
  }
  const expected: Intent = {
    snapshotSha256: request.snapshotSha256,
    messageHex: plan.messageHex,
    authority: plan.deployment.identityAuthority,
    ...(plan.frozenAt ? { frozenAt: plan.frozenAt } : {}),
  };
  const intent = await deps.journal.transaction(async (tx) => {
    if (plan.evmReservation) {
      // A new source sequence can change execution inputs, never the frozen
      // allocation. Preserve a legacy intent and every V2 signed attempt.
      const bindingKey = `${monthKey}:allocation`;
      for (const binding of [
        await tx.get<Intent>(monthKey),
        await tx.get<{ snapshotSha256: string }>(bindingKey),
      ])
        if (binding && binding.snapshotSha256 !== request.snapshotSha256)
          throw new Error(
            "Monthly authorization already bound to another allocation",
          );
      await tx.put(bindingKey, { snapshotSha256: request.snapshotSha256 });
    }
    const previous = await tx.get<Intent>(key);
    if (previous) {
      if (
        previous.snapshotSha256 !== expected.snapshotSha256 ||
        previous.messageHex !== expected.messageHex ||
        previous.authority !== expected.authority
      )
        throw new Error(
          "Monthly authorization already bound to another allocation or authority",
        );
      return previous;
    }
    await tx.put(key, expected);
    return expected;
  });
  if (intent.authorization) return intent.authorization;
  const signatureHex = await deps.sign(plan);
  const signature = bytes(signatureHex);
  if (plan.family === "evm") {
    if (
      signature.length !== 65 ||
      (
        await recoverAddress({
          hash: `0x${plan.messageHex}`,
          signature: `0x${signatureHex}`,
        })
      ).toLowerCase() !== expected.authority.toLowerCase()
    )
      throw new Error(
        "Monthly signature does not match the reviewed authority",
      );
  } else if (
    signature.length !== 64 ||
    !ed25519.verify(
      signature,
      bytes(plan.messageHex),
      decodeBase58Bytes(expected.authority),
    )
  ) {
    throw new Error("Monthly signature does not match the reviewed authority");
  }
  // A slow signer must not publish after a restriction or opt-out was observed.
  const current = await prepare(plan.frozenAt);
  if (
    current.messageHex !== plan.messageHex ||
    current.deployment.identityAuthority !== expected.authority
  )
    throw new Error("Monthly authorization changed during signing");
  const authorization = { plan, signatureHex };
  await deps.journal.put(key, { ...intent, authorization });
  return authorization;
}
