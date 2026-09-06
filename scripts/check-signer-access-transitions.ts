/** Invoked only from trusted-base code; proposed trees are data, never code. */
import { readSignerAccessLedger } from "./signer-access-ledger";

if (import.meta.main) {
  const [baseSha, headSha, ...extra] = process.argv.slice(2);
  if (!baseSha || !headSha || extra.length)
    throw new TypeError(
      "Usage: check-signer-access-transitions.ts <trusted-base-sha> <head-sha>",
    );
  const ledger = await readSignerAccessLedger({
    root: process.cwd(),
    baseSha,
    headSha,
    now: new Date().toISOString(),
  });
  process.stdout.write(
    `${JSON.stringify({
      kind: "signer-access-history-check",
      baseSha,
      headSha,
      authenticatedReports: ledger.reports.length,
      paymentAuthorized: false,
    })}\n`,
  );
}
