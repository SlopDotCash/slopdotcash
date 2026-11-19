// spec/contributor/workflow.md, "The attribution marker uses the published identity record, refuses placeholder identity and keeps legacy markers readable"
import { spawnSync } from "node:child_process";

export interface Declared {
  readonly client: string;
  readonly provider: string;
  readonly model: string;
}

export interface HeadlessClient extends Declared {
  readonly binary: string;
  readonly credentials: readonly [string, ...string[]];
  readonly invocation: (run: { readonly prompt: string; readonly workspace: string; readonly model: string }) => ReadonlyArray<string>;
}

export const headlessClients: ReadonlyArray<HeadlessClient> = [
  {
    client: "claude-code",
    provider: "anthropic",
    model: "claude-opus-4-5-20251101",
    binary: "claude",
    credentials: ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"],
    invocation: ({ prompt, model }) => ["-p", prompt, "--model", model, "--permission-mode", "bypassPermissions", "--output-format", "text"],
  },
  {
    client: "codex",
    provider: "openai",
    model: "gpt-5.1-codex",
    binary: "codex",
    credentials: ["CODEX_API_KEY", "OPENAI_API_KEY"],
    invocation: ({ prompt, workspace, model }) => ["exec", "--model", model, "--dangerously-bypass-approvals-and-sandbox", "--skip-git-repo-check", "--cd", workspace, prompt],
  },
];

const releaseVersion = /\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]*[0-9A-Za-z])?)\b/u;

/** @throws {never} */
export function installedVersion(client: HeadlessClient): string | undefined {
  const ran = spawnSync(client.binary, ["--version"], { encoding: "utf8", timeout: 30_000 });
  if (ran.error !== undefined || ran.status !== 0) return undefined;
  return releaseVersion.exec(`${ran.stdout}\n${ran.stderr}`)?.[1];
}

/** @throws {never} */
export function runnable(client: HeadlessClient): boolean {
  return process.env.GITHUB_EVENT_NAME !== "pull_request"
    && client.credentials.some((name) => (process.env[name] ?? "") !== "")
    && installedVersion(client) !== undefined;
}
