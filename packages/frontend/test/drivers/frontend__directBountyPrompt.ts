// spec/frontend/directBountyPrompt.md, "A wallet prompt starts only after an atomic storage write owns its nonce"; spec/frontend/directBountyPrompt.md, "A late wallet result updates only the prompt that still owns the stored entry"; spec/frontend/directBountyPrompt.md, "Verification candidates merge atomically with current storage"; spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"
import { Effect } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/frontend__directBountyPrompt.conformance.ts";
import type { CheckOutcome, Event, Prompt } from "../../gen/frontend__directBountyPrompt.ts";
import type { SlotStorage } from "../../src/wallets/core/slots.ts";
import { type DirectPrompt, directKey, directPromptOver } from "../../src/wallets/bounty/directPrompt.vibe";

function memoryStorage(): SlotStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

class Names {
  readonly toShell = new Map<string, string>();
  readonly toModel = new Map<string, string>();
  constructor(private readonly make: (index: number, model: string) => string) {}
  shell(model: string): string {
    if (model === "") return "";
    const found = this.toShell.get(model);
    if (found !== undefined) return found;
    const made = this.make(this.toShell.size + 1, model);
    this.toShell.set(model, made);
    this.toModel.set(made, model);
    return made;
  }
}

const hex = (index: number, width: number) => index.toString(16).padStart(width, "0");
const identities = new Names((index) => `00000000-0000-4000-8000-${hex(index, 12)}`);
const hashes = new Names((index) => `0x${hex(index, 64)}`);
let payer = "payer";
const bytes = new Map<string, string>();
const models = new Map<string, string>();

function transactionBytes(model: string, nonce: number): string {
  if (model === "" || nonce < 0) return model;
  const key = `${model}@${nonce}`;
  const found = bytes.get(key);
  if (found !== undefined) return found;
  const made = JSON.stringify({ from: payer, to: "0x0000000000000000000000000000000000000001", value: "0", data: `0x${Array.from(new TextEncoder().encode(model), (byte) => hex(byte, 2)).join("")}`, chainId: "0x1", nonce: String(nonce) });
  bytes.set(key, made);
  models.set(made, model);
  return made;
}

function toShell(value: unknown, field?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => toShell(item));
  if (typeof value === "string") {
    if (field === "identity") return identities.shell(value);
    if (field === "hash") return hashes.shell(value);
    return value;
  }
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const scope = record.scope as { payer?: unknown } | undefined;
  if (typeof scope?.payer === "string") payer = scope.payer;
  const nonce = typeof record.nonce === "number" ? record.nonce : -1;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, key === "bytesId" && typeof item === "string" ? transactionBytes(item, nonce) : toShell(item, key)]));
}

function toModel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toModel);
  if (typeof value === "string") return identities.toModel.get(value) ?? hashes.toModel.get(value) ?? models.get(value) ?? value;
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toModel(item)]));
}

const key = directKey("conformance", 0, false, "1");
const fresh = () => Effect.runPromise(directPromptOver(memoryStorage(), key));
let prompt: DirectPrompt = await fresh();
let output: CheckOutcome["out"] = [];

const sent = (event: unknown, by: unknown) =>
  outcome(Effect.tap(prompt.machine.send(toShell(event) as Event, Number(by)), (result) => Effect.sync(() => {
    output = result.out;
  })));

export const driver: Driver = {
  reset: async () => {
    prompt = await fresh();
    payer = "payer";
    output = [];
  },
  dispatch: (_key, event: Event, by) => sent(event, by),
  receive: (_key, raw, by) => outcome(prompt.machine.receive(toShell(raw), Number(by))),
  observe: async () => toModel(await Effect.runPromise(prompt.machine.get())) as Prompt,
  observeOutput: () => toModel(output),
};

export const options: Options = { keys: ["prompt"], walks: 10, steps: 20 };
