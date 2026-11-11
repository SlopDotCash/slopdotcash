export function createDistManifest(root: string): Promise<{
  schemaVersion: string;
  files: { path: string; bytes: number; sha256: string }[];
}>;
export function expectedPublishedRoot(
  root: string,
  origin: string,
): Promise<Uint8Array>;
