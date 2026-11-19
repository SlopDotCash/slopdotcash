// spec/contributor/workflow.md, "Submission requires exact attribution and a fresh pre-submission read"; spec/contributor/installation.md, "Local authorization uses only the verified installed files"
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { repoRoot } from "@repo/platform/testing/paths";
import { SIGNED_ATTRIBUTION_MARKER } from "../../../src/client/identity/record.schema.ts";
import { publishRevision } from "../installer/authority.ts";
import { fileOrigin, freshRoot, generatedArtifact, generatedAuthority, generatedCommand, generatedSkill, manifestFor, shellQuote, skillsDirectory, targetRepository, writeExecutable } from "../installer/harness.ts";
import { type Declared, type HeadlessClient, installedVersion } from "./clients.ts";

const agentTimeout = 600_000;
const recordsPath = join(import.meta.dirname, "..", "..", "..", ".cache", "agent-clients", "records.json");

export interface ClientRecord extends Declared {
  readonly workflow: "contributor-skill";
  readonly clientVersion: string;
  readonly sourceSha: string;
  readonly result: { readonly outcome: "pass" } | { readonly outcome: "fail"; readonly reason: string };
  readonly evidence: string;
}

export interface Observed {
  readonly record: ClientRecord;
  readonly recordedBy: string;
  readonly issues: ReadonlyArray<string>;
}

interface Workspace {
  readonly root: string;
  readonly installer: string;
  readonly skill: string;
  readonly target: string;
  readonly state: string;
}

/** @throws {Error} */
function workspace(client: HeadlessClient): Workspace {
  const root = freshRoot(`agent-${client.client}`);
  const manifest = manifestFor("Prefer small PRs.");
  const binding = publishRevision(root, manifest, 3);
  const { artifact } = generatedArtifact(root, manifest, binding);
  const home = join(root, "home");
  mkdirSync(home);
  const installer = join(root, "install.sh");
  writeExecutable(installer, `export CODEX_HOME=${shellQuote(join(root, "codex"))} HOME=${shellQuote(home)}\n${generatedCommand(fileOrigin(artifact), generatedAuthority(root), root)}\n`);
  const repository = manifest.repositories[0]?.id;
  if (typeof repository !== "string") throw new Error("the fixture manifest names no repository");
  return { root, installer, skill: join(skillsDirectory(root), generatedSkill), target: targetRepository(root, "target", repository), state: join(root, "state") };
}

function prompt(w: Workspace): string {
  const receipt = `XDG_CONFIG_HOME=${shellQuote(w.state)} node ${shellQuote(join(w.skill, "scripts", "run-receipt.mjs"))}`;
  return [
    "You are checking that the Slop contributor skill works in the agent client you are running in. Run exactly these shell steps in order, change no file yourself, and stop at the first failure.",
    `1. Install the project skill: bash ${shellQuote(w.installer)}`,
    `2. Read ${shellQuote(join(w.skill, "SKILL.md"))}, then run: ${receipt} authorize --json`,
    `3. Run: ${receipt} start --client <client> --provider <provider> --model <model> --lane contributor --repo-root ${shellQuote(w.target)} --usage-unavailable --json`,
    `4. Run: ${receipt} disclose --client <client> --provider <provider> --model <model>`,
    "For <client>, <provider> and <model> declare your own exact identity as the skill asks: the identifier of this agent client, the provider of the model you run on and the exact model identifier from your client's metadata. Never guess and never use a placeholder.",
    "End your answer with the footer step 4 printed, unchanged, and then one line `client-version: <exact version of this agent client>`, taken from the client itself.",
  ].join("\n");
}

function markerOf(output: string): unknown {
  const prefix = `<!-- ${SIGNED_ATTRIBUTION_MARKER} `;
  const line = output.split("\n").map((text) => text.trim()).find((text) => text.startsWith(prefix) && text.endsWith(" -->"));
  if (line === undefined) return undefined;
  try {
    return JSON.parse(line.slice(prefix.length, -" -->".length));
  } catch {
    return undefined;
  }
}

function declaredIn(value: unknown): Declared | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const { client, provider, model } = value as Record<string, unknown>;
  return typeof client === "string" && typeof provider === "string" && typeof model === "string" ? { client, provider, model } : undefined;
}

function mismatch(where: string, declared: Declared | undefined, expected: Declared): ReadonlyArray<string> {
  if (declared === undefined) return [`${where} names no client, provider and model`];
  return (["client", "provider", "model"] as const)
    .filter((field) => declared[field] !== expected[field])
    .map((field) => `${where} names ${field} ${JSON.stringify(declared[field])}, not ${JSON.stringify(expected[field])}`);
}

function startedRun(state: string): unknown {
  const active = join(state, "slop", "runs", "active");
  const runs = existsSync(active) ? readdirSync(active).filter((name) => name.endsWith(".json")) : [];
  return runs.length === 1 && runs[0] !== undefined ? JSON.parse(readFileSync(join(active, runs[0]), "utf8")) : undefined;
}

/** @throws {Error} */
function testedSource(): string {
  const sourceSha = execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const changed = execFileSync("git", ["-C", repoRoot, "status", "--porcelain"], { encoding: "utf8" }).trim();
  if (changed !== "") throw new Error(`the working tree differs from ${sourceSha}, so no record could name the source that was tested`);
  return sourceSha;
}

/** @throws {Error} */
export function observeClient(client: HeadlessClient): Observed {
  const recordedBy = process.env.GITHUB_ACTOR ?? "";
  if (recordedBy === "") throw new Error("GITHUB_ACTOR names no GitHub login to record these results by");
  const sourceSha = testedSource();
  const clientVersion = installedVersion(client);
  if (clientVersion === undefined) throw new Error(`${client.binary} --version reports no exact release`);
  const w = workspace(client);
  const ran = spawnSync(client.binary, client.invocation({ prompt: prompt(w), workspace: w.root, model: client.model }), { cwd: w.root, encoding: "utf8", timeout: agentTimeout, env: process.env });
  const output = `${ran.stdout ?? ""}\n${ran.stderr ?? ""}`;
  const reportedVersion = /^\s*`?client-version:\s*([^\s`]+)`?\s*$/mu.exec(output)?.[1];
  const issues = [
    ...(ran.error === undefined && ran.status === 0 ? [] : [`the client exited with ${ran.error?.message ?? `status ${String(ran.status)}`}`]),
    ...(existsSync(join(w.skill, "SKILL.md")) ? [] : ["the project skill was not installed"]),
    ...mismatch("the started run", declaredIn(startedRun(w.state)), client),
    ...(output.includes("Made via @slopdotcash") ? [] : ["the footer lacks the Made via @slopdotcash line"]),
    ...mismatch(`the ${SIGNED_ATTRIBUTION_MARKER} marker`, declaredIn(markerOf(output)), client),
    ...(reportedVersion === clientVersion ? [] : [`the client declared version ${JSON.stringify(reportedVersion ?? "")}, not ${clientVersion}`]),
  ];
  return {
    issues,
    recordedBy,
    record: {
      workflow: "contributor-skill",
      client: client.client,
      clientVersion,
      provider: client.provider,
      model: client.model,
      sourceSha,
      result: issues.length === 0 ? { outcome: "pass" } : { outcome: "fail", reason: issues.join("; ").slice(0, 1_000).trim() },
      evidence: `headless run of apps/contributor/test/contributor-agent-clients.test.vibe at ${new Date().toISOString()}`,
    },
  };
}

/** @throws {Error} */
export function priorRecords(recordedBy: string): unknown {
  return existsSync(recordsPath) ? JSON.parse(readFileSync(recordsPath, "utf8")) : { schemaVersion: 1, recordedBy, records: [] };
}

/** @throws {Error} */
export function keepRecords(document: { readonly records: ReadonlyArray<unknown> }): string {
  mkdirSync(dirname(recordsPath), { recursive: true });
  writeFileSync(recordsPath, `${JSON.stringify(document, null, 2)}\n`);
  return recordsPath;
}
