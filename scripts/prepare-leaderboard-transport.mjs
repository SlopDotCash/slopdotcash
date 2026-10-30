import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { encodeLeaderboardParts } from "../src/lib/leaderboard-transport.mjs";
import { readLeaderboardFile } from "./leaderboard-files.mjs";

async function atomicWrite(path, bytes) {
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporary, bytes, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function prepareLeaderboardTransport(path) {
  const logical = await readLeaderboardFile(path);
  const encoded = encodeLeaderboardParts(logical);
  for (const part of encoded.parts) {
    const target = join(dirname(path), part.path.slice("/data/".length));
    await mkdir(dirname(target), { recursive: true });
    await atomicWrite(target, part.bytes);
  }
  // All content-addressed parts exist before the root index changes.
  await atomicWrite(path, encoded.root);
  // Only the current publication belongs in the next Pages bundle. Retaining
  // old generated parts would eventually exceed the aggregate bundle limit.
  const directory = join(dirname(path), "leaderboard");
  const retained = new Set(
    encoded.parts.map((part) => part.path.split("/").at(-1)),
  );
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isFile() || !/^[a-f0-9]{64}\.part$/u.test(entry.name))
      throw new Error("Unexpected file in generated leaderboard parts");
    if (!retained.has(entry.name)) await rm(join(directory, entry.name));
  }
  return {
    logicalBytes: logical.length,
    rootBytes: encoded.root.length,
    parts: encoded.parts.length,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const result = await prepareLeaderboardTransport(
    "public/data/leaderboard.json",
  );
  console.log(`[Slop] leaderboard transport ${JSON.stringify(result)}`);
}
