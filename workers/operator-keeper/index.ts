import { validateBudget } from "../../scripts/payment-keeper/budget";
import {
  type KeeperConfiguration,
  type KeeperDependencies,
  type KeeperResult,
  runKeeper,
} from "../../scripts/payment-keeper/keeper";
import { keeperSigners } from "../../scripts/payment-keeper/signer";
import { decodeBase58Bytes } from "../../src/lib/base58";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import { type OperatorStorage, openOperatorKeeperStore } from "./storage";

interface KeeperNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(request: Request): Promise<Response> };
}
export interface OperatorEnvironment {
  KEEPER: KeeperNamespace;
  KEEPER_MODE?: string;
  KEEPER_CONFIG?: string;
  KEEPER_EVM_PRIVATE_KEY?: string;
  KEEPER_SOLANA_SIGNER_SEED?: string;
}
function mode(env: OperatorEnvironment) {
  const value = env.KEEPER_MODE ?? "off";
  if (value !== "off" && value !== "dry_run" && value !== "execute")
    throw new Error("Select off, dry_run, or execute keeper mode");
  return value;
}
function configuration(env: OperatorEnvironment): KeeperConfiguration {
  if (!env.KEEPER_CONFIG) throw new Error("Operator configuration unavailable");
  const config = JSON.parse(env.KEEPER_CONFIG) as KeeperConfiguration;
  const family = ESCROW_NETWORKS[config.network]?.family;
  if (!family) throw new Error("Choose a reviewed network");
  if (family === "evm") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(config.signer))
      throw new Error("Invalid operator EVM address");
    config.signer = config.signer.toLowerCase();
  } else if (decodeBase58Bytes(config.signer).length !== 32) {
    throw new Error("Invalid operator Solana address");
  }
  validateBudget(config.gas);
  return config;
}
interface TickResult {
  mode: "off" | "dry_run" | "execute";
  results: KeeperResult[];
}

/** One operator-controlled object owns one network's gas wallet and its durable liabilities. */
export class OperatorKeeper {
  protected readonly store;
  private running?: Promise<TickResult>;

  constructor(
    state: { storage: OperatorStorage },
    protected readonly env: OperatorEnvironment,
  ) {
    this.store = openOperatorKeeperStore(state.storage);
  }

  protected dependencies(config: KeeperConfiguration): KeeperDependencies {
    return {
      store: this.store,
      ...(mode(this.env) === "execute"
        ? keeperSigners(config, (name) => this.env[name])
        : {}),
    };
  }

  private async tick(): Promise<TickResult> {
    const selected = mode(this.env);
    if (selected === "off") return { mode: selected, results: [] };
    const config = configuration(this.env);
    return {
      mode: selected,
      results: await runKeeper(
        config,
        this.dependencies(config),
        selected === "execute",
      ),
    };
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST" || new URL(request.url).pathname !== "/tick")
      return new Response("Not found", { status: 404 });
    // A tick yields for RPC calls. Coalesce the next cron without a timed lease
    // or a long blockConcurrencyWhile. A replacement instance resumes SQLite.
    this.running ??= this.tick().finally(() => {
      this.running = undefined;
    });
    try {
      return Response.json(await this.running);
    } catch {
      // RPC URLs and provider error bodies may contain operator credentials.
      return Response.json({ error: "keeper_run_failed" }, { status: 503 });
    }
  }
}

export default {
  async fetch(): Promise<Response> {
    // There is no public execution or inspection route.
    return new Response("Not found", { status: 404 });
  },
  async scheduled(
    _controller: unknown,
    env: OperatorEnvironment,
  ): Promise<void> {
    if (mode(env) === "off") return;
    const config = configuration(env);
    // Neither project selection nor registry changes may reset this wallet's
    // budget or nonce history. The existing journal checks registry identity.
    const id = env.KEEPER.idFromName(
      JSON.stringify([config.network, config.signer]),
    );
    const response = await env.KEEPER.get(id).fetch(
      new Request("https://keeper.internal/tick", { method: "POST" }),
    );
    if (!response.ok)
      throw new Error(
        "Operator keeper run failed; durable attempts are retained",
      );
    const result = (await response.json()) as TickResult;
    if (
      result.results.some(
        (item) =>
          item.error ||
          item.state === "unavailable" ||
          item.state === "publication-unavailable",
      )
    )
      throw new Error(
        "Operator keeper has unavailable work; durable attempts are retained",
      );
  },
};
