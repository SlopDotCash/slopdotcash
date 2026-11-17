import { readFile } from "node:fs/promises";
import type { RepositoryRegistry } from "../../../src/client/snapshot/schema.vibe";

const root = new URL("../../../../../", import.meta.url);

export const historyText = () => readFile(new URL("data/points/history.json", root), "utf8");

export async function reviewHistory(): Promise<ReadonlyArray<unknown>> {
  const parsed: unknown = JSON.parse(await readFile(new URL("data/accepted-review-history.json", root), "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("events" in parsed) || !Array.isArray(parsed.events)) throw new TypeError("accepted review history has no events");
  return parsed.events;
}

export async function snapshotFile(): Promise<{ readonly text: string; readonly value: unknown }> {
  const text = await readFile(new URL("../u2/cycles/eliza/2026-09/source-snapshot.json", import.meta.url), "utf8");
  return { text, value: JSON.parse(text) };
}

const repository = (owner: string, name: string, projectId: string, nodeId: string) => ({
  id: `${owner}/${name}`,
  owner,
  name,
  displayName: name,
  githubUrl: `https://github.com/${owner}/${name}`,
  description: name,
  integrationBranch: "main",
  projectId,
  nodeId,
  aliases: [],
});

const registered = [
  repository("elizaOS", "eliza", "eliza", "R_kgDOMT5cIg"),
  repository("elizaOS", "asi", "asi", "R_kgDOPgNvVQ"),
  repository("elizaOS", "proximityprize", "delta-star", "R_kgDOPgr5ZA"),
  repository("heirlabs", "element-sdk", "heir-elements-sdk", "R_kgDOO9z3Lw"),
];

export const registry: RepositoryRegistry = {
  registered,
  targets: registered,
  projects: [...new Set(registered.map((entry) => entry.projectId))].map((id) => ({ id, skillSourcePath: "SKILL.md" })),
};
