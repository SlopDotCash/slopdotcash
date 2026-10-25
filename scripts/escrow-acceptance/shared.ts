/**
 * Shared parts of the PRD section 21 escrow acceptance runner: the test-network
 * guard, the scenario amounts, the resumable evidence file, and the local
 * backend projection. The projection runs the real payments code (account API,
 * payments worker cron, dispatch, ledger and vault_snapshots) against a SQLite
 * file with every D1 migration, so the run exercises the same path as staging.
 * Nothing here reads, stores or prints a private key.
 */
import { Database } from "bun:sqlite";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { D1TransactionalDatabase as D1Database } from "../../backend/d1";
import {
  dispatchPayment,
  type PaymentExecutor,
} from "../../backend/payments/dispatch";
import { handlePaymentsApi } from "../../backend/payments/handler";
import { projectVaultSnapshots } from "../../backend/payments/vault-snapshots";
import type { VaultTotals } from "../../contracts/vault-totals";
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
  paymentDeploymentRecord,
} from "../../src/lib/escrow-policy.mjs";
import { fundingAssetForNetwork } from "../../src/lib/funding-address.mjs";
import { reservedGross } from "../../src/lib/payments/contracts";
import {
  assertProjectDefinition,
  CONTRIBUTION_FIELDS,
  PROJECT_SKILL_TEMPLATES,
} from "../../src/lib/project-schema.mjs";
import { applicationManifest } from "../../tests/project-application-manifest";
import { sqliteD1 } from "../../tests/sqlite-d1";
import { sha256Hex } from "../../workers/identity/crypto";
import type { JournalStore } from "../../workers/payment-executor/core";
import paymentsWorker, {
  type PaymentDeployment,
  type PaymentsWorkerEnvironment,
} from "../../workers/payments/index";

export const EVIDENCE_SCHEMA = "slop-escrow-acceptance:v1";
/** The runner stops with this exit code when it must wait for a delay or finality. */
export const WAITING_EXIT_CODE = 75;
export const ACCEPTANCE_NETWORKS = [
  "base-sepolia",
  "ethereum-sepolia",
  "robinhood-testnet",
  "solana-devnet",
  "solana-localnet",
] as const;
export type AcceptanceNetwork = (typeof ACCEPTANCE_NETWORKS)[number];
/** Base, Ethereum and Robinhood Chain mainnet chain ids. The runner never signs on them. */
export const MAINNET_EVM_CHAIN_IDS = new Set(["1", "8453", "4663"]);
export const SOLANA_GENESIS = {
  mainnet: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
  devnet: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  testnet: "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY",
} as const;
/**
 * ProjectEscrow.payoutFee and withdrawalFee, and the program's commit and
 * withdraw: both 2%, rounded up, ceil(gross / 50) (#907).
 */
export const PAYOUT_FEE_DIVISOR = 50n;
const twoPercentFee = (gross: bigint) =>
  (gross + PAYOUT_FEE_DIVISOR - 1n) / PAYOUT_FEE_DIVISOR;
export type ActorRole = "registered" | "walletless";
export interface TestActor {
  role: ActorRole;
  githubUserId: string;
  login: string;
}
/**
 * Test actor GitHub ids lie above the range GitHub has issued, so they name no
 * real account. Each asset gets its own pair, so the second actor is truly
 * walletless in every vault until the scenario registers it.
 */
export function testActor(role: ActorRole, assetIndex: number): TestActor {
  if (!Number.isInteger(assetIndex) || assetIndex < 0 || assetIndex > 9)
    throw new Error("At most ten assets per run");
  const n = role === "registered" ? 1 : 2;
  return {
    role,
    githubUserId: `90000000${assetIndex}00${n}`,
    login: `slop-acceptance-${assetIndex}-${role === "registered" ? "a" : "b"}`,
  };
}

export function isAcceptanceNetwork(value: string): value is AcceptanceNetwork {
  return (ACCEPTANCE_NETWORKS as readonly string[]).includes(value);
}
export function isLoopbackRpc(rpcUrl: string): boolean {
  const { hostname } = new URL(rpcUrl);
  return ["127.0.0.1", "localhost", "[::1]"].includes(hostname);
}
/** The RPC host only: a provider URL can carry an API key in its path or query. */
export function rpcHost(rpcUrl: string): string {
  return new URL(rpcUrl).host;
}

/** Refuses every mainnet chain id and any chain id other than the named test network's. */
export function assertEvmTestChain(network: string, observed: bigint): string {
  const chainId = observed.toString();
  if (MAINNET_EVM_CHAIN_IDS.has(chainId))
    throw new Error(`Refusing mainnet chain id ${chainId}`);
  const policy = Object.hasOwn(ESCROW_NETWORKS, network)
    ? ESCROW_NETWORKS[network as keyof typeof ESCROW_NETWORKS]
    : undefined;
  if (policy?.family !== "evm" || policy.testnet !== true)
    throw new Error(`${network} is not an EVM test network`);
  if (policy.chainId !== chainId)
    throw new Error(
      `RPC chain id ${chainId} is not ${network} (${policy.chainId})`,
    );
  return chainId;
}
/** Refuses Solana mainnet; devnet must be devnet and localnet must be a loopback validator. */
export function assertSolanaTestCluster(
  network: string,
  genesisHash: string,
  rpcUrl: string,
) {
  if (genesisHash === SOLANA_GENESIS.mainnet)
    throw new Error("Refusing Solana mainnet");
  if (network === "solana-devnet" && genesisHash !== SOLANA_GENESIS.devnet)
    throw new Error("RPC genesis hash is not Solana devnet");
  if (
    network === "solana-localnet" &&
    (!isLoopbackRpc(rpcUrl) ||
      genesisHash === SOLANA_GENESIS.devnet ||
      genesisHash === SOLANA_GENESIS.testnet)
  )
    throw new Error("solana-localnet needs a loopback local validator");
  if (network !== "solana-devnet" && network !== "solana-localnet")
    throw new Error(`${network} is not a Solana test cluster`);
}

/**
 * The section 21 figures in base units. One unit is 10^decimals base units.
 * A divisor above 1 scales every figure down by the same power of ten when a
 * faucet cannot supply 1,000 units; the evidence then records fullScale false.
 */
export function scenarioAmounts(decimals: number, divisor: bigint) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
    throw new Error("Invalid asset decimals");
  const whole = 10n ** BigInt(decimals);
  if (divisor < 1n || whole % divisor !== 0n)
    throw new Error(
      `Unit divisor ${divisor} must divide 10^${decimals} exactly`,
    );
  const unit = whole / divisor;
  const awardA = 100n * unit;
  const awardB = 50n * unit;
  const withdrawGross = 1000n * unit - awardA - awardB;
  const result = {
    unit,
    fullScale: divisor === 1n,
    ownerDeposit: 900n * unit,
    thirdPartyDeposit: 100n * unit,
    totalDeposit: 1000n * unit,
    awardA,
    awardB,
    feeA: twoPercentFee(awardA),
    feeB: twoPercentFee(awardB),
    netA: awardA - twoPercentFee(awardA),
    netB: awardB - twoPercentFee(awardB),
    withdrawGross,
    withdrawFee: twoPercentFee(withdrawGross),
  };
  if (result.netA !== 98n * unit || result.netB !== 49n * unit)
    throw new Error("Unit is too small for exact section 21 figures");
  return result;
}
export type ScenarioAmounts = ReturnType<typeof scenarioAmounts>;
export function amountsText(amounts: ScenarioAmounts) {
  return Object.fromEntries(
    Object.entries(amounts).map(([key, value]) => [
      key,
      typeof value === "bigint" ? value.toString() : value,
    ]),
  );
}

/** One recorded chain transaction. Raw bytes are stored before broadcast so a rerun never signs twice. */
export interface StepRecord {
  transactionId: string;
  raw?: string;
  from: string;
  status?: "success" | "reverted";
  block?: string;
  note?: string;
  /** Solana: the blockhash height after which an unlanded transaction can never land. */
  lastValidBlockHeight?: number;
}
export interface AssetEvidence {
  address: string;
  decimals: number;
  referenceStablecoin: boolean;
  amounts: Record<string, string | boolean>;
  projectId: string;
  onchainProjectId: string;
  vault: string | null;
  deployment: Record<
    string,
    string | null | import("../../contracts/evm/adapter").EvmUpgrade
  >;
  steps: Record<string, StepRecord>;
  checks: Record<string, unknown>;
  status: "pending" | "passed";
}
/**
 * section-21 is the funded-award run above. extended adds the #902 scenarios
 * that section 21 does not cover: private bounty 75/25, monthly commitment,
 * the walletless destination lifecycle, an interrupted send, a failed
 * recipient, and fee claims with a frozen fee destination.
 */
export const SUITES = ["section-21", "extended"] as const;
export type Suite = (typeof SUITES)[number];
/** One extended scenario on one network: its vaults, transactions and checks. */
export interface ScenarioEvidence {
  status: "pending" | "passed" | "failed";
  /** Why the scenario waits or failed. */
  reason?: string;
  assets: string[];
  vaults: Record<string, string>;
  steps: Record<string, StepRecord>;
  checks: Record<string, unknown>;
}
export interface Evidence {
  schema: typeof EVIDENCE_SCHEMA;
  /** Absent in section-21 evidence written before the extended suite. */
  suite?: Suite;
  network: AcceptanceNetwork;
  mode: "public-testnet" | "local";
  rpcHost: string;
  chain: Record<string, string>;
  runId: string;
  sourceCommit: string;
  startedAt: string;
  updatedAt: string;
  status: "running" | "waiting" | "passed" | "failed";
  waiting: { reason: string; until: string | null } | null;
  notice: string;
  roles: Record<string, string>;
  /** Destination wallets of the two test actors; each asset has its own actor ids. */
  actors: Record<ActorRole, string>;
  deviations: string[];
  assets: AssetEvidence[];
  /** Extended suite only, keyed by scenario name. */
  scenarios?: Record<string, ScenarioEvidence>;
  errors: string[];
}
export function sourceCommit(): string {
  const cwd = resolve(import.meta.dir, "..", "..");
  const unchanged = Bun.spawnSync(["git", "diff", "--quiet", "HEAD", "--"], {
    cwd,
  });
  if (unchanged.exitCode !== 0)
    throw new Error(
      "Acceptance evidence requires a clean tracked tree. Commit or restore tracked changes before signing; untracked evidence and journals may remain.",
    );
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], {
    cwd,
  });
  const commit = result.stdout.toString().trim();
  if (result.exitCode !== 0 || !/^[0-9a-f]{40}$/.test(commit))
    throw new Error("Source commit unavailable");
  return commit;
}
export function evidencePath(directory: string) {
  return join(directory, "evidence.json");
}
export async function loadEvidence(
  directory: string,
): Promise<Evidence | null> {
  const path = evidencePath(directory);
  if (!existsSync(path)) return null;
  const evidence = (await Bun.file(path).json()) as Evidence;
  if (evidence.schema !== EVIDENCE_SCHEMA)
    throw new Error(`${path} is not ${EVIDENCE_SCHEMA} evidence`);
  if (evidence.sourceCommit !== sourceCommit())
    throw new Error(
      `This evidence belongs to source ${evidence.sourceCommit}. Resume with that source, or preserve this directory and use a new directory for the current source.`,
    );
  return evidence;
}
/** Atomic replace, so an interrupted write never leaves half a state file. */
export async function saveEvidence(directory: string, evidence: Evidence) {
  evidence.updatedAt = new Date().toISOString();
  const path = evidencePath(directory);
  await Bun.write(`${path}.tmp`, `${JSON.stringify(evidence, null, 2)}\n`);
  renameSync(`${path}.tmp`, path);
}
export function newEvidence(input: {
  network: AcceptanceNetwork;
  suite?: Suite;
  rpcUrl: string;
  chain: Record<string, string>;
  roles: Record<string, string>;
  actors: Evidence["actors"];
  runId?: string;
}): Evidence {
  const now = new Date().toISOString();
  return {
    schema: EVIDENCE_SCHEMA,
    suite: input.suite ?? "section-21",
    network: input.network,
    mode: isLoopbackRpc(input.rpcUrl) ? "local" : "public-testnet",
    rpcHost: rpcHost(input.rpcUrl),
    chain: input.chain,
    runId: input.runId ?? crypto.randomUUID(),
    sourceCommit: sourceCommit(),
    startedAt: now,
    updatedAt: now,
    status: "running",
    waiting: null,
    notice: isLoopbackRpc(input.rpcUrl)
      ? "Local fork or local validator run with throwaway keys. It proves the runner, not a public test network, and it is not mainnet evidence."
      : "Public test network run with test assets. Test assets are not real funds and this is not mainnet evidence.",
    roles: input.roles,
    actors: input.actors,
    deviations: [],
    assets: [],
    errors: [],
  };
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
/** A 32-byte EVM private key from the environment, as 0x-prefixed hex. */
export function evmKey(name: string): `0x${string}` {
  const value = requireEnv(name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value))
    throw new Error(`${name} must be a 0x-prefixed 32-byte hex key`);
  return value as `0x${string}`;
}
/** A 32-byte Ed25519 seed from the environment, as 64 hex characters. */
export function solanaSeed(name: string): Uint8Array {
  const value = requireEnv(name);
  if (!/^[0-9a-f]{64}$/.test(value))
    throw new Error(`${name} must be a 64-character lowercase hex seed`);
  return Uint8Array.from(value.match(/../g) ?? [], (pair) =>
    Number.parseInt(pair, 16),
  );
}
export function waitPolicy() {
  const maxWait = Number(process.env.ESCROW_ACCEPTANCE_MAX_WAIT_SECONDS ?? 600);
  const poll = Number(process.env.ESCROW_ACCEPTANCE_POLL_SECONDS ?? 15);
  if (!Number.isInteger(maxWait) || maxWait < 0)
    throw new Error("ESCROW_ACCEPTANCE_MAX_WAIT_SECONDS must be an integer");
  if (!Number.isInteger(poll) || poll < 1)
    throw new Error(
      "ESCROW_ACCEPTANCE_POLL_SECONDS must be a positive integer",
    );
  return { maxWaitMs: maxWait * 1000, pollMs: poll * 1000 };
}
export function unitDivisor(): bigint {
  const value = process.env.ESCROW_ACCEPTANCE_UNIT_DIVISOR ?? "1";
  if (!/^[1-9][0-9]*$/.test(value) || !/^10*$/.test(value))
    throw new Error("ESCROW_ACCEPTANCE_UNIT_DIVISOR must be a power of ten");
  return BigInt(value);
}
export function sha256Text(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/** A step that cannot finish yet. The runner polls, then saves state and exits for a later rerun. */
export class Waiting extends Error {
  constructor(
    reason: string,
    readonly until: Date | null = null,
  ) {
    super(reason);
  }
}

/** JSON-RPC 2.0 call that keeps the node's error message, which replay checks record. */
export async function jsonRpc(
  url: string,
  method: string,
  params: unknown[],
): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`${method}: RPC HTTP ${response.status}`);
  const body = (await response.json()) as {
    result?: unknown;
    error?: { message?: string; data?: unknown };
  };
  if (body.error)
    throw new RpcError(
      `${method}: ${body.error.message ?? "RPC error"}`,
      body.error.data,
    );
  return body.result;
}
export class RpcError extends Error {
  constructor(
    message: string,
    readonly data: unknown,
  ) {
    super(message);
  }
}

/** A durable executor journal, as the hosted Durable Object storage keeps it. */
function journalStore(file: string): JournalStore {
  const database = new Database(file);
  database.exec(
    "CREATE TABLE IF NOT EXISTS journal(key TEXT PRIMARY KEY,value TEXT NOT NULL)",
  );
  let gate = Promise.resolve();
  const store: JournalStore = {
    async get<T>(key: string) {
      const row = database
        .query<{ value: string }, [string]>(
          "SELECT value FROM journal WHERE key=?",
        )
        .get(key);
      return row ? (JSON.parse(row.value) as T) : undefined;
    },
    async put<T>(key: string, value: T) {
      database
        .prepare(
          "INSERT INTO journal VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, JSON.stringify(value));
    },
    async transaction<T>(callback: (txn: JournalStore) => Promise<T>) {
      const previous = gate;
      let unlock = () => {};
      gate = new Promise<void>((done) => {
        unlock = done;
      });
      await previous;
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = await callback(store);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      } finally {
        unlock();
      }
    },
  };
  return store;
}

export interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

/** A SQLite file beside the evidence with every D1 migration, kept across reruns. */
function migratedDatabase(directory: string, name: string) {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, name);
  const migrations = existsSync(file)
    ? []
    : readdirSync(resolve(import.meta.dir, "..", "..", "migrations"))
        .filter((entry) => entry.endsWith(".sql"))
        .sort();
  const { db, sqlite } = sqliteD1(migrations, file);
  sqlite.exec("PRAGMA foreign_keys=ON");
  return { db: db as unknown as D1Database, sqlite };
}

/**
 * The project registry that the payments Worker reads as REGISTRY_DB: a
 * separate SQLite file with every migration, as configure.mjs binds the
 * registry apart from PAYMENTS_DB. Each acceptance vault is one project whose
 * current manifest records that vault as its escrow deployment, so the
 * dispatcher finds the vault the same way it finds a production vault.
 */
export class AcceptanceRegistry {
  readonly db: D1Database;
  readonly sqlite: Database;
  constructor(directory: string) {
    const { db, sqlite } = migratedDatabase(directory, "registry.sqlite");
    this.db = db;
    this.sqlite = sqlite;
  }
  /**
   * Writes revision 1 of each vault's project, or confirms the stored one
   * when the run resumes, and returns the worker records that the
   * dispatcher derives from the same manifests. A stored manifest that
   * differs stops the run: a recorded escrow deployment never changes.
   */
  record(
    projects: {
      projectId: string;
      effectiveCycle: string;
      deployment: EscrowDeployment;
      /** Paused unless a scenario needs a project-operated keeper to admit a month. */
      status?: "paused" | "active";
    }[],
  ): PaymentDeployment[] {
    return projects.map(({ projectId, effectiveCycle, deployment, status }) => {
      const manifest = acceptanceManifest(
        projectId,
        effectiveCycle,
        deployment,
        status,
      );
      const text = JSON.stringify(manifest);
      const digest = sha256Text(text);
      const stored = this.sqlite
        .query<{ manifest_sha256: string }, [string]>(
          "SELECT manifest_sha256 FROM projects WHERE id=?",
        )
        .get(projectId);
      if (stored && stored.manifest_sha256 !== digest)
        throw new Error(
          `Registry project ${projectId} records another escrow deployment`,
        );
      if (!stored) {
        const at = new Date().toISOString();
        this.sqlite.transaction(() => {
          this.sqlite
            .prepare(
              "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,actor_github_id,actor_github_login,created_at) VALUES(?,1,?,?,?,?,?,?)",
            )
            .run(
              projectId,
              text,
              digest,
              "Record escrow acceptance deployment",
              "0",
              "escrow-acceptance",
              at,
            );
          this.sqlite
            .prepare(
              "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,?,1,?,?,?,?)",
            )
            .run(projectId, manifest.status, text, digest, at, at);
        })();
      }
      return paymentDeploymentRecord(
        projectId,
        deployment,
      ) as unknown as PaymentDeployment;
    });
  }
}

/**
 * A paused test project with one escrow deployment, checked by the same
 * schema as an admin revision. Steward, terms and repository come from the
 * repository's own Slop fixture and the skills use the generated templates;
 * the legacy payment path stays disabled, as every escrow project requires.
 */
function acceptanceManifest(
  projectId: string,
  effectiveCycle: string,
  deployment: EscrowDeployment,
  status: "paused" | "active" = "paused",
) {
  const fixture = JSON.parse(
    readFileSync(
      resolve(
        import.meta.dir,
        "..",
        "..",
        "tests",
        "fixtures",
        "projects",
        "slopdotcash.json",
      ),
      "utf8",
    ),
  );
  const chain = ESCROW_NETWORKS[deployment.network].chain;
  return assertProjectDefinition({
    ...fixture,
    id: projectId,
    slug: projectId,
    name: `Escrow acceptance ${projectId}`,
    status,
    skill: {
      id: `contribute-to-${projectId}`,
      publishAtRoot: false,
      sourcePath: PROJECT_SKILL_TEMPLATES.contributor,
      publicPath: `/projects/${projectId}/skill.md`,
    },
    reviewSkill: {
      id: `review-${projectId}-contributions`,
      sourcePath: PROJECT_SKILL_TEMPLATES.reviewer,
    },
    contribution: Object.fromEntries(
      CONTRIBUTION_FIELDS.map((field) => [
        field,
        field === "approvedScope"
          ? "None. This project exists only for an escrow acceptance run."
          : "",
      ]),
    ),
    reward: {
      ...fixture.reward,
      chain,
      currency: fundingAssetForNetwork(chain),
      feeBasisPoints: 200,
      paymentMode: "disabled",
    },
    funding: { ...fixture.funding, recordsPath: `funding/${projectId}` },
    escrow: {
      schemaVersion: "1",
      effectiveCycle,
      chain,
      feeBasisPoints: 200,
      withdrawalFeeBasisPoints: 200,
      feeMode: "deduct-from-gross",
      deployments: [deployment],
    },
    // An active test project cannot reuse the fixture's repository: contributor
    // history keeps that repository under its own project id. It names a test
    // repository with unverified authority, pending receipts and disabled
    // payments, as the schema requires for such a project.
    ...(status === "active"
      ? (({ authority, terms, repositories, steward }) => ({
          authority,
          terms,
          repositories,
          steward,
        }))(applicationManifest(projectId, `slop-acceptance/${projectId}`))
      : {}),
  });
}

/**
 * The local backend: one SQLite file with every migration, plus one durable
 * journal per signer role. It persists beside the evidence so a rerun resumes
 * the same ledger, outbox and signed attempts.
 */
export class Projection {
  readonly db: D1Database;
  readonly sqlite: Database;
  private readonly sessions = new Map<string, string>();
  constructor(readonly directory: string) {
    const { db, sqlite } = migratedDatabase(directory, "projection.sqlite");
    this.db = db;
    this.sqlite = sqlite;
  }
  journal(role: string): JournalStore {
    return journalStore(join(this.directory, `journal-${role}.sqlite`));
  }
  /** A signed-in test member: the account API reads sessions from these tables. */
  private async session(actor: TestActor): Promise<string> {
    const known = this.sessions.get(actor.githubUserId);
    if (known) return known;
    const memberId = `acceptance-${actor.githubUserId}`;
    const now = new Date().toISOString();
    this.sqlite
      .prepare(
        "INSERT OR IGNORE INTO points_members(actor_id,github_id,login,joined_at,public) VALUES(?,?,?,?,0)",
      )
      .run(memberId, actor.githubUserId, actor.login, now);
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(32)))
      .toString("base64url")
      .slice(0, 43);
    this.sqlite
      .prepare("INSERT INTO points_sessions VALUES(?,?,?)")
      .run(
        await sha256Hex(token),
        memberId,
        new Date(Date.now() + 3_600_000).toISOString(),
      );
    this.sessions.set(actor.githubUserId, token);
    return token;
  }
  /** One account API call as the test member, through the production handler. */
  async api(
    actor: TestActor,
    path: string,
    body: unknown,
    deps: Omit<Parameters<typeof handlePaymentsApi>[1], "db">,
  ): Promise<Record<string, unknown>> {
    const response = await handlePaymentsApi(
      new Request(`https://slop.cash/api/v1/payments${path}`, {
        method: "POST",
        headers: {
          cookie: `__Host-slop_points=${await this.session(actor)}`,
          origin: "https://slop.cash",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      { ...deps, db: this.db },
    );
    const result = (await response.json()) as Record<string, unknown>;
    if (response.status !== 200)
      throw new Error(`${path} returned ${response.status}: ${result.error}`);
    return result;
  }
  /**
   * Registers the actor's payout wallet and authorizes automatic payouts with
   * the wallet's own signature, as a contributor does on the account page.
   */
  async registerWallet(
    actor: TestActor,
    chain: string,
    address: string,
    signMessage: (message: string) => Promise<string>,
    deps: Omit<Parameters<typeof handlePaymentsApi>[1], "db">,
  ): Promise<{ claimId: string; claimDigest: string }> {
    const registered = await this.api(
      actor,
      "/wallets/register",
      { chain, address },
      deps,
    );
    const claimId = String(registered.claimId);
    const authorized = this.sqlite
      .query<{ n: number }, [string]>(
        "SELECT count(*) n FROM payment_wallet_authorizations WHERE claim_id=?",
      )
      .get(claimId);
    if (!authorized?.n) {
      const challenge = await this.api(
        actor,
        "/wallets/challenge",
        { claimId },
        deps,
      );
      await this.api(
        actor,
        "/wallets/authorize",
        {
          claimId,
          challengeId: challenge.challengeId,
          signature: await signMessage(String(challenge.message)),
        },
        deps,
      );
    }
    const claim = this.sqlite
      .query<{ record_sha256: string }, [string]>(
        "SELECT record_sha256 FROM wallet_claims WHERE id=?",
      )
      .get(claimId);
    if (!claim) throw new Error("Registered wallet claim missing");
    return { claimId, claimDigest: claim.record_sha256 };
  }
  obligation(id: string) {
    return this.sqlite
      .query<
        {
          state: string;
          gross_base: string;
          fee_base: string;
          paid_transaction: string | null;
          asset_address: string;
          asset_decimals: number;
        },
        [string]
      >(
        "SELECT state,gross_base,fee_base,paid_transaction,asset_address,asset_decimals FROM payment_obligations WHERE id=?",
      )
      .get(id);
  }
  attempts(obligationId: string) {
    return this.sqlite
      .query<
        { id: string; state: string; transaction_id: string | null },
        [string]
      >(
        "SELECT id,state,transaction_id FROM payment_attempts WHERE obligation_id=? ORDER BY created_at",
      )
      .all(obligationId);
  }
  outbox(obligationId: string) {
    return (
      this.sqlite
        .query<{ state: string }, [string]>(
          "SELECT state FROM payment_outbox WHERE obligation_id=?",
        )
        .get(obligationId)?.state ?? null
    );
  }
  events(projectId: string) {
    return this.sqlite
      .query<
        { kind: string; transaction_id: string; obligation_id: string },
        [string]
      >(
        "SELECT e.kind,e.transaction_id,e.obligation_id FROM payment_events e JOIN payment_obligations o ON o.id=e.obligation_id WHERE o.project_id=? ORDER BY e.kind,e.obligation_id",
      )
      .all(projectId);
  }
}

/**
 * One payments worker cron tick: vault snapshots, finalized event scan and
 * ledger, attempt recovery, failed-attempt reconciliation and dispatch. A
 * step that is waiting for finality or a delay fails inside the tick; the
 * messages are returned so the runner can report them.
 */
export async function runPaymentsCron(
  env: PaymentsWorkerEnvironment,
): Promise<string[]> {
  try {
    await paymentsWorker.scheduled(undefined, env);
    return [];
  } catch (error) {
    const errors =
      error instanceof AggregateError
        ? error.errors.flatMap((inner) =>
            inner instanceof AggregateError ? inner.errors : [inner],
          )
        : [error];
    return errors.map((inner) =>
      inner instanceof Error ? inner.message : String(inner),
    );
  }
}

/**
 * Replays dispatch for paid obligations. A dispatch that reached the executor
 * could pay twice, so the executor here records any call and refuses it.
 */
export async function replayDispatch(
  projection: Projection,
  obligationIds: string[],
) {
  let executorCalls = 0;
  const executor: PaymentExecutor = {
    async submit() {
      executorCalls += 1;
      throw new Error("Replay reached the payment executor");
    },
  };
  const results: Record<string, unknown> = {};
  for (const id of obligationIds) {
    const attemptsBefore = projection.attempts(id).length;
    const outcome = await dispatchPayment(
      projection.db,
      executor,
      id,
      new Date(),
    );
    results[id] = {
      outcome,
      outbox: projection.outbox(id),
      attemptsBefore,
      attemptsAfter: projection.attempts(id).length,
    };
    if (
      outcome !== "unavailable" ||
      projection.attempts(id).length !== attemptsBefore ||
      projection.outbox(id) !== "paid"
    )
      throw new Error(`Replayed dispatch changed paid obligation ${id}`);
  }
  if (executorCalls !== 0)
    throw new Error("Replayed dispatch reached executor");
  return { executorCalls, results };
}

const COUNTERS = [
  "totalDeposited",
  "totalPaid",
  "totalPayoutFees",
  "totalGrossWithdrawn",
  "totalWithdrawalFees",
  "freeBalance",
  "reservedPrincipal",
  "reservedFees",
  "accruedFees",
  "reserved",
] as const;
/**
 * Compares the cached vault_snapshots row with a fresh finalized chain read
 * and with the scenario arithmetic, and the ledger with the chain counters.
 */
export async function reconcile(
  projection: Projection,
  projectId: string,
  chain: VaultTotals,
  expected: Partial<Record<(typeof COUNTERS)[number], string | null>>,
) {
  const snapshots = await projectVaultSnapshots(projection.db, projectId);
  if (snapshots.length !== 1)
    throw new Error(`Expected one vault snapshot, found ${snapshots.length}`);
  const snapshot = snapshots[0] as unknown as Record<string, unknown>;
  const mismatches: string[] = [];
  for (const key of COUNTERS) {
    if (snapshot[key] !== chain[key])
      mismatches.push(
        `${key}: vault_snapshots ${snapshot[key]} != chain ${chain[key]}`,
      );
    if (key in expected && expected[key] !== chain[key])
      mismatches.push(
        `${key}: chain ${chain[key]} != scenario ${expected[key]}`,
      );
  }
  if (
    String(snapshot.assetAddress).toLowerCase() !== chain.asset.toLowerCase() ||
    snapshot.assetDecimals !== chain.decimals
  )
    mismatches.push("vault_snapshots asset identity differs from chain");
  const ledger = projection.sqlite
    .query<{ state: string; gross_base: string; fee_base: string }, [string]>(
      "SELECT state,gross_base,fee_base FROM payment_obligations WHERE project_id=?",
    )
    .all(projectId);
  const paid = ledger.filter((row) => row.state === "paid");
  const ledgerNet = paid.reduce(
    (sum, row) => sum + BigInt(row.gross_base) - BigInt(row.fee_base),
    0n,
  );
  const ledgerFees = paid.reduce((sum, row) => sum + BigInt(row.fee_base), 0n);
  if (ledgerNet.toString() !== chain.totalPaid)
    mismatches.push(`ledger net ${ledgerNet} != chain ${chain.totalPaid}`);
  if (ledgerFees.toString() !== chain.totalPayoutFees)
    mismatches.push(
      `ledger fees ${ledgerFees} != chain ${chain.totalPayoutFees}`,
    );
  if (ledger.length !== 2 || paid.length !== 2)
    mismatches.push(
      `ledger holds ${ledger.length} obligations, ${paid.length} paid`,
    );
  const events = projection.events(projectId);
  if (
    events.filter((e) => e.kind === "reserved").length !== 2 ||
    events.filter((e) => e.kind === "paid").length !== 2
  )
    mismatches.push(`ledger holds ${events.length} events, not 2 + 2`);
  const publicApi = await reconcilePublicApi(projection, projectId, chain);
  mismatches.push(...publicApi.mismatches);
  return {
    snapshot,
    chain,
    expected,
    publicApi,
    ledger: {
      obligations: ledger.length,
      paid: paid.length,
      netPaid: ledgerNet.toString(),
      payoutFees: ledgerFees.toString(),
      events,
    },
    mismatches,
  };
}

/** One public GET through the production payments handler, as the site requests it. */
async function publicGet(projection: Projection, path: string) {
  const response = await handlePaymentsApi(
    new Request(`https://slop.cash/api/v1/payments${path}`),
    { db: projection.db },
  );
  return {
    status: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}
/**
 * Compares the public API responses that the site reads with the finalized
 * chain counters: `/vault` (the vault totals panel) and `/totals` (indexed
 * award totals). A counter the chain does not report must stay null in the
 * API and in the panel's reserved figure; it must never become "0". A project
 * with no indexed data must be unavailable (HTTP 503, or no snapshot), never a
 * row of zero totals.
 */
export async function reconcilePublicApi(
  projection: Projection,
  projectId: string,
  chain: VaultTotals,
) {
  const mismatches: string[] = [];
  const vault = await publicGet(projection, `/projects/${projectId}/vault`);
  const snapshots = (vault.body.snapshots ?? []) as Record<string, unknown>[];
  if (vault.status !== 200 || snapshots.length !== 1)
    mismatches.push(
      `public /vault returned ${vault.status} with ${snapshots.length} snapshots, not one`,
    );
  const served = snapshots[0] ?? {};
  for (const key of COUNTERS)
    if (served[key] !== chain[key])
      mismatches.push(
        `${key}: public /vault ${JSON.stringify(served[key])} != chain ${JSON.stringify(chain[key])}`,
      );
  if (
    String(served.assetAddress).toLowerCase() !== chain.asset.toLowerCase() ||
    served.assetDecimals !== chain.decimals ||
    String(served.vault).toLowerCase() !== chain.vault.toLowerCase()
  )
    mismatches.push("public /vault asset or vault identity differs from chain");
  // The "Reserved for committed awards" figure of the vault totals panel.
  const panelReserved = reservedGross(
    served as Parameters<typeof reservedGross>[0],
  );
  const chainReserved = reservedGross(chain);
  if (panelReserved !== chainReserved)
    mismatches.push(
      `panel reserved ${panelReserved} != chain reserved ${chainReserved}`,
    );

  const totals = await publicGet(projection, `/projects/${projectId}/totals`);
  const assets = (totals.body.assets ?? []) as Record<string, unknown>[];
  const row = assets.find(
    (asset) =>
      String(asset.assetAddress).toLowerCase() === chain.asset.toLowerCase(),
  );
  if (totals.status !== 200 || assets.length !== 1 || !row)
    mismatches.push(
      `public /totals returned ${totals.status} with ${assets.length} asset rows, not the vault asset`,
    );
  else {
    if (row.totalNetPaidBase !== chain.totalPaid)
      mismatches.push(
        `public /totals net paid ${row.totalNetPaidBase} != chain ${chain.totalPaid}`,
      );
    if (row.payoutFeesPaidBase !== chain.totalPayoutFees)
      mismatches.push(
        `public /totals payout fees ${row.payoutFeesPaidBase} != chain ${chain.totalPayoutFees}`,
      );
    const reserved =
      BigInt(String(row.reservedNetBase)) + BigInt(String(row.reservedFeeBase));
    if (chainReserved === null || reserved.toString() !== chainReserved)
      mismatches.push(
        `public /totals reserved ${reserved} != chain reserved ${chainReserved}`,
      );
    if (row.assetDecimals !== chain.decimals)
      mismatches.push("public /totals asset decimals differ from chain");
  }
  const coverage = totals.body.coverage as
    | { completeThrough?: unknown }
    | undefined;
  if (typeof coverage?.completeThrough !== "string")
    mismatches.push("public /totals reports no finalized coverage position");

  // Missing data: a project the cron never indexed.
  const missingId = `${projectId}-not-indexed`;
  const missingTotals = await publicGet(
    projection,
    `/projects/${missingId}/totals`,
  );
  const missingVault = await publicGet(
    projection,
    `/projects/${missingId}/vault`,
  );
  const missingSnapshots = (missingVault.body.snapshots ?? null) as
    | unknown[]
    | null;
  if (
    missingTotals.status !== 503 ||
    missingTotals.body.error !== "project_payments_not_indexed" ||
    "assets" in missingTotals.body
  )
    mismatches.push(
      `missing /totals returned ${missingTotals.status} ${JSON.stringify(missingTotals.body)}, not unavailable`,
    );
  if (
    missingVault.status !== 200 ||
    !Array.isArray(missingSnapshots) ||
    missingSnapshots.length !== 0
  )
    mismatches.push(
      `missing /vault returned ${missingVault.status} with snapshots ${JSON.stringify(missingSnapshots)}, not an empty list`,
    );
  // A counter that this vault type does not report is null on chain; check that null stays null.
  const unreported = COUNTERS.filter((key) => chain[key] === null);
  return {
    vault: { status: vault.status, snapshot: served },
    totals: { status: totals.status, row: row ?? null, coverage },
    panelReserved,
    unreportedCounters: Object.fromEntries(
      unreported.map((key) => [
        key,
        served[key] === undefined ? "absent" : served[key],
      ]),
    ),
    missing: {
      projectId: missingId,
      totals: { status: missingTotals.status, body: missingTotals.body },
      vault: { status: missingVault.status, snapshots: missingSnapshots },
    },
    mismatches,
  };
}

/**
 * Polls `step` until it stops waiting or the wait budget runs out. A Waiting
 * error past the budget propagates so the runner saves state and exits.
 */
export async function untilReady<T>(
  step: () => Promise<T>,
  policy: { maxWaitMs: number; pollMs: number },
  deadline: number,
  report: (reason: string) => void,
): Promise<T> {
  for (;;) {
    try {
      return await step();
    } catch (error) {
      if (!(error instanceof Waiting) || Date.now() + policy.pollMs > deadline)
        throw error;
      report(error.message);
      await Bun.sleep(policy.pollMs);
    }
  }
}

/** A JSON-RPC request as the fault proxy sees it. */
export interface RpcCall {
  method: string;
  params: unknown[];
}
/**
 * A loopback JSON-RPC proxy in front of the real test network RPC, for the
 * interrupted-send scenario. Armed once, it forwards the matching broadcast
 * to the node, discards the node's answer and returns HTTP 503, then fails
 * the next status lookup of the same transaction. The sender therefore
 * cannot know whether its transaction left, as after a lost connection or a
 * Worker restart. Every other request passes through unchanged.
 */
export class FaultRpc {
  readonly url: string;
  private armed: {
    send: string;
    match: (call: RpcCall) => boolean;
    lookups: string[];
    onLoss: (call: RpcCall, upstream: string) => Promise<void>;
  } | null = null;
  private lookupsToFail: string[] = [];
  private readonly server: ReturnType<typeof Bun.serve>;
  constructor(upstream: string) {
    this.server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: async (request) => {
        const text = await request.text();
        const call = JSON.parse(text) as RpcCall;
        if (this.lookupsToFail.includes(call.method)) {
          this.lookupsToFail = this.lookupsToFail.filter(
            (method) => method !== call.method,
          );
          return new Response("simulated outage", { status: 503 });
        }
        const response = await fetch(upstream, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: text,
          signal: AbortSignal.timeout(120_000),
        });
        // fetch already decoded the body, so pass it on without the upstream encoding headers.
        const body = await response.text();
        const armed = this.armed;
        if (armed && call.method === armed.send && armed.match(call)) {
          this.armed = null;
          this.lookupsToFail = [...armed.lookups];
          await armed.onLoss(call, body);
          return new Response("simulated lost response", { status: 503 });
        }
        return new Response(body, {
          status: response.status,
          headers: { "content-type": "application/json" },
        });
      },
    });
    this.url = `http://127.0.0.1:${this.server.port}`;
  }
  /** Loses the answer to the next `send` call that `match` accepts. */
  arm(input: NonNullable<FaultRpc["armed"]>) {
    this.armed = input;
  }
  get isArmed() {
    return this.armed !== null;
  }
  stop() {
    this.server.stop(true);
  }
}

/**
 * Runs each extended scenario that has not completed execution. A group shares one run
 * (for example one payments Worker cron) and marks an entry complete with
 * `checks.complete` when its own part has finished. A failure is recorded
 * on its scenario and never stops the others; a wait is recorded
 * and the run exits with WAITING_EXIT_CODE after the remaining scenarios.
 * Finality is checked before marking any entry passed, including resumed
 * evidence. A completed execution is not repeated while finality is pending.
 */
export async function runScenarios(
  run: Evidence,
  persist: () => Promise<void>,
  scenarios: [string[], (...entries: ScenarioEvidence[]) => Promise<void>][],
  finalize: (entry: ScenarioEvidence) => Promise<void>,
) {
  run.scenarios ??= {};
  const scenariosByName = run.scenarios;
  let waiting: Waiting | null = null;
  for (const [names, scenario] of scenarios) {
    const entries = names.map((name) => {
      scenariosByName[name] ??= {
        status: "pending",
        assets: [],
        vaults: {},
        steps: {},
        checks: {},
      };
      return scenariosByName[name];
    });
    let outcome: unknown = null;
    if (
      !entries.every(
        (entry) => entry.status === "passed" || entry.checks.complete === true,
      )
    ) {
      try {
        await scenario(...entries);
      } catch (error) {
        outcome = error;
      }
    }
    for (const [index, entry] of entries.entries()) {
      let entryOutcome = outcome;
      if (
        outcome === null ||
        entry.status === "passed" ||
        entry.checks.complete === true
      ) {
        // Save execution separately from finality. A later run must verify the
        // same receipts, not repeat an already completed financial scenario.
        entry.checks.complete = true;
        try {
          await finalize(entry);
          entryOutcome = null;
        } catch (error) {
          entryOutcome = error;
        }
      }
      if (entryOutcome === null) {
        entry.status = "passed";
        delete entry.reason;
      } else if (entryOutcome instanceof Waiting) {
        waiting ??= entryOutcome;
        entry.status = "pending";
        entry.reason = entryOutcome.message;
      } else {
        entry.status = "failed";
        entry.reason =
          entryOutcome instanceof Error
            ? entryOutcome.message
            : String(entryOutcome);
        console.error(`[${run.network}] ${names[index]}: ${entry.reason}`);
      }
    }
    await persist();
  }
  if (waiting) throw waiting;
  const open = Object.entries(scenariosByName).filter(
    ([, entry]) => entry.status !== "passed",
  );
  if (open.length)
    throw new Error(
      `Scenarios not passed: ${open.map(([name, entry]) => `${name} (${entry.status}: ${entry.reason})`).join("; ")}`,
    );
}

/**
 * The extended scenario figures in base units, scaled like scenarioAmounts.
 * A private bounty of 100 pays 75 and 25 (PRD section 8); ordinary awards pay
 * ceil(gross / 50) as the fee. The selected figures are exact multiples.
 */
export function extendedAmounts(decimals: number, divisor: bigint) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
    throw new Error("Invalid asset decimals");
  const whole = 10n ** BigInt(decimals);
  if (divisor < 1n || whole % divisor !== 0n)
    throw new Error(
      `Unit divisor ${divisor} must divide 10^${decimals} exactly`,
    );
  const unit = whole / divisor;
  if ((50n * unit) % PAYOUT_FEE_DIVISOR !== 0n)
    throw new Error("Unit is too small for exact scenario figures");
  const award = (units: bigint) => {
    const gross = units * unit;
    return {
      gross,
      fee: gross / PAYOUT_FEE_DIVISOR,
      net: gross - gross / PAYOUT_FEE_DIVISOR,
    };
  };
  return {
    unit,
    fullScale: divisor === 1n,
    award,
    bounty: {
      deposit: 100n * unit,
      gross: 100n * unit,
      researcher: 75n * unit,
      fee: 25n * unit,
    },
  };
}

/** Extended-suite test actors: ids above GitHub's issued range, one set per scenario. */
export function scenarioActor(scenario: number, n: number): TestActor {
  if (![scenario, n].every((v) => Number.isInteger(v) && v >= 0 && v <= 9))
    throw new Error("Invalid scenario actor");
  return {
    role: "walletless",
    githubUserId: `91000000${scenario}${n}`,
    login: `slop-acceptance-x${scenario}-${n}`,
  };
}

/**
 * The monthly period whose commitment window is open at `now` (UTC seconds):
 * the window of month M runs from 72 hours after M ends to 72 hours after the
 * next month ends (MONTHLY_CUTOFF_DELAY in both contracts).
 */
export function openMonthlyPeriod(now: bigint) {
  const date = new Date(Number(now) * 1000);
  const shift = (months: number) => {
    const d = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1),
    );
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  };
  const monthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  const back = date.getTime() < monthStart + 72 * 3_600_000 ? 2 : 1;
  return {
    open: shift(-back),
    next: shift(1 - back),
    closed: shift(-back - 1),
  };
}
