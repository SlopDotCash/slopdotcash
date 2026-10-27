/** Shared verification of the exact monthly allocation an owner is asked to reserve. */
import { ed25519 } from "@noble/curves/ed25519.js";
import { hexToBytes } from "@noble/hashes/utils.js";
import { recoverAddress } from "viem";
import { decodeBase58Bytes } from "../src/lib/base58";
import { bytesToHex } from "../src/lib/byte-encoding";
import { canonicalJson } from "../src/lib/canonical-json";
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
} from "../src/lib/escrow-policy.mjs";
import type { MonthlyAuthorization } from "../workers/payment-executor/monthly";
import {
  evmAllocationRoot,
  evmMonthlyDigest,
  evmMonthlyReserveDigest,
} from "./evm/adapter";
import { evmMonthlySumTree } from "./evm/monthly-reserve";
import {
  solanaAllocationRoot,
  solanaAllocationTotal,
  solanaMonthlyMessage,
} from "./solana/adapter";

export interface MonthlyFinalizationExpected {
  projectId: string;
  period: string;
  snapshotSha256: string;
  deployment: EscrowDeployment;
}

export async function verifyMonthlyOwnerAuthorization(
  authorization: MonthlyAuthorization,
  expected: MonthlyFinalizationExpected,
) {
  const plan = authorization?.plan;
  if (
    !plan ||
    !/^[a-f0-9]{64}$/.test(expected.snapshotSha256) ||
    plan.request.projectId !== expected.projectId ||
    plan.request.period !== expected.period ||
    plan.request.snapshotSha256 !== expected.snapshotSha256 ||
    plan.request.network !== expected.deployment.network ||
    canonicalJson(plan.deployment) !== canonicalJson(expected.deployment) ||
    plan.family !== ESCROW_NETWORKS[expected.deployment.network].family ||
    !/^[1-9][0-9]*$/.test(plan.totalGrossBase) ||
    !Array.isArray(plan.entries)
  )
    throw new Error(
      "The monthly authorization differs from the reviewed allocation.",
    );
  let message: string;
  const network = ESCROW_NETWORKS[expected.deployment.network];
  if (plan.family === "evm") {
    if (!network.chainId) throw new Error("Missing monthly chain identity.");
    if (plan.evmReservation) {
      const reservation = plan.evmReservation;
      const tree = evmMonthlySumTree(plan.entries);
      if (
        reservation.version !== 2 ||
        reservation.allocationDigest !== `0x${expected.snapshotSha256}` ||
        reservation.wholeGross !== plan.totalGrossBase ||
        reservation.allocationRoot !== plan.allocationRoot ||
        tree.hash !== plan.allocationRoot ||
        tree.total.toString() !== reservation.remainingGross ||
        reservation.count !== plan.entries.length ||
        BigInt(reservation.remainingGross) > BigInt(reservation.wholeGross)
      )
        throw new Error(
          "The monthly reservation does not match its allocation.",
        );
      message = evmMonthlyReserveDigest(
        BigInt(network.chainId),
        plan.deployment.vault,
        expected.period,
        reservation,
      ).slice(2);
    } else {
      if (
        evmAllocationRoot(plan.entries) !== plan.allocationRoot ||
        plan.entries
          .reduce((sum, entry) => sum + BigInt(entry.grossMicro), 0n)
          .toString() !== plan.totalGrossBase
      )
        throw new Error("The monthly awards do not match their allocation.");
      message = evmMonthlyDigest(
        BigInt(network.chainId),
        plan.deployment.vault,
        expected.period,
        plan.allocationRoot,
      ).slice(2);
    }
    if (
      message !== plan.messageHex ||
      !/^[a-f0-9]{130}$/.test(authorization.signatureHex) ||
      (
        await recoverAddress({
          hash: `0x${message}`,
          signature: `0x${authorization.signatureHex}`,
        })
      ).toLowerCase() !== plan.deployment.identityAuthority.toLowerCase()
    )
      throw new Error("The monthly authority signature is invalid.");
  } else {
    const { programId, projectPda, networkDomain } = plan.deployment;
    if (!programId || !projectPda || !networkDomain || !plan.frozenAt)
      throw new Error("The Solana monthly identity is incomplete.");
    const root = solanaAllocationRoot(plan.entries);
    const total = solanaAllocationTotal(plan.entries);
    if (root !== plan.allocationRoot || total !== plan.totalGrossBase)
      throw new Error("The monthly awards do not match their allocation.");
    const signed = solanaMonthlyMessage(
      programId,
      projectPda,
      expected.period,
      root,
      total,
      plan.frozenAt,
      networkDomain,
    );
    if (
      bytesToHex(signed) !== plan.messageHex ||
      !/^[a-f0-9]{128}$/.test(authorization.signatureHex) ||
      !ed25519.verify(
        hexToBytes(authorization.signatureHex),
        signed,
        decodeBase58Bytes(plan.deployment.identityAuthority),
        { zip215: false },
      )
    )
      throw new Error("The monthly authority signature is invalid.");
  }
  return authorization;
}
