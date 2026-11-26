// spec/fees/runtime.md, "Signing needs a live mode and owner-verified readiness for the exact wallet"; spec/fees/runtime.md, "Owner readiness and replacement activation are reviewed Worker configuration bound to the exact fee wallet address"
import { readFileSync } from "node:fs";
import { Effect } from "effect";
import type { Driver, Options } from "../../gen/fees__runtime.conformance.ts";
import type { Event, Mode, Runtime, Sender, WorkerConfig } from "../../gen/fees__runtime.ts";
import { type Held, type RuntimeEvent, decodeConfig, publishedWallet, send, unpublished } from "../../src/runtime/config.vibe";
import type { ConfigInvalid } from "@repo/platform/config";
import { type FeeVars, definitions, evmNetworks } from "../../src/runtime/networks.vibe";

const senders: ReadonlyArray<Sender> = ["ReleaseWorkflow", "Owner", "Worker", "Other"];
const modeText: Readonly<Record<Mode, string>> = { Off: "off", DryRun: "dry_run", Live: "live" };

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVars(value: unknown): value is Readonly<Record<string, string>> {
  return isObject(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function reviewed(): { readonly vars: Readonly<Record<string, string>>; readonly budgets: Readonly<Record<string, unknown>> } {
  const file: unknown = JSON.parse(readFileSync(new URL("../../wrangler/feeConverter.production.jsonc", import.meta.url), "utf8"));
  const vars = isObject(file) ? file.vars : undefined;
  if (!isVars(vars)) throw new TypeError("the reviewed production wrangler file has no string vars");
  const budgets: unknown = JSON.parse(vars.FEE_CONVERTER_NATIVE_BUDGETS ?? "");
  if (!isObject(budgets)) throw new TypeError("the reviewed production native budgets are not a JSON object");
  return { vars, budgets };
}

const { vars: reviewedVars, budgets: reviewedBudgets } = reviewed();

const digits = "123456789A";
function evmAddress(id: number): string {
  return `0x${Math.abs(id).toString(16).padStart(40, "0")}`;
}
function solanaAddress(id: number): string {
  return `${id < 0 ? "N" : "S"}${[...String(Math.abs(id))].map((digit) => digits[Number(digit)]).join("")}`.padEnd(32, "z");
}

const addressIds = new Map<string, number>([[unpublished.wallets[0] ?? "", 1], [unpublished.wallets[1] ?? "", 2]]);
function remembered(address: string, id: number): string {
  addressIds.set(address, id);
  return address;
}

function varsOf(config: WorkerConfig): FeeVars {
  const evm = remembered(evmAddress(config.evmWallet), config.evmWallet);
  const solana = remembered(solanaAddress(config.solanaWallet), config.solanaWallet);
  const budgets = Object.fromEntries(config.nativeLimits.map((network) => [definitions[network].name, reviewedBudgets[definitions[network].name]]));
  return {
    ...reviewedVars,
    FEE_CONVERTER_MODE: modeText[config.converterMode],
    BUYBACK_MODE: modeText[config.buybackMode],
    FEE_CONVERTER_NETWORKS: config.networks.map((network) => definitions[network].name).join(","),
    FEE_CONVERTER_NATIVE_BUDGETS: JSON.stringify(budgets),
    ...Object.fromEntries(evmNetworks.map((network) => [definitions[network].walletVar, evm])),
    FEE_WALLET_SOLANA: solana,
  };
}

function translated(event: Event): Effect.Effect<RuntimeEvent, ConfigInvalid> {
  switch (event.type) {
    case "publish":
      return Effect.map(
        decodeConfig(varsOf(event.config), event.config.keys.map((network) => definitions[network].keySecret)),
        (config): RuntimeEvent => ({ type: "publish", source: event.config.source, config }),
      );
    case "verifyReadiness":
      return Effect.succeed({ type: "verifyReadiness", network: event.network, wallet: publishedWallet(held, event.network) ?? "" });
    default:
      return Effect.succeed(event);
  }
}

let held: Held = unpublished;

function observed(): Runtime {
  const back = (id: number) => addressIds.get(held.wallets[id - 1] ?? "") ?? id;
  return { ...held.runtime, evmWallet: back(held.runtime.evmWallet), solanaWallet: back(held.runtime.solanaWallet), networks: [...held.runtime.networks] };
}

export const driver: Driver = {
  reset: () => {
    held = unpublished;
  },
  dispatch: (_key, event, by) => {
    const sender = senders.find((candidate) => candidate === by);
    if (sender === undefined) throw new TypeError(`unknown sender ${String(by)}`);
    return Effect.runPromise(
      Effect.flatMap(translated(event), (runtimeEvent) => send(held, runtimeEvent, sender)).pipe(
        Effect.map((next) => {
          held = next;
          return "accepted" as const;
        }),
        Effect.catchTags({ Rejected: () => Effect.succeed("refused" as const), ReadinessUnbound: () => Effect.succeed("refused" as const), ConfigInvalid: () => Effect.succeed("refused" as const) }),
      ),
    );
  },
  observe: () => observed(),
};

export const options: Options = { keys: ["runtime"] };
