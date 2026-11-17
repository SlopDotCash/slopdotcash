// spec/frontend/presentation.md, "Settings keeps wallet and email controls expanded without account navigation tabs"; spec/backend/email.md, "Consent changes are compare-and-set and enabling binds the exact destination version"
import type { EmailPanel } from "../../flows/account/email.vibe";
import type { SignInState } from "./signIn.vibe";
import { type PaymentsAccount, type WalletPanel, walletPanelOpened } from "./walletPanel.vibe";
import type { WalletOffer } from "../../wallets/core/discovery.vibe";

const evmAddress = "0x8ba1f109551bd432803012645ac136ddd64dba72";
const solanaAddress = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";

export const account: PaymentsAccount = {
  githubUserId: "583231",
  wallets: [
    { chain: "base", claimId: "claim-base", address: evmAddress, authorized: true, firstAuthorizedAt: "2026-10-02T09:00:00.000Z" },
    { chain: "ethereum", claimId: "claim-ethereum", address: evmAddress, authorized: true, firstAuthorizedAt: "2026-10-02T09:01:00.000Z" },
    { chain: "robinhood", claimId: "claim-robinhood", address: evmAddress, authorized: false, firstAuthorizedAt: null },
    { chain: "solana", claimId: "claim-solana", address: solanaAddress, authorized: true, firstAuthorizedAt: "2026-10-03T10:00:00.000Z" },
  ],
  payments: [],
  monthlyAwards: [],
  balances: [{ chain: "base", network: "base-mainnet", assetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", assetDecimals: 6, netBase: "12500000" }],
  directTransfers: [],
  walletObservations: [],
};

export const wallets = {
  loading: walletPanelOpened,
  signedOut: { ...walletPanelOpened, loading: false, signedOut: true },
  loaded: { ...walletPanelOpened, loading: false, account },
  busy: { ...walletPanelOpened, loading: false, account, busy: "evm" },
  change: { ...walletPanelOpened, loading: false, account, change: { family: "evm", saved: evmAddress, address: "0x00000000219ab540356cbb839cbe05303d7705fa" } },
  failed: { ...walletPanelOpened, loading: false, account, loadError: "Payments could not load. Retry." },
  empty: { ...walletPanelOpened, loading: false, account: { ...account, wallets: [], balances: [] } },
} as const satisfies Record<string, WalletPanel>;

export const offers: ReadonlyArray<WalletOffer> = [
  { id: 1, name: "Rabby", icon: undefined, family: "evm", solanaFunding: false, solanaBinding: false },
  { id: 2, name: "Phantom", icon: undefined, family: "solana", solanaFunding: true, solanaBinding: true },
];

const verifiedValue = { enabled: true, securityEnabled: false, enrollmentAvailable: true, pending: null, availability: "verified", email: "octocat@example.com", destinationVersion: "a".repeat(64) } as const;

const panel = (state: EmailPanel["state"]): EmailPanel => ({ state, checking: false, busy: false, editing: false, problem: undefined });

export const email = {
  verified: panel({ status: "ready", actor: "583231", value: verifiedValue }),
  unverified: panel({ status: "ready", actor: "583231", value: { enabled: false, securityEnabled: false, enrollmentAvailable: true, pending: null, availability: "unverified" } }),
  pending: panel({ status: "ready", actor: "583231", value: { ...verifiedValue, enabled: false, pending: { email: "new@example.com", expiresAt: "2026-11-18T09:00:00.000Z", state: "sent" } } }),
  unavailable: panel({ status: "ready", actor: "583231", value: { enabled: false, securityEnabled: false, enrollmentAvailable: false, pending: null, availability: "unavailable" } }),
  loading: { ...panel({ status: "loading" }), checking: true },
  failed: panel({ status: "failed", message: "Email preferences are unavailable." }),
  signedOut: panel({ status: "signedOut" }),
  changed: { ...panel({ status: "ready", actor: "583231", value: verifiedValue }), problem: "Your verified destination changed. Review it before turning on email." },
} as const satisfies Record<string, EmailPanel>;

export const attempts = {
  idle: { waiting: false, message: "", closedAccount: false },
  waiting: { waiting: true, message: "", closedAccount: false },
  closed: { waiting: false, message: "You closed this account. Reopen it to sign in.", closedAccount: true },
  blocked: { waiting: false, message: "Your browser did not open the GitHub sign-in window. Allow pop-ups for this site, or open it in another browser, and try again.", closedAccount: false },
} as const satisfies Record<string, SignInState>;

export const signInHref = "/login?next=%2Faccount%23wallets";
