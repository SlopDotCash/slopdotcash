/** Public observation only. The deployed canonical manifest is the review authority. */
import { verifyCommitmentSquads } from "../../scripts/verify-commitment-squads";
import {
  assertFundingCommitments,
  type SquadsV4VaultInstrument,
} from "../../src/lib/funding-instruments.mjs";
import { findProject } from "../../src/lib/projects.mjs";
import { SOLANA_MAINNET_USDC_MINT } from "../../src/lib/settlement-plan";
import { deriveVaultUsdcTokenAccount } from "../../src/lib/squads-funding";
import {
  type VerificationAdmission,
  verificationAdmissionUnavailable,
} from "./verification-admission";

export interface FundingVerificationResponse {
  schemaVersion: 1;
  projectId: string;
  cycleId: string;
  state: "verified-on-chain";
  instrument: SquadsV4VaultInstrument & { tokenAccount: string; mint: string };
  balanceMinor: string;
  declaredCommitmentMinor: string;
  coversCommitment: boolean;
  observedAt: string;
  finality: "finalized";
  slot: number;
  accessibility: "unknown";
  paymentReady: false;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

export async function readFundingVerification(
  request: Request,
  projectId: string,
  cycleId: string,
  admit: VerificationAdmission = async () => verificationAdmissionUnavailable(),
): Promise<Response> {
  if (new URL(request.url).search !== "") {
    return json(400, {
      error: "invalid_request",
      message: "Query parameters are not supported",
    });
  }
  const project = findProject(projectId);
  if (
    !project ||
    project.id !== projectId ||
    !/^\d{4}-(0[1-9]|1[0-2])$/u.test(cycleId)
  ) {
    return json(404, {
      error: "funding_instrument_not_found",
      message:
        "No reviewed active Squads instrument for this project and cycle",
    });
  }
  let instruments: readonly SquadsV4VaultInstrument[];
  try {
    instruments = assertFundingCommitments(
      project.funding.commitments ?? [],
    ).filter(
      (item): item is SquadsV4VaultInstrument =>
        item.kind === "squads-v4-vault" &&
        item.monthlyCommitment?.cycleId === cycleId &&
        item.replacedAt === null,
    );
  } catch {
    return json(503, {
      error: "funding_manifest_invalid",
      message: "Canonical funding manifest is invalid",
      accessibility: "unknown",
      paymentReady: false,
    });
  }
  if (instruments.length !== 1) {
    return json(404, {
      error: "funding_instrument_not_found",
      message:
        "No reviewed active Squads instrument for this project and cycle",
    });
  }
  const instrument = instruments[0];
  try {
    const denied = await admit();
    if (denied) return denied;
    const tokenAccount = await deriveVaultUsdcTokenAccount(instrument.vault);
    const verified = await verifyCommitmentSquads({
      mode: "state",
      multisig: instrument.multisig,
      vault: instrument.vault,
      vaultIndex: instrument.vaultIndex,
      funderMember: instrument.funderMember,
      stewardMember: instrument.stewardMember,
      tokenAccount,
    });
    if (verified.mode !== "state")
      throw new TypeError("Unexpected verification mode");
    const balance = BigInt(verified.balanceMinor);
    const commitment = BigInt(instrument.monthlyCommitment?.amountMinor ?? "0");
    const body: FundingVerificationResponse = {
      schemaVersion: 1,
      projectId,
      cycleId,
      state: "verified-on-chain",
      instrument: {
        ...instrument,
        tokenAccount,
        mint: SOLANA_MAINNET_USDC_MINT,
      },
      balanceMinor: verified.balanceMinor,
      declaredCommitmentMinor: commitment.toString(),
      coversCommitment: balance >= commitment,
      observedAt: verified.verifier.checkedAt,
      finality: "finalized",
      slot: verified.slot,
      accessibility: "unknown",
      paymentReady: false,
    };
    return json(200, body);
  } catch {
    return json(503, {
      error: "funding_verification_unavailable",
      message: "Finalized vault state could not be verified by RPC quorum",
      accessibility: "unknown",
      paymentReady: false,
    });
  }
}
