import { handleFeeConversionsApi } from "../../../backend/fee-conversions/handler";
import { loopbackOrigin } from "../../../backend/github";
import { consumeIdentityAssertion } from "../../../backend/identity-assertion";
import {
  handleEmailPreferences,
  verifiedEmailEligibility,
} from "../../../backend/notifications/email";
import { handleNotificationsApi } from "../../../backend/notifications/handler";
import {
  type PagesContext,
  type PagesEnv,
  vettingContext,
} from "../../../backend/pages";
import { handlePaymentsApi } from "../../../backend/payments/handler";
import {
  MonthlyPaymentError,
  monthlyOwnerService,
  verifyProjectAuthority,
} from "../../../backend/payments/monthly";
import {
  handlePointsApi,
  sessionGithubActor,
} from "../../../backend/points/handler";
import { CloudflareProjectPersistence } from "../../../backend/projects/cloudflare-persistence";
import { edgeCache } from "../../../backend/projects/edge-cache";
import { publicRestrictionOf } from "../../../backend/projects/enforcement";
import { githubApiOrigin } from "../../../backend/projects/github-lookup";
import {
  handleProjectApi,
  type ProjectApiDependencies,
  refreshProjectSetup,
} from "../../../backend/projects/handler";
import { slopbotRepositoryAccess } from "../../../backend/projects/repository-access";
import {
  flaggerAuthority,
  readRepositoryAccess,
  repositoryControl,
} from "../../../backend/projects/setup";
import { rpcTokenMetadataReader } from "../../../backend/projects/token-metadata";
import { ownerVaultSetupService } from "../../../backend/projects/vault-setup";
import { handleReferralClaims } from "../../../backend/referrals/claims";
import { handleReferralsApi } from "../../../backend/referrals/handler";
import { githubAdvisoryReader } from "../../../backend/security/advisories";
import { surplusSecurityAnalyzer } from "../../../backend/security/analysis";
import {
  githubAdvisoryClient,
  githubAppAdvisoryToken,
  githubAppReportingReader,
  githubInstallationCheck,
} from "../../../backend/security/github-advisories";
import { handleSecurityApi } from "../../../backend/security/handler";
import {
  githubIntakeOAuth,
  type IntakeConfig,
} from "../../../backend/security/intake-grant";
import { securityPaymentDatabase } from "../../../backend/security/payment-database";
import { readSecurityProgramFunds } from "../../../backend/security/program-funds";
import { deterministicAnalyzer } from "../../../backend/security/report-analysis";
import { handleSlopbotApi } from "../../../backend/slopbot/summary";
import { handleHistoricalValueImport } from "../../../backend/slopbot/value-import";
import {
  CloudflareTracePersistence,
  privateIntakeStatus,
} from "../../../backend/trace/cloudflare-persistence";
import { handleTraceApi } from "../../../backend/trace/handler";
import { githubFlaggerStanding } from "../../../backend/vetting/flagger-standing";
import {
  handleProjectFlagsApi,
  ProjectFlagStore,
} from "../../../backend/vetting/flags";
import {
  handleVettingApi,
  queueAutomaticScan,
  signedVettingRequest,
  vettingScanRequester,
  vettingServiceAvailable,
} from "../../../backend/vetting/handler";
import {
  type EvmEscrowConfig,
  readEvmBindingVersion,
} from "../../../contracts/evm/adapter";
import { REVIEWED_EVM_FACTORIES } from "../../../contracts/evm/factories";
import type { SolanaEscrowConfig } from "../../../contracts/solana/adapter";
import { REVIEWED_SOLANA_PROGRAMS } from "../../../contracts/solana/programs";
import { readBoundedJson } from "../../../src/lib/browser-json";
import {
  deploymentTier,
  isLocalDevelopmentOrigin,
} from "../../../src/lib/deployment";
import { ESCROW_NETWORKS } from "../../../src/lib/escrow-policy.mjs";
import { parseMonthlySchedule } from "../../../src/lib/payments/monthly-allocation";
import type { GithubActor } from "../../../src/lib/project-contracts";
import type { MonthlyReleaseResult } from "../../../workers/payment-executor/monthly-release";
import {
  loadRegistryPaymentDeployments,
  type PaymentNetwork,
  parsePaymentNetworks,
} from "../../../workers/payments/deployments";

/** The intake configuration, or undefined (off) unless fully configured. */
function privateIntake(env: PagesEnv): IntakeConfig | undefined {
  const clientId = env.GITHUB_INTAKE_APP_CLIENT_ID;
  const clientSecret = env.GITHUB_INTAKE_APP_CLIENT_SECRET;
  const appId = env.GITHUB_INTAKE_APP_ID;
  const privateKey = env.GITHUB_INTAKE_APP_PRIVATE_KEY;
  const grantKey = env.SLOP_INTAKE_GRANT_KEY;
  if (
    env.SLOP_PRIVATE_INTAKE_MODE !== "on" ||
    !clientId ||
    !clientSecret ||
    !appId ||
    !privateKey ||
    !grantKey ||
    !/^[A-Za-z0-9_-]{43}$/u.test(grantKey)
  )
    return undefined;
  const apiOrigin = githubApiOrigin(env.SLOP_GITHUB_API_ORIGIN);
  const oauthOrigin = loopbackOrigin(
    env.SLOP_GITHUB_OAUTH_ORIGIN,
    "https://github.com",
  );
  const send = (url: string, init: RequestInit) => fetch(url, init);
  const installation = githubInstallationCheck({
    fetch: send,
    apiOrigin,
    appId,
    privateKey,
    now: () => new Date(),
  });
  return {
    mode: "on",
    grantKey,
    clientId,
    authorizeOrigin: oauthOrigin,
    oauth: githubIntakeOAuth({
      fetch: send,
      oauthOrigin,
      clientId,
      clientSecret,
    }),
    advisories: githubAdvisoryClient({ fetch: send, apiOrigin, installation }),
    installation,
    analyzer: deterministicAnalyzer,
  };
}

function githubIdSet(value: string | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => /^[1-9]\d*$/u.test(entry)),
  );
}

/** A private RPC endpoint from `PAYMENT_RPC_URLS`; never returned to the browser. */
function paymentRpcUrl(env: PagesEnv, network: string): string {
  const value = (
    JSON.parse(env.PAYMENT_RPC_URLS ?? "{}") as Record<string, unknown>
  )[network];
  if (typeof value !== "string" || new URL(value).protocol !== "https:")
    throw new Error("Payment RPC unavailable");
  return value;
}

/** Owner setup needs reviewed infrastructure and an RPC, not an active signer. */
export function vaultSetupNetworks(env: PagesEnv): PaymentNetwork[] {
  const networks = new Set<PaymentNetwork>(
    env.PAYMENT_NETWORKS === undefined || env.PAYMENT_NETWORKS === "[]"
      ? []
      : parsePaymentNetworks(env.PAYMENT_NETWORKS),
  );
  for (const reviewed of [
    ...REVIEWED_EVM_FACTORIES,
    ...REVIEWED_SOLANA_PROGRAMS,
  ]) {
    try {
      paymentRpcUrl(env, reviewed.network);
      networks.add(reviewed.network);
    } catch {
      // No usable RPC means owner setup is unavailable for this network.
    }
  }
  return [...networks];
}

/** Monthly reserve release services, one named binding per chain. */
function monthlyReleaseService(env: PagesEnv, network: string) {
  const chain = ESCROW_NETWORKS[network as PaymentNetwork]?.chain;
  if (chain === undefined) return undefined;
  return {
    base: env.MONTHLY_RELEASE_BASE,
    ethereum: env.MONTHLY_RELEASE_ETHEREUM,
    robinhood: env.MONTHLY_RELEASE_ROBINHOOD,
    solana: env.MONTHLY_RELEASE_SOLANA,
  }[chain];
}

export async function onRequest(context: PagesContext): Promise<Response> {
  const { request, env } = context;
  const db = env.SLOP_DB;
  const pathname = new URL(request.url).pathname;
  const tier = deploymentTier(env.SLOP_ENVIRONMENT);
  const now = () => new Date();
  const randomId = () => crypto.randomUUID();
  const sessionActor = (request: Request) =>
    sessionGithubActor(request, db, new Date().toISOString());
  const adminGithubIds = githubIdSet(env.ADMIN_GITHUB_IDS);
  const moderatorGithubIds = githubIdSet(env.PROJECT_MODERATOR_GITHUB_IDS);
  const walletOperatorGithubIds = githubIdSet(env.OPERATOR_GITHUB_IDS);
  const cache = edgeCache();
  const waitUntil = context.waitUntil?.bind(context);
  const send = (url: string, init: RequestInit) => fetch(url, init);
  const apiOrigin = githubApiOrigin(env.SLOP_GITHUB_API_ORIGIN);
  const repositoryAccess = (
    repository: { path: string; githubId: string },
    actor: GithubActor,
  ) => slopbotRepositoryAccess(env.SLOPBOT, repository, actor);
  // Trusted staging origins, or the local development server's origin; never
  // request input. The API checks the origin it is served from, so a local
  // origin cannot affect production traffic.
  const stagingOrigins =
    ["https://staging.slop.cash", "https://slop-staging.pages.dev"].includes(
      env.PAYMENTS_ALLOWED_ORIGIN ?? "",
    ) || isLocalDevelopmentOrigin(env.PAYMENTS_ALLOWED_ORIGIN)
      ? { allowedOrigins: [env.PAYMENTS_ALLOWED_ORIGIN as string] }
      : {};
  const projectPersistence = new CloudflareProjectPersistence(db);
  const { evidence, vetting, github, livePin } = vettingContext(env, request, {
    session: async (request) => {
      const actor = await sessionActor(request);
      return actor ? { ...actor, admin: false } : null;
    },
    signed: (request, maximum) =>
      signedVettingRequest(
        request,
        { resultPublicKeys: env.VETTING_RESULT_PUBLIC_KEYS, now },
        maximum,
      ),
  });
  /** Reviewed registry deployments of both payout policies on the served networks. */
  const registryDeployments = async (networks: readonly PaymentNetwork[]) =>
    (
      await Promise.all([
        loadRegistryPaymentDeployments(db, networks),
        loadRegistryPaymentDeployments(db, networks, "security-bounty"),
      ])
    ).flatMap((registry) => registry.deployments);
  const solanaFundingConfig = async (
    projectId: string,
    network: string,
    vault: string,
    payoutPolicy: "ordinary" | "security-bounty",
  ): Promise<SolanaEscrowConfig> => {
    const selected = vaultSetupNetworks(env).find((name) => name === network);
    if (!selected || ESCROW_NETWORKS[selected].family !== "solana")
      throw new Error("Funding network unavailable");
    const registry = await loadRegistryPaymentDeployments(
      db,
      [selected],
      payoutPolicy,
    );
    const matches = registry.deployments.filter(
      (row) =>
        row.projectId === projectId &&
        row.network === network &&
        row.vault === vault,
    );
    if (matches.length !== 1) throw new Error("Funding vault unavailable");
    return {
      ...matches[0],
      mint: matches[0].asset,
      rpcUrl: paymentRpcUrl(env, network),
      genesisHash: ESCROW_NETWORKS[selected].genesisHash,
    } as SolanaEscrowConfig;
  };
  const projectDependencies: ProjectApiDependencies = {
    persistence: projectPersistence,
    securitySolanaFundingConfig: (projectId, network, vault) =>
      solanaFundingConfig(projectId, network, vault, "security-bounty"),
    vaultSetup: ownerVaultSetupService({
      factories: REVIEWED_EVM_FACTORIES,
      programs: REVIEWED_SOLANA_PROGRAMS,
      db,
      projects: () => projectPersistence.listProjects(),
      networks: () => vaultSetupNetworks(env),
      rpcUrl: (network) => paymentRpcUrl(env, network),
    }),
    securityProgramFunds: (projectId, program) =>
      readSecurityProgramFunds({ db, now }, projectId, program),
    vettingClearance: (
      projectId,
      manifest,
      throughRevision,
      forReinstatement,
    ) =>
      vetting.manifestClearance(
        projectId,
        manifest,
        throughRevision,
        () => livePin(manifest),
        forReinstatement,
      ),
    adminGithubIds,
    moderatorGithubIds,
    now,
    randomId,
    sessionActor,
    repositoryControl: (manifest, facts) =>
      repositoryControl(
        manifest,
        { fetch: send, token: env.SLOP_GITHUB_READ_TOKEN, apiOrigin },
        facts,
      ),
    repositoryAccess,
    requestScan: vettingScanRequester({
      vetting,
      serviceAvailable: () =>
        vettingServiceAvailable(env.VETTING_RESULT_PUBLIC_KEYS),
      livePin,
      now,
      randomId,
    }),
    readTokenMetadata: rpcTokenMetadataReader(fetch, {
      base: env.REWARD_RPC_BASE,
      ethereum: env.REWARD_RPC_ETHEREUM,
      robinhood: env.REWARD_RPC_ROBINHOOD,
      solana: env.REWARD_RPC_SOLANA,
    }),
    github,
    cache,
    waitUntil,
  };
  const projectResponse = await handleProjectApi(request, projectDependencies);
  if (projectResponse !== null) return projectResponse;
  const appId = env.GITHUB_INTAKE_APP_ID;
  const appKey = env.GITHUB_INTAKE_APP_PRIVATE_KEY;
  const app =
    appId && appKey
      ? { fetch: send, apiOrigin, appId, privateKey: appKey, now }
      : null;
  const securityResponse = await handleSecurityApi(request, {
    db,
    // A separate key namespace; contributor trace APIs never read reports.
    reportStorage: env.PRIVATE_TRACES,
    reportIntakeEnabled: env.SLOP_PRIVATE_INTAKE_MODE === "on",
    now,
    randomId,
    sessionActor,
    reportingRead: app
      ? githubAppReportingReader(app)
      : async () => ({ kind: "unavailable" }),
    advisories: app
      ? githubAdvisoryReader({
          fetch: send,
          apiOrigin,
          token: githubAppAdvisoryToken(app),
        })
      : null,
    analyzer: surplusSecurityAnalyzer({
      apiKey: env.SURPLUS_API_KEY,
      fetch: send,
      loopbackOrigin: env.SLOP_ANALYSIS_API_ORIGIN,
    }),
    moderatorGithubIds,
    cache,
    waitUntil,
    intake: privateIntake(env),
    repositoryAccess,
  });
  if (securityResponse !== null) return securityResponse;
  const evidenceResponse = await evidence.handle(request);
  if (evidenceResponse !== null) return evidenceResponse;
  const flags = new ProjectFlagStore(db);
  const operatorGithubIds = [
    ...new Set([...adminGithubIds, ...moderatorGithubIds]),
  ];
  const flagsResponse = await handleProjectFlagsApi(request, {
    flags,
    projects: projectPersistence,
    flaggerStanding: githubFlaggerStanding({
      fetch: github.fetch,
      token: github.token,
      apiOrigin: github.apiOrigin,
      registryRepositories: async () =>
        (await projectPersistence.listProjects()).flatMap((project) =>
          project.manifest.repositories.map((entry) => entry.id),
        ),
    }),
    // Only current repository permission determines maintainer exclusion.
    repositoryAuthority: async (manifest, actor) =>
      flaggerAuthority(
        await readRepositoryAccess(repositoryAccess, manifest, actor),
        actor,
        manifest.repositories[0].id,
      ),
    sessionActor,
    moderatorGithubIds: operatorGithubIds,
    queueFreshScan: (project) =>
      queueAutomaticScan(
        {
          vetting,
          livePin,
          resultPublicKeys: env.VETTING_RESULT_PUBLIC_KEYS,
          now,
          randomId,
        },
        project,
        "Automatic fresh scan after two contributor flags paused the project",
      ),
    now,
    randomId,
    cache,
  });
  if (flagsResponse !== null) return flagsResponse;
  const vettingResponse = await handleVettingApi(request, {
    sandbox: env.VETTING_SANDBOX,
    repositoryAccess,
    refreshSetup: (projectId) =>
      refreshProjectSetup(request, projectDependencies, projectId),
    evidence,
    vetting,
    flags,
    projects: projectPersistence,
    resultPublicKeys: env.VETTING_RESULT_PUBLIC_KEYS,
    operatorGithubIds,
    livePin,
    session: async (request) => {
      const actor = await sessionActor(request);
      return actor === null
        ? null
        : { ...actor, admin: adminGithubIds.has(actor.githubId) };
    },
    now,
    randomId,
    cache,
  });
  if (vettingResponse !== null) return vettingResponse;
  const referralClaims = await handleReferralClaims(request, {
    db,
    sessionActor,
    now,
  });
  if (referralClaims !== null) return referralClaims;
  const referralsResponse = await handleReferralsApi(request, { db });
  if (referralsResponse !== null) return referralsResponse;
  const feeConversionsResponse = await handleFeeConversionsApi(request, {
    db,
    adminGithubIds,
    sessionActor,
  });
  if (feeConversionsResponse !== null) return feeConversionsResponse;
  const emailPreferencesResponse = await handleEmailPreferences(request, {
    db,
    sessionActor,
    now,
    eligibility: (githubId) =>
      verifiedEmailEligibility(env.SLOP_NOTIFY, githubId),
  });
  if (emailPreferencesResponse !== null) return emailPreferencesResponse;
  const notificationsResponse = await handleNotificationsApi(request, {
    moderatorGithubIds,
    db,
    sessionActor,
    now,
  });
  if (notificationsResponse !== null) return notificationsResponse;
  if (pathname.startsWith("/api/v1/payments/"))
    return handlePaymentsApi(request, {
      tier,
      db,
      solanaAttester: env.SOLANA_IDENTITY_ATTESTER,
      securityPayments: {
        db: securityPaymentDatabase(db),
        solanaAttester: env.SECURITY_SOLANA_IDENTITY_ATTESTER,
      },
      monthly: monthlyOwnerService({
        db,
        getProject: (id) => projectPersistence.getProject(id),
        restricted: async (project) =>
          publicRestrictionOf(
            project,
            await projectPersistence.listEnforcements(),
          ).state !== "clear",
        // Unset or invalid networks serve no vault, so nothing is finalized
        // or reserved here.
        networks: () => {
          try {
            return parsePaymentNetworks(env.PAYMENT_NETWORKS);
          } catch {
            if (env.PAYMENT_NETWORKS !== undefined)
              console.error("PAYMENT_NETWORKS is invalid");
            return [];
          }
        },
        verifyAuthority: (project, actor) =>
          verifyProjectAuthority(
            project.manifest,
            actor,
            env.SLOP_GITHUB_READ_TOKEN,
          ),
        // The cutoff display and the owner's cutoff lock. A malformed value
        // turns both off; the payments Worker then fails loudly and freezes
        // nothing automatically, so the allocations stay owner-controlled.
        schedule: () => {
          try {
            return parseMonthlySchedule(env.MONTHLY_PAYMENT_SCHEDULE);
          } catch {
            console.error("MONTHLY_PAYMENT_SCHEDULE is invalid");
            return null;
          }
        },
        now,
        releaseReserve: async (input) => {
          const service = monthlyReleaseService(env, input.network);
          if (!service)
            throw new MonthlyPaymentError(
              503,
              "release_unavailable",
              "Reserve checks are unavailable on this network. Retry later.",
            );
          const response = await service.fetch(
            new Request("https://monthly-release/v1/monthly-reserve-release", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(input),
            }),
          );
          if (!response.ok)
            throw new MonthlyPaymentError(
              409,
              "release_held",
              "The reserve could not be proved safe to release. No funds moved. Retry the check.",
            );
          return (await readBoundedJson(
            response,
            4 * 1024 * 1024,
            "monthly reserve release",
          )) as MonthlyReleaseResult;
        },
      }),
      solanaFundingConfig: (projectId, network, vault) =>
        solanaFundingConfig(projectId, network, vault, "ordinary"),
      edgeCache: cache,
      // Binding consent names a vault recorded in the D1 project registry for
      // a served network; a vault of any other network is unknown.
      paymentDeployments: async () =>
        registryDeployments(parsePaymentNetworks(env.PAYMENT_NETWORKS)),
      bindingVersion: async (network, vault, actor) => {
        const selected = parsePaymentNetworks(env.PAYMENT_NETWORKS).find(
          (name) => name === network,
        );
        if (!selected || ESCROW_NETWORKS[selected].family !== "evm")
          throw new Error("Binding network unavailable");
        const matches = (await registryDeployments([selected])).filter(
          (d) =>
            d.network === network &&
            d.vault.toLowerCase() === vault.toLowerCase(),
        );
        if (matches.length !== 1) throw new Error("Binding vault unavailable");
        return readEvmBindingVersion(
          {
            ...matches[0],
            rpcUrl: paymentRpcUrl(env, network),
            chainId: BigInt(ESCROW_NETWORKS[selected].chainId as string),
          } as EvmEscrowConfig,
          actor,
        );
      },
      ...stagingOrigins,
    });
  if (pathname.startsWith("/api/v1/points/"))
    return handlePointsApi(request, {
      tier,
      db,
      ...stagingOrigins,
      rateLimitSecret: env.TRACE_AUTH_SECRET,
      identity: env.SLOP_IDENTITY,
      x:
        env.X_CLIENT_ID && env.X_CLIENT_SECRET
          ? { clientId: env.X_CLIENT_ID, clientSecret: env.X_CLIENT_SECRET }
          : undefined,
    });
  if (pathname === "/api/v1/slopbot/value-import")
    return handleHistoricalValueImport(request, {
      adminGithubIds,
      sessionActor,
      publisher: env.SLOPBOT_VALUE_IMPORT,
    });
  if (pathname.startsWith("/api/v1/slopbot/"))
    return handleSlopbotApi(request, db);
  return handleTraceApi(request, {
    tier,
    persistence: new CloudflareTracePersistence(db, env.PRIVATE_TRACES),
    authSecret: env.TRACE_AUTH_SECRET,
    operatorGithubIds: walletOperatorGithubIds,
    bindingRecoveryForNetwork: (network) => {
      if (network === "base-mainnet") return env.BINDING_RECOVERY;
      if (network === "ethereum") return env.BINDING_RECOVERY_ETHEREUM;
      if (network === "robinhood-mainnet")
        return env.BINDING_RECOVERY_ROBINHOOD;
      return undefined;
    },
    operatorSession: sessionActor,
    now,
    randomId,
    verifyIdentityAssertion: async (assertion) => {
      const identity = await consumeIdentityAssertion(
        env.SLOP_IDENTITY,
        assertion,
        "private-trace-api",
      );
      return typeof identity === "string"
        ? null
        : { githubId: identity.githubId, githubLogin: identity.githubLogin };
    },
    privateIntakeStatus: () => privateIntakeStatus(db),
  });
}
