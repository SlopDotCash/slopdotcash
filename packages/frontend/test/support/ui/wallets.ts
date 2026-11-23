// spec/frontend/wallets.md, "Story: Choose a wallet without a lookalike taking its place"; spec/frontend/walletConsent.md, "Discovery offers announced and legacy providers and refuses conflicting ones"; spec/frontend/wallets.md, "A Solana wallet qualifies only with a solana chain, connect and sign-message features"
import { randomUUID, webcrypto } from "node:crypto";
import type { Anvil } from "@repo/platform/testing/chains";
import type { BrowserContext } from "playwright";
import type { Addresses, WalletAsked, WalletSetup } from "./protocol.ts";

interface Asked {
  readonly family: "evm" | "solana";
  readonly method: string;
  readonly params: ReadonlyArray<unknown>;
}

type Answer = { readonly result: unknown } | { readonly error: { readonly code: number; readonly message: string } };

interface Injected {
  readonly evm: { readonly uuid: string; readonly name: string; readonly rdns: string; readonly icon: string } | null;
  readonly solana: { readonly name: string; readonly icon: string; readonly address: string; readonly publicKey: ReadonlyArray<number> } | null;
}

export interface Wallets {
  readonly asked: ReadonlyArray<WalletAsked>;
  useAccount(index: number): void;
  rejectNext(): void;
  failNext(method: string): void;
  addresses(): Promise<Addresses>;
}

export type Chains = (chainId: number) => Promise<Anvil>;

export const homeChainId = 8453;

const walletChainIds: ReadonlyArray<number> = [homeChainId, 4663];

const icon = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#5b6cff"/></svg>').toString("base64")}`;
const prompting = new Set(["eth_requestAccounts", "wallet_requestPermissions", "personal_sign", "eth_sendTransaction", "standard:connect", "solana:signMessage"]);
const rejected: Answer = { error: { code: 4001, message: "User rejected the request." } };
const failed: Answer = { error: { code: -32603, message: "Internal JSON-RPC error." } };
const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let text = "";
  while (value > 0n) {
    text = alphabet[Number(value % 58n)] + text;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    text = `1${text}`;
  }
  return text;
}

function install(setup: Injected) {
  const host = window as unknown as { __slopWallet: (asked: Asked) => Promise<Answer> };
  const answered = async (asked: Asked) => {
    const answer = await host.__slopWallet(asked);
    if ("error" in answer) throw Object.assign(new Error(answer.error.message), { code: answer.error.code });
    return answer.result;
  };
  if (setup.evm !== null) {
    const listeners = new Map<string, Set<(value: unknown) => void>>();
    const provider = {
      request: ({ method, params }: { readonly method: string; readonly params?: ReadonlyArray<unknown> }) => answered({ family: "evm", method, params: params ?? [] }),
      on: (event: string, listener: (value: unknown) => void) => {
        const set = listeners.get(event) ?? new Set();
        set.add(listener);
        listeners.set(event, set);
        return provider;
      },
      removeListener: (event: string, listener: (value: unknown) => void) => {
        listeners.get(event)?.delete(listener);
        return provider;
      },
    };
    const { uuid, name, rdns, icon: shown } = setup.evm;
    const detail = Object.freeze({ info: Object.freeze({ uuid, name, rdns, icon: shown }), provider });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }
  if (setup.solana !== null) {
    const chains = ["solana:mainnet", "solana:devnet"] as const;
    const account = Object.freeze({ address: setup.solana.address, publicKey: Uint8Array.from(setup.solana.publicKey), chains, features: ["solana:signMessage"] as const });
    const changes = new Set<(properties: { readonly accounts: ReadonlyArray<typeof account> }) => void>();
    const wallet = {
      version: "1.0.0" as const,
      name: setup.solana.name,
      icon: setup.solana.icon,
      chains,
      accounts: [] as ReadonlyArray<typeof account>,
      features: {
        "standard:connect": {
          version: "1.0.0" as const,
          connect: async () => {
            await answered({ family: "solana", method: "standard:connect", params: [] });
            wallet.accounts = [account];
            for (const change of changes) change({ accounts: wallet.accounts });
            return { accounts: wallet.accounts };
          },
        },
        "standard:events": {
          version: "1.0.0" as const,
          on: (_event: "change", listener: (properties: { readonly accounts: ReadonlyArray<typeof account> }) => void) => {
            changes.add(listener);
            return () => {
              changes.delete(listener);
            };
          },
        },
        "solana:signMessage": {
          version: "1.0.0" as const,
          signMessage: (...inputs: ReadonlyArray<{ readonly message: Uint8Array }>) =>
            Promise.all(inputs.map(async ({ message }) => {
              const signature = await answered({ family: "solana", method: "solana:signMessage", params: [Array.from(message)] });
              return { signedMessage: message, signature: Uint8Array.from(signature as ReadonlyArray<number>) };
            })),
        },
      },
    };
    const register = (api: { readonly register: (registered: typeof wallet) => unknown }) => api.register(wallet);
    window.addEventListener("wallet-standard:app-ready", (event) => register((event as CustomEvent<{ readonly register: (registered: typeof wallet) => unknown }>).detail));
    window.dispatchEvent(new CustomEvent("wallet-standard:register-wallet", { detail: register }));
  }
}

function isKeyPair(value: webcrypto.CryptoKey | webcrypto.CryptoKeyPair): value is webcrypto.CryptoKeyPair {
  return "privateKey" in value && "publicKey" in value;
}

async function solanaKey() {
  const pair = await webcrypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
  if (!isKeyPair(pair)) throw new Error("Ed25519 generated no key pair");
  const publicKey = new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey));
  return { pair, publicKey, address: base58(publicKey) };
}

function switchedTo(params: ReadonlyArray<unknown>): number | undefined {
  const [asked] = params;
  const chainId = typeof asked === "object" && asked !== null && "chainId" in asked ? asked.chainId : undefined;
  if (typeof chainId !== "string" || !/^0x[0-9a-f]+$/iu.test(chainId)) return undefined;
  const id = Number(BigInt(chainId));
  return walletChainIds.includes(id) ? id : undefined;
}

export async function injectWallets(context: BrowserContext, setup: WalletSetup, chains: Chains | undefined): Promise<Wallets> {
  const key = setup.solana === undefined ? undefined : await solanaKey();
  const asked: WalletAsked[] = [];
  const failing: string[] = [];
  let account = 0;
  let rejections = 0;
  let selected = homeChainId;
  const evmAddress = async (on: Chains) => {
    const chosen = (await on(homeChainId)).accounts[account];
    if (chosen === undefined) throw new Error(`anvil has no account ${account}`);
    return chosen.address.toLowerCase();
  };
  const evm = async (method: string, params: ReadonlyArray<unknown>): Promise<Answer> => {
    if (chains === undefined) return { error: { code: 4900, message: "No EVM wallet" } };
    if (method === "eth_requestAccounts" || method === "eth_accounts") return { result: [await evmAddress(chains)] };
    if (method === "wallet_requestPermissions") return { result: [{ parentCapability: "eth_accounts" }] };
    if (method === "wallet_getCapabilities") return { error: { code: 4200, message: "The wallet does not support this method." } };
    if (method === "wallet_switchEthereumChain") {
      const next = switchedTo(params);
      if (next === undefined) return { error: { code: 4902, message: "Unrecognized chain ID." } };
      selected = next;
      return { result: null };
    }
    const chain = await chains(selected);
    return chain.rpc(method, params).then((result) => ({ result }), (error: unknown) => ({ error: { code: -32603, message: String(error instanceof Error ? error.message : error) } }));
  };
  const solana = async (method: string, params: ReadonlyArray<unknown>): Promise<Answer> => {
    if (key === undefined) return { error: { code: 4900, message: "No Solana wallet" } };
    if (method === "standard:connect") return { result: key.address };
    if (method === "solana:signMessage") {
      const message = Uint8Array.from(params[0] as ReadonlyArray<number>);
      return { result: Array.from(new Uint8Array(await webcrypto.subtle.sign({ name: "Ed25519" }, key.pair.privateKey, message))) };
    }
    return { error: { code: 4200, message: "The wallet does not support this method." } };
  };
  await context.exposeBinding("__slopWallet", async (_source, request: Asked): Promise<Answer> => {
    asked.push({ family: request.family, method: request.method });
    const failure = request.family === "evm" ? failing.indexOf(request.method) : -1;
    if (failure >= 0) {
      failing.splice(failure, 1);
      return failed;
    }
    if (prompting.has(request.method) && rejections > 0) {
      rejections -= 1;
      return rejected;
    }
    return request.family === "evm" ? evm(request.method, request.params) : solana(request.method, request.params);
  });
  const injected: Injected = {
    evm: setup.evm === undefined ? null : { uuid: randomUUID(), name: setup.evm.name, rdns: "test.slop.anvil", icon },
    solana: key === undefined || setup.solana === undefined ? null : { name: setup.solana.name, icon, address: key.address, publicKey: Array.from(key.publicKey) },
  };
  await context.addInitScript(install, injected);
  return {
    asked,
    useAccount: (index) => {
      account = index;
    },
    rejectNext: () => {
      rejections += 1;
    },
    failNext: (method) => {
      failing.push(method);
    },
    addresses: async () => ({ evm: chains === undefined ? null : await evmAddress(chains), solana: key?.address ?? null }),
  };
}
