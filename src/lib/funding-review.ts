/** Local proposals preserve the census. Only published cycle records establish approval. */
import type { CycleIndexEntry } from "./cycle-index";
import type { ProjectCommitmentRecord } from "./funding-commitment";
import type { SquadsV4VaultInstrument } from "./funding-instruments.mjs";
import { feeForPrincipal } from "./rewards";
import { SOLANA_MAINNET_USDC_MINT } from "./settlement-plan";

export type ReviewDecision = "include" | "exclude";
export interface ReviewAdjustment {
  actorId: string;
  decision: ReviewDecision;
  amountMinor: string;
  reason: string;
}
export interface ReviewRecipient {
  actor: { id: string; login: string };
  simulatedMinor: string;
}
export function parseUsdc(value: string): string {
  if (!/^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/.test(value))
    throw new TypeError("Enter a USDC amount with at most six decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return (
    BigInt(whole) * 1_000_000n +
    BigInt(fraction.padEnd(6, "0"))
  ).toString();
}
export function displayUsdc(value: string): string {
  const minor = BigInt(value);
  const fraction = (minor % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${minor / 1_000_000n}${fraction ? `.${fraction}` : ""}`;
}
export function formatUsdc(value: string): string {
  const [whole, fraction] = displayUsdc(value).split(".");
  return `${BigInt(whole).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}
export function prepareReviewAdjustments(
  recipients: readonly ReviewRecipient[],
  adjustments: readonly ReviewAdjustment[],
  capMinor: string,
) {
  const byActor = new Map(adjustments.map((row) => [row.actorId, row]));
  if (
    byActor.size !== adjustments.length ||
    adjustments.some((a) => !recipients.some((r) => r.actor.id === a.actorId))
  )
    throw new TypeError("Review contains a duplicate or unknown contributor.");
  const rows = recipients.map((recipient) => {
    const adjustment = byActor.get(recipient.actor.id);
    const amountMinor =
      adjustment?.decision === "exclude"
        ? "0"
        : (adjustment?.amountMinor ?? recipient.simulatedMinor);
    if (!/^(0|[1-9]\d{0,19})$/.test(amountMinor))
      throw new TypeError("Invalid exact USDC amount.");
    const changed =
      amountMinor !== recipient.simulatedMinor ||
      adjustment?.decision === "exclude";
    if (changed && !adjustment?.reason.trim())
      throw new TypeError(
        `Add a public reason for ${recipient.actor.login}'s change.`,
      );
    if (adjustment && !["include", "exclude"].includes(adjustment.decision))
      throw new TypeError("Invalid review decision.");
    return {
      actor: recipient.actor,
      suggestedMinor: recipient.simulatedMinor,
      proposedMinor: amountMinor,
      decision: adjustment?.decision ?? "include",
      reason: adjustment?.reason.trim() ?? "",
    };
  });
  const totalMinor = rows.reduce(
    (sum, row) => sum + BigInt(row.proposedMinor),
    0n,
  );
  if (totalMinor > BigInt(capMinor))
    throw new TypeError("Proposed awards exceed this month's cap.");
  return {
    rows,
    totalMinor: totalMinor.toString(),
    unallocatedMinor: (BigInt(capMinor) - totalMinor).toString(),
    maximumFeeMinor: feeForPrincipal(totalMinor.toString(), 100),
  };
}
/** Net verified ledger value is not a live balance or a signer-access claim. */
export function reviewedVaultFunding(
  projectId: string,
  vault: SquadsV4VaultInstrument,
  records: readonly ProjectCommitmentRecord[],
) {
  const superseded = new Set(
    records.flatMap((r) => (r.supersedes ? [r.supersedes] : [])),
  );
  const matching = records.filter(
    (r) =>
      r.projectId === projectId &&
      !superseded.has(r.recordId) &&
      r.network === "solana" &&
      "vault" in r.instrument &&
      r.instrument.vault === vault.vault &&
      r.instrument.multisig === vault.multisig &&
      r.instrument.vaultIndex === vault.vaultIndex &&
      r.instrument.funderMember === vault.funderMember &&
      r.instrument.stewardMember === vault.stewardMember,
  );
  const verified = matching.filter((r) => r.state === "verified-on-chain");
  const net = verified.reduce(
    (sum, r) =>
      sum + (r.event === "deposit" ? 1n : -1n) * BigInt(r.amountMinor),
    0n,
  );
  if (net < 0n)
    throw new TypeError("Verified vault releases exceed recorded deposits.");
  return { netMinor: net.toString(), records: matching };
}
export function walletLockLabel(
  cycle: CycleIndexEntry | undefined,
  actorId: string,
): string {
  const row = cycle?.contributors.find((c) => c.actor.id === actorId);
  if (!row) return "Not locked";
  if (!row.wallet) return "Unclaimed — no locked wallet";
  return `Locked for ${cycle?.cycleId}`;
}

export interface LiveVaultObservation {
  projectId: string;
  cycleId: string;
  balanceMinor: string;
  observedAt: string;
  coversCommitment: boolean;
  slot: number;
}
export function assertLiveVaultObservation(
  value: unknown,
  projectId: string,
  cycleId: string,
  instrument: SquadsV4VaultInstrument,
): LiveVaultObservation {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Invalid vault observation.");
  const v = value as Record<string, unknown>;
  const i = v.instrument as Record<string, unknown> | undefined;
  if (
    v.schemaVersion !== 1 ||
    v.projectId !== projectId ||
    v.cycleId !== cycleId ||
    v.state !== "verified-on-chain" ||
    v.finality !== "finalized" ||
    v.accessibility !== "unknown" ||
    v.paymentReady !== false ||
    !i ||
    i.multisig !== instrument.multisig ||
    i.vault !== instrument.vault ||
    i.vaultIndex !== instrument.vaultIndex ||
    i.funderMember !== instrument.funderMember ||
    i.stewardMember !== instrument.stewardMember ||
    i.mint !== SOLANA_MAINNET_USDC_MINT ||
    typeof v.balanceMinor !== "string" ||
    !/^(0|[1-9]\d{0,19})$/.test(v.balanceMinor) ||
    v.declaredCommitmentMinor !== instrument.monthlyCommitment?.amountMinor ||
    typeof v.coversCommitment !== "boolean" ||
    v.coversCommitment !==
      BigInt(v.balanceMinor) >= BigInt(v.declaredCommitmentMinor as string) ||
    typeof v.observedAt !== "string" ||
    !Number.isFinite(Date.parse(v.observedAt)) ||
    Date.parse(v.observedAt) > Date.now() + 60000 ||
    Date.now() - Date.parse(v.observedAt) > 120000 ||
    !Number.isSafeInteger(v.slot) ||
    Number(v.slot) < 0
  )
    throw new TypeError(
      "Vault observation does not match the reviewed monthly instrument or is stale.",
    );
  return {
    projectId,
    cycleId,
    balanceMinor: v.balanceMinor,
    observedAt: v.observedAt,
    coversCommitment: v.coversCommitment,
    slot: Number(v.slot),
  };
}
