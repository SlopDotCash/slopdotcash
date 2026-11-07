import { createHash } from "node:crypto";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";
import { applicationManifest } from "./project-application-manifest";

type Statement = { run: (...values: unknown[]) => unknown };

/**
 * A registered project row for suites that exercise a route reading the
 * registry. `projects` is written the way activation writes it: the manifest
 * and its digest, revision 1.
 */
export function seedProject(
  sqlite: { query: (sql: string) => Statement },
  id: string,
  repository: string,
  overrides: Record<string, unknown> = {},
) {
  const at = "2026-10-18T00:00:00.000Z";
  const manifest = JSON.stringify(
    assertProjectDefinition(
      applicationManifest(id, repository, {
        rewardAsset: {
          network: "ethereum",
          kind: "stablecoin",
          address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          symbol: "USDC",
          decimals: 6,
          chainId: "1",
          cluster: null,
          verifiedAt: at,
        },
        ...overrides,
      }),
    ),
  );
  const digest = createHash("sha256").update(manifest).digest("hex");
  sqlite
    .query(
      "INSERT INTO project_revisions(project_id,revision,manifest,manifest_sha256,reason,created_at) VALUES(?,1,?,?,?,?)",
    )
    .run(id, manifest, digest, "fixture", at);
  sqlite
    .query(
      "INSERT INTO projects(id,status,revision,manifest,manifest_sha256,created_at,updated_at) VALUES(?,'paused',1,?,?,?,?)",
    )
    .run(id, manifest, digest, at, at);
}
