import { describe, expect, test } from "bun:test";
import {
  normalizeWebsiteInput,
  normalizeXInput,
  projectChains,
  websiteLabel,
  withOwnerLinks,
  xHandle,
  xInputValue,
} from "../src/lib/project-links";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { PROJECTS, type ProjectDefinition } from "../src/lib/projects.mjs";

const fixture = PROJECTS[0] as ProjectDefinition;

/** The owner form's output must pass the registry schema unchanged. */
function acceptedBySchema(links: Record<string, string>): boolean {
  try {
    assertProjectDefinition(structuredClone({ ...fixture, links }));
    return true;
  } catch {
    return false;
  }
}

describe("X account input", () => {
  test("accepts a handle, @handle or profile link and stores the bare x.com URL", () => {
    for (const input of [
      "slopcash",
      "@slopcash",
      " @slopcash ",
      "https://x.com/slopcash",
      "https://x.com/slopcash/",
      "x.com/slopcash",
      "https://www.x.com/slopcash",
      "https://twitter.com/slopcash",
      "http://twitter.com/slopcash",
    ])
      expect(normalizeXInput(input)).toEqual({
        ok: true,
        value: "https://x.com/slopcash",
      });
    expect(normalizeXInput("")).toEqual({ ok: true, value: null });
    expect(normalizeXInput("   ")).toEqual({ ok: true, value: null });
  });

  test("refuses anything that is not one X profile", () => {
    for (const input of [
      "@",
      "@has space",
      "@sixteencharacter",
      "https://x.com/slopcash/status/1",
      "https://x.com/slopcash?s=20",
      "https://x.com/slopcash#top",
      "https://example.com/slopcash",
      "https://x.com.evil.example/slopcash",
      "https://user:pass@x.com/slopcash",
      "ftp://x.com/slopcash",
      "x.com",
    ])
      expect(normalizeXInput(input).ok).toBe(false);
  });

  test("every accepted value passes the registry schema", () => {
    const result = normalizeXInput("@Slop_Cash_1");
    if (!result.ok || !result.value) throw new Error("Expected a link");
    expect(
      acceptedBySchema(withOwnerLinks(fixture.links, null, result.value)),
    ).toBe(true);
    expect(
      acceptedBySchema(
        withOwnerLinks(fixture.links, null, "https://x.com/slopcash/status/1"),
      ),
    ).toBe(false);
    expect(xHandle(result.value)).toBe("Slop_Cash_1");
    expect(xInputValue(result.value)).toBe("@Slop_Cash_1");
  });
});

describe("website input", () => {
  test("keeps an https address and adds https to a bare domain", () => {
    expect(normalizeWebsiteInput("https://ntwrk.party")).toEqual({
      ok: true,
      value: "https://ntwrk.party",
    });
    expect(normalizeWebsiteInput(" example.org/docs?lang=en ")).toEqual({
      ok: true,
      value: "https://example.org/docs?lang=en",
    });
    expect(normalizeWebsiteInput("")).toEqual({ ok: true, value: null });
  });

  test("refuses other schemes, credentials, fragments and long addresses", () => {
    expect(normalizeWebsiteInput("http://example.org")).toEqual({
      ok: false,
      error: "Use an https:// address.",
    });
    for (const input of [
      "javascript:alert(1)",
      "https://user:pass@example.org",
      "https://example.org/#about",
      "https://localhost",
      `https://example.org/${"a".repeat(500)}`,
      "not a site",
    ])
      expect(normalizeWebsiteInput(input).ok).toBe(false);
  });

  test("every accepted value passes the registry schema", () => {
    const result = normalizeWebsiteInput("example.org/docs?lang=en");
    if (!result.ok || !result.value) throw new Error("Expected a link");
    expect(
      acceptedBySchema(withOwnerLinks(fixture.links, result.value, null)),
    ).toBe(true);
    expect(websiteLabel(result.value)).toBe("example.org/docs?lang=en");
    expect(websiteLabel("https://www.example.org/")).toBe("example.org");
  });
});

test("owner links replace only the website and X account", () => {
  const links = {
    repository: "https://github.com/acme/tool",
    issues: "https://github.com/acme/tool/issues",
    docs: "https://docs.acme.example",
    website: "https://old.example",
    x: "https://x.com/old",
  };
  expect(withOwnerLinks(links, "https://new.example", null)).toEqual({
    repository: links.repository,
    issues: links.issues,
    docs: links.docs,
    website: "https://new.example",
  });
  expect(withOwnerLinks(links, null, null)).toEqual({
    repository: links.repository,
    issues: links.issues,
    docs: links.docs,
  });
});

describe("project chains", () => {
  const deployment = (network: string, asset: string) =>
    ({ network, asset }) as never;

  test("names each recorded vault network once with its asset symbol", () => {
    const project = {
      ...fixture,
      escrow: {
        deployments: [
          deployment(
            "base-mainnet",
            "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          ),
        ],
      },
      securityBounty: {
        settlement: {
          deployments: [
            deployment(
              "base-mainnet",
              "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
            ),
          ],
        },
      },
    } as unknown as ProjectDefinition;
    expect(projectChains(project)).toEqual([{ name: "Base", symbol: "USDC" }]);
  });

  test("uses the project's own token symbol and omits an unknown one", () => {
    const token = "0x1111111111111111111111111111111111111111";
    const project = {
      ...fixture,
      rewardAsset: { network: "robinhood", address: token, symbol: "TOON" },
      escrow: {
        deployments: [
          deployment("robinhood-mainnet", token),
          deployment(
            "solana-mainnet",
            "So11111111111111111111111111111111111111112",
          ),
        ],
      },
    } as unknown as ProjectDefinition;
    expect(projectChains(project)).toEqual([
      { name: "Robinhood Chain", symbol: "TOON" },
      { name: "Solana", symbol: null },
    ]);
  });

  test("is empty without a recorded vault", () => {
    const { escrow: _escrow, securityBounty: _bounty, ...rest } = fixture;
    expect(projectChains(rest as ProjectDefinition)).toEqual([]);
  });
});
