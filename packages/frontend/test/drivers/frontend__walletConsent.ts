// spec/frontend/walletConsent.md, "Discovery offers announced and legacy providers and refuses conflicting ones"; spec/frontend/walletConsent.md, "Replacing a saved wallet needs an explicit choice"; spec/frontend/walletConsent.md, "The prepared and signed bytes must equal the server's message before posting"; spec/frontend/walletConsent.md, "Posting names the expected account; a 401 asks to sign in again, and closing discards late replies"
import { Effect, ManagedRuntime } from "effect";
import { outcome } from "@repo/platform/testing/area";
import type { Driver, Options } from "../../gen/frontend__walletConsent.conformance.ts";
import type { Consent, Event } from "../../gen/frontend__walletConsent.ts";
import { WalletChoice, consentState, sendConsent, walletChoiceServicesOver } from "../../src/wallets/core/discovery.vibe";
import type { Announcement, Eip1193, WalletSource } from "../../src/wallets/core/injected.ts";

const discovery = -2;
const unseen = 1_000_000;

interface Fake {
  readonly provider: Eip1193;
  announced?: Announcement;
}

function page() {
  const announcements: Announcement[] = [];
  const legacy: Eip1193[] = [];
  const fakes = new Map<number, Fake>();
  let renamed = 0;
  const source: WalletSource = {
    listen: () => ({
      announcements,
      standard: () => [],
      changed: (signal) => new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })),
      stop: () => undefined,
    }),
    legacyEvm: () => legacy.map((provider) => ({ provider, name: "Browser wallet" })),
    legacySolana: () => [],
  };
  const fakeOf = (provider: number): Fake => {
    const found = fakes.get(provider);
    if (found !== undefined) return found;
    const made: Fake = { provider: { request: async () => [] } };
    fakes.set(provider, made);
    return made;
  };
  const announce = (provider: number, sameMetadata: boolean) => {
    const fake = fakeOf(provider);
    if (fake.announced === undefined) {
      fake.announced = { uuid: `00000000-0000-4000-8000-${String(provider).padStart(12, "0")}`, name: `Wallet ${provider}`, rdns: `test.wallet${provider}`, icon: "", provider: fake.provider };
      announcements.push(fake.announced);
    } else {
      renamed += 1;
      announcements.push(sameMetadata ? fake.announced : { ...fake.announced, name: `${fake.announced.name} ${renamed}` });
    }
  };
  const observeLegacy = (provider: number) => {
    const fake = fakeOf(provider);
    if (!legacy.includes(fake.provider)) legacy.push(fake.provider);
  };
  return { source, fakes, announce, observeLegacy, runtime: ManagedRuntime.make(walletChoiceServicesOver(source)) };
}

let current = page();

const refresh = () => current.runtime.runPromise(Effect.gen(function* () {
  const choice = yield* WalletChoice;
  yield* choice.current();
  const ids = new Map<object, number>();
  for (let id = 1; ; id += 1) {
    const held = yield* choice.held(id);
    if (held === undefined) return ids;
    ids.set(held.kind === "standard" ? held.wallet : held.provider, id);
  }
}));

async function translation() {
  const ids = await refresh();
  const shellOf = new Map<number, number>();
  const modelOf = new Map<number, number>();
  for (const [provider, fake] of current.fakes) {
    const id = ids.get(fake.provider);
    if (id === undefined) continue;
    shellOf.set(provider, id);
    modelOf.set(id, provider);
  }
  return {
    shell: (provider: number) => provider <= 0 ? provider : shellOf.get(provider) ?? provider + unseen,
    model: (id: number) => id <= 0 ? id : id >= unseen ? id - unseen : modelOf.get(id) ?? id,
  };
}

function normalized(state: Consent, model: (id: number) => number = (id) => id): Consent {
  const sorted = (ids: ReadonlyArray<number>) => ids.map(model).sort((a, b) => a - b);
  return { ...state, announced: sorted(state.announced), conflicted: sorted(state.conflicted), legacy: sorted(state.legacy), selected: model(state.selected) };
}

export const driver: Driver = {
  reset: async () => {
    await current.runtime.dispose();
    current = page();
  },
  dispatch: async (_key, event: Event, by) => {
    if (event.type === "announce" || event.type === "observeLegacy") {
      if (by !== discovery || event.provider <= 0) return "refused";
      const before = await current.runtime.runPromise(consentState());
      if (event.type === "announce") current.announce(event.provider, event.sameMetadata);
      else current.observeLegacy(event.provider);
      await refresh();
      if (event.type === "announce") return "accepted";
      const after = await current.runtime.runPromise(consentState());
      return after.legacy.length > before.legacy.length ? "accepted" : "refused";
    }
    const { shell } = await translation();
    const sent: Event = event.type === "connect" ? { ...event, provider: shell(event.provider) } : event;
    return outcome(sendConsent(sent, Number(by)), current.runtime);
  },
  observe: async () => {
    const { model } = await translation();
    return normalized(await current.runtime.runPromise(consentState()), model);
  },
};

export const options: Options = { keys: ["consent"], walks: 10, steps: 16, view: (state) => normalized(state) };
