/**
 * Display labels for every Slopbot penalty category, for contributor-facing
 * surfaces (the profile Penalty history). The names of the published rows
 * are the published penalty table's (PRD section 7; the canonical table is
 * PENALTY_TABLE in workers/slopbot/penalties.ts). The bot's `empty` and
 * `missing_evidence` categories are not published rows and have no
 * published name; they carry the plain wording of their keys so a profile
 * never renders the raw key itself.
 */
import type { Category } from "../../workers/slopbot/contracts";

export const PENALTY_CATEGORY_LABELS: Record<
  Exclude<Category, "none">,
  string
> = {
  spam: "Spam",
  scam: "Scam or malicious",
  busywork: "Clear violation of a quoted project rule",
  gaming: "Clear violation of a quoted project rule",
  low_quality: "Low quality",
  duplicate: "Duplicate",
  out_of_scope: "Out of scope",
  empty: "Empty",
  missing_evidence: "Missing evidence",
};
