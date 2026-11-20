/** Compiles one private October proposal import for the existing D1 file-import path. */
import { readFile, writeFile } from "node:fs/promises";
import { guardedMonthlyImportSql } from "./guarded-monthly-import";
import { prepareOctoberPreview } from "./october-reward-review";

export function prepareGuardedOctoberImport(
  input: Parameters<typeof prepareOctoberPreview>[0],
): { sql: string; reviews: ReturnType<typeof prepareOctoberPreview> } {
  const reviews = prepareOctoberPreview(input);
  return {
    sql: guardedMonthlyImportSql({
      ...reviews,
      pointsBatch: String(reviews.evidence.pointsBatch),
    }),
    reviews,
  };
}

if (import.meta.main) {
  try {
    const [
      mode,
      termsFile,
      packetFile,
      reviewedPacketSha256,
      registryFile,
      output,
    ] = process.argv.slice(2);
    if (
      process.argv.length !== 8 ||
      (mode !== "preview" && mode !== "guarded-sql") ||
      !termsFile ||
      !packetFile ||
      !reviewedPacketSha256 ||
      !registryFile ||
      !output
    )
      throw new Error(
        "Usage: prepare-october-rewards.ts preview|guarded-sql OWNER_TERMS REVIEWED_PACKET REVIEWER_SHA256 CURRENT_REGISTRY NEW_PRIVATE_FILE",
      );
    const [approvedTerms, reviewedPacket, currentRegistry] = await Promise.all([
      readFile(termsFile),
      readFile(packetFile),
      readFile(registryFile),
    ]);
    const { sql, reviews } = prepareGuardedOctoberImport({
      approvedTerms,
      reviewedPacket,
      reviewedPacketSha256,
      currentRegistry,
    });
    const report = {
      ...reviews,
      projects: reviews.projects.map(
        ({ manifest: _manifest, ...project }) => project,
      ),
    };
    await writeFile(
      output,
      mode === "guarded-sql" ? sql : `${JSON.stringify(report, null, 2)}\n`,
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    process.stderr.write(
      `October proposal preparation refused: ${error instanceof Error ? error.message : "unknown error"}\n`,
    );
    process.exitCode = 1;
  }
}
