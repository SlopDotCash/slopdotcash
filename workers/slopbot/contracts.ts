// Slopbot v2 contracts (draft, docs/slopbot-v2-proposal.md). Everything a model
// returns is untrusted until it passes validateVerdict; everything a repository
// publishes is untrusted until it passes parseRepositoryConfig.

export const CATEGORIES = [
  "none",
  "spam",
  "scam",
  "empty",
  "duplicate",
  "out_of_scope",
  "busywork",
  "missing_evidence",
  "gaming",
  "low_quality",
] as const;
export type Category = (typeof CATEGORIES)[number];

// Universal categories may close without repository guidance (PRD BOT-06).
export const UNIVERSAL_CATEGORIES: ReadonlySet<Category> = new Set([
  "spam",
  "scam",
  "empty",
  "duplicate",
]);
// These categories never close, whatever the repository configures.
export const NEVER_CLOSE: ReadonlySet<Category> = new Set([
  "none",
  "missing_evidence",
  "low_quality",
]);

export type CategoryMode = "off" | "label" | "close";
export type Audience = "protection" | "participants";

export type RepositoryConfig = {
  version: 1;
  audience: Audience;
  issues: boolean;
  pullRequests: boolean;
  closure: boolean;
  reviewExempt: boolean;
  dailyCloseCap: number;
  categories: Record<Exclude<Category, "none">, CategoryMode>;
};

export const CONFIG_PATH = ".github/slopbot.json";

const DEFAULT_CATEGORIES: RepositoryConfig["categories"] = {
  spam: "close",
  scam: "close",
  empty: "close",
  duplicate: "close",
  out_of_scope: "label",
  busywork: "label",
  missing_evidence: "label",
  gaming: "label",
  low_quality: "label",
};

// A missing or invalid file fails closed to label-only review (BOT-08).
export function labelOnlyConfig(): RepositoryConfig {
  const categories = { ...DEFAULT_CATEGORIES };
  for (const key of Object.keys(categories) as (keyof typeof categories)[]) {
    categories[key] = "label";
  }
  return {
    version: 1,
    audience: "protection",
    issues: true,
    pullRequests: true,
    closure: false,
    reviewExempt: false,
    dailyCloseCap: 25,
    categories,
  };
}

export type ConfigResult =
  | { ok: true; config: RepositoryConfig }
  | { ok: false; config: RepositoryConfig; problem: string };

export function parseRepositoryConfig(text: string | null): ConfigResult {
  if (text === null) {
    return {
      ok: false,
      config: labelOnlyConfig(),
      problem: `${CONFIG_PATH} is missing`,
    };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      config: labelOnlyConfig(),
      problem: `${CONFIG_PATH} is not valid JSON`,
    };
  }
  const problem = configProblem(raw);
  if (problem !== null)
    return { ok: false, config: labelOnlyConfig(), problem };
  const value = raw as Record<string, unknown>;
  const categories = { ...DEFAULT_CATEGORIES };
  const overrides = (value.categories ?? {}) as Record<string, CategoryMode>;
  for (const [key, mode] of Object.entries(overrides)) {
    categories[key as keyof typeof categories] = mode;
  }
  return {
    ok: true,
    config: {
      version: 1,
      audience: value.audience as Audience,
      issues: (value.issues as boolean | undefined) ?? true,
      pullRequests: (value.pullRequests as boolean | undefined) ?? true,
      closure: (value.closure as boolean | undefined) ?? false,
      reviewExempt: (value.reviewExempt as boolean | undefined) ?? false,
      dailyCloseCap: (value.dailyCloseCap as number | undefined) ?? 25,
      categories,
    },
  };
}

const CONFIG_KEYS = new Set([
  "version",
  "audience",
  "issues",
  "pullRequests",
  "closure",
  "reviewExempt",
  "dailyCloseCap",
  "categories",
]);

function configProblem(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    return "config must be an object";
  const value = raw as Record<string, unknown>;
  for (const key of Object.keys(value)) {
    if (!CONFIG_KEYS.has(key)) return `unknown config key ${key}`;
  }
  if (value.version !== 1) return "version must be 1";
  if (value.audience !== "protection" && value.audience !== "participants") {
    return "audience must be protection or participants";
  }
  for (const key of ["issues", "pullRequests", "closure", "reviewExempt"]) {
    if (value[key] !== undefined && typeof value[key] !== "boolean")
      return `${key} must be boolean`;
  }
  const cap = value.dailyCloseCap;
  if (
    cap !== undefined &&
    !(Number.isInteger(cap) && (cap as number) >= 0 && (cap as number) <= 200)
  ) {
    return "dailyCloseCap must be an integer from 0 to 200";
  }
  if (value.categories !== undefined) {
    const categories = value.categories;
    if (
      typeof categories !== "object" ||
      categories === null ||
      Array.isArray(categories)
    ) {
      return "categories must be an object";
    }
    for (const [key, mode] of Object.entries(categories)) {
      if (!(key in DEFAULT_CATEGORIES)) return `unknown category ${key}`;
      if (mode !== "off" && mode !== "label" && mode !== "close")
        return `category ${key} must be off, label or close`;
      if (mode === "close" && NEVER_CLOSE.has(key as Category))
        return `category ${key} cannot close`;
    }
  }
  return null;
}

// --- Model verdict --------------------------------------------------------

export type RuleRef = { source: string; quote: string };
export type Verdict = {
  category: Category;
  confidence: number;
  rule_refs: RuleRef[];
  evidence: string[];
  summary: string;
  limitations: string[];
};

// JSON Schema shared by every provider's structured-output mode.
export const VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "category",
    "confidence",
    "rule_refs",
    "evidence",
    "summary",
    "limitations",
  ],
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    confidence: { type: "number" },
    rule_refs: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["source", "quote"],
        properties: { source: { type: "string" }, quote: { type: "string" } },
      },
    },
    evidence: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
    limitations: { type: "array", items: { type: "string" } },
  },
} as const;

export function validateVerdict(raw: unknown): Verdict | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (!CATEGORIES.includes(value.category as Category)) return null;
  const confidence = value.confidence;
  if (typeof confidence !== "number" || !(confidence >= 0 && confidence <= 1))
    return null;
  if (
    !Array.isArray(value.rule_refs) ||
    !Array.isArray(value.evidence) ||
    !Array.isArray(value.limitations)
  ) {
    return null;
  }
  const ruleRefs: RuleRef[] = [];
  for (const ref of value.rule_refs) {
    if (typeof ref !== "object" || ref === null) return null;
    const { source, quote } = ref as Record<string, unknown>;
    if (typeof source !== "string" || typeof quote !== "string") return null;
    ruleRefs.push({ source, quote });
  }
  if (!value.evidence.every((item) => typeof item === "string")) return null;
  if (!value.limitations.every((item) => typeof item === "string")) return null;
  if (typeof value.summary !== "string" || value.summary.length === 0)
    return null;
  return {
    category: value.category as Category,
    confidence,
    rule_refs: ruleRefs,
    evidence: value.evidence as string[],
    summary: value.summary.slice(0, 1200),
    limitations: value.limitations as string[],
  };
}

// --- Pricing (BOT-07, BOT-10) ------------------------------------------------

// Rates are integer micro-USD per million tokens. A rate change needs a new
// version that takes effect at a future UTC month boundary.
export const PRICE_VERSION = "2026-10-09";

type Rate = {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
};
type PriceEntry = Rate & { reconciliation: "list-price" | "estimated" };

export const PRICES: Record<string, PriceEntry> = {
  // Best listed Surplus offer on 9 October 2026. Actual offers vary, so the
  // row stays "estimated" until reconciled against Surplus spend. Surplus
  // publishes no cache prices; input price is charged for cache tokens.
  "surplus/claude-opus-5.5": {
    input: 600_000,
    cacheWrite: 600_000,
    cacheRead: 600_000,
    output: 3_000_000,
    reconciliation: "estimated",
  },
  // OpenAI price per secondary sources on 9 October 2026 (OpenAI's page was
  // not reachable); reconcile against the OpenAI invoice.
  "openai/gpt-6.1-sol": {
    input: 2_000_000,
    cacheWrite: 2_000_000,
    cacheRead: 100_000,
    output: 10_000_000,
    reconciliation: "estimated",
  },
};

export type Usage = {
  input: number;
  cacheWrite: number;
  cacheRead: number;
  output: number;
};

export function priceUsage(key: string, usage: Usage) {
  const entry = PRICES[key];
  if (entry === undefined) return null;
  const micro =
    usage.input * entry.input +
    usage.cacheWrite * entry.cacheWrite +
    usage.cacheRead * entry.cacheRead +
    usage.output * entry.output;
  const costMicroUsd = Math.ceil(micro / 1_000_000);
  return {
    costMicroUsd,
    billedMicroUsdc: Math.ceil((costMicroUsd * 11) / 10),
    reconciliation: entry.reconciliation,
  };
}

export const SHADOW_DAYS = 14;
export const SHADOW_MIN_REVIEWS = 50;
export const AUTHOR_DAILY_CAP = 3;
export const CLOSE_CONFIDENCE = 0.9;
export const REOPEN_BREAKER_RATIO = 0.1;
// SCR-01: closures before the v2 effective time never create a penalty. The
// amounts (-10 points, -3 score-thirds) are fixed in migrations/0014.
export const PENALTY_EFFECTIVE_AT = "2026-11-01T00:00:00.000Z";

// The queue carries identifiers only; the consumer re-reads GitHub state.
export type Job =
  | {
      kind: "review";
      deliveryId: string;
      installationId: number;
      repositoryId: number;
      owner: string;
      repo: string;
      itemKind: "issue" | "pull_request";
      number: number;
    }
  | {
      kind: "appeal" | "human_reopen";
      deliveryId: string;
      installationId: number;
      repositoryId: number;
      owner: string;
      repo: string;
      itemKind: "issue" | "pull_request";
      number: number;
      senderId: number;
    };
