// spec/backend/projects.md, "Creation and stored-application publication record a paused revision 1"; spec/backend/closureConsent.md, "The new form starts unchecked and an existing form reflects only its exact saved setting"; spec/frontend/presentation.md, "Setup presents Project, Rewards and Review with both skill previews"; spec/backend/submissionFeeSettings.md, "Submission fee settings are exact, bounded and off unless enabled with a valid amount"
import { templatePaths } from "@repo/contributor/render/fields";
import { type Proposal, rewardFields } from "../../../flows/projects/proposal.ts";
import { type BountyActor, type BountyTerms, privateBountyTerms } from "../../../flows/security/program.vibe";
import { type LinkInput, normalizeWebsiteInput, normalizeXInput, withOwnerLinks } from "../../../kernels/projectLinks.ts";
import { skillRuleFields } from "../fields/contribution.ts";
import { chainOf, fundingOf, honorSystemOf, listingChoicesOf, slugOf } from "./form.ts";

export interface DraftManifest {
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly slug: string;
  readonly bounty: BountyTerms | undefined;
}

const unset = "Describe the project in one sentence.";

function signedAt(value: string): string {
  return value === "" || Number.isNaN(Date.parse(value)) ? "" : new Date(value).toISOString();
}

function validLink(input: LinkInput): string | null {
  return input.ok ? input.value : null;
}

function rewardOf(p: Proposal, now: string) {
  const funding = fundingOf(p);
  const fields = rewardFields(chainOf(p) === undefined ? { ...funding, mode: "none" } : funding, now);
  return chainOf(p) !== undefined && honorSystemOf(p) ? { ...fields, reward: { ...fields.reward, honorSystem: true } } : fields;
}

function contributionSettings(p: Proposal) {
  const choices = listingChoicesOf(p);
  const slopbot = choices.closureConsent || choices.submissionFee || choices.wantedIssues
    ? { slopbot: { automaticClosure: choices.closureConsent, ...(choices.submissionFee ? { submissionFee: { enabled: true } } : {}), ...(choices.wantedIssues ? { wantedIssues: true } : {}) } }
    : {};
  return { ...slopbot, ...(choices.reportDeposit ? {} : { security: { reportDeposit: false } }) };
}

function repositoryLicense(p: Proposal, repository: string) {
  return p.licenseSpdx || p.licenseCommit || p.licenseDigest
    ? { state: "verified", spdx: p.licenseSpdx, url: `https://github.com/${repository}/blob/${p.licenseCommit}/LICENSE`, commitSha: p.licenseCommit, fileSha256: p.licenseDigest }
    : { state: "unknown", spdx: null, url: null, commitSha: null, fileSha256: null };
}

function inbound(p: Proposal) {
  const known = p.inboundMode !== "unknown";
  return {
    mode: p.inboundMode,
    termsUrl: known ? p.inboundTermsUrl : null,
    commitSha: known ? p.inboundCommit : null,
    fileSha256: known ? p.inboundDigest : null,
    version: known ? p.inboundVersion : null,
    acceptance: known ? p.inboundAcceptance : null,
  };
}

function assignment(p: Proposal) {
  return p.copyrightModel === "sponsor-owned" || p.inboundMode === "assignment"
    ? { assignee: p.assignmentAssignee, instrumentUrl: p.assignmentUrl, fileSha256: p.assignmentDigest, version: p.assignmentVersion, signedAt: signedAt(p.assignmentSignedAt) }
    : null;
}

/** @throws {never} */
export function draftManifest({ proposal: p, actor, valid, now }: { proposal: Proposal; actor: BountyActor | undefined; valid: boolean; now: string }): DraftManifest {
  const slug = slugOf(p);
  const repository = p.repository || "owner/repository";
  const funding = fundingOf(p);
  const bounty = p.fundingMode === "bounty" && valid && actor !== undefined
    ? privateBountyTerms({ name: p.name, repository, commit: p.sourceCommit, scope: p.goal, criteria: p.criteria, testing: p.requiredTests, funding, actor })
    : undefined;
  const manifest = {
    schemaVersion: "1",
    id: slug,
    slug,
    name: p.name || "New project",
    eyebrow: p.fundingMode === "bounty" ? "Private security bounty" : "Open-source project",
    headline: p.headline || unset,
    ...(p.image ? { image: p.image } : {}),
    description: p.goal || "Describe the concrete open-source goal.",
    listingTier: "community",
    status: "paused",
    steward: {
      displayName: p.stewardLogin ? `@${p.stewardLogin}` : "Unverified steward",
      kind: p.stewardKind,
      github: {
        actorId: p.stewardActorId || "0",
        nodeId: p.stewardNodeId || "pending",
        login: p.stewardLogin || "pending",
        type: p.stewardKind === "individual" ? "User" : "Organization",
        profileUrl: `https://github.com/${p.stewardLogin || "pending"}`,
      },
      website: null,
    },
    authority: {
      state: "unverified",
      reason: "missing-repository-proof",
      role: "project-steward",
      repositoryId: p.repositoryNumericId || "0",
      repositoryNodeId: p.repositoryNodeId || "pending",
      proof: null,
    },
    terms: {
      revision: "draft-1",
      effectiveAt: now,
      paymentTransfersIp: false,
      retroactive: false,
      receiptPolicy: { state: "pending-authority-activation", activatedAt: null, bindings: [] },
      copyright: {
        model: p.copyrightModel,
        claimedLegalHolder: p.copyrightModel === "sponsor-owned" ? p.legalHolder || null : null,
        notice: null,
        legalCapacity: null,
        governanceResolution: null,
      },
      repositoryLicense: repositoryLicense(p, repository),
      inbound: inbound(p),
      assignment: assignment(p),
      externalPrize: null,
    },
    repositories: [{ id: repository, displayName: repository, githubUrl: `https://github.com/${repository}`, description: p.headline || unset, integrationBranch: p.integrationBranch }],
    skill: { id: `contribute-to-${slug}`, publishAtRoot: false, sourcePath: templatePaths.contributor, publicPath: `/projects/${slug}/skill.md` },
    reviewSkill: { id: `review-${slug}-contributions`, sourcePath: templatePaths.reviewer },
    contribution: {
      approvedScope: p.criteria.trim() || "Define exact accepted outcomes with the maintainer.",
      ...Object.fromEntries(skillRuleFields.map((field) => [field, p[field].trim()])),
    },
    ...contributionSettings(p),
    ...rewardOf(p, now),
    ...(bounty?.kind === "terms" ? { securityBounty: bounty.terms } : {}),
    funding: {
      mode: "direct-noncustodial",
      disclosure: "Funds go directly to the project wallet. Slop does not hold or recover funds.",
      recordsPath: `funding/${slug}`,
      addresses: [],
    },
    modelPolicy: { mode: "open-declared", disclosureRequired: true },
    links: withOwnerLinks({ repository: `https://github.com/${repository}`, issues: `https://github.com/${repository}/issues` }, validLink(normalizeWebsiteInput(p.website)), validLink(normalizeXInput(p.x))),
  };
  return { manifest, slug, bounty };
}
