// spec/frontend/walletConsent.md, "Discovery offers announced and legacy providers and refuses conflicting ones"; spec/frontend/wallets.md, "A Solana wallet qualifies only with a solana chain, connect and sign-message features"; spec/frontend/wallets.md, "A prompt uses the selected provider object and refuses after an account or chain change"
import type { SolanaSignAndSendTransactionFeature, SolanaSignMessageFeature, SolanaSignTransactionFeature } from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import type { StandardConnectFeature } from "@wallet-standard/features";
import type { StandardWallet } from "../../../gen/frontend__wallets.ts";

export interface Eip1193 {
  request(input: { readonly method: string; readonly params?: ReadonlyArray<unknown> }): Promise<unknown>;
}

interface InjectedEthereum extends Eip1193 {
  readonly providers?: ReadonlyArray<InjectedEthereum>;
  readonly isMetaMask?: boolean;
  readonly isPhantom?: boolean;
  readonly isCoinbaseWallet?: boolean;
  readonly isRabby?: boolean;
  readonly isBraveWallet?: boolean;
  readonly isTrust?: boolean;
  readonly isTrustWallet?: boolean;
}

export interface LegacySolana {
  connect(): Promise<{ readonly publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, display: "utf8"): Promise<{ readonly signature: Uint8Array }>;
  readonly isPhantom?: boolean;
  readonly isSolflare?: boolean;
}

interface WalletWindow {
  readonly ethereum?: InjectedEthereum;
  readonly solana?: LegacySolana;
  readonly phantom?: { readonly solana?: LegacySolana };
}

export interface Announcement {
  readonly uuid: string;
  readonly name: string;
  readonly rdns: string;
  readonly icon: string;
  readonly provider: Eip1193;
}

export interface NamedLegacy<P> {
  readonly provider: P;
  readonly name: string;
}

export interface ProviderFeed {
  readonly announcements: ReadonlyArray<Announcement>;
  /** @throws {never} */
  standard(): ReadonlyArray<Wallet>;
  /** @throws {never} */
  changed(signal: AbortSignal): Promise<void>;
  /** @throws {never} */
  stop(): void;
}

export interface WalletSource {
  /** @throws {never} */
  listen(): ProviderFeed;
  /** @throws {never} */
  legacyEvm(): ReadonlyArray<NamedLegacy<Eip1193>>;
  /** @throws {never} */
  legacySolana(): ReadonlyArray<NamedLegacy<LegacySolana>>;
}

export interface WalletFailure {
  readonly code: number | undefined;
  readonly message: string;
}

const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const shownIconPattern = /^data:image\/(?:png|jpeg|webp|svg\+xml)[;,]/u;
const failureMessageLimit = 300;

const legacyEvmNames = [
  ["isRabby", "Rabby"],
  ["isBraveWallet", "Brave Wallet"],
  ["isPhantom", "Phantom"],
  ["isTrust", "Trust Wallet"],
  ["isTrustWallet", "Trust Wallet"],
  ["isCoinbaseWallet", "Coinbase Wallet"],
  ["isMetaMask", "MetaMask"],
] as const satisfies ReadonlyArray<readonly [keyof InjectedEthereum, string]>;

/** @throws {never} */
function browserWindow(): (Window & WalletWindow) | undefined {
  return typeof window === "undefined" ? undefined : window;
}

/** @throws {never} */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** @throws {never} */
function isEip1193(value: unknown): value is Eip1193 {
  return isRecord(value) && typeof value.request === "function";
}

/** @throws {never} */
export function announcementOf(detail: unknown): Announcement | undefined {
  if (!isRecord(detail) || !isRecord(detail.info) || !isEip1193(detail.provider)) return undefined;
  const { uuid, name, rdns, icon } = detail.info;
  if (typeof uuid !== "string" || !uuidV4.test(uuid) || typeof name !== "string" || name.trim() === "" || typeof rdns !== "string" || typeof icon !== "string") return undefined;
  return { uuid: uuid.toLowerCase(), name, rdns, icon, provider: detail.provider };
}

/** @throws {never} */
export function shownIcon(...candidates: ReadonlyArray<string | undefined>): string | undefined {
  return candidates.find((icon) => icon !== undefined && shownIconPattern.test(icon));
}

/** @throws {never} */
export function listenProviders(): ProviderFeed {
  const announcements: Announcement[] = [];
  const waiting = new Set<() => void>();
  const notify = () => {
    for (const wake of [...waiting]) wake();
  };
  const page = browserWindow();
  if (page === undefined) return { announcements, standard: () => [], changed: () => new Promise<void>(() => undefined), stop: () => undefined };
  const standard = getWallets();
  const announce = (event: Event) => {
    const parsed = announcementOf((event as CustomEvent<unknown>).detail);
    if (parsed === undefined) return;
    announcements.push(parsed);
    notify();
  };
  const offRegister = standard.on("register", notify);
  const offUnregister = standard.on("unregister", notify);
  page.addEventListener("eip6963:announceProvider", announce);
  page.dispatchEvent(new Event("eip6963:requestProvider"));
  return {
    announcements,
    standard: () => standard.get(),
    changed: (signal) =>
      new Promise<void>((resolve) => {
        const wake = () => {
          waiting.delete(wake);
          signal.removeEventListener("abort", wake);
          resolve();
        };
        waiting.add(wake);
        signal.addEventListener("abort", wake, { once: true });
      }),
    stop: () => {
      offRegister();
      offUnregister();
      page.removeEventListener("eip6963:announceProvider", announce);
      notify();
    },
  };
}

/** @throws {never} */
export function legacyEvmProviders(): ReadonlyArray<NamedLegacy<Eip1193>> {
  const ethereum = browserWindow()?.ethereum;
  if (ethereum === undefined) return [];
  return [...new Set(ethereum.providers ?? [ethereum])].filter((provider): provider is InjectedEthereum => isEip1193(provider)).map((provider) => ({
    provider,
    name: legacyEvmNames.find(([flag]) => provider[flag] === true)?.[1] ?? "Browser wallet",
  }));
}

/** @throws {never} */
export function legacySolanaProviders(): ReadonlyArray<NamedLegacy<LegacySolana>> {
  const page = browserWindow();
  if (page === undefined) return [];
  const found = [...new Set([page.phantom?.solana, page.solana])].filter((provider): provider is LegacySolana => provider !== undefined);
  return found.map((provider) => ({
    provider,
    name: provider === page.phantom?.solana || provider.isPhantom === true ? "Phantom" : provider.isSolflare === true ? "Solflare" : "Browser wallet",
  }));
}

export const browserSource: WalletSource = { listen: listenProviders, legacyEvm: legacyEvmProviders, legacySolana: legacySolanaProviders };

/** @throws {never} */
export function standardShape(wallet: Wallet): StandardWallet {
  return {
    solanaChain: wallet.chains.some((chain) => chain.startsWith("solana:")),
    standardConnect: "standard:connect" in wallet.features,
    signMessage: "solana:signMessage" in wallet.features,
    signAndSend: "solana:signAndSendTransaction" in wallet.features && legacyVersion(wallet.features["solana:signAndSendTransaction"]),
    signTransaction: "solana:signTransaction" in wallet.features && legacyVersion(wallet.features["solana:signTransaction"]),
  };
}

/** @throws {never} */
function legacyVersion(feature: unknown): boolean {
  return isRecord(feature) && Array.isArray(feature.supportedTransactionVersions) && feature.supportedTransactionVersions.includes("legacy");
}

/** @throws {never} */
export function failureOf(caught: unknown): WalletFailure {
  const code = isRecord(caught) && typeof caught.code === "number" ? caught.code : undefined;
  const text = isRecord(caught) && typeof caught.message === "string" ? caught.message : caught instanceof Error ? caught.message : "";
  return { code, message: text.slice(0, failureMessageLimit) };
}

/** @throws {never} */
export function providerRequest(provider: Eip1193, method: string, params: ReadonlyArray<unknown>): Promise<unknown> {
  return provider.request(params.length === 0 ? { method } : { method, params });
}

/** @throws {never} */
export function utf8Hex(text: string): string {
  return `0x${[...new TextEncoder().encode(text)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** @throws {never} */
export function stillRegistered(wallet: Wallet, address: string, feature: string, chain: string | undefined): WalletAccount | undefined {
  if (!getWallets().get().includes(wallet)) return undefined;
  const current = wallet.accounts.find((account) => account.address === address);
  if (current === undefined || !current.features.includes(feature as `${string}:${string}`)) return undefined;
  return chain === undefined || current.chains.includes(chain as `${string}:${string}`) ? current : undefined;
}

/** @throws {never} */
export async function connectStandard(wallet: Wallet): Promise<string | undefined> {
  const connect = (wallet.features as Partial<StandardConnectFeature>)["standard:connect"];
  if (connect === undefined) return undefined;
  const { accounts } = await connect.connect();
  return accounts.find((account) => account.chains.some((chain) => chain.startsWith("solana:")) && account.features.includes("solana:signMessage"))?.address;
}

/** @throws {never} */
export async function standardSignMessage(wallet: Wallet, account: WalletAccount, message: Uint8Array): Promise<{ readonly signedMessage: Uint8Array; readonly signature: Uint8Array } | undefined> {
  const feature = (wallet.features as Partial<SolanaSignMessageFeature>)["solana:signMessage"];
  if (feature === undefined) return undefined;
  const [result] = await feature.signMessage({ account, message: message.slice() });
  return result === undefined ? undefined : { signedMessage: Uint8Array.from(result.signedMessage), signature: Uint8Array.from(result.signature) };
}

/** @throws {never} */
export async function standardSignTransaction(wallet: Wallet, account: WalletAccount, chain: string, transaction: Uint8Array): Promise<Uint8Array | undefined> {
  const feature = (wallet.features as Partial<SolanaSignTransactionFeature>)["solana:signTransaction"];
  if (feature === undefined) return undefined;
  const [result] = await feature.signTransaction({ account, chain: chain as `${string}:${string}`, transaction: transaction.slice() });
  return result?.signedTransaction === undefined ? undefined : Uint8Array.from(result.signedTransaction);
}

/** @throws {never} */
export async function standardSignAndSend(wallet: Wallet, account: WalletAccount, chain: string, transaction: Uint8Array): Promise<Uint8Array | undefined> {
  const feature = (wallet.features as Partial<SolanaSignAndSendTransactionFeature>)["solana:signAndSendTransaction"];
  if (feature === undefined) return undefined;
  const [result] = await feature.signAndSendTransaction({
    account,
    chain: chain as `${string}:${string}`,
    transaction: transaction.slice(),
    options: { commitment: "confirmed", skipPreflight: false, maxRetries: 0 },
  });
  return result === undefined ? undefined : Uint8Array.from(result.signature);
}

/** @throws {never} */
export async function legacyConnect(provider: LegacySolana): Promise<string> {
  return (await provider.connect()).publicKey.toString();
}

/** @throws {never} */
export async function legacySignMessage(provider: LegacySolana, message: Uint8Array): Promise<Uint8Array> {
  return Uint8Array.from((await provider.signMessage(message.slice(), "utf8")).signature);
}
