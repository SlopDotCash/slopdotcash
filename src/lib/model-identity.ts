/** Field-specific validation for exact, self-reported model-run identity. */

const IDENTITY_PATTERN =
  /^[@~]?[A-Za-z0-9](?:[A-Za-z0-9._:@/+~-]{0,126}[A-Za-z0-9])?$/u;

const COMMON_PLACEHOLDERS = new Set([
  "na",
  "none",
  "null",
  "other",
  "placeholder",
  "tbd",
  "todo",
  "unknown",
  "unspecified",
]);
const PROVIDER_PLACEHOLDERS = new Set(["ai", "model", "provider"]);
const MODEL_PLACEHOLDERS = new Set([
  "ai",
  "claude",
  "gemini",
  "gpt",
  "grok",
  "llama",
  "llm",
  "model",
]);
const CLIENT_PLACEHOLDERS = new Set(["agent", "app", "cli", "client"]);
const VERSION_PLACEHOLDERS = new Set(["current", "latest", "version"]);

function normalizedPlaceholder(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

function exactIdentity(
  value: unknown,
  maxLength: number,
  fieldPlaceholders: ReadonlySet<string>,
): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maxLength ||
    !IDENTITY_PATTERN.test(value)
  ) {
    return false;
  }
  const normalized = normalizedPlaceholder(value);
  return (
    !COMMON_PLACEHOLDERS.has(normalized) && !fieldPlaceholders.has(normalized)
  );
}

export function isExactProviderIdentifier(value: unknown): value is string {
  return exactIdentity(value, 64, PROVIDER_PLACEHOLDERS);
}

export function isExactModelIdentifier(value: unknown): value is string {
  return exactIdentity(value, 128, MODEL_PLACEHOLDERS);
}

export function isExactClientIdentifier(value: unknown): value is string {
  return exactIdentity(value, 64, CLIENT_PLACEHOLDERS);
}

export function isExactClientVersion(value: unknown): value is string {
  return exactIdentity(value, 128, VERSION_PLACEHOLDERS);
}

export function assertExactModelIdentity(input: {
  provider: unknown;
  model: unknown;
  client: unknown;
}): asserts input is { provider: string; model: string; client: string } {
  if (!isExactProviderIdentifier(input.provider)) {
    throw new TypeError("provider must be an exact non-placeholder identifier");
  }
  if (!isExactModelIdentifier(input.model)) {
    throw new TypeError("model must be an exact non-placeholder identifier");
  }
  if (!isExactClientIdentifier(input.client)) {
    throw new TypeError("client must be an exact non-placeholder identifier");
  }
}
