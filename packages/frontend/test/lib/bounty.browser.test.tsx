import { base58Encode, base64Encode } from "@repo/platform/chain/solana";
import { webCrypto } from "@repo/platform/crypto";
import { meta } from "@repo/settlement/chain/solana/instructions";
import { compileLegacy } from "@repo/settlement/chain/solana/transactions";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
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
import { checkExpiredPayment, connectRecoveryPayer } from "../../src/wallets/bounty/recovery.vibe";
import { connectSolanaPayer, openCaseSolanaPayment, solanaPrefix } from "../../src/wallets/bounty/solanaPayment.vibe";
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

const walletNamed = (name: string) => Effect.gen(function* () {
  const choice = yield* WalletChoice;
  return (yield* choice.current()).find((offer) => offer.name === name)?.id ?? 0;
});
const walletId = walletNamed("Payer wallet");

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

const solanaMessageId = "solana-request-1";
const historyMessageId = "history-1";
const historyBytes = new TextEncoder().encode("slop bounty history check");
const otherSignature = base58Encode(new Uint8Array(64).fill(7));

async function solanaPayer() {
  const keys = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey));
  const sign = async (message: Uint8Array) => new Uint8Array(await crypto.subtle.sign("Ed25519", keys.privateKey, Uint8Array.from(message)));
  const address = base58Encode(raw);
  const recipient = base58Encode(new Uint8Array(32).fill(3));
  const compiled = compileLegacy({
    payer: address as never,
    blockhash: base58Encode(new Uint8Array(32).fill(9)) as never,
    instructions: [{ program: "11111111111111111111111111111111" as never, accounts: [meta(address as never, true, true), meta(recipient as never, true)], data: Uint8Array.of(2, 0, 0, 0, 232, 3, 0, 0, 0, 0, 0, 0) }],
  });
  if (compiled.kind !== "compiled") throw new Error("message refused");
  const wire = new Uint8Array(65 + compiled.bytes.length);
  wire[0] = 1;
  wire.set(compiled.bytes, 65);
  return { address, raw, sign, transaction: base64Encode(wire) };
}

function solanaWallet(payer: Awaited<ReturnType<typeof solanaPayer>>, afterSend: () => void) {
  const asked = { sent: [] as string[], signedMessages: 0 };
  const account: WalletAccount = { address: payer.address, publicKey: payer.raw, chains: ["solana:mainnet"], features: ["solana:signAndSendTransaction", "solana:signMessage"] };
  const wallet = {
    version: "1.0.0",
    name: "Payer Solana",
    icon: "data:image/svg+xml,<svg/>",
    chains: ["solana:mainnet"],
    accounts: [account],
    features: {
      "standard:connect": { version: "1.0.0", connect: () => Promise.resolve({ accounts: [account] }) },
      "solana:signAndSendTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy"],
        signAndSendTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
          const signature = await payer.sign(transaction.slice(65));
          asked.sent.push(base58Encode(signature));
          afterSend();
          return [{ signature }];
        },
      },
      "solana:signMessage": {
        version: "1.0.0",
        signMessage: async ({ message }: { message: Uint8Array }) => {
          asked.signedMessages += 1;
          return [{ signedMessage: message, signature: await payer.sign(message) }];
        },
      },
    },
  } as unknown as Wallet;
  cleanups.push(getWallets().register(wallet));
  return asked;
}

type VerifyAnswer = "finalize" | "expire";
type RecoverAnswer = "history-check" | "payment-found";

function solanaSite(payer: Awaited<ReturnType<typeof solanaPayer>>, answers: { readonly verify: VerifyAnswer; readonly recover: ReadonlyArray<RecoverAnswer> }) {
  const actions: Array<{ readonly action: unknown; readonly transactionIds: unknown; readonly signatures: unknown }> = [];
  const recoveries = [...answers.recover];
  let revision = 3;
  let paid: string | null = null;
  let mode: RecoverAnswer | null = null;
  const view = () => ({
    case: {
      id: caseId,
      revision,
      allowedActions: paid !== null ? [] : mode === null ? ["verify-payment"] : ["recover-payment"],
      paymentRail: "direct",
      settlement: {
        rail: "direct",
        state: paid !== null ? "paid" : "awaiting-external-payment",
        network: "solana",
        generation: 0,
        confirmedTransactionIds: paid === null ? [] : [paid],
        recovery: paid !== null || mode === null ? null : { generation: 0, mode, payer: payer.address, messages: [{ messageId: historyMessageId, message: base64Encode(historyBytes) }] },
        ownerRequest: paid !== null || mode !== null ? null : { payer: { address: payer.address }, solana: { transaction: payer.transaction, messageId: solanaMessageId, lastValidBlockHeight: 100 } },
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
      actions.push({ action: body.action, transactionIds: body.transactionIds, signatures: body.signatures });
      if (body.expectedRevision !== revision || body.confirmation !== true) return json(409, { error: "revision_changed", message: "The case changed." });
      const ids = Array.isArray(body.transactionIds) ? body.transactionIds.map(String) : [];
      if (body.action === "verify-payment" && mode === null && ids.length === 1) {
        if (answers.verify === "finalize") paid = ids[0] ?? null;
        else mode = "history-check";
      } else if (body.action === "recover-payment" && mode !== null && Array.isArray(body.signatures)) {
        const answer = recoveries.shift() ?? "history-check";
        if (answer === "payment-found") paid = payer.address;
        mode = answer === "payment-found" ? null : answer;
      } else return json(409, { error: "payment_unverified", message: "The payment could not be verified." });
      revision += 1;
      return json(200, view());
    }
    return json(404, { error: "not_found", message: "Not found." });
  };
  return { fetch, actions };
}

const tagOf = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.match(effect, { onFailure: (error) => error._tag, onSuccess: () => "succeeded" });

function savedSolana() {
  const key = Object.keys(sessionStorage).find((entry) => entry.startsWith(`${solanaPrefix(caseId, 0)}${solanaMessageId}:`));
  return key === undefined ? undefined : (JSON.parse(String(sessionStorage.getItem(key))) as { signature: string | null; candidate?: string });
}

const solanaOpened = Effect.gen(function* () {
  yield* (yield* BrowserSession).observe("load");
  const seen: PaymentCase = yield* readPaymentCase(owner, caseId);
  const { form, authority } = yield* openCaseSolanaPayment(bountyStorage(), seen);
  const connection = yield* connectSolanaPayer(yield* walletNamed("Payer Solana"), form.payer, authority);
  return { form, authority, connection };
});

describe('Send each prepared message at most once and recover it after expiry (spec/frontend/solanaBountyPrompt.md, "Story: Send each prepared message at most once and recover it after expiry"; spec/frontend/solanaBountyPrompt.md, "The wallet sends only a saved, unexpired plan"; spec/frontend/solanaBountyPrompt.md, "Verification and history recovery rechecks the account and never sends"; spec/settlement/payment.md, "The released direct full-award rail journals before submission and retain every uncertain attempt")', () => {
  it("a signature typed beside the saved one is stored as the candidate and is the one the case verifies", async () => {
    const payer = await solanaPayer();
    const wallet = solanaWallet(payer, () => undefined);
    const backend = solanaSite(payer, { verify: "finalize", recover: [] });
    const outcome = await page(backend.fetch).runPromise(Effect.gen(function* () {
      const { form, authority, connection } = yield* solanaOpened;
      const signature = yield* form.send(connection, authority);
      const saved = savedSolana();
      const checked = yield* form.verify(otherSignature, authority);
      return { signature, saved, paid: checked.current.settlement?.state, phase: (yield* form.current()).phase };
    }));
    expect(outcome).toEqual({ signature: wallet.sent[0], saved: { transaction: payer.transaction, signature: wallet.sent[0], attemptId: expect.any(String) }, paid: "paid", phase: "Verified" });
    expect(wallet.sent).toHaveLength(1);
    expect(backend.actions).toEqual([{ action: "verify-payment", transactionIds: [otherSignature], signatures: undefined }]);
  });

  it("a signature the browser cannot save stays in page memory and is verified from the same page", async () => {
    const payer = await solanaPayer();
    const setItem = Storage.prototype.setItem;
    let blocked = false;
    Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
      if (blocked) throw new DOMException("Storage is full.", "QuotaExceededError");
      setItem.call(this, key, value);
    };
    cleanups.push(() => {
      Storage.prototype.setItem = setItem;
    });
    const wallet = solanaWallet(payer, () => {
      blocked = true;
    });
    const backend = solanaSite(payer, { verify: "finalize", recover: [] });
    const outcome = await page(backend.fetch).runPromise(Effect.gen(function* () {
      const { form, authority, connection } = yield* solanaOpened;
      const sent = yield* tagOf(form.send(connection, authority));
      const held = yield* form.current();
      const saved = savedSolana();
      blocked = false;
      const resend = yield* tagOf(form.send(connection, authority));
      const checked = yield* form.verify("", authority);
      return { sent, held: [held.phase, held.notice, held.memory], saved: saved?.signature, resend, paid: checked.current.settlement?.state, phase: (yield* form.current()).phase };
    }));
    expect(outcome).toEqual({ sent: "BountyRefused", held: ["Submitted", "KeepSignature", wallet.sent[0]], saved: null, resend: "BountyRefused", paid: "paid", phase: "Verified" });
    expect(wallet.sent).toHaveLength(1);
    expect(backend.actions).toEqual([{ action: "verify-payment", transactionIds: [wallet.sent[0]], signatures: undefined }]);
  });

  it("an expired payment whose history scan is incomplete returns to the expired form, and the next check signs nothing new and finds the payment", async () => {
    const payer = await solanaPayer();
    const wallet = solanaWallet(payer, () => undefined);
    const backend = solanaSite(payer, { verify: "expire", recover: ["history-check", "payment-found"] });
    const outcome = await page(backend.fetch).runPromise(Effect.gen(function* () {
      const { form, authority, connection } = yield* solanaOpened;
      yield* form.send(connection, authority);
      yield* form.verify("", authority);
      const expired = (yield* form.current()).phase;
      const check = Effect.gen(function* () {
        const seen: PaymentCase = yield* readPaymentCase(owner, caseId);
        const recoveryConnection = yield* connectRecoveryPayer(yield* walletNamed("Payer Solana"), owner, seen);
        const next = yield* checkExpiredPayment(bountyStorage(), owner, seen, recoveryConnection, form);
        const state = yield* form.current();
        return { mode: next.settlement?.recovery?.mode ?? next.settlement?.state, phase: state.phase, notice: state.notice, again: yield* form.tracksHistory() };
      });
      const first = yield* check;
      const second = yield* check;
      return { expired, first, second };
    }));
    expect(outcome).toEqual({
      expired: "Expired",
      first: { mode: "history-check", phase: "Expired", notice: "HistoryIncomplete", again: true },
      second: { mode: "paid", phase: "Verified", notice: "HistoryIncomplete", again: false },
    });
    expect({ sent: wallet.sent.length, signedMessages: wallet.signedMessages }).toEqual({ sent: 1, signedMessages: 1 });
    const recovered = backend.actions.filter((entry) => entry.action === "recover-payment").map((entry) => entry.signatures);
    expect(recovered).toHaveLength(2);
    expect(recovered[1]).toEqual(recovered[0]);
  });
});
