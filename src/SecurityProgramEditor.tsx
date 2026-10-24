import { useState } from "react";
import { Link } from "./Link";
import { publishProjectRevision, type RevisionResult } from "./lib/project-api";
import type { GithubActor } from "./lib/project-contracts";
import { formatAssetAmount, parseAssetAmount } from "./lib/project-schema.mjs";
import type { ProjectDefinition } from "./lib/projects.mjs";
import {
  assertSecurityBountyTerms,
  type SecurityBountyTerms,
} from "./lib/security-bounty.mjs";

const TEXT_FIELDS = [
  [
    "includedAssets",
    "Covered assets",
    "One asset per line. Describe what researchers may test.",
  ],
  [
    "excludedDependencies",
    "Excluded dependencies",
    "One dependency per line. Leave empty if none.",
  ],
  [
    "testingPermission",
    "Test rules",
    "State where and how researchers may test.",
  ],
  [
    "severityRubric",
    "Severity guide",
    "Explain how you assess impact. Awards remain your decision.",
  ],
  [
    "lossDefinition",
    "Loss of funds",
    "Describe the funds and losses covered by this program.",
  ],
  [
    "exhaustionRule",
    "When funds run out",
    "Explain what happens when the program cannot fund another award.",
  ],
  [
    "dispute",
    "Disputes",
    "Explain how to request a review. Slop moderators handle escalated disputes.",
  ],
  [
    "disclosure",
    "Disclosure",
    "State when and how a report may become public.",
  ],
  [
    "safeHarbor",
    "Researcher protection",
    "State the protection you offer for research that follows these rules.",
  ],
] as const;
type TextField = (typeof TEXT_FIELDS)[number][0];
const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** Public program terms use the same owner revision and live authority check as setup. */
export function SecurityProgramEditor({
  project,
  revision,
  actor,
  onPublished,
}: {
  project: ProjectDefinition;
  revision: number;
  actor: GithubActor;
  onPublished: (result: RevisionResult) => void;
}) {
  const existing = project.securityBounty;
  // Session metadata (such as admin) is not part of a public contact record.
  const owner = { githubId: actor.githubId, githubLogin: actor.githubLogin };
  const [expanded, setExpanded] = useState(false);
  const [status, setStatus] = useState<SecurityBountyTerms["status"]>(
    existing?.status ?? "paused",
  );
  const [amount, setAmount] = useState(
    existing
      ? formatAssetAmount(
          existing.amount.grossMinor,
          existing.amount.decimals,
        ).replaceAll(",", "")
      : "",
  );
  const [network, setNetwork] = useState<
    SecurityBountyTerms["amount"]["network"]
  >(existing?.amount.network ?? "base");
  const [commit, setCommit] = useState(
    existing?.scope.sourceRevisions[0]?.commit ?? "",
  );
  const [awards, setAwards] = useState(String(existing?.capacity.awards ?? 1));
  const [response, setResponse] = useState(
    existing?.responseTargets ?? {
      acknowledgeHours: 24,
      triageBusinessDays: 3,
      updateIntervalDays: 7,
    },
  );
  const [text, setText] = useState<Record<TextField, string>>({
    includedAssets: existing?.scope.includedAssets.join("\n") ?? "",
    excludedDependencies: existing?.scope.excludedDependencies.join("\n") ?? "",
    testingPermission: existing?.scope.testingPermission ?? "",
    severityRubric: existing?.scope.severityRubric ?? "",
    lossDefinition: existing?.scope.lossDefinition ?? "",
    exhaustionRule: existing?.capacity.exhaustionRule ?? "",
    dispute: existing?.dispute.process ?? "",
    disclosure: existing?.disclosure ?? "",
    safeHarbor: existing?.safeHarbor ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function publish() {
    setError(null);
    try {
      const program: SecurityBountyTerms = {
        ...(existing ?? {}),
        version: "1",
        status,
        rewardMode: existing?.rewardMode ?? "separate",
        eligibility: "critical-loss-of-funds",
        amount: {
          currency: existing?.amount.currency ?? "USDC",
          decimals: existing?.amount.decimals ?? 6,
          network,
          grossMinor: parseAssetAmount(amount, existing?.amount.decimals ?? 6),
        },
        split: { researcherBasisPoints: 7500, slopBasisPoints: 2500 },
        sponsor: existing?.sponsor ?? {
          name: project.name,
          githubId: actor.githubId,
        },
        // The API replaces this with its finalized vault evidence.
        funding: existing?.funding ?? { state: "pledged" },
        capacity: {
          awards: Number(awards),
          closesAt: existing?.capacity.closesAt ?? null,
          exhaustionRule: text.exhaustionRule.trim(),
        },
        scope: {
          sourceRevisions: [
            {
              repository:
                existing?.scope.sourceRevisions[0]?.repository ??
                project.repositories[0].id,
              commit: commit.trim(),
            },
            ...(existing?.scope.sourceRevisions.slice(1) ?? []),
          ],
          deployments: existing?.scope.deployments ?? [],
          includedAssets: lines(text.includedAssets),
          excludedDependencies: lines(text.excludedDependencies),
          testingPermission: text.testingPermission.trim(),
          severityRubric: text.severityRubric.trim(),
          lossDefinition: text.lossDefinition.trim(),
        },
        intake: existing?.intake ?? {
          kind: "github-private-vulnerability-reporting",
          repository: project.repositories[0].id,
        },
        responseTargets: response,
        approvers: existing?.approvers ?? {
          technical: [owner],
          financial: [owner],
          dispute: [owner],
        },
        dispute: {
          authority: existing?.dispute.authority ?? "advisory",
          process: text.dispute.trim(),
        },
        disclosure: text.disclosure.trim(),
        safeHarbor: text.safeHarbor.trim(),
      };
      // Open status is authorized only by the API's current finalized balance.
      assertSecurityBountyTerms(
        { ...program, status: status === "open" ? "paused" : status },
        { repositories: project.repositories, reward: { ...project.reward } },
      );
      setBusy(true);
      const result = await publishProjectRevision(
        project.id,
        { ...project, securityBounty: program },
        revision,
        "Update security bounty terms",
        null,
      );
      onPublished(result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Cannot publish the bounty terms. Retry.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="owner-section" aria-labelledby="owner-security-title">
      <h2 id="owner-security-title">Security bounty</h2>
      <div className="owner-form">
        <p>
          Researchers submit through Slop. Reports stay private in GitHub. You
          decide each award. The researcher receives 75%; Slop receives 25%.
        </p>
        <p>
          Changes apply to later reports. Existing reports and funded awards
          keep their recorded terms.
        </p>
        {existing && (
          <p>
            <Link href={`/projects/${project.slug}/security`}>
              View public terms
            </Link>{" "}
            · <Link href="/security">Open private cases</Link>
          </p>
        )}
        <button
          type="button"
          className="button secondary-button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          aria-controls="owner-security-form"
        >
          {expanded
            ? "Hide bounty settings"
            : existing
              ? "Edit bounty settings"
              : "Set bounty terms"}
        </button>
        {expanded && (
          <form
            id="owner-security-form"
            className="proposal-form"
            onSubmit={(event) => {
              event.preventDefault();
              void publish();
            }}
          >
            <fieldset disabled={busy}>
              <legend>Program</legend>
              <label htmlFor="bounty-status">Status</label>
              <select
                id="bounty-status"
                value={status}
                onChange={(event) =>
                  setStatus(event.target.value as SecurityBountyTerms["status"])
                }
              >
                {existing?.status === "draft" && (
                  <option value="draft">Draft</option>
                )}
                {existing?.status === "pending-approval" && (
                  <option value="pending-approval">Pending (legacy)</option>
                )}
                <option value="paused">Paused</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
              <p>
                Opening requires available funds in a verified, separate bounty
                vault. Slop checks the latest finalized balance. Closing stops
                new reports, not existing cases or awards.
              </p>
              <label htmlFor="bounty-amount">
                Published gross award ({existing?.amount.currency ?? "USDC"})
              </label>
              <input
                id="bounty-amount"
                inputMode="decimal"
                required
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
              <p>
                This amount is a guide, not a guaranteed payment. You set the
                amount for each approved report.
              </p>
              <label htmlFor="bounty-network">Bounty network</label>
              <select
                id="bounty-network"
                value={network ?? ""}
                disabled={Boolean(existing?.settlement)}
                onChange={(event) =>
                  setNetwork((event.target.value || null) as typeof network)
                }
              >
                {existing?.amount.currency === "USD" ? (
                  <option value="">External USD</option>
                ) : (
                  <>
                    <option value="base">Base</option>
                    <option value="ethereum">Ethereum</option>
                    <option value="robinhood">Robinhood</option>
                    <option value="solana">Solana</option>
                  </>
                )}
              </select>
              <label htmlFor="bounty-awards">Planned awards</label>
              <input
                id="bounty-awards"
                type="number"
                min="1"
                max="1000"
                required
                value={awards}
                onChange={(event) => setAwards(event.target.value)}
              />
              <label htmlFor="bounty-commit">
                Source commit (
                {existing?.scope.sourceRevisions[0]?.repository ??
                  project.repositories[0].id}
                )
              </label>
              <input
                id="bounty-commit"
                required
                minLength={40}
                maxLength={40}
                pattern="[0-9a-f]{40}"
                value={commit}
                onChange={(event) => setCommit(event.target.value)}
              />
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Scope and terms</legend>
              {TEXT_FIELDS.map(([key, label, help]) => (
                <div className="form-field" key={key}>
                  <label htmlFor={`bounty-${key}`}>{label}</label>
                  <p id={`bounty-${key}-help`}>{help}</p>
                  <textarea
                    id={`bounty-${key}`}
                    aria-describedby={`bounty-${key}-help`}
                    rows={3}
                    required={key !== "excludedDependencies"}
                    minLength={
                      key === "excludedDependencies"
                        ? undefined
                        : key === "includedAssets"
                          ? 2
                          : 12
                    }
                    maxLength={
                      key === "safeHarbor"
                        ? 4000
                        : key === "includedAssets" ||
                            key === "excludedDependencies"
                          ? 10000
                          : key === "exhaustionRule"
                            ? 1000
                            : 2000
                    }
                    value={text[key]}
                    onChange={(event) =>
                      setText({ ...text, [key]: event.target.value })
                    }
                  />
                </div>
              ))}
            </fieldset>
            <fieldset disabled={busy}>
              <legend>Response targets</legend>
              {(
                [
                  ["acknowledgeHours", "Acknowledge within (hours)", 336],
                  ["triageBusinessDays", "Triage within (business days)", 60],
                  ["updateIntervalDays", "Send an update every (days)", 60],
                ] as const
              ).map(([key, label, max]) => (
                <div className="form-field" key={key}>
                  <label htmlFor={`bounty-${key}`}>{label}</label>
                  <input
                    id={`bounty-${key}`}
                    type="number"
                    min="1"
                    max={max}
                    required
                    value={response[key]}
                    onChange={(event) =>
                      setResponse({
                        ...response,
                        [key]: Number(event.target.value),
                      })
                    }
                  />
                </div>
              ))}
            </fieldset>
            <p>
              Project contacts:{" "}
              {(existing?.approvers.technical ?? [actor])
                .map((person) => `@${person.githubLogin}`)
                .join(", ")}
              . Slop checks current repository access when you publish.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="button primary-button"
              disabled={busy}
              type="submit"
            >
              {busy ? "Publishing…" : "Publish bounty terms"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
