import { execFile } from "node:child_process";
import { promisify } from "node:util";

async function loadGhToken(): Promise<string> {
  let value: string;
  try {
    value = (
      await promisify(execFile)("gh", ["auth", "token"], { timeout: 15000 })
    ).stdout.trim();
  } catch {
    throw new Error(
      "GITHUB_TOKEN is unset and gh authentication is unavailable",
    );
  }
  if (!value) throw new Error("gh authentication returned no token");
  return value;
}

/** Shared CLI authentication; credentials are never included in logs or artifacts. */
export async function resolveGitHubToken(
  environment: Record<string, string | undefined> = process.env,
  ghTokenLoader: () => Promise<string> = loadGhToken,
): Promise<string> {
  return environment.GITHUB_TOKEN?.trim() || (await ghTokenLoader());
}
