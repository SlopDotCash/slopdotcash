// spec/contributor/workflow.md, "Submission requires exact attribution and a fresh pre-submission read"
import { Schema } from "effect";

export const UNAVAILABLE_MODEL_IDENTIFIER = "unavailable";

const COMMON_PLACEHOLDERS: ReadonlyArray<string> = ["na", "none", "null", "other", "placeholder", "tbd", "todo", "unknown", "unspecified"];

const normalized = (value: string) => value.toLowerCase().replaceAll(/[^a-z0-9]/g, "");

const exactIdentity = (maximumLength: number, placeholders: ReadonlyArray<string>) =>
  Schema.String.check(
    Schema.isBetweenLength(1, maximumLength),
    Schema.isPattern(/^[@~]?[A-Za-z0-9](?:[A-Za-z0-9._:@/+~-]{0,126}[A-Za-z0-9])?$/),
    Schema.makeFilter(
      (value: string) => !COMMON_PLACEHOLDERS.includes(normalized(value)) && !placeholders.includes(normalized(value)),
      { expected: "an exact identifier, not a placeholder" },
    ),
  );

export const ProviderIdentifier = exactIdentity(64, ["ai", "model", "provider"]);

export const ModelIdentifier = exactIdentity(128, ["ai", "claude", "gemini", "gpt", "grok", "llama", "llm", "model", UNAVAILABLE_MODEL_IDENTIFIER]);

export const ClientIdentifier = exactIdentity(64, ["agent", "app", "cli", "client"]);

export const ClientVersion = exactIdentity(128, ["current", "latest", "version"]);

export const isExactProviderIdentifier = Schema.is(ProviderIdentifier);

export const isExactModelIdentifier = Schema.is(ModelIdentifier);

export const isExactClientIdentifier = Schema.is(ClientIdentifier);

export const isExactClientVersion = Schema.is(ClientVersion);

export function isUnavailableModelIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.toLowerCase() === UNAVAILABLE_MODEL_IDENTIFIER;
}

export function isDeclaredModelIdentifier(value: unknown): value is string {
  return isExactModelIdentifier(value) || isUnavailableModelIdentifier(value);
}

export function isExactProviderModelIdentifier(value: unknown): value is string {
  if (typeof value !== "string") return false;
  for (let index = value.indexOf("/"); index >= 0; index = value.indexOf("/", index + 1)) {
    if (isExactProviderIdentifier(value.slice(0, index)) && isExactModelIdentifier(value.slice(index + 1))) return true;
  }
  return false;
}
