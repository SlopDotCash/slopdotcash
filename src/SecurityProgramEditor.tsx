import { useState } from "react";
import {
  RewardAssetFields,
  type RewardAssetSelection,
} from "./RewardAssetFields";
import { SecurityOffer } from "./SecurityOffer";
import "./operations-design.css";
import "./owner-review.css";
import { Link } from "./Link";
import { formatBaseUnits } from "./lib/base-units.mjs";
import { errorMessage } from "./lib/errors";
import { publishProjectRevision, type RevisionResult } from "./lib/project-api";
import type { GithubActor } from "./lib/project-contracts";
import { parseAssetAmount } from "./lib/project-schema.mjs";
import type { ProjectDefinition } from "./lib/projects.mjs";
import {
  assertSecurityBountyTerms,
  isFullAwardSplit,
  type SecurityBountyTerms,
} from "./lib/security-bounty.mjs";
import {
  bountyAmountFields,
  bountyAmountPreview,
} from "./lib/security-bounty-proposal";
import {
  carriedSecurityTerms,
  initialSecuritySplit,
} from "./lib/security-program-draft";
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
  const boundVault = Boolean(existing?.settlement?.deployments.length);
  const programSplit = initialSecuritySplit(existing);
  const fullAward = isFullAwardSplit(programSplit);
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
      : "",
  );
  const [assetChoice, setAssetChoice] = useState<RewardAssetSelection>(() => {
    const asset =
      existing?.amount.asset ?? (!existing ? project.rewardAsset : undefined);
    return {
      network: asset?.network ?? existing?.amount.network ?? "base",
      assetKind: asset?.kind ?? "stablecoin",
      tokenAddress: asset?.kind === "token" ? asset.address : "",
      tokenSymbol: asset?.kind === "token" ? asset.symbol : "",
    };
  });
  const [assetChanged, setAssetChanged] = useState(false);
  const [commit, setCommit] = useState(
    existing?.scope.sourceRevisions[0]?.commit ?? "",
  );
  const afterApproval =
    !existing || existing.fundingPolicy === "after-approval";
  const [awards, setAwards] = useState(
    existing?.capacity.awards === null
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
  const { busy, error, run } = useAction();
  const [reviewing, setReviewing] = useState(false);
  const amountCurrency = (() => {
    if (existing && !assetChanged) return existing.amount.currency;
    try {
      return bountyAmountFields({
        ...assetChoice,
        mode: "monthly",
        monthlyAmount: "4",
      }).currency;
    } catch {
      return assetChoice.tokenSymbol || "token";
    }
  })();
  function proposedAmount() {
    if (existing && !assetChanged)
      return {
        ...existing.amount,
        grossMinor: parseAssetAmount(amount, existing.amount.decimals),
      };
    return bountyAmountFields({
      ...assetChoice,
      mode: "monthly",
      monthlyAmount: amount,
    });
  }
  const preview = (() => {
    try {
      return bountyAmountPreview(proposedAmount(), amount, programSplit);
    } catch {
      return null;
    }
  })();
  function proposedProgram(): SecurityBountyTerms {
    return {
      ...carriedSecurityTerms(existing),
      ...(assetChanged && !boundVault ? { settlement: undefined } : {}),
      ...(afterApproval ? { fundingPolicy: "after-approval" as const } : {}),
      version: "1",
      status,
      rewardMode: existing?.rewardMode ?? "separate",
      eligibility: existing?.eligibility ?? "in-scope-security",
      // The API verifies a changed asset and resolves its precision on save.
      amount: proposedAmount() as SecurityBountyTerms["amount"],
      split: { ...programSplit },
      sponsor: existing?.sponsor ?? {
        name: project.name,
        githubId: actor.githubId,
      },
      funding: assetChanged
        ? { state: "pledged" }
        : (existing?.funding ?? { state: "pledged" }),
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
  }
  function validateProgram(program: SecurityBountyTerms) {
    if (!preview) throw new TypeError("Check the award amount and asset.");
    if (BigInt(parseAssetAmount(amount, program.amount.decimals)) === 0n)
      throw new TypeError("Enter an award greater than zero.");
    // Unverified choices are validated by the API after it reads metadata.
    if (!existing || assetChanged) return;
    assertSecurityBountyTerms(
      { ...program, status: status === "open" ? "paused" : status },
      {
        projectId: project.id,
        repositories: project.repositories,
        reward: { ...project.reward },
      },
    );
  }
  function publish() {
    void run(
      async () => {
        const program = proposedProgram();
        validateProgram(program);
        const result = await publishProjectRevision(
          project.id,
          { ...project, securityBounty: program },
          revision,
          "Update security bounty terms",
          null,
          program.amount.asset ? amount : null,
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
            ? "You decide each award. The researcher receives the whole award and Slop takes no share."
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
                  validateProgram(candidate);
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
                <label htmlFor="bounty-amount">
                  Published gross award ({amountCurrency})
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
                <p>A discretionary award, not a promised payment.</p>
                {existing?.amount.currency === "USD" &&
                !existing.amount.asset ? (
                  <p>USD</p>
                ) : (
                  <RewardAssetFields
                    compact
                    namePrefix="bounty"
                    choice={assetChoice}
                    error={() => undefined}
                    networkFixed={boundVault}
                    set={(field, value) => {
                      setAssetChanged(true);
                      setAssetChoice((previous) => ({
                        ...previous,
                        [field]: value,
                      }));
                    }}
                  />
                )}
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
                  amountPreview={preview ?? undefined}
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
