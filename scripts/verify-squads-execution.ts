/** Node-only file wrapper for the Worker-safe Squads exact-plan verifier.
 * Usage: bun scripts/verify-squads-execution.ts --project <id>
 * --allocation <allocation.json> --plan <execution-plan.json>
 * --base-ledger <trusted-base.json> --ledger <candidate.json>
 * Stdout only. Exit 0 = exact plan match, 2 = unresolved, 1 = invalid input.
 * No exit status authorizes payment, signing, broadcasting or retirement.
 */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import {
  MAX_EXECUTION_JSON_BYTES,
  parseSquadsBindingLedger,
} from "../src/lib/squads-execution";
import { verifySquadsExecution } from "../src/lib/squads-execution-verifier";

export {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  LOOKUP_TABLE_PROGRAM_ID,
  squadsExecutionAddress,
  squadsUsdcAta,
  verifySquadsExecution,
} from "../src/lib/squads-execution-verifier";

export async function readBoundedExecutionFile(
  path: string,
): Promise<Uint8Array> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > MAX_EXECUTION_JSON_BYTES)
      throw new TypeError("Expected bounded regular execution file");
    const bytes = Buffer.alloc(MAX_EXECUTION_JSON_BYTES + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    if (length > MAX_EXECUTION_JSON_BYTES)
      throw new RangeError("Execution file grew beyond bound");
    return bytes.subarray(0, length);
  } finally {
    await handle.close();
  }
}

export function parseSquadsExecutionArguments(
  argv: string[],
): Record<
  "project" | "allocation" | "plan" | "base-ledger" | "ledger",
  string
> {
  const flags = ["project", "allocation", "plan", "base-ledger", "ledger"];
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index].slice(2);
    const value = argv[index + 1];
    if (
      !argv[index].startsWith("--") ||
      !flags.includes(key) ||
      Object.hasOwn(values, key) ||
      !value ||
      value.startsWith("--")
    )
      throw new TypeError("Invalid Squads execution CLI arguments");
    values[key] = value;
  }
  if (flags.some((flag) => !values[flag]))
    throw new TypeError(
      "Require --project --allocation --plan --base-ledger --ledger",
    );
  return values;
}

if (import.meta.main) {
  try {
    const args = parseSquadsExecutionArguments(process.argv.slice(2));
    const [allocationBytes, planBytes, base, next] = await Promise.all([
      readBoundedExecutionFile(args.allocation),
      readBoundedExecutionFile(args.plan),
      readBoundedExecutionFile(args["base-ledger"]),
      readBoundedExecutionFile(args.ledger),
    ]);
    const result = await verifySquadsExecution({
      projectId: args.project,
      allocationBytes,
      planBytes,
      baseLedger: parseSquadsBindingLedger(base),
      ledger: parseSquadsBindingLedger(next),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    // Success means exact plan match, never payment authorization or settlement.
    process.exitCode = result.instructionVerification === "verified" ? 0 : 2;
  } catch (error) {
    process.stderr.write(
      `Squads execution refused: ${error instanceof Error ? error.message : "invalid input"}\n`,
    );
    process.exitCode = 1;
  }
}
