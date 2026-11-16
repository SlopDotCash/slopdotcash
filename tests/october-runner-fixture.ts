import { readFileSync } from "node:fs";
import { encodeBase58Bytes } from "../src/lib/base58";
import { ESCROW_NETWORKS } from "../src/lib/escrow-policy.mjs";
import { sha256Hex } from "../src/lib/sha256";
import { fixtureProject } from "./fixture-overlay.mjs";
import { CONTRIBUTION } from "./project-application-manifest";

const terms = readFileSync(
  new URL("./fixtures/october-approved-terms.txt", import.meta.url),
);
const actor = (id: string, login: string) => ({
  githubUserId: id,
  githubNodeId: btoa(`04:User${id}`),
  login,
});
const address = (i: number) => `0x${i.toString(16).padStart(40, "0")}`;
const pubkey = (i: number) => encodeBase58Bytes(new Uint8Array(32).fill(i));

/** No real recipients, vaults, source records, or production policy claims. */
export function octoberRunnerFixture(): {
  registry: {
    schemaVersion: string;
    origin: string;
    capturedAt: string;
    enforcementGeneration: number;
    projects: {
      id: string;
      revision: number;
      manifestSha256: string;
      manifestText: string;
      restriction: string;
    }[];
  };
  packet: {
    schemaVersion: string;
    kind: string;
    period: string;
    through: string;
    approvedTermsSha256: string;
    producerGithubId: string;
    reviewerGithubId: string;
    reviewedAt: string;
    enforcementGeneration: number;
    evidence: Record<string, string>;
    projects: {
      id: string;
      revision: number;
      manifestSha256: string;
      from: string;
      reconciliation: string;
      identities: {
        githubUserId: string;
        githubNodeId: string;
        login: string;
      }[];
      weights: {
        githubUserId: string;
        acceptedWorkPoints: number;
        eligible: boolean;
      }[];
    }[];
  };
} {
  const approved = JSON.parse(terms.toString());
  const opened = "2026-10-01T00:00:00.000Z";
  const registry = {
    schemaVersion: "1",
    origin: "https://slop.cash",
    capturedAt: "2026-11-15T01:00:01.000Z",
    enforcementGeneration: 0,
    projects: approved.projects.map(
      (
        term: {
          id: string;
          network: keyof typeof ESCROW_NETWORKS;
          asset: string;
          assetAddress: string;
        },
        index: number,
      ) => {
        const original = fixtureProject("slopdotcash");
        const chain = ESCROW_NETWORKS[term.network].chain;
        const family = ESCROW_NETWORKS[term.network].family;
        const evm = family === "evm";
        const manifest = {
          ...original,
          contribution: CONTRIBUTION,
          funding: { ...original.funding, recordsPath: `funding/${term.id}` },
          id: term.id,
          slug: term.id,
          skill: {
            ...original.skill,
            id: `contribute-to-${term.id}`,
            sourcePath: "skills/project-contributor-template",
            publicPath: `/projects/${term.id}/skill.md`,
          },
          reviewSkill: {
            ...original.reviewSkill,
            id: `review-${term.id}-contributions`,
            sourcePath: "skills/project-reviewer-template",
          },
          reward: {
            ...original.reward,
            rewardStartAt: opened,
            chain,
            currency: term.asset,
            feeBasisPoints: 200,
            cycleCaps: [{ cycleId: "2026-10", monthlyCapMinor: "0" }],
          },
          escrow: {
            schemaVersion: "1",
            effectiveCycle: "2026-11",
            chain,
            feeBasisPoints: 200,
            withdrawalFeeBasisPoints: 200,
            feeMode: "deduct-from-gross",
            deployments: [
              {
                network: term.network,
                asset: term.assetAddress,
                vault: evm ? address(index + 1) : pubkey(index + 1),
                owner: evm ? address(21) : pubkey(21),
                identityAuthority: evm ? address(22) : pubkey(22),
                feeRecipient: evm ? address(23) : pubkey(23),
                programId: evm ? null : pubkey(24),
                upgradeAuthority: null,
                projectPda: evm ? null : pubkey(index + 40),
                networkDomain: evm ? null : "c".repeat(64),
                ...(evm ? {} : { rotationAuthority: pubkey(29) }),
                deploymentTransaction: evm
                  ? `0x${"4".repeat(64)}`
                  : "1".repeat(64),
                sourceCommit: "e".repeat(40),
                codeSha256: "f".repeat(64),
                bindingDelaySeconds: "0",
                rotationDelaySeconds: evm ? null : "0",
                factory: evm ? address(26) : null,
                factoryCodeSha256: evm ? "a".repeat(64) : null,
                registrar: evm ? address(27) : null,
              },
            ],
          },
        };
        const manifestText = JSON.stringify(manifest);
        return {
          id: term.id,
          revision: 3,
          manifestSha256: sha256Hex(manifestText),
          manifestText,
          restriction: "clear",
        };
      },
    ),
  };
  const packet = {
    schemaVersion: "1",
    kind: "reconciled-october-accepted-work",
    period: "2026-10",
    through: "2026-11-01T00:00:00.000Z",
    approvedTermsSha256: sha256Hex(terms),
    producerGithubId: "7001",
    reviewerGithubId: "7002",
    reviewedAt: "2026-11-15T01:00:00.000Z",
    enforcementGeneration: 0,
    evidence: Object.fromEntries(
      [
        "census",
        "assessmentJournal",
        "pointsBatch",
        "attribution",
        "duplicateCredit",
        "protectedHistory",
        "eligibility",
      ].map((name) => [name, sha256Hex(name)]),
    ),
    projects: registry.projects.map(
      ({
        id,
        revision,
        manifestSha256,
      }: {
        id: string;
        revision: number;
        manifestSha256: string;
      }) => ({
        id,
        revision,
        manifestSha256,
        from: opened,
        reconciliation: "complete",
        identities: [
          actor("7101", "fixture-alpha"),
          actor("7102", "fixture-beta"),
          actor("7103", "fixture-excluded"),
        ],
        weights: [
          { githubUserId: "7101", acceptedWorkPoints: 10, eligible: true },
          { githubUserId: "7102", acceptedWorkPoints: 20, eligible: true },
          { githubUserId: "7103", acceptedWorkPoints: 1000, eligible: false },
        ],
      }),
    ),
  };
  return { packet, registry };
}
