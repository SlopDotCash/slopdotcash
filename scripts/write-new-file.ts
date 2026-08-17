/** Atomically creates an immutable file without replacing an existing path. */

import { randomUUID } from "node:crypto";
import { link, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class ExistingFileError extends Error {}

export async function writeNewFile(
  path: string,
  contents: string | Uint8Array,
  existingMessage: string,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { flag: "wx", mode: 0o644 });
    try {
      await link(temporaryPath, path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        throw new ExistingFileError(existingMessage, { cause: error });
      }
      throw error;
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export function writeNewJsonFile(
  path: string,
  value: unknown,
  existingMessage: string,
): Promise<void> {
  return writeNewFile(
    path,
    `${JSON.stringify(value, null, 2)}\n`,
    existingMessage,
  );
}
