export type ProjectManifestEntry = readonly [path: string, bytes: string];

export declare function validateProposalFundingTransitions(
  previousProjects: readonly ProjectManifestEntry[],
  currentProjects: readonly ProjectManifestEntry[],
  previousProposals: readonly ProjectManifestEntry[],
  currentProposals: readonly ProjectManifestEntry[],
): void;

export declare function validateProjectTransitions(
  previousEntries: readonly ProjectManifestEntry[],
  currentEntries: readonly ProjectManifestEntry[],
  now?: number,
): { previous: number; current: number };

export declare function checkProjectTransitions(
  baseRevision: string,
  currentRevision?: string,
): Promise<{ previous: number; current: number }>;
