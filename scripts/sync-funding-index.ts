/** Validates append-only direct-funding records and writes the public index. */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertProjectFundingIndex,
  FUNDING_PROTOCOL_VERSION,
} from "../src/lib/funding";
import { PROJECTS } from "../src/lib/projects.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FUNDING_ROOT = join(ROOT, "funding");
const OUTPUT = join(ROOT, "public", "data", "funding.json");

async function directories(path: string): Promise<string[]> {
  return (await readdir(path, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

export async function buildFundingIndex() {
  const records: unknown[] = [];
  for (const projectId of await directories(FUNDING_ROOT)) {
    const project = PROJECTS.find((candidate) => candidate.id === projectId);
    if (!project || project.funding.recordsPath !== `funding/${projectId}`) {
      throw new TypeError(
        `funding/${projectId} is not a registered project path`,
      );
    }
    for (const network of await directories(join(FUNDING_ROOT, projectId))) {
      for (const transactionId of await directories(
        join(FUNDING_ROOT, projectId, network),
      )) {
        const root = join(FUNDING_ROOT, projectId, network, transactionId);
        const files = (await readdir(root, { withFileTypes: true }))
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map((entry) => entry.name)
          .sort();
        if (files.length === 0) {
          throw new TypeError(`${root} has no funding records`);
        }
        for (const file of files) {
          const source = await readFile(join(root, file), "utf8");
          let record: Record<string, unknown>;
          try {
            record = JSON.parse(source) as Record<string, unknown>;
          } catch (error) {
            throw new TypeError(`${join(root, file)} is invalid JSON`, {
              cause: error,
            });
          }
          if (
            record.projectId !== projectId ||
            record.network !== network ||
            record.transactionId !== transactionId ||
            `${record.recordId}.json` !== file
          ) {
            throw new TypeError(`${join(root, file)} does not match its path`);
          }
          records.push(record);
        }
      }
    }
  }
  records.sort((left, right) => {
    const a = left as { observedAt?: string; recordId?: string };
    const b = right as { observedAt?: string; recordId?: string };
    return `${a.observedAt ?? ""}:${a.recordId ?? ""}`.localeCompare(
      `${b.observedAt ?? ""}:${b.recordId ?? ""}`,
    );
  });
  const addresses = new Map(
    PROJECTS.map((project) => [project.id, project.funding.addresses] as const),
  );
  const generatedAt = records.reduce<string | null>((latest, candidate) => {
    const record = candidate as { observedAt?: string };
    return typeof record.observedAt === "string" &&
      (latest === null || record.observedAt > latest)
      ? record.observedAt
      : latest;
  }, null);
  return assertProjectFundingIndex(
    { schemaVersion: FUNDING_PROTOCOL_VERSION, generatedAt, records },
    addresses,
  );
}

export async function syncFundingIndex(checkOnly = false): Promise<void> {
  const index = await buildFundingIndex();
  if (checkOnly) return;
  await mkdir(dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

if (import.meta.main) {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => flag !== "--check") || flags.length > 1) {
    throw new TypeError("Usage: sync-funding-index.ts [--check]");
  }
  await syncFundingIndex(flags[0] === "--check");
  process.stdout.write(
    flags[0] === "--check"
      ? "[Slop] funding records are valid\n"
      : "[Slop] synchronized funding index\n",
  );
}
