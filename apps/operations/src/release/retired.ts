// spec/operations/release.md, "Workers publish before the static site, each only when its own release variable is enabled"

export type RetiredKind = "script" | "durableObject" | "queue";

export interface Retired {
  readonly kind: RetiredKind;
  readonly name: string;
  readonly reason: string;
}

const inactiveExecutor = "Inactive payment executor role: Slop deploys no relayer and no dispatcher (PRD PAY-04); removal only by an owner-approved operator plan";

const productionStacks = ["slop-payments-base-mainnet", "slop-payments-ethereum", "slop-payments-robinhood-mainnet", "slop-payments-solana-mainnet"] as const;

export const retired: ReadonlyArray<Retired> = productionStacks.flatMap((stack) => [
  { kind: "script", name: `${stack}-relayer`, reason: inactiveExecutor },
  { kind: "script", name: `${stack}-dispatcher`, reason: inactiveExecutor },
]);

/** @throws {never} */
export function retiredScripts(): ReadonlySet<string> {
  return new Set(retired.filter((entry) => entry.kind === "script").map((entry) => entry.name));
}
