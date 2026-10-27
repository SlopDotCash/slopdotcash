import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { privateKeyToAccount } from "viem/accounts";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import type { PaymentExecutor } from "../../backend/payments/dispatch";
import type { MonthlyAttestationRequest } from "../../backend/payments/monthly-attestation";
import { publishMonthlyAuthorizations } from "../../backend/payments/monthly-publication";
import {
  isMonthlyReleaseCheck,
  isMonthlyReleaseRequest,
} from "../../backend/payments/monthly-reserve-release";
import {
  CloudflareProjectPersistence,
  type ProjectD1Database,
} from "../../backend/projects/cloudflare-persistence";
import { publicRestrictionOf } from "../../backend/projects/enforcement";
import { securityPaymentDatabase } from "../../backend/security/payment-database";
import {
  EvmMonthlyAlreadyAdmitted,
  prepareEvmMonthlyReservation,
} from "../../contracts/evm/adapter";
import { solanaBase58 } from "../../contracts/solana/adapter";
import { readBoundedJson } from "../../src/lib/browser-json";
import {
  ESCROW_NETWORKS,
  paymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import { parseMonthlySchedule } from "../../src/lib/payments/monthly-allocation";
import { runMonthlyCoordinator, syncRegistryVaults } from "../payments/index";
import {
  isBindingRecoveryInput,
  reconcileBindingWinner,
} from "./binding-recovery";
import {
  assertEvmMonthlySources,
  type BindingRunReport,
  bindingCandidates,
  createEvmAttester,
  createEvmExecutor,
  type JournalStore,
  lookupAttempt,
  pendingStoredBindings,
  preflightEvmDeployment,
  retireUnsignedAttempt,
  runStoredBindings,
  type Signer,
  submitEvmMonthly,
} from "./core";
import type { MonthlyAuthorization } from "./monthly";
import { signMonthlyAllocation } from "./monthly";
import {
  checkMonthlyReserveRelease,
  type MonthlyReleaseDependencies,
  prepareMonthlyReserveRelease,
} from "./monthly-release";
import {
  SIGNER_STACKS,
  type SignerStack,
  signerStack,
  stackServesNetwork,
} from "./signer-stacks.mjs";
import {
  completeSolanaBinding,
  createSolanaAttester,
  createSolanaExecutor,
  preflightSolanaDeployment,
  solanaTransactionStatus,
} from "./solana";
import { freezeSolanaMonthly, submitSolanaMonthly } from "./solana-monthly";

interface Fetcher {
  fetch(request: Request): Promise<Response>;
}
interface Namespace {
  idFromName(name: string): unknown;
  get(id: unknown): Fetcher;
}
export interface Environment {
  PAYMENT_SCOPE?: "security-bounty";
  SECURITY_PAYMENT_DEPLOYMENTS?: string;
  PAYMENTS_DB: D1Database;
  REGISTRY_DB?: ProjectD1Database;
  MONTHLY_PAYMENT_SCHEDULE?: string;
  PAYMENT_DEPLOYMENTS: string;
  PAYMENT_RPC_URLS: string;
  SIGNER_ROLE: "attester" | "relayer";
  CHAIN_FAMILY: "evm" | "solana";
  /** `test` (or absent) or `production`; selects the signer secret and journal names. */
  SIGNER_STACK?: string;
  /**
   * `on` gives a test-stack EVM attester the production scheduled binding
   * (staging keeper topology). A production EVM attester always has it.
   */
  SCHEDULED_BINDINGS?: string;
  /** One consumed nonce per vault/actor for reviewed staging qualification only. */
  TEST_BINDING_NONCE_LIMIT?: string;
  /** Dedicated test-only key; each independently deployed role has a different secret. */
  TEST_SIGNER_PRIVATE_KEY?: `0x${string}`;
  TEST_SOLANA_SIGNER_SEED?: string;
  /** Production stack key for one role and one mainnet; never a test key. */
  SIGNER_PRIVATE_KEY?: `0x${string}`;
  SOLANA_SIGNER_SEED?: string;
  JOURNAL: Namespace;
  IDENTITY_ATTESTER?: Fetcher;
}
interface State {
  storage: JournalStore;
}
/** One instance per signer role serializes nonce allocation and preserves signed bytes before broadcast. */
export class PaymentSignerJournal {
  constructor(
    private readonly state: State,
    private readonly env: Environment,
  ) {}
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const bindingNonceLimit = testBindingNonceLimit(this.env);
    // This observation-only path must run before database or secret access,
    // including the ordinary/private environment copy below.
    if (url.pathname === "/v1/reconcile-binding") {
      if (
        request.method !== "POST" ||
        this.env.SIGNER_STACK !== "production" ||
        this.env.SIGNER_ROLE !== "attester" ||
        this.env.CHAIN_FAMILY !== "evm"
      )
        return new Response("Not found", { status: 404 });
      try {
        const { scope, ...input } = (await readBoundedJson(
          request,
          2048,
          "binding recovery",
        )) as Record<string, unknown>;
        if (
          (scope !== "ordinary" && scope !== "security-bounty") ||
          !isBindingRecoveryInput(input)
        )
          return Response.json({ error: "invalid_request" }, { status: 400 });
        const privateScope = scope === "security-bounty";
        const deployments = privateScope
          ? this.env.SECURITY_PAYMENT_DEPLOYMENTS
          : this.env.PAYMENT_DEPLOYMENTS;
        if (!deployments)
          return Response.json(
            { error: "binding_recovery_unavailable" },
            { status: 409 },
          );
        return Response.json(
          await reconcileBindingWinner(
            {
              PAYMENT_DEPLOYMENTS: deployments,
              PAYMENT_RPC_URLS: this.env.PAYMENT_RPC_URLS,
              JOURNAL: privateScope
                ? privateScopeJournal(this.state.storage)
                : this.state.storage,
            },
            input,
          ),
        );
      } catch (error) {
        logRejected("/v1/reconcile-binding", error);
        return Response.json(
          { error: "binding_recovery_pending_or_rejected" },
          { status: 409 },
        );
      }
    }
    if (url.pathname.startsWith("/v1/security/")) {
      url.pathname = url.pathname.replace("/v1/security/", "/v1/");
      if (this.env.PAYMENT_SCOPE === "security-bounty")
        return this.fetch(new Request(url, request));
      if (!this.env.SECURITY_PAYMENT_DEPLOYMENTS)
        return new Response("Not found", { status: 404 });
      // Both scopes use this same state.storage, including the nonce record.
      // Only the separately pinned private vaults and ledger are selected.
      return new PaymentSignerJournal(
        { storage: privateScopeJournal(this.state.storage) },
        privateAttesterEnvironment(this.env),
      ).fetch(new Request(url, request));
    }
    const database =
      this.env.PAYMENT_SCOPE === "security-bounty"
        ? securityPaymentDatabase(this.env.PAYMENTS_DB)
        : this.env.PAYMENTS_DB;
    const { pathname } = url;
    if (
      request.method !== "POST" ||
      ![
        "/v1/pay",
        "/v1/monthly-authorization",
        "/v1/monthly-reserve-release",
        "/v1/commit-monthly",
        "/v1/complete-bind",
        "/v1/attempt-status",
        "/v1/cancel-unsubmitted",
        "/v1/bind-destinations",
      ].includes(pathname)
    )
      return new Response("Not found", { status: 404 });
    try {
      if (pathname === "/v1/bind-destinations") {
        // The production EVM attester's own binding run (PRD PAY-05). It
        // takes no input: the candidates come from D1 and the pinned
        // deployments only, and every candidate passes the hosted
        // attester's checks again.
        const stack = signerStack(this.env.SIGNER_STACK);
        if (!scheduledBindings(this.env))
          return new Response("Not found", { status: 404 });
        // The stack, network and preflight checks of every pinned vault pass
        // on every run, before D1 is read and before the secret is read, as
        // on every other signing route.
        const pinned = JSON.parse(this.env.PAYMENT_DEPLOYMENTS) as {
          network: string;
          vault: string;
        }[];
        if (
          !pinned.length ||
          pinned.some((target) => !stackServesNetwork(stack, target.network))
        )
          throw new Error("Signer stack does not serve this network");
        for (const target of pinned)
          await preflightEvmDeployment(this.env, target);
        const environment = {
          PAYMENTS_DB: database,
          PAYMENT_DEPLOYMENTS: this.env.PAYMENT_DEPLOYMENTS,
          PAYMENT_RPC_URLS: this.env.PAYMENT_RPC_URLS,
          JOURNAL: this.state.storage,
          ...(bindingNonceLimit
            ? { BINDING_NONCE_LIMIT: bindingNonceLimit }
            : {}),
        };
        const candidates = await bindingCandidates(environment);
        if (
          !candidates.length &&
          !(await pendingStoredBindings(this.state.storage)).length
        ) {
          const idle: BindingRunReport = {
            candidates: 0,
            current: 0,
            waiting: 0,
            failed: 0,
            submitted: [],
          };
          return Response.json(idle);
        }
        // One contributor's held or rejected binding never stops the others;
        // the failure count makes the scheduled run fail.
        return Response.json(
          await runStoredBindings(
            { ...environment, SIGNER: evmSigner(this.env, stack) },
            candidates,
          ),
        );
      }
      if (pathname === "/v1/commit-monthly") {
        // Hosted relayers are test-only. Production submission belongs to a
        // project-operated or permissionless executor, never this attester.
        const stack = signerStack(this.env.SIGNER_STACK);
        if (
          stack !== "test" ||
          this.env.SIGNER_ROLE !== "relayer" ||
          this.env.PAYMENT_SCOPE === "security-bounty"
        )
          return new Response("Not found", { status: 404 });
        const authorization = (await readBoundedJson(
          request,
          4 * 1024 * 1024,
          "monthly commitment",
        )) as MonthlyAuthorization;
        const target = {
          network: authorization.plan.request.network,
          vault: authorization.plan.deployment.vault,
        };
        if (!stackServesNetwork(stack, target.network))
          throw new Error("Wrong signer stack");
        if (this.env.CHAIN_FAMILY === "solana") {
          await preflightSolanaDeployment(this.env, target);
          return Response.json(
            await submitSolanaMonthly(
              {
                PAYMENT_DEPLOYMENTS: this.env.PAYMENT_DEPLOYMENTS,
                PAYMENT_RPC_URLS: this.env.PAYMENT_RPC_URLS,
                JOURNAL: this.state.storage,
                SOLANA_SIGNER: solanaSigner(this.env, stack),
              },
              authorization,
              url.searchParams.get("admit") !== "false",
              // Settle every remaining leaf promptly after admission, bounded
              // per call by Worker subrequest limits.
              16,
            ),
          );
        }
        await preflightEvmDeployment(this.env, target);
        return Response.json(
          await submitEvmMonthly(
            {
              PAYMENT_DEPLOYMENTS: this.env.PAYMENT_DEPLOYMENTS,
              PAYMENT_RPC_URLS: this.env.PAYMENT_RPC_URLS,
              JOURNAL: this.state.storage,
              SIGNER: evmSigner(this.env, stack),
            },
            authorization,
            url.searchParams.get("admit") !== "false",
            16,
          ),
        );
      }
      if (pathname === "/v1/monthly-reserve-release") {
        if (
          this.env.SIGNER_ROLE !== "attester" ||
          this.env.PAYMENT_SCOPE === "security-bounty" ||
          !this.env.REGISTRY_DB
        )
          return new Response("Not found", { status: 404 });
        const input = await readBoundedJson(
          request,
          2048,
          "monthly reserve release",
        );
        const stack = signerStack(this.env.SIGNER_STACK);
        if (
          (!isMonthlyReleaseRequest(input) && !isMonthlyReleaseCheck(input)) ||
          !stackServesNetwork(stack, input.network)
        )
          return Response.json({ error: "invalid_request" }, { status: 400 });
        const registry = new CloudflareProjectPersistence(this.env.REGISTRY_DB);
        const dependencies: MonthlyReleaseDependencies = {
          db: database,
          journal: this.state.storage,
          getProject: (id) => registry.getProject(id),
          pinned: JSON.parse(this.env.PAYMENT_DEPLOYMENTS) as Record<
            string,
            unknown
          >[],
          family: this.env.CHAIN_FAMILY,
          evm: async (deployment) => {
            const config = await preflightEvmDeployment(this.env, deployment);
            return { ...config, chainId: BigInt(config.chainId) };
          },
          solana: (deployment) =>
            preflightSolanaDeployment(this.env, deployment),
          sign: (messageHex) =>
            signDigest(this.env, stack, this.env.CHAIN_FAMILY, messageHex),
        };
        return Response.json(
          await (isMonthlyReleaseCheck(input)
            ? checkMonthlyReserveRelease(dependencies, input)
            : prepareMonthlyReserveRelease(dependencies, input)),
        );
      }
      if (pathname === "/v1/monthly-authorization") {
        if (
          this.env.SIGNER_ROLE !== "attester" ||
          this.env.PAYMENT_SCOPE === "security-bounty" ||
          !this.env.REGISTRY_DB
        )
          return new Response("Not found", { status: 404 });
        const input = (await readBoundedJson(
          request,
          4096,
          "monthly authorization",
        )) as MonthlyAttestationRequest;
        const stack = signerStack(this.env.SIGNER_STACK);
        if (
          !input ||
          typeof input.projectId !== "string" ||
          typeof input.period !== "string" ||
          typeof input.network !== "string" ||
          typeof input.snapshotSha256 !== "string" ||
          !stackServesNetwork(stack, input.network)
        )
          throw new Error("Invalid monthly authorization request");
        const schedule = parseMonthlySchedule(
          this.env.MONTHLY_PAYMENT_SCHEDULE,
        );
        if (!schedule) throw new Error("Monthly schedule required");
        const registry = new CloudflareProjectPersistence(this.env.REGISTRY_DB);
        const pinned = JSON.parse(this.env.PAYMENT_DEPLOYMENTS) as Record<
          string,
          unknown
        >[];
        const authorization = await signMonthlyAllocation(
          {
            db: database,
            getProject: (id) => registry.getProject(id),
            restricted: async (project) =>
              publicRestrictionOf(project, await registry.listEnforcements())
                .state !== "clear",
            networks: pinned.map((d) => String(d.network)),
            schedule,
            now: () => new Date(),
            journal: this.state.storage,
            verifyDeployment: async (plan) => {
              if (plan.family !== this.env.CHAIN_FAMILY)
                throw new Error("Wrong chain family");
              const expected = paymentDeploymentRecord(
                input.projectId,
                plan.deployment,
              );
              const matches = pinned.filter(
                (d) =>
                  d.projectId === input.projectId &&
                  d.network === input.network &&
                  d.vault === plan.deployment.vault,
              );
              if (
                matches.length !== 1 ||
                Object.entries(expected).some(
                  ([key, value]) =>
                    JSON.stringify(matches[0][key]) !== JSON.stringify(value),
                )
              )
                throw new Error(
                  "Monthly deployment differs from pinned configuration",
                );
              const target = {
                network: input.network,
                vault: plan.deployment.vault,
              };
              if (plan.family === "evm") {
                const deployment = await preflightEvmDeployment(
                  this.env,
                  target,
                );
                if (!plan.evmReservation)
                  await assertEvmMonthlySources(deployment, plan.entries);
              } else await preflightSolanaDeployment(this.env, target);
            },
            reserve: async (plan) => {
              const deployment = await preflightEvmDeployment(this.env, {
                network: input.network,
                vault: plan.deployment.vault,
              });
              return prepareEvmMonthlyReservation(
                { ...deployment, chainId: BigInt(deployment.chainId) },
                input.period,
                `0x${input.snapshotSha256}`,
                plan.entries,
              );
            },
            freeze: async (plan) =>
              freezeSolanaMonthly(
                await preflightSolanaDeployment(this.env, {
                  network: input.network,
                  vault: plan.deployment.vault,
                }),
                plan,
              ),
            sign: (plan) =>
              signDigest(this.env, stack, plan.family, plan.messageHex),
          },
          input,
        );
        return Response.json(authorization);
      }
      const input = (await readBoundedJson(
        request,
        4096,
        "payout execution",
      )) as Parameters<ReturnType<typeof createEvmExecutor>["submit"]>[0] & {
        transaction?: unknown;
      };
      // A test stack signs for test networks only and a production stack
      // for mainnets only, so each key signs only for its own stack.
      const stack = signerStack(this.env.SIGNER_STACK);
      // PRD PAY-04: Slop holds no relayer key and runs no payment dispatch on
      // a mainnet. A production stack is the PAY-05 identity attester only.
      if (stack === "production" && this.env.SIGNER_ROLE !== "attester")
        return new Response("Not found", { status: 404 });
      // A production EVM attester (or a test one with SCHEDULED_BINDINGS)
      // binds only through its scheduled run (/v1/bind-destinations), so one
      // journal key per binding version is the only path that can sign one.
      if (scheduledBindings(this.env))
        return new Response("Not found", { status: 404 });
      if (["/v1/attempt-status", "/v1/cancel-unsubmitted"].includes(pathname)) {
        if (this.env.SIGNER_ROLE !== "relayer")
          return new Response("Not found", { status: 404 });
        const operation =
          pathname === "/v1/attempt-status"
            ? lookupAttempt
            : retireUnsignedAttempt;
        const result = await operation(
          { PAYMENTS_DB: database, JOURNAL: this.state.storage },
          input,
        );
        if (this.env.CHAIN_FAMILY === "solana" && result.transactionId) {
          const config = await preflightSolanaDeployment(this.env, input);
          return Response.json({
            ...result,
            submitted:
              (await solanaTransactionStatus({ config }, result)) !== null,
          });
        }
        return Response.json(result);
      }
      if (request.headers.get("idempotency-key") !== input.idempotencyKey)
        return new Response("Idempotency key required", { status: 400 });
      if (
        this.env.SIGNER_ROLE !== "attester" &&
        this.env.SIGNER_ROLE !== "relayer"
      )
        throw new Error("Signer role missing");
      const service = this.env.IDENTITY_ATTESTER;
      const attester: PaymentExecutor | undefined = service
        ? {
            async submit(body) {
              const response = await service.fetch(
                new Request("https://identity-attester.internal/v1/pay", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "idempotency-key": body.idempotencyKey,
                  },
                  body: JSON.stringify(body),
                }),
              );
              if (!response.ok) throw new Error("Binding pending or rejected");
              const result = (await response.json()) as {
                transactionId: string;
              };
              if (
                typeof result.transactionId !== "string" ||
                !result.transactionId
              )
                throw new Error("Invalid binding transaction");
              return result;
            },
          }
        : undefined;
      const common = {
        PAYMENTS_DB: database,
        PAYMENT_DEPLOYMENTS: this.env.PAYMENT_DEPLOYMENTS,
        PAYMENT_RPC_URLS: this.env.PAYMENT_RPC_URLS,
        JOURNAL: this.state.storage,
      };
      let engine: PaymentExecutor;
      if (!stackServesNetwork(stack, input.network))
        throw new Error("Signer stack does not serve this network");
      if (
        pathname === "/v1/complete-bind" &&
        (this.env.SIGNER_ROLE !== "attester" ||
          this.env.CHAIN_FAMILY !== "solana")
      )
        return new Response("Not found", { status: 404 });
      if (this.env.CHAIN_FAMILY === "evm") {
        await preflightEvmDeployment(this.env, input);
        const signer = evmSigner(this.env, stack);
        engine =
          this.env.SIGNER_ROLE === "attester"
            ? createEvmAttester({ ...common, SIGNER: signer })
            : createEvmExecutor({
                ...common,
                SIGNER: signer,
                ATTESTER: attester,
              });
      } else if (this.env.CHAIN_FAMILY === "solana") {
        await preflightSolanaDeployment(this.env, input);
        const signer = solanaSigner(this.env, stack);
        // A Solana binding needs the destination wallet's signature on the
        // same bytes: the attester prepares and half-signs it, the wallet
        // co-signs, and the completed transaction comes back here.
        if (this.env.SIGNER_ROLE === "attester") {
          const solana = { ...common, SOLANA_SIGNER: signer };
          const { transaction, ...binding } = input;
          if (pathname === "/v1/complete-bind") {
            if (typeof transaction !== "string")
              throw new Error("Signed transaction required");
            return Response.json(
              await completeSolanaBinding(solana, binding, transaction),
            );
          }
          return Response.json(
            await createSolanaAttester(solana).submit(binding),
          );
        }
        engine = createSolanaExecutor({ ...common, SOLANA_SIGNER: signer });
      } else throw new Error("Unsupported signer family");
      const result = await engine.submit(input);
      return Response.json(result);
    } catch (error) {
      if (error instanceof EvmMonthlyAlreadyAdmitted)
        return Response.json(
          { error: "monthly_already_admitted" },
          { status: 409 },
        );
      // No keys, signed transaction bytes, wallet consent signatures, or RPC credentials in responses/logs.
      logRejected(pathname, error);
      return Response.json(
        { error: "execution_pending_or_rejected" },
        { status: 409 },
      );
    }
  }
}

/** Scoped background indexing; ordinary monthly signatures only, never payment dispatch. */
export async function runMonthlyAttester(env: Environment) {
  if (env.SIGNER_ROLE !== "attester") return;
  if (!env.REGISTRY_DB) throw new Error("Monthly registry binding missing");
  const privateScope = env.PAYMENT_SCOPE === "security-bounty";
  const schedule = privateScope
    ? null
    : parseMonthlySchedule(env.MONTHLY_PAYMENT_SCHEDULE);
  if (!privateScope && !schedule) throw new Error("Monthly schedule missing");
  const stack = signerStack(env.SIGNER_STACK);
  const deployments = JSON.parse(env.PAYMENT_DEPLOYMENTS) as {
    network: string;
  }[];
  const networks = [...new Set(deployments.map((d) => d.network))];
  if (
    !networks.length ||
    networks.some((network) => !stackServesNetwork(stack, network))
  )
    throw new Error("Monthly signer stack mismatch");
  const worker = {
    PAYMENTS_DB: privateScope
      ? securityPaymentDatabase(env.PAYMENTS_DB)
      : env.PAYMENTS_DB,
    REGISTRY_DB: env.REGISTRY_DB,
    PAYMENT_SCOPE: env.PAYMENT_SCOPE,
    PAYMENT_NETWORKS: JSON.stringify(networks),
    PAYMENT_RPC_URLS: env.PAYMENT_RPC_URLS,
    PAYMENT_SOLANA_GENESIS: JSON.stringify(
      Object.fromEntries(
        networks.map((network) => [
          network,
          ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS]?.genesisHash,
        ]),
      ),
    ),
    MONTHLY_PAYMENT_SCHEDULE: env.MONTHLY_PAYMENT_SCHEDULE,
  };
  const sync = await syncRegistryVaults(worker);
  // Private awards are owner decisions. Index only their separate ledger;
  // never create a monthly bounty allocation or dispatch a payment.
  if (privateScope) {
    if (sync.failures.length)
      throw new Error("Private award indexing incomplete");
    return sync;
  }
  if (!schedule) throw new Error("Monthly schedule missing");
  await runMonthlyCoordinator(worker);
  const report = await publishMonthlyAuthorizations({
    db: env.PAYMENTS_DB,
    networks,
    schedule,
    now: new Date(),
    authorize: async (request) => {
      const response = await env.JOURNAL.get(
        env.JOURNAL.idFromName(SIGNER_STACKS[stack].journal),
      ).fetch(
        new Request("https://attester.internal/v1/monthly-authorization", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        }),
      );
      if (response.status === 409) {
        const rejected = (await readBoundedJson(
          response,
          4096,
          "monthly authorization status",
        )) as { error?: unknown };
        if (rejected.error === "monthly_already_admitted")
          throw new EvmMonthlyAlreadyAdmitted();
      }
      if (!response.ok)
        throw new Error("Monthly attester rejected authorization");
      return (await readBoundedJson(
        response,
        4 * 1024 * 1024,
        "monthly authorization",
      )) as MonthlyAuthorization;
    },
  });
  if (sync.failures.length || report.failures.length)
    throw new Error("Monthly indexing or authorization incomplete");
  return report;
}

/**
 * The production EVM attester binds the stored, wallet-signed destinations
 * of reserved awards (PRD PAY-05). A mainnet has no Slop relayer to request
 * a binding (PAY-04). The payout itself stays permissionless: the project
 * owner or anyone else calls the vault's `pay`. A test-stack EVM attester
 * with `SCHEDULED_BINDINGS=on` runs the same binding for the staging keeper
 * topology. Every other stack has no scheduled binding; a test relayer
 * requests its bindings itself.
 */
export async function runDestinationBindings(env: Environment) {
  testBindingNonceLimit(env);
  if (!scheduledBindings(env)) return null;
  const response = await env.JOURNAL.get(
    env.JOURNAL.idFromName(
      SIGNER_STACKS[signerStack(env.SIGNER_STACK)].journal,
    ),
  ).fetch(
    new Request(
      `https://attester.internal/v1/${env.PAYMENT_SCOPE === "security-bounty" && env.SIGNER_STACK === "production" ? "security/" : ""}bind-destinations`,
      {
        method: "POST",
      },
    ),
  );
  if (!response.ok) throw new Error("Destination binding run rejected");
  const report = (await readBoundedJson(
    response,
    65536,
    "destination bindings",
  )) as BindingRunReport;
  if (report.failed !== 0) throw new Error("Destination binding incomplete");
  return report;
}

export function testBindingNonceLimit(env: Environment): 1 | undefined {
  if (env.TEST_BINDING_NONCE_LIMIT === undefined) return undefined;
  if (
    env.TEST_BINDING_NONCE_LIMIT !== "1" ||
    signerStack(env.SIGNER_STACK) !== "test" ||
    env.SIGNER_ROLE !== "attester" ||
    env.CHAIN_FAMILY !== "evm" ||
    env.SCHEDULED_BINDINGS !== "on"
  )
    throw new Error(
      "Single-nonce bindings require a scheduled test EVM attester",
    );
  return 1;
}

/**
 * True for an EVM attester that binds only through its scheduled run: every
 * production stack, and a test stack with `SCHEDULED_BINDINGS=on`. Such an
 * attester refuses requested bindings, so one journal key per binding
 * version is the only path that can sign a binding.
 */
function scheduledBindings(env: Environment) {
  const stack = signerStack(env.SIGNER_STACK);
  if (env.SCHEDULED_BINDINGS !== undefined && env.SCHEDULED_BINDINGS !== "on")
    throw new Error("Unknown SCHEDULED_BINDINGS");
  return (
    env.SIGNER_ROLE === "attester" &&
    env.CHAIN_FAMILY === "evm" &&
    (stack === "production" || env.SCHEDULED_BINDINGS === "on")
  );
}

/**
 * The stack's signer keys. Each is read only when a signing route calls it,
 * after that route's stack, network and deployment checks.
 */
function evmAccount(env: Environment, stack: SignerStack) {
  const key = env[SIGNER_STACKS[stack].evmSecret];
  if (!key) throw new Error("Signer unavailable");
  return privateKeyToAccount(key);
}
function evmSigner(env: Environment, stack: SignerStack): Signer {
  const account = evmAccount(env, stack);
  return {
    address: account.address,
    signTransaction: (transaction) => account.signTransaction(transaction),
  };
}
function solanaSigner(env: Environment, stack: SignerStack) {
  const encoded = env[SIGNER_STACKS[stack].solanaSecret];
  if (!encoded || !/^[0-9a-f]{64}$/.test(encoded))
    throw new Error("Signer unavailable");
  const seed = hexToBytes(encoded);
  return {
    address: solanaBase58(ed25519.getPublicKey(seed)),
    async signMessage(message: Uint8Array) {
      return ed25519.sign(message, seed);
    },
  };
}
/** Signs a hex digest (EVM) or message (Solana) and returns the hex signature. */
async function signDigest(
  env: Environment,
  stack: SignerStack,
  family: "evm" | "solana",
  messageHex: string,
) {
  if (family === "evm")
    return (
      await evmAccount(env, stack).sign({ hash: `0x${messageHex}` })
    ).slice(2);
  return bytesToHex(
    await solanaSigner(env, stack).signMessage(hexToBytes(messageHex)),
  );
}
/** Fixed fields only: an error message can contain a private RPC URL. */
function logRejected(route: string, error: unknown) {
  console.error(
    JSON.stringify({
      event: "attester_request_rejected",
      route,
      kind: error instanceof Error ? error.name : "unknown",
    }),
  );
}

/** Separate pending attempts and receipts, but atomically share the EVM nonce. */
export function privateScopeJournal(storage: JournalStore): JournalStore {
  const scoped = (key: string) =>
    key.startsWith("nonce:") ? key : `security:${key}`;
  return {
    get: <T>(key: string) => storage.get<T>(scoped(key)),
    put: <T>(key: string, value: T) => storage.put(scoped(key), value),
    ...(storage.list
      ? {
          list: async <T>(options: { prefix: string; limit: number }) => {
            const prefix = scoped(options.prefix);
            const values = await storage.list!<T>({ ...options, prefix });
            return new Map(
              [...values].map(([key, value]) => [
                prefix === options.prefix ? key : key.slice("security:".length),
                value,
              ]),
            );
          },
        }
      : {}),
    transaction: <T>(callback: (store: JournalStore) => Promise<T>) =>
      storage.transaction((transaction) =>
        callback(privateScopeJournal(transaction)),
      ),
  };
}

function privateAttesterEnvironment(env: Environment): Environment {
  return {
    ...env,
    PAYMENT_SCOPE: "security-bounty",
    PAYMENT_DEPLOYMENTS: env.SECURITY_PAYMENT_DEPLOYMENTS ?? "[]",
    SECURITY_PAYMENT_DEPLOYMENTS: undefined,
  };
}

/** Service bindings only. workers_dev and preview URLs must remain disabled in both deployments. */
export default {
  async scheduled(_event: unknown, env: Environment) {
    testBindingNonceLimit(env);
    // The binding run follows the indexing of new awards and runs even when
    // a monthly step fails; either failure fails the scheduled run.
    const failures: unknown[] = [];
    const privateScope = env.SECURITY_PAYMENT_DEPLOYMENTS
      ? privateAttesterEnvironment(env)
      : null;
    const scopes =
      privateScope && JSON.parse(env.PAYMENT_DEPLOYMENTS).length === 0
        ? [privateScope]
        : [env, ...(privateScope ? [privateScope] : [])];
    for (const scope of scopes) {
      for (const step of [runMonthlyAttester, runDestinationBindings]) {
        try {
          await step(scope);
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length)
      throw new AggregateError(failures, "Attester scheduled run incomplete");
  },
  async fetch(request: Request, env: Environment) {
    return env.JOURNAL.get(
      env.JOURNAL.idFromName(
        SIGNER_STACKS[signerStack(env.SIGNER_STACK)].journal,
      ),
    ).fetch(request);
  },
};
