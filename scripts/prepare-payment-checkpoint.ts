/** Generates review artifacts only. Never changes deployed pins or activation. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { paymentRecordBytes } from "../src/lib/payment-reservations";
import {
  requirePaymentBootstrapCheckpoint,
  verifyHistoricalPaymentAdmission,
} from "./payment-admission";
import {
  bootstrapCheckpointDigest,
  buildPaymentCheckpointSnapshot,
  checkpointDigest,
  DEPLOYED_PAYMENT_CHECKPOINTS,
  describePaymentCheckpoint,
  readCheckpointChain,
} from "./payment-checkpoints";
import { verifyPaymentAuthority } from "./payment-reservation-history";
import { writeNewFile } from "./write-new-file";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export function parsePaymentCheckpointArguments(args: string[]) {
  if (
    args.length !== 2 ||
    args[0] !== "--output-dir" ||
    !args[1] ||
    args[1].startsWith("--")
  )
    throw new TypeError(
      "Usage: prepare-payment-checkpoint.ts --output-dir <new-review-directory>",
    );
  return { outputDirectory: resolve(args[1]) };
}
export async function preparePaymentCheckpoint(
  args: ReturnType<typeof parsePaymentCheckpointArguments>,
) {
  const bootstrap = requirePaymentBootstrapCheckpoint();
  const revision = verifyPaymentAuthority(ROOT);
  const chain = readCheckpointChain(ROOT, revision);
  if (
    checkpointDigest(paymentRecordBytes(chain)) !==
    checkpointDigest(paymentRecordBytes(DEPLOYED_PAYMENT_CHECKPOINTS))
  )
    throw new TypeError(
      "Deploy the exact accepted checkpoint chain before preparing another migration",
    );
  if (chain.at(-1)?.revision === revision || bootstrap === revision)
    throw new TypeError(
      "Checkpoint must advance beyond the previous trust root",
    );
  await verifyHistoricalPaymentAdmission(ROOT, revision);
  const snapshot = buildPaymentCheckpointSnapshot(ROOT, revision);
  const previous = chain.length
    ? checkpointDigest(paymentRecordBytes(chain[chain.length - 1]))
    : bootstrapCheckpointDigest(bootstrap);
  const pin = describePaymentCheckpoint(ROOT, snapshot, previous);
  if (verifyPaymentAuthority(ROOT) !== revision)
    throw new TypeError(
      "Canonical history moved; regenerate checkpoint candidate",
    );
  const snapshotPath = join(args.outputDirectory, `${revision}.json`);
  const chainPath = join(args.outputDirectory, "payment-checkpoints.json");
  await writeNewFile(
    snapshotPath,
    paymentRecordBytes(snapshot),
    "Checkpoint snapshot output already exists",
  );
  await writeNewFile(
    chainPath,
    paymentRecordBytes([...chain, pin]),
    "Checkpoint chain output already exists",
  );
  return { revision, snapshotPath, chainPath };
}
if (import.meta.main) {
  try {
    process.stdout.write(
      `${JSON.stringify(await preparePaymentCheckpoint(parsePaymentCheckpointArguments(process.argv.slice(2))), null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "Checkpoint preparation failed"}\n`,
    );
    process.exitCode = 1;
  }
}
