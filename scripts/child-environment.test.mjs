import { describe, expect, it } from "vitest";
import { childEnvironment } from "./child-environment.mjs";

describe("childEnvironment", () => {
  it("passes only operational variables and explicit safe overrides", () => {
    const result = childEnvironment(
      {
        PATH: "/usr/bin",
        HOME: "/tmp/home",
        GITHUB_TOKEN: "github-secret",
        GH_TOKEN: "gh-secret",
        CLOUDFLARE_API_TOKEN: "cloudflare-secret",
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        OPENAI_API_KEY: "openai-secret",
        NPM_TOKEN: "npm-secret",
        SLOP_PYTHON: "/opt/python/bin/python3",
      },
      { SLOP_E2E_SERVER: "preview" },
    );

    expect(result).toEqual({
      HOME: "/tmp/home",
      PATH: "/usr/bin",
      SLOP_PYTHON: "/opt/python/bin/python3",
      SLOP_E2E_SERVER: "preview",
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("rejects non-string overrides", () => {
    expect(() => childEnvironment({}, { SLOP_E2E_SERVER: undefined })).toThrow(
      "must be a string",
    );
  });

  it("does not pass conflicting color controls", () => {
    expect(childEnvironment({ NO_COLOR: "1", FORCE_COLOR: "1" })).toEqual({
      FORCE_COLOR: "0",
    });
  });
});
