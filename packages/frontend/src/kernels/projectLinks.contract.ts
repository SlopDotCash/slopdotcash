// spec/frontend/projectLinks.md, "The project page names each vault network once, with its asset only when every vault on it agrees, and shows the website and X account only when present"; spec/backend/projects.md, "Owner revisions publish at once against the expected revision"
import { Schema } from "effect";
import { contract } from "vibestack/testing";
import { type ChainProject, type LinkInput, maxLinkLength, normalizeWebsiteInput, normalizeXInput, type ProjectChain, projectChains, websiteLabel, withOwnerLinks, xHandle, xInputValue } from "./projectLinks.ts";
import { vectors } from "./vectors.ts";

const slopcash: LinkInput = { ok: true, value: "https://x.com/slopcash" };

const none: LinkInput = { ok: true, value: null };

export const anXHandleOrProfileLinkIsStoredAsItsBareXUrl = vectors<string, LinkInput>([
  ["slopcash", slopcash],
  ["@slopcash", slopcash],
  [" @slopcash ", slopcash],
  ["https://x.com/slopcash", slopcash],
  ["https://x.com/slopcash/", slopcash],
  ["x.com/slopcash", slopcash],
  ["https://www.x.com/slopcash", slopcash],
  ["https://twitter.com/slopcash", slopcash],
  ["http://twitter.com/slopcash", slopcash],
  ["", none],
  ["   ", none],
], normalizeXInput);

export const anythingButOneXProfileIsRefused = vectors<string, boolean>([
  ["@", false],
  ["@has space", false],
  ["@sixteencharacter", false],
  ["https://x.com/slopcash/status/1", false],
  ["https://x.com/slopcash?s=20", false],
  ["https://x.com/slopcash#top", false],
  ["https://example.com/slopcash", false],
  ["https://x.com.evil.example/slopcash", false],
  ["https://user:pass@x.com/slopcash", false],
  ["ftp://x.com/slopcash", false],
  ["x.com", false],
], (input) => normalizeXInput(input).ok);

export const aStoredXLinkShowsAsItsHandle = vectors<string | undefined, readonly [string | null, string]>([
  ["https://x.com/Slop_Cash_1", ["Slop_Cash_1", "@Slop_Cash_1"]],
  ["https://x.com/slopcash/status/1", [null, "https://x.com/slopcash/status/1"]],
  ["https://twitter.com/slopcash", [null, "https://twitter.com/slopcash"]],
  [undefined, [null, ""]],
], (url) => [xHandle(url), xInputValue(url)]);

export const aWebsiteIsAnHttpsAddressAndABareDomainGainsHttps = vectors<string, LinkInput>([
  ["https://ntwrk.party", { ok: true, value: "https://ntwrk.party" }],
  [" example.org/docs?lang=en ", { ok: true, value: "https://example.org/docs?lang=en" }],
  ["", none],
  ["http://example.org", { ok: false, error: "Use an https:// address." }],
  ["https://example.org/#about", { ok: false, error: "Enter an https:// address of at most 500 characters, without a #section." }],
], normalizeWebsiteInput);

export const otherSchemesCredentialsSectionsAndLongAddressesAreRefused = vectors<string, boolean>([
  ["javascript:alert(1)", false],
  ["https://user:pass@example.org", false],
  ["https://example.org/#about", false],
  ["https://localhost", false],
  [`https://example.org/${"a".repeat(500)}`, false],
  ["not a site", false],
], (input) => normalizeWebsiteInput(input).ok);

export const aWebsiteShowsAsHostAndPathWithoutScheme = vectors<string, string>([
  ["https://example.org/docs?lang=en", "example.org/docs?lang=en"],
  ["https://www.example.org/", "example.org"],
  ["not a url", "not a url"],
], websiteLabel);

const links = {
  repository: "https://github.com/acme/tool",
  issues: "https://github.com/acme/tool/issues",
  docs: "https://docs.acme.example",
  website: "https://old.example",
  x: "https://x.com/old",
};

export const ownerLinksReplaceOnlyTheWebsiteAndXAccount = vectors<readonly [string | null, string | null], Record<string, string>>([
  [["https://new.example", null], { repository: links.repository, issues: links.issues, docs: links.docs, website: "https://new.example" }],
  [[null, null], { repository: links.repository, issues: links.issues, docs: links.docs }],
  [[null, "https://x.com/slopcash"], { repository: links.repository, issues: links.issues, docs: links.docs, x: "https://x.com/slopcash" }],
], ([website, x]) => withOwnerLinks(links, website, x));

const usdcBase = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const token = "0x1111111111111111111111111111111111111111";

export const eachRecordedVaultNetworkIsNamedOnceWithItsAgreedAsset = vectors<ChainProject, ProjectChain[]>([
  [
    { escrow: { deployments: [{ network: "base-mainnet", asset: usdcBase }] }, securityBounty: { settlement: { deployments: [{ network: "base-mainnet", asset: usdcBase.toLowerCase() }] } } },
    [{ name: "Base", symbol: "USDC" }],
  ],
  [
    {
      rewardAsset: { network: "robinhood", address: token, symbol: "TOON" },
      escrow: { deployments: [{ network: "robinhood-mainnet", asset: token }, { network: "solana-mainnet", asset: "So11111111111111111111111111111111111111112" }] },
    },
    [{ name: "Robinhood Chain", symbol: "TOON" }, { name: "Solana", symbol: null }],
  ],
  [{ escrow: { deployments: [{ network: "base-mainnet", asset: usdcBase }, { network: "base-mainnet", asset: token }] } }, [{ name: "Base", symbol: null }]],
  [{ escrow: { deployments: [{ network: "base-sepolia", asset: "0x036cbd53842c5426634e7929541ec2318f3dcf7e" }] } }, [{ name: "Base testnet", symbol: "USDC" }]],
  [{ securityBounty: { settlement: { deployments: [{ network: "base-mainnet", asset: "0x0000000000000000000000000000000000000000" }, { network: "solana-mainnet", asset: "11111111111111111111111111111111" }] } } }, [{ name: "Base", symbol: "ETH" }, { name: "Solana", symbol: "SOL" }]],
  [{ escrow: { deployments: [{ network: "solana-mainnet", asset: "epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytdt1v" }] } }, [{ name: "Solana", symbol: null }]],
  [{}, []],
], projectChains);

const backendLinkRule = (name: "website" | "x", value: string): boolean => {
  const parsed = URL.parse(value);
  if (parsed === null || value.length > maxLinkLength || parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "" || parsed.hash !== "") return false;
  return name === "website" || (parsed.origin === "https://x.com" && parsed.search === "" && /^\/[A-Za-z0-9_]{1,15}$/u.test(parsed.pathname));
};

export const everyAcceptedLinkPassesTheRegistryLinksRule = contract({
  input: Schema.String,
  run: (text) => [["x", normalizeXInput(text)], ["x", normalizeXInput(`@${text}`)], ["x", normalizeXInput(`x.com/${text}`)], ["website", normalizeWebsiteInput(text)], ["website", normalizeWebsiteInput(`${text}.example`)]] as const,
  deterministic: true,
  invariant: (_text, results) => results.every(([name, result]) => !result.ok || result.value === null || backendLinkRule(name, result.value)),
});
