import { webCrypto } from "@repo/platform/crypto";
import { Effect, Layer, ManagedRuntime } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { afterEach, describe, expect, it } from "vitest";
import { Deployment } from "../../src/platform/config.vibe";
import { deploymentOrigins } from "@repo/platform/config";
import { locks } from "../../src/platform/locks.vibe";
import { localStore, sessionStore } from "../../src/platform/storage.vibe";
import { BrowserSession, sessionServices } from "../../src/session/browserSession.vibe";
import { connectPayer, directKey, openCasePayment } from "../../src/wallets/bounty/directPrompt.vibe";
import { type PaymentCase, readPaymentCase } from "../../src/wallets/bounty/paymentCase.vibe";
import { bountyStorage } from "../../src/wallets/bounty/records.ts";
import { WalletChoice, walletChoiceServices } from "../../src/wallets/core/discovery.vibe";

const site = "https://slop.test";
const owner = "4242";
const caseId = "sc_7f3a";
const chainId = 8453;
const payer = "0x00000000000000000000000000000000000000a1";
const feeRecipient = "0x00000000000000000000000000000000000000fe";
const researcher = "0x00000000000000000000000000000000000000b2";
const firstNonce = 7n;
const quantity = (value: bigint) => `0x${value.toString(16)}`;
const hash = (index: number) => `0x${index.toString(16).padStart(64, "0")}`;

const legs = [
  { chainId: quantity(BigInt(chainId)), from: payer, nonce: quantity(firstNonce), to: feeRecipient, value: quantity(250n), data: "0x" },
  { chainId: quantity(BigInt(chainId)), from: payer, nonce: quantity(firstNonce + 1n), to: researcher, value: quantity(750n), data: "0x" },
];

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  sessionStorage.clear();
});

interface Mined {
  readonly hash: string;
  readonly nonce: bigint;
  readonly to: string;
  readonly value: string;
}

function fakeWallet(unclearNonces: ReadonlyArray<bigint>) {
  const mined: Mined[] = [];
  const sent: string[] = [];
  const provider = {
    async request({ method, params = [] }: { method: string; params?: ReadonlyArray<unknown> }) {
      const [first] = params as ReadonlyArray<Record<string, string>>;
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [payer];
      if (method === "eth_chainId") return quantity(BigInt(chainId));
      if (method === "eth_getTransactionCount") return quantity(firstNonce + BigInt(mined.length));
      if (method === "eth_estimateGas") return "0x5208";
      if (method === "eth_sendTransaction") {
        const nonce = BigInt(String(first?.nonce));
        sent.push(String(first?.nonce));
        const entry = { hash: hash(mined.length + 1), nonce, to: String(first?.to), value: String(first?.value) };
        mined.push(entry);
        if (unclearNonces.includes(nonce)) throw new Error("The wallet connection closed.");
        return entry.hash;
      }
      throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
    },
  };
  return { provider, mined, sent };
}

function fakeSite(wallet: ReturnType<typeof fakeWallet>) {
  const verifications: Array<{ readonly actor: string | null; readonly body: Record<string, unknown> }> = [];
  let revision = 3;
  let confirmed: string[] = [];
  const view = () => ({
    case: {
      id: caseId,
      revision,
      allowedActions: confirmed.length === legs.length ? [] : ["verify-payment"],
      paymentRail: "direct",
      settlement: {
        rail: "direct",
        state: confirmed.length === legs.length ? "paid" : "awaiting-external-payment",
        network: "base",
        generation: 0,
        confirmedTransactionIds: confirmed,
        recovery: null,
        ownerRequest: confirmed.length === legs.length ? null : { payer: { id: "claim-payer", address: payer, digest: "0x00" }, transactions: legs },
      },
    },
  });
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    if (path === "/api/v1/project-session") return json(200, { session: { githubId: owner, githubLogin: "payer-maintainer", admin: false } });
    if (request.headers.get("x-slop-expected-github-id") !== owner) return json(403, { error: "actor_changed", message: "The signed-in account changed." });
    if (path === `/api/v1/security-cases/${caseId}` && request.method === "GET") return json(200, view());
    if (path === `/api/v1/security-cases/${caseId}/actions` && request.method === "POST") {
      const body = JSON.parse(await request.text()) as Record<string, unknown>;
      verifications.push({ actor: request.headers.get("x-slop-expected-github-id"), body });
      const ids = Array.isArray(body.transactionIds) ? body.transactionIds.map(String) : [];
      const exact = legs.every((leg) => wallet.mined.some((entry) => entry.nonce === BigInt(leg.nonce) && entry.to === leg.to && entry.value === leg.value && ids.includes(entry.hash)));
      if (body.action !== "verify-payment" || body.expectedRevision !== revision || body.confirmation !== true || !exact) return json(409, { error: "payment_unverified", message: "The payment could not be verified." });
      confirmed = ids;
      revision += 1;
      return json(200, view());
    }
    return json(404, { error: "not_found", message: "Not found." });
  };
  return { fetch, verifications };
}

const deployment = Layer.succeed(Deployment, {
  tier: "production",
  origins: { ...deploymentOrigins("production"), site, api: site, browserOrigins: new Set([site]) },
  pageOrigin: site,
  localBackendOrigin: undefined,
  loginHref: (next: string) => Effect.succeed(next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`),
});

const onSite = Layer.effect(HttpClient.HttpClient, Effect.map(HttpClient.HttpClient, (client) => HttpClient.mapRequest(client, (request) => (request.url.startsWith("/") ? HttpClientRequest.prependUrl(request, site) : request))));

function page(fetch: typeof globalThis.fetch) {
  const platform = Layer.mergeAll(deployment, sessionStore, localStore, locks, webCrypto, Layer.provide(onSite, FetchHttpClient.layer), Layer.succeed(FetchHttpClient.Fetch, fetch));
  const runtime = ManagedRuntime.make(Layer.mergeAll(walletChoiceServices, Layer.provideMerge(sessionServices, platform)));
  cleanups.push(() => void runtime.dispose());
  return runtime;
}

function announce(uuid: string, provider: unknown) {
  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid, name: "Payer wallet", rdns: "test.payer", icon: "data:image/svg+xml,<svg/>" }, provider }) }));
}

const walletId = Effect.gen(function* () {
  const choice = yield* WalletChoice;
  return (yield* choice.current()).find((offer) => offer.name === "Payer wallet")?.id ?? 0;
});

const failureOf = <A, E extends { readonly _tag: string; readonly message?: string }, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.match(effect, { onFailure: (error) => `${error._tag}: ${error.message ?? ""}`, onSuccess: () => "succeeded" });

describe('Make wallet outcomes recoverable without repeating an uncertain send (spec/frontend/directBountyPrompt.md, "Story: Make wallet outcomes recoverable without repeating an uncertain send"; spec/frontend/directBountyPrompt.md, "A wallet prompt starts only after an atomic storage write owns its nonce"; spec/frontend/directBountyPrompt.md, "A late wallet result updates only the prompt that still owns the stored entry"; spec/frontend/directBountyPrompt.md, "Verification candidates merge atomically with current storage"; spec/frontend/directBountyPrompt.md, "Storage keeps the other leg and never grants settlement authority"; spec/settlement/payment.md, "The released direct full-award rail journals before submission and retain every uncertain attempt"; spec/settlement/directBounty.md, "Each finalized transaction belongs to one ledger and one exact request")', () => {
  it("the payer sends both legs once, an uncertain second leg survives a reload and blocks a resend, and verification sends both hashes for the exact request", async () => {
    const wallet = fakeWallet([firstNonce + 1n]);
    const backend = fakeSite(wallet);
    const key = directKey(caseId, 0, false, owner);

    const first = page(backend.fetch);
    const sending = await first.runPromise(Effect.gen(function* () {
      yield* (yield* BrowserSession).observe("load");
      announce("5a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", wallet.provider);
      const seen: PaymentCase = yield* readPaymentCase(owner, caseId);
      const { form, authority } = yield* openCasePayment(bountyStorage(), seen);
      const surface = yield* form.mount();
      const connection = yield* connectPayer(yield* walletId, payer, authority);
      const refused = yield* failureOf(form.send(surface, connection, authority));
      const shown = yield* form.shown(surface);
      return { refused, shown };
    }));
    const saved = JSON.parse(String(sessionStorage.getItem(key))) as Record<string, { hash: string | null; requestId?: string }>;
    expect(sending.refused).toBe("BountyRefused: The wallet result is uncertain. Check wallet activity and enter its hash; do not send again.");
    expect({ uncertain: sending.shown.uncertain, unsent: sending.shown.unsent, sent: wallet.sent }).toEqual({ uncertain: true, unsent: 0, sent: ["0x7", "0x8"] });
    expect(saved["0x7"]?.hash).toBe(wallet.mined[0]?.hash);
    expect(saved["0x8"]?.hash).toBeNull();
    expect(saved["0x8"]?.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);

    const reloaded = page(backend.fetch);
    const recovered = await reloaded.runPromise(Effect.gen(function* () {
      yield* (yield* BrowserSession).observe("load");
      announce("6b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e", wallet.provider);
      const seen: PaymentCase = yield* readPaymentCase(owner, caseId);
      const { form, authority } = yield* openCasePayment(bountyStorage(), seen);
      const surface = yield* form.mount();
      const connection = yield* connectPayer(yield* walletId, payer, authority);
      const shown = yield* form.shown(surface);
      const resend = yield* failureOf(form.send(surface, connection, authority));
      const missing = yield* failureOf(form.check(surface, {}, authority));
      const checked = yield* form.check(surface, { second: wallet.mined[1]?.hash ?? "" }, authority);
      return { legs: shown.legs.map((leg) => [leg.transaction.nonce, leg.saved.hash !== ""]), uncertain: shown.uncertain, resend, missing, checked: checked.message, state: checked.current.settlement?.state, confirmed: checked.current.settlement?.confirmedTransactionIds };
    }));
    expect(recovered).toEqual({
      legs: [["0x7", true], ["0x8", false]],
      uncertain: true,
      resend: "BountyRefused: Wallet result uncertain. Enter its transaction hash to continue.",
      missing: "BountyRefused: The payment could not be verified.",
      checked: "Finalized evidence verified.",
      state: "paid",
      confirmed: [wallet.mined[0]?.hash, wallet.mined[1]?.hash],
    });
    expect(wallet.sent).toEqual(["0x7", "0x8"]);
    const after = JSON.parse(String(sessionStorage.getItem(key))) as Record<string, { hash: string | null; candidate?: string }>;
    expect(after["0x8"]).toMatchObject({ hash: null, candidate: wallet.mined[1]?.hash });
    expect(backend.verifications.map((entry) => [entry.actor, entry.body.action, entry.body.transactionIds])).toEqual([
      [owner, "verify-payment", [wallet.mined[0]?.hash]],
      [owner, "verify-payment", [wallet.mined[0]?.hash, wallet.mined[1]?.hash]],
    ]);
  });
});
