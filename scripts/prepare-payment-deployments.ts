/** Derive public escrow deployment bindings from the sole reviewed project inventory. */
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ESCROW_NETWORKS } from "../src/lib/escrow-policy.mjs";
import { assertProjectDefinition } from "../src/lib/project-schema.mjs";

export async function paymentDeployments(
  root: string,
  environment: "testnet" | "mainnet",
  selectedNetwork?: string,
) {
  const result = [];
  for (const directory of (
    await readdir(resolve(root, "projects"), { withFileTypes: true })
  )
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const project = assertProjectDefinition(
      JSON.parse(
        await readFile(
          resolve(root, "projects", directory.name, "project.json"),
          "utf8",
        ),
      ),
    );
    if (project.id !== directory.name)
      throw new Error("Project directory identity mismatch");
    for (const deployment of project.escrow?.deployments ?? []) {
      if (selectedNetwork && deployment.network !== selectedNetwork) continue;
      const network = ESCROW_NETWORKS[deployment.network];
      if (network.testnet !== (environment === "testnet")) continue;
      result.push({
        projectId: project.id,
        ...deployment,
        chain: network.chain,
        ...(network.chainId ? { chainId: network.chainId } : {}),
      });
    }
  }
  if (new Set(result.map((entry) => entry.projectId)).size !== result.length)
    throw new Error(
      "Select one explicit network per test database; do not combine project liabilities across test clusters",
    );
  return result;
}

if (import.meta.main) {
  const environment = process.argv[2];
  if (environment !== "testnet" && environment !== "mainnet")
    throw new Error("Select testnet or mainnet explicitly");
  const deployments = await paymentDeployments(
    process.cwd(),
    environment,
    process.argv[3],
  );
  if (deployments.length === 0)
    throw new Error(
      "No reviewed escrow deployments exist for this environment",
    );
  process.stdout.write(`${JSON.stringify(deployments)}\n`);
}
