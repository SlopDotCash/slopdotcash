import type { UnavailableSource } from "../src/lib/leaderboard-types";

/** A previously enumerated node is no longer addressable; never omit it in place. */
export class SourceNodeUnavailableError extends Error {
  override readonly name = "SourceNodeUnavailableError";
  constructor(
    readonly sources: UnavailableSource[],
    options?: ErrorOptions,
  ) {
    super(
      "GitHub could not resolve an enumerated source node; a fresh complete census is required",
      options,
    );
  }
}

/**
 * The requested identities that GitHub reported NOT_FOUND in this batch.
 * Empty for any other failure, including an observation of an identity the
 * batch did not request, so the caller rethrows it.
 */
export function unavailableRequestedIds(
  error: unknown,
  ids: readonly string[],
): string[] {
  if (!(error instanceof SourceNodeUnavailableError)) return [];
  const requested = new Set(ids);
  const unavailable = [
    ...new Set(error.sources.map((source) => source.nodeId)),
  ];
  return unavailable.every((id) => requested.has(id)) ? unavailable : [];
}
