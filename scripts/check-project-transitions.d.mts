export type ProjectManifestEntry = readonly [path: string, bytes: string];

export declare function validateProjectTransitions(
  previousEntries: readonly ProjectManifestEntry[],
  currentEntries: readonly ProjectManifestEntry[],
): { previous: number; current: number };

export declare function checkProjectTransitions(
  baseRevision: string,
): Promise<{ previous: number; current: number }>;
