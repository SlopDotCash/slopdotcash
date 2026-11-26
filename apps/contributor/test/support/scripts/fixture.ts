// spec/contributor/discoveryLock.md, "Story: Never reclaim a discovery lock while its command may still run"
import { type ChildProcess, type SpawnSyncReturns, spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { repoRoot } from "@repo/platform/testing/paths";
import { usageAdapters } from "../../../src/render/fields.ts";

export const templateScripts = join(repoRoot, "skills", "project-contributor-template", "scripts");
export const fetchRedirect = pathToFileURL(join(import.meta.dirname, "..", "traces", "fetchRedirect.ts")).href;
export const posix = process.platform !== "win32";
export const identity = "{id:42,login:'fixture',host:'github.com'}";

export interface Ran {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Owned {
  readonly pid: number;
  readonly processIdentity: string;
}

export interface Discovery {
  readLiveReportProcessIdentity(pid: number): string | null;
}

export interface ScriptRoot {
  readonly root: string;
  readonly scripts: string;
  readonly bin: string;
  readonly locks: string;
  readonly entry: string;
  readonly url: string;
}

/** @throws {Error} */
export function scriptRoot(label: string, repositoryId = "example/project", names: ReadonlyArray<string> = ["live-report.mjs", "run-receipt.mjs"]): ScriptRoot {
  const root = mkdtempSync(join(tmpdir(), `slop-${label}-`));
  const scripts = join(root, "scripts");
  const bin = join(root, "bin");
  mkdirSync(scripts);
  mkdirSync(bin);
  for (const name of names) copyFileSync(join(templateScripts, name), join(scripts, name));
  writeFileSync(join(root, "project.json"), JSON.stringify({ repositoryId, usageAdapters }));
  const entry = join(scripts, "live-report.mjs");
  return { root, scripts, bin, locks: join(root, "locks"), entry, url: pathToFileURL(entry).href };
}

/** @throws {never} */
export function removeRoot(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** @throws {Error} */
export function fakeGh(bin: string, source: string): void {
  writeFileSync(join(bin, "gh"), `#!/usr/bin/env node\n${source}\n`, { mode: 0o700 });
}

/** @throws {Error} */
export function writeModule(root: string, name: string, source: string): string {
  const path = join(root, name);
  writeFileSync(path, source);
  return path;
}

/** @throws {never} */
export function onPath(bin: string): string {
  return `${bin}:${process.env.PATH ?? ""}`;
}

/** @throws {never} */
export function preloading(path: string): string {
  return `--import=${pathToFileURL(path).href}`;
}

/** @throws {never} */
export function node(args: ReadonlyArray<string>, environment: Readonly<Record<string, string>> = {}, options: { readonly timeout?: number } = {}): Ran {
  const result: SpawnSyncReturns<string> = spawnSync(process.execPath, args, { encoding: "utf8", env: { ...process.env, ...environment }, ...options });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** @throws {never} */
export function nodeAsync(args: ReadonlyArray<string>, environment: Readonly<Record<string, string>> = {}, options: { readonly timeout?: number } = {}): Promise<Ran> {
  const child = spawn(process.execPath, args, { env: { ...process.env, ...environment }, stdio: ["ignore", "pipe", "pipe"], ...options });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
  return new Promise((resolve) => child.once("close", (status) => resolve({ status, stdout, stderr })));
}

/** @throws {Error} */
export async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("fixture transition did not complete");
    await sleep(20);
  }
}

/** @throws {Error} */
export async function stopIdentity(discovery: Discovery, owned: Owned): Promise<void> {
  const stopped = () => discovery.readLiveReportProcessIdentity(owned.pid) !== owned.processIdentity;
  if (!stopped()) process.kill(owned.pid, "SIGKILL");
  await until(stopped);
}

/** @throws {Error} */
export async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const stopped = once(child, "exit");
  child.kill("SIGKILL");
  await stopped;
}
