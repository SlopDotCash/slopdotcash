/**
 * Deploy-time payout readiness report. For each registry network it states
 * whether the reviewed escrow deployments (factory and identity attester),
 * the attester and relayer Worker configurations, the finalized RPC endpoint
 * and the executor switch are in place. It reads public configuration and
 * the operator's local RPC map; it never prints an RPC URL, reads a key,
 * signs, deploys or changes a value. A network is ready only when every
 * check passes, including that the dispatcher reads its vaults from the
 * registry database (`SLOP_DB` in wrangler.toml) through `REGISTRY_DB`. `--require NETWORK` makes the command fail unless that
 * network is ready, so a release step can stop on it; it requires `--probe`.
 *
 *   PAYMENT_RPC_URLS='{"base-sepolia":"https://…"}' \
 *   bun scripts/check-payout-readiness.ts \
 *     --config .generated/slop-payments-base-sepolia-attester.json \
 *     --config .generated/slop-payments-base-sepolia-relayer.json \
 *     --config .generated/slop-payments-base-sepolia-dispatcher.json \
 *     [--registry-origin https://staging.slop.cash] [--probe] \
 *     [--require base-sepolia]
 */
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
  ESCROW_NETWORKS,
  type EscrowDeployment,
  type PaymentDeploymentRecord,
  paymentDeploymentRecord,
} from "../src/lib/escrow-policy.mjs";
import { assertProjectRegistry } from "../src/lib/project-schema.mjs";
import { HISTORICAL_PROJECTS } from "../src/lib/projects.mjs";
import { mainnetExecutionEnabled } from "../workers/payment-executor/mainnet-execution.mjs";
import { parsePaymentNetworks } from "../workers/payments/deployments";
import { readRegistryDatabase } from "../workers/payments/registry-database.mjs";
import { fetchProjectRegistry } from "./sync-project-registry.mjs";

type Network = EscrowDeployment["network"];

/** One Wrangler configuration as `workers/payment-executor/configure.mjs` writes it. */
export interface StackConfig {
  name?: unknown;
  vars?: Record<string, unknown>;
  services?: { binding?: unknown; service?: unknown }[];
  d1_databases?: { binding?: unknown; database_id?: unknown }[];
}

/** RPC probe result: `finalized` proves chain identity and a finalized head. */
export type RpcProbe =
  | "finalized"
  | "wrong-chain"
  | "no-finalized-head"
  | "unreachable";

export interface NetworkReadiness {
  network: Network;
  testnet: boolean;
  deployments: number;
  /** EVM: every deployment names its factory, factory code digest and registrar. Solana has no factory. */
  factory: "configured" | "missing" | "not-applicable";
  /** Every deployment names an identity authority and an attester Worker pins exactly the registry deployments. */
  attester: "configured" | "missing";
  rpc: "configured" | "missing" | RpcProbe;
  /** The relayer pins the deployments, the dispatcher serves the network, binds the executor and reads the registry database, and a mainnet's reviewed switch is on. */
  executor: "enabled" | "missing" | "off-by-review";
  ready: boolean;
  reasons: string[];
}

export interface ReadinessInput {
  /** Current registry manifests (D1 API or the synced snapshot). */
  registry: unknown;
  /** D1 database id of the project registry (the Pages SLOP_DB). */
  registryDatabaseId: string;
  configs: readonly StackConfig[];
  /** The operator's PAYMENT_RPC_URLS map, or undefined when not supplied. */
  rpcUrls?: Record<string, unknown>;
  /** The operator's PAYMENT_SOLANA_GENESIS map, or undefined when not supplied. */
  solanaGenesis?: Record<string, unknown>;
  probes?: Partial<Record<Network, RpcProbe>>;
  executionEnabled?: (network: string) => boolean;
}

function signerNetworks(config: StackConfig, role: "attester" | "relayer") {
  if (config.vars?.SIGNER_ROLE !== role) return new Map<string, unknown[]>();
  const pinned = JSON.parse(String(config.vars.PAYMENT_DEPLOYMENTS ?? "[]"));
  if (!Array.isArray(pinned))
    throw new TypeError("Signer PAYMENT_DEPLOYMENTS must be an array");
  const byNetwork = new Map<string, unknown[]>();
  for (const record of pinned)
    byNetwork.set(record?.network, [
      ...(byNetwork.get(record?.network) ?? []),
      record,
    ]);
  return byNetwork;
}

const byProject = (a: { projectId: string }, b: { projectId: string }) =>
  a.projectId.localeCompare(b.projectId);

export function payoutReadiness(input: ReadinessInput): NetworkReadiness[] {
  const executionEnabled = input.executionEnabled ?? mainnetExecutionEnabled;
  const records: PaymentDeploymentRecord[] = [];
  for (const project of assertProjectRegistry(input.registry))
    for (const deployment of project.escrow?.deployments ?? [])
      records.push(paymentDeploymentRecord(project.id, deployment));
  const dispatchers = input.configs.filter(
    (config) =>
      config.vars?.PAYMENT_NETWORKS !== undefined &&
      config.vars.SIGNER_ROLE === undefined,
  );
  const servedBy = (network: string) =>
    dispatchers.filter((config) =>
      parsePaymentNetworks(config.vars?.PAYMENT_NETWORKS).includes(
        network as Network,
      ),
    );
  // The dispatcher finds vaults only in REGISTRY_DB. Any other database
  // (for example the isolated payment database) has no registry rows.
  const readsRegistry = (config: StackConfig) => {
    const bindings = (config.d1_databases ?? []).filter(
      (database) => database.binding === "REGISTRY_DB",
    );
    return (
      bindings.length === 1 &&
      bindings[0].database_id === input.registryDatabaseId
    );
  };
  const pins = (role: "attester" | "relayer", network: string) =>
    input.configs.flatMap(
      (config) => signerNetworks(config, role).get(network) ?? [],
    );
  return (Object.keys(ESCROW_NETWORKS) as Network[]).map((network) => {
    const policy = ESCROW_NETWORKS[network];
    const reasons: string[] = [];
    const deployments = records
      .filter((record) => record.network === network)
      .sort(byProject);
    if (!deployments.length) reasons.push("no reviewed escrow deployment");

    let factory: NetworkReadiness["factory"] = "not-applicable";
    if (policy.family === "evm") {
      factory =
        deployments.length > 0 &&
        deployments.every(
          (d) => d.factory && d.factoryCodeSha256 && d.registrar,
        )
          ? "configured"
          : "missing";
      if (factory === "missing") reasons.push("factory address not recorded");
    }

    const samePins = (role: "attester" | "relayer") => {
      const pinned = pins(role, network) as { projectId: string }[];
      return (
        deployments.length > 0 &&
        isDeepStrictEqual([...pinned].sort(byProject), deployments)
      );
    };
    const attester: NetworkReadiness["attester"] =
      deployments.length > 0 &&
      deployments.every((d) => d.identityAuthority) &&
      samePins("attester")
        ? "configured"
        : "missing";
    if (attester === "missing")
      reasons.push(
        "attester Worker does not pin exactly the registry deployments",
      );

    let rpc: NetworkReadiness["rpc"] = "missing";
    const url = input.rpcUrls?.[network];
    if (typeof url === "string" && /^https:\/\/[^\s]+$/.test(url))
      rpc = input.probes?.[network] ?? "configured";
    if (rpc === "missing") reasons.push("no https RPC endpoint configured");
    else if (rpc !== "configured" && rpc !== "finalized")
      reasons.push(`RPC probe: ${rpc}`);
    if (
      policy.family === "solana" &&
      input.solanaGenesis?.[network] !== policy.genesisHash
    )
      reasons.push("PAYMENT_SOLANA_GENESIS does not match the registry");

    const binding =
      policy.family === "evm"
        ? "EVM_PAYMENT_EXECUTOR"
        : "SOLANA_PAYMENT_EXECUTOR";
    let executor: NetworkReadiness["executor"] = "enabled";
    if (!samePins("relayer")) {
      executor = "missing";
      reasons.push(
        "relayer Worker does not pin exactly the registry deployments",
      );
    }
    const serving = servedBy(network);
    if (
      !serving.length ||
      !serving.every((config) =>
        (config.services ?? []).some((service) => service.binding === binding),
      )
    ) {
      executor = "missing";
      reasons.push(`dispatcher does not serve the network with ${binding}`);
    }
    if (serving.length && !serving.every(readsRegistry)) {
      executor = "missing";
      reasons.push(
        "dispatcher REGISTRY_DB is not the project registry database",
      );
    }
    if (!policy.testnet && !executionEnabled(network)) {
      executor = "off-by-review";
      reasons.push("MAINNET_EXECUTION is off for this network");
    }
    return {
      network,
      testnet: policy.testnet,
      deployments: deployments.length,
      factory,
      attester,
      rpc,
      executor,
      ready: reasons.length === 0,
      reasons,
    };
  });
}

async function call(url: string, method: string, params: unknown[]) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("RPC unavailable");
  const body = (await response.json()) as { result?: unknown; error?: unknown };
  if (body.error || !("result" in body)) throw new Error("RPC failed");
  return body.result;
}

/** Read-only identity and finality check of one RPC endpoint. */
export async function probeRpc(
  network: Network,
  url: string,
): Promise<RpcProbe> {
  const policy = ESCROW_NETWORKS[network];
  try {
    if (policy.family === "evm") {
      if (
        BigInt(String(await call(url, "eth_chainId", []))) !==
        BigInt(policy.chainId ?? -1)
      )
        return "wrong-chain";
      const head = (await call(url, "eth_getBlockByNumber", [
        "finalized",
        false,
      ])) as { number?: unknown; hash?: unknown } | null;
      return head &&
        typeof head.number === "string" &&
        /^0x(?:0|[1-9a-f][0-9a-f]*)$/iu.test(head.number) &&
        typeof head.hash === "string" &&
        /^0x[0-9a-f]{64}$/iu.test(head.hash)
        ? "finalized"
        : "no-finalized-head";
    }
    if ((await call(url, "getGenesisHash", [])) !== policy.genesisHash)
      return "wrong-chain";
    const slot = await call(url, "getSlot", [{ commitment: "finalized" }]);
    return typeof slot === "number" && Number.isSafeInteger(slot) && slot > 0
      ? "finalized"
      : "no-finalized-head";
  } catch {
    return "unreachable";
  }
}

function parseMap(name: string): Record<string, unknown> | undefined {
  const value = process.env[name];
  if (value === undefined) return undefined;
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new TypeError(`${name} must be a JSON object`);
  return parsed;
}

if (import.meta.main) {
  try {
    const configPaths: string[] = [];
    const required: string[] = [];
    let origin: string | undefined;
    let probe = false;
    const args = process.argv.slice(2);
    for (let index = 0; index < args.length; index++) {
      const flag = args[index];
      if (flag === "--probe") probe = true;
      else if (
        ["--config", "--require", "--registry-origin"].includes(flag) &&
        args[index + 1] &&
        !args[index + 1].startsWith("--")
      ) {
        const value = args[++index];
        if (flag === "--config") configPaths.push(value);
        else if (flag === "--require") required.push(value);
        else if (origin === undefined) origin = value;
        else throw new TypeError("Give --registry-origin once");
      } else
        throw new TypeError(
          "Usage: check-payout-readiness.ts [--config PATH]... [--registry-origin URL] [--probe] [--require NETWORK]...",
        );
    }
    for (const network of required)
      if (!Object.hasOwn(ESCROW_NETWORKS, network))
        throw new TypeError(`Unknown registry network: ${network}`);
    // Without the probe a configured URL proves neither chain identity nor
    // finality, so a required network must be probed.
    if (required.length && !probe)
      throw new TypeError("--require needs --probe");
    const registry = origin
      ? (await fetchProjectRegistry(origin)).projects
      : HISTORICAL_PROJECTS;
    const configs = await Promise.all(
      configPaths.map(
        async (path) => JSON.parse(await readFile(path, "utf8")) as StackConfig,
      ),
    );
    const rpcUrls = parseMap("PAYMENT_RPC_URLS");
    const probes: Partial<Record<Network, RpcProbe>> = {};
    if (probe)
      for (const [network, url] of Object.entries(rpcUrls ?? {}))
        if (Object.hasOwn(ESCROW_NETWORKS, network) && typeof url === "string")
          probes[network as Network] = await probeRpc(network as Network, url);
    const report = payoutReadiness({
      registry,
      registryDatabaseId: (await readRegistryDatabase()).database_id,
      configs,
      rpcUrls,
      solanaGenesis: parseMap("PAYMENT_SOLANA_GENESIS"),
      probes,
    });
    for (const row of report)
      process.stdout.write(
        `${row.ready ? "READY    " : "NOT READY"} ${row.network.padEnd(18)} deployments=${row.deployments} factory=${row.factory} attester=${row.attester} rpc=${row.rpc} executor=${row.executor}${row.reasons.length ? ` | ${row.reasons.join("; ")}` : ""}\n`,
      );
    process.stdout.write(
      `${JSON.stringify({ schemaVersion: "1", networks: report })}\n`,
    );
    const blocked = required.filter(
      (network) => !report.find((row) => row.network === network)?.ready,
    );
    if (blocked.length) {
      process.stderr.write(
        `[Slop] payout readiness refused: ${blocked.join(", ")} not ready\n`,
      );
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(
      `[Slop] payout readiness check failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
