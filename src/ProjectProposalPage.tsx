import { ArrowLeft, ArrowRight } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { GeneratedSkillPreview } from "./GeneratedSkillPreview";
import { Link } from "./Link";
import { CONTACT_EMAIL, CONTACT_MAILTO } from "./lib/contact";
import { copyText } from "./lib/copy-text";
import {
  ESCROW_PAYOUT_FEE_BASIS_POINTS,
  ESCROW_WITHDRAWAL_FEE_BASIS_POINTS,
} from "./lib/escrow-policy.mjs";
import {
  createProject,
  listProjectSetup,
  type ProjectApplication,
  type ProjectSessionState,
  type ProjectSummary,
  projectApiRequest,
  publishProjectRevision,
  publishStoredApplication,
  type RevisionResult,
  useProjectSession,
} from "./lib/project-api";
import {
  type OwnedRepository,
  type ProjectSetupStatus,
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
import { PROJECT_SKILL_TEMPLATES } from "./lib/project-schema.mjs";
import type { ProjectDefinition } from "./lib/projects.mjs";
import {
  REWARD_ASSET_NETWORKS,
  type RewardAssetNetwork,
  rewardAssetChoice,
} from "./lib/reward-asset.mjs";
import { loginHref } from "./Points";
import { ProjectSetupStatusPanel } from "./ProjectSetupStatus";

const SETTLEMENT_CHAIN_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(REWARD_ASSET_NETWORKS).map(([id, network]) => [
    id,
    network.name,
  ]),
);
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
  goal: "",
  criteria: "",
  contributionGuide: "",
  supportedTasks: "",
  requiredTests: "",
  reviewExpectations: "",
  securityContact: "",
  closurePolicy: "",
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
/** Maintainer-authored rules that, with the scope, generate the skills. */
const SKILL_RULE_FIELDS = [
  "contributionGuide",
  "supportedTasks",
  "requiredTests",
  "reviewExpectations",
  "securityContact",
  "closurePolicy",
  "maintainerNotes",
] as const;
const SKILL_RULE_LABELS: Record<
  (typeof SKILL_RULE_FIELDS)[number],
  { label: string; placeholder: string }
> = {
  contributionGuide: {
    label: "Contribution guide",
    placeholder:
      "How should a contributor set up, branch and submit? Leave empty to follow the repository's CONTRIBUTING.md.",
  },
  supportedTasks: {
    label: "Supported tasks",
    placeholder:
      "Which kinds of work do you want, for example bug fixes or benchmark runs?",
  },
  requiredTests: {
    label: "Required tests",
    placeholder: "Which commands or workflows must pass before a pull request?",
  },
  reviewExpectations: {
    label: "Review expectations",
    placeholder: "What evidence must a pull request show for review?",
  },
  securityContact: {
    label: "Security contact",
    placeholder: "Where should security reports go privately?",
  },
  closurePolicy: {
    label: "Closure policy",
    placeholder: "When do maintainers close or decline a pull request?",
  },
  maintainerNotes: {
    label: "Maintainer notes",
    placeholder: "Anything else contributors should know.",
  },
};
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
    errors.repository =
      "Use the owner/name form, for example SlopDotCash/slopdotcash. A pasted github.com link is converted for you.";
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
  const criteria = lengthError(p.criteria, 6, 1_000);
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
        "DAO title cannot activate until review supplies a legal-capacity record and a governance resolution.";
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
    const amount = monthlyPoolValue(p.monthlyPool);
    if (!amount.valid || BigInt(amount.minor) === 0n)
      errors.monthlyPool =
        "Enter a positive amount with up to two decimals, or choose no monthly funding.";
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
      if (typeof entry === "string" && entry.length <= 4_000)
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
    <div className={`form-field${error ? " form-field-invalid" : ""}`}>
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
    <div className={`form-field${error ? " form-field-invalid" : ""}`}>
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
        Your entries are kept.
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
            message:
              error instanceof Error
                ? error.message
                : "Your repositories could not be loaded.",
          });
      },
    );
    return () => controller.abort();
  }, [login, attempt]);
  if (session === "checking")
    return (
      <p className="repository-picker-status" role="status">
        Checking whether you are signed in…
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
          Sign in to choose your repository. You can keep drafting below.
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
          Retry repositories
        </button>{" "}
        Or enter the repository below.
      </p>
    );
  if (list.repositories.length === 0)
    return (
      <p className="repository-picker-status" role="status">
        @{login} owns no public repositories. For an organization repository,
        enter it below.
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
        Signed in as @{login}. Choosing one looks it up on GitHub. For an
        organization repository, enter it below.
      </small>
    </div>
  );
}

function downloadText(value: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useCopyStatus() {
  const [status, setStatus] = useState<{
    kind: string;
    state: "copied" | "error";
  } | null>(null);
  const copy = (kind: string, value: string) =>
    void copyText(value).then(
      () => setStatus({ kind, state: "copied" }),
      () => setStatus({ kind, state: "error" }),
    );
  const label = (kind: string, idle: string, done: string, failed: string) =>
    status?.kind === kind ? (status.state === "copied" ? done : failed) : idle;
  return { status, copy, label };
}

/**
 * Reads the session only on the review step that needs it. The API decides
 * who may create a project, so the button follows its session, not the
 * points profile.
 */
function SubmitProject({
  onSubmit,
  submitting,
}: {
  onSubmit: () => void;
  submitting: boolean;
}) {
  const projectSession = useProjectSession();
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
          Checking whether you are signed in…
        </p>
      ) : (
        <a className="button primary-button" href={loginHref("/projects/new")}>
          Sign in with GitHub to create the project
        </a>
      )}
      <p>
        {login
          ? `You create the project as @${login}. Slop checks your GitHub access to the repository now.`
          : "Sign in with GitHub to create this project. Your draft stays on this device."}
      </p>
    </>
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
          No monthly funding
        </label>
        <label className="checkbox-field">
          <input
            checked={choice.mode === "monthly"}
            name="fundingMode"
            onChange={() => set("mode", "monthly")}
            type="radio"
          />{" "}
          Pay contributors a monthly amount
        </label>
      </fieldset>
      {choice.mode === "none" ? (
        <p className="field-hint">
          The project works without funding. Contributors still earn Slop Score
          for accepted work, and you can add a monthly amount later.
        </p>
      ) : (
        <>
          {networkFixed ? (
            <p className="field-hint">
              Paid in {symbol} on {network.name}. A project with a vault keeps
              its network and asset.
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
                    hint="Slop reads the decimals from chain when you save."
                    label="Token symbol"
                    name="rewardAssetSymbol"
                    onChange={(value) => set("tokenSymbol", value)}
                    value={choice.tokenSymbol}
                  />
                </>
              ) : (
                <p className="field-hint">
                  {network.stablecoin.symbol} on {network.name}:{" "}
                  <code>{network.stablecoin.address}</code>
                </p>
              )}
            </>
          )}
          <TextField
            error={error("monthlyAmount")}
            hint={`Amount in ${symbol}. It stays a pledge until it is deposited in the project vault. A change applies from the next calendar month (UTC).`}
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
  const projectSession = useProjectSession();
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
  const copy = useCopyStatus();
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
  const pool = monthlyPoolValue(p.monthlyPool);
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
        ) as Record<(typeof SKILL_RULE_FIELDS)[number], string>),
      },
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
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
  const [submission, setSubmission] = useState<
    | { status: "idle" | "submitting" }
    | { status: "error"; message: string }
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
    createProject(manifest as unknown as ProjectDefinition, referrer).then(
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
          message:
            error instanceof Error
              ? error.message
              : "The project was not created.",
        }),
    );
  }

  function goTo(index: number) {
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
      const suggestion = suggested.headline
        ? "a suggested name and description"
        : "a suggested name";
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
            ? `Found ${facts.repository}. IDs, default branch, owner and ${facts.license.spdx} license facts are filled in, with ${suggestion}. Check them before you continue.`
            : `Found ${facts.repository}. IDs, default branch and owner are filled in, with ${suggestion}. License stays unknown: ${facts.license.reason}`,
      });
    } catch (error: unknown) {
      if (controller.signal.aborted) return;
      setLookup({
        state: "error",
        message: `${error instanceof Error ? error.message : "GitHub lookup failed."} Nothing was filled in. Enter the facts by hand or try again.`,
      });
      setFactsOpen(true);
    }
  }
  function clearDraft() {
    lookupController.current?.abort();
    setProposal(EMPTY_PROPOSAL);
    suggestedText.current = { name: "", headline: "", goal: "", criteria: "" };
    setTermsOpen(false);
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
        ? "This browser cannot save the draft. Keep this page open, or copy the brief."
        : "Draft saved on this device only. No credentials are stored. It is not a listing."}
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
  return (
    <main className="shell route-main proposal-page">
      <p className="breadcrumb">
        <Link href="/">Projects</Link>
        <span>/</span>Add a project
      </p>
      <section className="proposal-intro">
        <h1>Add a project</h1>
        <p>
          Create your project without waiting for an admin. Slop checks your
          GitHub access, you install Slopbot, and an automatic security scan
          runs. The project goes live when those checks pass. Funding is
          optional. Questions? Email{" "}
          <a href={CONTACT_MAILTO}>{CONTACT_EMAIL}</a>.
        </p>
      </section>
      <OwnerProjects
        refreshKey={
          submission.status === "submitted" ? submission.projectId : ""
        }
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
                  <strong>{index + 1}</strong> {label}
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
          {step + 1}. {SETUP_STEPS[step]}
        </h2>
        {step === 0 ? (
          <>
            <RepositoryPicker
              projectSession={projectSession}
              onChoose={(repository) => {
                set("repository")(repository);
                void runLookup(repository);
              }}
              selected={p.repository}
            />
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
                <dt>Repository ID</dt>
                <dd>{p.repositoryNumericId || "Not looked up"}</dd>
              </div>
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
                <dd>
                  {licenseKnown
                    ? `${p.licenseSpdx} · LICENSE at ${p.licenseCommit.slice(0, 7)}`
                    : "Unknown"}
                </dd>
              </div>
            </dl>
            <details
              className="proposal-advanced"
              onToggle={(event) => setFactsOpen(event.currentTarget.open)}
              open={factsOpen || Object.keys(currentErrors).length > 0}
            >
              <summary>Enter or correct repository facts</summary>
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
              <p className="field-hint">
                License facts are optional. Leave all three empty to record the
                license as unknown.
              </p>
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
            <TextField
              error={shown("name")}
              label="Project name"
              name="name"
              onChange={set("name")}
              placeholder="Example: Open Protein"
              value={p.name}
            />
            <TextField
              error={shown("headline")}
              label="Short description"
              name="headline"
              onChange={set("headline")}
              placeholder="Reproducible protein-folding benchmarks."
              value={p.headline}
            />
            <TextField
              error={shown("goal")}
              label="Goal"
              multiline
              name="goal"
              onChange={set("goal")}
              placeholder="What should this project achieve?"
              value={p.goal}
            />
            <TextField
              error={shown("criteria")}
              label="Acceptance criteria"
              multiline
              name="criteria"
              onChange={set("criteria")}
              placeholder="What accepted GitHub outcomes qualify?"
              value={p.criteria}
            />
            <details
              className="proposal-skill-rules"
              open={SKILL_RULE_FIELDS.some((field) => Boolean(shown(field)))}
            >
              <summary>Customize contributor instructions (optional)</summary>
              <p className="field-hint">
                Slop generates this project's contributor and reviewer skills
                from these rules and its standard template. They can narrow what
                contributors do, but cannot weaken Slop's safety rules.
              </p>
              {SKILL_RULE_FIELDS.map((field) => (
                <TextField
                  error={shown(field)}
                  key={field}
                  label={SKILL_RULE_LABELS[field].label}
                  multiline
                  name={field}
                  onChange={set(field)}
                  placeholder={SKILL_RULE_LABELS[field].placeholder}
                  value={p[field]}
                />
              ))}
            </details>
            <details
              className="proposal-advanced"
              onToggle={(event) => setTermsOpen(event.currentTarget.open)}
              open={termsOpen || Object.keys(currentErrors).some(isTermsField)}
            >
              <summary>Ownership and contribution terms (optional)</summary>
              <p className="field-hint">
                Unknown is a valid answer. Leave these as Unknown unless you
                know them. Do not guess.
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
              <span className="draft-badge">Draft · not listed</span>
              <h3>{p.name || "Unnamed project"}</h3>
              <p>{p.headline || "No short description yet."}</p>
              <dl>
                <div>
                  <dt>Repository</dt>
                  <dd>
                    {p.repository || "Not set"} · {p.integrationBranch}
                  </dd>
                </div>
                <div>
                  <dt>When created</dt>
                  <dd>
                    Paused until Slopbot is installed and the security scan
                    passes
                  </dd>
                </div>
                <div>
                  <dt>Monthly funding</dt>
                  <dd>
                    {p.fundingMode !== "monthly"
                      ? "None"
                      : pool.valid
                        ? `${formatMonthlyAmount(pool.minor, fundingSymbol)} on ${SETTLEMENT_CHAIN_NAMES[p.settlementChain] ?? p.settlementChain} · pledge`
                        : "Invalid"}
                  </dd>
                </div>
                <div>
                  <dt>Steward</dt>
                  <dd>
                    {p.stewardName || "Not set"}
                    {p.stewardLogin ? ` (@${p.stewardLogin})` : ""}
                  </dd>
                </div>
                {referrer ? (
                  <div>
                    <dt>Referred by</dt>
                    <dd>
                      @{referrer} · recorded with the project{" "}
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
            </article>
            {valid ? <GeneratedSkillPreview manifest={manifest} draft /> : null}
            <ErrorSummary errors={errors} onSelect={focusField} />
            {submission.status === "submitted" ? (
              <div className="proposal-submitted">
                <h2>Project created</h2>
                <p>
                  {p.name || submission.projectId} is listed as a paused
                  project. Slop generated its contributor and reviewer skills
                  from your rules. Finish the next action below; the project
                  goes live by itself when every check passes.
                  {submission.referrer
                    ? ` Referred by @${submission.referrer}.`
                    : ""}
                </p>
                <ProjectSetupStatusPanel
                  initial={submission.setup}
                  projectId={submission.projectId}
                />
                <Link href={`/projects/${submission.projectId}/manage`}>
                  Manage project
                </Link>
              </div>
            ) : valid ? (
              <div className="handoff-actions">
                <SubmitProject
                  onSubmit={submit}
                  submitting={submission.status === "submitting"}
                />
                {submission.status === "error" ? (
                  <p className="form-error" role="alert">
                    {submission.message}
                  </p>
                ) : null}
                {draftNote}
                <div className="handoff-alternatives">
                  <span>Other options:</span>
                  <button
                    onClick={() =>
                      downloadText(
                        manifestText,
                        `${slug}-project.json`,
                        "application/json",
                      )
                    }
                    type="button"
                  >
                    Download manifest
                  </button>
                  <button
                    onClick={() => copy.copy("json", manifestText)}
                    type="button"
                  >
                    {copy.label(
                      "json",
                      "Copy manifest",
                      "Manifest copied",
                      "Copy unavailable; select the manifest",
                    )}
                  </button>
                </div>
              </div>
            ) : (
              draftNote
            )}
            <details
              className="manifest-preview"
              open={
                copy.status?.kind === "json" && copy.status.state === "error"
              }
            >
              <summary>View manifest · {slug}</summary>
              <textarea
                aria-label="Project manifest JSON"
                readOnly
                spellCheck={false}
                value={manifestText}
              />
            </details>
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
            <span>Clear every field in this draft?</span>
            <button
              className="button danger-button"
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

const CHANGE_LABELS: Record<string, string> = {
  name: "Project name",
  eyebrow: "Eyebrow",
  headline: "Short description",
  description: "Goal",
  links: "Links",
  contribution: "Contribution rules",
  reward: "Monthly funding",
  rewardAsset: "Reward asset",
  escrow: "Vault network",
};

const label = (field: string) => CHANGE_LABELS[field] ?? field;

type UpdateDraft = {
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
} & Record<(typeof SKILL_RULE_FIELDS)[number], string>;

function centsText(minor: string): string {
  const amount = BigInt(minor);
  const cents = (amount % 1_000_000n) / 10_000n;
  return `${amount / 1_000_000n}${cents === 0n ? "" : `.${cents.toString().padStart(2, "0")}`}`;
}

const DRAFT_FIELDS = [
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
 * with what it needs: presentation publishes at once, contribution rules need
 * a new security scan, and a funding change applies from the next calendar
 * month. A draft saved against an older revision must be confirmed against
 * the current one, and the server refuses a stale base revision.
 */
export function ProjectUpdatePage({ project }: { project: ProjectDefinition }) {
  const session = useProjectSession();
  const [base, setBase] = useState<{
    revision: number;
    project: ProjectDefinition;
  } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [submission, setSubmission] = useState<
    | { state: "idle" | "publishing" }
    | { state: "error"; message: string }
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
            error instanceof Error
              ? error.message
              : "Cannot read the current revision.",
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
  const hasVault = current.escrow !== undefined;
  const funded =
    monthly &&
    (reward.fundingState === "committed" ||
      reward.paymentMode === "enabled" ||
      BigInt(reward.committedMinor) > 0n ||
      (current.escrow?.deployments.length ?? 0) > 0);
  const initial: UpdateDraft = {
    headline: current.headline,
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
    monthlyAmount: capMinor === "0" ? "" : centsText(capMinor),
    ...(Object.fromEntries(
      SKILL_RULE_FIELDS.map((field) => [
        field,
        current.contribution?.[field] ?? "",
      ]),
    ) as Record<(typeof SKILL_RULE_FIELDS)[number], string>),
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
              (saved[field] as string).length <= 4_000,
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
  const amount = monthlyPoolValue(value.monthlyAmount);
  const errors: Record<string, string | undefined> = {
    headline: lengthError(value.headline, 8, 120),
    goal: lengthError(value.goal, 24, 600),
    criteria: lengthError(value.criteria, 6, 1_000),
    note:
      value.note.trim() === "" ? undefined : lengthError(value.note, 1, 500),
    monthlyAmount:
      value.fundingMode === "monthly" &&
      (!amount.valid || BigInt(amount.minor) === 0n)
        ? "Enter a positive amount with up to two decimals, or choose no monthly funding."
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
  const assetFixed = funded || hasVault;
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
      const cap =
        choice.mode === "monthly" && amount.valid
          ? { monthlyCapMinor: amount.minor, monthlyCapDisplay: amount.display }
          : { monthlyCapMinor: "0", monthlyCapDisplay: "$0" };
      // The asset and vault change only when the owner chose a new one.
      const assetTouched =
        draft !== null &&
        (["network", "assetKind", "tokenAddress", "tokenSymbol"] as const).some(
          (field) =>
            draft[field] !== undefined && draft[field] !== initial[field],
        );
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
  const amountText = (minor: string, symbol: string) =>
    minor === "0" ? "No monthly funding" : formatMonthlyAmount(minor, symbol);
  const diff = [
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
      label: SKILL_RULE_LABELS[field].label,
      before: current.contribution?.[field] ?? "",
      after: next.contribution?.[field] ?? "",
    })),
    ...(current.reward.kind === "monthly-pool" &&
    next.reward.kind === "monthly-pool"
      ? [
          {
            field: "monthly",
            label: "Monthly funding",
            before: amountText(
              current.reward.monthlyCapMinor,
              String(current.reward.currency),
            ),
            after: amountText(
              next.reward.monthlyCapMinor,
              String(next.reward.currency),
            ),
          },
        ]
      : []),
  ].filter((change) => change.before !== change.after);
  const valid = Object.values(errors).every((error) => !error);
  const shown = (field: string) => (attempted ? errors[field] : undefined);
  async function publish() {
    setAttempted(true);
    if (!valid || !changed || base === null || staleDraft) return;
    setSubmission({ state: "publishing" });
    try {
      const result = await publishProjectRevision(
        project.id,
        next,
        base.revision,
        value.note,
      );
      setSubmission({ state: "published", result });
      setDraft(null);
      setDraftRevision(null);
      setAttempted(false);
      setReload((count) => count + 1);
    } catch (error) {
      setSubmission({
        state: "error",
        message:
          error instanceof Error
            ? error.message
            : "Changes were not published.",
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
        <span>/</span>Manage project
      </p>
      <div className="manage-intro">
        <h1>Manage project</h1>
        <p>
          {project.name} · Changes publish when you save. Slop checks your
          GitHub access to the repository first.
        </p>
        {project.escrow && (
          <p>
            <Link href={`/projects/${project.slug}/awards`}>Review awards</Link>
          </p>
        )}
      </div>
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
          projectId={project.id}
        />
      ) : null}
      <form
        className="proposal-form"
        noValidate
        onSubmit={(event) => event.preventDefault()}
      >
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
        <TextField
          error={shown("criteria")}
          hint="Used by the contributor and reviewer skills. A change needs a new security scan."
          label="Acceptance criteria"
          multiline
          name="criteria"
          onChange={set("criteria")}
          placeholder="What accepted GitHub outcomes qualify?"
          value={value.criteria}
        />
        <details
          className="proposal-skill-rules"
          open={SKILL_RULE_FIELDS.some((field) => Boolean(shown(field)))}
        >
          <summary>Contributor instructions</summary>
          <p className="field-hint">
            These rules generate the project skills. A change needs a new
            security scan; an active project pauses until it passes.
          </p>
          {SKILL_RULE_FIELDS.map((field) => (
            <TextField
              error={shown(field)}
              key={field}
              label={SKILL_RULE_LABELS[field].label}
              multiline
              name={field}
              onChange={set(field)}
              placeholder={SKILL_RULE_LABELS[field].placeholder}
              value={value[field]}
            />
          ))}
        </details>
        {monthly ? (
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
        ) : null}
        <TextField
          error={shown("note")}
          hint="Optional. Public in the revision history."
          label="Revision note"
          multiline
          name="note"
          onChange={set("note")}
          value={value.note}
        />
        {staleDraft ? (
          <div role="alert" className="form-error">
            <p>
              This draft was saved against{" "}
              {draftRevision === -1
                ? "an unknown revision"
                : `revision ${draftRevision}`}
              . The current revision is {base?.revision}. Review the changes
              below before continuing.
            </p>
            <button
              type="button"
              className="button secondary-button"
              onClick={() => setDraftRevision(base?.revision ?? null)}
            >
              Use this draft with the current revision
            </button>
          </div>
        ) : null}
        <section aria-labelledby="update-changes" className="update-changes">
          <h2 id="update-changes">Changes</h2>
          {!changed ? (
            <p>No manifest field has changed.</p>
          ) : (
            <>
              <ul>
                {changes.presentation.length > 0 ? (
                  <li>
                    Publishes now: {changes.presentation.map(label).join(", ")}.
                  </li>
                ) : null}
                {changes.executable.length > 0 ? (
                  <li>
                    Needs a new security scan:{" "}
                    {changes.executable.map(label).join(", ")}.{" "}
                    {current.status === "active"
                      ? "The project pauses and goes live again when the scan passes."
                      : "The project goes live when the scan passes."}
                  </li>
                ) : null}
                {changes.financial.length > 0 ? (
                  <li>
                    Applies from {nextCycle} (UTC):{" "}
                    {changes.financial.map(label).join(", ")}. Funded awards
                    keep their terms.
                  </li>
                ) : null}
              </ul>
              {diff.map((change) => (
                <div className="project-change" key={change.field}>
                  <h3>{change.label}</h3>
                  <dl>
                    <div>
                      <dt>Current</dt>
                      <dd>{change.before || "Not set"}</dd>
                    </div>
                    <div>
                      <dt>Proposed</dt>
                      <dd>{change.after || "Not set"}</dd>
                    </div>
                  </dl>
                </div>
              ))}
            </>
          )}
        </section>
        {attempted && (!valid || !changed) ? (
          <p className="form-error" role="alert">
            {changed
              ? "Fix the marked fields. Your entries are kept."
              : "Change at least one field before you publish."}
          </p>
        ) : null}
        {loadError ? (
          <div role="alert" className="form-error">
            <p>{loadError}</p>
            <button
              className="button secondary-button"
              onClick={() => setReload((count) => count + 1)}
              type="button"
            >
              Try again
            </button>
          </div>
        ) : null}
        <div className="handoff-actions">
          {session.status !== "signed-in" ? (
            <a
              className="button primary-button"
              href={loginHref(`/projects/${project.slug}/manage`)}
            >
              Sign in to publish changes
            </a>
          ) : (
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
          )}
          <button
            className="button secondary-button"
            disabled={submission.state === "publishing"}
            onClick={() => {
              setDraft(null);
              setDraftRevision(null);
              setAttempted(false);
              setSubmission({ state: "idle" });
            }}
            type="button"
          >
            Discard draft
          </button>
          {submission.state === "error" ? (
            <p className="form-error" role="alert">
              {submission.message}{" "}
              <button
                className="text-button"
                onClick={() => setReload((count) => count + 1)}
                type="button"
              >
                Load the current revision
              </button>
            </p>
          ) : submission.state === "published" ? (
            <p role="status">
              Published revision {submission.result.project.revision}.
            </p>
          ) : null}
          <p className="proposal-note">
            {saveFailed
              ? "This browser cannot save the draft."
              : "Draft saved on this device until you publish it."}
          </p>
        </div>
      </form>
      {monthly ? (
        <section aria-labelledby="update-payouts" className="owner-section">
          <h2 id="update-payouts">Payouts</h2>
          <p className="payout-status">
            {reward.paymentMode === "enabled"
              ? "Payouts are enabled. Review allocations in Manage payouts."
              : "Payouts are not enabled yet."}{" "}
            <Link href={`/projects/${project.slug}/funding`}>
              Funding setup
            </Link>
          </p>
        </section>
      ) : (
        <section aria-labelledby="update-payouts" className="owner-section">
          <h2 id="update-payouts">Payouts</h2>
          <p className="payout-status">
            External award. Slop publishes contribution shares only and cannot
            draft, approve or pay the award.
          </p>
        </section>
      )}
    </main>
  );
}

/**
 * The signed-in account's projects with their setup status, and any
 * application stored before self-service setup, which its applicant
 * publishes without entering it again.
 */
function OwnerProjects({ refreshKey }: { refreshKey: string }) {
  const session = useProjectSession();
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt and a new project trigger an explicit reload.
  useEffect(() => {
    if (session.status !== "signed-in") return;
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
            message:
              caught instanceof Error
                ? caught.message
                : "Your projects are unavailable.",
          });
      },
    );
    return () => {
      active = false;
    };
  }, [session.status, attempt, refreshKey]);
  if (session.status !== "signed-in") return null;
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
              <strong>{project.name}</strong> · {project.status}
              {project.listingTier === "retired" ? " · delisted" : ""}{" "}
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
              {application.submittedAt.slice(0, 10)} before self-service setup
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
                            message:
                              caught instanceof Error
                                ? caught.message
                                : "The application was not published.",
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
      <button type="button" onClick={() => setAttempt((value) => value + 1)}>
        Refresh
      </button>
    </details>
  );
}
