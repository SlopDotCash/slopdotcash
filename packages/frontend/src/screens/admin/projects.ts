// spec/backend/projects.md, "Administrators hold, delist, change the steward or place a project"; spec/security/enforcement.md, "A moderator quarantines a clear project or bans it, and decides a service ban"; spec/frontend/navigation.md, "Administration sections and project selection are parameters of the one Administration page"
import type { AdminListedProject } from "@repo/backend/client";
import { type Chain, isChain } from "@repo/settlement/kernels/networks";
import type { StatusProps } from "@repo/ui";
import { Result, Schema } from "effect";
import { type AdminSectionParam, type AdminView, adminView } from "../../../gen/frontend__navigation.ts";
import { CHAIN_NAMES } from "../../kernels/assetText.ts";

type Presentation = StatusProps["presentation"];

export const AdminAsset = Schema.Struct({
  network: Schema.String,
  kind: Schema.Literals(["stablecoin", "token", "native"]),
  address: Schema.String,
  symbol: Schema.String,
  decimals: Schema.Number,
  verifiedAt: Schema.optional(Schema.String),
});

export const AdminManifest = Schema.Struct({
  name: Schema.String,
  slug: Schema.String,
  listingTier: Schema.String,
  repositories: Schema.Array(Schema.Struct({ id: Schema.String })),
  reward: Schema.Struct({ kind: Schema.String, chain: Schema.optional(Schema.String) }),
  rewardAsset: Schema.optional(AdminAsset),
  contribution: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

export type AdminAsset = typeof AdminAsset.Type;
export type AdminManifest = typeof AdminManifest.Type;
export type ListedProject = typeof AdminListedProject.Type;
export type Enforcement = ListedProject["enforcement"];
export type JsonRecord = Readonly<Record<string, unknown>>;

export interface AdminProject {
  readonly id: string;
  readonly status: string;
  readonly revision: number;
  readonly manifestSha256: string;
  readonly updatedAt: string;
  readonly enforcement: Enforcement;
  readonly raw: JsonRecord;
  readonly manifest: AdminManifest;
}

export type ProjectSection = "overview" | "security" | "settings" | "skills";

export interface AdminAddress {
  readonly project: string | null;
  readonly view: AdminView;
}

const decodeManifest = Schema.decodeUnknownResult(AdminManifest);

/** @throws {never} */
export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Each listed project with its manifest read for this page, or nothing when one manifest is not a project manifest. @throws {never} */
export function adminProjectsOf(listed: ReadonlyArray<ListedProject>): ReadonlyArray<AdminProject> | undefined {
  const projects: AdminProject[] = [];
  for (const project of listed) {
    const decoded = decodeManifest(project.manifest);
    if (!isRecord(project.manifest) || Result.isFailure(decoded)) return undefined;
    projects.push({ id: project.id, status: project.status, revision: project.revision, manifestSha256: project.manifestSha256, updatedAt: project.updatedAt, enforcement: project.enforcement, raw: project.manifest, manifest: decoded.success });
  }
  return projects;
}

const sectionParams: Readonly<Record<string, AdminSectionParam>> = { security: "SectionSecurity", settings: "SectionSettings", skills: "SectionSkills", fees: "SectionFees" };

const projectSections: Readonly<Record<AdminView, ProjectSection>> = { AdminOverview: "overview", AdminSecurity: "security", AdminSettings: "settings", AdminSkills: "skills", AdminFees: "overview" };

/** The project and view an Administration address asks for. @throws {never} */
export function adminAddressOf(address: string): AdminAddress {
  const url = new URL(address, "https://slop.invalid");
  const project = url.searchParams.get("project") || null;
  const section = url.searchParams.get("section");
  const param = section === null ? "SectionAbsent" : Object.hasOwn(sectionParams, section) ? (sectionParams[section] ?? "SectionOther") : "SectionOther";
  return { project, view: adminView({ section: param, projectSelected: project !== null, vettingFragment: url.hash === "#admin-vetting" }) };
}

/** @throws {never} */
export function projectSectionOf(view: AdminView): ProjectSection {
  return projectSections[view];
}

/** @throws {never} */
export function adminHref(projectId: string | null, section: ProjectSection | "fees" = "overview"): string {
  const params = new URLSearchParams();
  if (projectId) params.set("project", projectId);
  if (section !== "overview") params.set("section", section);
  return `/admin${params.size ? `?${params}` : ""}`;
}

/** @throws {never} */
export function projectPresentation(project: AdminProject): Presentation {
  const { state, decisionRequired } = project.enforcement;
  const restricted = state !== "clear";
  const label = decisionRequired ? "Decision needed" : restricted ? state : project.status;
  const tone = decisionRequired || state === "banned" ? "Negative" : restricted || project.status !== "active" ? "Caution" : "Positive";
  const icon = decisionRequired || restricted ? "Alert" : project.status === "active" ? "Check" : "Pause";
  return { tone, icon, label };
}

/** Projects that need a decision first, then the rest as listed; the selected project only, or those matching the search. @throws {never} */
export function shownProjects(projects: ReadonlyArray<AdminProject>, selected: string | null, query: string): ReadonlyArray<AdminProject> {
  const needle = query.trim().toLowerCase();
  return [...projects]
    .sort((a, b) => Number(b.enforcement.decisionRequired) - Number(a.enforcement.decisionRequired))
    .filter((project) => (selected ? project.id === selected : `${project.id} ${project.manifest.name} ${project.manifest.repositories.map((repository) => repository.id).join(" ")}`.toLowerCase().includes(needle)));
}

/** @throws {never} */
export function projectCounts(projects: ReadonlyArray<AdminProject>): { readonly total: number; readonly active: number; readonly review: number } {
  return { total: projects.length, active: projects.filter((project) => project.status === "active").length, review: projects.filter((project) => project.enforcement.decisionRequired).length };
}

/** @throws {never} */
export function chainOf(network: string): Chain | undefined {
  return isChain(network) ? network : undefined;
}

/** @throws {never} */
export function networkName(network: string): string {
  const chain = chainOf(network);
  return chain === undefined ? network : CHAIN_NAMES[chain];
}
