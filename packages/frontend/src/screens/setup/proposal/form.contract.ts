// spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"; spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/backend/referralCodes.md, "A current reservation resolves through current open membership"
import { emptyProposal, type Proposal } from "../../../flows/projects/proposal.ts";
import { privateBountyCriteria, privateBountyTesting } from "../../../flows/security/program.vibe";
import { vectors } from "../../../kernels/vectors.ts";
import { facts, filled, monthly, promised } from "./fixtures.ts";
import { defaultCriteria, type Lookup, lookupKey, proposalErrors, restoredWizard, setupErrors, withFacts, withField, withLookup, withReferrer, withRepository } from "./form.ts";
import { draftManifest } from "./manifest.ts";

const now = "2026-11-17T12:00:00.000Z";
const saved = (proposal: Partial<Proposal>, step = 0, referrer: string | null = null) => JSON.stringify({ proposal, step, referrer });

export const aRestoredFormStartsUncheckedAndKeepsTheLinkReferrer = vectors<readonly [string | null, string], readonly [string, number, string | null]>(
  [
    [[null, ""], ["false", 0, null]],
    [[null, "?ref=octocat"], ["false", 0, "octocat"]],
    [[saved({ automaticClosure: "true" }, 2, "hubot"), ""], ["true", 2, "hubot"]],
    [[saved({ automaticClosure: "yes" }, 7, "not a login!"), "?ref=octocat"], ["yes", 0, "octocat"]],
    [["{broken", ""], ["false", 0, null]],
  ],
  ([text, search]) => {
    const wizard = restoredWizard(text, search);
    return [wizard.proposal.automaticClosure, wizard.step, wizard.referrer] as const;
  },
);

export const onlyAnExplicitYesOutsideABountyAsksForClosure = vectors<Proposal, boolean>(
  [
    [filled, false],
    [{ ...filled, automaticClosure: "true" }, true],
    [{ ...filled, automaticClosure: "yes" }, false],
    [{ ...filled, automaticClosure: "true", fundingMode: "bounty" }, false],
  ],
  (proposal) => "slopbot" in draftManifest({ proposal, actor: undefined, valid: true, now }).manifest,
);

export const anotherRepositoryForgetsTheLastRepositoryFacts = vectors<readonly [string, string], readonly [string, string, string, number]>(
  [
    [["octo-org/engine", "OCTO-ORG/ENGINE"], ["octo-org/engine", facts.numericId, "octo-org", 0]],
    [["octo-org/engine", "octocat/hello-world"], ["octocat/hello-world", "", "", 1]],
  ],
  ([from, to]) => {
    const wizard = withRepository({ ...restoredWizard(saved(filled), ""), proposal: { ...filled, repository: from } }, to);
    return [wizard.proposal.repository, wizard.proposal.repositoryNumericId, wizard.proposal.stewardLogin, wizard.generation] as const;
  },
);

export const lookedUpFactsFillOnlyUntouchedText = vectors<readonly [string, string], readonly [string, string, string]>(
  [
    [["", ""], ["engine", facts.description ?? "", defaultCriteria]],
    [["My engine", "Custom headline text"], ["My engine", "Custom headline text", defaultCriteria]],
  ],
  ([name, headline]) => {
    const start = restoredWizard(saved({ repository: facts.repository, name, headline }), "");
    const key = lookupKey(start) ?? "";
    const { proposal } = withFacts(start, key, facts);
    return [proposal.name, proposal.headline, proposal.criteria] as const;
  },
);

export const thePrivateBountySwapsOnlyTheDefaultScopeAndTesting = vectors<readonly [string, string, string], readonly [string, string]>(
  [
    [[defaultCriteria, "", "bounty"], [privateBountyCriteria, privateBountyTesting]],
    [["Own criteria text", "npm test", "bounty"], ["Own criteria text", "npm test"]],
    [[privateBountyCriteria, privateBountyTesting, "monthly"], [defaultCriteria, ""]],
  ],
  ([criteria, requiredTests, mode]) => {
    const { proposal } = withField(restoredWizard(saved({ ...filled, criteria, requiredTests }), ""), "fundingMode", mode, facts);
    return [proposal.criteria, proposal.requiredTests] as const;
  },
);

export const setupNamesTheFieldToFix = vectors<Proposal, Readonly<Record<string, string>>>(
  [
    [
      { ...emptyProposal },
      { repository: "Choose a repository.", name: "Enter 2 to 80 characters.", headline: "Enter 8 to 120 characters.", goal: "Enter 24 to 600 characters.", criteria: "Enter 6 to 2000 characters." },
    ],
    [filled, {}],
    [monthly, {}],
    [{ ...monthly, monthlyPool: "0" }, { monthlyPool: "Enter a positive amount." }],
    [{ ...filled, fundingMode: "bounty", rewardKind: "native", monthlyPool: "0.000000000000000001" }, { monthlyPool: "Amount must split into whole token units." }],
    [{ ...filled, fundingMode: "monthly", monthlyPool: "10", rewardKind: "token", rewardAssetAddress: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", rewardAssetSymbol: "USDC" }, { rewardAssetAddress: "That address is the network stablecoin; choose USDC." }],
  ],
  (proposal) => ({ ...proposalErrors(proposal) }),
);

export const branchesWaitForTheLookupOfTheSameRepository = vectors<readonly [string, boolean], string | undefined>(
  [
    [["main", true], undefined],
    [["gone", true], "Choose a repository branch."],
    [["main", false], "Wait for the repository branches to load."],
  ],
  ([branch, loaded]) => setupErrors({ ...filled, integrationBranch: branch }, loaded ? { state: "done", facts } : { state: "loading" }).integrationBranch,
);

export const eachVisitKeepsItsOwnLinkReferrer = vectors<readonly [string | null, string], string | null>(
  [
    [["hubot", "?ref=octocat"], "octocat"],
    [["hubot", ""], "hubot"],
    [["hubot", "?ref=not a login!"], "hubot"],
    [[null, "?ref=octocat"], "octocat"],
  ],
  ([referrer, search]) => withReferrer({ ...restoredWizard(null, ""), referrer }, search).referrer,
);

export const anInvalidEarlierStepIsWhereTheFormStays = vectors<readonly [Proposal, Lookup], readonly [number, boolean]>(
  [
    [[filled, { state: "done", facts }], [2, false]],
    [[{ ...filled, name: "x" }, { state: "done", facts }], [0, true]],
    [[{ ...filled, integrationBranch: "gone" }, { state: "done", facts }], [0, true]],
    [[filled, { state: "error", message: "Repository could not load." }], [0, true]],
    [[{ ...monthly, monthlyPool: "0" }, { state: "done", facts }], [1, false]],
  ],
  ([proposal, lookup]) => {
    const opened = restoredWizard(saved(proposal, 2), "");
    const key = lookupKey(opened) ?? "";
    const settled = withLookup(opened, key, lookup);
    return [settled.step, settled.attempted[0]] as const;
  },
);

export const newProjectLinksAddOnlyAValidWebsiteAndXAccount = vectors<Proposal, unknown>(
  [
    [filled, { repository: "https://github.com/octo-org/engine", issues: "https://github.com/octo-org/engine/issues" }],
    [
      { ...filled, website: "ntwrk.party", x: "@elizaOS" },
      { repository: "https://github.com/octo-org/engine", issues: "https://github.com/octo-org/engine/issues", website: "https://ntwrk.party", x: "https://x.com/elizaOS" },
    ],
    [{ ...filled, website: "http://ntwrk.party", x: "@not a handle" }, { repository: "https://github.com/octo-org/engine", issues: "https://github.com/octo-org/engine/issues" }],
  ],
  (proposal) => draftManifest({ proposal, actor: undefined, valid: true, now }).manifest.links,
);

export const theProjectStepRefusesAnInvalidWebsiteOrXAccount = vectors<Proposal, readonly [string | undefined, string | undefined]>(
  [
    [{ ...filled, website: "ntwrk.party", x: "@elizaOS" }, [undefined, undefined]],
    [{ ...filled, website: "http://ntwrk.party", x: "@not a handle" }, ["Use an https:// address.", "Enter an X handle such as @slopcash, or its x.com link."]],
  ],
  (proposal) => {
    const errors = proposalErrors(proposal);
    return [errors.website, errors.x] as const;
  },
);

export const thePromiseStartsOffAndIsPublishedOnlyOnAChosenMonthlyPool = vectors<readonly [string | null, Partial<Proposal>], readonly [string, unknown]>(
  [
    [[null, {}], ["false", undefined]],
    [[saved({ fundingMode: "monthly", monthlyPool: "1500" }), {}], ["false", undefined]],
    [[saved(promised), {}], ["true", true]],
    [[saved(promised), { fundingMode: "none" }], ["false", undefined]],
    [[saved(promised), { fundingMode: "bounty" }], ["false", undefined]],
  ],
  ([text, change]) => {
    const restored = restoredWizard(text, "");
    const wizard = change.fundingMode === undefined ? restored : withField(restored, "fundingMode", change.fundingMode, facts);
    const reward = draftManifest({ proposal: wizard.proposal, actor: undefined, valid: true, now }).manifest.reward as { honorSystem?: unknown };
    return [wizard.proposal.honorSystem, reward.honorSystem] as const;
  },
);
