import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ExistingFileError, writeNewFile } from "./write-new-file";

describe("immutable atomic file creation", () => {
  it("creates once, refuses replacement, and removes temporary files", async () => {
    const root = await mkdtemp(join(tmpdir(), "slop-write-new-file-"));
    const path = join(root, "nested", "record.json");
    try {
      await writeNewFile(path, "first\n", "already exists");
      await expect(
        writeNewFile(path, "second\n", "already exists"),
      ).rejects.toBeInstanceOf(ExistingFileError);
      expect(await readFile(path, "utf8")).toBe("first\n");
      expect(await readdir(join(root, "nested"))).toEqual(["record.json"]);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
