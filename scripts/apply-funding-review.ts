/** Generate a candidate for upload in a GitHub PR; never replace cycle history. */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { applyFundingReviewSubmission } from "../src/lib/funding-review-submission";
import { writeNewJsonFile } from "./write-new-file";

export interface ApplyFundingReviewArguments {
  proposalPath: string;
  submissionPath: string;
  outputPath: string;
}

export function parseApplyFundingReviewArguments(
  values: string[],
): ApplyFundingReviewArguments {
  const flags = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const flag = values[index];
    const value = values[index + 1];
    if (
      !["--proposal", "--submission", "--output"].includes(flag) ||
      flags.has(flag) ||
      !value ||
      value.startsWith("--")
    )
      throw new TypeError(
        "Use --proposal <file> --submission <file> --output <new-file>, each exactly once",
      );
    flags.set(flag, resolve(value));
  }
  const proposalPath = flags.get("--proposal");
  const submissionPath = flags.get("--submission");
  const outputPath = flags.get("--output");
  if (!proposalPath || !submissionPath || !outputPath)
    throw new TypeError("--proposal, --submission and --output are required");
  return { proposalPath, submissionPath, outputPath };
}

export async function applyFundingReviewFiles(
  args: ApplyFundingReviewArguments,
  now = Date.now(),
) {
  if (
    [args.proposalPath, args.submissionPath].some(
      (path) => resolve(path) === resolve(args.outputPath),
    )
  )
    throw new TypeError("Candidate output must be separate from source inputs");
  const [source, submission] = await Promise.all([
    readFile(args.proposalPath),
    readFile(args.submissionPath),
  ]);
  if (
    source.byteLength > 8 * 1024 * 1024 ||
    submission.byteLength > 8 * 1024 * 1024
  )
    throw new RangeError("Review input exceeds 8 MiB");
  const candidate = await applyFundingReviewSubmission(
    source,
    JSON.parse(submission.toString("utf8")),
    now,
  );
  await writeNewJsonFile(
    args.outputPath,
    candidate,
    "Refusing to replace existing candidate or source file",
  );
  return candidate;
}

if (import.meta.main) {
  try {
    await applyFundingReviewFiles(
      parseApplyFundingReviewArguments(process.argv.slice(2)),
    );
    process.stdout.write(
      "[Slop] candidate proposal created for GitHub PR review; no awards or payments approved.\n",
    );
  } catch (error) {
    // error-policy:J1 CLI boundary fails visibly without publishing a candidate.
    process.stderr.write(
      `[Slop] review submission refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
