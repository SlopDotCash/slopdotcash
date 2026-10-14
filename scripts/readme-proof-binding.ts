/**
 * When a cycle row may hold a profile README wallet proof.
 *
 * A README proof names a login, not an actor id. The login of a row is bound
 * to the immutable actor id only when the snapshot is frozen. After that, the
 * actor can rename and another account can take the free login. Offline, a
 * README proof read before that point and one added later under the reused
 * login have the same bytes: the commit has no trusted time, and every file in
 * a cycle PR can be edited before merge. So a README proof is bound to an
 * actor id only by a reviewed record that is outside the PR under review:
 *
 * 1. the exact proof (canonical bytes) that the reviewed prior cycle manifest
 *    froze for the same actor id, or
 * 2. a legacy proof pinned below. These proofs were merged before this rule.
 *
 * All other wallets must be actor-bound (registry or claim issue proof with
 * `sourceActorId === actor.id`, checked by assertRewardAllocationManifest).
 * The rule is the same for scored and carried rows (PRD ACC-01, WAL-01).
 * Proposal generation, proposal validation and the payment import use it.
 *
 * A cycle with an active fresh-cycle payment policy accepts no README proof,
 * frozen or pinned. Legacy records stay historical evidence and do not
 * automatically authorize a new payout protocol (PRD WAL-01, section 23), so
 * a fresh-policy row needs an actor-bound claim, else it stays unclaimed.
 */
import { findProject } from "../src/lib/projects.mjs";
import type { ProfileReadmeWalletProof } from "../src/lib/rewards";

/** True when the project has an active fresh-cycle payment policy for the cycle. */
export function isFreshPolicyCycle(
  projectId: string,
  cycleId: string,
): boolean {
  return (
    findProject(projectId)?.funding.freshCyclePaymentPolicy?.cycleId === cycleId
  );
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * README proofs in cycle proposals merged before this rule. They are pinned by
 * exact bytes, so an edit of a merged proposal cannot add a new one.
 */
export const LEGACY_README_PROOFS: readonly {
  projectId: string;
  cycleId: string;
  actorId: string;
  wallet: ProfileReadmeWalletProof;
}[] = [
  {
    projectId: "asi",
    cycleId: "2026-09",
    actorId: "U_kgDOD2nrjw",
    wallet: {
      address: "ZtdooyCSVFtdbz5Y4msPuanVyZYV2zaHCJnjZgyVU96",
      chain: "solana",
      observedAt: "2026-10-01T05:52:22.205Z",
      sourceCommit: "1d4ec274c05f9dbbf0e547c0ed38b5377fbdfe0e",
      sourceUrl:
        "https://github.com/agent-cortex/agent-cortex/blob/1d4ec274c05f9dbbf0e547c0ed38b5377fbdfe0e/README.md",
    },
  },
  {
    projectId: "asi",
    cycleId: "2026-09",
    actorId: "U_kgDOD5fOPQ",
    wallet: {
      address: "2H7EzHUeJHGoQUkYfBwdRnJvw7Xj19rdrGgzCaMESSJz",
      chain: "solana",
      observedAt: "2026-10-01T05:52:22.205Z",
      sourceCommit: "b6781e0623e13f7a4215031df6fb79db959000a1",
      sourceUrl:
        "https://github.com/startrack3r/startrack3r/blob/b6781e0623e13f7a4215031df6fb79db959000a1/README.md",
    },
  },
  {
    projectId: "eliza",
    cycleId: "2026-07",
    actorId: "MDQ6VXNlcjE2Mzk1NDk2",
    wallet: {
      address: "59W5HpZu1FFqEHj8Qvkwd9UXb62aQMCt32LD4uarrRsc",
      chain: "solana",
      observedAt: "2026-08-21T02:59:01.753Z",
      sourceCommit: "3a169fa41826ac60956dbd9798c7646adb0ea65a",
      sourceUrl:
        "https://github.com/odilitime/odilitime/blob/3a169fa41826ac60956dbd9798c7646adb0ea65a/README.md",
    },
  },
  {
    projectId: "eliza",
    cycleId: "2026-09",
    actorId: "U_kgDOD2nrjw",
    wallet: {
      address: "ZtdooyCSVFtdbz5Y4msPuanVyZYV2zaHCJnjZgyVU96",
      chain: "solana",
      observedAt: "2026-10-01T05:52:22.205Z",
      sourceCommit: "1d4ec274c05f9dbbf0e547c0ed38b5377fbdfe0e",
      sourceUrl:
        "https://github.com/agent-cortex/agent-cortex/blob/1d4ec274c05f9dbbf0e547c0ed38b5377fbdfe0e/README.md",
    },
  },
  {
    projectId: "eliza",
    cycleId: "2026-09",
    actorId: "U_kgDOCYMVCA",
    wallet: {
      address: "4h9sXJmFbEw4cSbJv5p5Dg7K4icTRC45sqyefZnrRiBr",
      chain: "solana",
      observedAt: "2026-10-01T05:52:22.205Z",
      sourceCommit: "f50ef4fdd6ef9a6913be16b7d695fe70292589ba",
      sourceUrl:
        "https://github.com/fid1699/fid1699/blob/f50ef4fdd6ef9a6913be16b7d695fe70292589ba/README.md",
    },
  },
  {
    projectId: "eliza",
    cycleId: "2026-09",
    actorId: "U_kgDODhBdCg",
    wallet: {
      address: "6ap37TpuJHn4NofsFpPCDZhKBBLVP7aunMMPx1agE3iz",
      chain: "solana",
      observedAt: "2026-10-01T05:52:22.205Z",
      sourceCommit: "aaf7ef6514beb0c20ed2e76018f0957d53d805c3",
      sourceUrl:
        "https://github.com/Finberg-Laurelin-CEO/Finberg-Laurelin-CEO/blob/aaf7ef6514beb0c20ed2e76018f0957d53d805c3/README.md",
    },
  },
  {
    projectId: "eliza",
    cycleId: "2026-09",
    actorId: "U_kgDOD5fOPQ",
    wallet: {
      address: "2H7EzHUeJHGoQUkYfBwdRnJvw7Xj19rdrGgzCaMESSJz",
      chain: "solana",
      observedAt: "2026-10-01T05:52:22.205Z",
      sourceCommit: "b6781e0623e13f7a4215031df6fb79db959000a1",
      sourceUrl:
        "https://github.com/startrack3r/startrack3r/blob/b6781e0623e13f7a4215031df6fb79db959000a1/README.md",
    },
  },
];

export function isReadmeProof(
  wallet: unknown,
): wallet is ProfileReadmeWalletProof {
  return (
    typeof wallet === "object" && wallet !== null && "sourceCommit" in wallet
  );
}

/** The README proof of each actor id in a reviewed prior cycle manifest. */
export function priorReadmeProofs(manifest: {
  allocations?: readonly { actor: { id: string }; wallet?: unknown }[];
}): Map<string, ProfileReadmeWalletProof> {
  const proofs = new Map<string, ProfileReadmeWalletProof>();
  for (const { actor, wallet } of manifest.allocations ?? [])
    if (isReadmeProof(wallet)) proofs.set(actor.id, wallet);
  return proofs;
}

/**
 * Returns null when the README proof of this row is bound to its actor id,
 * else the reason why it is not. In a fresh-policy cycle no README proof is
 * bound (WAL-01).
 */
export function unboundReadmeProofReason(input: {
  projectId: string;
  cycleId: string;
  actorId: string;
  wallet: ProfileReadmeWalletProof;
  priorProof: ProfileReadmeWalletProof | null | undefined;
  freshPolicy?: boolean;
}): string | null {
  if (input.freshPolicy)
    return `README wallet of ${input.actorId} is a legacy proof; a fresh-policy cycle accepts only an actor-bound claim`;
  const bytes = canonicalJson(input.wallet);
  if (input.priorProof && canonicalJson(input.priorProof) === bytes)
    return null;
  if (
    LEGACY_README_PROOFS.some(
      (pin) =>
        pin.projectId === input.projectId &&
        pin.cycleId === input.cycleId &&
        pin.actorId === input.actorId &&
        canonicalJson(pin.wallet) === bytes,
    )
  )
    return null;
  return input.priorProof
    ? `README wallet of ${input.actorId} is not the proof that the prior manifest froze for it`
    : `README wallet of ${input.actorId} is new; only an actor-bound claim or a frozen prior proof is accepted`;
}
