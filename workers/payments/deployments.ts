import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import {
  assertEscrowPolicy,
  assertSecurityEscrowPolicy,
  ESCROW_NETWORKS,
  type EscrowDeployment,
  paymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import type { PaymentDeployment } from "./index";

export type PaymentNetwork = EscrowDeployment["network"];

/**
 * `PAYMENT_NETWORKS` selects the registry networks one payments Worker
 * serves: a JSON array of unique registry network names. A missing, empty,
 * unknown or repeated name stops the Worker; nothing defaults to a network.
 */
export function parsePaymentNetworks(value: unknown): PaymentNetwork[] {
  let names: unknown;
  try {
    names = typeof value === "string" ? JSON.parse(value) : undefined;
  } catch {
    names = undefined;
  }
  if (
    !Array.isArray(names) ||
    names.length === 0 ||
    new Set(names).size !== names.length ||
    !names.every(
      (name) =>
        typeof name === "string" && Object.hasOwn(ESCROW_NETWORKS, name),
    )
  )
    throw new Error(
      "PAYMENT_NETWORKS must be a JSON array of unique registry networks",
    );
  return names as PaymentNetwork[];
}

export interface RegistryDeployments {
  deployments: PaymentDeployment[];
  /** One entry per project whose current manifest has an invalid escrow policy. */
  failures: Error[];
}

/**
 * Reads the escrow deployments of the selected networks from the current
 * revision of every project in the D1 registry. The registry is the only
 * project inventory, so a vault recorded by an admin revision is found on the
 * next run without a Worker change. A paused project keeps its vault and its
 * funded obligations, so its deployments stay in scope. One invalid manifest
 * is reported and skipped; it never removes the other projects' vaults.
 * `db` is the registry database (`REGISTRY_DB`), never the payment database.
 */
export async function loadRegistryPaymentDeployments(
  db: D1Database,
  networks: readonly PaymentNetwork[],
  scope: "ordinary" | "security-bounty" = "ordinary",
): Promise<RegistryDeployments> {
  const row = await db
    .prepare(
      "SELECT json_group_array(json_object('id',id,'manifest',manifest)) items FROM (SELECT id,manifest FROM projects ORDER BY id)",
    )
    .first<{ items: string }>();
  if (!row) throw new Error("Project registry unavailable");
  const inventory = JSON.parse(row.items) as { id: string; manifest: string }[];
  // Sharing a vault would leak private amounts through ordinary counters.
  // Validate both inventories even when this worker serves only one scope.
  const failures: Error[] = [];
  const vaultScopes = new Map<string, string>();
  for (const project of inventory) {
    let manifest: {
      escrow?: unknown;
      securityBounty?: { settlement?: unknown };
    };
    try {
      manifest = JSON.parse(project.manifest);
    } catch {
      // The scoped read below reports an unreadable manifest.
      continue;
    }
    for (const [scopeName, read] of [
      [
        "ordinary",
        () =>
          manifest.escrow === undefined
            ? undefined
            : assertEscrowPolicy(manifest.escrow),
      ],
      [
        "security-bounty",
        () =>
          manifest.securityBounty?.settlement === undefined
            ? undefined
            : assertSecurityEscrowPolicy(manifest.securityBounty.settlement),
      ],
    ] as const) {
      let policy: { deployments: readonly EscrowDeployment[] } | undefined;
      try {
        policy = read();
      } catch (error) {
        // The scoped read below reports this Worker's own scope; the other
        // scope's malformed policy would otherwise escape the sharing check.
        if (scopeName !== scope)
          failures.push(
            new Error(`Project ${project.id} ${scopeName} policy invalid`, {
              cause: error,
            }),
          );
        continue;
      }
      for (const d of policy?.deployments ?? []) {
        const key = `${d.network}:${d.programId ? d.vault : d.vault.toLowerCase()}`;
        if (vaultScopes.has(key))
          throw new Error(
            "A payment vault cannot be shared between registry programs",
          );
        vaultScopes.set(key, `${project.id}:${scopeName}`);
      }
    }
  }
  const selected = new Set<string>(networks);
  const deployments: PaymentDeployment[] = [];
  for (const project of inventory) {
    try {
      const manifest = JSON.parse(project.manifest) as {
        id?: unknown;
        escrow?: unknown;
        securityBounty?: { settlement?: unknown };
      };
      if (manifest.id !== project.id)
        throw new Error("Project manifest identity mismatch");
      const policy =
        scope === "security-bounty"
          ? manifest.securityBounty?.settlement
          : manifest.escrow;
      if (policy === undefined) continue;
      const approved =
        scope === "security-bounty"
          ? assertSecurityEscrowPolicy(policy)
          : assertEscrowPolicy(policy);
      for (const deployment of approved.deployments)
        if (selected.has(deployment.network))
          deployments.push({
            ...paymentDeploymentRecord(project.id, deployment),
            ...(scope === "security-bounty" ? { payoutPolicy: scope } : {}),
          });
    } catch (error) {
      failures.push(
        new Error(`Project ${project.id} escrow deployments unavailable`, {
          cause: error,
        }),
      );
    }
  }
  // A served network without a vault is a failure, not an empty success: a
  // Worker bound to the wrong database or to an unreviewed network would
  // otherwise scan nothing and report nothing.
  for (const network of networks)
    if (!deployments.some((deployment) => deployment.network === network))
      failures.push(
        new Error(
          `Project registry has no escrow deployment for served network ${network}`,
        ),
      );
  return { deployments, failures };
}
