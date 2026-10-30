/**
 * The admin surface for registry exceptions: revisions owners cannot publish
 * themselves, restrictions and security vetting. Owners create and update
 * their projects through self-service setup, so nothing here approves
 * routine work. Authority is decided by the API on every request; this view
 * only hides controls a session cannot use.
 */

import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  Code2,
  Coins,
  FolderGit2,
  LayoutGrid,
  Pause,
  RotateCcw,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { ProjectEnforcementPanel } from "./AdminProjectEnforcement";
import "./operations-design.css";
import "./admin-design.css";
import { ActivationClearance, VettingSection } from "./AdminVetting";
import { GeneratedSkillPreview } from "./GeneratedSkillPreview";
import { Link } from "./Link";
import { formatBaseUnits } from "./lib/base-units.mjs";
import { CONTRIBUTION_LABELS } from "./lib/contribution-fields";
import { errorMessage } from "./lib/errors";
import {
  type AdminProject,
  projectApiRequest,
  useProjectSession,
} from "./lib/project-api";
import {
  CONTRIBUTION_FIELDS,
  type ContributionField,
  PROJECT_SKILL_TEMPLATES,
} from "./lib/project-schema.mjs";
import {
  NETWORK_NAMES,
  REWARD_ASSET_NETWORKS,
  type RewardAssetNetwork,
  rewardAssetChoice,
} from "./lib/reward-asset.mjs";
import { usePublicResource } from "./lib/use-public-resource";
import { ChangeReview } from "./OwnerPresentation";
import {
  formatDateTime,
  MetricGrid,
  MetricTile,
  RoutePageHeader,
  SignInPanel,
  StatusBadge,
} from "./Presentation";

const CHANGE_LABELS: Record<string, string> = {
  name: "Project name",
  headline: "Short description",
  description: "Goal",
  listingTier: "Discovery placement",
  status: "Project status",
  reward: "Reward terms",
  rewardAsset: "Reward asset",
  escrow: "Project vault",
  funding: "Funding terms",
  securityBounty: "Security bounty",
  contribution: "Contribution rules",
  slopbot: "Slopbot consent",
  repositories: "Repositories",
  skill: "Contributor skill",
  reviewSkill: "Reviewer skill",
};
const changeLabel = (field: string) =>
  CHANGE_LABELS[field] ?? field.replace(/([a-z])([A-Z])/g, "$1 $2");
function ChangedValue({ value, empty }: { value: unknown; empty: string }) {
  if (value === undefined || value === null) return <>{empty}</>;
  if (typeof value !== "object") return <>{String(value)}</>;
  return <pre>{JSON.stringify(value, null, 2)}</pre>;
}

function LoadNotice({
  state,
  retry,
  label,
}: {
  state: { status: "loading" } | { status: "error"; message: string };
  retry: () => void;
  label: string;
}) {
  if (state.status === "loading") {
    return (
      <p aria-live="polite" className="admin-status">
        Loading {label}…
      </p>
    );
  }
  return (
    <div className="form-error" role="alert">
      <CircleAlert aria-hidden="true" /> {state.message}
      <button className="text-button" onClick={retry} type="button">
        <RotateCcw aria-hidden="true" /> Retry
      </button>
    </div>
  );
}

/** The admin project list; the API checks admin authority on every read. */
const loadAdminProjects = async () => ({
  projects: (
    await projectApiRequest<{ projects: AdminProject[] }>(
      "GET",
      "admin/projects",
    )
  ).projects,
});

type AssetDraft = {
  network: RewardAssetNetwork;
  kind: "stablecoin" | "token" | "native";
  address: string;
  symbol: string;
};

function initialAsset(project: AdminProject): AssetDraft {
  const asset = project.manifest.rewardAsset;
  if (asset) return { ...asset };
  const chain = project.manifest.reward.chain;
  const network: RewardAssetNetwork =
    chain && chain in REWARD_ASSET_NETWORKS ? chain : "base";
  return {
    network,
    kind: "stablecoin",
    address: REWARD_ASSET_NETWORKS[network].stablecoin.address,
    symbol: REWARD_ASSET_NETWORKS[network].stablecoin.symbol,
  };
}

/**
 * Edits one project revision. The structured skill, reward asset and status
 * fields have one editable source; advanced JSON contains only other keys. The
 * API validates the whole manifest and verifies a new token on chain.
 */
function ProjectEditor({
  project,
  onSaved,
  onCancel,
}: {
  project: AdminProject;
  onSaved: (note: string) => void;
  onCancel: () => void;
}) {
  const draftKey = `slop:admin-project:${project.id}:${project.revision}`;
  const [restored] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(draftKey) ?? "null") as {
        text: string;
        skill: Record<ContributionField, string>;
        asset: AssetDraft;
        assetSelected?: boolean;
        status: AdminProject["status"];
        reason: string;
      } | null;
    } catch {
      return null;
    }
  });
  const [draftError, setDraftError] = useState(false);
  const [text, setText] = useState(() => {
    const {
      status: _status,
      contribution: _contribution,
      rewardAsset: _asset,
      ...rest
    } = project.manifest;
    return restored?.text ?? JSON.stringify(rest, null, 2);
  });
  const [skill, setSkill] = useState<Record<ContributionField, string>>(
    () =>
      restored?.skill ??
      (Object.fromEntries(
        CONTRIBUTION_FIELDS.map((field) => [
          field,
          project.manifest.contribution?.[field] ?? "",
        ]),
      ) as Record<ContributionField, string>),
  );
  const [assetSelected, setAssetSelected] = useState(
    restored?.assetSelected ?? !!project.manifest.rewardAsset,
  );
  const [asset, updateAsset] = useState<AssetDraft>(
    () => restored?.asset ?? initialAsset(project),
  );
  const setAsset: typeof updateAsset = (value) => {
    setAssetSelected(true);
    updateAsset(value);
  };
  const [status, setStatus] = useState(restored?.status ?? project.status);
  const [reason, setReason] = useState(restored?.reason ?? "");
  useEffect(() => {
    try {
      sessionStorage.setItem(
        draftKey,
        JSON.stringify({ text, skill, asset, assetSelected, status, reason }),
      );
      setDraftError(false);
    } catch {
      setDraftError(true);
    }
  }, [draftKey, text, skill, asset, assetSelected, status, reason]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const skillStarted = CONTRIBUTION_FIELDS.some(
    (field) => skill[field].trim() !== "",
  );
  const skillErrors = Object.fromEntries(
    CONTRIBUTION_FIELDS.map((field) => {
      const value = skill[field].trim();
      const minimum = field === "approvedScope" ? 6 : 0;
      return [
        field,
        skillStarted && (value.length < minimum || value.length > 2000)
          ? minimum
            ? `${CONTRIBUTION_LABELS[field].label} must be ${minimum} to 2000 characters.`
            : `${CONTRIBUTION_LABELS[field].label} must be at most 2000 characters.`
          : null,
      ];
    }),
  ) as Record<ContributionField, string | null>;
  const network = REWARD_ASSET_NETWORKS[asset.network];
  let projectFields: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      projectFields = parsed;
  } catch {
    // Keep invalid advanced input editable without replacing it.
  }
  const buildManifest = () => {
    const manifest = projectFields;
    if (!manifest) throw new Error("The manifest is not a valid JSON object.");
    if (
      ["status", "contribution", "rewardAsset"].some((key) =>
        Object.hasOwn(manifest, key),
      )
    ) {
      throw new Error(
        "Use the Status, Contribution fields, and Reward asset controls. Remove those keys from advanced settings.",
      );
    }
    if (Object.values(skillErrors).some((value) => value !== null)) {
      throw new Error(
        "Complete the approved scope, or clear every contribution field.",
      );
    }
    let choice: ReturnType<typeof rewardAssetChoice>;
    try {
      choice = rewardAssetChoice(
        asset.network,
        asset.kind,
        asset.address,
        asset.symbol,
      );
    } catch (caught) {
      throw new Error(errorMessage(caught));
    }
    const { contribution: _skill, rewardAsset: _asset, ...rest } = manifest;
    const next = {
      ...rest,
      status,
      // Contribution fields and the canonical templates go together: Slop
      // generates both skills from them (PRD SKL-03).
      ...(skillStarted
        ? {
            contribution: Object.fromEntries(
              CONTRIBUTION_FIELDS.map((field) => [
                field,
                skill[field].replaceAll("\r\n", "\n").trim(),
              ]),
            ),
            skill: {
              ...(rest.skill as Record<string, unknown>),
              sourcePath: PROJECT_SKILL_TEMPLATES.contributor,
            },
            reviewSkill: {
              ...(rest.reviewSkill as Record<string, unknown>),
              sourcePath: PROJECT_SKILL_TEMPLATES.reviewer,
            },
          }
        : {}),
      ...((rest.reward as { kind?: unknown } | undefined)?.kind ===
        "monthly-pool" && assetSelected
        ? {
            reward: {
              ...(rest.reward as Record<string, unknown>),
              chain: choice.network,
              currency: choice.symbol,
            },
            ...(rest.escrow &&
            typeof rest.escrow === "object" &&
            !Array.isArray(rest.escrow)
              ? { escrow: { ...rest.escrow, chain: choice.network } }
              : {}),
            rewardAsset:
              project.manifest.rewardAsset &&
              project.manifest.rewardAsset.network === choice.network &&
              project.manifest.rewardAsset.kind === choice.kind &&
              project.manifest.rewardAsset.address === choice.address &&
              project.manifest.rewardAsset.symbol === choice.symbol
                ? project.manifest.rewardAsset
                : choice,
          }
        : {}),
    };
    return next;
  };
  let preview: Record<string, unknown> | null = null;
  let previewError = "";
  try {
    preview = buildManifest();
  } catch (caught) {
    previewError = errorMessage(caught);
  }
  const changedFields = preview
    ? [
        ...new Set([...Object.keys(project.manifest), ...Object.keys(preview)]),
      ].filter(
        (key) =>
          JSON.stringify(
            (project.manifest as unknown as Record<string, unknown>)[key],
          ) !== JSON.stringify(preview?.[key]),
      )
    : [];
  const save = (event: FormEvent) => {
    event.preventDefault();
    let next: Record<string, unknown>;
    try {
      next = buildManifest();
    } catch (caught) {
      setError(errorMessage(caught));
      return;
    }
    setBusy(true);
    setError(null);
    projectApiRequest(
      "PUT",
      `admin/projects/${encodeURIComponent(project.id)}/manifest`,
      { manifest: next, expectedRevision: project.revision, reason },
    ).then(
      () => {
        try {
          sessionStorage.removeItem(draftKey);
        } catch {
          // A saved revision has a new draft key; storage failure cannot undo it.
        }
        onSaved(SAVED_NOTE);
      },
      (caught: unknown) => {
        setBusy(false);
        setError(errorMessage(caught));
      },
    );
  };
  return (
    <form className="admin-editor" onSubmit={save}>
      <h3 className="visually-hidden">Edit project</h3>
      {draftError ? (
        <p role="status">
          Draft storage unavailable. Keep this editor open until saved.
        </p>
      ) : null}
      <fieldset className="admin-fieldset" disabled={projectFields === null}>
        <legend>Project details</legend>
        {(
          [
            ["name", "Project name", 80],
            ["headline", "Short description", 120],
            ["description", "Goal", 600],
          ] as const
        ).map(([field, label, maxLength]) => (
          <label key={field}>
            {label}
            <textarea
              rows={field === "description" ? 3 : 1}
              maxLength={maxLength}
              value={
                typeof projectFields?.[field] === "string"
                  ? projectFields[field]
                  : ""
              }
              onChange={(event) =>
                setText(
                  JSON.stringify(
                    { ...projectFields, [field]: event.target.value },
                    null,
                    2,
                  ),
                )
              }
            />
          </label>
        ))}
      </fieldset>
      <fieldset className="admin-fieldset">
        <legend>Status</legend>
        <ActivationClearance
          projectId={project.id}
          revision={project.revision}
        />
        <label>
          Project status
          <select
            onChange={(event) =>
              setStatus(event.target.value as AdminProject["status"])
            }
            value={status}
          >
            <option value="paused">Paused</option>
            <option value="active">Active</option>
          </select>
        </label>
        <Link
          href={adminHref(project.id, "security")}
          className="admin-inline-link"
        >
          <ShieldCheck aria-hidden="true" /> Security vetting{" "}
          <ArrowUpRight aria-hidden="true" />
        </Link>
      </fieldset>
      <fieldset className="admin-fieldset">
        <legend>Discovery</legend>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={
              (projectFields?.listingTier ?? project.manifest.listingTier) ===
              "featured"
            }
            disabled={
              busy ||
              projectFields === null ||
              project.enforcement.state !== "clear"
            }
            onChange={(event) => {
              setText(
                JSON.stringify(
                  {
                    ...projectFields,
                    listingTier: event.target.checked
                      ? "featured"
                      : "community",
                  },
                  null,
                  2,
                ),
              );
            }}
          />
          Featured
        </label>
      </fieldset>
      <fieldset className="admin-fieldset admin-fields-wide">
        <legend>Contribution fields</legend>
        <div className="admin-field-grid">
          {CONTRIBUTION_FIELDS.map((field) => (
            <label key={field}>
              {CONTRIBUTION_LABELS[field].label}
              <textarea
                aria-invalid={skillErrors[field] ? true : undefined}
                onChange={(event) =>
                  setSkill((current) => ({
                    ...current,
                    [field]: event.target.value,
                  }))
                }
                rows={field === "securityContact" ? 1 : 3}
                value={skill[field]}
              />
              {skillErrors[field] ? (
                <small className="field-error">{skillErrors[field]}</small>
              ) : null}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="admin-fieldset">
        <legend>Reward asset</legend>
        {!assetSelected ? (
          <p>
            No reward asset.{" "}
            <button
              type="button"
              className="button secondary-button"
              onClick={() => setAssetSelected(true)}
            >
              Use this reward asset
            </button>
          </p>
        ) : null}
        <label>
          Network
          <select
            onChange={(event) => {
              const id = event.target.value as RewardAssetNetwork;
              setAsset((current) => ({
                ...current,
                network: id,
                ...(current.kind === "stablecoin" || current.kind === "native"
                  ? {
                      address: REWARD_ASSET_NETWORKS[id][current.kind].address,
                      symbol: REWARD_ASSET_NETWORKS[id][current.kind].symbol,
                    }
                  : {}),
              }));
            }}
            value={asset.network}
          >
            {Object.entries(REWARD_ASSET_NETWORKS).map(([id, definition]) => (
              <option key={id} value={id}>
                {definition.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Asset
          <select
            onChange={(event) => {
              const kind = event.target.value as AssetDraft["kind"];
              setAsset((current) => ({
                ...current,
                kind,
                address:
                  kind === "stablecoin" || kind === "native"
                    ? network[kind].address
                    : "",
                symbol:
                  kind === "stablecoin" || kind === "native"
                    ? network[kind].symbol
                    : "",
              }));
            }}
            value={asset.kind}
          >
            <option value="stablecoin">
              {network.stablecoin.symbol} (network stablecoin)
            </option>
            <option value="native">{network.native.symbol}</option>
            <option value="token">Another token</option>
          </select>
        </label>
        {asset.kind === "token" ? (
          <>
            <label>
              Token address
              <input
                onChange={(event) =>
                  setAsset((current) => ({
                    ...current,
                    address: event.target.value,
                  }))
                }
                spellCheck={false}
                value={asset.address}
              />
            </label>
            <label>
              Token symbol
              <input
                onChange={(event) =>
                  setAsset((current) => ({
                    ...current,
                    symbol: event.target.value,
                  }))
                }
                value={asset.symbol}
              />
            </label>
          </>
        ) : null}
        {project.manifest.rewardAsset ? (
          <p className="admin-status">
            Stored: {project.manifest.rewardAsset.symbol},{" "}
            {project.manifest.rewardAsset.decimals} decimals, verified{" "}
            {formatDateTime(project.manifest.rewardAsset.verifiedAt)}.
          </p>
        ) : null}
      </fieldset>
      <fieldset className="admin-fieldset admin-fields-wide">
        <legend>Advanced settings · revision {project.revision}</legend>
        <label>
          Manifest JSON
          <textarea
            className="admin-manifest"
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            value={text}
          />
        </label>
      </fieldset>
      <section
        aria-label="Revision changes"
        className="admin-fields-wide admin-revision-review"
      >
        <h3>Review changes</h3>
        {previewError ? (
          <p role="status">{previewError}</p>
        ) : changedFields.length === 0 ? (
          <p>No changes.</p>
        ) : (
          changedFields.map((field) => (
            <ChangeReview
              key={field}
              label={changeLabel(field)}
              before={
                <ChangedValue
                  value={
                    (project.manifest as unknown as Record<string, unknown>)[
                      field
                    ]
                  }
                  empty="Not set"
                />
              }
              after={<ChangedValue value={preview?.[field]} empty="Removed" />}
            />
          ))
        )}
      </section>
      <label>
        Reason for revision (public)
        <input
          maxLength={1000}
          onChange={(event) => setReason(event.target.value)}
          required
          value={reason}
        />
      </label>
      {error ? (
        <p className="form-error" role="alert">
          <CircleAlert aria-hidden="true" /> {error}
        </p>
      ) : null}
      <div className="admin-editor-actions admin-fields-wide">
        <button
          className="button primary-button"
          disabled={
            busy ||
            reason.trim() === "" ||
            preview === null ||
            changedFields.length === 0
          }
          type="submit"
        >
          <Save aria-hidden="true" />{" "}
          {busy ? "Saving…" : `Save revision ${project.revision + 1}`}
        </button>
        <button
          type="button"
          className="button secondary-button"
          disabled={busy}
          onClick={onCancel}
        >
          <X aria-hidden="true" /> Close and keep draft
        </button>
        <button
          type="button"
          className="button ghost-button"
          disabled={busy}
          onClick={() => {
            try {
              sessionStorage.removeItem(draftKey);
              onCancel();
            } catch {
              setError(
                "Could not discard the saved draft. Keep this editor open and try again.",
              );
            }
          }}
        >
          <Trash2 aria-hidden="true" /> Discard draft
        </button>
      </div>
    </form>
  );
}

/** Public reads are edge cached for 30 seconds and purged on each write. */
const SAVED_NOTE = "Saved.";

/** Delisting keeps history: the project becomes paused and retired. */
function DelistButton({
  project,
  onDone,
}: {
  project: AdminProject;
  onDone: (note: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (project.manifest.listingTier === "retired") return null;
  const delist = () => {
    setBusy(true);
    setError(null);
    projectApiRequest(
      "PUT",
      `admin/projects/${encodeURIComponent(project.id)}/manifest`,
      {
        manifest: {
          ...project.manifest,
          status: "paused",
          listingTier: "retired",
        },
        expectedRevision: project.revision,
        reason: "Delisted by an admin",
      },
    ).then(
      () => onDone(SAVED_NOTE),
      (caught: unknown) => {
        setBusy(false);
        setError(errorMessage(caught));
      },
    );
  };
  return (
    <div className="admin-actions">
      {error ? (
        <p className="form-error" role="alert">
          <CircleAlert aria-hidden="true" /> {error}
        </p>
      ) : null}
      {confirming ? (
        <div>
          <span>Hide this project everywhere?</span>
          <button
            className="button danger-button"
            disabled={busy}
            onClick={delist}
            type="button"
          >
            {busy ? "Delisting…" : "Delist project"}
          </button>
          <button
            className="button ghost-button"
            onClick={() => setConfirming(false)}
            type="button"
          >
            Keep listed
          </button>
        </div>
      ) : (
        <div>
          <button
            className="button ghost-button"
            onClick={() => setConfirming(true)}
            type="button"
          >
            <Trash2 aria-hidden="true" /> Delist
          </button>
        </div>
      )}
    </div>
  );
}

type ProjectSection = "overview" | "security" | "settings" | "skills";

function adminHref(projectId: string | null, section = "overview") {
  const params = new URLSearchParams();
  if (projectId) params.set("project", projectId);
  if (section !== "overview") params.set("section", section);
  return `/admin${params.size ? `?${params}` : ""}`;
}

function projectState(project: AdminProject) {
  const restricted = project.enforcement.state !== "clear";
  const needsDecision = project.enforcement.decisionRequired;
  return {
    label: needsDecision
      ? "Decision needed"
      : restricted
        ? project.enforcement.state
        : project.status,
    tone:
      needsDecision || project.enforcement.state === "banned"
        ? ("danger" as const)
        : restricted || project.status !== "active"
          ? ("warning" as const)
          : ("success" as const),
    icon:
      needsDecision || restricted ? (
        <ShieldAlert />
      ) : project.status === "active" ? (
        <CircleCheck />
      ) : (
        <Pause />
      ),
  };
}

function ProjectsSection({
  selectedProject,
  section,
}: {
  selectedProject: string | null;
  section: ProjectSection;
}) {
  const [query, setQuery] = useState("");
  const [state, reload] = usePublicResource(
    true,
    loadAdminProjects,
    "Projects could not load.",
  );
  const [note, setNote] = useState<string | null>(null);
  const matchingProjects =
    state.status === "ready"
      ? [...state.projects]
          .sort(
            (a, b) =>
              Number(b.enforcement.decisionRequired) -
              Number(a.enforcement.decisionRequired),
          )
          .filter((project) =>
            selectedProject
              ? project.id === selectedProject
              : `${project.id} ${project.manifest.name} ${project.manifest.repositories.map((repo) => repo.id).join(" ")}`
                  .toLowerCase()
                  .includes(query.trim().toLowerCase()),
          )
      : [];
  const backToOverview = () => {
    const current = new URL(window.location.href);
    if (
      current.searchParams.get("project") !== selectedProject ||
      current.searchParams.get("section") !== "settings"
    )
      return;
    window.history.pushState({}, "", adminHref(selectedProject));
    window.dispatchEvent(new PopStateEvent("popstate"));
    window.requestAnimationFrame(() => {
      document.getElementById("admin-project-title")?.focus();
      window.scrollTo({ top: 0, behavior: "auto" });
    });
  };
  return (
    <section aria-labelledby="admin-projects" className="admin-section">
      <h2 id="admin-projects" className="visually-hidden">
        {selectedProject ? "Selected project" : "Projects"}
      </h2>
      {!selectedProject && state.status === "ready" ? (
        <div className="admin-list-toolbar">
          <label className="admin-search">
            <Search aria-hidden="true" />
            <span className="visually-hidden">Find a project</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a project or repository"
            />
          </label>
          <MetricGrid className="admin-counts">
            <MetricTile label="Projects" value={state.projects.length} />
            <MetricTile
              label="Active"
              value={
                state.projects.filter((project) => project.status === "active")
                  .length
              }
              tone="success"
            />
            <MetricTile
              label="Need review"
              value={
                state.projects.filter(
                  (project) => project.enforcement.decisionRequired,
                ).length
              }
              tone="warning"
            />
          </MetricGrid>
        </div>
      ) : null}
      {selectedProject ? (
        <Link href="/admin" className="admin-back">
          <ArrowLeft aria-hidden="true" /> All projects
        </Link>
      ) : null}
      {note ? (
        <p className="admin-status" role="status">
          <CircleCheck aria-hidden="true" /> {note}
        </p>
      ) : null}
      {state.status !== "ready" ? (
        <LoadNotice label="projects" retry={reload} state={state} />
      ) : state.projects.length === 0 ? (
        <p className="admin-status">No projects.</p>
      ) : matchingProjects.length === 0 ? (
        <p className="admin-status">
          {selectedProject ? "Project not found." : "No matching projects."}
        </p>
      ) : selectedProject ? (
        matchingProjects.map((project) => {
          const status = projectState(project);
          const saved = (message: string) => {
            setNote(message);
            reload();
          };
          return (
            <article
              className="admin-card admin-project-detail"
              key={project.id}
            >
              <header className="admin-project-heading">
                <div>
                  <h3 id="admin-project-title" tabIndex={-1}>
                    {project.manifest.name}
                  </h3>
                  <span className="admin-project-id">{project.id}</span>
                </div>
                <div className="admin-action-bar">
                  <StatusBadge tone={status.tone} icon={status.icon}>
                    {status.label}
                  </StatusBadge>
                  <a
                    className="admin-icon-button"
                    href={`/projects/${project.manifest.slug}`}
                    aria-label="View public project"
                    title="View public project"
                  >
                    <ArrowUpRight aria-hidden="true" />
                  </a>
                </div>
              </header>
              <nav
                className="admin-section-nav"
                aria-label="Project administration"
              >
                {(
                  [
                    ["overview", "Overview", LayoutGrid],
                    ["security", "Security", ShieldCheck],
                    ["settings", "Settings", Settings2],
                    ["skills", "Skills", Code2],
                  ] as const
                ).map(([id, label, Icon]) => (
                  <Link
                    key={id}
                    href={adminHref(project.id, id)}
                    ariaCurrent={section === id ? "page" : undefined}
                  >
                    <Icon aria-hidden="true" /> {label}
                  </Link>
                ))}
              </nav>
              {section === "overview" ? (
                <>
                  <dl className="admin-facts">
                    <div>
                      <dt>Repositories</dt>
                      <dd className="admin-repositories">
                        {project.manifest.repositories.map((repo) => (
                          <a
                            key={repo.id}
                            href={`https://github.com/${repo.id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <FolderGit2 aria-hidden="true" /> {repo.id}{" "}
                            <ArrowUpRight aria-hidden="true" />
                          </a>
                        ))}
                      </dd>
                    </div>
                    <div>
                      <dt>Discovery placement</dt>
                      <dd>{project.manifest.listingTier}</dd>
                    </div>
                    <div>
                      <dt>Revision</dt>
                      <dd>
                        {project.revision} · updated{" "}
                        {formatDateTime(project.updatedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt>Reward asset</dt>
                      <dd>
                        {project.manifest.rewardAsset
                          ? `${project.manifest.rewardAsset.symbol} · ${networkName(project.manifest.rewardAsset.network)}`
                          : "Not set"}
                      </dd>
                    </div>
                  </dl>
                  <ProjectEnforcementPanel onDone={saved} project={project} />
                  <DelistButton onDone={saved} project={project} />
                </>
              ) : section === "security" ? (
                <VettingSection projectId={project.id} />
              ) : section === "settings" ? (
                <ProjectEditor
                  key={`${project.id}:${project.revision}`}
                  project={project}
                  onCancel={backToOverview}
                  onSaved={(message) => {
                    saved(message);
                    backToOverview();
                  }}
                />
              ) : (
                <GeneratedSkillPreview
                  manifest={project.manifest}
                  registry={{
                    revision: project.revision,
                    manifestSha256: project.manifestSha256,
                  }}
                  collapsible={false}
                />
              )}
            </article>
          );
        })
      ) : (
        <div className="admin-project-list">
          {matchingProjects.map((project) => {
            const status = projectState(project);
            return (
              <Link
                key={project.id}
                href={adminHref(project.id)}
                className="admin-project-row"
                ariaLabel={`Open ${project.manifest.name}`}
              >
                <FolderGit2 className="admin-project-icon" aria-hidden="true" />
                <div className="admin-project-name">
                  <h3>{project.manifest.name}</h3>
                  <p>
                    {project.manifest.repositories
                      .map((repo) => repo.id)
                      .join(", ")}
                  </p>
                </div>
                <StatusBadge tone={status.tone} icon={status.icon}>
                  {status.label}
                </StatusBadge>
                <ArrowRight className="admin-row-arrow" aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      )}
    </section>
  );
}

/** The parts of `GET /api/v1/admin/fee-conversions` this page shows. */
type FeeConversionReport = {
  routes: {
    network: string;
    targetToken: string | null;
    status: "usdc" | "not_converted";
  }[];
  totals: {
    network: string;
    token: string;
    targetToken: string;
    conversions: number;
    amountIn: string;
    amountOut: string;
  }[];
};

const loadFeeConversions = async () => {
  const { routes, totals } = await projectApiRequest<FeeConversionReport>(
    "GET",
    "admin/fee-conversions",
  );
  return { routes, totals };
};

function networkName(network: string): string {
  return Object.hasOwn(NETWORK_NAMES, network)
    ? NETWORK_NAMES[network as RewardAssetNetwork]
    : network;
}

function tokenLabel(address: string): string {
  return `token ${address}`;
}

/** Output in the network's reviewed stablecoin decimals, else exact base units. */
function convertedAmount(
  network: string,
  targetToken: string,
  amount: string,
): string {
  const stablecoin = Object.hasOwn(REWARD_ASSET_NETWORKS, network)
    ? REWARD_ASSET_NETWORKS[network as RewardAssetNetwork].stablecoin
    : null;
  const reviewed =
    stablecoin !== null &&
    (network === "solana"
      ? stablecoin.address === targetToken
      : stablecoin.address.toLowerCase() === targetToken.toLowerCase());
  return reviewed
    ? `${formatBaseUnits(amount, stablecoin.decimals)} ${stablecoin.symbol}`
    : `${amount} base units of ${tokenLabel(targetToken)}`;
}

/**
 * PRD section 6: fees received on Base, Ethereum and Solana convert to USDC.
 * Robinhood Chain keeps each received asset and shows it as "not converted",
 * not pending. Totals count finalized live conversions only.
 */
function FeeConversionsSection() {
  const [state, reload] = usePublicResource(
    true,
    loadFeeConversions,
    "Fee conversions could not load.",
  );
  return (
    <section aria-labelledby="admin-fee-conversions" className="admin-section">
      <div className="admin-section-heading">
        <h2 id="admin-fee-conversions">Fee conversions</h2>
      </div>
      {state.status !== "ready" ? (
        <LoadNotice label="fee conversions" retry={reload} state={state} />
      ) : (
        <article className="admin-card">
          <dl className="admin-facts">
            {state.routes.map((route) => {
              const totals = state.totals.filter(
                (total) => total.network === route.network,
              );
              return (
                <div key={route.network}>
                  <dt>{networkName(route.network)}</dt>
                  <dd>
                    <StatusBadge tone="neutral">
                      {route.status === "usdc" ? "USDC" : "Not converted"}
                    </StatusBadge>
                  </dd>
                  {totals.length > 0 ? (
                    totals.map((total) => (
                      <dd key={total.token}>
                        {total.conversions}{" "}
                        {total.conversions === 1 ? "conversion" : "conversions"}
                        : {total.amountIn} base units of{" "}
                        {tokenLabel(total.token)} to{" "}
                        {convertedAmount(
                          total.network,
                          total.targetToken,
                          total.amountOut,
                        )}
                      </dd>
                    ))
                  ) : route.status === "usdc" ? (
                    <dd>No conversions</dd>
                  ) : null}
                </div>
              );
            })}
          </dl>
        </article>
      )}
    </section>
  );
}

export default function AdminPage() {
  const [location, setLocation] = useState(() => new URL(window.location.href));
  useEffect(() => {
    const read = () => setLocation(new URL(window.location.href));
    window.addEventListener("popstate", read);
    window.addEventListener("hashchange", read);
    return () => {
      window.removeEventListener("popstate", read);
      window.removeEventListener("hashchange", read);
    };
  }, []);
  const selectedProject = location.searchParams.get("project") || null;
  const requestedSection = location.searchParams.get("section");
  const section: ProjectSection =
    requestedSection === "security" ||
    requestedSection === "settings" ||
    requestedSection === "skills"
      ? requestedSection
      : location.hash === "#admin-vetting"
        ? "security"
        : "overview";
  const fees = !selectedProject && requestedSection === "fees";
  const state = useProjectSession();
  let body: ReactNode;
  if (state.status !== "signed-in") {
    body = (
      <SignInPanel
        next={`${location.pathname}${location.search}`}
        state={state}
      />
    );
  } else if (!state.session.admin) {
    body = (
      <p className="form-error" role="alert">
        <CircleAlert aria-hidden="true" /> @{state.session.githubLogin} is not a
        Slop admin.
      </p>
    );
  } else {
    body = (
      <>
        <nav
          className="admin-section-nav admin-primary-nav"
          aria-label="Administration"
        >
          <Link href="/admin" ariaCurrent={!fees ? "page" : undefined}>
            <FolderGit2 aria-hidden="true" /> Projects
          </Link>
          <Link
            href={adminHref(null, "fees")}
            ariaCurrent={fees ? "page" : undefined}
          >
            <Coins aria-hidden="true" /> Fee conversions
          </Link>
        </nav>
        {fees ? (
          <FeeConversionsSection />
        ) : (
          <ProjectsSection
            selectedProject={selectedProject}
            section={section}
          />
        )}
      </>
    );
  }
  return (
    <main className="shell route-main admin-page operations-page">
      <RoutePageHeader icon={<ShieldCheck />} title="Admin" />
      {body}
    </main>
  );
}
