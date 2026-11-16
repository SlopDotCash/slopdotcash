/** Exact private security bounty shares (PRD section 8). */

export interface SecurityBountyShares {
  researcher: bigint;
  slop: bigint;
}

/**
 * The 75/25 split pays three quarters to the researcher and one quarter to
 * slop.cash; an approved full-award split pays the whole gross to the
 * researcher. The gross must divide by four, so no share is rounded.
 */
//@ verify
//@ requires gross > 0
//@ requires !fullAward ==> gross % 4 == 0
//@ ensures \result.researcher + \result.slop == gross
//@ ensures fullAward ==> \result.slop == 0 && \result.researcher == gross
//@ ensures !fullAward ==> \result.slop * 4 == gross && \result.researcher == 3 * \result.slop
//@ ensures \result.researcher > 0 && \result.slop >= 0
export function securityBountyShares(
  gross: bigint,
  fullAward: boolean,
): SecurityBountyShares {
  if (fullAward) return { researcher: gross, slop: 0n };
  return { researcher: (gross * 3n) / 4n, slop: gross / 4n };
}
