import {
  readEvmAuthorityRotation,
  verifyPayment,
  verifyReserve,
} from "../../contracts/evm/adapter";
import {
  solanaAuthorityRotation,
  solanaPaymentAdapter,
  verifySolanaDeployment,
} from "../../contracts/solana/adapter";
import { canonicalJson } from "../../src/lib/canonical-json";
import { deploymentOrigins } from "../../src/lib/deployment";
import {
  ESCROW_NETWORKS,
  type PaymentDeploymentRecord,
  paymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import {
  type MonthlySchedule,
  monthlyFinalizationDate,
  PRD_MONTHLY_SCHEDULE,
  parseMonthlySchedule,
  periodEnd,
} from "../../src/lib/payments/monthly-allocation";
import { assertProjectRegistry } from "../../src/lib/project-schema.mjs";
import type { ProjectDefinition } from "../../src/lib/projects.mjs";
import {
  type PublicEvmExecutorEnvironment,
  preflightEvmDeployment,
  preparePermissionlessEvmPayment,
  type Signer,
  submitEvmMonthly,
  submitPermissionlessEvmPayment,
} from "../../workers/payment-executor/core";
import type { MonthlyAuthorization } from "../../workers/payment-executor/monthly";
import {
  type PublicSolanaExecutorEnvironment,
  preflightSolanaDeployment,
  preparePermissionlessSolanaPayment,
  type SolanaSigner,
  submitPermissionlessSolanaPayment,
} from "../../workers/payment-executor/solana";
import { submitSolanaMonthly } from "../../workers/payment-executor/solana-monthly";
import {
  type ScanEvent,
  scanEvmPayments,
  scanSolanaPayments,
} from "../../workers/payments/scanner";
import {
  budgetEvmSigner,
  budgetSolanaSigner,
  type GasBudget,
  reconcileGas,
} from "./budget";
import type { KeeperStore } from "./storage";

export interface KeeperConfiguration {
  apiOrigin: string;
  network: keyof typeof ESCROW_NETWORKS;
  projectIds: string[];
  signer: string;
  rpcUrl: string;
  gas: GasBudget;
  /** Maximum award checks per vault and examined EVM leaves per month per run. */
  perRun: number;
  /**
   * The deployment's `MONTHLY_PAYMENT_SCHEDULE`. Omitted, the keeper serves
   * the PRD schedule; a test network may name an earlier first period.
   */
  monthlySchedule?: MonthlySchedule;
}
type Deployment = PaymentDeploymentRecord & {
  payoutPolicy: "ordinary" | "security-bounty";
  mint: string;
};
export interface KeeperDependencies {
  store: KeeperStore;
  /** The host reads the operator key only when this provider is first called. */
  evmSigner?: Signer;
  solanaSigner?: SolanaSigner;
  now?: Date;
  /** Local integration only; the executable does not forward these. */
  localChain?: { solanaGenesis?: string };
}
async function json(url: string) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      // The production API uses the same public CORS contract as the website.
      origin:
        new URL(url).origin === deploymentOrigins().api
          ? deploymentOrigins().site
          : new URL(url).origin,
    },
    signal: AbortSignal.timeout(20_000),
    redirect: "manual",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Public registry HTTP ${response.status}`);
  return response.json();
}
function deployments(
  project: ProjectDefinition,
  network: string,
): Deployment[] {
  return [
    ...(project.escrow?.deployments ?? []).map((value) => ({
      ...paymentDeploymentRecord(project.id, value),
      payoutPolicy: "ordinary" as const,
      mint: value.asset,
    })),
    ...(project.securityBounty?.settlement?.deployments ?? []).map((value) => ({
      ...paymentDeploymentRecord(project.id, value),
      payoutPolicy: "security-bounty" as const,
      mint: value.asset,
    })),
  ].filter((value) => value.network === network);
}
export interface KeeperResult {
  projectId: string;
  vault: string;
  operation: string;
  state: string;
  transactionId?: string | null;
  error?: string;
}

/** A publication can replace only an unadmitted execution attempt, never its frozen allocation. */
async function retainAuthorization(
  store: KeeperStore,
  key: string,
  value: MonthlyAuthorization,
) {
  await store.journal.transaction(async (journal) => {
    const previous = await journal.get<MonthlyAuthorization>(key);
    if (previous && canonicalJson(previous) !== canonicalJson(value)) {
      const old = previous.plan;
      const next = value.plan;
      const reservation = next.evmReservation;
      if (
        old.family !== "evm" ||
        next.family !== "evm" ||
        !reservation ||
        reservation.version !== 2 ||
        canonicalJson(old.request) !== canonicalJson(next.request) ||
        old.deployment.vault.toLowerCase() !==
          next.deployment.vault.toLowerCase() ||
        old.deployment.asset.toLowerCase() !==
          next.deployment.asset.toLowerCase() ||
        reservation.allocationDigest !== `0x${next.request.snapshotSha256}`
      )
        throw new Error(
          "Published authorization changed the frozen allocation",
        );
      if (old.evmReservation) {
        if (
          !/^(0|[1-9][0-9]{0,77})$/.test(reservation.sourceSequence) ||
          !/^(0|[1-9][0-9]{0,77})$/.test(old.evmReservation.sourceSequence) ||
          BigInt(reservation.sourceSequence) <=
            BigInt(old.evmReservation.sourceSequence) ||
          reservation.wholeGross !== old.evmReservation.wholeGross ||
          canonicalJson(previous.legacyAuthorization ?? null) !==
            canonicalJson(value.legacyAuthorization ?? null)
        )
          throw new Error(
            "Published authorization is not a later execution attempt",
          );
      } else if (
        canonicalJson(value.legacyAuthorization ?? null) !==
        canonicalJson({ plan: old, signatureHex: previous.signatureHex })
      ) {
        throw new Error(
          "Published authorization did not retain the original signature",
        );
      }
    }
    for (const authorization of previous ? [previous, value] : [value]) {
      const attemptKey = `${key}:attempt:${authorization.plan.messageHex}`;
      const retained = await journal.get<MonthlyAuthorization>(attemptKey);
      if (retained && canonicalJson(retained) !== canonicalJson(authorization))
        throw new Error("Retained monthly authorization changed");
      if (!retained) await journal.put(attemptKey, authorization);
    }
    await journal.put(key, value);
  });
}

/** One bounded run. The operator schedules this executable; Slop never hosts its key. */
export async function runKeeper(
  config: KeeperConfiguration,
  deps: KeeperDependencies,
  execute = false,
): Promise<KeeperResult[]> {
  if (
    !Number.isSafeInteger(config.perRun) ||
    config.perRun < 1 ||
    config.projectIds.length === 0 ||
    new Set(config.projectIds).size !== config.projectIds.length
  )
    throw new Error("Select projects and a positive per-run bound");
  const schedule =
    config.monthlySchedule === undefined
      ? PRD_MONTHLY_SCHEDULE
      : (parseMonthlySchedule(JSON.stringify(config.monthlySchedule)) ??
        PRD_MONTHLY_SCHEDULE);
  const network = ESCROW_NETWORKS[config.network];
  if (!network) throw new Error("Unknown reviewed network");
  const origin = new URL(config.apiOrigin);
  if (
    origin.protocol !== "https:" &&
    !(deps.localChain && ["127.0.0.1", "localhost"].includes(origin.hostname))
  )
    throw new Error("Public registry requires HTTPS");
  if (origin.pathname !== "/" || origin.username || origin.password)
    throw new Error("Use an API origin, not a path or credentials");
  // Public payment routes are served on the website, while the production
  // registry also has its dedicated API host. Reuse the deployment contract.
  const paymentOrigin =
    origin.origin === deploymentOrigins().api
      ? deploymentOrigins().site
      : origin.origin;
  const identity = JSON.stringify([
    origin.origin,
    config.network,
    config.signer,
  ]);
  const previous = await deps.store.journal.get<string>("keeper-identity");
  if (previous && previous !== identity)
    throw new Error("Journal belongs to another registry, network or signer");
  if (!previous) await deps.store.journal.put("keeper-identity", identity);
  const body = (await json(`${origin.origin}/api/v1/projects`)) as {
    schemaVersion: string;
    projects: unknown;
    restrictions?: { projectId: string }[];
  } | null;
  if (body?.schemaVersion !== "1" || !Array.isArray(body.restrictions))
    throw new Error("Current project registry with restrictions is required");
  const registry = assertProjectRegistry(body.projects);
  const missing: KeeperResult[] = [];
  const selected = config.projectIds.flatMap((id) => {
    const matches = registry.filter((project) => project.id === id);
    if (matches.length !== 1) {
      missing.push({
        projectId: id,
        vault: "",
        operation: "registry",
        state: "unavailable",
        error: "Project unavailable in current registry",
      });
      return [];
    }
    return matches;
  });
  const records = selected.flatMap((project) =>
    deployments(project, config.network),
  );
  const common = {
    PAYMENT_DEPLOYMENTS: JSON.stringify(records),
    PAYMENT_RPC_URLS: JSON.stringify({ [config.network]: config.rpcUrl }),
    ...(deps.localChain
      ? {
          ALLOW_LOCAL_TEST_CHAIN: true,
          LOCAL_SOLANA_GENESIS: deps.localChain.solanaGenesis,
        }
      : {}),
  };
  const evm: PublicEvmExecutorEnvironment | undefined = deps.evmSigner
    ? {
        ...common,
        SIGNER: budgetEvmSigner(deps.store, config.gas, deps.evmSigner, {
          now: () => deps.now ?? new Date(),
          ...(network.chain === "base" && !deps.localChain
            ? { baseRpc: config.rpcUrl }
            : {}),
        }),
        JOURNAL: deps.store.journal,
        // Bounded same-nonce fee replacement; each step is budgeted like a new send.
        FEE_BUMP: { now: () => deps.now ?? new Date() },
      }
    : undefined;
  const solana: PublicSolanaExecutorEnvironment | undefined = deps.solanaSigner
    ? {
        ...common,
        SOLANA_SIGNER: budgetSolanaSigner(
          deps.store,
          config.gas,
          deps.solanaSigner,
          config.rpcUrl,
          () => deps.now ?? new Date(),
        ),
        JOURNAL: deps.store.journal,
      }
    : undefined;
  if (
    (evm && evm.SIGNER.address.toLowerCase() !== config.signer.toLowerCase()) ||
    (solana && solana.SOLANA_SIGNER.address !== config.signer)
  )
    throw new Error("Keeper signer differs from operator configuration");
  if (execute && (network.family === "evm" ? !evm : !solana))
    throw new Error("Execution requires the dedicated operator signer");
  let gasReconciled = false;
  const result: KeeperResult[] = [...missing];
  const now = deps.now ?? new Date();
  for (const project of selected) {
    if (!records.some((record) => record.projectId === project.id)) {
      result.push({
        projectId: project.id,
        vault: "",
        operation: "registry",
        state: "unavailable",
        error: "No reviewed deployment for this network",
      });
      continue;
    }
    for (const record of records.filter(
      (entry) => entry.projectId === project.id,
    )) {
      const item = { projectId: project.id, vault: record.vault };
      const scope = `${project.id}:${record.vault}`;
      const target = { network: config.network, vault: record.vault };
      try {
        const checked =
          network.family === "evm"
            ? await preflightEvmDeployment(common, target)
            : await preflightSolanaDeployment(common, target);
        // Monthly submit also uses this independent gas key. Refuse every reviewed privileged role.
        const rotation =
          network.family === "evm"
            ? await readEvmAuthorityRotation({
                ...record,
                factory: record.factory as string,
                factoryCodeSha256: record.factoryCodeSha256 as string,
                registrar: record.registrar as string,
                rpcUrl: config.rpcUrl,
                chainId: BigInt(record.chainId as string),
              })
            : solanaAuthorityRotation(
                await verifySolanaDeployment(
                  checked as Awaited<
                    ReturnType<typeof preflightSolanaDeployment>
                  >,
                ),
              );
        const roles = [
          rotation.identityAuthority,
          rotation.pendingIdentityAuthority,
          record.owner,
          record.identityAuthority,
          record.feeRecipient,
          record.registrar,
          record.upgradeAuthority,
          record.rotationAuthority,
          record.evmUpgrade?.authority,
        ];
        if (
          roles.some(
            (role) =>
              role &&
              (network.family === "evm"
                ? role.toLowerCase() === config.signer.toLowerCase()
                : role === config.signer),
          )
        )
          throw new Error("Keeper signer must have no vault role");
        if (!gasReconciled) {
          await reconcileGas(
            deps.store,
            network.family,
            config.rpcUrl,
            config.signer,
            network.chain === "base" && !deps.localChain,
          );
          gasReconciled = true;
        }
        const scan =
          network.family === "evm" ? scanEvmPayments : scanSolanaPayments;
        await scan(
          deps.store.scanner,
          {
            ...record,
            projectId: scope,
            projectPda: record.projectPda ?? undefined,
            programId: record.programId ?? undefined,
          },
          config.rpcUrl,
          async (event: ScanEvent) => {
            const evidence =
              network.family === "evm"
                ? await (event.kind === "paid" ? verifyPayment : verifyReserve)(
                    {
                      ...record,
                      factory: record.factory as string,
                      factoryCodeSha256: record.factoryCodeSha256 as string,
                      registrar: record.registrar as string,
                      rpcUrl: config.rpcUrl,
                      chainId: BigInt(record.chainId as string),
                    },
                    event.transactionId,
                    event.eventIndex,
                    event.obligationId,
                  )
                : await solanaPaymentAdapter(
                    checked as Awaited<
                      ReturnType<typeof preflightSolanaDeployment>
                    >,
                  ).verifyFinalized(event);
            if (event.kind === "reserved")
              deps.store.db
                .query(
                  "INSERT INTO awards(scope,id,actor,reserve) VALUES(?,?,?,?) ON CONFLICT(scope,id) DO NOTHING",
                )
                .run(
                  scope,
                  event.obligationId,
                  evidence.githubUserId,
                  JSON.stringify(evidence),
                );
            else {
              const changed = deps.store.db
                .query("UPDATE awards SET payment=? WHERE scope=? AND id=?")
                .run(
                  JSON.stringify(evidence),
                  scope,
                  event.obligationId,
                ).changes;
              if (changed !== 1)
                throw new Error(
                  "Finalized payment has no indexed funded award",
                );
            }
          },
        );
        if (record.payoutPolicy === "ordinary") {
          for (
            let period = schedule.firstPeriod;
            period < now.toISOString().slice(0, 7);
            period = periodEnd(period).toISOString().slice(0, 7)
          ) {
            const key = `authorization:${scope}:${period}`;
            let authorization =
              await deps.store.journal.get<MonthlyAuthorization>(key);
            try {
              const publication = (await json(
                `${paymentOrigin}/api/v1/payments/projects/${project.id}/monthly/${period}/authorization/${config.network}`,
              )) as { authorization: MonthlyAuthorization } | null;
              if (publication) {
                const value = publication.authorization;
                if (
                  value.plan.request.projectId !== project.id ||
                  value.plan.request.period !== period ||
                  value.plan.request.network !== config.network ||
                  value.plan.deployment.vault !== record.vault
                )
                  throw new Error(
                    "Published authorization names another deployment",
                  );
                await retainAuthorization(deps.store, key, value);
                authorization = value;
              }
            } catch (error) {
              result.push({
                ...item,
                operation: `monthly:${period}`,
                state: "publication-unavailable",
                error: String(error),
              });
            }
            if (!authorization) continue;
            const opens = monthlyFinalizationDate(schedule, period);
            if (!opens || now < opens) continue;
            // An independent keeper cannot originate a new monthly root on
            // behalf of the vault owner. Resume only an admitted reservation.
            const admit = false;
            if (!execute) {
              result.push({
                ...item,
                operation: `monthly:${period}`,
                state: admit ? "published-not-executed" : "resume-only",
              });
              continue;
            }
            try {
              if (
                network.family === "evm" &&
                !admit &&
                !authorization.plan.evmReservation
              )
                continue;
              const submitted =
                network.family === "evm"
                  ? await submitEvmMonthly(
                      evm as PublicEvmExecutorEnvironment,
                      authorization,
                      admit,
                      config.perRun,
                    )
                  : await submitSolanaMonthly(
                      solana as PublicSolanaExecutorEnvironment,
                      authorization,
                      admit,
                    );
              result.push({
                ...item,
                operation: `monthly:${period}`,
                state: "execution-checked",
                ...submitted,
              });
            } catch (error) {
              result.push({
                ...item,
                operation: `monthly:${period}`,
                state: "waiting",
                error: String(error),
              });
            }
          }
        }
        const awards = deps.store.db
          .query<{ id: string; actor: string }, [string, number]>(
            "SELECT id,actor FROM awards WHERE scope=? AND payment IS NULL ORDER BY checked,id LIMIT ?",
          )
          .all(scope, config.perRun);
        for (const award of awards) {
          deps.store.db
            .query("UPDATE awards SET checked=? WHERE scope=? AND id=?")
            .run(Date.now(), scope, award.id);
          try {
            const input = {
              ...target,
              obligationId: award.id,
              githubUserId: award.actor,
            };
            const outcome = execute
              ? network.family === "evm"
                ? await submitPermissionlessEvmPayment(
                    evm as PublicEvmExecutorEnvironment,
                    input,
                  )
                : await submitPermissionlessSolanaPayment(
                    solana as PublicSolanaExecutorEnvironment,
                    input,
                  )
              : network.family === "evm"
                ? await preparePermissionlessEvmPayment(common, input)
                : await preparePermissionlessSolanaPayment(common, input);
            // A chain state read is not indexed receipt proof. Only the scanner stores paid.
            result.push({
              ...item,
              operation: `award:${award.id}`,
              state:
                outcome.state === "paid"
                  ? "awaiting-payment-index"
                  : outcome.state,
              ...("transactionId" in outcome
                ? { transactionId: outcome.transactionId }
                : {}),
            });
          } catch (error) {
            result.push({
              ...item,
              operation: `award:${award.id}`,
              state: "waiting",
              error: String(error),
            });
          }
        }
      } catch (error) {
        result.push({
          ...item,
          operation: "deployment",
          state: "unavailable",
          error: String(error),
        });
      }
    }
  }
  return result;
}
