/// <reference path="../../workers/operator-keeper/sql.d.ts" />
/** Private testnet qualification only. Never imported by a production Worker. */
import { type Hex, keccak256, parseTransaction, stringToHex } from "viem";
import type { KeeperConfiguration } from "../../scripts/payment-keeper/keeper";
import { sha256Hex } from "../../src/lib/async-sha256.mjs";
import { ESCROW_NETWORKS } from "../../src/lib/escrow-policy.mjs";
import {
  OperatorKeeper as BaseKeeper,
  type OperatorEnvironment,
} from "../../workers/operator-keeper/index";
import type { OperatorStorage } from "../../workers/operator-keeper/storage";

interface QualificationEnvironment extends OperatorEnvironment {
  QUALIFICATION_RUN: string;
  QUALIFICATION_SOURCE: string;
  QUALIFICATION_AWARD_ID: string;
  QUALIFICATION_CONTROL_TOKEN: string;
}
interface QualificationState {
  storage: OperatorStorage & { sync(): Promise<void> };
  abort(reason: string): never;
}
type Phase = "idle" | "armed" | "paused" | "resume";
type Record = {
  run: string;
  source: string;
  configurationHash: string;
  awardId: string;
  phase: Phase;
  signatures: number;
  transactionId?: string;
  rawSha256?: string;
  journalKeySha256?: string;
  nonceSha256?: string;
  gasMaximum?: string;
  pausedInstance?: string;
  interruptedInstance?: string;
  resumedInstance?: string;
  responseStatus?: number;
};
const COMMANDS = new Set(["status", "arm", "tick", "abort"]);
const STAGING_ORIGIN = "https://staging.slop.cash";
const realFetch = globalThis.fetch.bind(globalThis);
let activeKeeper: QualificationKeeper | undefined;

// This module is a separate test-only entrypoint. Only the fixed keeper RPC
// is inspected, and the raw transaction never leaves its durable journal.
globalThis.fetch = Object.assign(
  async (
    input: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    const request = new Request(input, init);
    if (activeKeeper) await activeKeeper.beforeRpc(request);
    return realFetch(request);
  },
  { preconnect: globalThis.fetch.preconnect },
);

function configuration(env: QualificationEnvironment): KeeperConfiguration {
  if (!/^keeper-[a-z0-9-]{8,80}$/.test(env.QUALIFICATION_RUN ?? ""))
    throw new Error("A fixed qualification run is required");
  if (!env.KEEPER_CONFIG)
    throw new Error("Fixed keeper configuration is required");
  if (!/^[a-f0-9]{40}$/.test(env.QUALIFICATION_SOURCE ?? ""))
    throw new Error("The reviewed source is required");
  let config: KeeperConfiguration;
  try {
    config = JSON.parse(env.KEEPER_CONFIG) as KeeperConfiguration;
  } catch {
    throw new Error("The fixed keeper configuration is invalid");
  }
  if (!/^0x[a-f0-9]{64}$/.test(env.QUALIFICATION_AWARD_ID ?? ""))
    throw new Error("A fixed test award is required");
  const network = ESCROW_NETWORKS[config.network];
  if (network?.testnet !== true || network.family !== "evm")
    throw new Error("Only an EVM testnet qualification is permitted");
  if (
    config.apiOrigin !== STAGING_ORIGIN ||
    !/^0x[0-9a-f]{40}$/.test(config.signer)
  )
    throw new Error("The staging registry and fixed signer are required");
  if (
    !Array.isArray(config.projectIds) ||
    config.projectIds.length === 0 ||
    config.projectIds.some((id) => !/^hosted-[a-z0-9-]+$/.test(id))
  )
    throw new Error("Only the reviewed hosted test projects are permitted");
  return config;
}
function authorized(request: Request, env: QualificationEnvironment): boolean {
  const key = env.QUALIFICATION_CONTROL_TOKEN;
  const supplied = request.headers.get("authorization") ?? "";
  if (!/^[a-f0-9]{64}$/.test(key ?? "") || supplied.length !== 71) return false;
  const expected = `Bearer ${key}`;
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++)
    mismatch |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  return mismatch === 0;
}
export class QualificationKeeper extends BaseKeeper {
  private readonly instance = crypto.randomUUID();
  private readonly context: QualificationState;
  private readonly qualifiedEnv: QualificationEnvironment;
  constructor(state: QualificationState, env: QualificationEnvironment) {
    const config = configuration(env);
    super(state, env);
    this.context = state;
    this.qualifiedEnv = env;
    this.store.db.exec(
      "CREATE TABLE IF NOT EXISTS qualification_control (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL) STRICT",
    );
    this.store.db
      .query("INSERT OR IGNORE INTO qualification_control VALUES(1, ?)")
      .run(
        JSON.stringify({
          run: env.QUALIFICATION_RUN,
          source: env.QUALIFICATION_SOURCE,
          configurationHash: keccak256(stringToHex(JSON.stringify(config))),
          awardId: env.QUALIFICATION_AWARD_ID,
          phase: "idle",
          signatures: 0,
        }),
      );
  }
  private record(): Record {
    const row = this.store.db
      .query<{ value: string }, []>(
        "SELECT value FROM qualification_control WHERE id=1",
      )
      .get();
    if (!row) throw new Error("Qualification state is missing");
    const record = JSON.parse(row.value) as Record;
    if (
      record.run !== this.qualifiedEnv.QUALIFICATION_RUN ||
      record.source !== this.qualifiedEnv.QUALIFICATION_SOURCE ||
      record.awardId !== this.qualifiedEnv.QUALIFICATION_AWARD_ID ||
      record.configurationHash !==
        keccak256(stringToHex(JSON.stringify(configuration(this.qualifiedEnv))))
    )
      throw new Error(
        "Qualification state belongs to a different reviewed run",
      );
    return record;
  }
  private write(record: Record) {
    this.store.db
      .query("UPDATE qualification_control SET value=? WHERE id=1")
      .run(JSON.stringify(record));
  }
  protected override dependencies(config: KeeperConfiguration) {
    const dependencies = super.dependencies(config);
    const signer = dependencies.evmSigner;
    if (!signer) return dependencies;
    return {
      ...dependencies,
      evmSigner: {
        address: signer.address,
        signTransaction: async (
          input: Parameters<typeof signer.signTransaction>[0],
        ) => {
          const raw = await signer.signTransaction(input);
          const record = this.record();
          record.signatures += 1;
          this.write(record);
          return raw;
        },
      },
    };
  }
  async beforeRpc(request: Request) {
    const config = configuration(this.qualifiedEnv);
    if (
      request.url !== new URL(config.rpcUrl).href ||
      request.method !== "POST"
    )
      return;
    const call = (await request.clone().json()) as {
      method?: string;
      params?: unknown[];
    };
    if (call.method !== "eth_sendRawTransaction") return;
    const record = this.record();
    if (record.phase !== "armed" && record.phase !== "resume")
      throw new Error("Broadcast outside the approved qualification phase");
    const raw = call.params?.[0];
    if (typeof raw !== "string" || !/^0x[0-9a-f]+$/i.test(raw))
      throw new Error("Unexpected transaction encoding");
    const transactionId = keccak256(raw as Hex);
    if (record.phase === "resume") {
      if (transactionId !== record.transactionId)
        throw new Error("Resume would broadcast a different transaction");
      return;
    }
    const journal = this.store.db
      .query<{ key: string; value: string }, [string]>(
        "SELECT key,value FROM journal WHERE json_extract(value,'$.transactionId')=?",
      )
      .get(transactionId);
    const nonce = this.store.db
      .query<{ value: string }, [string]>(
        "SELECT value FROM journal WHERE key=?",
      )
      .get(`nonce:${ESCROW_NETWORKS[config.network].chainId}:${config.signer}`);
    const gas = this.store.db
      .query<{ maximum: string; actual: string | null }, [string]>(
        "SELECT maximum,actual FROM gas WHERE transaction_id=?",
      )
      .get(transactionId);
    const transaction = parseTransaction(raw as Hex);
    const nextNonce: unknown = nonce ? JSON.parse(nonce.value) : null;
    if (
      !journal ||
      !nonce ||
      !Number.isSafeInteger(nextNonce) ||
      typeof nextNonce !== "number" ||
      typeof transaction.nonce !== "number" ||
      nextNonce <= transaction.nonce ||
      !gas ||
      gas.actual !== null ||
      BigInt(gas.maximum) <= 0n ||
      JSON.parse(journal.value).rawTransaction !== raw ||
      JSON.parse(journal.value).obligationId !==
        this.qualifiedEnv.QUALIFICATION_AWARD_ID
    )
      throw new Error(
        "Transaction reached RPC without its durable journal and fee reservation",
      );
    record.phase = "paused";
    record.transactionId = transactionId;
    record.rawSha256 = await sha256Hex(new TextEncoder().encode(raw));
    record.journalKeySha256 = await sha256Hex(
      new TextEncoder().encode(journal.key),
    );
    record.nonceSha256 = await sha256Hex(new TextEncoder().encode(nonce.value));
    record.gasMaximum = gas.maximum;
    record.pausedInstance = this.instance;
    this.write(record);
    await this.context.storage.sync();
    // Keep real asynchronous work outstanding until the separate abort request
    // resets this object. Never forward the held transaction to the node.
    for (;;) await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  override async fetch(request: Request): Promise<Response> {
    const command = new URL(request.url).pathname.slice(1);
    if (request.method !== "POST" || !COMMANDS.has(command))
      return new Response(null, { status: 404 });
    configuration(this.qualifiedEnv);
    const record = this.record();
    if (command === "status")
      return Response.json({
        ...record,
        instance: this.instance,
      });
    if (command === "arm") {
      if (record.phase !== "idle") return new Response(null, { status: 409 });
      record.phase = "armed";
      this.write(record);
      return new Response(null, { status: 204 });
    }
    if (command === "abort") {
      if (record.phase !== "paused") return new Response(null, { status: 409 });
      record.phase = "resume";
      record.interruptedInstance = this.instance;
      this.write(record);
      await this.context.storage.sync();
      activeKeeper = undefined;
      this.context.abort(
        "Testnet keeper qualification interrupted before broadcast",
      );
    }
    if (record.phase !== "armed" && record.phase !== "resume")
      return new Response(null, { status: 409 });
    if (this.qualifiedEnv.KEEPER_MODE !== "execute")
      return new Response(null, { status: 409 });
    if (activeKeeper && activeKeeper !== this)
      return new Response(null, { status: 409 });
    activeKeeper = this;
    try {
      const response = await super.fetch(
        new Request("https://keeper.internal/tick", { method: "POST" }),
      );
      if (record.phase === "resume") {
        const next = this.record();
        next.resumedInstance = this.instance;
        next.responseStatus = response.status;
        this.write(next);
      }
      // The result may contain provider diagnostics. Return only fixed status;
      // reconciliation uses independent chain reads, never this response.
      return Response.json({
        run: this.qualifiedEnv.QUALIFICATION_RUN,
        responseStatus: response.status,
      });
    } finally {
      if (activeKeeper === this) activeKeeper = undefined;
    }
  }
}

// Keep this export name when retaining the existing test keeper namespace.
export { QualificationKeeper as OperatorKeeper };

export default {
  async fetch(
    request: Request,
    env: QualificationEnvironment,
  ): Promise<Response> {
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/qualification" ||
      !authorized(request, env)
    )
      return new Response(null, { status: 404 });
    let command: unknown;
    try {
      if (Number(request.headers.get("content-length") ?? "0") > 100)
        return new Response(null, { status: 400 });
      const body = await request.text();
      if (body.length > 100) return new Response(null, { status: 400 });
      const value = JSON.parse(body) as { command?: unknown };
      if (Object.keys(value).length !== 1)
        return new Response(null, { status: 400 });
      command = value.command;
    } catch {
      return new Response(null, { status: 400 });
    }
    if (typeof command !== "string" || !COMMANDS.has(command))
      return new Response(null, { status: 400 });
    const config = configuration(env);
    const id = env.KEEPER.idFromName(
      JSON.stringify([config.network, config.signer]),
    );
    return env.KEEPER.get(id).fetch(
      new Request(`https://keeper.internal/${command}`, { method: "POST" }),
    );
  },
};
