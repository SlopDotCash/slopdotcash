export type ModelIdentityField = "provider" | "model" | "client" | "version";

/** Shared conformance corpus for browser/server validators and packaged CLIs. */
export const MODEL_IDENTITY_CONFORMANCE_CASES: readonly {
  field: ModelIdentityField;
  value: string;
  valid: boolean;
}[] = [
  { field: "provider", value: "x-ai/hosted+edge", valid: true },
  { field: "provider", value: "@scope/provider~beta", valid: true },
  {
    field: "model",
    value: "accounts/x/models/grok-4.5+reasoning",
    valid: true,
  },
  { field: "model", value: "~vendor/model@2026", valid: true },
  { field: "client", value: "@openai/codex~desktop", valid: true },
  { field: "version", value: "v1.2.3+build.7", valid: true },
  { field: "provider", value: "provider", valid: false },
  { field: "model", value: "model", valid: false },
  { field: "client", value: "client", valid: false },
  { field: "version", value: "latest", valid: false },
  { field: "provider", value: "openai/", valid: false },
  { field: "model", value: "gpt-5+", valid: false },
  { field: "client", value: "codex~", valid: false },
  { field: "version", value: "1.2.3@", valid: false },
];
