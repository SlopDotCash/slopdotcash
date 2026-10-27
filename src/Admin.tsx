/**
 * The admin surface for registry exceptions: revisions owners cannot publish
 * themselves, restrictions and security vetting. Owners create and update
 * their projects through self-service setup, so nothing here approves
 * routine work. Authority is decided by the API on every request; this view
 * only hides controls a session cannot use.
 */

import { CircleAlert, RotateCcw, ShieldCheck } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { ProjectEnforcementPanel } from "./AdminProjectEnforcement";
import "./operations-design.css";
import { ActivationClearance, VettingSection } from "./AdminVetting";
import { GeneratedSkillPreview } from "./GeneratedSkillPreview";
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
import { usesGeneratedSkills } from "./lib/project-skill.mjs";
import {
  NETWORK_NAMES,
  REWARD_ASSET_NETWORKS,
  type RewardAssetNetwork,
  rewardAssetChoice,
} from "./lib/reward-asset.mjs";
import { usePublicResource } from "./lib/use-public-resource";
import {
  formatDateTime,
  MetricGrid,
  MetricTile,
  RoutePageHeader,
  SignInPanel,
  StatusBadge,
} from "./Presentation";

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
  kind: "stablecoin" | "token";
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
  const [instructionsOpen, setInstructionsOpen] = useState(false);
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
      {draftError ? (
        <p role="status">
          This browser cannot preserve your draft. Keep this editor open until
          saved.
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
        <p className="admin-status">
          Activation needs verified authority, Slopbot, and a{" "}
          <a href="#admin-vetting">passed scan</a> or the existing-project
          exemption.
        </p>
      </fieldset>
      <fieldset className="admin-fieldset">
        <legend>Discovery</legend>
        <label>
          Discovery placement
          <select
            value={String(
              projectFields?.listingTier ?? project.manifest.listingTier,
            )}
            onChange={(event) => {
              setStatus("paused");
              setText(
                JSON.stringify(
                  { ...projectFields, listingTier: event.target.value },
                  null,
                  2,
                ),
              );
            }}
          >
            <option value="community">Community</option>
            <option
              value="featured"
              disabled={project.enforcement.state !== "clear"}
            >
              Featured
            </option>
            <option value="retired" disabled={status !== "paused"}>
              Retired
            </option>
          </select>
        </label>
        <p className="admin-status">
          Changing placement pauses the project. Featured needs security
          clearance and activation.
        </p>
      </fieldset>
      <details
        onToggle={(event) => setInstructionsOpen(event.currentTarget.open)}
        open={
          instructionsOpen ||
          Object.values(skillErrors).some((value) => value !== null)
        }
      >
        <summary>Customize contributor instructions</summary>
        <fieldset className="admin-fieldset">
          <legend>Contribution fields</legend>
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
                rows={field === "securityContact" ? 1 : 4}
                value={skill[field]}
              />
              {skillErrors[field] ? (
                <small className="field-error">{skillErrors[field]}</small>
              ) : (
                <small className="field-hint">
                  {CONTRIBUTION_LABELS[field].hint}
                </small>
              )}
            </label>
          ))}
        </fieldset>
      </details>
      <fieldset className="admin-fieldset">
        <legend>Reward asset</legend>
        {!assetSelected ? (
          <p>
            No reward asset is set.{" "}
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
                ...(current.kind === "stablecoin"
                  ? {
                      address: REWARD_ASSET_NETWORKS[id].stablecoin.address,
                      symbol: REWARD_ASSET_NETWORKS[id].stablecoin.symbol,
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
                  kind === "stablecoin" ? network.stablecoin.address : "",
                symbol: kind === "stablecoin" ? network.stablecoin.symbol : "",
              }));
            }}
            value={asset.kind}
          >
            <option value="stablecoin">
              {network.stablecoin.symbol} (network stablecoin)
            </option>
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
      <details>
        <summary>
          Advanced project settings (revision {project.revision})
        </summary>
        <label>
          Other fields
          <textarea
            className="admin-manifest"
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            value={text}
          />
        </label>
      </details>
      <section aria-label="Revision changes">
        <h3>Review changes</h3>
        {previewError ? (
          <p role="status">{previewError}</p>
        ) : changedFields.length === 0 ? (
          <p>No changes.</p>
        ) : (
          changedFields.map((field) => (
            <details key={field}>
              <summary>{field}</summary>
              <p>Current</p>
              <pre>
                {JSON.stringify(
                  (project.manifest as unknown as Record<string, unknown>)[
                    field
                  ],
                  null,
                  2,
                ) ?? "Not set"}
              </pre>
              <p>Proposed</p>
              <pre>
                {JSON.stringify(preview?.[field], null, 2) ?? "Removed"}
              </pre>
            </details>
          ))
        )}
      </section>
      <label>
        Reason for this revision (public history)
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
        {busy ? "Saving…" : `Save revision ${project.revision + 1}`}
      </button>
      <button
        type="button"
        className="button secondary-button"
        disabled={busy}
        onClick={onCancel}
      >
        Close and keep draft
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
        Discard draft
      </button>
    </form>
  );
}

/** Public reads are edge cached for 30 seconds and purged on each write. */
const SAVED_NOTE =
  "Saved. Pages update within a minute; points at the next release.";

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
  if (project.manifest.listingTier === "retired")
    return <p className="admin-status">Delisted.</p>;
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
            Delist
          </button>
        </div>
      )}
    </div>
  );
}

function ProjectsSection({
  onChanged,
  selectedProject,
  onSelect,
}: {
  onChanged: () => void;
  selectedProject: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [state, reload] = usePublicResource(
    true,
    loadAdminProjects,
    "Something went wrong.",
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Confirmed malicious results that wait for a moderator decision come
  // first (PRD sections 2 and 8).
  const matchingProjects =
    state.status === "ready"
      ? [
          ...state.projects.filter(
            (project) => project.enforcement.decisionRequired,
          ),
          ...state.projects.filter(
            (project) => !project.enforcement.decisionRequired,
          ),
        ].filter((project) =>
          selectedProject
            ? project.id === selectedProject
            : `${project.id} ${project.manifest.name} ${project.manifest.repositories.map((repo) => repo.id).join(" ")}`
                .toLowerCase()
                .includes(query.trim().toLowerCase()),
        )
      : [];
  return (
    <section aria-labelledby="admin-projects" className="admin-section">
      <div className="admin-section-heading">
        <h2 id="admin-projects">Projects</h2>
      </div>
      {!selectedProject && state.status === "ready" ? (
        <MetricGrid className="operations-summary">
          <MetricTile label="Registered" value={state.projects.length} />
          <MetricTile
            label="Active"
            value={
              state.projects.filter((project) => project.status === "active")
                .length
            }
            tone="success"
          />
          <MetricTile
            label="Need moderator"
            value={
              state.projects.filter(
                (project) => project.enforcement.decisionRequired,
              ).length
            }
            tone="warning"
          />
        </MetricGrid>
      ) : null}
      {selectedProject ? (
        <button
          type="button"
          className="button secondary-button"
          onClick={() => onSelect(null)}
        >
          All projects
        </button>
      ) : (
        <label>
          Find a project
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Project or repository"
          />
        </label>
      )}
      {note ? (
        <p className="admin-status" role="status">
          {note}
        </p>
      ) : null}
      {state.status !== "ready" ? (
        <LoadNotice label="projects" retry={reload} state={state} />
      ) : state.projects.length === 0 ? (
        <p className="admin-status">No projects are listed yet.</p>
      ) : (
        <>
          {matchingProjects.length === 0 ? <p>No projects match.</p> : null}
          {matchingProjects.map((project) =>
            selectedProject ? (
              <article className="admin-card" key={project.id}>
                <header>
                  <h3>{project.manifest.name}</h3>
                  <StatusBadge
                    tone={project.status === "active" ? "success" : "warning"}
                  >
                    {project.status}
                  </StatusBadge>
                </header>
                <details className="admin-reference">
                  <summary>
                    Project configuration · revision {project.revision}
                  </summary>
                  <dl className="admin-facts">
                    <div>
                      <dt>Project id</dt>
                      <dd>{project.id}</dd>
                    </div>
                    <div>
                      <dt>Revision</dt>
                      <dd>
                        {project.revision} · updated{" "}
                        {formatDateTime(project.updatedAt)}
                      </dd>
                    </div>
                    <div>
                      <dt>Skills</dt>
                      <dd>
                        {usesGeneratedSkills(project.manifest)
                          ? `Generated from revision ${project.revision}`
                          : `${project.manifest.skill.sourcePath} · ${project.manifest.reviewSkill.sourcePath}`}
                      </dd>
                    </div>
                  </dl>
                  <GeneratedSkillPreview
                    manifest={project.manifest}
                    registry={{
                      revision: project.revision,
                      manifestSha256: project.manifestSha256,
                    }}
                  />
                </details>
                {editing === project.id ? (
                  <ProjectEditor
                    key={`${project.id}:${project.revision}`}
                    onCancel={() => setEditing(null)}
                    onSaved={(saved) => {
                      setEditing(null);
                      setNote(saved);
                      reload();
                      onChanged();
                    }}
                    project={project}
                  />
                ) : (
                  <button
                    className="button secondary-button"
                    onClick={() => setEditing(project.id)}
                    type="button"
                  >
                    Edit project
                  </button>
                )}
                <DelistButton
                  onDone={(saved) => {
                    setNote(saved);
                    reload();
                    onChanged();
                  }}
                  project={project}
                />
                <ProjectEnforcementPanel
                  onDone={(saved) => {
                    setNote(saved);
                    reload();
                    onChanged();
                  }}
                  project={project}
                />
              </article>
            ) : (
              <article
                className="admin-card admin-project-summary"
                key={project.id}
              >
                <div>
                  <h3>{project.manifest.name}</h3>
                  <p>
                    {project.id} · Revision {project.revision} ·{" "}
                    {project.manifest.listingTier}
                  </p>
                  <StatusBadge
                    tone={
                      project.enforcement.decisionRequired
                        ? "danger"
                        : project.status === "active"
                          ? "success"
                          : "warning"
                    }
                  >
                    {project.status}
                  </StatusBadge>
                  {project.enforcement.decisionRequired ? (
                    <p className="form-error">
                      <CircleAlert aria-hidden="true" /> Moderator decision
                      needed: confirmed malicious result
                    </p>
                  ) : null}
                </div>
                <button
                  className="button secondary-button"
                  type="button"
                  onClick={() => onSelect(project.id)}
                >
                  Open {project.manifest.name}
                </button>
              </article>
            ),
          )}
        </>
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
                      {route.status === "usdc"
                        ? "USDC conversion policy"
                        : "Not converted"}
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
                  ) : (
                    <dd>
                      {route.status === "usdc"
                        ? "No finalized conversion yet."
                        : "Received assets stay in the fee wallet."}
                    </dd>
                  )}
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
  const [selectedProject, setSelectedProject] = useState(() =>
    new URLSearchParams(window.location.search).get("project"),
  );
  useEffect(() => {
    const read = () =>
      setSelectedProject(
        new URLSearchParams(window.location.search).get("project"),
      );
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  const selectProject = (id: string | null) => {
    const url = id
      ? `/admin?${new URLSearchParams({ project: id })}`
      : "/admin";
    window.history.pushState(window.history.state, "", url);
    setSelectedProject(id);
  };
  const state = useProjectSession();
  const [vettingVersion, setVettingVersion] = useState(0);
  let body: ReactNode;
  if (state.status !== "signed-in") {
    body = (
      <SignInPanel
        next={`${window.location.pathname}${window.location.search}`}
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
        <ProjectsSection
          key={selectedProject ?? "list"}
          selectedProject={selectedProject}
          onSelect={selectProject}
          onChanged={() => setVettingVersion((value) => value + 1)}
        />
        {selectedProject ? (
          <VettingSection
            projectId={selectedProject}
            key={`vetting-${selectedProject}-${vettingVersion}`}
          />
        ) : (
          <FeeConversionsSection />
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
