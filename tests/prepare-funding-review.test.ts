import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  buildFundingReviewIndex,
  syncFundingReviews,
} from "../scripts/prepare-funding-review";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "funding-preparation-"));
  roots.push(root);
  const dir = join(root, "funding/preparations");
  await mkdir(dir, { recursive: true });
  const input = await readFile(
    join(process.cwd(), "funding/preparations/eliza-2026-08.json"),
    "utf8",
  );
  const path = join(dir, "eliza-2026-08.json");
  await writeFile(path, input);
  return { root, dir, path, input };
}
it("syncs reproducible offline bytes, detects tampering and never creates a cycle proposal", async () => {
  const { root } = await fixture();
  await syncFundingReviews(root);
  const path = join(root, "public/data/funding-reviews.json");
  const bytes = await readFile(path, "utf8");
  await syncFundingReviews(root);
  expect(await readFile(path, "utf8")).toBe(bytes);
  await syncFundingReviews(root, true);
  await expect(
    readFile(join(root, "cycles/eliza/2026-08/proposal.json")),
  ).rejects.toThrow();
  await writeFile(path, "{}");
  await expect(syncFundingReviews(root, true)).rejects.toThrow("stale");
});
it("fails closed for truncated input, noncanonical filenames and symbolic links", async () => {
  const { root, dir, path, input } = await fixture();
  await writeFile(path, "{");
  await expect(buildFundingReviewIndex(root)).rejects.toThrow();
  await writeFile(path, input);
  await writeFile(join(dir, "other.json"), input);
  await expect(buildFundingReviewIndex(root)).rejects.toThrow("filename");
  await rm(join(dir, "other.json"));
  await symlink(path, join(dir, "linked.json"));
  await expect(buildFundingReviewIndex(root)).rejects.toThrow("Unexpected");
});
