import { CircleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import contributorTemplate from "../skills/project-contributor-template/SKILL.md?raw";
import reviewerTemplate from "../skills/project-reviewer-template/SKILL.md?raw";
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
}: {
  manifest: Pick<
    ProjectDefinition,
    "id" | "skill" | "reviewSkill" | "repositories" | "contribution"
  >;
  registry?: { revision: number; manifestSha256: string };
  draft?: boolean;
}) {
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
        {caught instanceof Error ? caught.message : "Could not render skills."}
      </p>
    );
  }
  return (
    <>
      {draft ? (
        <p>
          Draft skill preview. Approval determines the published revision and
          digest.
        </p>
      ) : null}
      {previews.map(({ role, files }) => (
        <details key={role}>
          <summary>Preview generated {role.toLowerCase()}</summary>
          {Object.entries(files).map(([path, contents]) => (
            <div key={path}>
              <h4>{path}</h4>
              {/* A read-only text area keeps long code keyboard-scrollable. */}
              <textarea
                aria-label={`${role} ${path}`}
                className="admin-code"
                readOnly
                spellCheck={false}
                value={decoder.decode(contents)}
              />
            </div>
          ))}
        </details>
      ))}
    </>
  );
}
