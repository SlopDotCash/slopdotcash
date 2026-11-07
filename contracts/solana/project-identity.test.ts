import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = join(import.meta.dir, "../..");
const sourceExtensions = new Set([".js", ".mjs", ".ts", ".tsx"]);
const ignoredDirectories = new Set([
  ".git",
  ".wrangler",
  "coverage",
  "dist",
  "node_modules",
  "target",
]);

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory())
      return ignoredDirectories.has(entry.name) ? [] : sourceFiles(path);
    return sourceExtensions.has(extname(entry.name)) ? [path] : [];
  });
}

function location(path: string, source: string, offset: number) {
  const number = source.slice(0, offset).split("\n").length;
  const line = source.split("\n")[number - 1]?.trim() ?? "";
  return `${relative(root, path)}:${number}: ${line}`;
}

function noncanonicalProjectDigests(path: string, source: string): string[] {
  const offenders: string[] = [];
  const relevant =
    path.includes("/contracts/solana/") ||
    /SolanaEscrowConfig|prepareSolanaVaultCreation|verifySolanaDeployment|initializeNative|solana-mainnet|solana-localnet|solana-devnet/u.test(
      source,
    );
  if (!relevant) return offenders;

  for (const match of source.matchAll(
    /projectId\s*:\s*\w*Digest\b|projectId\s*:\s*\w+\.toString\(["']hex["']\)/gu,
  ))
    offenders.push(location(path, source, match.index));

  for (const match of source.matchAll(
    /\b(projectId|projectDigest)\s*=\s*(?:hash|digest|sha256|sha256Seed)\(\s*(["'`])((?!slop-project:)[^\n]*?)\2\s*\)/gu,
  )) {
    const variable = match[1];
    const usedForInitialization = new RegExp(
      String.raw`(?:initialize(?:Native)?\s*\([\s\S]{0,5000}(?:\.\.\.)?${variable}\b|projectDigest\s*:\s*${variable}\b)`,
      "u",
    ).test(source);
    const pairedWithCanonicalId =
      variable === "projectDigest" ||
      /projectId\s*:\s*["'`][a-z0-9-]+["'`]/u.test(source);
    if (
      pairedWithCanonicalId &&
      (usedForInitialization || variable === "projectDigest")
    )
      offenders.push(location(path, source, match.index));
  }

  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+(projectId|projectKey)\s*=\s*(["'`])([a-z0-9-]+)\2[\s\S]{0,300}?\b(?:const|let|var)\s+\w*(?:Digest|Id)\s*=\s*(?:hash|digest|sha256|sha256Seed)\(\s*\1\s*\)/gu,
  ))
    offenders.push(location(path, source, match.index));

  for (const match of source.matchAll(
    /\b(?:const|let|var)\s+(\w*(?:projectId|projectDigest)\w*)\s*=\s*(?:hash|digest|sha256|sha256Seed)\s*\(/giu,
  )) {
    const variable = match[1];
    const initializesWithRawDigest = new RegExp(
      String.raw`\binitialize(?:Native)?\s*\([\s\S]*?\bprojectId\s*:\s*${variable}\b`,
      "u",
    ).test(source);
    const registersAnotherId =
      /\bprojectId\s*:\s*`acceptance-\$\{/u.test(source) ||
      /\bprojectId\s*:\s*["']acceptance-/u.test(source);
    if (initializesWithRawDigest && registersAnotherId)
      offenders.push(location(path, source, match.index));
  }

  return offenders;
}

test("Solana escrow producers keep canonical registry project identity", () => {
  const offenders = sourceFiles(root).flatMap((path) => {
    const source = readFileSync(path, "utf8");
    return noncanonicalProjectDigests(path, source);
  });

  expect(offenders).toEqual([]);
});

test("native fee-converter fixture initializes the registry project digest", () => {
  const path = join(
    root,
    "contracts/solana/integration/fee-converter-native-fixture.mjs",
  );
  const source = readFileSync(path, "utf8");

  const interpolation = "$" + "{projectId}";
  expect(source).toContain(
    `const projectDigest = hash(\`slop-project:${interpolation}\`);`,
  );
  expect(source).toContain("[...projectDigest]");
  expect(source).not.toMatch(/const projectId = hash\(projectKey\)/u);
});

test("section-21 acceptance derives its on-chain identity from the registry ID", () => {
  const source = readFileSync(
    join(root, "contracts/solana/scripts/acceptance.ts"),
    "utf8",
  );

  expect(source).toContain(
    "const projectDigest = registryProjectDigest(projectId);",
  );
  expect(source).toContain('projectId: Buffer.from(projectDigest, "hex")');
  expect(source).toContain("onchainProjectId: projectDigest");
});

test("extended acceptance initializes every project from its registered ID", () => {
  const source = readFileSync(
    join(root, "contracts/solana/scripts/acceptance-extended.ts"),
    "utf8",
  );

  expect(source).toContain(
    "const projectDigest = registryProjectDigest(projectId);",
  );
  expect(source).toContain('projectId: Buffer.from(projectDigest, "hex")');
  expect(source).toContain("return { projectId, project, vault, mint };");
});

test("semantic guard catches acceptance-style split project identities", () => {
  const source = `
    const projectIdBytes = sha256(
      \`slop-escrow-acceptance:\${run.runId}:\${network}:\${mint}\`,
    );
    program.initialize({ projectId: projectIdBytes });
    const deployment = {
      projectId: \`acceptance-\${run.runId.slice(0, 8)}-0\`,
    };
  `;

  expect(
    noncanonicalProjectDigests("/repo/contracts/solana/fixture.ts", source),
  ).toHaveLength(1);
});
