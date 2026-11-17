// spec/backend/projects.md, "Creation and stored-application publication record a paused revision 1"; spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"
import { Schema } from "effect";
import { contract } from "vibestack/testing";
import { vectors } from "../../kernels/vectors.ts";
import { type MonthlyPoolValue, type PoolToken, emptyProposal, immutableProposalTermsUrl, maxProjectIdLength, monthlyPoolValue, normalizeRepositoryInput, projectImageProblem, proposalOf, slugify, validRepositoryPath } from "./proposal.ts";

export const pastedRepositoryLinksBecomeOwnerAndName = vectors<string, string>([
  ["https://github.com/slop/tool", "slop/tool"],
  ["  github.com/slop/tool.git  ", "slop/tool"],
  ["https://www.github.com/slop/tool/tree/main/src?tab=readme#top", "slop/tool"],
  ["git@github.com:slop/tool.git", "slop/tool"],
  ["ssh://git@github.com/slop/tool/", "slop/tool"],
  ["slop/tool", "slop/tool"],
  ["github.com/git@github.com:slop/tool", "slop/tool"],
  ["https://gitlab.com/slop/tool", "https://gitlab.com/slop/tool"],
  ["", ""],
], normalizeRepositoryInput);

export const normalizingARepositoryTwiceChangesNothing = contract({
  input: Schema.String,
  run: (text) => [normalizeRepositoryInput(text), normalizeRepositoryInput(normalizeRepositoryInput(text))] as const,
  invariant: (_text, [once, twice]) => once === twice,
});

export const slugsAreBoundedAndNeverNameTheSetupPage = vectors<string, string>([
  ["My Project!", "my-project"],
  ["  --Slop  Tools-- ", "slop-tools"],
  ["New", "new-project"],
  ["a".repeat(50), "a".repeat(maxProjectIdLength)],
  [`${"a".repeat(42)} b`, "a".repeat(42)],
], slugify);

export const slugsUseOnlyLowercaseWordsAndHyphens = contract({
  input: Schema.String,
  run: slugify,
  invariant: (_text, slug) => slug.length <= maxProjectIdLength && /^(?:[a-z0-9]+(?:-[a-z0-9]+)*)?$/u.test(slug),
});

export const repositoryPathsAreOwnerAndName = vectors<string, boolean>([
  ["slop/tool", true],
  ["slop/tool/extra", false],
  ["slop", false],
  [`${"a".repeat(100)}/${"b".repeat(100)}`, true],
  [`${"a".repeat(101)}/${"b".repeat(100)}`, false],
], validRepositoryPath);

export const termsLinksPinTheRepositoryCommit = vectors<string, boolean>([
  [`https://github.com/slop/tool/blob/${"a".repeat(40)}/TERMS.md`, true],
  [`https://github.com/slop/tool/blob/${"a".repeat(40)}/`, false],
  [`https://github.com/slop/tool/blob/main/TERMS.md`, false],
  [`https://github.com/slop/tool/blob/${"a".repeat(40)}/TERMS.md?plain=1`, false],
  [`http://github.com/slop/tool/blob/${"a".repeat(40)}/TERMS.md`, false],
], (link) => immutableProposalTermsUrl(link, "slop/tool", "a".repeat(40)));

interface Pool {
  readonly value: string;
  readonly token?: PoolToken;
}

export const monthlyPoolsShowTheirOwnAssetAndRefuseNonPositiveAmounts = vectors<Pool, MonthlyPoolValue>([
  [{ value: "1000" }, { display: "$1,000", minor: "1000000000", valid: true }],
  [{ value: "12.5" }, { display: "$12.50", minor: "12500000", valid: true }],
  [{ value: "0.001" }, { display: "$0", minor: "0", valid: false, error: "Use up to 2 decimals, at most 1 billion." }],
  [{ value: "1000000001" }, { display: "$0", minor: "0", valid: false, error: "Use up to 2 decimals, at most 1 billion." }],
  [{ value: "" }, { display: "$0", minor: "0", valid: false, error: "Enter a positive amount." }],
  [{ value: "0.00" }, { display: "$0", minor: "0", valid: false, error: "Enter a positive amount." }],
  [{ value: "1.5", token: { symbol: "ETH", decimals: 18 } }, { display: "1.5 ETH", minor: "1500000000000000000", valid: true }],
  [{ value: "1.5", token: { symbol: "SOL", decimals: 0 } }, { display: "0 SOL", minor: "0", valid: false, error: "amount has more decimal places than the asset's 0" }],
  [{ value: "abc", token: { symbol: "TOK" } }, { display: "0 TOK", minor: "0", valid: false, error: "amount must be a plain decimal number" }],
  [{ value: "25", token: { symbol: "TOK" } }, { display: "25 TOK", minor: "0", valid: true }],
], ({ value, token }) => monthlyPoolValue(value, token));

export const projectImagesAreSmallWebpOrJpeg = vectors<string, string | undefined>([
  [`data:image/jpeg;base64,${btoa("\xff\xd8\xff\xe0image\xff\xd9")}`, undefined],
  [`data:image/webp;base64,${btoa("RIFF\0\0\0\0WEBPVP8 ")}`, undefined],
  [`data:image/webp;base64,${btoa("\xff\xd8\xff\xe0image\xff\xd9")}`, "Project image bytes must match its WebP or JPEG type."],
  ["data:image/png;base64,AAAA", "Project image must be a small WebP or JPEG image."],
  [`data:image/jpeg;base64,${"A".repeat(16_400)}`, "Project image must be a small WebP or JPEG image."],
], projectImageProblem);

export const savedConsentIsOnlyEverItsExactText = vectors<unknown, string | undefined>([
  [{}, "false"],
  [{ automaticClosure: "true" }, "true"],
  [{ automaticClosure: true }, "false"],
  [null, undefined],
  [[], undefined],
], (stored) => proposalOf(stored)?.automaticClosure);

export const newProposalsStartWithClosureUnchecked = vectors<null, string>([[null, "false"]], () => emptyProposal.automaticClosure);
