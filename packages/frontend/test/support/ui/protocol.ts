// spec/frontend/navigation.md, "Story: Resume an authorized destination after signing in"; spec/frontend/projections.md, "Interface capability requirements survive responsive and accessibility modes"

export type Role =
  | "alert"
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

export type Op =
  | { readonly kind: "start" }
  | { readonly kind: "user"; readonly id: number; readonly login: string }
  | { readonly kind: "github"; readonly login: string }
  | { readonly kind: "open"; readonly path: string; readonly tab?: string }
  | { readonly kind: "tab"; readonly tab: string }
  | { readonly kind: "where" }
  | { readonly kind: "click"; readonly target: Target }
  | { readonly kind: "fill"; readonly target: Target; readonly value: string }
  | { readonly kind: "press"; readonly keys: string }
  | { readonly kind: "read"; readonly target: Target }
  | { readonly kind: "focused" }
  | { readonly kind: "refocus" }
  | { readonly kind: "fetch"; readonly method: "GET" | "POST"; readonly path: string; readonly body?: unknown }
  | { readonly kind: "leaks"; readonly text: string }
  | { readonly kind: "hold"; readonly method: string; readonly path: string }
  | { readonly kind: "release"; readonly method: string; readonly path: string }
  | { readonly kind: "sent" }
  | { readonly kind: "verifications" }
  | { readonly kind: "sql"; readonly text: string; readonly params: ReadonlyArray<string | number | null> }
  | { readonly kind: "popups" }
  | { readonly kind: "view"; readonly width: number; readonly height: number; readonly reducedMotion: boolean }
  | { readonly kind: "enlarge"; readonly target: Target }
  | { readonly kind: "restore" }
  | { readonly kind: "layout" }
  | { readonly kind: "allow"; readonly patterns: ReadonlyArray<string> }
  | { readonly kind: "diagnostics" }
  | { readonly kind: "wallets"; readonly setup: WalletSetup }
  | { readonly kind: "walletAccount"; readonly index: number }
  | { readonly kind: "walletReject" }
  | { readonly kind: "walletAsked" }
  | { readonly kind: "walletAddresses" };

export interface Results {
  readonly start: null;
  readonly user: null;
  readonly github: null;
  readonly open: Loaded;
  readonly tab: null;
  readonly where: string;
  readonly click: null;
  readonly fill: null;
  readonly press: null;
  readonly read: Shown;
  readonly focused: Focused;
  readonly refocus: null;
  readonly fetch: Answered;
  readonly leaks: boolean;
  readonly hold: null;
  readonly release: null;
  readonly sent: ReadonlyArray<Sent>;
  readonly verifications: ReadonlyArray<Verification>;
  readonly sql: ReadonlyArray<Row>;
  readonly popups: number;
  readonly view: null;
  readonly enlarge: null;
  readonly restore: null;
  readonly layout: Layout;
  readonly allow: null;
  readonly diagnostics: Diagnostics;
  readonly wallets: null;
  readonly walletAccount: null;
  readonly walletReject: null;
  readonly walletAsked: ReadonlyArray<WalletAsked>;
  readonly walletAddresses: Addresses;
}

export type Result<O extends Op> = Results[O["kind"]];

declare module "vitest/browser" {
  interface BrowserCommands {
    site: <O extends Op>(op: O) => Promise<Result<O>>;
  }
}
