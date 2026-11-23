// spec/operations/release.md, "Workers publish before the static site, each only when its own release variable is enabled"
import type { Bindings } from "@repo/platform/testing";
import { githubFake } from "@repo/platform/testing/github";
import { repoRoot } from "@repo/platform/testing/paths";

export type OldEntry =
  | "pages"
  | "worker:slop-identity"
  | "worker:slop-notify"
  | "worker:vetting-sandbox"
  | "worker:attester (PaymentSignerJournal)"
  | "worker:operator-keeper (Durable Object)"
  | "worker:operator-keeper"
  | "worker:fee-converter"
  | "worker:referral-accrual"
  | "worker:slopbot"
  | "worker:slopbot and worker:slopbot-repository-access";

export interface WorkerSuccessor {
  readonly kind: "worker";
  readonly root: string;
  readonly entry: string;
  readonly origin: string;
  readonly bindings: Omit<Bindings, "services">;
  readonly services: ReadonlyArray<string>;
  readonly assets: boolean;
}

export interface AssertedElsewhere {
  readonly kind: "elsewhere";
  readonly journey: string;
  readonly reason: string;
}

export type Successor = WorkerSuccessor | AssertedElsewhere;

const app = githubFake().app;

const roles = { ADMIN_GITHUB_IDS: "18633264,202660855", PROJECT_MODERATOR_GITHUB_IDS: "18633264,202660855" };

function apps(name: string): string {
  return `${repoRoot}/apps/${name}`;
}

const slopbotApp = { SLOPBOT_APP_ID: app.id, SLOPBOT_APP_PRIVATE_KEY: app.privateKeyPem };

export const successors: Readonly<Record<OldEntry, Successor>> = {
  pages: {
    kind: "worker",
    root: apps("app"),
    entry: "_worker",
    origin: "https://slop.cash",
    bindings: {
      d1: { SLOP_DB: "slop-private" },
      r2: ["PRIVATE_TRACES", "VETTING_EVIDENCE"],
      vars: { ...roles, SLOP_ENVIRONMENT: "production", PUBLIC_SITE_URL: "https://slop.cash", PAYMENT_NETWORKS: "[]", TRACE_AUTH_SECRET: "parity-trace-secret-of-at-least-forty-characters" },
    },
    services: ["SLOP_IDENTITY", "SLOP_NOTIFY", "SLOPBOT", "VETTING_SANDBOX"],
    assets: true,
  },
  "worker:slop-identity": {
    kind: "worker",
    root: apps("backend"),
    entry: "identity",
    origin: "https://identity.slop.cash",
    bindings: {
      d1: { IDENTITY_DB: "slop-private" },
      ratelimits: { IDENTITY_START_LIMITER: { limit: 60, period: 60 }, IDENTITY_POLL_LIMITER: { limit: 600, period: 60 } },
      vars: {
        SLOP_ENVIRONMENT: "production",
        IDENTITY_PUBLIC_ORIGIN: "https://identity.slop.cash",
        GITHUB_APP_CLIENT_ID: "Iv1.parity",
        GITHUB_APP_CLIENT_SECRET: "parity-client-secret",
        IDENTITY_STATE_KEY: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE",
        IDENTITY_ASSERTION_KEY: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
      },
    },
    services: ["SLOP_NOTIFY"],
    assets: false,
  },
  "worker:slop-notify": {
    kind: "worker",
    root: apps("app"),
    entry: "notify",
    origin: "https://notify.internal",
    bindings: { d1: { SLOP_DB: "slop-private" }, email: { ADMIN_EMAIL: true }, vars: { SLOP_ENVIRONMENT: "production" } },
    services: [],
    assets: false,
  },
  "worker:vetting-sandbox": {
    kind: "worker",
    root: apps("security"),
    entry: "sandbox",
    origin: "https://vetting-sandbox.internal",
    bindings: {},
    services: [],
    assets: false,
  },
  "worker:attester (PaymentSignerJournal)": {
    kind: "worker",
    root: apps("settlement"),
    entry: "attester",
    origin: "https://attester.internal",
    bindings: { vars: { SLOP_ENVIRONMENT: "production" } },
    services: [],
    assets: false,
  },
  "worker:operator-keeper (Durable Object)": {
    kind: "elsewhere",
    journey: "apps/settlement/test/settlement-keeper.test.vibe, \"The operator Worker answers only the internal tick\"",
    reason: "The tick is answered by the OperatorKeeper object, which only its own Worker reaches; the keeper journey sends it through the object namespace.",
  },
  "worker:operator-keeper": {
    kind: "worker",
    root: apps("settlement"),
    entry: "keeper",
    origin: "https://keeper.internal",
    bindings: { vars: { KEEPER_MODE: "off" }, durableObjects: { KEEPER: "OperatorKeeper" } },
    services: [],
    assets: false,
  },
  "worker:fee-converter": {
    kind: "worker",
    root: apps("fees"),
    entry: "feeConverter",
    origin: "https://fee-converter.internal",
    bindings: {},
    services: [],
    assets: false,
  },
  "worker:referral-accrual": {
    kind: "worker",
    root: apps("settlement"),
    entry: "referralAccrual",
    origin: "https://referral-accrual.internal",
    bindings: { d1: { REFERRAL_DB: "referral-worker" }, vars: { ...roles, REFERRAL_ACCRUAL_MODE: "Off" } },
    services: [],
    assets: false,
  },
  "worker:slopbot": {
    kind: "worker",
    root: apps("slopbot"),
    entry: "slopbot",
    origin: "https://slopbot.internal",
    bindings: {
      d1: { SLOPBOT_DB: "slop-private" },
      queues: { producers: { SLOPBOT_QUEUE: "slopbot-jobs" } },
      vars: { ...roles, ...slopbotApp, SLOPBOT_WEBHOOK_SECRET: "parity-webhook-secret" },
    },
    services: ["SLOP_NOTIFY", "VALUE_MERGE_VERIFIER"],
    assets: false,
  },
  "worker:slopbot and worker:slopbot-repository-access": {
    kind: "worker",
    root: apps("slopbot"),
    entry: "repositoryAccess",
    origin: "https://slopbot-repository-access.internal",
    bindings: { d1: { SLOPBOT_DB: "slop-private" }, vars: slopbotApp },
    services: [],
    assets: false,
  },
};
