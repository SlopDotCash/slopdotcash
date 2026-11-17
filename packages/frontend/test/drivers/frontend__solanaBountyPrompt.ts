// spec/frontend/solanaBountyPrompt.md, "The wallet sends only a saved, unexpired plan"; spec/frontend/solanaBountyPrompt.md, "Verification and history recovery rechecks the account and never sends"
import { Effect } from "effect";
import { base58Encode } from "@repo/platform/chain/solana";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/frontend__solanaBountyPrompt.conformance.ts";
import type { Event, SolanaPrompt } from "../../gen/frontend__solanaBountyPrompt.ts";
import { type SolanaJournal, solanaPrefix, solanaPromptOver } from "../../src/wallets/bounty/solanaPayment.vibe";
import type { ListedStorage } from "../../src/wallets/bounty/records.ts";

function memoryStorage(): ListedStorage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index) => [...values.keys()][index] ?? null,
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
  constructor(private readonly make: (index: number) => string) {}
  shell(model: string): string {
    if (model === "") return "";
    const found = this.toShell.get(model);
    if (found !== undefined) return found;
    const made = this.make(this.toShell.size + 1);
    this.toShell.set(model, made);
    this.toModel.set(made, model);
    return made;
  }
}

const identities = new Names((index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`);
const signatures = new Names((index) => base58Encode(new Uint8Array(64).fill(index)));
const shellFields: Readonly<Record<string, Names>> = { identity: identities, awaiting: identities, signature: signatures, hash: signatures, candidate: signatures };

let prompt: SolanaJournal;

async function known(value: unknown) {
  const record = value as { type?: unknown; message?: unknown } | null;
  if (typeof record === "object" && record !== null && record.type === "receivePlan" && typeof record.message === "number" && Number.isSafeInteger(record.message) && record.message > 0)
    await Effect.runPromise(prompt.know(record.message, `message-${record.message}`, `transaction-${record.message}`));
}

function toShell(value: unknown, field?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => toShell(item));
  if (typeof value === "string") return field === undefined ? value : (shellFields[field]?.shell(value) ?? value);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toShell(item, key)]));
}

function toModel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toModel);
  if (typeof value === "string") return identities.toModel.get(value) ?? signatures.toModel.get(value) ?? value;
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toModel(item)]));
}

const fresh = () => Effect.runPromise(solanaPromptOver(memoryStorage(), solanaPrefix("conformance", 0)));
prompt = await fresh();

export const driver: Driver = {
  reset: async () => {
    prompt = await fresh();
  },
  dispatch: async (_key, event: Event, by) => {
    await known(event);
    return outcome(prompt.machine.send(toShell(event) as Event, Number(by)));
  },
  receive: async (_key, raw, by) => {
    await known(raw);
    return outcome(prompt.machine.receive(toShell(raw), Number(by)));
  },
  observe: async () => toModel(await Effect.runPromise(prompt.machine.get())) as SolanaPrompt,
};

export const options: Options = { keys: ["prompt"], walks: 10, steps: 20 };
