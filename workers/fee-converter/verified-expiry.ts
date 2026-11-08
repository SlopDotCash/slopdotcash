/** The exact retained history fields compared before an expiry release. */
export interface CompletedCoverageFields {
  complete: boolean;
  blocks: number;
  txId: string;
  blockhash: string;
  blockhashSlot: number;
  tipSlot: number;
  tipHash: string;
  digest: string;
}

export type RetainedExpiryCoverage =
  | { kind: "missing" }
  | { kind: "present"; history: CompletedCoverageFields };

/** Completeness is supplied by the retained traversal; this proves agreement. */
//@ verify
//@ pure
//@ ensures \result <==> a.kind == "present" && b.kind == "present" && a.history.complete && b.history.complete && a.history.blocks > 0 && a.history.txId == b.history.txId && a.history.blockhash == b.history.blockhash && a.history.blockhashSlot == b.history.blockhashSlot && a.history.tipSlot == b.history.tipSlot && a.history.tipHash == b.history.tipHash && a.history.blocks == b.history.blocks && a.history.digest == b.history.digest
//@ ensures \result ==> a.history.blocks > 0 && b.history.blocks > 0 && a.history.complete && b.history.complete
export function matchingExpiryCoverage(
  a: RetainedExpiryCoverage,
  b: RetainedExpiryCoverage,
): boolean {
  return (
    a.kind === "present" &&
    b.kind === "present" &&
    !!a.history.complete &&
    !!b.history.complete &&
    a.history.blocks > 0 &&
    a.history.txId === b.history.txId &&
    a.history.blockhash === b.history.blockhash &&
    a.history.blockhashSlot === b.history.blockhashSlot &&
    a.history.tipSlot === b.history.tipSlot &&
    a.history.tipHash === b.history.tipHash &&
    a.history.blocks === b.history.blocks &&
    a.history.digest === b.history.digest
  );
}
