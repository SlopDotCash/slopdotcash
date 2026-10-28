import { useState } from "react";
import { SecurityOffer } from "./SecurityOffer";
import "./operations-design.css";
import "./owner-review.css";
import { Link } from "./Link";
import { formatBaseUnits } from "./lib/base-units.mjs";
import { errorMessage } from "./lib/errors";
import {
  carriedSecurityTerms,
  fullAwardSelectable,
  initialSecuritySplit,
  PLATFORM_BOUNTY_DEPLOYMENTS,
  PLATFORM_BOUNTY_SOURCE_COMMIT,
  PLATFORM_BOUNTY_TEXT,
} from "./lib/platform-security-bounty";
import { publishProjectRevision, type RevisionResult } from "./lib/project-api";
import type { GithubActor } from "./lib/project-contracts";
import { parseAssetAmount } from "./lib/project-schema.mjs";
import type { ProjectDefinition } from "./lib/projects.mjs";
import {
  assertSecurityBountyTerms,
  formatSecurityAmount,
  isFullAwardSplit,
  isPlatformSecurityProgram,
  SECURITY_FULL_AWARD_SPLIT,
  SECURITY_SPLIT,
  type SecurityBountyTerms,
  securityBountySplit,
} from "./lib/security-bounty.mjs";
import { useAction } from "./lib/use-action";

const TEXT_FIELDS = [
  ["includedAssets", "Covered assets", "One asset per line."],
  [
    "excludedDependencies",
    "Excluded dependencies",
    "One dependency per line. Leave empty if none.",
  ],
  ["testingPermission", "Test rules", ""],
  ["severityRubric", "Severity guide", ""],
  [
    "lossDefinition",
    "Loss of funds",
    "Describe the funds and losses covered by this program.",
  ],
  ["exhaustionRule", "When funds run out", ""],
  ["dispute", "Disputes", "Explain how to request a review."],
  [
    "disclosure",
    "Disclosure",
    "State when and how a report may become public.",
  ],
  ["safeHarbor", "Researcher protection", ""],
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
  embedded = false,
}: {
  project: ProjectDefinition;
  revision: number;
  actor: GithubActor;
  onPublished: (result: RevisionResult) => void;
  embedded?: boolean;
}) {
  const existing = project.securityBounty;
  // slop.cash sponsors its own contract bounty, so the reporter receives the
  // whole award (owner decision, 28 October 2026). A first program here is
  // prefilled with the proposed terms and the full-award split; an existing
  // program keeps its split. The owner chooses, reviews and publishes.
  const platform = isPlatformSecurityProgram(project.id, project.repositories);
  const defaults = platform && !existing ? PLATFORM_BOUNTY_TEXT : null;
  const canChooseFullAward = fullAwardSelectable(platform, existing);
  const [fullAward, setFullAward] = useState(
    () =>
      canChooseFullAward &&
      isFullAwardSplit(initialSecuritySplit(platform, existing)),
  );
  const programSplit = fullAward ? SECURITY_FULL_AWARD_SPLIT : SECURITY_SPLIT;
  // Session metadata (such as admin) is not part of a public contact record.
  const owner = { githubId: actor.githubId, githubLogin: actor.githubLogin };
  const [expanded, setExpanded] = useState(embedded);
  const [status, setStatus] = useState<SecurityBountyTerms["status"]>(
    existing?.status ?? "paused",
  );
  const [amount, setAmount] = useState(
    existing
      ? formatBaseUnits(existing.amount.grossMinor, existing.amount.decimals, {
          grouping: false,
        })
      : defaults
        ? "10000"
        : "",
  );
  const [network, setNetwork] = useState<
    SecurityBountyTerms["amount"]["network"]
  >(existing?.amount.network ?? "base");
  const [commit, setCommit] = useState(
    existing?.scope.sourceRevisions[0]?.commit ??
      (defaults ? PLATFORM_BOUNTY_SOURCE_COMMIT : ""),
  );
  const [fundAfterApproval, setFundAfterApproval] = useState(
    existing?.fundingPolicy === "after-approval" || fullAward,
  );
  // A full-award program always funds approved awards after review.
  const afterApproval = fullAward || fundAfterApproval;
  const [awards, setAwards] = useState(
    existing?.capacity.awards === null || defaults
      ? ""
      : String(existing?.capacity.awards ?? 1),
  );
  const [response, setResponse] = useState(
    existing?.responseTargets ?? {
      acknowledgeHours: 24,
      triageBusinessDays: 3,
      updateIntervalDays: 7,
    },
  );
  const [text, setText] = useState<Record<TextField, string>>({
    includedAssets:
      existing?.scope.includedAssets.join("\n") ??
      defaults?.includedAssets.join("\n") ??
      "",
    excludedDependencies:
      existing?.scope.excludedDependencies.join("\n") ??
      defaults?.excludedDependencies.join("\n") ??
      "",
    testingPermission:
      existing?.scope.testingPermission ?? defaults?.testingPermission ?? "",
    severityRubric:
      existing?.scope.severityRubric ?? defaults?.severityRubric ?? "",
    lossDefinition:
      existing?.scope.lossDefinition ?? defaults?.lossDefinition ?? "",
    exhaustionRule:
      existing?.capacity.exhaustionRule ?? defaults?.exhaustionRule ?? "",
    dispute: existing?.dispute.process ?? defaults?.dispute ?? "",
    disclosure: existing?.disclosure ?? defaults?.disclosure ?? "",
    safeHarbor: existing?.safeHarbor ?? defaults?.safeHarbor ?? "",
  });
  const { busy, error, run } = useAction();
  const [reviewing, setReviewing] = useState(false);
  const preview = (() => {
    try {
      const precision = {
        decimals: existing?.amount.decimals ?? 6,
        currency: existing?.amount.currency ?? "USDC",
      } as const;
      const split = securityBountySplit(
        parseAssetAmount(amount, precision.decimals),
        programSplit,
      );
      return {
        gross: formatSecurityAmount(split.grossMinor, precision),
        researcher: formatSecurityAmount(split.researcherMinor, precision),
        slop: formatSecurityAmount(split.slopMinor, precision),
      };
    } catch {
      return null;
    }
  })();
  function proposedProgram(): SecurityBountyTerms {
    return {
      ...carriedSecurityTerms(existing, fullAward),
      ...(afterApproval ? { fundingPolicy: "after-approval" as const } : {}),
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
      split: { ...programSplit },
      sponsor:
        existing?.sponsor ??
        (platform
          ? { name: "slop.cash", githubId: project.steward.github.actorId }
          : { name: project.name, githubId: actor.githubId }),
      // The API replaces this with its finalized vault evidence.
      funding: existing?.funding ?? { state: "pledged" },
      capacity: {
        awards: afterApproval && awards === "" ? null : Number(awards),
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
        deployments:
          existing?.scope.deployments ??
          (defaults ? PLATFORM_BOUNTY_DEPLOYMENTS : []),
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
  }
  function publish() {
    void run(
      async () => {
        const program = proposedProgram();
        // Open status is authorized only by the API's current finalized balance.
        assertSecurityBountyTerms(
          { ...program, status: status === "open" ? "paused" : status },
          {
            projectId: project.id,
            repositories: project.repositories,
            reward: { ...project.reward },
          },
        );
        const result = await publishProjectRevision(
          project.id,
          { ...project, securityBounty: program },
          revision,
          "Update security bounty terms",
          null,
        );
        onPublished(result);
        setReviewing(false);
      },
      (cause) => {
        setReviewing(false);
        return errorMessage(cause, "Cannot publish the bounty terms. Retry.");
      },
    );
  }
  return (
    <section
      className="owner-section security-program-editor"
      aria-labelledby="owner-security-title"
    >
      <h2 id="owner-security-title">Security bounty</h2>
      <div className="owner-form">
        <p className="operations-muted">
          {fullAward
            ? "You decide each award. slop.cash sponsors this program, so the researcher receives the whole award and Slop takes no share."
            : "You decide each award: 75% to the researcher, 25% to Slop."}{" "}
          Changes apply to future reports only.
        </p>
        {existing && (
          <p>
            <Link href={`/projects/${project.slug}/security`}>
              View public terms
            </Link>{" "}
            · <Link href="/security">Open private cases</Link>
          </p>
        )}
        {!embedded && (
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
        )}
        {expanded && (
          <form
            id="owner-security-form"
            className="proposal-form"
            onInvalidCapture={(event) => {
              let group = (event.target as HTMLElement).closest("details");
              while (group) {
                group.open = true;
                group = group.parentElement?.closest("details") ?? null;
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              if (reviewing) publish();
              else
                void run(async () => {
                  const candidate = proposedProgram();
                  assertSecurityBountyTerms(
                    {
                      ...candidate,
                      status:
                        candidate.status === "open"
                          ? "paused"
                          : candidate.status,
                    },
                    {
                      projectId: project.id,
                      repositories: project.repositories,
                      reward: { ...project.reward },
                    },
                  );
                  setReviewing(true);
                });
            }}
          >
            <div hidden={reviewing}>
              <fieldset disabled={busy}>
                <legend>Offer</legend>
                <label htmlFor="bounty-status">Status</label>
                <select
                  id="bounty-status"
                  value={status}
                  onChange={(event) =>
                    setStatus(
                      event.target.value as SecurityBountyTerms["status"],
                    )
                  }
                >
                  {existing?.status === "draft" && (
                    <option value="draft">Draft</option>
                  )}
                  {existing?.status === "pending-approval" && (
                    <option value="pending-approval">Pending</option>
                  )}
                  <option value="paused">Paused</option>
                  <option value="open">Open</option>
                  <option value="closed">Closed</option>
                </select>
                {platform && (
                  <>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={fullAward}
                        disabled={!canChooseFullAward}
                        aria-describedby={
                          canChooseFullAward
                            ? undefined
                            : "bounty-full-award-vault"
                        }
                        onChange={(event) => setFullAward(event.target.checked)}
                      />
                      slop.cash sponsors the whole award (researcher 100%, Slop
                      0%)
                    </label>
                    {!canChooseFullAward && (
                      <p id="bounty-full-award-vault">
                        This program has a registered bounty vault, which pays
                        75/25 and keeps its network. The whole-award option
                        needs a program without a bounty vault.
                      </p>
                    )}
                  </>
                )}
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={afterApproval}
                    disabled={fullAward}
                    onChange={(event) =>
                      setFundAfterApproval(event.target.checked)
                    }
                  />
                  Fund approved awards after review
                </label>
                <p>
                  {afterApproval
                    ? "The offer may open before a deposit. It is a discretionary pledge; funds must be verified before an approved award can be reserved or paid."
                    : "Opening requires available funds in the bounty vault."}{" "}
                  Closing stops new paid reports only.
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
                {preview && (
                  <dl
                    className="owner-amount-split"
                    aria-label="Award split preview"
                  >
                    <div>
                      <dt>Gross award</dt>
                      <dd>{preview.gross}</dd>
                    </div>
                    <div>
                      <dt>Researcher · {fullAward ? "100%" : "75%"}</dt>
                      <dd>{preview.researcher}</dd>
                    </div>
                    <div>
                      <dt>Slop · {fullAward ? "0%" : "25%"}</dt>
                      <dd>{preview.slop}</dd>
                    </div>
                  </dl>
                )}
                <p>
                  A discretionary award, not a promised payment.
                  {fullAward &&
                    " An approved full award is not payable until a full-award payment path is approved and released."}
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
                  required={!afterApproval}
                  value={awards}
                  onChange={(event) => setAwards(event.target.value)}
                />
                {afterApproval && (
                  <p>
                    Leave blank to review each first qualifying finding
                    separately.
                  </p>
                )}
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
              {(
                [
                  [
                    "Scope and testing",
                    [
                      "includedAssets",
                      "excludedDependencies",
                      "testingPermission",
                    ],
                  ],
                  [
                    "Award criteria",
                    ["severityRubric", "lossDefinition", "exhaustionRule"],
                  ],
                  ["Researcher terms", ["dispute", "disclosure", "safeHarbor"]],
                ] as [string, TextField[]][]
              ).map(([title, keys]) => (
                <details className="proposal-advanced" key={title}>
                  <summary>{title}</summary>
                  <fieldset disabled={busy}>
                    <legend>{title}</legend>
                    {TEXT_FIELDS.filter(([key]) => keys.includes(key)).map(
                      ([key, label, help]) => (
                        <div className="form-field" key={key}>
                          <label htmlFor={`bounty-${key}`}>{label}</label>
                          {help ? (
                            <p id={`bounty-${key}-help`}>{help}</p>
                          ) : null}
                          <textarea
                            id={`bounty-${key}`}
                            aria-describedby={
                              help ? `bounty-${key}-help` : undefined
                            }
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
                      ),
                    )}
                  </fieldset>
                </details>
              ))}
              <details className="proposal-advanced">
                <summary>Response targets and contacts</summary>
                <fieldset disabled={busy}>
                  <legend>Response targets</legend>
                  {(
                    [
                      ["acknowledgeHours", "Acknowledge within (hours)", 336],
                      [
                        "triageBusinessDays",
                        "Triage within (business days)",
                        60,
                      ],
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
                  .
                </p>
              </details>
            </div>
            {reviewing ? (
              <section aria-label="Review bounty terms">
                <h3>Review before publishing</h3>
                <p>
                  Proposed status: {status}. Changes apply to future reports
                  only.
                </p>
                <SecurityOffer
                  project={{
                    securityBounty: { ...proposedProgram(), status: "open" },
                  }}
                />
                <dl className="admin-facts">
                  <div>
                    <dt>Covered revision</dt>
                    <dd>{commit}</dd>
                  </div>
                  <div>
                    <dt>Covered assets</dt>
                    <dd>{text.includedAssets}</dd>
                  </div>
                  <div>
                    <dt>Safe testing</dt>
                    <dd>{text.testingPermission}</dd>
                  </div>
                </dl>
                <button
                  className="button secondary-button"
                  type="button"
                  disabled={busy}
                  onClick={() => setReviewing(false)}
                >
                  Edit bounty terms
                </button>
              </section>
            ) : null}
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
              {busy
                ? "Publishing…"
                : reviewing
                  ? "Publish bounty terms"
                  : "Review bounty terms"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
