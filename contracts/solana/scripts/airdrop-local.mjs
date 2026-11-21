import { execFile } from "node:child_process";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  writeSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { runE2ePhase } from "../../../scripts/run-e2e-phase.mjs";
import { createRunnerCancellation } from "../../../scripts/runner-cancellation.mjs";

const exec = promisify(execFile);

/** Fund only the caller's local validator, with the original CLI arguments. */
export async function airdropLocalPayer({
  cwd = process.cwd(),
  env = process.env,
  timeoutMs = 60_000,
  interruptGraceMs = 5_000,
  signal,
} = {}) {
  const endpoint = new URL(env.ANCHOR_PROVIDER_URL);
  if (
    endpoint.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)
  )
    throw new Error("The test airdrop requires a local validator URL");
  mkdirSync(join(cwd, ".local"), { recursive: true });
  const directory = mkdtempSync(join(cwd, ".local", "airdrop-"));
  const log = join(directory, "command.log");
  const descriptor = openSync(log, "wx", 0o600);
  let commandExitCode = null;
  let commandSignal = null;
  let status;
  try {
    status = await runE2ePhase({
      label: "validator-airdrop",
      command: "solana",
      args: [
        "--url",
        env.ANCHOR_PROVIDER_URL,
        "airdrop",
        "100",
        "--keypair",
        env.ANCHOR_WALLET,
      ],
      cwd,
      env,
      timeoutMs,
      interruptGraceMs,
      interruptSignal: "SIGTERM",
      signal,
      onStdout: (chunk) => writeSync(descriptor, chunk),
      onStderr: (chunk) => writeSync(descriptor, chunk),
      onExit: (code, signal) => {
        commandExitCode = code;
        commandSignal = signal;
      },
    });
  } finally {
    closeSync(descriptor);
  }
  return { status, log, commandExitCode, commandSignal };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const cancellation = createRunnerCancellation();
  let result;
  try {
    result = await airdropLocalPayer({ signal: cancellation.signal });
    cancellation.record(result.status);
  } finally {
    cancellation.dispose();
  }
  if (result.status !== 0) {
    mkdirSync(".local/failure-evidence", { recursive: true });
    try {
      await exec(
        process.execPath,
        ["scripts/failure-evidence.mjs", result.log, String(result.status)],
        {
          timeout: 15_000,
          maxBuffer: 64 * 1024,
        },
      );
    } catch {
      console.error("Safe validator failure evidence could not be collected.");
    }
  }
  console.log(
    JSON.stringify({
      stage: "validator-airdrop",
      status: result.status,
      commandExitCode: result.commandExitCode,
      commandSignal: result.commandSignal,
    }),
  );
  process.exitCode = cancellation.exitCode;
}
