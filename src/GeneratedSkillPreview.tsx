import { CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import contributorTemplate from "../skills/project-contributor-template/SKILL.md?raw";
import reviewerTemplate from "../skills/project-reviewer-template/SKILL.md?raw";
import { errorMessage } from "./lib/errors";
import {
  renderProjectSkill,
  usesGeneratedSkills,
} from "./lib/project-skill.mjs";
import type { ProjectDefinition } from "./lib/projects.mjs";

const decoder = new TextDecoder();

/**
 * Shows the exact generated SKILL.md and project.json a project revision
 * publishes (PRD section 4). The shared scripts come unchanged from the template.
 */
export function GeneratedSkillPreview({
  manifest,
  registry,
  draft = false,
  collapsible = true,
}: {
  manifest: Pick<
    ProjectDefinition,
    "id" | "skill" | "reviewSkill" | "repositories" | "contribution"
  >;
  registry?: { revision: number; manifestSha256: string };
  draft?: boolean;
  collapsible?: boolean;
}) {
  const [selectedRole, setSelectedRole] = useState("Contributor skill");
  const [selectedPath, setSelectedPath] = useState("SKILL.md");
  const manifestText = JSON.stringify(manifest);
  const [digestState, setDigestState] = useState<{
    source: string;
    digest?: string;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!draft) return;
    let active = true;
    crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(manifestText))
      .then((digest) => {
        if (active)
          setDigestState({
            source: manifestText,
            digest: Array.from(new Uint8Array(digest), (byte) =>
              byte.toString(16).padStart(2, "0"),
            ).join(""),
          });
      })
      .catch(() => {
        if (active)
          setDigestState({
            source: manifestText,
            error: "Could not prepare the skill preview. Reload and try again.",
          });
      });
    return () => {
      active = false;
    };
  }, [draft, manifestText]);
  const draftDigest =
    digestState?.source === manifestText ? digestState.digest : null;
  if (draft && digestState?.source === manifestText && digestState.error)
    return <p role="alert">{digestState.error}</p>;
  const provenance =
    registry ??
    (draftDigest ? { revision: 1, manifestSha256: draftDigest } : null);
  if (!provenance) return <p role="status">Preparing skill preview…</p>;
  if (!usesGeneratedSkills(manifest))
    return (
      <p className="admin-status">
        This project uses committed skills at {manifest.skill.sourcePath}.
      </p>
    );
  let previews: { role: string; files: Record<string, Uint8Array> }[];
  try {
    previews = [
      {
        role: "Contributor skill",
        files: renderProjectSkill({
          role: "contributor",
          templateFiles: { "SKILL.md": contributorTemplate },
          manifest,
          registry: provenance,
        }),
      },
      {
        role: "Reviewer skill",
        files: renderProjectSkill({
          role: "reviewer",
          templateFiles: { "SKILL.md": reviewerTemplate },
          manifest,
          registry: provenance,
        }),
      },
    ];
  } catch (caught) {
    return (
      <p className="form-error" role="alert">
        <CircleAlert aria-hidden="true" />{" "}
        {errorMessage(caught, "Could not render skills.")}
      </p>
    );
  }
  const preview =
    previews.find(({ role }) => role === selectedRole) ?? previews[0];
  const paths = Object.keys(preview.files);
  const path = paths.includes(selectedPath) ? selectedPath : paths[0];
  const content = (
    <>
      <div className="skill-preview-controls">
        <label>
          Skill
          <select
            value={preview.role}
            onChange={(event) => setSelectedRole(event.target.value)}
          >
            {previews.map(({ role }) => (
              <option key={role}>{role}</option>
            ))}
          </select>
        </label>
        <label>
          File
          <select
            value={path}
            onChange={(event) => setSelectedPath(event.target.value)}
          >
            {paths.map((entry) => (
              <option key={entry}>{entry}</option>
            ))}
          </select>
        </label>
        {draft ? <span className="admin-status">Draft preview</span> : null}
      </div>
      <textarea
        aria-label={`${preview.role} ${path}`}
        className="admin-code"
        readOnly
        spellCheck={false}
        value={decoder.decode(preview.files[path])}
      />
    </>
  );
  return collapsible ? (
    <details className="skill-preview">
      <summary>Preview generated skills</summary>
      {content}
    </details>
  ) : (
    <section className="skill-preview" aria-label="Generated skills">
      {content}
    </section>
  );
}
