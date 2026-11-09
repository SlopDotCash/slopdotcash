import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, type FileHandle } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { readBoundedJson } from "../../src/lib/browser-json";
import {
  JOURNAL_PATH,
  JOURNAL_SCHEMA,
  PUBLICATION_OUTCOMES,
  type PublicationIntent,
  type PublicationReceipt,
  VETTING_DISPOSITIONS,
} from "../../src/lib/vetting-contracts";
import { serviceOrigin, signedServiceHeaders, type VettingServiceSigner } from "./service";

export { JOURNAL_SCHEMA, type PublicationIntent, type PublicationReceipt };
/** Reservation must be durable before the first publication request. */
export interface PublicationJournal {
  has(assessmentId: string): Promise<boolean>;
  reserve(intent: PublicationIntent): Promise<void>;
  complete(receipt: PublicationReceipt): Promise<void>;
}

function fileJournalId(id: string): string {
  // One portable path component, including the historical readiness ids.
  if (typeof id !== "string" || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/u.test(id) || id.endsWith("."))
    throw new Error("The publication journal assessment id is invalid");
  return id;
}

function captureFileIntent(intent: PublicationIntent): PublicationIntent {
  const captured = { ...intent };
  fileJournalId(captured.assessmentId);
  if (typeof captured.resultSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(captured.resultSha256) ||
    typeof captured.origin !== "string" || captured.origin.length === 0 || captured.origin.length > 200 ||
    !(VETTING_DISPOSITIONS as readonly string[]).includes(captured.disposition))
    throw new Error("The publication journal intent is invalid");
  return captured;
}

async function withFile<T>(handle: FileHandle, use: (file: FileHandle) => Promise<T>): Promise<T> {
  let failed = false;
  try {
    return await use(handle);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await handle.close();
    } catch (error) {
      if (!failed) throw error;
    }
  }
}

async function journalDirectory(path: string): Promise<void> {
  const entry = await lstat(path);
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error("The publication journal path is not a private directory");
}

async function syncJournalDirectory(path: string): Promise<void> {
  // Directory fsync is required, not a best-effort optimization. Unsupported
  // filesystems/platforms refuse publication instead of claiming durability.
  await withFile(await open(path, constants.O_RDONLY | constants.O_NOFOLLOW), async (directory) => {
    if (!(await directory.stat()).isDirectory())
      throw new Error("The publication journal path is not a private directory");
    await directory.sync();
  });
}

async function syncJournalAncestors(path: string): Promise<void> {
  // Another journal instance may have just created an apparently existing
  // ancestor. Each successful caller flushes the entire path it relies on.
  // Resolve system aliases such as macOS /var before opening each ancestor.
  for (let current = await realpath(path); ; current = dirname(current)) {
    await syncJournalDirectory(current);
    if (current === dirname(current)) break;
  }
}

async function writeJournalFile(path: string, body: string): Promise<void> {
  await withFile(await open(path, "wx", 0o600), async (file) => {
    await file.writeFile(body);
    await file.sync();
  });
}

/**
 * The operator owns this private namespace, outside guest/shared mounts.
 * External replacement/rename of a directory while a call runs is unsupported.
 * Any existing assessment entry, including an orphan or symlink, blocks retry.
 */
export function filePublicationJournal(root: string): PublicationJournal {
  const rootPath = resolve(root);
  return {
    async has(id) {
      const directory = join(rootPath, fileJournalId(id));
      try {
        await journalDirectory(rootPath);
        await lstat(directory);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
    },
    async reserve(intent) {
      const captured = captureFileIntent(intent);
      const body = JSON.stringify(captured);
      const directory = join(rootPath, captured.assessmentId);
      await mkdir(rootPath, { recursive: true, mode: 0o700 });
      await journalDirectory(rootPath);
      await syncJournalAncestors(rootPath);
      await mkdir(directory, { mode: 0o700 });
      await syncJournalDirectory(rootPath);
      await writeJournalFile(join(directory, "intent.json"), body);
      await syncJournalDirectory(directory);
    },
    async complete(receipt) {
      const captured = { ...receipt };
      captureFileIntent(captured);
      if (!(PUBLICATION_OUTCOMES as readonly string[]).includes(captured.outcome) ||
        (captured.httpStatus !== null && (!Number.isSafeInteger(captured.httpStatus) ||
          captured.httpStatus < 100 || captured.httpStatus > 599)))
        throw new Error("The publication journal receipt is invalid");
      const body = JSON.stringify(captured);
      const directory = join(rootPath, captured.assessmentId);
      await journalDirectory(rootPath);
      await journalDirectory(directory);
      const intentPath = join(directory, "intent.json");
      const intentEntry = await lstat(intentPath);
      if (!intentEntry.isFile() || intentEntry.isSymbolicLink())
        throw new Error("The publication journal intent is not a file");
      const retained = await withFile(
        await open(intentPath, constants.O_RDWR | constants.O_NOFOLLOW),
        async (file) => {
          if (!(await file.stat()).isFile()) throw new Error("The publication journal intent is not a file");
          const value: unknown = JSON.parse(await file.readFile("utf8"));
          // A concurrent reserver may still be flushing this complete file.
          // Completion also persists the retained intent it is binding to.
          await file.sync();
          return value;
        },
      );
      if (typeof retained !== "object" || retained === null ||
        !("assessmentId" in retained) || retained.assessmentId !== captured.assessmentId ||
        !("resultSha256" in retained) || retained.resultSha256 !== captured.resultSha256 ||
        !("origin" in retained) || retained.origin !== captured.origin ||
        !("disposition" in retained) || retained.disposition !== captured.disposition)
        throw new Error("The publication journal receipt has no matching intent");
      await syncJournalAncestors(rootPath);
      await writeJournalFile(join(directory, "receipt.json"), body);
      await syncJournalDirectory(directory);
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
