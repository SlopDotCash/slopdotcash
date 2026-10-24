/**
 * The admin surface for registry exceptions: revisions owners cannot publish
 * themselves, restrictions and security vetting. Owners create and update
 * their projects through self-service setup, so nothing here approves
 * routine work. Authority is decided by the API on every request; this view
 * only hides controls a session cannot use.
 */

import { CircleAlert, RotateCcw } from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { ProjectEnforcementPanel } from "./AdminProjectEnforcement";
import { ActivationClearance, VettingSection } from "./AdminVetting";
import { GeneratedSkillPreview } from "./GeneratedSkillPreview";
import { CONTRIBUTION_LABELS } from "./lib/contribution-fields";
import {
  type AdminProject,
  type ProjectSessionState,
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
  REWARD_ASSET_NETWORKS,
  type RewardAssetNetwork,
  rewardAssetChoice,
} from "./lib/reward-asset.mjs";
import { loginHref } from "./Points";
import { errorMessage, formatTime } from "./Presentation";

export function SignInPanel({
  state,
  next,
  purpose,
}: {
  state: Exclude<ProjectSessionState, { status: "signed-in" }>;
  next: string;
  purpose: string;
}) {
  if (state.status === "checking") {
    return (
      <p aria-live="polite" className="admin-status">
        Checking your GitHub session…
      </p>
    );
  }
  return (
    <div className="sign-in-panel">
      <p>{purpose}</p>
      {state.status === "error" ? (
        <p className="form-error" role="alert">
          <CircleAlert aria-hidden="true" /> {state.message}
        </p>
      ) : null}
      <a className="button primary-button" href={loginHref(next)}>
        Sign in with GitHub
      </a>
    </div>
  );
}

type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; value: T };

function useAdminData<T>(
  path: string,
  select: (body: never) => T,
): [LoadState<T>, () => void] {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  // Only the newest request may settle, so a slow reply cannot overwrite a
  // retry or a newer tab selection.
  const generation = useRef(0);
  const load = useCallback(() => {
    const current = ++generation.current;
    setState({ status: "loading" });
    projectApiRequest<never>("GET", path).then(
      (body) => {
        if (generation.current === current) {
          setState({ status: "ready", value: select(body) });
        }
      },
      (error: unknown) => {
        if (generation.current === current) {
          setState({ status: "error", message: errorMessage(error) });
        }
      },
    );
  }, [path, select]);
  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, [load]);
  return [state, load];
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

const selectProjects = (body: { projects: AdminProject[] }) => body.projects;

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
          ? `${CONTRIBUTION_LABELS[field].label} must be ${minimum} to 2000 characters.`
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
      <p role="status">
        {draftError
          ? "This browser cannot preserve your draft. Keep this editor open until saved."
          : "Draft kept in this browser tab for this project revision."}
      </p>
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
          Activation requires verified authority, approved terms, generated
          skills and security clearance for this exact revision. Save content
          changes paused, review both skill previews, then complete the{" "}
          <a href="#admin-vetting">security review</a> before activation.
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
          Changing placement pauses the project for review. Featuring starts
          after security clearance and activation. The revision records your
          reason.
        </p>
      </fieldset>
      <details
        open={Object.values(skillErrors).some((value) => value !== null)}
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
            No reward asset is set. The values below are suggestions.{" "}
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
        <p className="admin-status">
          {project.manifest.rewardAsset
            ? `Stored: ${project.manifest.rewardAsset.symbol}, ${project.manifest.rewardAsset.decimals} decimals, verified ${formatTime(project.manifest.rewardAsset.verifiedAt)} UTC.`
            : "No reward asset is stored yet."}{" "}
          A changed token is read from chain once when you save.
        </p>
      </fieldset>
      <details>
        <summary>
          Advanced project settings (revision {project.revision})
        </summary>
        <label>
          Other manifest fields
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
  "Saved. The public site shows the change within a minute. Leaderboard, points, and profile data follow at the next scheduled release, which runs every 6 hours.";

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
          <span>Hide this project from every page and list?</span>
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
  const [state, reload] = useAdminData("admin/projects", selectProjects);
  const [editing, setEditing] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const matchingProjects =
    state.status === "ready"
      ? state.value.filter((project) =>
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
      ) : state.value.length === 0 ? (
        <p className="admin-status">No projects are listed yet.</p>
      ) : (
        <>
          {matchingProjects.length === 0 ? <p>No projects match.</p> : null}
          {matchingProjects.map((project) =>
            selectedProject ? (
              <article className="admin-card" key={project.id}>
                <header>
                  <h3>{project.manifest.name}</h3>
                  <span className={`admin-badge admin-badge-${project.status}`}>
                    {project.status}
                  </span>
                </header>
                <dl className="admin-facts">
                  <div>
                    <dt>Project id</dt>
                    <dd>{project.id}</dd>
                  </div>
                  <div>
                    <dt>Revision</dt>
                    <dd>
                      {project.revision} · updated{" "}
                      {formatTime(project.updatedAt)} UTC
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
                    Edit manifest
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
                    {project.id} · {project.status} ·{" "}
                    {project.manifest.listingTier}
                  </p>
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

export function AdminPage() {
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
        purpose="Admins sign in with GitHub to handle registry exceptions."
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
        ) : null}
      </>
    );
  }
  return (
    <main className="shell route-main admin-page">
      <div className="admin-intro">
        <h1>Admin</h1>
        {state.status === "signed-in" ? (
          <p>Signed in as @{state.session.githubLogin}.</p>
        ) : null}
      </div>
      {body}
    </main>
  );
}

export default AdminPage;
