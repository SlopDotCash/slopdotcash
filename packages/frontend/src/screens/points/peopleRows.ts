// spec/backend/accounts.md, "Public reads show only public open members and never publish anything"; spec/frontend/projections.md, "Monthly and lifetime standings sum the same accepted-work history"
import type { Person } from "@repo/backend/client";
import { type ProfileIndex, profileCounts } from "@repo/points/client";
import type { RegistryProject } from "../../reads/registry.vibe";

export interface ListedPerson {
  readonly id: string;
  readonly login: string;
  readonly merged: number | null;
  readonly member?: Person;
}

export const peoplePageSize = 24;

/** @throws {never} */
function objectOf(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Readonly<Record<string, unknown>>) : undefined;
}

/** The listed names of the projects each verified steward maintains, by GitHub node id. @throws {never} */
export function stewardsOf(projects: ReadonlyArray<RegistryProject>): ReadonlyMap<string, ReadonlyArray<string>> {
  const stewards = new Map<string, string[]>();
  for (const project of projects) {
    const verified = objectOf(project.authority)?.state === "verified";
    const nodeId = objectOf(objectOf(objectOf(project.steward)?.github))?.nodeId;
    if (!verified || typeof nodeId !== "string" || typeof project.name !== "string") continue;
    stewards.set(nodeId, [...(stewards.get(nodeId) ?? []), project.name]);
  }
  return stewards;
}

/** Everyone with a recorded pull request and every public member, once each by id, in login order. @throws {never} */
export function listedPeople(census: ProfileIndex | undefined, members: ReadonlyArray<Person> | undefined): ReadonlyArray<ListedPerson> {
  const byId = new Map<string, ListedPerson>();
  for (const person of census?.people ?? []) byId.set(person.id, { id: person.id, login: person.login, merged: profileCounts(person).merged });
  for (const member of members ?? []) {
    const known = byId.get(member.actor.id);
    byId.set(member.actor.id, { id: member.actor.id, login: known?.login ?? member.actor.login, merged: known?.merged ?? (census === undefined ? null : 0), member });
  }
  return [...byId.values()].sort((left, right) => left.login.localeCompare(right.login));
}

/** @throws {never} */
export function mergedText(merged: number | null): string {
  if (merged === null) return "PR count unavailable";
  if (merged === 0) return "No merged PRs";
  return `${merged.toLocaleString("en-US")} merged PR${merged === 1 ? "" : "s"}`;
}
