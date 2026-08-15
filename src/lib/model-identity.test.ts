import { describe, expect, it } from "vitest";
import {
  assertExactModelIdentity,
  isExactClientIdentifier,
  isExactClientVersion,
  isExactModelIdentifier,
  isExactProviderIdentifier,
} from "./model-identity";

describe("exact model identity", () => {
  it("accepts arbitrary concrete identifiers including slash and plus", () => {
    expect(isExactProviderIdentifier("x-ai/hosted+edge")).toBe(true);
    expect(isExactModelIdentifier("accounts/x/models/grok-4.5+reasoning")).toBe(
      true,
    );
    expect(isExactClientIdentifier("kimi-cli+acp")).toBe(true);
    expect(isExactClientVersion("v1.2.3+build.7")).toBe(true);
    expect(() =>
      assertExactModelIdentity({
        provider: "moonshot-ai",
        model: "kimi-k2.5+thinking",
        client: "kimi-cli",
      }),
    ).not.toThrow();
  });

  it.each([
    ["provider", isExactProviderIdentifier],
    ["model", isExactModelIdentifier],
    ["client", isExactClientIdentifier],
    ["N/A", isExactModelIdentifier],
    ["unknown", isExactClientIdentifier],
    ["latest", isExactClientVersion],
    ["<exact-model>", isExactModelIdentifier],
  ])("rejects placeholder %s", (value, validator) => {
    expect(validator(value)).toBe(false);
  });
});
