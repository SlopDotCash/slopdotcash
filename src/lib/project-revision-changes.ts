/**
 * Classifies the fields an owner revision changes (PRD section 4, owner
 * decisions of 22 October 2026). One table decides what each change needs:
 *
 * - presentation: listing text, links and explicit Slopbot consent. Publishes
 *   at once; consent is authorization, not executable skill content.
 * - executable: the repository source and the maintainer-authored rules that
 *   generate the contributor and reviewer skills. Changes the recorded content
 *   digest; routine updates retain same-repository admission clearance.
 * - financial: reward, asset, vault and bounty policy. Applies prospectively.
 *
 * Every other field (identity, status, listing tier, steward, authority,
 * terms, model policy) is outside owner self-service and stays with the
 * reviewed exception paths.
 */
import { canonicalJson } from "./canonical-json";
import type { ProjectDefinition } from "./projects.mjs";

const PRESENTATION_FIELDS = [
  "name",
  "eyebrow",
  "headline",
  "description",
  "links",
  "slopbot",
] as const;

/**
 * The content a malicious-code scan covers: the project id, the repository
 * source it names and the inputs of the generated skills. A clearance binds
 * this actual content as evidence; admission eligibility is separately bound to
 * the immutable repository identity.
 */
const EXECUTABLE_FIELDS = [
  "id",
  "repositories",
  "skill",
  "reviewSkill",
  "contribution",
] as const;

const FINANCIAL_FIELDS = [
  "reward",
  "rewardAsset",
  "escrow",
  "funding",
  "securityBounty",
] as const;

type RevisionChangeClass = "presentation" | "executable" | "financial";

type RevisionChanges = Record<RevisionChangeClass, string[]> & {
  /** Changed fields that owner self-service may not publish. */
  restricted: string[];
};

const CLASS_OF = new Map<string, RevisionChangeClass>([
  ...PRESENTATION_FIELDS.map((field) => [field, "presentation"] as const),
  ...EXECUTABLE_FIELDS.map((field) => [field, "executable"] as const),
  ...FINANCIAL_FIELDS.map((field) => [field, "financial"] as const),
]);

/** Fields that are executable content but never change by owner revision. */
const OWNER_FIXED_FIELDS = new Set([
  "id",
  "repositories",
  "skill",
  "reviewSkill",
]);

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left ?? null) === canonicalJson(right ?? null);
}

/** The top-level manifest fields that differ, grouped by what they need. */
export function classifyRevisionChanges(
  previous: ProjectDefinition,
  next: ProjectDefinition,
): RevisionChanges {
  const changes: RevisionChanges = {
    presentation: [],
    executable: [],
    financial: [],
    restricted: [],
  };
  const fields = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const field of [...fields].sort()) {
    if (
      same(
        (previous as unknown as Record<string, unknown>)[field],
        (next as unknown as Record<string, unknown>)[field],
      )
    )
      continue;
    const kind = CLASS_OF.get(field);
    if (kind === undefined || OWNER_FIXED_FIELDS.has(field))
      changes.restricted.push(field);
    else changes[kind].push(field);
  }
  return changes;
}

/** The scanned content of a manifest, independent of status and listing. */
export function executableManifestContent(
  manifest: object,
): Record<string, unknown> {
  const source = manifest as Record<string, unknown>;
  return Object.fromEntries(
    EXECUTABLE_FIELDS.filter((field) => Object.hasOwn(source, field)).map(
      (field) => [field, source[field]],
    ),
  );
}
