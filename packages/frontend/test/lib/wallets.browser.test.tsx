import { webCrypto } from "@repo/platform/crypto";
import { base58Encode, base64Decode, base64Encode } from "@repo/platform/chain/solana";
import { bindingTypedData } from "@repo/settlement/chain/evm/typedData";
import { type Digest, type I64, type U64, digest, i64, u64 } from "@repo/settlement/chain/solana/bytes";
import { bindWallet } from "@repo/settlement/chain/solana/instructions";
import { compileLegacy } from "@repo/settlement/chain/solana/transactions";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { Effect, Layer, ManagedRuntime } from "effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { type Address, type Hex, verifyMessage, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it } from "vitest";
import { sessionLayer } from "../../src/session/session.vibe";
import { WalletAttempts, attemptJournal, walletAttempts } from "../../src/wallets/core/attempt.vibe";
import { PayoutBinding, payoutBinding } from "../../src/wallets/core/binding.vibe";
import { WalletChoice, walletChoiceServices } from "../../src/wallets/core/discovery.vibe";
import { connectEvm, sendTransaction } from "../../src/wallets/core/evm.vibe";
import { evmSigner, registerFamily } from "../../src/wallets/core/registration.vibe";

type Seen = { readonly method: string; readonly path: string; readonly actor: string | null; readonly body: unknown };
type Answer = { readonly status: number; readonly body: unknown };

const actor = "4242";
const testKey: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const evmAccount = privateKeyToAccount(testKey);
const evmAddress = evmAccount.address.toLowerCase();
const baseSepolia = 84532;
const evmVault = "0x00000000000000000000000000000000000000aa";
const hex64 = (byte: string) => byte.repeat(64);

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function announce(uuid: string, name: string, provider: unknown) {
  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid, name, rdns: `test.${name.toLowerCase()}`, icon: "data:image/svg+xml,<svg/>" }, provider }) }));
}

function testProvider(answers: (method: string, params: ReadonlyArray<unknown>) => Promise<unknown>) {
  const seen: string[] = [];
  return {
    seen,
    async request({ method, params = [] }: { method: string; params?: ReadonlyArray<unknown> }) {
      seen.push(method);
      return answers(method, params);
    },
  };
}

function evmWallet(send: () => Promise<unknown>) {
  const signatures: string[] = [];
  const provider = testProvider(async (method, params) => {
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [evmAccount.address];
    if (method === "eth_chainId") return `0x${baseSepolia.toString(16)}`;
    if (method === "personal_sign") return evmAccount.signMessage({ message: { raw: params[0] as Hex } });
    if (method === "eth_signTypedData_v4") {
      const typed = JSON.parse(String(params[1])) as { domain: { name: string; version: string; chainId: string; verifyingContract: Address }; message: Record<string, string> };
      const signature = await evmAccount.signTypedData(signable(typed));
      signatures.push(signature);
      return signature;
    }
    if (method === "eth_sendTransaction") return send();
    throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
  });
  return Object.assign(provider, { signatures });
}

function signable(typed: { domain: { name: string; version: string; chainId: string; verifyingContract: Address }; message: Record<string, string> }) {
  return {
    domain: { ...typed.domain, chainId: BigInt(typed.domain.chainId) },
    types: { DestinationBinding: [{ name: "actorId", type: "uint64" }, { name: "destination", type: "address" }, { name: "expectedVersion", type: "uint64" }, { name: "claimDigest", type: "bytes32" }, { name: "expiresAt", type: "uint64" }] },
    primaryType: "DestinationBinding" as const,
    message: {
      actorId: BigInt(typed.message.actorId ?? "0"),
      destination: typed.message.destination as Address,
      expectedVersion: BigInt(typed.message.expectedVersion ?? "0"),
      claimDigest: typed.message.claimDigest as Hex,
      expiresAt: BigInt(typed.message.expiresAt ?? "0"),
    },
  };
}

async function ed25519Pair() {
  const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  return {
    address: base58Encode(raw),
    sign: async (message: Uint8Array) => new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, Uint8Array.from(message))),
    verify: (message: Uint8Array, signature: Uint8Array) => crypto.subtle.verify("Ed25519", pair.publicKey, Uint8Array.from(signature), Uint8Array.from(message)),
  };
}

type Pair = Awaited<ReturnType<typeof ed25519Pair>>;

function solanaWallet(owner: Pair, tamper: boolean): Wallet {
  const account: WalletAccount = { address: owner.address, publicKey: base58Decoded(owner.address), chains: ["solana:devnet"], features: ["solana:signMessage", "solana:signTransaction"] };
  return {
    version: "1.0.0",
    name: tamper ? "Lookalike" : "Test Solana",
    icon: "data:image/svg+xml,<svg/>",
    chains: ["solana:devnet"],
    accounts: [account],
    features: {
      "standard:connect": { version: "1.0.0", connect: async () => ({ accounts: [account] }) },
      "solana:signMessage": { version: "1.0.0", signMessage: async ({ message }: { message: Uint8Array }) => [{ signedMessage: message, signature: await owner.sign(message) }] },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: ["legacy"],
        signTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
          const signed = Uint8Array.from(transaction);
          if (tamper) signed[signed.length - 1] = (signed[signed.length - 1] ?? 0) ^ 1;
          signed.set(await owner.sign(signed.slice(129)), 65);
          return [{ signedTransaction: signed }];
        },
      },
    },
  } as unknown as Wallet;
}

function base58Decoded(text: string): Uint8Array<ArrayBuffer> {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = 0n;
  for (const character of text) value = value * 58n + BigInt(alphabet.indexOf(character));
  const bytes = new Uint8Array(32);
  for (let index = 31; index >= 0; index -= 1) {
    bytes[index] = Number(value & 255n);
    value >>= 8n;
  }
  return bytes;
}

function fakeBackend(attester: Pair | undefined, alter: (path: string, body: Record<string, unknown>) => Record<string, unknown> = (_path, body) => body) {
  const seen: Seen[] = [];
  const claims = new Map<string, { chain: string; address: string }>();
  const prepared = new Map<string, Uint8Array>();
  const answer = async (path: string, body: Record<string, unknown>): Promise<Answer> => {
    if (path === "/api/v1/project-session") return { status: 200, body: { session: { githubId: actor, githubLogin: "member", admin: false } } };
    if (path === "/api/v1/payments/wallets/register") {
      const claimId = `claim-${String(body.chain)}-${claims.size + 1}`;
      claims.set(claimId, { chain: String(body.chain), address: String(body.address) });
      return { status: 200, body: { claimId } };
    }
    if (path === "/api/v1/payments/wallets/challenge") {
      const claim = claims.get(String(body.claimId));
      if (claim === undefined) return { status: 409, body: { error: "claim_not_current", message: "" } };
      return { status: 200, body: { challengeId: `challenge-${String(body.claimId)}`, message: `Slop payout wallet ${claim.address} on ${claim.chain}`, address: claim.address, chain: claim.chain, expiresAt: "2026-11-17T12:10:00.000Z" } };
    }
    if (path === "/api/v1/payments/wallets/authorize") {
      const claim = claims.get(String(body.claimId));
      const message = `Slop payout wallet ${claim?.address} on ${claim?.chain}`;
      const valid = claim !== undefined && (claim.chain === "solana"
        ? await crypto.subtle.verify("Ed25519", await crypto.subtle.importKey("raw", base58Decoded(claim.address), { name: "Ed25519" }, false, ["verify"]), Uint8Array.from(base64Decode(String(body.signature)) ?? []), new TextEncoder().encode(message))
        : await verifyMessage({ address: claim.address as Address, message, signature: body.signature as Hex }));
      return valid ? { status: 200, body: { authorized: true } } : { status: 403, body: { error: "wallet_signature_required", message: "" } };
    }
    if (path === "/api/v1/payments/wallets/bind-challenge") {
      const typedData = bindingTypedData({ chainId: BigInt(baseSepolia), vault: evmVault as never }, { actor: BigInt(actor), destination: evmAddress as never, expectedVersion: 3n, claimDigest: `0x${hex64("c")}` as never, expiresAt: 1_800_000_000n });
      return { status: 200, body: { claimId: body.claimId, typedData } };
    }
    if (path === "/api/v1/payments/wallets/bind-authorize") {
      const typed = bindingTypedData({ chainId: BigInt(baseSepolia), vault: evmVault as never }, { actor: BigInt(actor), destination: evmAddress as never, expectedVersion: BigInt(String(body.expectedVersion)), claimDigest: `0x${hex64("c")}` as never, expiresAt: BigInt(String(body.expiresAt)) });
      const valid = await verifyTypedData({ address: evmAddress as Address, ...signable(typed), signature: body.signature as Hex });
      return valid ? { status: 200, body: { authorized: true, expiresAt: String(body.expiresAt) } } : { status: 403, body: { error: "wallet_signature_required", message: "" } };
    }
    if (path === "/api/v1/payments/wallets/solana-bind/prepare" && attester !== undefined) {
      const wire = prepared.get(String(body.obligationId));
      if (wire === undefined) return { status: 409, body: { error: "binding_not_ready", message: "" } };
      return { status: 200, body: { transactionId: "tx-1", transaction: base64Encode(wire), bindingContext: solanaContext } };
    }
    if (path === "/api/v1/payments/wallets/solana-bind/complete" && attester !== undefined) {
      const signed = base64Decode(String(body.transaction)) ?? new Uint8Array();
      const message = signed.slice(129);
      const destination = base58Decoded(solanaContext.destination);
      const ok = (await attester.verify(message, signed.slice(1, 65))) && (await crypto.subtle.verify("Ed25519", await crypto.subtle.importKey("raw", destination, { name: "Ed25519" }, false, ["verify"]), Uint8Array.from(signed.slice(65, 129)), Uint8Array.from(message)));
      return ok ? { status: 200, body: { transactionId: "tx-1" } } : { status: 409, body: { error: "binding_pending_or_rejected", message: "" } };
    }
    return { status: 404, body: { error: "not_found", message: "" } };
  };
  const solanaContext = { vault: "", programId: "", projectPda: "", networkDomain: hex64("d"), githubUserId: actor, destination: "", claimDigest: hex64("e") };
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const path = new URL(request.url).pathname;
    const text = await request.text();
    const body = (text === "" ? {} : JSON.parse(text)) as Record<string, unknown>;
    seen.push({ method: request.method, path, actor: request.headers.get("x-slop-expected-github-id"), body });
    const result = await answer(path, alter(path, body));
    return new Response(JSON.stringify(result.body), { status: result.status, headers: { "content-type": "application/json" } });
  };
  async function prepare(obligationId: string, wallet: string, vault: string) {
    if (attester === undefined) return;
    const programId = (await ed25519Pair()).address;
    const projectPda = (await ed25519Pair()).address;
    Object.assign(solanaContext, { vault, programId, projectPda, destination: wallet });
    const built = bindWallet({
      program: programId as never,
      project: projectPda as never,
      payer: attester.address as never,
      identityAuthority: attester.address as never,
      destination: wallet as never,
      actor: u64(BigInt(actor)) as U64,
      network: digest(solanaContext.networkDomain) as Digest,
      expectedVersion: u64(5n) as U64,
      claimDigest: digest(solanaContext.claimDigest) as Digest,
      expiresAt: i64(1_800_000_000n) as I64,
    });
    if (built.kind !== "built") throw new Error("binding instruction refused");
    const compiled = compileLegacy({ payer: attester.address as never, blockhash: base58Encode(new Uint8Array(32).fill(7)) as never, instructions: [built.value] });
    if (compiled.kind !== "compiled") throw new Error("binding message refused");
    const wire = new Uint8Array(129 + compiled.bytes.length);
    wire[0] = 2;
    wire.set(await attester.sign(compiled.bytes), 1);
    wire.set(compiled.bytes, 129);
    prepared.set(obligationId, wire);
  }
  return { seen, fetch, prepare };
}

function started(fetch: typeof globalThis.fetch) {
  const base = Layer.mergeAll(walletChoiceServices, sessionLayer, FetchHttpClient.layer, webCrypto, Layer.succeed(FetchHttpClient.Fetch, fetch));
  const runtime = ManagedRuntime.make(Layer.provideMerge(Layer.mergeAll(payoutBinding, walletAttempts), base));
  cleanups.push(() => void runtime.dispose());
  return runtime;
}

const tagOf = <A, E extends { readonly _tag: string }, R>(effect: Effect.Effect<A, E, R>) => Effect.match(effect, { onFailure: (error) => error._tag, onSuccess: () => "ok" });

describe('Choose a wallet without a lookalike taking its place (spec/frontend/wallets.md, "Story: Choose a wallet without a lookalike taking its place"; spec/frontend/walletConsent.md, "Discovery offers announced and legacy providers and refuses conflicting ones"; spec/frontend/wallets.md, "A prompt uses the selected provider object and refuses after an account or chain change")', () => {
  it("a conflicting reannouncement blocks every provider object it names under every identifier, before any request reaches either provider, and a legacy provider is offered once", async () => {
    const legacy = Object.assign(evmWallet(async () => "0x"), { isMetaMask: true });
    const page = window as unknown as { ethereum?: unknown };
    page.ethereum = legacy;
    cleanups.push(() => delete page.ethereum);
    const runtime = started(fakeBackend(undefined).fetch);
    const alpha = evmWallet(async () => "0x");
    const lookalike = evmWallet(async () => "0x");
    const beta = evmWallet(async () => "0x");
    const gamma = evmWallet(async () => "0x");
    const seen = await runtime.runPromise(Effect.gen(function* () {
      const choice = yield* WalletChoice;
      announce("8e0c1c55-1c7a-4c2b-9a6e-3b2f1a0c0d01", "Alpha", alpha);
      announce("not-a-uuid", "Broken", beta);
      announce("8e0c1c55-1c7a-4c2b-9a6e-3b2f1a0c0d02", "Beta", beta);
      const first = (yield* choice.current()).map((offer) => offer.name);
      announce("8e0c1c55-1c7a-4c2b-9a6e-3b2f1a0c0d03", "MetaMask", legacy);
      const announcedLegacy = (yield* choice.current()).map((offer) => offer.name);
      const alphaId = (yield* choice.current()).find((offer) => offer.name === "Alpha")?.id ?? 0;
      announce("8e0c1c55-1c7a-4c2b-9a6e-3b2f1a0c0d01", "Alpha", lookalike);
      const afterConflict = (yield* choice.current()).map((offer) => offer.name);
      const blocked = yield* tagOf(connectEvm(alphaId, false));
      announce("8e0c1c55-1c7a-4c2b-9a6e-3b2f1a0c0d01", "Alpha", alpha);
      const stillBlocked = yield* choice.trusted(alphaId);
      announce("8e0c1c55-1c7a-4c2b-9a6e-3b2f1a0c0d05", "Lookalike", lookalike);
      const renamedLookalike = (yield* choice.current()).map((offer) => offer.name);
      announce("8e0c1c55-1c7a-4c2b-9a6e-3b2f1a0c0d04", "Gamma", gamma);
      const withGamma = (yield* choice.current()).map((offer) => offer.name);
      announce("8e0c1c55-1c7a-4c2b-9a6e-3b2f1a0c0d01", "Alpha", gamma);
      const gammaBlocked = (yield* choice.current()).map((offer) => offer.name);
      return { first, announcedLegacy, afterConflict, blocked, stillBlocked, renamedLookalike, withGamma, gammaBlocked };
    }));
    expect({ ...seen, alpha: alpha.seen, lookalike: lookalike.seen, gamma: gamma.seen }).toStrictEqual({
      first: ["Alpha", "Beta", "MetaMask"],
      announcedLegacy: ["Alpha", "Beta", "MetaMask"],
      afterConflict: ["Beta", "MetaMask"],
      blocked: "WalletUntrusted",
      stillBlocked: false,
      renamedLookalike: ["Beta", "MetaMask"],
      withGamma: ["Beta", "MetaMask", "Gamma"],
      gammaBlocked: ["Beta", "MetaMask"],
      alpha: [],
      lookalike: [],
      gamma: [],
    });
  });
});

describe('Ask the wallet once per saved attempt and keep an uncertain one (spec/frontend/walletAttempt.md, "Story: Ask the wallet once per saved attempt and keep an uncertain one"; spec/frontend/walletAttempt.md, "A wallet prompt starts only after storage creates an empty slot"; spec/frontend/walletAttempt.md, "A late wallet reply changes only the slot that still holds its own attempt"; spec/frontend/walletAttempt.md, "Recovery and settlement use the saved record of the signed-in account only")', () => {
  it("a saved request is sent once, a decline clears it, an uncertain send keeps it, and each account sees only its own slot", async () => {
    const replies: Array<() => Promise<unknown>> = [
      async () => `0x${hex64("a")}`,
      async () => Promise.reject(Object.assign(new Error("User rejected"), { code: 4001 })),
      async () => Promise.reject(new Error("RPC timeout")),
    ];
    const wallet = evmWallet(async () => (replies.shift() ?? (async () => "0x"))());
    const slot = { name: "journey", key: (account: number) => `slop:vault-action:v1:base-sepolia:${evmVault}:${account}` };
    cleanups.push(() => {
      sessionStorage.removeItem(slot.key(7));
      sessionStorage.removeItem(slot.key(8));
    });
    const runtime = started(fakeBackend(undefined).fetch);
    const result = await runtime.runPromise(Effect.gen(function* () {
      const choice = yield* WalletChoice;
      announce("8e0c1c55-1c7a-4c2b-9a6e-3b2f1a0c0d11", "Vault wallet", wallet);
      const id = (yield* choice.current()).find((offer) => offer.name === "Vault wallet")?.id ?? 0;
      const connection = yield* connectEvm(id, false);
      const journal = yield* (yield* WalletAttempts).journal(slot);
      const transaction = { from: connection.address, to: evmVault, data: "0x" };
      const send = (request: string) => journal.submit(request, "The wallet may have sent it. Check wallet activity before another attempt.", (beforePrompt) => sendTransaction(connection, BigInt(baseSepolia), transaction, beforePrompt));
      yield* journal.follow(7);
      const sent = yield* send("deposit-1");
      const stored = sessionStorage.getItem(slot.key(7));
      const repeated = yield* tagOf(send("deposit-2"));
      yield* journal.follow(8);
      const otherAccount = yield* journal.recovery();
      const declined = yield* tagOf(send("deposit-3"));
      const afterDecline = sessionStorage.getItem(slot.key(8));
      const uncertain = yield* tagOf(send("deposit-4"));
      const kept = yield* journal.recovery();
      yield* journal.follow(7);
      const recovered = yield* journal.recovery();
      const cleared = yield* journal.clearSettled(recovered);
      return { sent, stored: JSON.parse(stored ?? "null"), repeated, otherAccount, declined, afterDecline, uncertain, kept: { request: kept.bytesId, hash: kept.hash }, recovered: recovered.hash, cleared, finalSeven: sessionStorage.getItem(slot.key(7)) };
    }));
    expect({ ...result, stored: { ...result.stored, attemptId: typeof result.stored.attemptId }, sends: wallet.seen.filter((method) => method === "eth_sendTransaction").length }).toStrictEqual({
      sent: { hash: `0x${hex64("a")}`, saved: true },
      stored: { attemptId: "string", request: "deposit-1", hash: `0x${hex64("a")}` },
      repeated: "AttemptRefused",
      otherAccount: { identity: "", bytesId: "", hash: "", candidate: "" },
      declined: "WalletDeclined",
      afterDecline: null,
      uncertain: "AttemptUncertain",
      kept: { request: "deposit-4", hash: "" },
      recovered: `0x${hex64("a")}`,
      cleared: "Quiet",
      finalSeven: null,
      sends: 3,
    });
    const reloaded = await started(fakeBackend(undefined).fetch).runPromise(Effect.gen(function* () {
      const journal = yield* (yield* WalletAttempts).journal(slot);
      const notice = (yield* journal.follow(8)).notice;
      const saved = yield* journal.recovery();
      const resend = yield* Effect.match(journal.submit("deposit-5", "unclear", (beforePrompt) => Effect.as(beforePrompt, `0x${hex64("c")}`)), { onFailure: (error) => (error._tag === "AttemptRefused" ? error.notice : error._tag), onSuccess: () => "sent" });
      return { notice, saved: { request: saved.bytesId, hash: saved.hash }, resend, stored: JSON.parse(sessionStorage.getItem(slot.key(8)) ?? "null").request };
    }));
    expect(reloaded).toStrictEqual({ notice: "Recover", saved: { request: "deposit-4", hash: "" }, resend: "Occupied", stored: "deposit-4" });
  });

  it("a hash the browser cannot save is still returned, and a request it cannot save never reaches the wallet", async () => {
    const slot = { name: "unsaved", key: (account: number) => `slop:vault-action:v1:base-sepolia:${evmVault}:unsaved:${account}` };
    cleanups.push(() => sessionStorage.removeItem(slot.key(9)));
    let refuse: (value: string) => boolean = (value) => value.includes('"hash"');
    const storage = {
      getItem: (key: string) => sessionStorage.getItem(key),
      setItem: (key: string, value: string) => {
        if (key === slot.key(9) && refuse(value)) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        sessionStorage.setItem(key, value);
      },
      removeItem: (key: string) => sessionStorage.removeItem(key),
    };
    let prompts = 0;
    const prompt = <E,>(beforePrompt: Effect.Effect<void, E>) => Effect.map(beforePrompt, (): string => {
      prompts += 1;
      return `0x${hex64("b")}`;
    });
    const result = await started(fakeBackend(undefined).fetch).runPromise(Effect.gen(function* () {
      const journal = yield* attemptJournal(slot, storage);
      yield* journal.follow(9);
      const sent = yield* journal.submit("deposit-6", "unclear", prompt);
      const kept = JSON.parse(sessionStorage.getItem(slot.key(9)) ?? "null");
      sessionStorage.removeItem(slot.key(9));
      refuse = () => true;
      const blocked = yield* Effect.match(journal.submit("deposit-7", "unclear", prompt), { onFailure: (error) => (error._tag === "AttemptRefused" ? error.notice : error._tag), onSuccess: () => "sent" });
      return { sent, kept: { request: kept.request, hash: kept.hash ?? "" }, blocked, after: sessionStorage.getItem(slot.key(9)) };
    }));
    expect({ ...result, prompts }).toStrictEqual({
      sent: { hash: `0x${hex64("b")}`, saved: false },
      kept: { request: "deposit-6", hash: "" },
      blocked: "StorageBlocked",
      after: null,
      prompts: 1,
    });
  });
});

describe(`Sign exactly the binding the server prepared (spec/frontend/walletConsent.md, "Story: Sign exactly the binding the server prepared"; spec/frontend/walletConsent.md, "Replacing a saved wallet needs an explicit choice"; spec/frontend/walletConsent.md, "The prepared and signed bytes must equal the server's message before posting"; spec/backend/wallets.md, "The server issues an expiring challenge for the exact current registry claim"; spec/backend/bindingConsent.md, "EVM consent names one registered deployment, the authorized claim and an expected version"; spec/backend/bindingConsent.md, "A Solana binding is one half-signed transaction per generation that only the wallet slot completes"; spec/settlement/signer.md, "A binding needs the account's current intent and the wallet's own signature")`, () => {
  it("an EVM wallet is confirmed on each EVM chain and then binds a reserved payment, every request naming the expected account", async () => {
    const backend = fakeBackend(undefined);
    const runtime = started(backend.fetch);
    const wallet = evmWallet(async () => "0x");
    const outcome = await runtime.runPromise(Effect.gen(function* () {
      const choice = yield* WalletChoice;
      announce("8e0c1c55-1c7a-4c2b-9a6e-3b2f1a0c0d21", "Payout wallet", wallet);
      const id = (yield* choice.current()).find((offer) => offer.name === "Payout wallet")?.id ?? 0;
      const connection = yield* connectEvm(id, false);
      const registered = yield* registerFamily(evmSigner(connection), actor, []);
      const binding = yield* PayoutBinding;
      yield* binding.follow(Number(actor), evmAddress);
      yield* binding.open({ paymentId: "obligation-1", chain: "base", network: "base-sepolia", vault: evmVault, claimId: registered.claims.base ?? "", claimAddress: evmAddress }, actor);
      const phases = [(yield* binding.choose(id)).consent.phase, (yield* binding.prepare()).consent.phase, (yield* binding.sign()).consent.phase];
      const posted = yield* binding.post();
      return { phases, phase: posted.consent.phase, saved: posted.consent.savedWallet };
    }));
    const authorized = backend.seen.find((call) => call.path.endsWith("/bind-authorize"))?.body as { signature?: string } | undefined;
    expect({ ...outcome, signedBy: wallet.signatures.at(-1) === authorized?.signature, calls: backend.seen.filter((call) => call.method === "POST").map((call) => [call.path.slice("/api/v1/payments/wallets/".length), call.actor]) }).toStrictEqual({
      phases: ["Connected", "Prepared", "Signed"],
      phase: "Accepted",
      saved: evmAddress,
      signedBy: true,
      calls: [
        ...["base", "robinhood", "ethereum"].flatMap(() => [["register", actor], ["challenge", actor], ["authorize", actor]]),
        ["bind-challenge", actor],
        ["bind-authorize", actor],
      ],
    });
  });

  it("a consent naming another destination is refused before the wallet is asked to sign", async () => {
    const backend = fakeBackend(undefined, (path, body) => path.endsWith("/bind-challenge") ? { ...body, claimId: "another-claim" } : body);
    const runtime = started(backend.fetch);
    const wallet = evmWallet(async () => "0x");
    const outcome = await runtime.runPromise(Effect.gen(function* () {
      const choice = yield* WalletChoice;
      announce("8e0c1c55-1c7a-4c2b-9a6e-3b2f1a0c0d31", "Payout wallet", wallet);
      const id = (yield* choice.current()).find((offer) => offer.name === "Payout wallet")?.id ?? 0;
      const binding = yield* PayoutBinding;
      yield* binding.follow(Number(actor), evmAddress);
      yield* binding.open({ paymentId: "obligation-2", chain: "base", network: "base-sepolia", vault: evmVault, claimId: "claim-base-1", claimAddress: evmAddress }, actor);
      yield* binding.choose(id);
      const prepared = yield* binding.prepare();
      return { phase: prepared.consent.phase, explained: prepared.problem !== "" };
    }));
    expect({ ...outcome, signed: wallet.seen.includes("eth_signTypedData_v4"), authorized: backend.seen.some((call) => call.path.endsWith("/bind-authorize")) }).toStrictEqual({
      phase: "Refused",
      explained: true,
      signed: false,
      authorized: false,
    });
  });

  it("a connected wallet other than the authorized claim is refused, and nothing is prepared, signed or registered", async () => {
    const backend = fakeBackend(undefined);
    const runtime = started(backend.fetch);
    const wallet = evmWallet(async () => "0x");
    const outcome = await runtime.runPromise(Effect.gen(function* () {
      const choice = yield* WalletChoice;
      announce("8e0c1c55-1c7a-4c2b-9a6e-3b2f1a0c0d41", "Payout wallet", wallet);
      const id = (yield* choice.current()).find((offer) => offer.name === "Payout wallet")?.id ?? 0;
      const binding = yield* PayoutBinding;
      const claimAddress = "0x00000000000000000000000000000000000000c3";
      yield* binding.follow(Number(actor), claimAddress);
      yield* binding.open({ paymentId: "obligation-3", chain: "base", network: "base-sepolia", vault: evmVault, claimId: "claim-base-1", claimAddress }, actor);
      const chosen = yield* binding.choose(id);
      const prepared = yield* binding.prepare();
      return { phase: chosen.consent.phase, explained: chosen.problem !== "", afterPrepare: prepared.consent.phase, saved: prepared.consent.savedWallet === claimAddress };
    }));
    expect({ ...outcome, prompts: wallet.seen.filter((method) => method === "personal_sign" || method === "eth_signTypedData_v4" || method === "eth_sendTransaction"), posts: backend.seen.filter((call) => call.method === "POST").map((call) => call.path) }).toStrictEqual({
      phase: "Refused",
      explained: true,
      afterPrepare: "Refused",
      saved: true,
      prompts: [],
      posts: [],
    });
  });

  it("an EVM consent posts the wallet's signature as signed, and the server, not the page, refuses one by another key", async () => {
    const backend = fakeBackend(undefined);
    const runtime = started(backend.fetch);
    const other = privateKeyToAccount("0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba");
    const wallet = testProvider(async (method, params) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [evmAccount.address];
      if (method === "eth_chainId") return `0x${baseSepolia.toString(16)}`;
      if (method === "eth_signTypedData_v4") return other.signTypedData(signable(JSON.parse(String(params[1]))));
      throw Object.assign(new Error(`unsupported ${method}`), { code: 4200 });
    });
    const outcome = await runtime.runPromise(Effect.gen(function* () {
      const choice = yield* WalletChoice;
      announce("8e0c1c55-1c7a-4c2b-9a6e-3b2f1a0c0d51", "Payout wallet", wallet);
      const id = (yield* choice.current()).find((offer) => offer.name === "Payout wallet")?.id ?? 0;
      const binding = yield* PayoutBinding;
      yield* binding.follow(Number(actor), evmAddress);
      yield* binding.open({ paymentId: "obligation-4", chain: "base", network: "base-sepolia", vault: evmVault, claimId: "claim-base-1", claimAddress: evmAddress }, actor);
      const phases = [(yield* binding.choose(id)).consent.phase, (yield* binding.prepare()).consent.phase, (yield* binding.sign()).consent.phase];
      const posted = yield* binding.post();
      return { phases, phase: posted.consent.phase, saved: posted.consent.savedWallet };
    }));
    expect({ ...outcome, posted: backend.seen.filter((call) => call.method === "POST").map((call) => call.path.slice("/api/v1/payments/wallets/".length)) }).toStrictEqual({
      phases: ["Connected", "Prepared", "Signed"],
      phase: "Refused",
      saved: evmAddress,
      posted: ["bind-challenge", "bind-authorize"],
    });
  });

  it("a Solana wallet completes the attester's half-signed binding, and a wallet that changes the transaction is refused before anything is submitted", async () => {
    const attester = await ed25519Pair();
    const run = async (tamper: boolean) => {
      const owner = await ed25519Pair();
      const vault = (await ed25519Pair()).address;
      const backend = fakeBackend(attester);
      await backend.prepare("obligation-sol", owner.address, vault);
      const unregister = getWallets().register(solanaWallet(owner, tamper));
      cleanups.push(unregister);
      const runtime = started(backend.fetch);
      const outcome = await runtime.runPromise(Effect.gen(function* () {
        const choice = yield* WalletChoice;
        const id = (yield* choice.current()).find((offer) => offer.family === "solana" && offer.solanaBinding)?.id ?? 0;
        const binding = yield* PayoutBinding;
        yield* binding.follow(Number(actor), owner.address);
        yield* binding.open({ paymentId: "obligation-sol", chain: "solana", network: "solana-devnet", vault, claimId: "claim-solana-1", claimAddress: owner.address }, actor);
        const phases = [(yield* binding.choose(id)).consent.phase, (yield* binding.prepare()).consent.phase, (yield* binding.sign()).consent.phase];
        const posted = yield* binding.post();
        return { phases, phase: posted.consent.phase, explained: posted.problem !== "" };
      }));
      unregister();
      return { ...outcome, completed: backend.seen.some((call) => call.path.endsWith("/solana-bind/complete")) };
    };
    expect({ honest: await run(false), altered: await run(true) }).toStrictEqual({
      honest: {
        phases: ["Connected", "Prepared", "Signed"],
        phase: "Accepted",
        explained: false,
        completed: true,
      },
      altered: {
        phases: ["Connected", "Prepared", "Refused"],
        phase: "Refused",
        explained: true,
        completed: false,
      },
    });
  });
});
