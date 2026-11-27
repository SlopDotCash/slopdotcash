// spec/frontend/navigation.md, "Story: Resume an authorized destination after signing in"; spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"; spec/points/projectionTransport.md, "Story: Read the published projection without mistaking a reset for a refusal"
import type { RepositoryRegistry } from "@repo/points/client";

export type Role =
  | "alert"
  | "alertdialog"
  | "article"
  | "button"
  | "checkbox"
  | "dialog"
  | "form"
  | "group"
  | "heading"
  | "img"
  | "link"
  | "main"
  | "menuitem"
  | "navigation"
  | "region"
  | "status"
  | "switch"
  | "textbox";

export interface Target {
  readonly role?: Role;
  readonly name?: string;
  readonly exact?: boolean;
  readonly label?: string;
  readonly text?: string;
  readonly level?: number;
  readonly within?: Target;
}

export interface Upload {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: ReadonlyArray<number>;
}

export interface Shown {
  readonly count: number;
  readonly visible: boolean;
  readonly text: string;
  readonly value: string | null;
  readonly disabled: boolean;
  readonly checked: boolean | null;
  readonly focused: boolean;
  readonly href: string | null;
}

export interface Focused {
  readonly tag: string;
  readonly name: string;
}

export interface Loaded {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
}

export interface Answered {
  readonly status: number;
  readonly body: unknown;
}

export interface Layout {
  readonly mains: number;
  readonly headings: number;
  readonly unnamed: ReadonlyArray<string>;
  readonly overflowX: boolean;
  readonly clipped: ReadonlyArray<string>;
}

export interface Diagnostics {
  readonly console: ReadonlyArray<string>;
  readonly failed: ReadonlyArray<string>;
}

export interface Sent {
  readonly method: string;
  readonly path: string;
  readonly actor: string | null;
}

export interface Verification {
  readonly githubId: string;
  readonly id: string;
  readonly token: string;
}

export interface WalletSetup {
  readonly evm?: { readonly name: string };
  readonly solana?: { readonly name: string };
}

export interface WalletAsked {
  readonly family: "evm" | "solana";
  readonly method: string;
}

export interface Addresses {
  readonly evm: string | null;
  readonly solana: string | null;
}

export type Row = Readonly<Record<string, unknown>>;

export type Method = "GET" | "POST" | "PUT";

export type Permission = "admin" | "maintain" | "write" | "triage" | "read" | "none";

export type Bucket = "VETTING_EVIDENCE" | "PRIVATE_TRACES";

export interface Roles {
  readonly ADMIN_GITHUB_IDS: string;
  readonly PROJECT_MODERATOR_GITHUB_IDS: string;
  readonly OPERATOR_GITHUB_IDS: string;
}

export interface RepositorySetup {
  readonly id: number;
  readonly owner: string;
  readonly name: string;
  readonly fork: boolean;
  readonly archived: boolean;
  readonly license: string;
  readonly files: Readonly<Record<string, string>>;
}

export interface InstallationSetup {
  readonly id: number;
  readonly account: string;
  readonly repositories: ReadonlyArray<string>;
}

export interface Downloaded {
  readonly name: string;
  readonly sha256: string;
}

export interface Deployed {
  readonly vault: string;
  readonly asset: string;
}

export type VaultPurpose = "ordinary" | "security-bounty";

export type LeaderboardTransport = "whole" | "parts";

export interface PublishedActor {
  readonly id: string;
  readonly login: string;
  readonly avatarUrl: string;
}

export interface Published {
  readonly registry: RepositoryRegistry;
  readonly leaders: ReadonlyArray<PublishedActor>;
  readonly parts: ReadonlyArray<string>;
}

export interface Box {
  readonly top: number;
  readonly bottom: number;
}

export type Op =
  | { readonly kind: "start" }
  | { readonly kind: "user"; readonly id: number; readonly login: string }
  | { readonly kind: "deploy"; readonly roles: Roles }
  | { readonly kind: "repository"; readonly setup: RepositorySetup }
  | { readonly kind: "permission"; readonly repository: string; readonly login: string; readonly level: Permission }
  | { readonly kind: "installation"; readonly setup: InstallationSetup }
  | { readonly kind: "githubFail"; readonly path: string; readonly status: number }
  | { readonly kind: "scanner"; readonly method: Method; readonly path: string; readonly body: string }
  | { readonly kind: "object"; readonly bucket: Bucket; readonly key: string; readonly text: string }
  | { readonly kind: "vault"; readonly projectId: string; readonly purpose: VaultPurpose }
  | { readonly kind: "backendRpc" }
  | { readonly kind: "finalize"; readonly chainId: number }
  | { readonly kind: "branch"; readonly repository: string; readonly name: string; readonly files: Readonly<Record<string, string | null>> }
  | { readonly kind: "github"; readonly login: string }
  | { readonly kind: "open"; readonly path: string; readonly tab?: string }
  | { readonly kind: "tab"; readonly tab: string }
  | { readonly kind: "where" }
  | { readonly kind: "click"; readonly target: Target }
  | { readonly kind: "fill"; readonly target: Target; readonly value: string }
  | { readonly kind: "select"; readonly target: Target; readonly label: string }
  | { readonly kind: "press"; readonly keys: string }
  | { readonly kind: "read"; readonly target: Target }
  | { readonly kind: "focused" }
  | { readonly kind: "refocus" }
  | { readonly kind: "blockCookies" }
  | { readonly kind: "upload"; readonly target: Target; readonly file: Upload }
  | { readonly kind: "fetch"; readonly method: Method; readonly path: string; readonly body?: unknown }
  | { readonly kind: "download" }
  | { readonly kind: "leaks"; readonly text: string }
  | { readonly kind: "hold"; readonly method: string; readonly path: string }
  | { readonly kind: "release"; readonly method: string; readonly path: string }
  | { readonly kind: "fail"; readonly method: string; readonly path: string; readonly status: number; readonly body: unknown }
  | { readonly kind: "unfail"; readonly method: string; readonly path: string }
  | { readonly kind: "serve"; readonly path: string; readonly status: number; readonly body: unknown; readonly bytes?: string; readonly contentType?: string }
  | { readonly kind: "published"; readonly leaderboard: LeaderboardTransport }
  | { readonly kind: "unserve"; readonly path: string }
  | { readonly kind: "clock"; readonly iso: string }
  | { readonly kind: "sent" }
  | { readonly kind: "verifications" }
  | { readonly kind: "sql"; readonly text: string; readonly params: ReadonlyArray<string | number | null> }
  | { readonly kind: "popups" }
  | { readonly kind: "view"; readonly width: number; readonly height: number; readonly reducedMotion: boolean }
  | { readonly kind: "enlarge"; readonly target: Target }
  | { readonly kind: "restore" }
  | { readonly kind: "layout" }
  | { readonly kind: "box"; readonly target: Target }
  | { readonly kind: "scrollY" }
  | { readonly kind: "wheel"; readonly dx: number; readonly dy: number }
  | { readonly kind: "scrollEnd" }
  | { readonly kind: "reveal"; readonly target: Target }
  | { readonly kind: "back" }
  | { readonly kind: "forward" }
  | { readonly kind: "stamp"; readonly value: string }
  | { readonly kind: "stamped" }
  | { readonly kind: "allow"; readonly patterns: ReadonlyArray<string> }
  | { readonly kind: "diagnostics" }
  | { readonly kind: "wallets"; readonly setup: WalletSetup }
  | { readonly kind: "walletAccount"; readonly index: number }
  | { readonly kind: "walletReject" }
  | { readonly kind: "walletFail"; readonly method: string }
  | { readonly kind: "walletAsked" }
  | { readonly kind: "walletAddresses" };

export interface Results {
  readonly start: null;
  readonly user: null;
  readonly deploy: null;
  readonly repository: null;
  readonly permission: null;
  readonly installation: null;
  readonly githubFail: null;
  readonly scanner: Answered;
  readonly object: null;
  readonly vault: Deployed;
  readonly backendRpc: null;
  readonly finalize: number;
  readonly branch: string;
  readonly github: null;
  readonly open: Loaded;
  readonly tab: null;
  readonly where: string;
  readonly click: null;
  readonly fill: null;
  readonly select: null;
  readonly press: null;
  readonly read: Shown;
  readonly focused: Focused;
  readonly refocus: null;
  readonly blockCookies: null;
  readonly upload: null;
  readonly fetch: Answered;
  readonly download: Downloaded | null;
  readonly leaks: boolean;
  readonly hold: null;
  readonly release: null;
  readonly fail: null;
  readonly unfail: null;
  readonly serve: null;
  readonly published: Published;
  readonly unserve: null;
  readonly clock: null;
  readonly sent: ReadonlyArray<Sent>;
  readonly verifications: ReadonlyArray<Verification>;
  readonly sql: ReadonlyArray<Row>;
  readonly popups: number;
  readonly view: null;
  readonly enlarge: null;
  readonly restore: null;
  readonly layout: Layout;
  readonly box: Box | null;
  readonly scrollY: number;
  readonly wheel: null;
  readonly scrollEnd: number;
  readonly reveal: null;
  readonly back: null;
  readonly forward: null;
  readonly stamp: null;
  readonly stamped: string | null;
  readonly allow: null;
  readonly diagnostics: Diagnostics;
  readonly wallets: null;
  readonly walletAccount: null;
  readonly walletReject: null;
  readonly walletFail: null;
  readonly walletAsked: ReadonlyArray<WalletAsked>;
  readonly walletAddresses: Addresses;
}

export type Result<O extends Op> = Results[O["kind"]];

declare module "vitest/browser" {
  interface BrowserCommands {
    site: <O extends Op>(op: O) => Promise<Result<O>>;
  }
}
