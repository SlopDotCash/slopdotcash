// spec/backend/projects.md, "Owner revisions publish at once against the expected revision"; spec/backend/projects.md, "Appending a repository pauses the project and its work counts from next month"
import { type RevisionChanges, classifyRevisionChanges } from "./classify.ts";
import { canonical } from "./definition.ts";

export type { RevisionChanges } from "./classify.ts";

export type Json = { readonly [key: string]: unknown };

/** @throws {never} */
export function objectOf(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Json) : undefined;
}

/** @throws {never} */
export function same(left: unknown, right: unknown): boolean {
  return canonical(left ?? null) === canonical(right ?? null);
}

function list(value: unknown): ReadonlyArray<unknown> {
  return Array.isArray(value) ? value : [];
}

/** @throws {never} */
export function appendedRepositories(previous: Json, next: Json): ReadonlyArray<Json> | undefined {
  const before = list(previous.repositories);
  const after = list(next.repositories);
  if (after.length < before.length) return undefined;
  for (let index = 0; index < before.length; index += 1) if (!same(before[index], after[index])) return undefined;
  return after.slice(before.length).map((entry) => objectOf(entry) ?? {});
}

/** @throws {never} */
export function classified(previous: Json, next: Json): RevisionChanges {
  const fields = [...new Set([...Object.keys(previous), ...Object.keys(next)])].sort();
  const changed = fields.filter((field) => !same(previous[field], next[field]));
  return classifyRevisionChanges(changed, (appendedRepositories(previous, next)?.length ?? 0) > 0);
}
