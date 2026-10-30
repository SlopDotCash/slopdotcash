import {
  ArrowLeft,
  ArrowRight,
  GitBranch,
  ListChecks,
  Settings2,
  Shield,
  Wallet,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChoiceField, SelectField, TextField } from "./ProjectFormFields";
import { ProjectImageField } from "./ProjectImageField";
import { RewardAssetFields } from "./RewardAssetFields";
import "./owner-review.css";
import "./project-setup.css";
import { EscrowFunding } from "./EscrowFunding";
import { GeneratedSkillPreview } from "./GeneratedSkillPreview";
import { Link } from "./Link";
import { formatBaseUnits } from "./lib/base-units.mjs";
import { loginHref } from "./lib/browser-deployment";
import {
  CONTRIBUTION_LABELS,
  SKILL_RULE_FIELDS,
  type SkillRuleField,
} from "./lib/contribution-fields";
import { errorMessage } from "./lib/errors";
import {
  ESCROW_PAYOUT_FEE_BASIS_POINTS,
  ESCROW_WITHDRAWAL_FEE_BASIS_POINTS,
} from "./lib/escrow-policy.mjs";
import { hasBountyOverview } from "./lib/home-projects";
import {
  createProject,
  ProjectApiError,
  type ProjectSessionState,
  projectApiRequest,
  publishProjectRevision,
  type RevisionResult,
  useProjectMaintainer,
  useProjectSession,
} from "./lib/project-api";
import {
  type OwnedRepository,
  type ProjectSetupStatus,
  SLOPBOT_INSTALL_URL,
  validRepositoryPath,
} from "./lib/project-contracts";
import {
  boundedText,
  type FundingChoice,
  formatMonthlyAmount,
  immutableProposalTermsUrl,
  listOwnedRepositories,
  lookupGitHubRepository,
  monthlyPoolValue,
  normalizeRepositoryInput,
  rewardFields,
  safeProposalHttpsUrl,
  slugify,
} from "./lib/project-proposal";
import { classifyRevisionChanges } from "./lib/project-revision-changes";
import {
  monthlyAmountDisplay,
  PROJECT_SKILL_TEMPLATES,
} from "./lib/project-schema.mjs";
import type { ProjectDefinition } from "./lib/projects.mjs";
import {
  NETWORK_NAMES,
  REWARD_ASSET_NETWORKS,
  type RewardAssetNetwork,
  rewardAssetChoice,
} from "./lib/reward-asset.mjs";
import {
  bountyAmountPreview,
  PRIVATE_BOUNTY_CRITERIA,
  PRIVATE_BOUNTY_DISCLOSURE,
  PRIVATE_BOUNTY_TESTING,
  privateBountyTerms,
} from "./lib/security-bounty-proposal";
import { ChangeReview } from "./OwnerPresentation";
import { PendingProjectApplications } from "./PendingProjectApplications";
import {
  Avatar,
  ProjectNav,
  RoutePageHeader,
  SignInPanel,
} from "./Presentation";
import { ProjectSetupStatusPanel } from "./ProjectSetupStatus";

const SETTLEMENT_CHAIN_NAMES: Record<string, string> = NETWORK_NAMES;
const PROPOSAL_DRAFT_KEY = "slop:project-proposal:v1";
const LEGACY_PROPOSAL_STEP_KEY = `${PROPOSAL_DRAFT_KEY}:step`;
const PROPOSAL_STEP_KEY = `${LEGACY_PROPOSAL_STEP_KEY}:v2`;
/**
 * The referrer named by a `?ref=<login>` link (PRJ-05). It is kept apart
 * from the draft so a resumed draft keeps it, and cleared after submission.
 */
const REFERRER_KEY = "slop:project-referrer:v1";
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
/** PRJ-03 default, shown as editable text the maintainer can replace. */
const DEFAULT_CRITERIA =
  "Merged pull requests that fix a reproduced bug or deliver a change the maintainers asked for, with tests or other evidence that the result works.";
const SETUP_STEPS = ["Project", "Rewards", "Review"] as const;

const EMPTY_PROPOSAL = {
  name: "",
  repository: "",
  repositoryNumericId: "",
  repositoryNodeId: "",
  integrationBranch: "main",
  sourceCommit: "",
  stewardKind: "organization",
  stewardLogin: "",
  stewardActorId: "",
  stewardNodeId: "",
  headline: "",
  image: "",
  goal: "",
  criteria: "",
  contributionGuide: "",
  supportedTasks: "",
  requiredTests: "",
  reviewExpectations: "",
  securityContact: "",
  closurePolicy: "",
  automaticClosure: "true",
  maintainerNotes: "",
  fundingMode: "none",
  monthlyPool: "",
  settlementChain: "base",
  rewardKind: "stablecoin",
  rewardAssetAddress: "",
  rewardAssetSymbol: "",
  copyrightModel: "unknown",
  legalHolder: "",
  licenseSpdx: "",
  licenseCommit: "",
  licenseDigest: "",
  inboundMode: "unknown",
  inboundTermsUrl: "",
  inboundCommit: "",
  inboundDigest: "",
  inboundVersion: "",
  inboundAcceptance: "",
  assignmentAssignee: "",
  assignmentUrl: "",
  assignmentDigest: "",
  assignmentVersion: "",
  assignmentSignedAt: "",
};
type Proposal = typeof EMPTY_PROPOSAL;
type ProposalField = keyof Proposal;
type FieldErrors = Partial<Record<ProposalField, string>>;

const FIELD_STEP: Partial<Record<ProposalField, number>> = {
  repository: 0,
  repositoryNumericId: 0,
  repositoryNodeId: 0,
  integrationBranch: 0,
  stewardLogin: 0,
  stewardActorId: 0,
  stewardNodeId: 0,
  licenseSpdx: 0,
  licenseCommit: 0,
  licenseDigest: 0,
  name: 0,
  image: 0,
  headline: 0,
  goal: 0,
  criteria: 0,
  contributionGuide: 0,
  supportedTasks: 0,
  requiredTests: 0,
  reviewExpectations: 0,
  securityContact: 0,
  closurePolicy: 0,
  maintainerNotes: 0,
  copyrightModel: 0,
  legalHolder: 0,
  inboundTermsUrl: 0,
  inboundCommit: 0,
  inboundDigest: 0,
  inboundVersion: 0,
  inboundAcceptance: 0,
  assignmentAssignee: 0,
  assignmentUrl: 0,
  assignmentDigest: 0,
  assignmentVersion: 0,
  assignmentSignedAt: 0,
  monthlyPool: 1,
  settlementChain: 1,
  rewardAssetAddress: 1,
  rewardAssetSymbol: 1,
};
const GIT_SHA = /^[0-9a-f]{40}$/u;
const FILE_DIGEST = /^[0-9a-f]{64}$/u;
const NUMERIC_ID = /^[1-9]\d{0,39}$/u;
const NODE_ID = /^[A-Za-z0-9_=-]{1,100}$/u;

function lengthError(
  value: string,
  minimum: number,
  maximum: number,
): string | undefined {
  return boundedText(value, minimum, maximum)
    ? undefined
    : `Enter ${minimum} to ${maximum} characters.`;
}

/** One validation source for the setup fields, navigation and submission. */
function proposalErrors(p: Proposal): FieldErrors {
  const errors: FieldErrors = {};
  if (!validRepositoryPath(p.repository))
    errors.repository = p.repository
      ? "Use owner/repository."
      : "Choose a repository.";
  if (
    !NUMERIC_ID.test(p.repositoryNumericId) ||
    !NODE_ID.test(p.repositoryNodeId) ||
    !GITHUB_LOGIN.test(p.stewardLogin) ||
    !NUMERIC_ID.test(p.stewardActorId) ||
    !NODE_ID.test(p.stewardNodeId)
  )
    errors.repository ??= "Wait for the repository to load.";
  if (
    p.integrationBranch.length > 255 ||
    !/^(?!.*(?:\.\.|\s|~|\^|:|\?|\*|\[|\\))[A-Za-z0-9._/-]+$/u.test(
      p.integrationBranch,
    )
  )
    errors.integrationBranch = "Enter a valid Git branch name.";
  const licenseEntered =
    p.licenseSpdx !== "" || p.licenseCommit !== "" || p.licenseDigest !== "";
  if (licenseEntered) {
    if (
      !/^[A-Za-z0-9-.+]{1,80}$/u.test(p.licenseSpdx) ||
      !GIT_SHA.test(p.licenseCommit) ||
      !FILE_DIGEST.test(p.licenseDigest)
    )
      errors.repository ??=
        "Look up the repository again to refresh its license.";
  }
  const name = lengthError(p.name, 2, 80);
  if (name) errors.name = name;
  const headline = lengthError(p.headline, 8, 120);
  if (headline) errors.headline = headline;
  const goal = lengthError(p.goal, 24, 600);
  if (goal) errors.goal = goal;
  const criteria = lengthError(p.criteria, 6, 2_000);
  if (criteria) errors.criteria = criteria;
  // The remaining skill fields are optional; empty defers to the repository.
  for (const field of SKILL_RULE_FIELDS) {
    const value = p[field];
    if (value.trim() !== "") {
      const error = lengthError(value, 1, 2_000);
      if (error) errors[field] = error;
    }
  }
  if (p.copyrightModel === "sponsor-owned") {
    const holder = lengthError(p.legalHolder, 2, 240);
    if (holder) errors.legalHolder = holder;
    if (p.stewardKind === "dao")
      errors.copyrightModel =
        "Sponsor-owned copyright is not available for a DAO steward. Choose another copyright model.";
  }
  if (p.inboundMode !== "unknown") {
    if (
      !immutableProposalTermsUrl(
        p.inboundTermsUrl,
        p.repository,
        p.inboundCommit,
      )
    )
      errors.inboundTermsUrl =
        "Use a github.com blob URL for this repository at the terms commit.";
    if (!GIT_SHA.test(p.inboundCommit))
      errors.inboundCommit = "Enter a 40-character commit SHA.";
    if (!FILE_DIGEST.test(p.inboundDigest))
      errors.inboundDigest = "Enter a 64-character SHA-256.";
    const version = lengthError(p.inboundVersion, 1, 80);
    if (version) errors.inboundVersion = version;
    const acceptance = lengthError(p.inboundAcceptance, 1, 240);
    if (acceptance) errors.inboundAcceptance = acceptance;
  }
  if (p.copyrightModel === "sponsor-owned" || p.inboundMode === "assignment") {
    const assignee = lengthError(p.assignmentAssignee, 2, 240);
    if (assignee) errors.assignmentAssignee = assignee;
    if (!safeProposalHttpsUrl(p.assignmentUrl))
      errors.assignmentUrl = "Enter an https URL.";
    if (!FILE_DIGEST.test(p.assignmentDigest))
      errors.assignmentDigest = "Enter a 64-character SHA-256.";
    const version = lengthError(p.assignmentVersion, 1, 80);
    if (version) errors.assignmentVersion = version;
    if (p.assignmentSignedAt.length === 0)
      errors.assignmentSignedAt = "Enter the signing date and time.";
  }
  if (
    ["monthly", "bounty"].includes(p.fundingMode) &&
    p.rewardKind === "token"
  ) {
    try {
      rewardAssetChoice(
        p.settlementChain,
        "token",
        p.rewardAssetAddress,
        p.rewardAssetSymbol,
      );
    } catch (error) {
      const message =
        error instanceof Error ? `${error.message}.` : "Check the token.";
      if (/symbol/iu.test(message)) errors.rewardAssetSymbol = message;
      else errors.rewardAssetAddress = message;
    }
  }
  if (["monthly", "bounty"].includes(p.fundingMode)) {
    if (!REWARD_ASSET_NETWORKS[p.settlementChain as RewardAssetNetwork])
      errors.settlementChain = "Choose a supported network.";
    const amount = monthlyPoolValue(
      p.monthlyPool,
      p.rewardKind === "token"
        ? { symbol: p.rewardAssetSymbol }
        : p.rewardKind === "native"
          ? REWARD_ASSET_NETWORKS[p.settlementChain as RewardAssetNetwork]
              ?.native
          : undefined,
    );
    if (!amount.valid) errors.monthlyPool = amount.error;
    else if (
      p.fundingMode === "bounty" &&
      p.rewardKind !== "token" &&
      BigInt(amount.minor) % 4n !== 0n
    )
      errors.monthlyPool = "Amount must split into whole token units.";
  }
  if (p.fundingMode === "bounty") {
    if (!GIT_SHA.test(p.sourceCommit))
      errors.integrationBranch = "Reload the repository to verify this branch.";
    if (p.criteria.trim().length < 12)
      errors.criteria = "Describe the accepted security finding.";
    if (p.requiredTests.trim() && p.requiredTests.trim().length < 12)
      errors.requiredTests = "Describe the safe testing rules.";
  }
  return errors;
}

/** The `?ref=` login from the current link, else the one stored earlier. */
function initialReferrer(): string | null {
  try {
    const fromLink = new URLSearchParams(window.location.search).get("ref");
    if (fromLink !== null) {
      const login = fromLink.trim();
      if (GITHUB_LOGIN.test(login)) {
        localStorage.setItem(REFERRER_KEY, login);
        return login;
      }
    }
    const stored = localStorage.getItem(REFERRER_KEY);
    return stored !== null && GITHUB_LOGIN.test(stored) ? stored : null;
  } catch {
    return null;
  }
}

function forgetReferrer() {
  try {
    localStorage.removeItem(REFERRER_KEY);
  } catch {
    // Nothing stored, or storage is unavailable; the page state is cleared.
  }
}

function readDraft(): Proposal | null {
  try {
    const stored = localStorage.getItem(PROPOSAL_DRAFT_KEY);
    if (!stored) return null;
    const value: unknown = JSON.parse(stored);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const draft = { ...EMPTY_PROPOSAL };
    for (const key of Object.keys(EMPTY_PROPOSAL) as ProposalField[]) {
      const entry = (value as Record<string, unknown>)[key];
      if (
        typeof entry === "string" &&
        entry.length <= (key === "image" ? 16_384 : 4_000)
      )
        draft[key] = entry;
    }
    return draft;
  } catch {
    return null;
  }
}

/** One repository control: account choices, with URL entry for other public repos. */
function RepositoryPicker({
  selected,
  onChoose,
  projectSession,
  error,
  retryLookup,
}: {
  selected: string;
  projectSession: ProjectSessionState;
  onChoose: (repository: string) => void;
  error?: string;
  retryLookup?: () => void;
}) {
  const login =
    projectSession.status === "signed-in"
      ? projectSession.session.githubLogin
      : null;
  const [attempt, setAttempt] = useState(0);
  const [manual, setManual] = useState(false);
  const [list, setList] = useState<
    | { status: "loading" }
    | { status: "ready"; repositories: OwnedRepository[] }
    | { status: "error"; message: string }
  >({ status: "loading" });
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt retries the inventory request.
  useEffect(() => {
    if (!login) return;
    const controller = new AbortController();
    setList({ status: "loading" });
    void listOwnedRepositories(controller.signal).then(
      (repositories) => {
        if (!controller.signal.aborted)
          setList({ status: "ready", repositories });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setList({
            status: "error",
            message: errorMessage(cause, "Repositories could not load."),
          });
      },
    );
    return () => controller.abort();
  }, [login, attempt]);
  if (!login)
    return (
      <div className="form-field">
        <span>GitHub repository</span>
        <a
          id="field-repository"
          className="button secondary-button"
          href={loginHref("/projects/new")}
        >
          {projectSession.status === "checking"
            ? "Checking sign-in…"
            : "Sign in with GitHub"}
        </a>
        {error ? (
          <small className="field-error" id="field-repository-error">
            {error}
          </small>
        ) : null}
      </div>
    );
  const repositories = list.status === "ready" ? list.repositories : [];
  const selectedOption =
    repositories.find(
      (entry) => entry.repository.toLowerCase() === selected.toLowerCase(),
    )?.repository ?? selected;
  return (
    <div className="setup-repository-picker">
      {manual ||
      list.status === "error" ||
      (list.status === "ready" && repositories.length === 0) ? (
        <div className="setup-repository-entry">
          <TextField
            label="GitHub repository"
            name="repository"
            value={selected}
            placeholder="owner/repository or GitHub URL"
            error={error}
            onChange={(value) => onChoose(normalizeRepositoryInput(value))}
          />
          {repositories.length > 0 ? (
            <button
              className="button ghost-button"
              type="button"
              aria-label="Choose from your repositories"
              onClick={() => {
                setManual(false);
                window.setTimeout(
                  () => document.getElementById("field-repository")?.focus(),
                  0,
                );
              }}
            >
              <ListChecks aria-hidden="true" size={20} />
            </button>
          ) : null}
        </div>
      ) : (
        <SelectField
          label="GitHub repository"
          name="repository"
          value={selectedOption}
          error={error}
          disabled={list.status === "loading"}
          options={[
            [
              "",
              list.status === "loading"
                ? "Loading repositories…"
                : "Choose a repository",
            ],
            ...(selectedOption &&
            !repositories.some((entry) => entry.repository === selectedOption)
              ? [[selectedOption, selectedOption] as [string, string]]
              : []),
            ...repositories.map((entry): [string, string] => [
              entry.repository,
              entry.repository,
            ]),
            ["__other", "Enter repository…"],
          ]}
          onChange={(value) => {
            if (value === "__other") {
              setManual(true);
              onChoose("");
              window.setTimeout(
                () => document.getElementById("field-repository")?.focus(),
                0,
              );
            } else onChoose(value);
          }}
        />
      )}
      {list.status === "error" ? (
        <small className="field-error">
          {list.message}{" "}
          <button
            type="button"
            className="text-button"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Retry repositories
          </button>
        </small>
      ) : null}
      {retryLookup ? (
        <button
          type="button"
          className="text-button setup-lookup-retry"
          onClick={retryLookup}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

/**
 * Reuses the page's project session. The API checks authority again on creation.
 */
function SubmitProject({
  onSubmit,
  submitting,
  projectSession,
}: {
  onSubmit: () => void;
  submitting: boolean;
  projectSession: ProjectSessionState;
}) {
  const login =
    projectSession.status === "signed-in"
      ? projectSession.session.githubLogin
      : null;
  return (
    <>
      {login ? (
        <button
          className="button primary-button"
          disabled={submitting}
          onClick={onSubmit}
          type="button"
        >
          {submitting ? "Creating…" : "Create project"}{" "}
          <ArrowRight aria-hidden="true" />
        </button>
      ) : projectSession.status === "checking" ? (
        <p className="proposal-note" role="status">
          Checking sign-in…
        </p>
      ) : (
        <a className="button primary-button" href={loginHref("/projects/new")}>
          Sign in with GitHub
        </a>
      )}
      {login ? <span className="setup-actor">@{login}</span> : null}
    </>
  );
}

function ClosureConsent({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  return (
    <div>
      <label className="checkbox-field">
        <input
          aria-describedby={compact ? undefined : "automatic-closure-hint"}
          checked={value === "true"}
          name="automaticClosure"
          onChange={(event) => onChange(String(event.currentTarget.checked))}
          type="checkbox"
        />{" "}
        {compact
          ? "Allow Slopbot to close Slop-skill PRs; authors can appeal."
          : "Allow automatic closure by Slopbot"}
      </label>
      {compact ? null : (
        <p className="field-hint" id="automatic-closure-hint">
          Only Slop-skill pull requests can be closed, and authors can appeal.
          You can turn this off at any time.
        </p>
      )}
    </div>
  );
}

/**
 * The one optional funding choice: none, or a monthly amount in one asset on
 * one network. Asset and vault details appear only after choosing an amount.
 */
function FundingFields({
  choice,
  set,
  error,
  networkFixed,
  compact = false,
  bounty = false,
  onBounty,
  networkError,
}: {
  choice: FundingChoice;
  set: (field: keyof FundingChoice, value: string) => void;
  error: (
    field: "monthlyAmount" | "tokenAddress" | "tokenSymbol",
  ) => string | undefined;
  /** A project with a vault keeps its network and asset. */
  networkFixed: boolean;
  compact?: boolean;
  bounty?: boolean;
  onBounty?: () => void;
  networkError?: string;
}) {
  const network =
    REWARD_ASSET_NETWORKS[choice.network as RewardAssetNetwork] ??
    REWARD_ASSET_NETWORKS.base;
  const symbol =
    choice.assetKind === "token"
      ? choice.tokenSymbol.trim() || "token"
      : choice.assetKind === "native"
        ? network.native.symbol
        : network.stablecoin.symbol;
  return (
    <>
      <fieldset className="funding-mode">
        <legend>
          {compact ? "Reward type" : "Monthly funding (optional)"}
        </legend>
        <label className="checkbox-field">
          <input
            checked={choice.mode === "none" && !bounty}
            name="fundingMode"
            onChange={() => set("mode", "none")}
            type="radio"
          />{" "}
          <span>
            {compact ? <ListChecks aria-hidden="true" size={20} /> : null}Points
            only
          </span>
        </label>
        <label className="checkbox-field">
          <input
            checked={choice.mode === "monthly" && !bounty}
            name="fundingMode"
            onChange={() => set("mode", "monthly")}
            type="radio"
          />{" "}
          <span>
            {compact ? <Wallet aria-hidden="true" size={20} /> : null}Monthly
            rewards
          </span>
        </label>
        {onBounty ? (
          <label className="checkbox-field">
            <input
              checked={bounty}
              name="fundingMode"
              onChange={onBounty}
              type="radio"
            />
            <span>
              <Shield aria-hidden="true" size={20} />
              Private bounty
            </span>
          </label>
        ) : null}
      </fieldset>
      {choice.mode === "none" && !bounty ? (
        compact ? null : (
          <p className="field-hint">Add funding later.</p>
        )
      ) : (
        <>
          <RewardAssetFields
            choice={choice}
            set={set}
            error={error}
            networkFixed={networkFixed}
            networkError={networkError}
            compact={compact}
          />
          <TextField
            error={error("monthlyAmount")}
            hint={
              compact
                ? undefined
                : "A pledge until deposited in the vault. Changes apply from the next UTC month."
            }
            inputMode="decimal"
            label={
              bounty
                ? `Award per accepted finding (${symbol})`
                : `Monthly amount (${symbol})`
            }
            name="monthlyPool"
            onChange={(value) => set("monthlyAmount", value)}
            value={choice.monthlyAmount}
          />
          {compact ? null : (
            <p className="fee-preview">
              Payout fee: {ESCROW_PAYOUT_FEE_BASIS_POINTS / 100}%. Unused-fund
              withdrawal fee: {ESCROW_WITHDRAWAL_FEE_BASIS_POINTS / 100}%.
            </p>
          )}
        </>
      )}
    </>
  );
}

export default function ProjectProposalPage() {
  const [sessionRevision, setSessionRevision] = useState(0);
  const projectSession = useProjectSession(sessionRevision);
  const [proposal, setProposal] = useState<Proposal>(
    () => readDraft() ?? EMPTY_PROPOSAL,
  );
  const [extraRuleFields, setExtraRuleFields] = useState(() =>
    SKILL_RULE_FIELDS.filter(
      (field) => field !== "requiredTests" && proposal[field] !== "",
    ),
  );
  const [referrer, setReferrer] = useState<string | null>(initialReferrer);
  const [step, setStep] = useState(() => {
    try {
      const stored = localStorage.getItem(PROPOSAL_STEP_KEY);
      const legacy = localStorage.getItem(LEGACY_PROPOSAL_STEP_KEY);
      const index =
        stored !== null
          ? Number(stored)
          : legacy !== null
            ? Math.max(0, Number(legacy) - 1)
            : 0;
      return readDraft() &&
        Number.isInteger(index) &&
        index >= 0 &&
        index < SETUP_STEPS.length
        ? index
        : 0;
    } catch {
      return 0;
    }
  });
  const [attempted, setAttempted] = useState<boolean[]>(
    SETUP_STEPS.map(() => false),
  );
  const [lookup, setLookup] = useState<{
    state: "idle" | "loading" | "done" | "error";
    message: string;
  }>({ state: "idle", message: "" });
  const [branchChoices, setBranchChoices] = useState<{
    repository: string;
    names: string[];
    commits: Record<string, string>;
  } | null>(null);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const resolvedRepository = useRef<{
    repository: string;
    attempt: number;
  } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const lookupController = useRef<AbortController | null>(null);
  const suggestedText = useRef({
    name: "",
    headline: "",
    goal: "",
    criteria: "",
  });
  useEffect(() => {
    try {
      localStorage.setItem(PROPOSAL_DRAFT_KEY, JSON.stringify(proposal));
      localStorage.setItem(PROPOSAL_STEP_KEY, String(step));
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }, [proposal, step]);
  // One cancellable lookup for new choices, pasted URLs and restored drafts.
  useEffect(() => {
    const repository = normalizeRepositoryInput(proposal.repository);
    const key = repository.toLowerCase();
    if (
      projectSession.status !== "signed-in" ||
      !validRepositoryPath(repository)
    ) {
      setLookup({ state: "idle", message: "" });
      return;
    }
    if (
      resolvedRepository.current?.repository === key &&
      resolvedRepository.current.attempt === lookupAttempt
    )
      return;
    const controller = new AbortController();
    lookupController.current = controller;
    setLookup({ state: "loading", message: "" });
    const timer = window.setTimeout(() => {
      void lookupGitHubRepository(repository, controller.signal).then(
        (facts) => {
          if (
            controller.signal.aborted ||
            lookupController.current !== controller
          )
            return;
          const description = facts.description ?? "";
          const suggested = {
            name: facts.repository.split("/")[1] ?? "",
            headline: boundedText(description, 8, 120) ? description : "",
            goal: boundedText(description, 24, 600) ? description : "",
            criteria: DEFAULT_CRITERIA,
          };
          const previous = suggestedText.current;
          const fill = (field: keyof typeof suggested, value: string) =>
            value === "" || value === previous[field]
              ? suggested[field]
              : value;
          resolvedRepository.current = {
            repository: facts.repository.toLowerCase(),
            attempt: lookupAttempt,
          };
          suggestedText.current = suggested;
          setBranchChoices({
            repository: facts.repository,
            names: facts.branches,
            commits: facts.branchCommits ?? {},
          });
          setProposal((current) => {
            if (
              normalizeRepositoryInput(current.repository).toLowerCase() !== key
            )
              return current;
            return {
              ...current,
              name: fill("name", current.name),
              headline: fill("headline", current.headline),
              goal: fill("goal", current.goal),
              criteria: fill("criteria", current.criteria),
              repository: facts.repository,
              repositoryNumericId: facts.numericId,
              repositoryNodeId: facts.nodeId,
              integrationBranch:
                current.repositoryNumericId === facts.numericId
                  ? current.integrationBranch
                  : facts.defaultBranch,
              sourceCommit:
                facts.branchCommits?.[
                  current.repositoryNumericId === facts.numericId
                    ? current.integrationBranch
                    : facts.defaultBranch
                ] ?? "",
              stewardKind: facts.owner.kind,
              stewardLogin: facts.owner.login,
              stewardActorId: facts.owner.actorId,
              stewardNodeId: facts.owner.nodeId,
              licenseSpdx:
                facts.license.state === "verified" ? facts.license.spdx : "",
              licenseCommit:
                facts.license.state === "verified"
                  ? facts.license.commitSha
                  : "",
              licenseDigest:
                facts.license.state === "verified"
                  ? facts.license.fileSha256
                  : "",
            };
          });
          setLookup({ state: "done", message: "" });
        },
        (cause: unknown) => {
          if (
            controller.signal.aborted ||
            lookupController.current !== controller
          )
            return;
          setLookup({
            state: "error",
            message: errorMessage(cause, "Repository could not load."),
          });
        },
      );
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [projectSession.status, proposal.repository, lookupAttempt]);
  const set = (field: ProposalField) => (value: string) => {
    if (field === "repository") {
      if (proposal.repository.toLowerCase() === value.toLowerCase()) return;
      lookupController.current?.abort();
      setLookup({ state: "idle", message: "" });
      if (proposal.repository !== value) {
        setBranchChoices(null);
        resolvedRepository.current = null;
        // Facts from another repository must never pair with this name.
        setProposal((current) => ({
          ...current,
          repository: value,
          repositoryNumericId: "",
          repositoryNodeId: "",
          integrationBranch: EMPTY_PROPOSAL.integrationBranch,
          sourceCommit: "",
          stewardKind: EMPTY_PROPOSAL.stewardKind,
          stewardLogin: "",
          stewardActorId: "",
          stewardNodeId: "",
          licenseSpdx: "",
          licenseCommit: "",
          licenseDigest: "",
        }));
        return;
      }
    }
    setProposal((current) => ({
      ...current,
      [field]: value,
      ...(field === "integrationBranch"
        ? { sourceCommit: branchChoices?.commits[value] ?? "" }
        : {}),
      ...(field === "fundingMode" && value === "bounty"
        ? {
            criteria:
              current.criteria === DEFAULT_CRITERIA
                ? PRIVATE_BOUNTY_CRITERIA
                : current.criteria,
            requiredTests: current.requiredTests || PRIVATE_BOUNTY_TESTING,
          }
        : {}),
      ...(field === "fundingMode" && value !== "bounty"
        ? {
            criteria:
              current.criteria === PRIVATE_BOUNTY_CRITERIA
                ? DEFAULT_CRITERIA
                : current.criteria,
            requiredTests:
              current.requiredTests === PRIVATE_BOUNTY_TESTING
                ? ""
                : current.requiredTests,
          }
        : {}),
    }));
  };
  const errors = useMemo(() => {
    const result = proposalErrors(proposal);
    if (lookup.state === "error") result.repository = lookup.message;
    if (
      proposal.repositoryNumericId &&
      (branchChoices?.repository !== proposal.repository ||
        !branchChoices.names.includes(proposal.integrationBranch))
    )
      result.integrationBranch =
        branchChoices?.repository === proposal.repository
          ? "Choose a repository branch."
          : "Wait for the repository branches to load.";
    return result;
  }, [proposal, branchChoices, lookup]);
  // Re-check earlier steps when restored GitHub facts arrive or a draft is
  // opened on a later step. A pending branch read is not a failed validation.
  const invalidPriorField = (Object.keys(errors) as ProposalField[]).find(
    (field) =>
      (FIELD_STEP[field] ?? step) < step &&
      !(
        field === "integrationBranch" &&
        proposal.repositoryNumericId &&
        branchChoices?.repository !== proposal.repository &&
        lookup.state !== "error"
      ),
  );
  useEffect(() => {
    if (!invalidPriorField) return;
    const owner = FIELD_STEP[invalidPriorField] ?? 0;
    setAttempted((current) =>
      current.map((value, index) => value || index === owner),
    );
    setStep(owner);
    window.setTimeout(() => {
      document.getElementById(`field-${invalidPriorField}`)?.focus();
    }, 0);
  }, [invalidPriorField]);
  const stepErrors = (index: number) =>
    Object.fromEntries(
      Object.entries(errors).filter(
        ([field]) => FIELD_STEP[field as ProposalField] === index,
      ),
    ) as FieldErrors;
  const shown = (field: ProposalField) => {
    const owner = FIELD_STEP[field];
    return owner !== undefined && (attempted[owner] || attempted[2])
      ? errors[field]
      : undefined;
  };
  const valid = Object.keys(errors).length === 0;
  const p = proposal;
  const branches =
    branchChoices?.repository === p.repository ? branchChoices.names : [];
  const slug =
    slugify(p.name) ||
    slugify(p.repository.split("/").at(-1) || "") ||
    "new-project";
  const pool = monthlyPoolValue(
    p.monthlyPool,
    p.rewardKind === "token"
      ? { symbol: p.rewardAssetSymbol }
      : p.rewardKind === "native"
        ? REWARD_ASSET_NETWORKS[p.settlementChain as RewardAssetNetwork]?.native
        : undefined,
  );
  const funding: FundingChoice = useMemo(
    () => ({
      mode: p.fundingMode === "monthly" ? "monthly" : "none",
      network: p.settlementChain,
      assetKind:
        p.rewardKind === "token"
          ? "token"
          : p.rewardKind === "native"
            ? "native"
            : "stablecoin",
      tokenAddress: p.rewardAssetAddress,
      tokenSymbol: p.rewardAssetSymbol,
      monthlyAmount: p.monthlyPool,
    }),
    [
      p.fundingMode,
      p.settlementChain,
      p.rewardKind,
      p.rewardAssetAddress,
      p.rewardAssetSymbol,
      p.monthlyPool,
    ],
  );
  const fundingSymbol =
    p.rewardKind === "token"
      ? p.rewardAssetSymbol.trim() || "token"
      : p.rewardKind === "native"
        ? (REWARD_ASSET_NETWORKS[p.settlementChain as RewardAssetNetwork]
            ?.native.symbol ?? REWARD_ASSET_NETWORKS.base.native.symbol)
        : (REWARD_ASSET_NETWORKS[p.settlementChain as RewardAssetNetwork]
            ?.stablecoin.symbol ?? "USDC");
  const manifest = useMemo(() => {
    const now = new Date();
    const repository = p.repository || "owner/repository";
    const bounty =
      p.fundingMode === "bounty" &&
      valid &&
      projectSession.status === "signed-in"
        ? privateBountyTerms({
            name: p.name,
            repository,
            commit: p.sourceCommit,
            scope: p.goal,
            criteria: p.criteria,
            testing: p.requiredTests,
            funding,
            actor: projectSession.session,
          })
        : undefined;
    return {
      schemaVersion: "1",
      id: slug,
      slug,
      name: p.name || "New project",
      eyebrow:
        p.fundingMode === "bounty"
          ? "Private security bounty"
          : "Open-source project",
      headline: p.headline || "Describe the project in one sentence.",
      ...(p.image ? { image: p.image } : {}),
      description: p.goal || "Describe the concrete open-source goal.",
      listingTier: "community",
      status: "paused",
      steward: {
        displayName: p.stewardLogin
          ? `@${p.stewardLogin}`
          : "Unverified steward",
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
        effectiveAt: now.toISOString(),
        paymentTransfersIp: false,
        retroactive: false,
        receiptPolicy: {
          state: "pending-authority-activation",
          activatedAt: null,
          bindings: [],
        },
        copyright: {
          model: p.copyrightModel,
          claimedLegalHolder:
            p.copyrightModel === "sponsor-owned" ? p.legalHolder || null : null,
          notice: null,
          legalCapacity: null,
          governanceResolution: null,
        },
        repositoryLicense:
          p.licenseSpdx || p.licenseCommit || p.licenseDigest
            ? {
                state: "verified",
                spdx: p.licenseSpdx,
                url: `https://github.com/${repository}/blob/${p.licenseCommit}/LICENSE`,
                commitSha: p.licenseCommit,
                fileSha256: p.licenseDigest,
              }
            : {
                state: "unknown",
                spdx: null,
                url: null,
                commitSha: null,
                fileSha256: null,
              },
        inbound: {
          mode: p.inboundMode,
          termsUrl: p.inboundMode === "unknown" ? null : p.inboundTermsUrl,
          commitSha: p.inboundMode === "unknown" ? null : p.inboundCommit,
          fileSha256: p.inboundMode === "unknown" ? null : p.inboundDigest,
          version: p.inboundMode === "unknown" ? null : p.inboundVersion,
          acceptance: p.inboundMode === "unknown" ? null : p.inboundAcceptance,
        },
        assignment:
          p.copyrightModel === "sponsor-owned" || p.inboundMode === "assignment"
            ? {
                assignee: p.assignmentAssignee,
                instrumentUrl: p.assignmentUrl,
                fileSha256: p.assignmentDigest,
                version: p.assignmentVersion,
                signedAt: p.assignmentSignedAt
                  ? new Date(p.assignmentSignedAt).toISOString()
                  : "",
              }
            : null,
        externalPrize: null,
      },
      repositories: [
        {
          id: repository,
          displayName: repository,
          githubUrl: `https://github.com/${repository}`,
          description: p.headline || "Describe the project in one sentence.",
          integrationBranch: p.integrationBranch,
        },
      ],
      // Slop generates both skills from the canonical templates and these
      // rules (PRD SKL-03), so no pull request adds a project skill.
      skill: {
        id: `contribute-to-${slug}`,
        publishAtRoot: false,
        sourcePath: PROJECT_SKILL_TEMPLATES.contributor,
        publicPath: `/projects/${slug}/skill.md`,
      },
      reviewSkill: {
        id: `review-${slug}-contributions`,
        sourcePath: PROJECT_SKILL_TEMPLATES.reviewer,
      },
      contribution: {
        approvedScope:
          p.criteria.trim() ||
          "Define exact accepted outcomes with the maintainer.",
        ...(Object.fromEntries(
          SKILL_RULE_FIELDS.map((field) => [field, p[field].trim()]),
        ) as Record<SkillRuleField, string>),
      },
      ...(p.automaticClosure === "true" && p.fundingMode !== "bounty"
        ? { slopbot: { automaticClosure: true } }
        : {}),
      // Optional funding: none, or one asset on one network with its vault
      // policy. The server verifies the asset and stores its decimals.
      ...rewardFields(
        REWARD_ASSET_NETWORKS[funding.network as RewardAssetNetwork]
          ? funding
          : { ...funding, mode: "none" },
        now,
      ),
      ...(bounty ? { securityBounty: bounty } : {}),
      funding: {
        mode: "direct-noncustodial",
        disclosure:
          "Funds go directly to the project wallet. Slop does not hold or recover funds.",
        recordsPath: `funding/${slug}`,
        addresses: [],
      },
      modelPolicy: {
        mode: "open-declared",
        disclosureRequired: true,
      },
      links: {
        repository: `https://github.com/${repository}`,
        issues: `https://github.com/${repository}/issues`,
      },
    };
  }, [p, slug, funding, projectSession, valid]);
  const bounty = manifest.securityBounty;
  const bountyAmounts = bounty
    ? bountyAmountPreview(bounty.amount, p.monthlyPool, bounty.split)
    : undefined;
  const [submission, setSubmission] = useState<
    | { status: "idle" | "submitting" }
    | { status: "error"; message: string; install: boolean }
    | {
        status: "submitted";
        projectId: string;
        setup: ProjectSetupStatus;
        referrer: string | null;
      }
  >({ status: "idle" });
  function clearReferrer() {
    forgetReferrer();
    setReferrer(null);
  }
  function submit() {
    if (!valid) {
      goTo(2);
      return;
    }
    setSubmission({ status: "submitting" });
    createProject(
      manifest as unknown as ProjectDefinition,
      referrer,
      funding.mode === "monthly" ? funding.monthlyAmount.trim() : null,
      p.fundingMode === "bounty" ? p.monthlyPool.trim() : null,
    ).then(
      ({ project, setup }) => {
        forgetReferrer();
        setSubmission({
          status: "submitted",
          projectId: project.id,
          setup,
          referrer,
        });
      },
      (error: unknown) =>
        setSubmission({
          status: "error",
          message: errorMessage(error, "The project was not created."),
          install:
            error instanceof ProjectApiError &&
            error.code === "slopbot_required",
        }),
    );
  }

  function goTo(index: number) {
    if (index > step || index === 2) {
      setAttempted((current) =>
        current.map((value, owner) => value || owner < index),
      );
      for (let owner = 0; owner < index; owner++) {
        const field = Object.keys(stepErrors(owner))[0] as
          | ProposalField
          | undefined;
        if (field) {
          focusField(field);
          return;
        }
      }
    }
    if (index === SETUP_STEPS.length - 1 && step !== index)
      setSessionRevision((current) => current + 1);
    setStep(index);
    window.setTimeout(() => {
      document.getElementById("proposal-step-heading")?.focus();
    }, 0);
  }
  function next() {
    goTo(step + 1);
  }
  function focusField(field: ProposalField) {
    const owner = FIELD_STEP[field] ?? step;
    setStep(owner);
    window.setTimeout(() => {
      const target =
        owner === 0 && !p.repositoryNumericId ? "repository" : field;
      document.getElementById(`field-${target}`)?.focus();
    });
  }
  function clearDraft() {
    if (submission.status === "submitting") return;
    lookupController.current?.abort();
    setProposal(EMPTY_PROPOSAL);
    setExtraRuleFields([]);
    setSubmission({ status: "idle" });
    suggestedText.current = { name: "", headline: "", goal: "", criteria: "" };
    setAttempted(SETUP_STEPS.map(() => false));
    setLookup({ state: "idle", message: "" });
    setBranchChoices(null);
    resolvedRepository.current = null;
    setStep(0);
  }
  const licenseKnown = p.licenseSpdx !== "" && !errors.repository;
  const draftNote = saveFailed ? (
    <p className="field-error" role="alert">
      Draft could not save. Keep this page open.
    </p>
  ) : null;
  const navigation = (
    <div className="wizard-actions">
      {step > 0 ? (
        <button
          className="button secondary-button"
          onClick={() => goTo(step - 1)}
          type="button"
        >
          <ArrowLeft aria-hidden="true" /> Back
        </button>
      ) : null}
      {step < SETUP_STEPS.length - 1 ? (
        <button className="button primary-button" onClick={next} type="button">
          Next: {SETUP_STEPS[step + 1]} <ArrowRight aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
  useEffect(() => {
    if (submission.status === "submitted")
      document.getElementById("project-created-heading")?.focus();
  }, [submission.status]);
  if (submission.status === "submitted")
    return (
      <main className="shell route-main proposal-page setup-compact">
        <h1 id="project-created-heading" tabIndex={-1}>
          Project created
        </h1>
        <ProjectSetupStatusPanel
          compact
          initial={submission.setup}
          projectId={submission.projectId}
          showProjectLink={false}
        />
        {submission.referrer ? (
          <p className="proposal-note">Referred by @{submission.referrer}.</p>
        ) : null}
        <div className="wizard-actions">
          {/* Reload the registry so these routes can resolve the new project. */}
          <a
            className="button primary-button"
            href={`/projects/${submission.projectId}`}
          >
            View project
          </a>
          <a
            className="button secondary-button"
            href={`/projects/${submission.projectId}/manage`}
          >
            Manage project
          </a>
          <button
            className="button ghost-button"
            onClick={() => {
              clearDraft();
              clearReferrer();
            }}
            type="button"
          >
            Add another project
          </button>
        </div>
      </main>
    );
  return (
    <main className="shell route-main proposal-page setup-compact">
      <p className="breadcrumb">
        <Link href="/">Projects</Link>
      </p>
      <RoutePageHeader title="Add a project" />
      <PendingProjectApplications projectSession={projectSession} />
      <nav aria-label="Setup steps">
        <ol className="proposal-steps">
          {SETUP_STEPS.map((label, index) => {
            return (
              <li key={label}>
                <button
                  aria-current={step === index ? "step" : undefined}
                  onClick={() => goTo(index)}
                  type="button"
                >
                  <span className="setup-step-number" aria-hidden="true">
                    {index + 1}
                  </span>
                  <span>{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      <form
        className="proposal-form"
        noValidate
        onSubmit={(event) => event.preventDefault()}
      >
        <h2
          className="visually-hidden"
          id="proposal-step-heading"
          tabIndex={-1}
        >
          {SETUP_STEPS[step]}
        </h2>
        {step === 0 ? (
          <div className="setup-source-grid">
            <RepositoryPicker
              projectSession={projectSession}
              onChoose={set("repository")}
              selected={p.repository}
              error={
                shown("repository") ??
                (lookup.state === "error" ? lookup.message : undefined)
              }
              retryLookup={
                lookup.state === "error"
                  ? () => setLookupAttempt((value) => value + 1)
                  : undefined
              }
            />
            <SelectField
              error={
                branches.length > 0 ? shown("integrationBranch") : undefined
              }
              label="Integration branch"
              name="integrationBranch"
              onChange={set("integrationBranch")}
              disabled={branches.length === 0}
              options={
                branches.length > 0
                  ? [
                      ...(branches.includes(p.integrationBranch)
                        ? []
                        : [["", "Select a branch"] as [string, string]]),
                      ...branches.map((branch): [string, string] => [
                        branch,
                        branch,
                      ]),
                    ]
                  : [
                      [
                        "",
                        lookup.state === "loading"
                          ? "Loading branches…"
                          : "Choose a repository",
                      ],
                    ]
              }
              value={
                branches.includes(p.integrationBranch)
                  ? p.integrationBranch
                  : ""
              }
            />
          </div>
        ) : null}
        {step === 0 ? (
          <>
            <div className="setup-project-identity">
              <ProjectImageField
                compact
                ownerLogin={p.stewardLogin}
                value={p.image}
                onChange={set("image")}
              />
              <TextField
                error={shown("name")}
                label="Project name"
                name="name"
                onChange={set("name")}
                value={p.name}
              />
            </div>
            <TextField
              error={shown("headline")}
              label="Short description"
              name="headline"
              onChange={set("headline")}
              value={p.headline}
            />
            <TextField
              error={shown("goal")}
              label="Goal"
              multiline
              name="goal"
              onChange={set("goal")}
              value={p.goal}
            />
            <TextField
              error={shown("criteria")}
              label="Acceptance criteria"
              multiline
              name="criteria"
              onChange={set("criteria")}
              value={p.criteria}
            />
            <div className="setup-rule-grid">
              {["requiredTests" as const, ...extraRuleFields].map((field) => (
                <TextField
                  error={shown(field)}
                  key={field}
                  label={CONTRIBUTION_LABELS[field].label}
                  multiline
                  name={field}
                  onChange={set(field)}
                  value={p[field]}
                />
              ))}
            </div>
            {p.fundingMode === "bounty" ? null : (
              <ClosureConsent
                compact
                onChange={set("automaticClosure")}
                value={p.automaticClosure}
              />
            )}
            {p.copyrightModel !== "unknown" || p.inboundMode !== "unknown" ? (
              <section className="setup-legal" aria-label="Saved legal terms">
                <ChoiceField
                  error={shown("copyrightModel")}
                  label="Copyright model"
                  name="copyrightModel"
                  onChange={set("copyrightModel")}
                  options={[
                    ["unknown", "Unknown"],
                    ["mixed", "Mixed"],
                    ["contributor-retained", "Contributor retained"],
                    ["sponsor-owned", "Sponsor owned"],
                  ]}
                  value={p.copyrightModel}
                />
                {p.copyrightModel === "sponsor-owned" ? (
                  <TextField
                    error={shown("legalHolder")}
                    label="Exact legal copyright holder"
                    name="legalHolder"
                    onChange={set("legalHolder")}
                    value={p.legalHolder}
                  />
                ) : null}
                <ChoiceField
                  label="Inbound contribution terms"
                  name="inboundMode"
                  onChange={set("inboundMode")}
                  options={[
                    ["unknown", "Unknown"],
                    ["license", "License"],
                    ["cla", "CLA"],
                    ["assignment", "Assignment"],
                    ["dco", "DCO"],
                    ["mixed", "Mixed"],
                  ]}
                  value={p.inboundMode}
                />
                {p.inboundMode !== "unknown" ? (
                  <>
                    <TextField
                      error={shown("inboundTermsUrl")}
                      label="Immutable terms URL"
                      name="inboundTermsUrl"
                      onChange={set("inboundTermsUrl")}
                      value={p.inboundTermsUrl}
                    />
                    <TextField
                      error={shown("inboundCommit")}
                      label="Terms commit SHA"
                      name="inboundCommit"
                      onChange={set("inboundCommit")}
                      value={p.inboundCommit}
                    />
                    <TextField
                      error={shown("inboundDigest")}
                      label="Terms SHA-256"
                      name="inboundDigest"
                      onChange={set("inboundDigest")}
                      value={p.inboundDigest}
                    />
                    <TextField
                      error={shown("inboundVersion")}
                      label="Terms version"
                      name="inboundVersion"
                      onChange={set("inboundVersion")}
                      value={p.inboundVersion}
                    />
                    <TextField
                      error={shown("inboundAcceptance")}
                      label="Acceptance mechanism"
                      name="inboundAcceptance"
                      onChange={set("inboundAcceptance")}
                      value={p.inboundAcceptance}
                    />
                  </>
                ) : null}
                {p.copyrightModel === "sponsor-owned" ||
                p.inboundMode === "assignment" ? (
                  <>
                    <TextField
                      error={shown("assignmentAssignee")}
                      label="Assignment assignee"
                      name="assignmentAssignee"
                      onChange={set("assignmentAssignee")}
                      value={p.assignmentAssignee}
                    />
                    <TextField
                      error={shown("assignmentUrl")}
                      label="Signed instrument URL"
                      name="assignmentUrl"
                      onChange={set("assignmentUrl")}
                      value={p.assignmentUrl}
                    />
                    <TextField
                      error={shown("assignmentDigest")}
                      label="Instrument SHA-256"
                      name="assignmentDigest"
                      onChange={set("assignmentDigest")}
                      value={p.assignmentDigest}
                    />
                    <TextField
                      error={shown("assignmentVersion")}
                      label="Instrument version"
                      name="assignmentVersion"
                      onChange={set("assignmentVersion")}
                      value={p.assignmentVersion}
                    />
                    <TextField
                      error={shown("assignmentSignedAt")}
                      label="Signed at"
                      name="assignmentSignedAt"
                      onChange={set("assignmentSignedAt")}
                      type="datetime-local"
                      value={p.assignmentSignedAt}
                    />
                  </>
                ) : null}
              </section>
            ) : null}
          </>
        ) : null}
        {step === 1 ? (
          <FundingFields
            compact
            bounty={p.fundingMode === "bounty"}
            onBounty={() => set("fundingMode")("bounty")}
            networkError={shown("settlementChain")}
            choice={funding}
            error={(field) =>
              shown(
                field === "monthlyAmount"
                  ? "monthlyPool"
                  : field === "tokenAddress"
                    ? "rewardAssetAddress"
                    : "rewardAssetSymbol",
              )
            }
            networkFixed={false}
            set={(field, value) =>
              set(
                (
                  {
                    mode: "fundingMode",
                    network: "settlementChain",
                    assetKind: "rewardKind",
                    tokenAddress: "rewardAssetAddress",
                    tokenSymbol: "rewardAssetSymbol",
                    monthlyAmount: "monthlyPool",
                  } as const
                )[field],
              )(value)
            }
          />
        ) : null}
        {step === 2 ? (
          <>
            <article className="proposal-preview" aria-label="Listing preview">
              <div className="setup-review-heading">
                {p.image ? (
                  <img src={p.image} alt="" width={48} height={48} />
                ) : p.stewardLogin ? (
                  <Avatar
                    actor={{
                      login: p.stewardLogin,
                      avatarUrl: `https://avatars.githubusercontent.com/${encodeURIComponent(p.stewardLogin)}?size=128`,
                    }}
                  />
                ) : (
                  <GitBranch size={28} aria-hidden="true" />
                )}
                <h3>{p.name || "Unnamed project"}</h3>
              </div>
              <p>{p.headline || "No short description yet."}</p>
              <dl>
                <div>
                  <dt>Before you create</dt>
                  <dd>
                    Install Slopbot on {p.repository || "the repository"}.
                  </dd>
                </div>
                {p.fundingMode === "bounty" ? null : (
                  <div>
                    <dt>Slopbot automatic closure</dt>
                    <dd>
                      {p.automaticClosure === "true"
                        ? "Allowed"
                        : "Not allowed"}
                    </dd>
                  </div>
                )}
                <div>
                  <dt>{bounty ? "Private bounty" : "Monthly funding"}</dt>
                  <dd>
                    {bounty && bountyAmounts
                      ? `${bountyAmounts.gross} per accepted finding · pledge`
                      : p.fundingMode !== "monthly"
                        ? "None"
                        : pool.valid
                          ? `${p.rewardKind === "token" || p.rewardKind === "native" ? pool.display : formatMonthlyAmount(pool.minor, 6, fundingSymbol)} on ${SETTLEMENT_CHAIN_NAMES[p.settlementChain] ?? p.settlementChain} · pledge`
                          : "Invalid"}
                  </dd>
                </div>
                {bounty && bountyAmounts ? (
                  <div>
                    <dt>Researcher / Slop</dt>
                    <dd>
                      {bountyAmounts.researcher} / {bountyAmounts.slop}
                    </dd>
                  </div>
                ) : null}
                {p.fundingMode === "monthly" ? (
                  <div>
                    <dt>Fees</dt>
                    <dd>2% of ordinary awards and unused-fund withdrawals.</dd>
                  </div>
                ) : null}
                {referrer ? (
                  <div>
                    <dt>Referred by</dt>
                    <dd>
                      @{referrer}{" "}
                      <button
                        className="text-button"
                        onClick={clearReferrer}
                        type="button"
                      >
                        Clear referral
                      </button>
                    </dd>
                  </div>
                ) : null}
              </dl>
              <div className="setup-review-facts">
                <dl>
                  <div>
                    <dt>Repository</dt>
                    <dd>
                      {p.repository || "Not set"} · {p.integrationBranch}
                    </dd>
                  </div>
                  <div>
                    <dt>Steward</dt>
                    <dd>{p.stewardLogin ? `@${p.stewardLogin}` : "Not set"}</dd>
                  </div>
                  <div>
                    <dt>License</dt>
                    <dd>{licenseKnown ? p.licenseSpdx : "Unknown"}</dd>
                  </div>
                  <div>
                    <dt>Copyright</dt>
                    <dd>{p.copyrightModel.replaceAll("-", " ")}</dd>
                  </div>
                </dl>
                <p>{p.goal || "No goal yet."}</p>
                {bounty ? (
                  <>
                    <p>{p.criteria}</p>
                    <p>{p.requiredTests || PRIVATE_BOUNTY_TESTING}</p>
                    <p>{PRIVATE_BOUNTY_DISCLOSURE}</p>
                  </>
                ) : null}
              </div>
            </article>
            {valid ? (
              <GeneratedSkillPreview manifest={manifest} draft compact />
            ) : null}
            {valid ? (
              <div className="handoff-actions">
                <SubmitProject
                  projectSession={projectSession}
                  onSubmit={submit}
                  submitting={submission.status === "submitting"}
                />
                {submission.status === "error" ? (
                  <p className="form-error" role="alert">
                    {submission.message}
                    {submission.install ? (
                      <>
                        {" "}
                        <a href={SLOPBOT_INSTALL_URL}>Install Slopbot</a>
                      </>
                    ) : null}
                  </p>
                ) : null}
                {draftNote}
              </div>
            ) : (
              draftNote
            )}
          </>
        ) : null}
        {navigation}
      </form>
    </main>
  );
}

type UpdateDraft = {
  image: string;
  automaticClosure: string;
  headline: string;
  goal: string;
  criteria: string;
  note: string;
  fundingMode: string;
  network: string;
  assetKind: string;
  tokenAddress: string;
  tokenSymbol: string;
  monthlyAmount: string;
} & Record<SkillRuleField, string>;

const DRAFT_FIELDS = [
  "image",
  "automaticClosure",
  "headline",
  "goal",
  "criteria",
  ...SKILL_RULE_FIELDS,
  "fundingMode",
  "network",
  "assetKind",
  "tokenAddress",
  "tokenSymbol",
  "monthlyAmount",
  "note",
] as const;

/**
 * Owners publish project changes directly (PRD section 4). The page edits the
 * current D1 revision, keeps the draft on this device, and shows each change
 * with what it needs: presentation and admitted-repository contribution rules
 * publish at once, and a funding change applies from the next calendar
 * month. A draft saved against an older revision must be confirmed against
 * the current one, and the server refuses a stale base revision.
 */
export function ProjectUpdatePage({ project }: { project: ProjectDefinition }) {
  const { allowed, checking, session, error, retry } = useProjectMaintainer(
    project.id,
  );
  if (!allowed)
    return (
      <main className="shell route-main manage-page">
        <RoutePageHeader title="Project settings" />
        <ProjectNav project={project} current="settings" />
        {checking ? (
          <p role="status">Checking access…</p>
        ) : session.status === "signed-out" || session.status === "error" ? (
          <SignInPanel
            state={session}
            next={`/projects/${project.slug}/manage`}
            purpose="Sign in with a maintainer account to change project settings."
          />
        ) : error ? (
          <div role="alert">
            <p>{error}</p>
            <button
              className="button secondary-button"
              type="button"
              onClick={retry}
            >
              Retry access check
            </button>
          </div>
        ) : (
          <p role="status">
            Project settings are available only to this project's maintainers.
          </p>
        )}
      </main>
    );
  return <ProjectUpdateForm project={project} />;
}

function ProjectUpdateForm({ project }: { project: ProjectDefinition }) {
  const session = useProjectSession();
  const [base, setBase] = useState<{
    revision: number;
    project: ProjectDefinition;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  // PRD section 8: admission or an exemption permits routine skill edits
  // without a new scan, so the change list must not say that they pause.
  const [setupStatus, setSetupStatus] = useState<ProjectSetupStatus | null>(
    null,
  );
  const scanCleared = setupStatus?.checks.scan.state === "cleared";
  const [submission, setSubmission] = useState<
    | { state: "idle" | "publishing" }
    | { state: "error"; message: string; staleRevision: boolean }
    | { state: "published"; result: RevisionResult }
  >({ state: "idle" });
  useEffect(() => {
    let active = true;
    setLoadError(null);
    projectApiRequest<{ revision: number; project: ProjectDefinition }>(
      "GET",
      `projects/${encodeURIComponent(project.id)}?reload=${reload}`,
    ).then(
      (body) => {
        if (active) setBase({ revision: body.revision, project: body.project });
      },
      (error) => {
        if (active)
          setLoadError(
            errorMessage(error, "Cannot read the current revision."),
          );
      },
    );
    return () => {
      active = false;
    };
  }, [project.id, reload]);
  const current = base?.project ?? project;
  const bountyOnly = hasBountyOverview(current);
  const reward = current.reward;
  const monthly = reward.kind === "monthly-pool";
  const capMinor = monthly ? reward.monthlyCapMinor : "0";
  // Amounts are stored in the asset's base units (owner decision D11).
  const decimals = current.rewardAsset?.decimals ?? 6;
  const assetFixed =
    monthly &&
    (reward.fundingState === "committed" ||
      reward.paymentMode === "enabled" ||
      BigInt(reward.committedMinor) > 0n ||
      (current.escrow?.deployments.length ?? 0) > 0);
  const initial: UpdateDraft = {
    automaticClosure: String(current.slopbot?.automaticClosure === true),
    headline: current.headline,
    image: current.image ?? "",
    goal: current.description,
    criteria: current.contribution?.approvedScope ?? "",
    note: "",
    fundingMode: capMinor === "0" ? "none" : "monthly",
    network: current.rewardAsset?.network ?? String(reward.chain ?? "base"),
    assetKind: current.rewardAsset?.kind ?? "stablecoin",
    tokenAddress:
      current.rewardAsset?.kind === "token" ? current.rewardAsset.address : "",
    tokenSymbol:
      current.rewardAsset?.kind === "token" ? current.rewardAsset.symbol : "",
    monthlyAmount:
      capMinor === "0"
        ? ""
        : formatBaseUnits(capMinor, decimals, { grouping: false }),
    ...(Object.fromEntries(
      SKILL_RULE_FIELDS.map((field) => [
        field,
        current.contribution?.[field] ?? "",
      ]),
    ) as Record<SkillRuleField, string>),
  };
  const key = `slop:project-update:v2:${project.id}`;
  const [saved] = useState(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
      return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  });
  const [draft, setDraft] = useState<Partial<UpdateDraft> | null>(() =>
    saved
      ? Object.fromEntries(
          DRAFT_FIELDS.filter(
            (field) =>
              typeof saved[field] === "string" &&
              (saved[field] as string).length <=
                (field === "image" ? 16_384 : 4_000),
          ).map((field) => [field, saved[field]]),
        )
      : null,
  );
  const [draftRevision, setDraftRevision] = useState<number | null>(
    saved
      ? typeof saved.baseRevision === "number"
        ? saved.baseRevision
        : -1
      : null,
  );
  // The draft the user last typed, including edits made while a publish
  // request is in flight. Compared on success so those edits survive.
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    try {
      if (draft === null) localStorage.removeItem(key);
      else
        localStorage.setItem(
          key,
          JSON.stringify({
            ...draft,
            baseRevision: draftRevision ?? base?.revision ?? null,
          }),
        );
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }, [draft, key, draftRevision, base?.revision]);
  const value: UpdateDraft = { ...initial, ...(draft ?? {}) };
  const staleDraft =
    base !== null &&
    draft !== null &&
    draftRevision !== null &&
    draftRevision !== base.revision;
  const [attempted, setAttempted] = useState(false);
  const set = (field: keyof UpdateDraft) => (next: string) => {
    if (draft === null) setDraftRevision(base?.revision ?? null);
    setDraft((existing) => ({ ...(existing ?? {}), [field]: next }));
  };
  // A legacy project needs an explicit funding choice to initialize a vault.
  // Editing only its text must preserve its existing funding and fee terms.
  const assetTouched =
    (!current.escrow && draft?.fundingMode === "monthly") ||
    (draft !== null &&
      (["network", "assetKind", "tokenAddress", "tokenSymbol"] as const).some(
        (field) =>
          draft[field] !== undefined && draft[field] !== initial[field],
      ));
  const amount = monthlyPoolValue(
    value.monthlyAmount,
    value.assetKind === "token"
      ? {
          symbol: value.tokenSymbol,
          ...(assetFixed || !assetTouched ? { decimals } : {}),
        }
      : value.assetKind === "native"
        ? REWARD_ASSET_NETWORKS[value.network as RewardAssetNetwork]?.native
        : undefined,
  );
  const amountMinor = amount.valid ? amount.minor : null;
  const errors: Record<string, string | undefined> = {
    headline: lengthError(value.headline, 8, 120),
    goal: lengthError(value.goal, 24, 600),
    criteria: lengthError(value.criteria, 6, 2_000),
    note:
      value.note.trim() === "" ? undefined : lengthError(value.note, 1, 500),
    monthlyAmount:
      !bountyOnly && value.fundingMode === "monthly" && !amount.valid
        ? amount.error
        : undefined,
    ...Object.fromEntries(
      SKILL_RULE_FIELDS.map((field) => [
        field,
        value[field].trim() === ""
          ? undefined
          : lengthError(value[field], 1, 2_000),
      ]),
    ),
  };
  const choice: FundingChoice = {
    mode: value.fundingMode === "monthly" ? "monthly" : "none",
    network: value.network,
    assetKind:
      value.assetKind === "token"
        ? "token"
        : value.assetKind === "native"
          ? "native"
          : "stablecoin",
    tokenAddress: value.tokenAddress,
    tokenSymbol: value.tokenSymbol,
    monthlyAmount: value.monthlyAmount,
  };
  if (
    !bountyOnly &&
    choice.mode === "monthly" &&
    !assetFixed &&
    choice.assetKind === "token"
  ) {
    try {
      rewardAssetChoice(
        choice.network,
        "token",
        choice.tokenAddress,
        choice.tokenSymbol,
      );
    } catch (error) {
      errors.tokenAddress =
        error instanceof Error ? `${error.message}.` : "Check the token.";
    }
  }
  /** The submitted manifest: the current revision with the owner's edits. */
  const next = ((): ProjectDefinition => {
    const source = current;
    let fundingFields: Record<string, unknown> = {};
    if (!bountyOnly && source.reward.kind === "monthly-pool") {
      // In the current asset's base units. The server converts the amount
      // again from `monthlyAmount` with the decimals it verified.
      const monthlyCapMinor =
        choice.mode === "monthly" && amountMinor !== null ? amountMinor : "0";
      const cap = {
        monthlyCapMinor,
        monthlyCapDisplay: monthlyAmountDisplay(
          monthlyCapMinor,
          source.rewardAsset,
        ),
      };
      if (assetFixed || choice.mode === "none" || !assetTouched) {
        // The asset, network and vault stay; only the amount changes.
        fundingFields = { reward: { ...source.reward, ...cap } };
      } else {
        const fields = rewardFields(choice, new Date());
        fundingFields = {
          ...fields,
          reward: {
            ...source.reward,
            ...(fields.reward as Record<string, unknown>),
            rewardStartAt: source.reward.rewardStartAt,
          },
        };
      }
    }
    return {
      ...source,
      ...fundingFields,
      ...(source.slopbot !== undefined || value.automaticClosure === "true"
        ? { slopbot: { automaticClosure: value.automaticClosure === "true" } }
        : {}),
      image: value.image || undefined,
      headline: value.headline.trim(),
      description: value.goal.trim(),
      contribution: {
        ...(source.contribution ?? {}),
        approvedScope: value.criteria.trim(),
        ...Object.fromEntries(
          SKILL_RULE_FIELDS.map((field) => [field, value[field].trim()]),
        ),
      },
    } as unknown as ProjectDefinition;
  })();
  const changes = classifyRevisionChanges(current, next);
  const changed =
    changes.presentation.length +
      changes.executable.length +
      changes.financial.length >
    0;
  const fundingText = (minor: string, digits: number, symbol: string) =>
    minor === "0"
      ? "No monthly funding"
      : formatMonthlyAmount(minor, digits, symbol);
  const diff = [
    {
      field: "vault",
      label: "Vault setup",
      before: current.escrow ? "Enabled" : "Not enabled",
      after: next.escrow ? "Enabled" : "Not enabled",
    },
    {
      field: "slopbot",
      label: "Slopbot automatic closure",
      before:
        current.slopbot?.automaticClosure === true ? "Allowed" : "Not allowed",
      after:
        next.slopbot?.automaticClosure === true ? "Allowed" : "Not allowed",
    },
    ...(current.image !== next.image
      ? [
          {
            field: "image",
            label: "Project image",
            before: current.image
              ? "Current custom image"
              : "GitHub owner avatar",
            after: next.image ? "New custom image" : "GitHub owner avatar",
          },
        ]
      : []),
    {
      field: "headline",
      label: "Short description",
      before: current.headline,
      after: next.headline,
    },
    {
      field: "description",
      label: "Goal",
      before: current.description,
      after: next.description,
    },
    {
      field: "approvedScope",
      label: "Acceptance criteria",
      before: current.contribution?.approvedScope ?? "",
      after: next.contribution?.approvedScope ?? "",
    },
    ...SKILL_RULE_FIELDS.map((field) => ({
      field,
      label: CONTRIBUTION_LABELS[field].label,
      before: current.contribution?.[field] ?? "",
      after: next.contribution?.[field] ?? "",
    })),
    ...(!bountyOnly &&
    current.reward.kind === "monthly-pool" &&
    next.reward.kind === "monthly-pool"
      ? [
          {
            field: "monthly",
            label: "Monthly funding",
            before: fundingText(
              current.reward.monthlyCapMinor,
              decimals,
              String(current.reward.currency),
            ),
            // The typed amount, in whole units of the chosen asset.
            after:
              choice.mode === "monthly" && amount.valid
                ? choice.assetKind === "token" || choice.assetKind === "native"
                  ? amount.display
                  : formatMonthlyAmount(
                      amount.minor,
                      6,
                      String(next.reward.currency),
                    )
                : "No monthly funding",
          },
        ]
      : []),
  ].filter((change) => change.before !== change.after);
  const valid = Object.values(errors).every((error) => !error);
  const shown = (field: string) => (attempted ? errors[field] : undefined);
  async function publish() {
    setAttempted(true);
    if (!valid) {
      const fieldNames: Record<string, string> = {
        monthlyAmount: "monthlyPool",
        tokenAddress: "rewardAssetAddress",
        tokenSymbol: "rewardAssetSymbol",
      };
      for (const [field, error] of Object.entries(errors)) {
        if (!error) continue;
        let group = document
          .getElementById(`field-${fieldNames[field] ?? field}`)
          ?.closest("details");
        while (group) {
          group.open = true;
          group = group.parentElement?.closest("details") ?? null;
        }
      }
      return;
    }
    if (!changed || base === null || staleDraft) return;
    const submittedDraft = draft;
    setSubmission({ state: "publishing" });
    try {
      const result = await publishProjectRevision(
        project.id,
        next,
        base.revision,
        "",
        !bountyOnly && choice.mode === "monthly" && changes.financial.length > 0
          ? value.monthlyAmount.trim()
          : null,
      );
      // The response is the published revision. Use it before allowing the
      // next edit; a later GET would make a fast new draft appear stale.
      setBase({
        revision: result.project.revision,
        project: result.project.manifest,
      });
      setSubmission({ state: "published", result });
      // Edits typed while the request was in flight are not part of what was
      // published; keep them as the new draft, rebased on the new revision.
      // Only clear when nothing changed since the request went out.
      const editedDuringSave = latestDraft.current !== submittedDraft;
      setDraft(editedDuringSave ? latestDraft.current : null);
      setDraftRevision(editedDuringSave ? result.project.revision : null);
      setAttempted(false);
    } catch (error) {
      setSubmission({
        state: "error",
        staleRevision:
          error instanceof ProjectApiError && error.code === "stale_revision",
        message: errorMessage(error, "Changes were not published."),
      });
    }
  }
  const nextMonth = new Date();
  nextMonth.setUTCDate(1);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const nextCycle = nextMonth.toISOString().slice(0, 7);
  return (
    <main className="shell route-main manage-page">
      <p className="breadcrumb">
        <Link href={`/projects/${project.slug}`}>{project.name}</Link>
      </p>
      <RoutePageHeader icon={<Settings2 />} title="Manage project" />
      <ProjectNav project={project} current="settings" />
      {session.status === "signed-in" ? (
        <ProjectSetupStatusPanel
          key={
            submission.state === "published"
              ? `revision-${submission.result.project.revision}`
              : "initial"
          }
          initial={
            submission.state === "published"
              ? submission.result.setup
              : undefined
          }
          onSetup={setSetupStatus}
          projectId={project.id}
          showProjectLink={false}
        />
      ) : null}
      <form
        className="proposal-form"
        noValidate
        onSubmit={(event) => event.preventDefault()}
      >
        <details className="proposal-advanced" open>
          <summary>Project listing</summary>
          <ProjectImageField value={value.image} onChange={set("image")} />
          <TextField
            error={shown("headline")}
            label="Short description"
            name="headline"
            onChange={set("headline")}
            value={value.headline}
          />
          <TextField
            error={shown("goal")}
            label="Goal"
            multiline
            name="goal"
            onChange={set("goal")}
            value={value.goal}
          />
        </details>
        <details className="proposal-advanced">
          <summary>Contribution rules</summary>
          <TextField
            error={shown("criteria")}
            label="Acceptance criteria"
            multiline
            name="criteria"
            onChange={set("criteria")}
            placeholder="What accepted GitHub outcomes qualify?"
            value={value.criteria}
          />
          <ClosureConsent
            onChange={set("automaticClosure")}
            value={value.automaticClosure}
          />
          <details className="proposal-skill-rules">
            <summary>Contributor instructions</summary>
            <p className="field-hint">
              These cannot override Slop's safety rules.
            </p>
            {SKILL_RULE_FIELDS.map((field) => (
              <TextField
                error={shown(field)}
                key={field}
                label={CONTRIBUTION_LABELS[field].label}
                multiline
                name={field}
                onChange={set(field)}
                placeholder={CONTRIBUTION_LABELS[field].placeholder}
                value={value[field]}
              />
            ))}
          </details>
        </details>
        {monthly && !bountyOnly ? (
          <details className="proposal-advanced">
            <summary>Monthly rewards</summary>
            <FundingFields
              choice={choice}
              error={(field) =>
                shown(
                  field === "monthlyAmount" ? "monthlyAmount" : "tokenAddress",
                )
              }
              networkFixed={assetFixed}
              set={(field, entry) =>
                set(
                  (
                    {
                      mode: "fundingMode",
                      network: "network",
                      assetKind: "assetKind",
                      tokenAddress: "tokenAddress",
                      tokenSymbol: "tokenSymbol",
                      monthlyAmount: "monthlyAmount",
                    } as const
                  )[field],
                )(entry)
              }
            />
          </details>
        ) : null}
        {monthly &&
        !bountyOnly &&
        choice.mode === "monthly" &&
        !current.escrow &&
        !assetTouched ? (
          <div>
            <p className="field-hint">
              Keeps this amount and asset. Publish this change to begin vault
              setup.
            </p>
            <button
              className="button secondary-button"
              onClick={() => set("fundingMode")("monthly")}
              type="button"
            >
              Enable vault setup
            </button>
          </div>
        ) : null}
        {staleDraft ? (
          <div role="alert" className="form-error">
            <p>
              This draft was saved against{" "}
              {draftRevision === -1
                ? "an unknown revision"
                : `revision ${draftRevision}`}
              . The current revision is {base?.revision}. Review the changes
              below.
            </p>
            <button
              type="button"
              className="button secondary-button"
              onClick={() => setDraftRevision(base?.revision ?? null)}
            >
              Use this draft
            </button>
            <button
              type="button"
              className="button secondary-button"
              onClick={() => {
                setDraft(null);
                setDraftRevision(null);
                setAttempted(false);
                setSubmission({ state: "idle" });
              }}
            >
              Discard draft
            </button>
          </div>
        ) : null}
        {changed ? (
          <section aria-labelledby="update-changes" className="update-changes">
            <h2 id="update-changes">Changes</h2>
            <ul>
              {changes.presentation.length > 0 ||
              (scanCleared && changes.executable.length > 0) ? (
                <li>
                  Presentation and cleared contribution changes publish now.
                </li>
              ) : null}
              {!scanCleared && changes.executable.length > 0 ? (
                <li>
                  Contribution changes need a new security scan.{" "}
                  {current.status === "active"
                    ? "The project pauses and goes live again when the scan passes."
                    : "The project goes live when the scan passes."}
                </li>
              ) : null}
              {changes.financial.length > 0 ? (
                <li>
                  Financial changes apply from {nextCycle} (UTC). Funded awards
                  keep their terms.
                </li>
              ) : null}
            </ul>
            {diff.map((change) => (
              <ChangeReview
                key={change.field}
                label={change.label}
                before={change.before || "Not set"}
                after={change.after || "Not set"}
              />
            ))}
          </section>
        ) : null}
        {attempted && (!valid || !changed) ? (
          <p className="form-error" role="alert">
            {changed
              ? "Fix the marked fields."
              : "Change at least one field before you publish."}
          </p>
        ) : null}
        {loadError ? (
          <div role="alert" className="form-error">
            <p>{loadError}</p>
          </div>
        ) : null}
        <div className="handoff-actions">
          <button
            className="button primary-button"
            disabled={
              submission.state === "publishing" || base === null || staleDraft
            }
            onClick={() => void publish()}
            type="button"
          >
            {submission.state === "publishing"
              ? "Publishing…"
              : "Publish changes"}
          </button>
          {submission.state === "error" ? (
            <p className="form-error" role="alert">
              {submission.message}{" "}
              {submission.staleRevision && (
                <button
                  className="text-button"
                  onClick={() => setReload((count) => count + 1)}
                  type="button"
                >
                  Reload
                </button>
              )}
            </p>
          ) : submission.state === "published" ? (
            <p role="status">
              Published revision {submission.result.project.revision}.
              {!hasBountyOverview(submission.result.project.manifest) &&
              submission.result.project.manifest.escrow &&
              submission.result.project.manifest.escrow.deployments.length ===
                0 ? (
                <>
                  {" "}
                  <a href="#project-vault">Set up vault</a>
                </>
              ) : null}
            </p>
          ) : null}
          <p className="proposal-note">
            {saveFailed
              ? "This browser cannot save the draft."
              : "Draft saved on this device."}
          </p>
        </div>
      </form>
      {!bountyOnly &&
      current.escrow &&
      current.reward.kind !== "external-prize-share" ? (
        <div id="project-vault">
          <EscrowFunding
            project={current}
            onRegistered={() => setReload((count) => count + 1)}
          />
        </div>
      ) : null}
      <p id="security-settings">
        <Link href={`/projects/${current.slug}/security#security-settings`}>
          Manage security bounty
        </Link>
      </p>
      {!monthly && !bountyOnly ? (
        <section aria-labelledby="update-payouts" className="owner-section">
          <h2 id="update-payouts">Payouts</h2>
          <p className="payout-status">
            External award. Slop publishes contribution shares only.
          </p>
        </section>
      ) : null}
    </main>
  );
}
