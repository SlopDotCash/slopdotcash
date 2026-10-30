export function createDistManifest(root: string): Promise<{
  schemaVersion: string;
  files: { path: string; bytes: number; sha256: string }[];
}>;
