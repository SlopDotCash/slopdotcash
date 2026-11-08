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

export interface TraversalBlock {
  blockhash: string;
  previousBlockhash: string;
  parentSlot: number;
  signatures: string[];
}

export interface TraversalStep {
  kind: "refused" | "complete" | "advance";
  nextSlot: number;
  expectedHash: string;
}

/** Exact signature membership, with no provider or signature-validity claim. */
//@ verify
//@ ensures \result <==> exists(i, 0 <= i && i < signatures.length && signatures[i] == txId)
export function containsExpirySignature(
  signatures: string[],
  txId: string,
): boolean {
  let index = 0;
  while (index < signatures.length) {
    //@ invariant 0 <= index && index <= signatures.length
    //@ invariant forall(i, 0 <= i && i < index ==> signatures[i] != txId)
    //@ decreases signatures.length - index
    if (signatures[index] === txId) return true;
    index++;
  }
  return false;
}

/** Complete next-step decision over one schema-checked finalized block. */
//@ verify
//@ ensures \result.kind == "refused" || \result.kind == "complete" || \result.kind == "advance"
//@ ensures (\result.kind == "refused") <==> (block.blockhash != expectedHash || current < anchorSlot || exists(i, 0 <= i && i < block.signatures.length && block.signatures[i] == txId) || (current == anchorSlot && block.blockhash != anchorHash) || (current != anchorSlot && (block.parentSlot >= current || block.parentSlot < anchorSlot)))
//@ ensures (\result.kind == "complete") ==> current == anchorSlot && block.blockhash == anchorHash && block.blockhash == expectedHash
//@ ensures (\result.kind == "advance") ==> anchorSlot <= \result.nextSlot && \result.nextSlot < current && \result.nextSlot == block.parentSlot && \result.expectedHash == block.previousBlockhash
//@ ensures \result.kind != "advance" ==> \result.nextSlot == current && \result.expectedHash == expectedHash
//@ ensures \result.kind != "refused" ==> forall(i, 0 <= i && i < block.signatures.length ==> block.signatures[i] != txId)
//@ ensures \result.kind != "refused" ==> (\result.kind == "complete" <==> current == anchorSlot)
export function expiryTraversalStep(
  txId: string,
  anchorHash: string,
  anchorSlot: number,
  current: number,
  expectedHash: string,
  block: TraversalBlock,
): TraversalStep {
  if (
    block.blockhash !== expectedHash ||
    current < anchorSlot ||
    containsExpirySignature(block.signatures, txId)
  )
    return { kind: "refused", nextSlot: current, expectedHash };
  if (current === anchorSlot) {
    if (block.blockhash !== anchorHash)
      return { kind: "refused", nextSlot: current, expectedHash };
    return { kind: "complete", nextSlot: current, expectedHash };
  }
  if (block.parentSlot >= current || block.parentSlot < anchorSlot)
    return { kind: "refused", nextSlot: current, expectedHash };
  return {
    kind: "advance",
    nextSlot: block.parentSlot,
    expectedHash: block.previousBlockhash,
  };
}
