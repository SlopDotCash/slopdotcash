import {
  ArrowLeft,
  ArrowRight,
  GitBranch,
  ListChecks,
  Settings2,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ProjectImageField } from "./ProjectImageField";
import "./owner-review.css";
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
import {
  createProject,
  listProjectSetup,
  ProjectApiError,
  type ProjectApplication,
  type ProjectSessionState,
  type ProjectSummary,
  projectApiRequest,
  publishProjectRevision,
  publishStoredApplication,
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
import { ChangeReview } from "./OwnerPresentation";
import { ProjectNav, RoutePageHeader, SignInPanel } from "./Presentation";
import { ProjectSetupStatusPanel } from "./ProjectSetupStatus";

const SETTLEMENT_CHAIN_NAMES: Record<string, string> = NETWORK_NAMES;
const PROPOSAL_DRAFT_KEY = "slop:project-proposal:v1";
const PROPOSAL_STEP_KEY = `${PROPOSAL_DRAFT_KEY}:step`;
/**
 * The referrer named by a `?ref=<login>` link (PRJ-05). It is kept apart
 * from the draft so a resumed draft keeps it, and cleared after submission.
 */
const REFERRER_KEY = "slop:project-referrer:v1";
const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u;
/** PRJ-03 default, shown as editable text the maintainer can replace. */
const DEFAULT_CRITERIA =
  "Merged pull requests that fix a reproduced bug or deliver a change the maintainers asked for, with tests or other evidence that the result works.";
const SETUP_STEPS = [
  "Repository",
  "Contribution rules",
  "Rewards",
  "Review",
] as const;

const EMPTY_PROPOSAL = {
  name: "",
  repository: "",
  repositoryNumericId: "",
  repositoryNodeId: "",
  integrationBranch: "main",
  stewardName: "",
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
  automaticClosure: "false",
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
  stewardName: 0,
  stewardLogin: 0,
  stewardActorId: 0,
  stewardNodeId: 0,
  licenseSpdx: 0,
  licenseCommit: 0,
  licenseDigest: 0,
  name: 1,
  image: 1,
  headline: 1,
  goal: 1,
  criteria: 1,
  contributionGuide: 1,
  supportedTasks: 1,
  requiredTests: 1,
  reviewExpectations: 1,
  securityContact: 1,
  closurePolicy: 1,
  maintainerNotes: 1,
  copyrightModel: 1,
  legalHolder: 1,
  inboundTermsUrl: 1,
  inboundCommit: 1,
  inboundDigest: 1,
  inboundVersion: 1,
  inboundAcceptance: 1,
  assignmentAssignee: 1,
  assignmentUrl: 1,
  assignmentDigest: 1,
  assignmentVersion: 1,
  assignmentSignedAt: 1,
  monthlyPool: 2,
  rewardAssetAddress: 2,
  rewardAssetSymbol: 2,
};
const FIELD_LABELS: Partial<Record<ProposalField, string>> = {
  contributionGuide: "Contribution guide",
  supportedTasks: "Supported tasks",
  requiredTests: "Required tests",
  reviewExpectations: "Review expectations",
  securityContact: "Security contact",
  closurePolicy: "Closure policy",
  maintainerNotes: "Maintainer notes",
  repository: "Public GitHub repository",
  repositoryNumericId: "Repository numeric ID",
  repositoryNodeId: "Repository node ID",
  integrationBranch: "Integration branch",
  stewardName: "Steward display name",
  stewardLogin: "Steward GitHub login",
  stewardActorId: "Steward numeric actor ID",
  stewardNodeId: "Steward actor node ID",
  licenseSpdx: "License SPDX",
  licenseCommit: "LICENSE commit SHA",
  licenseDigest: "LICENSE SHA-256",
  name: "Project name",
  headline: "Short description",
  goal: "Goal",
  criteria: "Acceptance criteria",
  copyrightModel: "Copyright model",
  legalHolder: "Exact legal copyright holder",
  inboundTermsUrl: "Immutable terms URL",
  inboundCommit: "Terms commit SHA",
  inboundDigest: "Terms SHA-256",
  inboundVersion: "Terms version",
  inboundAcceptance: "Acceptance mechanism",
  assignmentAssignee: "Assignment assignee",
  assignmentUrl: "Signed instrument URL",
  assignmentDigest: "Instrument SHA-256",
  assignmentVersion: "Instrument version",
  assignmentSignedAt: "Signed at",
  monthlyPool: "Monthly amount",
  rewardAssetAddress: "Token address",
  rewardAssetSymbol: "Token symbol",
};

const TERMS_FIELDS = new Set<string>([
  "copyrightModel",
  "legalHolder",
  "inboundTermsUrl",
  "inboundCommit",
  "inboundDigest",
  "inboundVersion",
  "inboundAcceptance",
  "assignmentAssignee",
  "assignmentUrl",
  "assignmentDigest",
  "assignmentVersion",
  "assignmentSignedAt",
]);
const isTermsField = (field: string) => TERMS_FIELDS.has(field);

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

/** One validation source for the setup wizard, its summary and its handoff. */
function proposalErrors(p: Proposal): FieldErrors {
  const errors: FieldErrors = {};
  if (!validRepositoryPath(p.repository))
    errors.repository = "Use owner/name, for example SlopDotCash/slopdotcash.";
  if (!NUMERIC_ID.test(p.repositoryNumericId))
    errors.repositoryNumericId =
      "Look up the repository, or enter its numeric GitHub ID.";
  if (!NODE_ID.test(p.repositoryNodeId))
    errors.repositoryNodeId =
      "Look up the repository, or enter its GitHub node ID.";
  if (
    p.integrationBranch.length > 255 ||
    !/^(?!.*(?:\.\.|\s|~|\^|:|\?|\*|\[|\\))[A-Za-z0-9._/-]+$/u.test(
      p.integrationBranch,
    )
  )
    errors.integrationBranch = "Enter a valid Git branch name.";
  const stewardName = lengthError(p.stewardName, 2, 120);
  if (stewardName) errors.stewardName = stewardName;
  if (!GITHUB_LOGIN.test(p.stewardLogin))
    errors.stewardLogin = "Enter a GitHub login.";
  if (!NUMERIC_ID.test(p.stewardActorId))
    errors.stewardActorId = "Enter the steward's numeric GitHub ID.";
  if (!NODE_ID.test(p.stewardNodeId))
    errors.stewardNodeId = "Enter the steward's GitHub node ID.";
  const licenseEntered =
    p.licenseSpdx !== "" || p.licenseCommit !== "" || p.licenseDigest !== "";
  if (licenseEntered) {
    if (!/^[A-Za-z0-9-.+]{1,80}$/u.test(p.licenseSpdx))
      errors.licenseSpdx = "Enter an SPDX ID, or clear all license facts.";
    if (!GIT_SHA.test(p.licenseCommit))
      errors.licenseCommit = "Enter a 40-character commit SHA.";
    if (!FILE_DIGEST.test(p.licenseDigest))
      errors.licenseDigest = "Enter a 64-character SHA-256.";
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
  if (p.fundingMode === "monthly" && p.rewardKind === "token") {
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
  if (p.fundingMode === "monthly") {
    const amount = monthlyPoolValue(
      p.monthlyPool,
      p.rewardKind === "token" ? { symbol: p.rewardAssetSymbol } : undefined,
    );
    if (!amount.valid) errors.monthlyPool = amount.error;
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

function TextField({
  label,
  name,
  value,
  error,
  hint,
  multiline = false,
  onChange,
  ...input
}: {
  label: string;
  name: string;
  value: string;
  error?: string;
  hint?: ReactNode;
  multiline?: boolean;
  onChange: (value: string) => void;
  inputMode?: "decimal" | "numeric";
  placeholder?: string;
  type?: string;
}) {
  const id = `field-${name}`;
  const described = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""]
    .filter(Boolean)
    .join(" ");
  const shared = {
    "aria-describedby": described || undefined,
    "aria-invalid": error ? true : undefined,
    id,
    name,
    value,
  };
  return (
    <div
      className={`form-field${!multiline && ["name", "stewardName", "stewardLogin", "integrationBranch", "licenseSpdx", "rewardAssetSymbol", "monthlyPool"].includes(name) ? " field-compact" : ""}${error ? " form-field-invalid" : ""}`}
    >
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          {...shared}
          onChange={(event) => onChange(event.target.value)}
          placeholder={input.placeholder}
        />
      ) : (
        <input
          {...shared}
          {...input}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {hint ? (
        <small className="field-hint" id={`${id}-hint`}>
          {hint}
        </small>
      ) : null}
      {error ? (
        <small className="field-error" id={`${id}-error`}>
          {error}
        </small>
      ) : null}
    </div>
  );
}

function SelectField({
  label,
  name,
  value,
  error,
  options,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  error?: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  const id = `field-${name}`;
  return (
    <div
      className={`form-field field-compact${error ? " form-field-invalid" : ""}`}
    >
      <label htmlFor={id}>{label}</label>
      <select
        aria-describedby={error ? `${id}-error` : undefined}
        aria-invalid={error ? true : undefined}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
      {error ? (
        <small className="field-error" id={`${id}-error`}>
          {error}
        </small>
      ) : null}
    </div>
  );
}

function ErrorSummary({
  errors,
  onSelect,
}: {
  errors: FieldErrors;
  onSelect: (field: ProposalField) => void;
}) {
  const entries = Object.entries(errors) as [ProposalField, string][];
  if (entries.length === 0) return null;
  return (
    <div className="form-error-summary" role="alert" tabIndex={-1}>
      <strong>
        Fix {entries.length} field{entries.length === 1 ? "" : "s"} to continue.
      </strong>
      <ul>
        {entries.map(([field, message]) => (
          <li key={field}>
            <button onClick={() => onSelect(field)} type="button">
              {FIELD_LABELS[field] ?? field}
            </button>
            : {message}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * After GitHub sign-in, lists the repositories the account owns so the
 * maintainer picks one instead of typing owner/name. Manual entry stays
 * available for organization repositories and signed-out visitors.
 */
function RepositoryPicker({
  selected,
  onChoose,
  projectSession,
}: {
  selected: string;
  projectSession: ProjectSessionState;
  onChoose: (repository: string) => void;
}) {
  const login =
    projectSession.status === "signed-in"
      ? projectSession.session.githubLogin
      : null;
  const session = projectSession.status;
  const [attempt, setAttempt] = useState(0);
  const [list, setList] = useState<
    | { status: "loading" }
    | { status: "ready"; repositories: OwnedRepository[] }
    | { status: "error"; message: string }
  >({ status: "loading" });
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries a failed repository request.
  useEffect(() => {
    if (!login) return;
    const controller = new AbortController();
    setList({ status: "loading" });
    void listOwnedRepositories(controller.signal).then(
      (repositories) => {
        if (!controller.signal.aborted)
          setList({ status: "ready", repositories });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setList({
            status: "error",
            message: errorMessage(
              error,
              "Your repositories could not be loaded.",
            ),
          });
      },
    );
    return () => controller.abort();
  }, [login, attempt]);
  if (session === "checking")
    return (
      <p className="repository-picker-status" role="status">
        Checking sign-in…
      </p>
    );
  if (!login)
    return (
      <div className="repository-picker-signin">
        <a
          className="button secondary-button"
          href={loginHref("/projects/new")}
        >
          Sign in with GitHub
        </a>
        <p className="repository-picker-status">
          {session === "error" ? "We couldn’t check your session. " : ""}
          Or enter the repository below.
        </p>
      </div>
    );
  if (list.status === "loading")
    return (
      <p className="repository-picker-status" role="status">
        Loading your repositories…
      </p>
    );
  if (list.status === "error")
    return (
      <p className="repository-picker-status field-error" role="status">
        {list.message}{" "}
        <button
          type="button"
          className="text-button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Retry
        </button>{" "}
        Or enter the repository below.
      </p>
    );
  if (list.repositories.length === 0)
    return (
      <p className="repository-picker-status" role="status">
        @{login} owns no public repositories. Enter one below.
      </p>
    );
  const value = list.repositories.some((entry) => entry.repository === selected)
    ? selected
    : "";
  return (
    <div className="form-field">
      <label htmlFor="field-ownedRepository">Your repositories</label>
      <select
        aria-describedby="field-ownedRepository-hint"
        id="field-ownedRepository"
        onChange={(event) => {
          if (event.target.value) onChoose(event.target.value);
        }}
        value={value}
      >
        <option value="">Choose a repository</option>
        {list.repositories.map((entry) => (
          <option key={entry.repository} value={entry.repository}>
            {entry.repository}
          </option>
        ))}
      </select>
      <small className="field-hint" id="field-ownedRepository-hint">
        For an organization repository, enter it below.
      </small>
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
      {login ? <p>Creating as @{login}.</p> : null}
    </>
  );
}

function ClosureConsent({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="checkbox-field">
        <input
          aria-describedby="automatic-closure-hint"
          checked={value === "true"}
          name="automaticClosure"
          onChange={(event) => onChange(String(event.currentTarget.checked))}
          type="checkbox"
        />{" "}
        Allow automatic closure by Slopbot
      </label>
      <p className="field-hint" id="automatic-closure-hint">
        Only Slop-skill pull requests can be closed, and authors can appeal. You
        can turn this off at any time.
      </p>
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
}: {
  choice: FundingChoice;
  set: (field: keyof FundingChoice, value: string) => void;
  error: (
    field: "monthlyAmount" | "tokenAddress" | "tokenSymbol",
  ) => string | undefined;
  /** A project with a vault keeps its network and asset. */
  networkFixed: boolean;
}) {
  const network =
    REWARD_ASSET_NETWORKS[choice.network as RewardAssetNetwork] ??
    REWARD_ASSET_NETWORKS.base;
  const symbol =
    choice.assetKind === "token"
      ? choice.tokenSymbol.trim() || "token"
      : network.stablecoin.symbol;
  return (
    <>
      <fieldset className="funding-mode">
        <legend>Monthly funding (optional)</legend>
        <label className="checkbox-field">
          <input
            checked={choice.mode === "none"}
            name="fundingMode"
            onChange={() => set("mode", "none")}
            type="radio"
          />{" "}
          Points only
        </label>
        <label className="checkbox-field">
          <input
            checked={choice.mode === "monthly"}
            name="fundingMode"
            onChange={() => set("mode", "monthly")}
            type="radio"
          />{" "}
          Monthly rewards
        </label>
      </fieldset>
      {choice.mode === "none" ? (
        <p className="field-hint">Add funding later.</p>
      ) : (
        <>
          {networkFixed ? (
            <p className="field-hint">
              Paid in {symbol} on {network.name} (fixed by the vault).
            </p>
          ) : (
            <>
              <SelectField
                label="Network"
                name="settlementChain"
                onChange={(value) => set("network", value)}
                options={Object.entries(SETTLEMENT_CHAIN_NAMES)}
                value={choice.network}
              />
              <SelectField
                label="Asset"
                name="rewardKind"
                onChange={(value) => set("assetKind", value)}
                options={[
                  [
                    "stablecoin",
                    `${network.stablecoin.symbol} (network stablecoin)`,
                  ],
                  ["token", "Another token"],
                ]}
                value={choice.assetKind}
              />
              {choice.assetKind === "token" ? (
                <>
                  <TextField
                    error={error("tokenAddress")}
                    hint={
                      network.family === "evm"
                        ? `The ERC-20 contract address on ${network.name}.`
                        : "The classic SPL mint address on Solana."
                    }
                    label="Token address"
                    name="rewardAssetAddress"
                    onChange={(value) => set("tokenAddress", value)}
                    placeholder={
                      network.family === "evm" ? "0x…" : "Mint address"
                    }
                    value={choice.tokenAddress}
                  />
                  <TextField
                    error={error("tokenSymbol")}
                    label="Token symbol"
                    name="rewardAssetSymbol"
                    onChange={(value) => set("tokenSymbol", value)}
                    value={choice.tokenSymbol}
                  />
                </>
              ) : (
                <details className="proposal-advanced">
                  <summary>{network.stablecoin.symbol} asset details</summary>
                  <p className="field-hint">
                    {network.name}: <code>{network.stablecoin.address}</code>
                  </p>
                </details>
              )}
            </>
          )}
          <TextField
            error={error("monthlyAmount")}
            hint="A pledge until deposited in the vault. Changes apply from the next UTC month."
            inputMode="decimal"
            label={`Monthly amount (${symbol})`}
            name="monthlyPool"
            onChange={(value) => set("monthlyAmount", value)}
            value={choice.monthlyAmount}
          />
          <p className="fee-preview">
            Payout fee: {ESCROW_PAYOUT_FEE_BASIS_POINTS / 100}%. Unused-fund
            withdrawal fee: {ESCROW_WITHDRAWAL_FEE_BASIS_POINTS / 100}%.
          </p>
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
  const [restored] = useState(() => readDraft() !== null);
  const [referrer, setReferrer] = useState<string | null>(initialReferrer);
  const [step, setStep] = useState(() => {
    try {
      const stored = localStorage.getItem(PROPOSAL_STEP_KEY);
      const index = stored === null ? 0 : Number(stored);
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
  const [factsOpen, setFactsOpen] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const lookupController = useRef<AbortController | null>(null);
  const suggestedText = useRef({
    name: "",
    headline: "",
    goal: "",
    criteria: "",
  });
  const [termsOpen, setTermsOpen] = useState(
    () =>
      proposal.copyrightModel !== "unknown" ||
      proposal.inboundMode !== "unknown",
  );
  useEffect(() => {
    try {
      localStorage.setItem(PROPOSAL_DRAFT_KEY, JSON.stringify(proposal));
      localStorage.setItem(PROPOSAL_STEP_KEY, String(step));
      setSaveFailed(false);
    } catch {
      setSaveFailed(true);
    }
  }, [proposal, step]);
  useEffect(() => () => lookupController.current?.abort(), []);
  const set = (field: ProposalField) => (value: string) => {
    if (field === "repository") {
      lookupController.current?.abort();
      setLookup({ state: "idle", message: "" });
      if (proposal.repository !== value) {
        // Facts from another repository must never pair with this name.
        setProposal((current) => ({
          ...current,
          repository: value,
          repositoryNumericId: "",
          repositoryNodeId: "",
          integrationBranch: EMPTY_PROPOSAL.integrationBranch,
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
    setProposal((current) => ({ ...current, [field]: value }));
  };
  const errors = useMemo(() => proposalErrors(proposal), [proposal]);
  const stepErrors = (index: number) =>
    Object.fromEntries(
      Object.entries(errors).filter(
        ([field]) => FIELD_STEP[field as ProposalField] === index,
      ),
    ) as FieldErrors;
  const shown = (field: ProposalField) => {
    const owner = FIELD_STEP[field];
    return owner !== undefined && (attempted[owner] || attempted[3])
      ? errors[field]
      : undefined;
  };
  const valid = Object.keys(errors).length === 0;
  const p = proposal;
  const slug =
    slugify(p.name) ||
    slugify(p.repository.split("/").at(-1) || "") ||
    "new-project";
  const pool = monthlyPoolValue(
    p.monthlyPool,
    p.rewardKind === "token" ? { symbol: p.rewardAssetSymbol } : undefined,
  );
  const funding: FundingChoice = useMemo(
    () => ({
      mode: p.fundingMode === "monthly" ? "monthly" : "none",
      network: p.settlementChain,
      assetKind: p.rewardKind === "token" ? "token" : "stablecoin",
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
      : (REWARD_ASSET_NETWORKS[p.settlementChain as RewardAssetNetwork]
          ?.stablecoin.symbol ?? "USDC");
  const manifest = useMemo(() => {
    const now = new Date();
    const repository = p.repository || "owner/repository";
    return {
      schemaVersion: "1",
      id: slug,
      slug,
      name: p.name || "New project",
      eyebrow: "Open-source project",
      headline: p.headline || "Describe the project in one sentence.",
      ...(p.image ? { image: p.image } : {}),
      description: p.goal || "Describe the concrete open-source goal.",
      listingTier: "community",
      status: "paused",
      steward: {
        displayName: p.stewardName || "Unverified steward",
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
      ...(p.automaticClosure === "true"
        ? { slopbot: { automaticClosure: true } }
        : {}),
      // Optional funding: none, or one asset on one network with its vault
      // policy. The server verifies the asset and stores its decimals.
      ...rewardFields(funding, now),
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
  }, [p, slug, funding]);
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
    setSubmission({ status: "submitting" });
    createProject(
      manifest as unknown as ProjectDefinition,
      referrer,
      funding.mode === "monthly" ? funding.monthlyAmount.trim() : null,
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
    if (index === SETUP_STEPS.length - 1 && step !== index)
      setSessionRevision((current) => current + 1);
    setStep(index);
    window.setTimeout(() => {
      document.getElementById("proposal-step-heading")?.focus();
    }, 0);
  }
  function next() {
    setAttempted((current) =>
      current.map((value, index) => value || index === step),
    );
    if (Object.keys(stepErrors(step)).length > 0) {
      window.setTimeout(
        () =>
          document
            .querySelector<HTMLElement>(".proposal-form .form-error-summary")
            ?.focus(),
        0,
      );
      return;
    }
    goTo(step + 1);
  }
  function focusField(field: ProposalField) {
    const owner = FIELD_STEP[field] ?? step;
    if (
      owner === 0 &&
      field !== "repository" &&
      field !== "integrationBranch" &&
      field !== "stewardName"
    )
      setFactsOpen(true);
    if (isTermsField(field)) setTermsOpen(true);
    if (field === "goal") setGoalOpen(true);
    if (SKILL_RULE_FIELDS.some((entry) => entry === field))
      setInstructionsOpen(true);
    setStep(owner);
    window.setTimeout(() => document.getElementById(`field-${field}`)?.focus());
  }
  async function runLookup(chosen?: string) {
    lookupController.current?.abort();
    const controller = new AbortController();
    lookupController.current = controller;
    const repository = normalizeRepositoryInput(chosen ?? p.repository);
    if (!validRepositoryPath(repository)) {
      setAttempted((current) => current.map((v, i) => v || i === 0));
      setLookup({
        state: "error",
        message: "Enter the repository as owner/name first.",
      });
      return;
    }
    setLookup({ state: "loading", message: "Looking up on GitHub…" });
    try {
      const facts = await lookupGitHubRepository(repository, controller.signal);
      if (controller.signal.aborted) return;
      const description = facts.description ?? "";
      const suggested = {
        name: facts.repository.split("/")[1] ?? "",
        headline: boundedText(description, 8, 120) ? description : "",
        goal: boundedText(description, 24, 600) ? description : "",
        criteria: DEFAULT_CRITERIA,
      };
      // Replace a suggestion from an earlier repository, never the
      // maintainer's own words.
      const previous = suggestedText.current;
      const fill = (field: keyof typeof suggested, value: string) =>
        value === "" || value === previous[field] ? suggested[field] : value;
      suggestedText.current = suggested;
      setProposal((current) => ({
        ...current,
        name: fill("name", current.name),
        headline: fill("headline", current.headline),
        goal: fill("goal", current.goal),
        criteria: fill("criteria", current.criteria),
        repository: facts.repository,
        repositoryNumericId: facts.numericId,
        repositoryNodeId: facts.nodeId,
        integrationBranch: facts.defaultBranch,
        stewardKind: facts.owner.kind,
        stewardLogin: facts.owner.login,
        stewardActorId: facts.owner.actorId,
        stewardNodeId: facts.owner.nodeId,
        stewardName: current.stewardName || facts.owner.login,
        licenseSpdx:
          facts.license.state === "verified" ? facts.license.spdx : "",
        licenseCommit:
          facts.license.state === "verified" ? facts.license.commitSha : "",
        licenseDigest:
          facts.license.state === "verified" ? facts.license.fileSha256 : "",
      }));
      setLookup({
        state: "done",
        message:
          facts.license.state === "verified"
            ? `Found ${facts.repository}. Check the filled-in details before you continue.`
            : `Found ${facts.repository}. Check the filled-in details before you continue. License stays unknown: ${facts.license.reason}`,
      });
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      setLookup({
        state: "error",
        message: `${errorMessage(error, "GitHub lookup failed.")} Nothing was filled in. Enter them below or try again.`,
      });
      setFactsOpen(true);
    }
  }
  function clearDraft() {
    if (submission.status === "submitting") return;
    lookupController.current?.abort();
    setProposal(EMPTY_PROPOSAL);
    setSubmission({ status: "idle" });
    suggestedText.current = { name: "", headline: "", goal: "", criteria: "" };
    setTermsOpen(false);
    setInstructionsOpen(false);
    setGoalOpen(false);
    setAttempted(SETUP_STEPS.map(() => false));
    setLookup({ state: "idle", message: "" });
    setConfirmClear(false);
    setStep(0);
  }
  const currentErrors = attempted[step] ? stepErrors(step) : {};
  const licenseKnown = p.licenseSpdx !== "" && !errors.licenseSpdx;
  const draftNote = (
    <p className="proposal-note">
      {saveFailed
        ? "This browser cannot save the draft. Keep this page open."
        : "Draft saved on this device."}
    </p>
  );
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
      <main className="shell route-main proposal-page">
        <h1 id="project-created-heading" tabIndex={-1}>
          Project created
        </h1>
        <ProjectSetupStatusPanel
          initial={submission.setup}
          projectId={submission.projectId}
          showProjectLink={false}
        />
        {submission.referrer ? (
          <p className="proposal-note">Referred by @{submission.referrer}.</p>
        ) : null}
        <div className="wizard-actions">
          <Link
            className="button primary-button"
            href={`/projects/${submission.projectId}`}
          >
            View project
          </Link>
          <Link
            className="button secondary-button"
            href={`/projects/${submission.projectId}/manage`}
          >
            Manage project
          </Link>
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
  const repositoryPicker = (
    <RepositoryPicker
      projectSession={projectSession}
      onChoose={(repository) => {
        set("repository")(repository);
        void runLookup(repository);
      }}
      selected={p.repository}
    />
  );
  return (
    <main className="shell route-main proposal-page">
      <p className="breadcrumb">
        <Link href="/">Projects</Link>
      </p>
      <RoutePageHeader
        icon={<GitBranch />}
        title="Add a project"
        lead="Install Slopbot and pass the security scan to go live."
      />
      <OwnerProjects
        key={
          projectSession.status === "signed-in"
            ? projectSession.session.githubId
            : "anonymous"
        }
        session={projectSession}
        refreshKey=""
      />
      <nav aria-label="Setup steps">
        <ol className="proposal-steps">
          {SETUP_STEPS.map((label, index) => {
            const count = Object.keys(stepErrors(index)).length;
            return (
              <li key={label}>
                <button
                  aria-current={step === index ? "step" : undefined}
                  onClick={() => goTo(index)}
                  type="button"
                >
                  <span className="proposal-step-icon" aria-hidden="true">
                    {index === 0 ? (
                      <GitBranch />
                    ) : index === 1 ? (
                      <ListChecks />
                    ) : index === 2 ? (
                      <Wallet />
                    ) : (
                      <ShieldCheck />
                    )}
                  </span>
                  <span>
                    <strong>{index + 1}</strong> {label}
                  </span>
                  {attempted[index] && count > 0 ? (
                    <small>{count} to fix</small>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      {restored && step === 0 ? (
        <p className="proposal-note" role="status">
          Your saved draft was restored.
        </p>
      ) : null}
      <form
        className="proposal-form"
        noValidate
        onSubmit={(event) => event.preventDefault()}
      >
        <h2 id="proposal-step-heading" tabIndex={-1}>
          {SETUP_STEPS[step]}
        </h2>
        {step === 0 ? (
          <>
            {projectSession.status === "signed-in" ? (
              <details className="proposal-advanced">
                <summary>Choose from your GitHub repositories</summary>
                {repositoryPicker}
              </details>
            ) : (
              repositoryPicker
            )}
            <div className="lookup-row">
              <TextField
                error={shown("repository")}
                hint="Paste owner/name or a github.com link."
                label="Public GitHub repository"
                name="repository"
                onChange={(value) =>
                  set("repository")(normalizeRepositoryInput(value))
                }
                placeholder="owner/repository"
                value={p.repository}
              />
              {projectSession.status === "signed-in" ? (
                <button
                  className="button secondary-button"
                  disabled={lookup.state === "loading"}
                  onClick={() => void runLookup()}
                  type="button"
                >
                  {lookup.state === "loading"
                    ? "Looking up…"
                    : "Look up on GitHub"}
                </button>
              ) : null}
            </div>
            <p
              className={
                lookup.state === "error"
                  ? "field-error lookup-status"
                  : "lookup-status"
              }
              role="status"
            >
              {lookup.message}
            </p>
            <TextField
              error={shown("integrationBranch")}
              hint="The branch that receives accepted work."
              label="Integration branch"
              name="integrationBranch"
              onChange={set("integrationBranch")}
              value={p.integrationBranch}
            />
            <TextField
              error={shown("stewardName")}
              hint="The person or organization responsible for the repository."
              label="Steward display name"
              name="stewardName"
              onChange={set("stewardName")}
              value={p.stewardName}
            />
            <dl className="proposal-facts">
              <div>
                <dt>Steward</dt>
                <dd>
                  {p.stewardLogin
                    ? `@${p.stewardLogin} · ${p.stewardKind}`
                    : "Not looked up"}
                </dd>
              </div>
              <div>
                <dt>License</dt>
                <dd>{licenseKnown ? p.licenseSpdx : "Unknown"}</dd>
              </div>
            </dl>
            <details
              className="proposal-advanced"
              onToggle={(event) => setFactsOpen(event.currentTarget.open)}
              open={
                factsOpen ||
                [
                  "repositoryNumericId",
                  "repositoryNodeId",
                  "stewardLogin",
                  "stewardActorId",
                  "stewardNodeId",
                  "licenseSpdx",
                  "licenseCommit",
                  "licenseDigest",
                ].some((field) => Boolean(shown(field as ProposalField)))
              }
            >
              <summary>Edit repository details</summary>
              <h3>Repository identity</h3>
              <TextField
                error={shown("repositoryNumericId")}
                inputMode="numeric"
                label="Repository numeric ID"
                name="repositoryNumericId"
                onChange={set("repositoryNumericId")}
                value={p.repositoryNumericId}
              />
              <TextField
                error={shown("repositoryNodeId")}
                label="Repository node ID"
                name="repositoryNodeId"
                onChange={set("repositoryNodeId")}
                value={p.repositoryNodeId}
              />
              <h3>Steward identity</h3>
              <SelectField
                label="Steward kind"
                name="stewardKind"
                onChange={set("stewardKind")}
                options={[
                  ["individual", "Individual"],
                  ["organization", "Organization"],
                  ["dao", "DAO"],
                  ["collective", "Collective"],
                ]}
                value={p.stewardKind}
              />
              <TextField
                error={shown("stewardLogin")}
                label="Steward GitHub login"
                name="stewardLogin"
                onChange={set("stewardLogin")}
                value={p.stewardLogin}
              />
              <TextField
                error={shown("stewardActorId")}
                inputMode="numeric"
                label="Steward numeric actor ID"
                name="stewardActorId"
                onChange={set("stewardActorId")}
                value={p.stewardActorId}
              />
              <TextField
                error={shown("stewardNodeId")}
                label="Steward actor node ID"
                name="stewardNodeId"
                onChange={set("stewardNodeId")}
                value={p.stewardNodeId}
              />
              <h3>License evidence</h3>
              <p className="field-hint">Leave empty if unknown.</p>
              <TextField
                error={shown("licenseSpdx")}
                label="License SPDX"
                name="licenseSpdx"
                onChange={set("licenseSpdx")}
                placeholder="MIT"
                value={p.licenseSpdx}
              />
              <TextField
                error={shown("licenseCommit")}
                label="LICENSE commit SHA"
                name="licenseCommit"
                onChange={set("licenseCommit")}
                value={p.licenseCommit}
              />
              <TextField
                error={shown("licenseDigest")}
                label="LICENSE SHA-256"
                name="licenseDigest"
                onChange={set("licenseDigest")}
                value={p.licenseDigest}
              />
            </details>
          </>
        ) : null}
        {step === 1 ? (
          <>
            <ProjectImageField value={p.image} onChange={set("image")} />
            <TextField
              error={shown("name")}
              label="Project name"
              name="name"
              onChange={set("name")}
              value={p.name}
            />
            <TextField
              error={shown("headline")}
              label="Short description"
              name="headline"
              onChange={set("headline")}
              value={p.headline}
            />
            <details
              className="proposal-advanced"
              onToggle={(event) => setGoalOpen(event.currentTarget.open)}
              open={goalOpen || Boolean(shown("goal"))}
            >
              <summary>Project goal</summary>
              <TextField
                error={shown("goal")}
                label="Goal"
                multiline
                name="goal"
                onChange={set("goal")}
                value={p.goal}
              />
            </details>
            <TextField
              error={shown("criteria")}
              label="Acceptance criteria"
              multiline
              name="criteria"
              onChange={set("criteria")}
              placeholder="What accepted GitHub outcomes qualify?"
              value={p.criteria}
            />
            <ClosureConsent
              onChange={set("automaticClosure")}
              value={p.automaticClosure}
            />
            <details
              className="proposal-skill-rules"
              onToggle={(event) =>
                setInstructionsOpen(event.currentTarget.open)
              }
              open={
                instructionsOpen ||
                SKILL_RULE_FIELDS.some((field) => Boolean(shown(field)))
              }
            >
              <summary>Contributor instructions (optional)</summary>
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
                  value={p[field]}
                />
              ))}
            </details>
            <details
              className="proposal-advanced"
              onToggle={(event) => setTermsOpen(event.currentTarget.open)}
              open={termsOpen || Object.keys(currentErrors).some(isTermsField)}
            >
              <summary>Additional legal terms (optional)</summary>
              <p className="field-hint">
                Leave as Unknown unless you know them.
              </p>
              <SelectField
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
              <SelectField
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
            </details>
          </>
        ) : null}
        {step === 2 ? (
          <FundingFields
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
        {step === 3 ? (
          <>
            <article className="proposal-preview" aria-label="Listing preview">
              <span className="draft-badge">Preview</span>
              <h3>{p.name || "Unnamed project"}</h3>
              <p>{p.headline || "No short description yet."}</p>
              <dl>
                <div>
                  <dt>Before you create</dt>
                  <dd>
                    Install Slopbot on {p.repository || "the repository"}.
                  </dd>
                </div>
                <div>
                  <dt>Slopbot automatic closure</dt>
                  <dd>
                    {p.automaticClosure === "true" ? "Allowed" : "Not allowed"}
                  </dd>
                </div>
                <div>
                  <dt>Monthly funding</dt>
                  <dd>
                    {p.fundingMode !== "monthly"
                      ? "None"
                      : pool.valid
                        ? `${p.rewardKind === "token" ? pool.display : formatMonthlyAmount(pool.minor, 6, fundingSymbol)} on ${SETTLEMENT_CHAIN_NAMES[p.settlementChain] ?? p.settlementChain} · pledge`
                        : "Invalid"}
                  </dd>
                </div>
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
              <details>
                <summary>Listing details</summary>
                <dl>
                  <div>
                    <dt>Repository</dt>
                    <dd>
                      {p.repository || "Not set"} · {p.integrationBranch}
                    </dd>
                  </div>
                  <div>
                    <dt>Steward</dt>
                    <dd>
                      {p.stewardName || "Not set"}
                      {p.stewardLogin ? ` (@${p.stewardLogin})` : ""}
                    </dd>
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
              </details>
            </article>
            {valid ? <GeneratedSkillPreview manifest={manifest} draft /> : null}
            <ErrorSummary errors={errors} onSelect={focusField} />
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
        {step < 3 ? (
          <ErrorSummary errors={currentErrors} onSelect={focusField} />
        ) : null}
        {navigation}
      </form>
      <div className="proposal-reset">
        {confirmClear ? (
          <>
            <span>Clear this draft?</span>
            <button
              className="button danger-button"
              disabled={submission.status === "submitting"}
              onClick={clearDraft}
              type="button"
            >
              Clear draft
            </button>
            <button
              className="button ghost-button"
              onClick={() => setConfirmClear(false)}
              type="button"
            >
              Keep draft
            </button>
          </>
        ) : (
          <button
            className="button ghost-button"
            disabled={submission.status === "submitting"}
            onClick={() => setConfirmClear(true)}
            type="button"
          >
            Start over
          </button>
        )}
      </div>
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
  const { allowed, checking, session } = useProjectMaintainer(project.id);
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
      value.fundingMode === "monthly" && !amount.valid
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
    assetKind: value.assetKind === "token" ? "token" : "stablecoin",
    tokenAddress: value.tokenAddress,
    tokenSymbol: value.tokenSymbol,
    monthlyAmount: value.monthlyAmount,
  };
  if (
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
    if (source.reward.kind === "monthly-pool") {
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
    ...(current.reward.kind === "monthly-pool" &&
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
                ? choice.assetKind === "token"
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
        choice.mode === "monthly" && changes.financial.length > 0
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
        {monthly ? (
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
              {submission.result.project.manifest.escrow &&
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
      {current.escrow && current.reward.kind !== "external-prize-share" ? (
        <div id="project-vault">
          <EscrowFunding
            project={current}
            onRegistered={() => setReload((count) => count + 1)}
          />
        </div>
      ) : null}
      <p id="security-settings">
        <Link href={`/projects/${current.slug}/security#security-settings`}>
          Manage security program and private bounty funds
        </Link>
      </p>
      {!monthly ? (
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

/** Readable labels for the stored project status enum. */
const PROJECT_STATUS_LABEL: Record<ProjectSummary["status"], string> = {
  active: "Live",
  paused: "Paused",
};

/**
 * The signed-in account's projects with their setup status, and any
 * application stored before self-service setup, which its applicant
 * publishes without entering it again.
 */
function OwnerProjects({
  refreshKey,
  session,
}: {
  refreshKey: string;
  session: ProjectSessionState;
}) {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | {
        status: "ready";
        projects: ProjectSummary[];
        applications: ProjectApplication[];
      }
  >({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [publishing, setPublishing] = useState<
    | { id: string; state: "busy" }
    | { id: string; state: "error"; message: string }
    | {
        id: string;
        state: "done";
        projectId: string;
        setup: ProjectSetupStatus;
      }
    | null
  >(null);
  const actorId =
    session.status === "signed-in" ? session.session.githubId : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt and a new project trigger an explicit reload.
  useEffect(() => {
    if (actorId === null) return;
    let active = true;
    setState({ status: "loading" });
    listProjectSetup().then(
      (body) => {
        if (active) setState({ status: "ready", ...body });
      },
      (caught: unknown) => {
        if (active)
          setState({
            status: "error",
            message: errorMessage(caught, "Your projects are unavailable."),
          });
      },
    );
    return () => {
      active = false;
    };
  }, [actorId, attempt, refreshKey]);
  if (session.status !== "signed-in") return null;
  if (
    state.status === "ready" &&
    state.projects.length === 0 &&
    state.applications.length === 0
  )
    return null;
  return (
    <details id="your-projects">
      <summary>Your projects</summary>
      {state.status === "error" ? (
        <p role="alert">{state.message}</p>
      ) : state.status === "loading" ? (
        <p role="status">Loading your projects…</p>
      ) : state.projects.length === 0 && state.applications.length === 0 ? (
        <p>You have no projects yet.</p>
      ) : (
        <ul>
          {state.projects.map((project) => (
            <li key={project.id}>
              <strong>{project.name}</strong> ·{" "}
              {project.listingTier === "retired"
                ? "Delisted"
                : PROJECT_STATUS_LABEL[project.status]}{" "}
              <Link href={`/projects/${project.slug}/manage`}>Manage</Link>{" "}
              <button
                className="text-button"
                onClick={() =>
                  setOpen((current) =>
                    current === project.id ? null : project.id,
                  )
                }
                type="button"
              >
                {open === project.id ? "Hide setup" : "Check setup"}
              </button>
              {open === project.id ? (
                <ProjectSetupStatusPanel projectId={project.id} />
              ) : null}
            </li>
          ))}
          {state.applications.map((application) => (
            <li key={application.id}>
              <strong>{application.manifest.name}</strong> · submitted{" "}
              {application.submittedAt.slice(0, 10)}
              {publishing?.id === application.id &&
              publishing.state === "done" ? (
                <ProjectSetupStatusPanel
                  initial={publishing.setup}
                  projectId={publishing.projectId}
                />
              ) : (
                <>
                  {" "}
                  <button
                    className="button secondary-button"
                    disabled={
                      publishing?.id === application.id &&
                      publishing.state === "busy"
                    }
                    onClick={() => {
                      setPublishing({ id: application.id, state: "busy" });
                      publishStoredApplication(application.id).then(
                        ({ project, setup }) =>
                          setPublishing({
                            id: application.id,
                            state: "done",
                            projectId: project.id,
                            setup,
                          }),
                        (caught: unknown) =>
                          setPublishing({
                            id: application.id,
                            state: "error",
                            message: errorMessage(
                              caught,
                              "The application was not published.",
                            ),
                          }),
                      );
                    }}
                    type="button"
                  >
                    {application.expectedRevision === undefined
                      ? "Create this project"
                      : "Publish this change"}
                  </button>
                  {publishing?.id === application.id &&
                  publishing.state === "error" ? (
                    <p role="alert">{publishing.message}</p>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <button
        className="button secondary-button button-small"
        type="button"
        onClick={() => setAttempt((value) => value + 1)}
      >
        Refresh
      </button>
    </details>
  );
}
