/** Local acceptance composition, deliberately outside the production registry. */
import type { Database } from "bun:sqlite";
import { dispatchPayment } from "../../backend/payments/dispatch";
import { refreshVaultSnapshots } from "../../backend/payments/vault-snapshots";
import {
  solanaRpc,
  verifySolanaDeployment,
} from "../../contracts/solana/adapter";
import type { EscrowDeployment } from "../../src/lib/escrow-policy.mjs";
import type { PaymentDeployment } from "../../workers/payments/deployment-types";
import {
  ingestPaymentEvent,
  type PaymentsWorkerEnvironment,
  readDeploymentVaultTotals,
  recoverUncertainAttempts,
} from "../../workers/payments/index";
import { reconcileFailedAttempts } from "../../workers/payments/reconcile";
import { scanSolanaPayments } from "../../workers/payments/scanner";
import { assertSolanaTestCluster } from "./shared";

type LocalDeployment = Omit<PaymentDeployment, "network"> & {
  network: "solana-localnet";
};
/** Public identity facts already checked by openSolanaRun, never signer keys. */
export interface LocalSolanaRun {
  network: string;
  runId: string;
  rpcUrl: string;
  genesisHash: string;
  programId: string;
  codeSha256: string;
  upgradeAuthority: string | null;
  owner: string;
  identityAuthority: string;
  feeRecipient: string;
  rotationAuthority: string;
  rotationDelaySeconds: string;
  networkDomain: string;
}

/**
 * Immutable declarations from this run's initialized projects. They are not
 * project manifests and cannot be used by the production registry cron.
 */
export class LocalSolanaAcceptance {
  private readonly run: Readonly<LocalSolanaRun>;
  constructor(
    private readonly sqlite: Database,
    run: LocalSolanaRun,
  ) {
    this.run = Object.freeze({ ...run });
    if (run.network !== "solana-localnet")
      throw new Error("Local acceptance requires solana-localnet");
    assertSolanaTestCluster(run.network, run.genesisHash, run.rpcUrl);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS acceptance_local_run(id INTEGER PRIMARY KEY CHECK(id=1), facts TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS acceptance_local_declarations(project_id TEXT PRIMARY KEY, facts TEXT NOT NULL);
      CREATE TRIGGER IF NOT EXISTS acceptance_local_run_update BEFORE UPDATE ON acceptance_local_run BEGIN SELECT RAISE(ABORT,'immutable local run'); END;
      CREATE TRIGGER IF NOT EXISTS acceptance_local_run_delete BEFORE DELETE ON acceptance_local_run BEGIN SELECT RAISE(ABORT,'immutable local run'); END;
      CREATE TRIGGER IF NOT EXISTS acceptance_local_declaration_update BEFORE UPDATE ON acceptance_local_declarations BEGIN SELECT RAISE(ABORT,'immutable local declaration'); END;
      CREATE TRIGGER IF NOT EXISTS acceptance_local_declaration_delete BEFORE DELETE ON acceptance_local_declarations BEGIN SELECT RAISE(ABORT,'immutable local declaration'); END;
    `);
    const facts = JSON.stringify(run);
    const stored = sqlite
      .query<{ facts: string }, []>(
        "SELECT facts FROM acceptance_local_run WHERE id=1",
      )
      .get();
    if (stored && stored.facts !== facts)
      throw new Error("Local acceptance directory belongs to another run");
    sqlite
      .prepare("INSERT OR IGNORE INTO acceptance_local_run VALUES(1,?)")
      .run(facts);
  }

  record(projects: { projectId: string; deployment: EscrowDeployment }[]) {
    this.sqlite.transaction(() => {
      for (const { projectId, deployment } of projects) {
        for (const key of [
          "network",
          "programId",
          "codeSha256",
          "upgradeAuthority",
          "owner",
          "identityAuthority",
          "feeRecipient",
          "rotationAuthority",
          "rotationDelaySeconds",
          "networkDomain",
        ] as const) {
          if (deployment[key] !== this.run[key])
            throw new Error(
              `Local declaration differs from verified run: ${key}`,
            );
        }
        if (
          !projectId ||
          !deployment.projectPda ||
          !deployment.asset ||
          !deployment.deploymentTransaction
        )
          throw new Error("Local declaration requires an initialized project");
        const facts = JSON.stringify({
          projectId,
          ...deployment,
          chain: "solana",
        });
        const old = this.sqlite
          .query<{ facts: string }, [string]>(
            "SELECT facts FROM acceptance_local_declarations WHERE project_id=?",
          )
          .get(projectId);
        if (old && old.facts !== facts)
          throw new Error("Local acceptance deployment changed");
        this.sqlite
          .prepare(
            "INSERT OR IGNORE INTO acceptance_local_declarations VALUES(?,?)",
          )
          .run(projectId, facts);
      }
    })();
    return this.deployments();
  }

  private deployments(): LocalDeployment[] {
    return this.sqlite
      .query<{ facts: string }, []>(
        "SELECT facts FROM acceptance_local_declarations ORDER BY project_id",
      )
      .all()
      .map(({ facts }) => JSON.parse(facts) as LocalDeployment);
  }

  /**
   * Same chain adapters, ledger, durable recovery and dispatch as the worker.
   * The local-only admission occurs before every tick, not in a network parser.
   * Monthly registry policy/coordinator is intentionally outside this fixture.
   */
  async tick(env: PaymentsWorkerEnvironment): Promise<string[]> {
    const { network, rpcUrl, genesisHash } = this.run;
    assertSolanaTestCluster(network, genesisHash, rpcUrl);
    if (
      JSON.stringify(JSON.parse(env.PAYMENT_NETWORKS)) !==
        JSON.stringify([network]) ||
      JSON.parse(env.PAYMENT_RPC_URLS)[network] !== rpcUrl ||
      JSON.parse(env.PAYMENT_SOLANA_GENESIS ?? "{}")[network] !== genesisHash
    )
      throw new Error("Local payment environment differs from admitted run");
    const observed = await solanaRpc({ rpcUrl }, "getGenesisHash", []);
    if (observed !== genesisHash)
      throw new Error("Local acceptance RPC genesis changed");
    const deployments = this.deployments();
    for (const deployment of deployments) {
      if (
        !deployment.programId ||
        !deployment.projectPda ||
        !deployment.networkDomain ||
        !deployment.rotationAuthority ||
        !deployment.rotationDelaySeconds
      )
        throw new Error("Local declaration is incomplete");
      await verifySolanaDeployment({
        ...deployment,
        rpcUrl,
        genesisHash,
        programId: deployment.programId,
        projectPda: deployment.projectPda,
        networkDomain: deployment.networkDomain,
        rotationAuthority: deployment.rotationAuthority,
        rotationDelaySeconds: deployment.rotationDelaySeconds,
        mint: deployment.asset,
      });
    }
    const failures: string[] = [];
    const attempt = async (step: () => Promise<unknown>) => {
      try {
        await step();
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error));
      }
    };
    const rpcUrls = { [network]: rpcUrl };
    await attempt(() =>
      refreshVaultSnapshots(
        env.PAYMENTS_DB,
        deployments,
        rpcUrls,
        readDeploymentVaultTotals,
      ),
    );
    // The only type adaptation is the local name. Admission above verifies its
    // actual genesis and deployed bytes; production parsers remain unchanged.
    const reviewed = deployments as unknown as PaymentDeployment[];
    for (const deployment of deployments)
      await attempt(() =>
        scanSolanaPayments(env.PAYMENTS_DB, deployment, rpcUrl, (event) =>
          ingestPaymentEvent(env, event, new Date(), reviewed),
        ),
      );
    await attempt(() => recoverUncertainAttempts(env));
    await attempt(() =>
      reconcileFailedAttempts(env.PAYMENTS_DB, deployments, rpcUrls, {
        [network]: genesisHash,
      }),
    );
    // Iterate this run's declared obligations; dispatchPayment owns all queue,
    // lease, wallet, uncertain-attempt and replay eligibility decisions.
    for (const deployment of deployments) {
      const rows = await env.PAYMENTS_DB.prepare(
        "SELECT json_group_array(id) ids FROM payment_obligations WHERE project_id=? AND network=? AND vault=?",
      )
        .bind(deployment.projectId, network, deployment.vault)
        .first<{ ids: string }>();
      for (const id of JSON.parse(rows?.ids ?? "[]") as string[])
        await attempt(() =>
          dispatchPayment(
            env.PAYMENTS_DB,
            {
              async submit(input) {
                if (
                  input.network !== network ||
                  input.vault !== deployment.vault
                )
                  throw new Error(
                    "Payment escaped local deployment declaration",
                  );
                if (!env.SOLANA_PAYMENT_EXECUTOR)
                  throw new Error("Local relayer unavailable");
                const response = await env.SOLANA_PAYMENT_EXECUTOR.fetch(
                  new Request("https://payments-executor.internal/v1/pay", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify(input),
                  }),
                );
                if (!response.ok)
                  throw new Error("Local payment execution rejected request");
                const result = (await response.json()) as {
                  transactionId?: unknown;
                };
                if (
                  typeof result.transactionId !== "string" ||
                  !result.transactionId
                )
                  throw new Error("Missing local payment transaction");
                return { transactionId: result.transactionId };
              },
            },
            id,
            new Date(),
          ),
        );
    }
    return failures;
  }
}
