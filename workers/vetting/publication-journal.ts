import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readBoundedJson } from "../../src/lib/browser-json";
import {
  JOURNAL_PATH,
  JOURNAL_SCHEMA,
  type PublicationIntent,
  type PublicationReceipt,
} from "../../src/lib/vetting-contracts";
import { serviceOrigin, signedServiceHeaders, type VettingServiceSigner } from "./service";

export { JOURNAL_SCHEMA, type PublicationIntent, type PublicationReceipt };
/** Reservation must be durable before the first publication request. */
export interface PublicationJournal {
  has(assessmentId: string): Promise<boolean>;
  reserve(intent: PublicationIntent): Promise<void>;
  complete(receipt: PublicationReceipt): Promise<void>;
}

export function filePublicationJournal(root: string): PublicationJournal {
  return {
    async has(id) {
      try {
        await stat(join(root, id));
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    async reserve(intent) {
      await mkdir(root, { recursive: true, mode: 0o700 });
      const directory = join(root, intent.assessmentId);
      await mkdir(directory, { mode: 0o700 });
      await writeFile(join(directory, "intent.json"), JSON.stringify(intent), {
        mode: 0o600,
        flag: "wx",
      });
    },
    async complete(receipt) {
      await writeFile(
        join(root, receipt.assessmentId, "receipt.json"),
        JSON.stringify(receipt),
        { mode: 0o600, flag: "wx" },
      );
    },
  };
}

/**
 * The journal route contract is shared with the service handler in
 * `src/lib/vetting-contracts.ts`; this module owns its file and signed clients.
 */

/**
 * Records publication state through the signed vetting service instead of
 * writing the database from the scheduled job. The controller then holds no
 * account-wide Cloudflare credential: the only writer of these two tables is
 * the deployed service (#1411 C-09).
 */
export function servicePublicationJournal(config: {
  origin: string;
  signer: VettingServiceSigner;
  fetch?: typeof fetch;
  now?: () => Date;
}): PublicationJournal {
  const origin = serviceOrigin(config.origin);
  const fetcher = config.fetch ?? fetch;
  // The journal lifetime keeps one endpoint, transport, clock and key pair.
  // Mutating caller-owned configuration cannot splice another key into it.
  const { privateKey, publicKey } = config.signer;
  const signer = { privateKey, publicKey };
  const now = config.now;
  async function call(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const body = new TextEncoder().encode(JSON.stringify(payload));
    const response = await fetcher(`${origin}${JOURNAL_PATH}`, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      headers: {
        "content-type": "application/json",
        ...(await signedServiceHeaders({
          signer,
          method: "POST",
          pathAndQuery: JOURNAL_PATH,
          body,
          ...(now ? { at: now() } : {}),
        })),
      },
      body,
    });
    if (!response.ok) {
      try {
        await response.body?.cancel();
      } catch {
        // Preserve the service refusal if disposing its body also fails.
      }
      throw new Error(
        `Publication journal refused ${String(payload.operation)} (HTTP ${response.status})`,
      );
    }
    const reply = await readBoundedJson(response, 4096, "Publication journal reply");
    if (
      typeof reply !== "object" || reply === null || Array.isArray(reply) ||
      !("schemaVersion" in reply) || reply.schemaVersion !== JOURNAL_SCHEMA
    )
      throw new Error("Publication journal reply has an unexpected contract");
    return reply as Record<string, unknown>;
  }
  return {
    async has(id) {
      const value = await call({ operation: "has", assessmentId: id });
      const present = value.present;
      // A well-formed reply with no boolean `present` is refused instead of read
      // as "not journaled": the caller would republish the assessment.
      if (typeof present !== "boolean")
        throw new Error("Publication journal reply has no boolean presence");
      return present;
    },
    async reserve(intent) {
      const value = await call({
        operation: "reserve",
        assessmentId: intent.assessmentId,
        resultSha256: intent.resultSha256,
        origin: intent.origin,
        disposition: intent.disposition,
      });
      if (value.reserved !== true)
        throw new Error("Publication journal reply has no confirmed reservation");
    },
    async complete(receipt) {
      const value = await call({
        operation: "complete",
        assessmentId: receipt.assessmentId,
        resultSha256: receipt.resultSha256,
        origin: receipt.origin,
        disposition: receipt.disposition,
        outcome: receipt.outcome,
        httpStatus: receipt.httpStatus,
      });
      if (value.recorded !== true)
        throw new Error("Publication journal reply has no confirmed receipt");
    },
  };
}
