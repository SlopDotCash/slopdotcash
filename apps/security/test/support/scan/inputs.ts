// spec/security/scanController.md, "A deployed release serves the scanner input list of its own commit"
import { SCANNER_ENTRIES, SCANNER_FILES } from "../../../src/scanner/inputs/paths.ts";
import { type WorkingRepository, workingRepository } from "../git/fixtures.ts";

/** @throws {Error} */
export function scannerRepository(root: string, name: string, scan: string): WorkingRepository {
  const repository = workingRepository(root, name);
  for (const path of [...SCANNER_ENTRIES, ...SCANNER_FILES]) repository.write(path, path.endsWith(".json") ? "{}\n" : "\n");
  repository.write("package.json", `${JSON.stringify({ name: "vibestack", exports: { "./testing": "./vibestack/testing/index.ts" } })}\n`);
  repository.write("packages/platform/package.json", `${JSON.stringify({ name: "@repo/platform", exports: { "./git": "./src/git/index.ts" } })}\n`);
  repository.write("packages/platform/src/git/index.ts", "export const git = 1\n");
  repository.write("spec/security/scanController.md", '# Controller\n\n```quint\nimport kernel.* from "./kernel"\n```\n');
  repository.write("spec/security/kernel.md", "# Kernel\n");
  repository.write("apps/security/src/programs/scan.vibe", scan);
  repository.write("apps/security/src/programs/main.vibe", 'import { scan } from "./scan.vibe"\n');
  repository.write("apps/security/src/scanner/run/pass.test.vibe", "\n");
  repository.write("apps/security/src/scanner/run/README.md", "\n");
  repository.write("apps/points/src/unrelated.vibe", "\n");
  repository.git(["add", "-A"]);
  repository.commit("Scanner fixture");
  return repository;
}
